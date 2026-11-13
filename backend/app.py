import os
import time
import uuid
import threading
import urllib.parse
import requests
from pathlib import Path
from typing import List, Optional
from urllib.parse import urlparse
from pydantic import BaseModel, Field, ConfigDict

from fastapi import FastAPI, HTTPException, BackgroundTasks, Query, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from starlette.types import ASGIApp, Scope, Receive, Send

from backend.config import FRONTEND_DIR, DOWNLOADS_DIR, TEMP_DIR, FFMPEG_DIR, is_serverless
from backend.downloader import (
    extract_media_info, 
    run_download_video, 
    run_download_audio, 
    active_jobs,
    sanitize_filename
)
from backend.searcher import search_songs, is_url
from backend.playlist import extract_playlist_items, run_batch_playlist_download

app = FastAPI(
    title="Everything Free — Universal Media Studio",
    version="3.1.0",
    docs_url=None, # Disable public swagger docs in production for security hardening
    redoc_url=None
)

# ----------------- VERCEL SERVERLESS PATH REWRITE MIDDLEWARE ----------------- #

class VercelPathMiddleware:
    """
    Normalizes Vercel serverless rewritten paths.
    When Vercel rewrites /api/(.*) to /api/index.py, it stores the original path in
    x-matched-path or x-forwarded-uri. This middleware restores the real URL path
    so FastAPI routers match without 404 Not Found errors.
    """
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] == "http":
            headers_dict = dict(scope.get("headers", []))
            matched = headers_dict.get(b"x-matched-path", b"").decode("utf-8", errors="ignore")
            if not matched:
                matched = headers_dict.get(b"x-forwarded-uri", b"").decode("utf-8", errors="ignore")

            current_path = scope.get("path", "")
            if matched:
                clean_matched = matched.split("?")[0]
                if clean_matched and current_path in ("/api/index.py", "/index.py", "/api", "/api/"):
                    scope["path"] = clean_matched
            elif current_path.startswith("/api/index.py/"):
                scope["path"] = current_path.replace("/api/index.py/", "/api/")
            elif current_path.startswith("/index.py/"):
                scope["path"] = current_path.replace("/index.py/", "/")

        await self.app(scope, receive, send)

app.add_middleware(VercelPathMiddleware)

# ----------------- SECURITY & CORS HARDENING ----------------- #

# Read allowed origins from environment
cors_origins_raw = os.environ.get("CORS_ORIGINS", "*").strip()
if cors_origins_raw == "*" or not cors_origins_raw:
    origins = ["*"]
    allow_credentials = False
else:
    origins = [o.strip() for o in cors_origins_raw.split(",") if o.strip()]
    allow_credentials = True

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=allow_credentials,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    """
    Applies strict OWASP production security headers to all responses.
    """
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    return response

# ----------------- SSRF & INPUT VALIDATION ----------------- #

BLOCKED_HOSTS = {
    "localhost", "127.0.0.1", "0.0.0.0", "169.254.169.254", "::1", "metadata.google.internal"
}

def validate_url(url_str: str) -> str:
    """
    Validates URL scheme, hostname, and blocks SSRF attempts against loopback/internal addresses.
    """
    if not url_str or not isinstance(url_str, str):
        raise HTTPException(status_code=400, detail="URL must be provided.")
    clean = url_str.strip()
    if len(clean) > 2048:
        raise HTTPException(status_code=400, detail="URL exceeds maximum allowed length.")
    
    parsed = urlparse(clean)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="Invalid URL protocol. Only HTTP and HTTPS are permitted.")
    
    host = parsed.hostname
    if not host:
        raise HTTPException(status_code=400, detail="Invalid URL hostname.")
    
    host_lower = host.lower()
    if host_lower in BLOCKED_HOSTS or host_lower.endswith(".internal") or host_lower.endswith(".local") or host_lower.startswith("10.") or host_lower.startswith("192.168."):
        raise HTTPException(status_code=400, detail="Access to private or local network hosts is prohibited.")
    
    # Normalize YouTube Music URLs to standard YouTube URLs
    if "music.youtube.com" in clean:
        clean = clean.replace("music.youtube.com", "www.youtube.com")

    return clean

def validate_job_id(job_id: str) -> str:
    """
    Ensures job_id is a valid UUID, preventing directory traversal and malformed lookups.
    """
    try:
        uuid.UUID(job_id)
        return job_id
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid job ID format.")

# ----------------- BACKGROUND FILE CLEANUP ----------------- #

def start_cleanup_scheduler():
    """
    Background worker that purges temporary downloads older than 60 minutes.
    """
    def cleanup_worker():
        while True:
            try:
                now = time.time()
                expiry = 3600 # 60 minutes
                for folder in (DOWNLOADS_DIR, TEMP_DIR):
                    if folder.exists():
                        for item in folder.iterdir():
                            if item.is_file() and not item.name.startswith("."):
                                try:
                                    if now - item.stat().st_mtime > expiry:
                                        item.unlink(missing_ok=True)
                                except Exception:
                                    pass
                            elif item.is_dir() and item.name.startswith("batch_"):
                                try:
                                    if now - item.stat().st_mtime > expiry:
                                        import shutil
                                        shutil.rmtree(item, ignore_errors=True)
                                except Exception:
                                    pass
            except Exception:
                pass
            time.sleep(600) # Check every 10 minutes

    thread = threading.Thread(target=cleanup_worker, daemon=True)
    thread.start()

start_cleanup_scheduler()

# ----------------- PYDANTIC SCHEMAS ----------------- #

class AnalyzeRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    url: str = Field(..., max_length=4096)

class VideoDownloadRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    url: str = Field(..., max_length=4096)
    format_selector: str = Field(default="bestvideo+bestaudio/best", max_length=1024)
    title: str = Field(default="Video", max_length=1024)

class AudioDownloadRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    url: str = Field(..., max_length=4096)
    quality_tag: str = Field(default="320k", max_length=64)
    title: str = Field(default="Audio Track", max_length=1024)
    artist: Optional[str] = Field(default="", max_length=1024)
    thumbnail: Optional[str] = Field(default=None, max_length=4096)

class PlaylistAnalyzeRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    url: str = Field(..., max_length=4096)

class SelectedTrack(BaseModel):
    model_config = ConfigDict(extra="ignore")
    index: int = 1
    title: str = Field(default="Track", max_length=1024)
    artist: Optional[str] = Field(default="", max_length=1024)
    url: str = Field(..., max_length=4096)
    thumbnail: Optional[str] = Field(default=None, max_length=4096)

class PlaylistDownloadRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    playlist_title: str = Field(default="Playlist", max_length=1024)
    selected_tracks: List[SelectedTrack]
    quality_tag: str = Field(default="320k", max_length=64)

# ----------------- API ROUTES (DUAL ROUTING FOR VERCEL & LOCALHOST) ----------------- #

@app.get("/healthz")
@app.get("/health")
@app.get("/api/health")
async def health_check():
    """
    Kubernetes/Docker/Vercel health check endpoint.
    """
    return {
        "status": "healthy",
        "service": "Everything Free Media Studio",
        "timestamp": int(time.time()),
        "ffmpeg": bool(FFMPEG_DIR),
        "serverless": is_serverless,
        "version": "3.1.0-universal-vercel-native"
    }

@app.post("/analyze")
@app.post("/api/analyze")
async def analyze_url(req: AnalyzeRequest):
    """
    Parses any video or audio URL across 1000+ platforms with SSRF protection.
    """
    safe_url = validate_url(req.url)
    try:
        data = extract_media_info(safe_url)
        return data
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/search")
@app.get("/api/search")
async def search_endpoint(q: str = Query(..., min_length=1, max_length=512)):
    """
    Searches famous songs or returns video/song metadata if query is a URL.
    """
    query = q.strip()
    if is_url(query):
        if not query.startswith(('http://', 'https://')):
            query = f"https://{query}"
        safe_url = validate_url(query)
        try:
            media_info = extract_media_info(safe_url)
            return {"type": "direct_url", "data": media_info}
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Could not parse URL: {e}")
    
    try:
        results = search_songs(query, limit=8)
        return {"type": "search_results", "query": query, "results": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Search failed: {e}")

@app.get("/download")
@app.get("/api/download")
@app.get("/download-direct")
@app.get("/api/download-direct")
async def direct_stream_download(
    url: str = Query(..., description="Target webpage URL or media stream URL"),
    title: str = Query("download", description="Media title"),
    format_selector: str = Query("best", description="Requested format"),
    ext: str = Query("mp4", description="File extension"),
    direct_url: Optional[str] = Query(None, description="Direct CDN stream URL if already known")
):
    """
    Direct, failure-proof streaming download endpoint for mobile and desktop.
    Streams media chunks directly from the platform CDN with Content-Disposition: attachment,
    saving the file directly to the user's Downloads folder without freezing on serverless.
    """
    stream_url = direct_url
    safe_title = sanitize_filename(title) if title else "download"
    clean_ext = "mp3" if ext.lower() in ("mp3", "audio") else "mp4"

    # If stream_url not passed directly, resolve it via extract_media_info
    if not stream_url or not stream_url.startswith("http"):
        try:
            info = extract_media_info(url)
            stream_url = info.get("direct_stream_url")
            if not stream_url and info.get("video_formats"):
                for vf in info["video_formats"]:
                    if vf.get("format_selector") and vf["format_selector"].startswith("http"):
                        stream_url = vf["format_selector"]
                        break
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Could not resolve media stream: {str(e)}")

    if not stream_url or not stream_url.startswith("http"):
        raise HTTPException(status_code=400, detail="Direct download stream not available for this media.")

    # Generator to stream chunks from remote CDN
    def iter_stream():
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
            "Accept": "*/*",
            "Accept-Encoding": "identity",
        }
        if "googlevideo.com" in stream_url:
            headers["Referer"] = "https://www.youtube.com/"
        elif "instagram.com" in stream_url or "cdninstagram.com" in stream_url:
            headers["Referer"] = "https://www.instagram.com/"
        elif "tiktokcdn.com" in stream_url:
            headers["Referer"] = "https://www.tiktok.com/"

        with requests.get(stream_url, headers=headers, stream=True, timeout=30) as r:
            r.raise_for_status()
            for chunk in r.iter_content(chunk_size=128 * 1024):
                if chunk:
                    yield chunk

    filename = f"{safe_title}.{clean_ext}"
    encoded_filename = urllib.parse.quote(filename)
    content_type = "audio/mpeg" if clean_ext == "mp3" else "video/mp4"

    response_headers = {
        "Content-Disposition": f'attachment; filename="{filename}"; filename*=UTF-8\'\'{encoded_filename}',
        "Content-Type": content_type,
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Expose-Headers": "Content-Disposition, Content-Length",
        "Cache-Control": "no-cache",
    }

    return StreamingResponse(iter_stream(), headers=response_headers)

@app.post("/download/video")
@app.post("/api/download/video")
async def start_video_download(req: VideoDownloadRequest):
    """
    Queues a high-definition video download (4K, 1440p, 1080p, 720p, etc.).
    """
    safe_url = validate_url(req.url)
    job_id = str(uuid.uuid4())

    if is_serverless:
        clean_title = sanitize_filename(req.title) or "video"
        direct_stream = ""
        try:
            info = extract_media_info(safe_url)
            direct_stream = info.get("direct_stream_url") or ""
        except Exception:
            pass

        download_query = urllib.parse.urlencode({
            "url": safe_url,
            "title": clean_title,
            "format_selector": req.format_selector,
            "ext": "mp4",
            "direct_url": direct_stream
        })
        dl_url = f"/api/download?{download_query}"
        active_jobs[job_id] = {
            'status': 'ready',
            'progress': 100.0,
            'speed_str': 'Complete',
            'eta_str': 'Ready',
            'downloaded_str': '100%',
            'total_str': '100%',
            'filepath': None,
            'filename': f"{clean_title}.mp4",
            'download_url': dl_url,
            'direct_stream_url': direct_stream,
            'error': None,
            'is_paused': False,
            'is_cancelled': False
        }
        return {"job_id": job_id, "status": "ready", "download_url": dl_url}

    thread = threading.Thread(
        target=run_download_video,
        args=(job_id, safe_url, req.format_selector, req.title),
        daemon=True
    )
    thread.start()
    return {"job_id": job_id, "status": "queued"}

@app.post("/download/audio")
@app.post("/api/download/audio")
async def start_audio_download(req: AudioDownloadRequest):
    """
    Queues audio extraction with MP3 conversion up to pristine 320 kbps & embedded tags.
    """
    safe_url = validate_url(req.url)
    job_id = str(uuid.uuid4())

    if is_serverless:
        clean_title = sanitize_filename(req.title) or "audio"
        direct_stream = ""
        try:
            info = extract_media_info(safe_url)
            direct_stream = info.get("direct_stream_url") or ""
        except Exception:
            pass

        download_query = urllib.parse.urlencode({
            "url": safe_url,
            "title": clean_title,
            "format_selector": req.quality_tag,
            "ext": "mp3",
            "direct_url": direct_stream
        })
        dl_url = f"/api/download?{download_query}"
        active_jobs[job_id] = {
            'status': 'ready',
            'progress': 100.0,
            'speed_str': 'Complete',
            'eta_str': 'Ready',
            'downloaded_str': '100%',
            'total_str': '100%',
            'filepath': None,
            'filename': f"{clean_title}.mp3",
            'download_url': dl_url,
            'direct_stream_url': direct_stream,
            'error': None,
            'is_paused': False,
            'is_cancelled': False
        }
        return {"job_id": job_id, "status": "ready", "download_url": dl_url}

    thread = threading.Thread(
        target=run_download_audio,
        args=(job_id, safe_url, req.quality_tag, req.title, req.artist, req.thumbnail),
        daemon=True
    )
    thread.start()
    return {"job_id": job_id, "status": "queued"}

@app.post("/playlist/analyze")
@app.post("/api/playlist/analyze")
async def analyze_playlist(req: PlaylistAnalyzeRequest):
    """
    Extracts all tracks from a playlist URL with interactive item-by-item metadata.
    """
    safe_url = validate_url(req.url)
    try:
        data = extract_playlist_items(safe_url)
        return data
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/playlist/download")
@app.post("/api/playlist/download")
async def download_playlist_batch(req: PlaylistDownloadRequest):
    """
    Queues batch downloading of user-selected playlist songs and bundles them into a ZIP.
    """
    if not req.selected_tracks:
        raise HTTPException(status_code=400, detail="Please select at least one song to download.")
    if len(req.selected_tracks) > 250:
        raise HTTPException(status_code=400, detail="Maximum 250 tracks can be bundled per batch.")
    
    job_id = str(uuid.uuid4())
    tracks_data = [t.model_dump() for t in req.selected_tracks]
    
    thread = threading.Thread(
        target=run_batch_playlist_download,
        args=(job_id, req.playlist_title, tracks_data, req.quality_tag),
        daemon=True
    )
    thread.start()
    return {"job_id": job_id, "status": "queued", "count": len(req.selected_tracks)}

@app.get("/progress/{job_id}")
@app.get("/api/progress/{job_id}")
async def get_progress(job_id: str):
    """
    Checks download percentage, transfer speed, and status for a given job.
    """
    valid_id = validate_job_id(job_id)
    if valid_id not in active_jobs:
        raise HTTPException(status_code=404, detail="Job not found.")
    return active_jobs[valid_id]

@app.post("/job/{job_id}/pause")
@app.post("/api/job/{job_id}/pause")
async def pause_job(job_id: str):
    """
    Pauses an active download stream cleanly.
    """
    valid_id = validate_job_id(job_id)
    if valid_id not in active_jobs:
        raise HTTPException(status_code=404, detail="Job not found.")
    job = active_jobs[valid_id]
    if job.get('status') in ['downloading', 'starting']:
        job['is_paused'] = True
        job['status'] = 'paused'
        job['speed_str'] = 'Download Paused'
    return {"status": job.get('status', 'paused'), "job_id": valid_id}

@app.post("/job/{job_id}/resume")
@app.post("/api/job/{job_id}/resume")
async def resume_job(job_id: str):
    """
    Resumes a paused download stream.
    """
    valid_id = validate_job_id(job_id)
    if valid_id not in active_jobs:
        raise HTTPException(status_code=404, detail="Job not found.")
    job = active_jobs[valid_id]
    job['is_paused'] = False
    job['status'] = 'downloading'
    job['speed_str'] = 'Resuming...'
    return {"status": "downloading", "job_id": valid_id}

@app.post("/job/{job_id}/cancel")
@app.post("/api/job/{job_id}/cancel")
async def cancel_job(job_id: str):
    """
    Cancels an active download and cleans up resources.
    """
    valid_id = validate_job_id(job_id)
    if valid_id not in active_jobs:
        raise HTTPException(status_code=404, detail="Job not found.")
    job = active_jobs[valid_id]
    job['is_cancelled'] = True
    job['is_paused'] = False
    job['status'] = 'cancelled'
    job['speed_str'] = 'Cancelled'
    return {"status": "cancelled", "job_id": valid_id}

@app.get("/download-file/{job_id}")
@app.get("/api/download-file/{job_id}")
async def download_file(job_id: str):
    """
    Streams the finished file directly to the user's browser/local storage.
    """
    valid_id = validate_job_id(job_id)
    if valid_id not in active_jobs:
        raise HTTPException(status_code=404, detail="Job not found.")
    
    job = active_jobs[valid_id]
    if job.get('status') != 'ready':
        raise HTTPException(status_code=400, detail="File is not ready yet.")

    # In serverless mode, redirect to the direct streaming download URL
    if job.get('download_url'):
        return RedirectResponse(url=job['download_url'])

    file_path = job.get('filepath')
    if not file_path or not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File on disk was not found.")

    filename = job.get('filename') or os.path.basename(file_path)
    return FileResponse(
        path=file_path,
        media_type='application/octet-stream',
        filename=filename
    )

@app.get("/system-status")
@app.get("/api/system-status")
async def system_status():
    """
    Returns engine status and ffmpeg availability.
    """
    return {
        "engine": "Everything Free Unified Engine v3.1",
        "ffmpeg_installed": bool(FFMPEG_DIR),
        "ffmpeg_dir": FFMPEG_DIR,
        "max_video_resolution": "4K Ultra HD (2160p 60fps)",
        "serverless": is_serverless,
        "status": "ready"
    }

# ----------------- VERCEL DIRECT SCRIPT ENTRYPOINT FALLBACK ----------------- #

@app.api_route("/api/index.py", methods=["GET", "POST", "OPTIONS"])
@app.api_route("/index.py", methods=["GET", "POST", "OPTIONS"])
async def vercel_entrypoint_fallback(request: Request):
    """
    Fallback router if Vercel forwards requests directly to the file destination.
    """
    if request.method == "GET":
        return await health_check()
    elif request.method == "POST":
        try:
            body = await request.json()
            if "url" in body:
                return await analyze_url(AnalyzeRequest(**body))
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))
        return {"status": "ok", "message": "Vercel entrypoint active"}

# Mount static frontend directory (supports both frontend/ and public/ deployments)
PUBLIC_DIR = Path(__file__).resolve().parent.parent / "public"

if FRONTEND_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")
elif (PUBLIC_DIR / "static").exists():
    app.mount("/static", StaticFiles(directory=str(PUBLIC_DIR / "static")), name="static")
elif PUBLIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(PUBLIC_DIR)), name="static")

@app.get("/")
@app.get("/index.html")
@app.get("/frontend/index.html")
async def root():
    candidates = [
        FRONTEND_DIR / "index.html",
        PUBLIC_DIR / "index.html",
        PUBLIC_DIR / "static" / "index.html"
    ]
    for c in candidates:
        if c.exists():
            return FileResponse(c)
    return {"message": "Everything Free Media Studio API is running."}

@app.get("/frontend/{file_path:path}")
async def serve_frontend_fallback(file_path: str):
    candidates = [
        FRONTEND_DIR / file_path,
        PUBLIC_DIR / file_path,
        PUBLIC_DIR / "static" / file_path
    ]
    for c in candidates:
        if c.exists() and c.is_file():
            return FileResponse(c)
    raise HTTPException(status_code=404, detail="File not found")

