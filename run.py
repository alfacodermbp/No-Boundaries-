import sys
import os
import webbrowser
from pathlib import Path

# Add project root to Python sys.path
BASE_DIR = Path(__file__).resolve().parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from backend.config import FFMPEG_DIR, HOST, PORT

def main():
    print("=" * 65)
    print("           REFINED — HIGH-FIDELITY MEDIA SUITE")
    print("=" * 65)
    print(f"[*] Base Directory : {BASE_DIR}")
    print(f"[*] FFmpeg Binary  : {'Found (' + FFMPEG_DIR + ')' if FFMPEG_DIR else 'Not found (Using fallback)'}")
    print(f"[*] Local URL      : http://localhost:{PORT}")
    print(f"[*] Network URL    : http://127.0.0.1:{PORT}")
    print("=" * 65)
    print("[+] Launching server... Press CTRL+C to stop.")

    import uvicorn
    uvicorn.run("backend.app:app", host=HOST, port=PORT, reload=False)

if __name__ == "__main__":
    main()
