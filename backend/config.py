import os
import shutil
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DOWNLOADS_DIR = BASE_DIR / "downloads"
TEMP_DIR = BASE_DIR / "temp"
FRONTEND_DIR = BASE_DIR / "frontend"

DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)
TEMP_DIR.mkdir(parents=True, exist_ok=True)

# Detect ffmpeg path
def find_ffmpeg():
    # 1. System PATH
    found = shutil.which("ffmpeg")
    if found:
        return str(Path(found).parent)

    # 2. Known WinGet Gyan.FFmpeg location
    local_app_data = os.environ.get("LOCALAPPDATA", "")
    if local_app_data:
        known_winget_dir = Path(local_app_data) / "Microsoft" / "WinGet" / "Packages" / "Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe" / "ffmpeg-9.0.2-full_build" / "bin"
        if (known_winget_dir / "ffmpeg.exe").exists():
            return str(known_winget_dir)

    # 3. Known standard fallbacks
    for fallback in [
        r"C:\Program Files\ffmpeg\bin",
        r"C:\ffmpeg\bin",
        r"C:\MinGW\bin"
    ]:
        if (Path(fallback) / "ffmpeg.exe").exists():
            return fallback

    return None

FFMPEG_DIR = find_ffmpeg()
if FFMPEG_DIR and FFMPEG_DIR not in os.environ.get("PATH", ""):
    os.environ["PATH"] = FFMPEG_DIR + os.pathsep + os.environ.get("PATH", "")

# Detect Deno JS runtime location for yt-dlp (Windows & Linux)
def find_deno():
    found = shutil.which("deno")
    if found:
        return str(Path(found).parent)
    home_deno = Path.home() / ".deno" / "bin"
    if (home_deno / "deno.exe").exists() or (home_deno / "deno").exists():
        return str(home_deno)
    return None

DENO_DIR = find_deno()
if DENO_DIR and DENO_DIR not in os.environ.get("PATH", ""):
    os.environ["PATH"] = DENO_DIR + os.pathsep + os.environ.get("PATH", "")

# Production Server configuration
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8000"))
