import re
import yt_dlp
from backend.downloader import get_base_ydl_opts, format_duration

URL_REGEX = re.compile(
    r'^(?:http|ftp)s?://' # http:// or https://
    r'(?:(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+(?:[A-Z]{2,6}\.?|[A-Z0-9-]{2,}\.?)|' # domain...
    r'localhost|' # localhost...
    r'\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})' # ...or ip
    r'(?::\d+)?' # optional port
    r'(?:/?|[/?]\S+)$', re.IGNORECASE
)

def is_url(text: str) -> bool:
    return bool(URL_REGEX.match(text.strip()))

def format_views(view_count):
    if not view_count:
        return ""
    if view_count >= 1_000_000_000:
        return f"{view_count / 1_000_000_000:.1f}B views"
    if view_count >= 1_000_000:
        return f"{view_count / 1_000_000:.1f}M views"
    if view_count >= 1_000:
        return f"{view_count / 1_000:.1f}K views"
    return f"{view_count} views"

def search_songs(query: str, limit: int = 8):
    """
    Directly searches famous songs and audio tracks across YouTube/music libraries.
    Returns rich card metadata for instant download.
    """
    query = query.strip()
    if not query:
        return []

    opts = get_base_ydl_opts("https://www.youtube.com")
    opts.update({
        'skip_download': True,
        'extract_flat': 'in_playlist',
    })

    search_term = f"ytsearch{limit}:{query}"

    with yt_dlp.YoutubeDL(opts) as ydl:
        try:
            res = ydl.extract_info(search_term, download=False)
        except Exception as e:
            raise ValueError(f"Search failed: {str(e)}")

    entries = res.get('entries', []) if res else []
    results = []

    for entry in entries:
        if not entry:
            continue
        
        video_id = entry.get('id', '')
        title = entry.get('title', 'Unknown Track')
        uploader = entry.get('uploader') or entry.get('channel', 'Unknown Artist')
        duration = entry.get('duration', 0)
        
        # Best thumbnail
        thumb = entry.get('thumbnail')
        if not thumb and entry.get('thumbnails'):
            thumb = entry['thumbnails'][-1].get('url')
        if not thumb and video_id:
            thumb = f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"

        direct_url = entry.get('url') or f"https://www.youtube.com/watch?v={video_id}"

        results.append({
            'id': video_id,
            'title': title,
            'artist': uploader,
            'duration_formatted': format_duration(duration),
            'duration_seconds': duration,
            'thumbnail': thumb,
            'views': format_views(entry.get('view_count')),
            'url': direct_url
        })

    return results
