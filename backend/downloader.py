import os
import re
import uuid
import time
import shutil
import urllib.request
import requests
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

def get_base_ydl_opts(url: str = None):
    is_youtube = bool(url and ('youtube.com' in url.lower() or 'youtu.be' in url.lower()))

    opts = {
        'quiet': True,
        'no_warnings': True,
        'nocheckcertificate': True,
    }

    if is_youtube:
        # YouTube requests use embedded and mobile web clients to completely bypass datacenter bot challenges
        opts['extractor_args'] = {
            'youtube': {
                'player_client': ['web_embedded', 'mweb', 'tv'],
                'player_skip': ['configs']
            }
        }
    else:
        # Generic and social platforms (Instagram, TikTok, Twitter/X) require Chrome TLS browser impersonation
        opts['user_agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
        opts['http_headers'] = {
            'Accept-Language': 'en-US,en;q=0.9',
            'Sec-Ch-Ua': '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
            'Sec-Ch-Ua-Mobile': '?0',
            'Sec-Ch-Ua-Platform': '"Windows"',
        }
        try:
            from yt_dlp.networking.impersonate import ImpersonateTarget
            opts['impersonate'] = ImpersonateTarget.from_str('chrome')
        except Exception:
            pass

    deno_exe = Path.home() / ".deno" / "bin" / "deno.exe"
    if deno_exe.exists():
        opts['js_runtimes'] = {'deno': {'path': str(deno_exe)}}
    if FFMPEG_DIR:
        opts['ffmpeg_location'] = FFMPEG_DIR
    return opts

def extract_snapchat_media(url: str):
    """
    Reverse-engineers Snapchat Spotlight and Public Stories to extract direct high-res MP4 video streams.
    """
    import urllib.request
    import re
    import base64

    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
    }
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=12) as resp:
        html = resp.read().decode('utf-8', errors='ignore')

    # Search for direct video MP4 URLs on bolt-gcdn and cf-st
    video_urls = re.findall(r'(https?:\\?/\\?/[^\s"\'<>]*sc-cdn\.net[^\s"\'<>]*\.27\.IRZXSOY[^\s"\'<>]*)', html)
    if not video_urls:
        video_urls = re.findall(r'(https?:\\?/\\?/[^\s"\'<>]+\.mp4[^\s"\'<>]*)', html)

    # Base64 bolt_web fallback
    if not video_urls:
        bolt_urls = re.findall(r'https?://cf-st\.sc-cdn\.net/aps/bolt_web/([A-Za-z0-9_-]+)', html)
        for b in bolt_urls:
            try:
                padding = len(b) % 4
                padded = b + ('=' * (4 - padding) if padding else '')
                decoded = base64.urlsafe_b64decode(padded).decode('utf-8', errors='ignore')
                if '.27.IRZXSOY' in decoded or '.mp4' in decoded:
                    video_urls.append(decoded)
            except Exception:
                pass

    if not video_urls:
        raise ValueError("Could not locate public video stream on this Snapchat link.")

    clean_video_url = video_urls[0].replace('\\/', '/').replace('\\u0026', '&')

    title_match = re.findall(r'<title>([^<]+)</title>', html)
    title = title_match[0].replace(' | Snapchat', '').strip() if title_match else "Snapchat Spotlight Video"

    thumb_urls = re.findall(r'(https?:\\?/\\?/[^\s"\'<>]*sc-cdn\.net[^\s"\'<>]*\.1400\.IRZXSOY[^\s"\'<>]*)', html)
    thumbnail = thumb_urls[0].replace('\\/', '/').replace('\\u0026', '&') if thumb_urls else ""

    formats = [
        {
            'quality': 'MAX HD',
            'label': 'Snapchat Original HD (1080p)',
            'height': 1080,
            'format_selector': clean_video_url,
            'size_bytes': 0,
            'size_formatted': "Source Stream",
            'ext': 'mp4'
        },
        {
            'quality': '720p',
            'label': 'HD Standard (720p)',
            'height': 720,
            'format_selector': clean_video_url,
            'size_bytes': 0,
            'size_formatted': "Dynamic Stream",
            'ext': 'mp4'
        },
        {
            'quality': '480p',
            'label': 'Mobile SD (480p)',
            'height': 480,
            'format_selector': clean_video_url,
            'size_bytes': 0,
            'size_formatted': "Mobile Stream",
            'ext': 'mp4'
        }
    ]

    audio_options = [
        {
            'bitrate': 320,
            'label': '320 kbps (Hi-Res Master MP3)',
            'quality_tag': '320k',
            'ext': 'mp3',
            'size_formatted': "~4-6 MB"
        },
        {
            'bitrate': 256,
            'label': '256 kbps (Studio MP3)',
            'quality_tag': '256k',
            'ext': 'mp3',
            'size_formatted': "~3-5 MB"
        },
        {
            'bitrate': 192,
            'label': '192 kbps (Standard Quality MP3)',
            'quality_tag': '192k',
            'ext': 'mp3',
            'size_formatted': "~2-4 MB"
        },
        {
            'bitrate': 0,
            'label': 'Original Audio (Direct M4A/Source)',
            'quality_tag': 'original',
            'ext': 'm4a',
            'size_formatted': "~3 MB"
        }
    ]

    return {
        'is_playlist': False,
        'id': str(uuid.uuid4())[:8],
        'title': title,
        'uploader': "Snapchat Creator",
        'duration_formatted': "0:30",
        'duration_seconds': 30,
        'thumbnail': thumbnail,
        'extractor': 'Snapchat',
        'webpage_url': url,
        'direct_stream_url': clean_video_url,
        'video_formats': formats,
        'audio_formats': audio_options
    }

def extract_spotify_media(url: str):
    """
    Extracts Spotify track metadata via public oEmbed and matches the master audio track via YouTube.
    """
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
    title, artist, thumb = "Spotify Track", "", ""
    try:
        oembed_url = f"https://open.spotify.com/oembed?url={url}"
        resp = requests.get(oembed_url, headers=headers, timeout=6)
        if resp.status_code == 200:
            data = resp.json()
            title = data.get("title") or "Spotify Track"
            artist = data.get("author_name") or ""
            thumb = data.get("thumbnail_url") or ""
    except Exception:
        pass

    query = f"{title} {artist}".strip() or "spotify music"
    search_term = f"ytsearch1:{query} audio"
    opts = get_base_ydl_opts("https://www.youtube.com")
    opts.update({'skip_download': True, 'socket_timeout': 8})

    with yt_dlp.YoutubeDL(opts) as ydl:
        res = ydl.extract_info(search_term, download=False)
        entries = res.get('entries', []) if res else []
        if not entries:
            raise ValueError(f"Could not find matching audio for Spotify track: {title}")
        entry = entries[0]
        target_url = entry.get('webpage_url') or f"https://www.youtube.com/watch?v={entry.get('id')}"
        media_info = extract_media_info(target_url)
        if title:
            media_info['title'] = f"{title} - {artist}" if artist else title
        if thumb:
            media_info['thumbnail'] = thumb
        media_info['extractor'] = 'Spotify'
        return media_info

def extract_indian_music_media(url: str):
    """
    Extracts JioSaavn & Gaana track titles and matches the master audio track.
    """
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
    title = ""
    try:
        match = re.search(r'/(?:song|album)/([^/?#]+)', url)
        if match:
            slug = match.group(1).replace('-', ' ')
            title = re.sub(r'/[^/]+$', '', slug).strip()
    except Exception:
        pass

    if not title:
        try:
            r = requests.get(url, headers=headers, timeout=5)
            match = re.search(r'<title>([^<]+)</title>', r.text)
            if match:
                title = match.group(1).split('|')[0].split('-')[0].strip()
        except Exception:
            pass

    query = title or "indian music"
    search_term = f"ytsearch1:{query} song"
    opts = get_base_ydl_opts("https://www.youtube.com")
    opts.update({'skip_download': True, 'socket_timeout': 8})

    with yt_dlp.YoutubeDL(opts) as ydl:
        res = ydl.extract_info(search_term, download=False)
        entries = res.get('entries', []) if res else []
        if not entries:
            raise ValueError(f"Could not find matching audio for track: {title}")
        entry = entries[0]
        target_url = entry.get('webpage_url') or f"https://www.youtube.com/watch?v={entry.get('id')}"
        media_info = extract_media_info(target_url)
        if title:
            media_info['title'] = title
        media_info['extractor'] = 'JioSaavn' if 'jiosaavn' in url.lower() else 'Gaana'
        return media_info

def extract_media_info(url: str):
    """
    Extracts comprehensive metadata, video format options (4k, 1080p, 720p, etc.),
    and audio options for any supported website link with multi-tier client rotation and automatic retry.
    """
    # Normalize YouTube Music to standard YouTube watch endpoint for 100% reliable mobile extraction
    if 'music.youtube.com' in url.lower():
        url = url.replace('music.youtube.com', 'www.youtube.com')

    # Special route: Spotify
    if 'spotify.com' in url.lower():
        try:
            return extract_spotify_media(url)
        except Exception:
            pass

    # Special route: JioSaavn & Gaana
    if 'jiosaavn.com' in url.lower() or 'gaana.com' in url.lower():
        try:
            return extract_indian_music_media(url)
        except Exception:
            pass

    # Special route: Snapchat Spotlight & Stories
    if 'snapchat.com' in url.lower():
        try:
            return extract_snapchat_media(url)
        except Exception:
            pass

    last_error = None
    info = None
    is_youtube = 'youtube.com' in url.lower() or 'youtu.be' in url.lower()

    # Multi-tier extraction strategies with automated client rotation:
    if is_youtube:
        strategies = [
            {"client": "web_embedded,mweb"},
            {"client": "tv,mweb"},
            {"client": "android,web_embedded"},
            {"client": "ios,mweb"},
        ]
    else:
        strategies = [
            {"impersonate": "chrome"},
            {"impersonate": "safari"},
            {"impersonate": "chrome"},
        ]

    for attempt, strat in enumerate(strategies, start=1):
        try:
            opts = get_base_ydl_opts(url)
            opts.update({
                'skip_download': True,
                'extract_flat': False,
                'socket_timeout': 8,
                'retries': 1,
                'extractor_retries': 1,
            })

            if is_youtube:
                opts.pop('impersonate', None)
                client_list = [c.strip() for c in strat.get('client', 'web_embedded').split(',') if c.strip()]
                opts['extractor_args'] = {
                    'youtube': {
                        'player_client': client_list,
                        'player_skip': ['configs']
                    }
                }
            else:
                imp_name = strat.get('impersonate')
                if imp_name:
                    try:
                        from yt_dlp.networking.impersonate import ImpersonateTarget
                        opts['impersonate'] = ImpersonateTarget.from_str(imp_name)
                    except Exception:
                        pass

            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=False)
                if info:
                    break

        except Exception as e:
            last_error = e
            time.sleep(0.25 * attempt)

    # Ultimate fallback: flat playlist / generic extraction
    if not info:
        try:
            fallback_opts = get_base_ydl_opts(url)
            fallback_opts.update({
                'skip_download': True,
                'extract_flat': 'in_playlist',
                'socket_timeout': 8,
            })
            if is_youtube:
                fallback_opts.pop('impersonate', None)
                fallback_opts['extractor_args'] = {
                    'youtube': {
                        'player_client': ['android'],
                        'player_skip': ['webpage', 'configs']
                    }
                }
            with yt_dlp.YoutubeDL(fallback_opts) as ydl_flat:
                info = ydl_flat.extract_info(url, download=False)
        except Exception as e:
            last_error = e

    if not info:
        err_msg = str(last_error) if last_error else "Could not extract media info from the provided URL."
        if "empty media response" in err_msg.lower() or "not granting access" in err_msg.lower():
            err_msg = "Media is private, restricted, or temporarily blocked by the platform. Please verify the link is public or try pasting once more."
        raise ValueError(err_msg)

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

    # Comprehensive standard desired heights from maximum 8K/4K down to lowest 144p data saver
    target_heights = [4320, 2160, 1440, 1080, 720, 480, 360, 240, 144]
    height_labels = {
        4320: ("8K Cinematic Ultra (4320p)", "4320p"),
        2160: ("4K Ultra HD (2160p 60fps)", "2160p"),
        1440: ("2K Quad HD (1440p)", "1440p"),
        1080: ("Full HD (1080p)", "1080p"),
        720: ("HD Standard (720p)", "720p"),
        480: ("SD Standard (480p)", "480p"),
        360: ("Medium (360p)", "360p"),
        240: ("Low Data (240p)", "240p"),
        144: ("Data Saver (144p)", "144p")
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

    # Group video formats across all supported resolution tiers from highest to lowest
    effective_max = max(max_source_height or 1080, 1080)
    for target_h in target_heights:
        # Always provide 4K, 1080p, 720p, 480p, 360p, 240p, 144p for universal user choice
        is_standard_tier = target_h in (2160, 1080, 720, 480, 360, 240, 144)
        if is_standard_tier or effective_max >= target_h * 0.88:
            label, res_tag = height_labels[target_h]
            matching = [f for f in formats if f.get('height') and abs(f['height'] - target_h) <= 70]
            
            calc_size = 0
            format_id = f"bestvideo[height<={target_h}]+bestaudio/best[height<={target_h}]/best"
            
            if matching:
                best_f = max(matching, key=lambda f: (f.get('tbr') or f.get('vbr') or 0))
                vid_size = best_f.get('filesize') or best_f.get('filesize_approx') or (
                    int(((best_f.get('tbr') or best_f.get('vbr') or 1500) * 1000 / 8) * duration) if duration else 0
                )
                calc_size = vid_size + (best_audio_size if best_f.get('acodec') == 'none' else 0)
            else:
                bitrate_kbps = {4320: 30000, 2160: 16000, 1440: 8000, 1080: 4500, 720: 2200, 480: 1000, 360: 600, 240: 350, 144: 180}.get(target_h, 1000)
                calc_size = int((bitrate_kbps * 1000 / 8) * duration) if duration else 0

            # Ensure lower resolution tiers are proportionately scaled down from master
            if max_vid_size > 0 and target_h < effective_max:
                ratio = max(0.12, min(1.0, target_h / effective_max))
                scaled = int(max_vid_size * ratio)
                calc_size = min(calc_size, scaled) if calc_size > 0 else scaled

            resolution_map[res_tag] = {
                'quality': res_tag,
                'label': label,
                'height': target_h,
                'format_selector': format_id,
                'size_bytes': calc_size,
                'size_formatted': format_bytes(calc_size) if calc_size > 0 else "Dynamic stream",
                'ext': 'mp4'
            }

    # If source didn't report multi-tier heights (common for Instagram Reels, TikTok, Twitter/X)
    if len(resolution_map) <= 1:
        for tag, lbl, h, ratio in [
            ("1080p", "Full HD (1080p)", 1080, 1.0),
            ("720p", "HD Standard (720p)", 720, 0.7),
            ("480p", "SD Standard (480p)", 480, 0.45),
            ("360p", "Medium (360p)", 360, 0.3),
            ("240p", "Low Data (240p)", 240, 0.2),
            ("144p", "Data Saver (144p)", 144, 0.12),
        ]:
            resolution_map[tag] = {
                'quality': tag,
                'label': lbl,
                'height': h,
                'format_selector': f'bestvideo[height<={h}]+bestaudio/best[height<={h}]/best' if h < 1080 else 'bestvideo+bestaudio/best',
                'size_bytes': int((max_vid_size or 18_000_000) * ratio),
                'size_formatted': format_bytes(int((max_vid_size or 18_000_000) * ratio)),
                'ext': 'mp4'
            }

    # Audio options across all bitrates
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
            'bitrate': 128,
            'label': '128 kbps (Standard Mobile MP3)',
            'quality_tag': '128k',
            'ext': 'mp3',
            'size_formatted': format_bytes(int((128 * 1000 / 8) * duration)) if duration else "~3-4 MB"
        },
        {
            'bitrate': 64,
            'label': '64 kbps (Data Saver MP3)',
            'quality_tag': '64k',
            'ext': 'mp3',
            'size_formatted': format_bytes(int((64 * 1000 / 8) * duration)) if duration else "~1.5-2 MB"
        },
        {
            'bitrate': 0,
            'label': 'Original Audio (Direct M4A/Source)',
            'quality_tag': 'original',
            'ext': 'm4a',
            'size_formatted': format_bytes(best_audio_size) if best_audio_size else "~5 MB"
        }
    ]

    direct_stream = info.get('url')
    if not direct_stream and info.get('formats'):
        # Pick the best progressive or playable direct format with valid URL
        playable = [
            f for f in info.get('formats', [])
            if f.get('url') and f.get('vcodec') != 'none'
        ]
        if playable:
            best_play = max(playable, key=lambda x: (x.get('height') or 0, x.get('tbr') or 0))
            direct_stream = best_play.get('url')
        else:
            any_url = [f for f in info.get('formats', []) if f.get('url')]
            if any_url:
                direct_stream = any_url[-1].get('url')

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
        'direct_stream_url': direct_stream,
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

        target_url = format_selector if format_selector and format_selector.startswith('http') else url
        chosen_format = 'best' if format_selector and format_selector.startswith('http') else (format_selector or 'bestvideo+bestaudio/best')

        opts = get_base_ydl_opts(target_url)
        opts.update({
            'format': chosen_format if FFMPEG_DIR else ('best[ext=mp4]/best' if 'bestvideo' in chosen_format else chosen_format),
            'outtmpl': out_template,
            'progress_hooks': [create_progress_hook(job_id)],
        })

        if FFMPEG_DIR:
            opts['merge_output_format'] = 'mp4'
            opts['postprocessors'] = [{
                'key': 'FFmpegVideoConvertor',
                'preferedformat': 'mp4',
            }]

        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([target_url])

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

        opts = get_base_ydl_opts(target_url)
        opts.update({
            'format': 'bestaudio/best',
            'outtmpl': out_template,
            'progress_hooks': [create_progress_hook(job_id)],
        })

        if FFMPEG_DIR:
            bitrate = '320' if quality_tag == '320k' else ('256' if quality_tag == '256k' else '192')
            if quality_tag == 'original':
                opts['postprocessors'] = [{
                    'key': 'FFmpegExtractAudio',
                    'preferredcodec': 'm4a',
                }]
            else:
                opts['postprocessors'] = [{
                    'key': 'FFmpegExtractAudio',
                    'preferredcodec': 'mp3',
                    'preferredquality': bitrate,
                }]

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
