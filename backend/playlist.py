import os
import zipfile
import shutil
import uuid
import time
import yt_dlp
from pathlib import Path
from backend.config import DOWNLOADS_DIR, TEMP_DIR, FFMPEG_DIR
from backend.downloader import (
    get_base_ydl_opts, 
    format_duration, 
    format_bytes,
    sanitize_filename, 
    active_jobs,
    create_progress_hook,
    DownloadCancelledException,
    run_download_audio
)

def create_playlist_track_hook(job_id, track_idx, total_tracks):
    """
    Precision progress hook for batch playlist downloads.
    Calculates exact sub-fraction of overall playlist percentage,
    enables chunk-level pause/resume, and handles instant cancellation.
    """
    def hook(d):
        job = active_jobs.get(job_id)
        if not job:
            return

        if job.get('is_cancelled'):
            raise DownloadCancelledException("Playlist download cancelled.")

        while job.get('is_paused'):
            if job.get('is_cancelled'):
                raise DownloadCancelledException("Playlist download cancelled.")
            time.sleep(0.3)

        status = d.get('status')
        if status == 'downloading':
            total = d.get('total_bytes') or d.get('total_bytes_estimate') or 0
            downloaded = d.get('downloaded_bytes') or 0
            speed = d.get('speed') or 0
            eta = d.get('eta') or 0

            stream_pct = 0.0
            if total > 0:
                stream_pct = downloaded / total

            # Compute overall batch progress (0% - 92%)
            track_fraction = 1.0 / max(total_tracks, 1)
            overall_pct = ((track_idx - 1) * track_fraction + (stream_pct * track_fraction)) * 92.0
            overall_pct = max(job.get('progress', 1.0), min(overall_pct, 92.0))

            job.update({
                'status': 'downloading' if not job.get('is_paused') else 'paused',
                'progress': round(overall_pct, 1),
                'speed_str': f"{format_bytes(speed)}/s • Track {track_idx}/{total_tracks}" if not job.get('is_paused') else "Batch Paused",
                'eta_str': f"{eta}s (Track {track_idx}/{total_tracks})" if not job.get('is_paused') else "Batch Paused",
                'downloaded_str': f"{track_idx - 1} / {total_tracks} tracks complete",
            })
    return hook

def extract_playlist_items(url: str):
    """
    Extracts complete playlist metadata and all tracks cleanly.
    Allows frontend to render individual track selection checkboxes.
    """
    opts = get_base_ydl_opts(url)
    opts.update({
        'skip_download': True,
        'extract_flat': 'in_playlist',
    })

    with yt_dlp.YoutubeDL(opts) as ydl:
        try:
            info = ydl.extract_info(url, download=False)
        except Exception as e:
            raise ValueError(f"Could not load playlist: {str(e)}")

    if not info:
        raise ValueError("No playlist data found at this URL.")

    playlist_title = info.get('title', 'Refined Playlist')
    uploader = info.get('uploader') or info.get('channel', 'Various Artists')
    entries = info.get('entries', [])

    tracks = []
    idx = 1
    total_est_bytes = 0

    for item in entries:
        if not item:
            continue
        
        vid_id = item.get('id', '')
        title = item.get('title', f"Track {idx}")
        artist = item.get('uploader') or item.get('channel') or uploader
        duration = item.get('duration', 0)
        
        # Estimate size at 320kbps
        est_bytes = int((320 * 1000 / 8) * (duration or 210))
        total_est_bytes += est_bytes

        thumb = item.get('thumbnail')
        if not thumb and item.get('thumbnails'):
            thumb = item['thumbnails'][-1].get('url')
        if not thumb and vid_id:
            thumb = f"https://i.ytimg.com/vi/{vid_id}/hqdefault.jpg"

        direct_url = item.get('url') or f"https://www.youtube.com/watch?v={vid_id}"

        tracks.append({
            'index': idx,
            'id': vid_id or f"track_{idx}",
            'title': title,
            'artist': artist,
            'duration_formatted': format_duration(duration),
            'duration_seconds': duration,
            'thumbnail': thumb,
            'url': direct_url,
            'est_size_mb': round(est_bytes / (1024 * 1024), 1)
        })
        idx += 1

    return {
        'playlist_title': playlist_title,
        'uploader': uploader,
        'total_tracks': len(tracks),
        'est_total_size_mb': round(total_est_bytes / (1024 * 1024), 1),
        'tracks': tracks
    }

def run_batch_playlist_download(job_id: str, playlist_title: str, selected_tracks: list, quality_tag: str):
    """
    Downloads each selected track, converts to high-res MP3 (with ID3 metadata),
    and bundles into a clean ZIP archive for instant 1-click download.
    """
    try:
        total_items = len(selected_tracks)
        if total_items == 0:
            raise ValueError("No tracks were selected for download.")

        batch_temp_dir = TEMP_DIR / f"batch_{job_id}"
        batch_temp_dir.mkdir(parents=True, exist_ok=True)

        active_jobs[job_id] = {
            'status': 'downloading',
            'progress': 1.0,
            'speed_str': f"Preparing batch (0/{total_items})",
            'eta_str': 'Starting...',
            'downloaded_str': f"0 / {total_items} tracks",
            'total_str': f"{total_items} tracks selected",
            'filepath': None,
            'filename': None,
            'error': None,
            'is_paused': False,
            'is_cancelled': False
        }

        downloaded_files = []

        for idx, track in enumerate(selected_tracks, 1):
            if active_jobs.get(job_id, {}).get('is_cancelled'):
                raise DownloadCancelledException("Playlist download cancelled.")

            while active_jobs.get(job_id, {}).get('is_paused'):
                if active_jobs.get(job_id, {}).get('is_cancelled'):
                    raise DownloadCancelledException("Playlist download cancelled.")
                time.sleep(0.3)

            sub_title = track.get('title', f"Track_{idx}")
            sub_url = track.get('url')
            sub_artist = track.get('artist', '')
            sub_thumb = track.get('thumbnail', '')
            
            clean_track_title = f"{idx:02d} - {sanitize_filename(sub_title)}"

            active_jobs[job_id].update({
                'speed_str': f"Downloading track {idx} of {total_items}",
                'eta_str': sub_title[:35] + ("..." if len(sub_title) > 35 else ""),
                'downloaded_str': f"{idx - 1} / {total_items} complete",
                'progress': round(((idx - 1) / total_items) * 92, 1)
            })

            # Download single track into batch_temp_dir
            sub_job_id = f"sub_{job_id}_{idx}"
            sub_template = str(batch_temp_dir / f"{clean_track_title}.%(ext)s")

            opts = get_base_ydl_opts(url)
            opts.update({
                'format': 'bestaudio/best',
                'outtmpl': sub_template,
                'progress_hooks': [create_playlist_track_hook(job_id, idx, total_items)],
            })

            if FFMPEG_DIR:
                bitrate = '320' if quality_tag == '320k' else ('256' if quality_tag == '256k' else '192')
                opts['postprocessors'] = [{
                    'key': 'FFmpegExtractAudio',
                    'preferredcodec': 'mp3',
                    'preferredquality': bitrate,
                }]

            try:
                with yt_dlp.YoutubeDL(opts) as ydl:
                    ydl.download([sub_url])

                # Check for output audio file (mp3, m4a, webm)
                matching_tracks = list(batch_temp_dir.glob(f"{clean_track_title}.*"))
                if matching_tracks:
                    downloaded_files.append(matching_tracks[0])
            except Exception as e:
                # Log and continue with other tracks
                print(f"Failed to download track {idx}: {e}")

        if not downloaded_files:
            raise RuntimeError("Could not download any of the selected tracks.")

        # Bundle into ZIP
        active_jobs[job_id].update({
            'status': 'processing',
            'progress': 95.0,
            'speed_str': 'Packaging ZIP Archive...',
            'eta_str': 'Compressing audio files...'
        })

        clean_pl_name = sanitize_filename(playlist_title) or "Refined_Playlist"
        zip_filename = f"{clean_pl_name}_[REFINED_STUDIO].zip"
        zip_dest_path = DOWNLOADS_DIR / f"{job_id}_{zip_filename}"

        with zipfile.ZipFile(zip_dest_path, 'w', zipfile.ZIP_DEFLATED) as zip_out:
            for f in downloaded_files:
                zip_out.write(f, arcname=f.name)

        # Cleanup batch temp directory
        try:
            shutil.rmtree(batch_temp_dir)
        except Exception:
            pass

        active_jobs[job_id].update({
            'status': 'ready',
            'progress': 100.0,
            'speed_str': f"Finished {len(downloaded_files)} tracks",
            'eta_str': 'Ready to save',
            'filepath': str(zip_dest_path),
            'filename': zip_filename
        })

    except DownloadCancelledException:
        active_jobs[job_id].update({
            'status': 'cancelled',
            'progress': 0,
            'speed_str': 'Batch Cancelled',
            'eta_str': 'Stopped by user'
        })
        try:
            shutil.rmtree(batch_temp_dir)
        except Exception:
            pass

    except Exception as e:
        active_jobs[job_id].update({
            'status': 'error',
            'progress': 0,
            'error': str(e)
        })
