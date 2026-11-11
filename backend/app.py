import os
import time
import uuid
import threading
from pathlib import Path
from typing import List, Optional
from urllib.parse import urlparse
from pydantic import BaseModel, Field, ConfigDict

from fastapi import FastAPI, HTTPException, BackgroundTasks, Query, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from backend.config import FRONTEND_DIR, DOWNLOADS_DIR, TEMP_DIR, FFMPEG_DIR
from backend.downloader import (
    extract_media_info, 
    run_download_video, 
    run_download_audio, 
    active_jobs
)
from backend.searcher import search_songs, is_url
from backend.playlist import extract_playlist_items, run_batch_playlist_download

app = FastAPI(
    title="Everything Free — Universal Media Studio",
    version="2.5.0",
    docs_url=None, # Disable public swagger docs in production for security hardening
    redoc_url=None
)

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

# ----------------- API ROUTES ----------------- #

@app.get("/healthz")
@app.get("/api/health")
async def health_check():
    """
    Kubernetes/Docker/Vercel health check endpoint.
    """
    return {
        "status": "healthy",
        "service": "Everything Free Media Studio",
        "timestamp": int(time.time()),
        "ffmpeg": bool(FFMPEG_DIR)
    }

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

@app.get("/api/search")
async def search_endpoint(q: str = Query(..., min_length=1, max_length=512)):
    """
    Searches famous songs or returns video/song metadata if query is a URL.
    """
    query = q.strip()
    if is_url(query):
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

@app.post("/api/download/video")
async def start_video_download(req: VideoDownloadRequest):
    """
    Queues a high-definition video download (4K, 1440p, 1080p, 720p, etc.).
    """
    safe_url = validate_url(req.url)
    job_id = str(uuid.uuid4())
    thread = threading.Thread(
        target=run_download_video,
        args=(job_id, safe_url, req.format_selector, req.title),
        daemon=True
    )
    thread.start()
    return {"job_id": job_id, "status": "queued"}

@app.post("/api/download/audio")
async def start_audio_download(req: AudioDownloadRequest):
    """
    Queues audio extraction with MP3 conversion up to pristine 320 kbps & embedded tags.
    """
    safe_url = validate_url(req.url)
    job_id = str(uuid.uuid4())
    thread = threading.Thread(
        target=run_download_audio,
        args=(job_id, safe_url, req.quality_tag, req.title, req.artist, req.thumbnail),
        daemon=True
    )
    thread.start()
    return {"job_id": job_id, "status": "queued"}

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

@app.get("/api/progress/{job_id}")
async def get_progress(job_id: str):
    """
    Checks download percentage, transfer speed, and status for a given job.
    """
    valid_id = validate_job_id(job_id)
    if valid_id not in active_jobs:
        raise HTTPException(status_code=404, detail="Job not found.")
    return active_jobs[valid_id]

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

    file_path = job.get('filepath')
    if not file_path or not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File on disk was not found.")

    filename = job.get('filename') or os.path.basename(file_path)
    return FileResponse(
        path=file_path,
        media_type='application/octet-stream',
        filename=filename
    )

@app.get("/api/system-status")
async def system_status():
    """
    Returns engine status and ffmpeg availability.
    """
    return {
        "engine": "Everything Free Unified Engine v2.5",
        "ffmpeg_installed": bool(FFMPEG_DIR),
        "ffmpeg_dir": FFMPEG_DIR,
        "max_video_resolution": "4K Ultra HD (2160p 60fps)",
        "max_audio_bitrate": "320 kbps High-Res MP3",
        "storage": "Direct-to-Client (Zero Telemetry)"
    }

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

