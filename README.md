# EVERYTHING FREE — Universal Media & Audio Extraction Studio

> Dark, brutalist, high-contrast media and audio extraction suite inspired by **Artem Militonian** ([war.artmilitonian.com](https://war.artmilitonian.com/)).

Built with **Python 3.12**, **FastAPI**, **yt-dlp**, and **FFmpeg 9.0**.

---

## ✨ Features & Architecture

- **🔴 Artem Militonian Cinematic Aesthetic**:
  - Deep obsidian void (`#050406`), high-voltage warning scarlet/crimson (`#ff2a4b`), scanlines, atmospheric particle embers canvas, and bold brutalist typography (`Syne`, `Space Grotesk`, `Space Mono`).
  - **Animated Laser Search Bar**: Pulsing scanning laser border across inputs during focus and analysis.
  - **Interactive Stream Controls**: Dedicated **Pause**, **Resume**, and **Cancel** buttons in all download views (Video, Audio, and Playlist Batch) with real-time stream chunk freezing and animated celestial sphere pausing.
  - **Dynamic Celestial 3D Planet Engine**: Real-time rotating planetary sphere with orbital rings that morphs through celestial bodies as progress increases:
    * `0% - 25%`: **Phobos / Moon** (Craters, cold monochrome orbit)
    * `26% - 50%`: **Mars / Crimson Core** (Volcanic terrain, red dust atmosphere)
    * `51% - 75%`: **Jupiter / Gas Giant** (Banded atmospheric storm)
    * `76% - 99%`: **Titan / Ringed Saturn** (Luminous orbital rings)
    * `100%`: **Supernova / Corona Complete** (Blinding pulse, auto-saved to disk!)
  - **Smooth Scroll-to-Progress**: Automatic smooth scrolling to download progress upon initiating any stream capture.

- **🎥 4K 60FPS Raw Mux (Video Downloader)**:
  - Supports YouTube, Instagram Reels, Twitter/X, TikTok, Reddit, Snapchat, Facebook, Vimeo, and 1,000+ streaming sites.
  - Resolutions: **4K Ultra HD (2160p), 1440p (2K), 1080p Full HD, 720p HD, 480p, 360p**.
  - Dynamic byte calculation for exact data usage before downloading.

- **🎵 320k Master Audio (Song & Audio Hub)**:
  - Dual-mode: Search any song or artist directly, OR paste any direct music video link.
  - Transcodes to 320 kbps Master MP3 with embedded Mutagen ID3 album artwork and metadata.

- **📑 Interactive Playlist Culling (Batch Studio)**:
  - Load full playlists from YouTube, SoundCloud, etc.
  - Interactive checkboxes on every track: select all, deselect all, remove unwanted songs.
  - Dynamic counter & total estimated MB calculation.
  - 1-Click ZIP Archive export containing all selected tracks.

- **🛡️ Zero Trace Storage & Zero Sign-In**:
  - No user accounts, logins, or tracking cookies.
  - Zero server-side retention; streams directly into your device download directory.

---

## 🚀 How to Run

### Method 1: Double Click (Windows)
Double click `start.bat` in the project root directory.

### Method 2: Command Line
```bash
python run.py
```
Open your browser at:
👉 **`http://localhost:8000`**
