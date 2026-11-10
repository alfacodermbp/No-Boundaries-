import os
import re
import uuid
import time
import shutil
import urllib.request
from pathlib import Path
import yt_dlp
from mutagen.easyid3 import EasyID3
from mutagen.mp3 import MP3
from mutagen.id3 import ID3, APIC, error as ID3Error

from backend.config import DOWNLOADS_DIR, TEMP_DIR, FFMPEG_DIR

# Global job tracker for live progress
active_jobs = {}

def format_duration(seconds):
    if not seconds:
        return "Unknown"
    seconds = int(seconds)
    mins, secs = divmod(seconds, 60)
    hours, mins = divmod(mins, 60)
    if hours > 0:
        return f"{hours:02d}:{mins:02d}:{secs:02d}"
    return f"{mins:02d}:{secs:02d}"

def format_bytes(num_bytes):
    if not num_bytes:
        return "Unknown size"
    for unit in ['B', 'KB', 'MB', 'GB']:
        if abs(num_bytes) < 1024.0:
            return f"{num_bytes:3.1f} {unit}"
        num_bytes /= 1024.0
    return f"{num_bytes:.1f} TB"

def sanitize_filename(name):
    # Remove characters invalid in Windows filenames
    clean = re.sub(r'[\\/*?:"<>|]', "", name)
    clean = clean.strip()
    return clean[:120] if clean else "download"

def get_base_ydl_opts():
    opts = {
        'quiet': True,
        'no_warnings': True,
        'nocheckcertificate': True,
        'user_agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'http_headers': {
            'Accept-Language': 'en-US,en;q=0.9',
        },
        'remote_components': ['ejs:github'],
    }
    deno_exe = Path.home() / ".deno" / "bin" / "deno.exe"
    if deno_exe.exists():
        opts['js_runtimes'] = {'deno': {'path': str(deno_exe)}}
    if FFMPEG_DIR:
        opts['ffmpeg_location'] = FFMPEG_DIR
    return opts

def extract_media_info(url: str):
    """
    Extracts comprehensive metadata, video format options (4k, 1080p, 720p, etc.),
    and audio options for any supported website link with multi-client fallback.
    """
    opts = get_base_ydl_opts()
    opts.update({
        'skip_download': True,
        'extract_flat': False,
    })

    info = None
    with yt_dlp.YoutubeDL(opts) as ydl:
        try:
            info = ydl.extract_info(url, download=False)
        except Exception as e:
            # Fallback 1: Try with mweb and android
            try:
                opts['extractor_args']['youtube']['player_client'] = ['mweb', 'android']
                with yt_dlp.YoutubeDL(opts) as ydl_retry:
                    info = ydl_retry.extract_info(url, download=False)
            except Exception:
                # Fallback 2: Flat extraction
                opts['extract_flat'] = 'in_playlist'
                try:
                    with yt_dlp.YoutubeDL(opts) as ydl_flat:
                        info = ydl_flat.extract_info(url, download=False)
                except Exception:
                    raise ValueError(f"Could not retrieve media info: {str(e)}")

    if not info:
        raise ValueError("Could not extract media info from the provided URL.")

    # Check if this is a playlist
    if 'entries' in info and info.get('_type') == 'playlist':
        return {
            'is_playlist': True,
            'id': info.get('id', ''),
            'title': info.get('title', 'Unknown Playlist'),
            'uploader': info.get('uploader') or info.get('channel', 'Unknown Creator'),
            'count': len(info.get('entries', [])),
            'url': url
        }

    title = info.get('title', 'Untitled Media')
    uploader = info.get('uploader') or info.get('channel') or info.get('creator') or 'Unknown Creator'
    duration = info.get('duration', 0)
    thumbnail = info.get('thumbnail') or (info.get('thumbnails', [{}])[-1].get('url') if info.get('thumbnails') else None)
    extractor = info.get('extractor_key', 'Generic').replace('Youtube', 'YouTube')
    
    # Process formats
    formats = info.get('formats', [])
    resolution_map = {}
    best_audio_size = 0

    # Calculate best audio stream filesize for accurate muxed filesize estimation
    audio_formats = [f for f in formats if f.get('vcodec') == 'none' and f.get('acodec') != 'none']
    if audio_formats:
        best_audio = max(audio_formats, key=lambda f: f.get('abr') or 0)
        best_audio_size = best_audio.get('filesize') or best_audio.get('filesize_approx') or (
            int((best_audio.get('abr', 128) * 1000 / 8) * duration) if duration else 0
        )

    # Standard desired heights in descending order
    target_heights = [2160, 1440, 1080, 720, 480, 360]
    height_labels = {
        2160: ("4K Ultra HD", "2160p"),
        1440: ("2K Quad HD", "1440p"),
        1080: ("Full HD", "1080p"),
        720: ("HD", "720p"),
        480: ("SD Standard", "480p"),
        360: ("Mobile", "360p")
    }

    # Find highest available height in source
    max_source_height = 0
    max_vid_size = 0
    for f in formats:
        h = f.get('height') or 0
        if h > max_source_height:
            max_source_height = h
            max_vid_size = f.get('filesize') or f.get('filesize_approx') or 0

    if not max_vid_size and best_audio_size:
        max_vid_size = best_audio_size * 5

    # Always include top tier "MAX HD / Original Master"
    resolution_map["MAX"] = {
        'quality': 'MAX HD',
        'label': f"Original Master ({max_source_height}p 60fps)" if max_source_height else "Best Available Master Quality",
        'height': max_source_height or 1080,
        'format_selector': 'bestvideo+bestaudio/best',
        'size_bytes': max_vid_size,
        'size_formatted': format_bytes(max_vid_size) if max_vid_size > 0 else "Source Stream",
        'ext': 'mp4'
    }

    # Group video formats by standard resolution tiers
    for target_h in target_heights:
        # Include tier if source has video that reaches at least within 5% of target height
        if max_source_height >= target_h * 0.90:
            label, res_tag = height_labels[target_h]
            # Find best format matching this height or closest
            matching = [f for f in formats if f.get('height') and abs(f['height'] - target_h) <= 80]
            
            calc_size = 0
            format_id = f"bestvideo[height<={target_h}]+bestaudio/best[height<={target_h}]/best"
            
            if matching:
                best_f = max(matching, key=lambda f: (f.get('tbr') or f.get('vbr') or 0))
                vid_size = best_f.get('filesize') or best_f.get('filesize_approx') or (
                    int(((best_f.get('tbr') or best_f.get('vbr') or 1500) * 1000 / 8) * duration) if duration else 0
                )
                calc_size = vid_size + (best_audio_size if best_f.get('acodec') == 'none' else 0)
            else:
                # Estimate based on standard bitrates
                bitrate_kbps = {2160: 16000, 1440: 8000, 1080: 4500, 720: 2200, 480: 1000, 360: 600}.get(target_h, 1500)
                calc_size = int((bitrate_kbps * 1000 / 8) * duration) if duration else 0

            resolution_map[res_tag] = {
                'quality': res_tag,
                'label': label,
                'height': target_h,
                'format_selector': format_id,
                'size_bytes': calc_size,
                'size_formatted': format_bytes(calc_size) if calc_size > 0 else "Dynamic stream",
                'ext': 'mp4'
            }

    # If no standard heights matched (e.g. Instagram Reels or Twitter videos without explicit height tags)
    if not resolution_map:
        # Fallback to Best Quality MP4
        resolution_map["HD"] = {
            'quality': 'HD Max',
            'label': 'Best Available Quality',
            'height': 1080,
            'format_selector': 'bestvideo+bestaudio/best',
            'size_bytes': best_audio_size * 4 if best_audio_size else 0,
            'size_formatted': format_bytes(best_audio_size * 4) if best_audio_size else "Auto-calculated",
            'ext': 'mp4'
        }

    # Audio options
    audio_options = [
        {
            'bitrate': 320,
            'label': '320 kbps (Hi-Res Master MP3)',
            'quality_tag': '320k',
            'ext': 'mp3',
            'size_formatted': format_bytes(int((320 * 1000 / 8) * duration)) if duration else "~8-12 MB"
        },
        {
            'bitrate': 256,
            'label': '256 kbps (Studio MP3)',
            'quality_tag': '256k',
            'ext': 'mp3',
            'size_formatted': format_bytes(int((256 * 1000 / 8) * duration)) if duration else "~6-9 MB"
        },
        {
            'bitrate': 192,
            'label': '192 kbps (Standard Quality MP3)',
            'quality_tag': '192k',
            'ext': 'mp3',
            'size_formatted': format_bytes(int((192 * 1000 / 8) * duration)) if duration else "~4-6 MB"
        },
        {
            'bitrate': 0,
            'label': 'Original Audio (Direct M4A/Source)',
            'quality_tag': 'original',
            'ext': 'm4a',
            'size_formatted': format_bytes(best_audio_size) if best_audio_size else "~5 MB"
        }
    ]

    return {
        'is_playlist': False,
        'id': info.get('id', str(uuid.uuid4())[:8]),
        'title': title,
        'uploader': uploader,
        'duration_formatted': format_duration(duration),
        'duration_seconds': duration,
        'thumbnail': thumbnail,
        'extractor': extractor,
        'webpage_url': info.get('webpage_url', url),
        'video_formats': list(resolution_map.values()),
        'audio_formats': audio_options
    }

class DownloadCancelledException(Exception):
    """Raised when user cancels an active download."""
    pass

def create_progress_hook(job_id):
    state = {'stream_count': 0, 'last_status': None}

    def hook(d):
        job = active_jobs.get(job_id)
        if not job:
            return

        # Handle cancellation
        if job.get('is_cancelled'):
            raise DownloadCancelledException("Download cancelled by user.")

        # Handle pause (sleep-loop until unpaused or cancelled)
        while job.get('is_paused'):
            if job.get('is_cancelled'):
                raise DownloadCancelledException("Download cancelled by user.")
            time.sleep(0.3)

        status = d.get('status')
        if status == 'downloading':
            total = d.get('total_bytes') or d.get('total_bytes_estimate') or 0
            downloaded = d.get('downloaded_bytes') or 0
            speed = d.get('speed') or 0
            eta = d.get('eta') or 0

            percent = 0.0
            if total > 0:
                percent = round((downloaded / total) * 100, 1)

            # Monotonic progress weighting:
            current_pct = job.get('progress', 2.0)
            if state['stream_count'] >= 1:
                # Secondary (audio) stream: maps 80% to 95%
                calc_pct = round(80.0 + (percent * 0.15), 1)
            else:
                # Primary stream: maps 2% to 80%
                calc_pct = round(2.0 + (percent * 0.78), 1)

            final_pct = max(current_pct, min(calc_pct, 95.0))

            job.update({
                'status': 'downloading' if not job.get('is_paused') else 'paused',
                'progress': final_pct,
                'speed_str': f"{format_bytes(speed)}/s" if not job.get('is_paused') else "Download Paused",
                'eta_str': f"{eta}s remaining" if not job.get('is_paused') else "Download paused",
                'downloaded_str': format_bytes(downloaded),
                'total_str': format_bytes(total) if total else "Streaming...",
            })

        elif status == 'finished':
            state['stream_count'] += 1
            state['last_status'] = 'finished'
            job.update({
                'status': 'processing',
                'progress': max(job.get('progress', 2.0), 96.0),
                'speed_str': 'Processing media...',
                'eta_str': 'Muxing / Tagging...'
            })
    return hook

def run_download_video(job_id: str, url: str, format_selector: str, title: str):
    try:
        active_jobs[job_id] = {
            'status': 'starting',
            'progress': 2.0,
            'speed_str': 'Connecting...',
            'eta_str': 'Queued',
            'downloaded_str': '0 MB',
            'total_str': 'Calculating...',
            'filepath': None,
            'filename': None,
            'error': None,
            'is_paused': False,
            'is_cancelled': False
        }

        clean_title = sanitize_filename(title)
        out_template = str(TEMP_DIR / f"{job_id}_{clean_title}.%(ext)s")

        opts = get_base_ydl_opts()
        opts.update({
            'format': format_selector or 'bestvideo+bestaudio/best',
            'outtmpl': out_template,
            'merge_output_format': 'mp4',
            'progress_hooks': [create_progress_hook(job_id)],
            'postprocessors': [{
                'key': 'FFmpegVideoConvertor',
                'preferedformat': 'mp4',
            }]
        })

        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([url])

        # Locate final downloaded file
        matching_files = list(TEMP_DIR.glob(f"{job_id}_{clean_title}.*"))
        if not matching_files:
            # Check any file starting with job_id
            matching_files = list(TEMP_DIR.glob(f"{job_id}_*.*"))

        if not matching_files:
            raise FileNotFoundError("Downloaded output file was not found.")

        target_file = matching_files[0]
        final_filename = f"{clean_title}{target_file.suffix}"
        dest_path = DOWNLOADS_DIR / f"{job_id}_{final_filename}"
        shutil.move(str(target_file), str(dest_path))

        active_jobs[job_id].update({
            'status': 'ready',
            'progress': 100.0,
            'speed_str': 'Complete',
            'eta_str': 'Saved',
            'filepath': str(dest_path),
            'filename': final_filename
        })

    except DownloadCancelledException:
        active_jobs[job_id].update({
            'status': 'cancelled',
            'progress': 0,
            'speed_str': 'Cancelled',
            'eta_str': 'Stopped by user'
        })
        for f in TEMP_DIR.glob(f"{job_id}_*"):
            try:
                f.unlink(missing_ok=True)
            except Exception:
                pass

    except Exception as e:
        active_jobs[job_id].update({
            'status': 'error',
            'progress': 0,
            'error': str(e)
        })

def run_download_audio(job_id: str, url: str, quality_tag: str, title: str, artist: str = "", thumbnail_url: str = ""):
    try:
        active_jobs[job_id] = {
            'status': 'starting',
            'progress': 2.0,
            'speed_str': 'Connecting...',
            'eta_str': 'Queued',
            'downloaded_str': '0 MB',
            'total_str': 'Calculating...',
            'filepath': None,
            'filename': None,
            'error': None,
            'is_paused': False,
            'is_cancelled': False
        }

        clean_title = sanitize_filename(title)
        out_template = str(TEMP_DIR / f"{job_id}_{clean_title}.%(ext)s")

        opts = get_base_ydl_opts()
        bitrate = '320' if quality_tag == '320k' else ('256' if quality_tag == '256k' else '192')

        if quality_tag == 'original':
            opts.update({
                'format': 'bestaudio/best',
                'outtmpl': out_template,
                'progress_hooks': [create_progress_hook(job_id)],
            })
        else:
            opts.update({
                'format': 'bestaudio/best',
                'outtmpl': out_template,
                'progress_hooks': [create_progress_hook(job_id)],
                'postprocessors': [{
                    'key': 'FFmpegExtractAudio',
                    'preferredcodec': 'mp3',
                    'preferredquality': bitrate,
                }]
            })

        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([url])

        # Locate final downloaded file
        matching_files = list(TEMP_DIR.glob(f"{job_id}_{clean_title}.*"))
        if not matching_files:
            matching_files = list(TEMP_DIR.glob(f"{job_id}_*.*"))

        if not matching_files:
            raise FileNotFoundError("Audio output file was not found.")

        target_file = matching_files[0]
        final_filename = f"{clean_title}{target_file.suffix}"
        dest_path = DOWNLOADS_DIR / f"{job_id}_{final_filename}"
        shutil.move(str(target_file), str(dest_path))

        # Tag MP3 with Mutagen (Title, Artist, and Cover Artwork)
        if dest_path.suffix.lower() == '.mp3':
            try:
                # Add EasyID3 tags
                try:
                    audio = EasyID3(str(dest_path))
                except ID3Error:
                    audio = EasyID3()
                audio['title'] = title
                if artist:
                    audio['artist'] = artist
                audio.save(str(dest_path))

                # Embed thumbnail artwork if provided
                if thumbnail_url:
                    try:
                        thumb_temp = TEMP_DIR / f"thumb_{job_id}.jpg"
                        urllib.request.urlretrieve(thumbnail_url, str(thumb_temp))
                        
                        id3 = ID3(str(dest_path))
                        with open(thumb_temp, 'rb') as albumart:
                            id3.add(APIC(
                                encoding=3,
                                mime='image/jpeg',
                                type=3, # Front cover
                                desc='Cover',
                                data=albumart.read()
                            ))
                        id3.save(str(dest_path))
                        thumb_temp.unlink(missing_ok=True)
                    except Exception:
                        pass
            except Exception:
                pass

        active_jobs[job_id].update({
            'status': 'ready',
            'progress': 100.0,
            'speed_str': 'Complete',
            'eta_str': 'Saved',
            'filepath': str(dest_path),
            'filename': final_filename
        })

    except DownloadCancelledException:
        active_jobs[job_id].update({
            'status': 'cancelled',
            'progress': 0,
            'speed_str': 'Cancelled',
            'eta_str': 'Stopped by user'
        })
        for f in TEMP_DIR.glob(f"{job_id}_*"):
            try:
                f.unlink(missing_ok=True)
            except Exception:
                pass

    except Exception as e:
        active_jobs[job_id].update({
            'status': 'error',
            'progress': 0,
            'error': str(e)
        })
