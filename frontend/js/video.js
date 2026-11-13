/**
 * EVERYTHING FREE — Video Downloader Module
 * Handles video analysis, format tiers (4K, 1080p, etc.), smooth scroll to progress,
 * and the dynamic 3D celestial planet morphing animation engine.
 */

const VideoDownloader = {
  currentMedia: null,
  activePollInterval: null,
  currentJobId: null,
  isPaused: false,

  async analyze() {
    const input = document.getElementById('video-url-input');
    const url = input.value.trim();
    if (!url) {
      App.showToast("Paste a video link to begin.");
      return;
    }

    const btn = document.getElementById('btn-analyze-video');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> ANALYZING...`;

    const resultCard = document.getElementById('video-result-card');
    resultCard.style.display = 'none';

    try {
      let res = await fetch(`${window.API_BASE || ''}/api/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });

      // Automated client-side retry if first attempt encountered a platform handshake
      if (!res.ok) {
        await new Promise(r => setTimeout(r, 600));
        res = await fetch(`${window.API_BASE || ''}/api/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url })
        });
      }

      const data = await res.json();
      if (!res.ok) {
        throw new Error(App.parseError(data, "Failed to analyze URL. Please paste again if platform was warming up."));
      }

      if (data.is_playlist) {
        App.showToast("Playlist detected! Routing to Playlist Studio...");
        document.getElementById('playlist-url-input').value = url;
        App.switchTab('playlist');
        PlaylistStudio.analyze();
        return;
      }

      this.currentMedia = data;
      this.renderMedia(data);

      // Smooth scroll to media result card
      setTimeout(() => {
        resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);

    } catch (err) {
      App.showToast(`Error: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  },

  renderMedia(media) {
    const card = document.getElementById('video-result-card');

    document.getElementById('video-thumb').src = media.thumbnail || 'https://via.placeholder.com/640x360?text=No+Preview';
    document.getElementById('video-duration').textContent = media.duration_formatted;
    document.getElementById('video-platform').textContent = `${media.extractor || 'WEB'} // 60FPS MUX`;
    document.getElementById('video-title').textContent = media.title;
    document.getElementById('video-uploader').textContent = media.uploader;

    const grid = document.getElementById('video-formats-grid');
    grid.innerHTML = '';

    if (media.direct_stream_url) {
      const directEl = document.createElement('div');
      directEl.className = 'format-card highlight';
      directEl.innerHTML = `
        <div>
          <div class="format-badge-row">
            <span class="res-badge" style="background:#00e5ff; color:#050406;">DIRECT</span>
            <span class="format-ext">MP4</span>
          </div>
          <div class="format-label">Instant Stream (Direct Mobile Save)</div>
          <div class="format-size">Direct CDN Link • 1-Click Download</div>
        </div>
        <a class="btn-download-format" href="${media.direct_stream_url}" target="_blank" download="${(media.title || 'video').replace(/\"/g, '')}.mp4" style="text-decoration:none; display:inline-flex; align-items:center; justify-content:center; gap:0.4rem; background:#00e5ff; color:#050406; font-weight:800;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          DIRECT SAVE
        </a>
      `;
      grid.appendChild(directEl);
    }

    const formats = media.video_formats || [];
    formats.forEach((f, idx) => {
      const isHighRes = f.height >= 1080;
      const el = document.createElement('div');
      el.className = `format-card ${isHighRes ? 'highlight' : ''}`;

      el.innerHTML = `
        <div>
          <div class="format-badge-row">
            <span class="res-badge">${f.quality}</span>
            <span class="format-ext">${f.ext}</span>
          </div>
          <div class="format-label">${f.label}</div>
          <div class="format-size">EST. DATA: ${f.size_formatted}</div>
        </div>
        <button class="btn-download-format" onclick="VideoDownloader.startDownloadByIndex(${idx})">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          DOWNLOAD ${f.quality}
        </button>
      `;
      grid.appendChild(el);
    });

    // Also include High-Res Audio MP3 card
    const audioCard = document.createElement('div');
    audioCard.className = 'format-card';
    audioCard.innerHTML = `
      <div>
        <div class="format-badge-row">
          <span class="res-badge">320K MP3</span>
          <span class="format-ext">AUDIO</span>
        </div>
        <div class="format-label">Master Audio Track</div>
        <div class="format-size">High-Res Stream (~8-12 MB)</div>
      </div>
      <button class="btn-download-format" onclick="AudioHub.downloadFromUrl('${media.webpage_url}', '320k', '${encodeURIComponent(media.title)}')">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
        EXTRACT MP3
      </button>
    `;
    grid.appendChild(audioCard);

    card.style.display = 'block';
  },

  startDownloadByIndex(idx) {
    if (!this.currentMedia || !this.currentMedia.video_formats || !this.currentMedia.video_formats[idx]) return;
    const f = this.currentMedia.video_formats[idx];
    this.startDownload(f.format_selector, f.quality, f.ext || 'mp4');
  },

  async startDownload(formatSelector, qualityTag, ext = 'mp4') {
    if (!this.currentMedia) return;

    const progressPanel = document.getElementById('video-download-progress');
    progressPanel.style.display = 'block';

    setTimeout(() => {
      progressPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);

    const statusBadge = document.getElementById('video-progress-status');
    const pctLabel = document.getElementById('video-progress-pct');
    const barFill = document.getElementById('video-progress-fill');
    const speedLabel = document.getElementById('video-progress-speed');
    const metaLabel = document.getElementById('video-progress-meta');

    statusBadge.textContent = 'CONNECTING';
    pctLabel.textContent = '10%';
    barFill.style.width = '10%';
    speedLabel.textContent = `Preparing ${qualityTag} stream...`;
    metaLabel.textContent = 'Connecting direct media pipeline...';
    this.updatePlanetStage('video-planet-sphere', 'video-planet-name', 10);

    const downloadQuery = new URLSearchParams({
      url: this.currentMedia.webpage_url,
      title: this.currentMedia.title || 'video',
      format_selector: formatSelector || 'best',
      ext: ext,
      direct_url: this.currentMedia.direct_stream_url || ''
    }).toString();
    const directDownloadUrl = `/api/download?${downloadQuery}`;

    try {
      const res = await fetch(`/api/download/video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: this.currentMedia.webpage_url,
          format_selector: formatSelector,
          title: this.currentMedia.title
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(App.parseError(data, "Download initialization failed."));

      if (data.status === 'ready' || data.download_url) {
        const finalUrl = data.download_url || directDownloadUrl;
        barFill.style.width = '100%';
        pctLabel.textContent = '100%';
        statusBadge.textContent = 'COMPLETE';
        statusBadge.style.color = '#ff2a4b';
        speedLabel.textContent = 'File ready! Saving directly to your device...';
        metaLabel.innerHTML = `
          <a href="${finalUrl}" class="btn-job-action" style="text-decoration:none; display:inline-flex; align-items:center; gap:0.4rem; padding: 0.6rem 1.2rem; background:#ff2a4b; color:#050406; font-weight:800; border-radius:4px;" download>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            TAP TO SAVE ${qualityTag} MP4
          </a>
        `;
        this.updatePlanetStage('video-planet-sphere', 'video-planet-name', 100);

        const a = document.createElement('a');
        a.href = finalUrl;
        a.download = `${(this.currentMedia.title || 'video').replace(/[/\\?%*:|"<>]/g, '')}.mp4`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        App.showToast("✓ Download started! Check your browser downloads.");
        return;
      }

      this.pollProgress(data.job_id);
    } catch (err) {
      barFill.style.width = '100%';
      pctLabel.textContent = '100%';
      statusBadge.textContent = 'STREAM READY';
      speedLabel.textContent = 'Direct download started!';
      metaLabel.innerHTML = `
        <a href="${directDownloadUrl}" class="btn-job-action" style="text-decoration:none; display:inline-flex; align-items:center; gap:0.4rem; padding: 0.6rem 1.2rem; background:#00e5ff; color:#050406; font-weight:800; border-radius:4px;" download>
          TAP TO DOWNLOAD MP4
        </a>
      `;
      window.location.href = directDownloadUrl;
      App.showToast("⚡ Streaming directly to your device...");
    }
  },

  updatePlanetStage(sphereId, nameId, pct) {
    const sphere = document.getElementById(sphereId);
    const nameBadge = document.getElementById(nameId);
    if (!sphere || !nameBadge) return;

    sphere.className = 'planet-sphere';

    if (pct < 25) {
      sphere.classList.add('stage-moon');
      nameBadge.textContent = 'PHOBOS // SECTOR 1';
    } else if (pct < 50) {
      sphere.classList.add('stage-mars');
      nameBadge.textContent = 'MARS // CRIMSON CORE';
    } else if (pct < 75) {
      sphere.classList.add('stage-jupiter');
      nameBadge.textContent = 'JUPITER // GAS STORM';
    } else if (pct < 100) {
      sphere.classList.add('stage-saturn');
      nameBadge.textContent = 'TITAN // RINGS REACHED';
    } else {
      sphere.classList.add('stage-complete');
      nameBadge.textContent = 'SUPERNOVA // ARCHIVED';
    }
  },

  async togglePause() {
    if (!this.currentJobId) return;

    const pauseBtn = document.getElementById('video-btn-pause');
    const sphere = document.getElementById('video-planet-sphere');
    const barFill = document.getElementById('video-progress-fill');
    const statusBadge = document.getElementById('video-progress-status');
    const speedLabel = document.getElementById('video-progress-speed');

    try {
      if (this.isPaused) {
        await fetch(`${window.API_BASE || ''}/api/job/${this.currentJobId}/resume`, { method: 'POST' });
        this.isPaused = false;
        if (pauseBtn) {
          pauseBtn.classList.remove('paused');
          pauseBtn.querySelector('.icon-pause').style.display = 'inline';
          pauseBtn.querySelector('.icon-play').style.display = 'none';
          pauseBtn.querySelector('.btn-text').textContent = 'PAUSE';
        }
        if (sphere) sphere.classList.remove('is-paused');
        if (barFill) barFill.classList.remove('is-paused');
        if (statusBadge) statusBadge.textContent = 'DOWNLOADING';
        if (speedLabel) speedLabel.textContent = 'Resuming stream...';
        App.showToast("▶ Download resumed");
      } else {
        await fetch(`${window.API_BASE || ''}/api/job/${this.currentJobId}/pause`, { method: 'POST' });
        this.isPaused = true;
        if (pauseBtn) {
          pauseBtn.classList.add('paused');
          pauseBtn.querySelector('.icon-pause').style.display = 'none';
          pauseBtn.querySelector('.icon-play').style.display = 'inline';
          pauseBtn.querySelector('.btn-text').textContent = 'RESUME';
        }
        if (sphere) sphere.classList.add('is-paused');
        if (barFill) barFill.classList.add('is-paused');
        if (statusBadge) statusBadge.textContent = 'PAUSED';
        if (speedLabel) speedLabel.textContent = 'Download Paused';
        App.showToast("⏸ Download paused");
      }
    } catch (err) {
      console.warn("Toggle pause failed:", err);
    }
  },

  async cancel() {
    if (!this.currentJobId) return;
    try {
      await fetch(`${window.API_BASE || ''}/api/job/${this.currentJobId}/cancel`, { method: 'POST' });
      if (this.activePollInterval) clearInterval(this.activePollInterval);

      const statusBadge = document.getElementById('video-progress-status');
      const speedLabel = document.getElementById('video-progress-speed');
      const sphere = document.getElementById('video-planet-sphere');
      const barFill = document.getElementById('video-progress-fill');

      if (statusBadge) statusBadge.textContent = 'CANCELLED';
      if (speedLabel) speedLabel.textContent = 'Download cancelled by user';
      if (sphere) sphere.classList.remove('is-paused');
      if (barFill) barFill.classList.remove('is-paused');

      App.showToast("Download cancelled.");
      setTimeout(() => {
        const progressPanel = document.getElementById('video-download-progress');
        if (progressPanel) progressPanel.style.display = 'none';
        this.currentJobId = null;
        this.isPaused = false;
      }, 1500);
    } catch (err) {
      console.warn("Cancel failed:", err);
    }
  },

  pollProgress(jobId) {
    this.currentJobId = jobId;
    this.isPaused = false;

    // Reset pause/cancel button state
    const pauseBtn = document.getElementById('video-btn-pause');
    const cancelBtn = document.getElementById('video-btn-cancel');
    if (pauseBtn) {
      pauseBtn.style.display = 'inline-flex';
      pauseBtn.classList.remove('paused');
      pauseBtn.querySelector('.icon-pause').style.display = 'inline';
      pauseBtn.querySelector('.icon-play').style.display = 'none';
      pauseBtn.querySelector('.btn-text').textContent = 'PAUSE';
    }
    if (cancelBtn) {
      cancelBtn.style.display = 'inline-flex';
    }

    const sphere = document.getElementById('video-planet-sphere');
    const barFill = document.getElementById('video-progress-fill');
    if (sphere) sphere.classList.remove('is-paused');
    if (barFill) barFill.classList.remove('is-paused');

    if (this.activePollInterval) clearInterval(this.activePollInterval);

    const statusBadge = document.getElementById('video-progress-status');
    const pctLabel = document.getElementById('video-progress-pct');
    const speedLabel = document.getElementById('video-progress-speed');
    const metaLabel = document.getElementById('video-progress-meta');

    this.activePollInterval = setInterval(async () => {
      try {
        const res = await fetch(`${window.API_BASE || ''}/api/progress/${jobId}`);
        if (!res.ok) return;

        const info = await res.json();
        const pct = info.progress || 0;

        barFill.style.width = `${Math.max(pct, 2)}%`;
        pctLabel.textContent = `${pct}%`;

        // Update celestial planet morph
        this.updatePlanetStage('video-planet-sphere', 'video-planet-name', pct);

        if (info.status === 'paused' || this.isPaused) {
          this.isPaused = true;
          statusBadge.textContent = 'PAUSED';
          speedLabel.textContent = 'Download Paused';
          if (pauseBtn && !pauseBtn.classList.contains('paused')) {
            pauseBtn.classList.add('paused');
            pauseBtn.querySelector('.icon-pause').style.display = 'none';
            pauseBtn.querySelector('.icon-play').style.display = 'inline';
            pauseBtn.querySelector('.btn-text').textContent = 'RESUME';
          }
          if (sphere) sphere.classList.add('is-paused');
          if (barFill) barFill.classList.add('is-paused');
        } else if (info.status === 'downloading') {
          statusBadge.textContent = 'STREAMING RAW';
          speedLabel.textContent = info.speed_str || 'Streaming...';
          metaLabel.textContent = `${info.downloaded_str} of ${info.total_str} • ${info.eta_str}`;
          if (pauseBtn && pauseBtn.classList.contains('paused')) {
            pauseBtn.classList.remove('paused');
            pauseBtn.querySelector('.icon-pause').style.display = 'inline';
            pauseBtn.querySelector('.icon-play').style.display = 'none';
            pauseBtn.querySelector('.btn-text').textContent = 'PAUSE';
          }
          if (sphere) sphere.classList.remove('is-paused');
          if (barFill) barFill.classList.remove('is-paused');
        } else if (info.status === 'cancelled') {
          clearInterval(this.activePollInterval);
          statusBadge.textContent = 'CANCELLED';
          speedLabel.textContent = 'Cancelled by user';
          if (pauseBtn) pauseBtn.style.display = 'none';
          if (cancelBtn) cancelBtn.style.display = 'none';
        } else if (info.status === 'processing') {
          statusBadge.textContent = 'FFMPEG MUXING';
          speedLabel.textContent = 'Merging video and audio streams...';
          metaLabel.textContent = 'Encoding MP4 container';
        } else if (info.status === 'ready') {
          clearInterval(this.activePollInterval);
          statusBadge.textContent = 'COMPLETE';
          statusBadge.style.color = '#ff2a4b';
          barFill.style.width = '100%';
          pctLabel.textContent = '100%';
          speedLabel.textContent = 'Master MP4 ready! Saving to your device...';
          metaLabel.innerHTML = `
            <a href="${window.API_BASE || ''}/api/download-file/${jobId}" class="btn-job-action" style="text-decoration:none; display:inline-flex; align-items:center; gap:0.4rem; padding: 0.45rem 0.9rem; background:#ff2a4b; color:#050406; font-weight:800;" download="${info.filename || 'video.mp4'}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
              TAP TO SAVE MP4
            </a>
          `;

          if (pauseBtn) pauseBtn.style.display = 'none';
          if (cancelBtn) cancelBtn.style.display = 'none';

          this.updatePlanetStage('video-planet-sphere', 'video-planet-name', 100);

          // Direct browser download via anchor element
          const dlLink = document.createElement('a');
          dlLink.href = `${window.API_BASE || ''}/api/download-file/${jobId}`;
          dlLink.download = info.filename || 'video.mp4';
          dlLink.target = '_blank';
          document.body.appendChild(dlLink);
          dlLink.click();
          document.body.removeChild(dlLink);
          App.showToast("✓ File extracted and saved to your device!");
        } else if (info.status === 'error') {
          clearInterval(this.activePollInterval);
          statusBadge.textContent = 'FAILED';
          statusBadge.style.color = '#ff2a4b';
          const errStr = App.parseError(info.error, 'Extraction failed.');
          speedLabel.textContent = errStr;
          if (pauseBtn) pauseBtn.style.display = 'none';
          if (cancelBtn) cancelBtn.style.display = 'none';
          App.showToast(`Error: ${errStr}`);
        }
      } catch (err) {
        console.warn('Progress poll error:', err);
      }
    }, 1000);
  }
};
