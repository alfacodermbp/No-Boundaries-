/**
 * EVERYTHING FREE — Audio & Song Hub
 * Dual-action search + direct URL audio extraction, 320kbps MP3 transcoding,
 * smooth scroll to progress, and dynamic 3D celestial planet morphing.
 */

const AudioHub = {
  activePollInterval: null,
  currentMedia: null,
  currentJobId: null,
  isPaused: false,

  init() {
    const input = document.getElementById('audio-search-input');
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          this.searchOrAnalyze();
        }
      });
    }

    // Setup suggestion chip clicks
    document.querySelectorAll('.chip-btn').forEach(chip => {
      chip.addEventListener('click', () => {
        const query = chip.dataset.query;
        if (query) {
          input.value = query;
          this.searchOrAnalyze();
        }
      });
    });
  },

  async searchOrAnalyze() {
    const input = document.getElementById('audio-search-input');
    const query = input.value.trim();
    if (!query) {
      App.showToast("Enter a song name or paste a link.");
      return;
    }

    const btn = document.getElementById('btn-search-audio');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> SEARCHING...`;

    const resultsContainer = document.getElementById('audio-results-container');
    const directCard = document.getElementById('audio-direct-card');
    resultsContainer.innerHTML = '';
    directCard.style.display = 'none';

    try {
      let res = await fetch(`${window.API_BASE || ''}/api/search?q=${encodeURIComponent(query)}`);
      if (!res.ok && query.startsWith('http')) {
        await new Promise(r => setTimeout(r, 600));
        res = await fetch(`${window.API_BASE || ''}/api/search?q=${encodeURIComponent(query)}`);
      }
      const data = await res.json();

      if (!res.ok) {
        throw new Error(App.parseError(data, "Search request failed."));
      }

      if (data.type === 'direct_url') {
        this.renderDirectAudio(data.data);
        setTimeout(() => {
          directCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
      } else {
        this.renderSearchResults(data.results || [], query);
        setTimeout(() => {
          resultsContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
      }
    } catch (err) {
      App.showToast(`Notice: ${err.message}`);
      resultsContainer.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 2.5rem 1rem; color: var(--text-muted);">
          <p style="font-family: var(--font-display); font-size: 1.2rem; color: #ffffff; margin-bottom: 0.5rem;">TRACK NOT FOUND IN CATALOG</p>
          <p style="font-family: var(--font-mono); font-size: 0.82rem; color: var(--crimson-core);">
            Paste the direct YouTube / SoundCloud music video link above for immediate unchained extraction.
          </p>
        </div>
      `;
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  },

  renderSearchResults(results, query) {
    const container = document.getElementById('audio-results-container');
    container.innerHTML = '';

    if (!results || results.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 2.5rem 1rem; color: var(--text-muted);">
          <p style="font-family: var(--font-display); font-size: 1.2rem; color: #ffffff; margin-bottom: 0.5rem;">NO DIRECT MATCHES FOR "${query.toUpperCase()}"</p>
          <p style="font-family: var(--font-mono); font-size: 0.82rem; color: var(--crimson-core);">
            Try adding the artist name or paste the exact media URL above.
          </p>
        </div>
      `;
      return;
    }

    results.forEach(item => {
      const card = document.createElement('div');
      card.className = 'song-card';
      card.innerHTML = `
        <img class="song-thumb" src="${item.thumbnail}" alt="" onerror="this.src='https://via.placeholder.com/62?text=Audio'">
        <div class="song-details">
          <div class="song-title" title="${item.title}">${item.title}</div>
          <div class="song-artist" title="${item.artist}">${item.artist}</div>
          <div class="song-meta-pill">${item.duration_formatted} ${item.views ? '• ' + item.views : ''}</div>
        </div>
        <button class="song-action-btn" onclick="AudioHub.downloadFromUrl('${item.url}', '320k', '${encodeURIComponent(item.title)}', '${encodeURIComponent(item.artist)}', '${encodeURIComponent(item.thumbnail)}')">
          ⚡ 320k MP3
        </button>
      `;
      container.appendChild(card);
    });
  },

  renderDirectAudio(media) {
    this.currentMedia = media;
    const card = document.getElementById('audio-direct-card');

    document.getElementById('audio-thumb').src = media.thumbnail || 'https://via.placeholder.com/640x360?text=Audio';
    document.getElementById('audio-duration').textContent = media.duration_formatted;
    document.getElementById('audio-title').textContent = media.title;
    document.getElementById('audio-uploader').textContent = media.uploader;

    const grid = document.getElementById('audio-formats-grid');
    grid.innerHTML = '';

    if (media.direct_stream_url) {
      const directEl = document.createElement('div');
      directEl.className = 'format-card highlight';
      directEl.innerHTML = `
        <div>
          <div class="format-badge-row">
            <span class="res-badge" style="background:#00e5ff; color:#050406;">DIRECT</span>
            <span class="format-ext">SOURCE</span>
          </div>
          <div class="format-label">Direct Media Source (Mobile Instant Save)</div>
          <div class="format-size">Direct CDN Link • 1-Click Download</div>
        </div>
        <a class="btn-download-format" href="${media.direct_stream_url}" target="_blank" download="${(media.title || 'track').replace(/\"/g, '')}.mp4" style="text-decoration:none; display:inline-flex; align-items:center; justify-content:center; gap:0.4rem; background:#00e5ff; color:#050406; font-weight:800;">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          DIRECT SAVE
        </a>
      `;
      grid.appendChild(directEl);
    }

    const audioFormats = media.audio_formats || [];
    audioFormats.forEach((af, idx) => {
      const isMaster = af.bitrate === 320;
      const el = document.createElement('div');
      el.className = `format-card ${isMaster ? 'highlight' : ''}`;
      el.innerHTML = `
        <div>
          <div class="format-badge-row">
            <span class="res-badge">${af.ext.toUpperCase()}</span>
            <span class="format-ext">${af.quality_tag}</span>
          </div>
          <div class="format-label">${af.label}</div>
          <div class="format-size">EST. SIZE: ${af.size_formatted}</div>
        </div>
        <button class="btn-download-format" onclick="AudioHub.downloadByIndex(${idx})">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          DOWNLOAD ${af.quality_tag.toUpperCase()}
        </button>
      `;
      grid.appendChild(el);
    });

    card.style.display = 'block';
  },

  downloadByIndex(idx) {
    if (!this.currentMedia || !this.currentMedia.audio_formats || !this.currentMedia.audio_formats[idx]) return;
    const af = this.currentMedia.audio_formats[idx];

    // If Render backend is not connected, use direct mobile stream to avoid serverless freeze
    if (!window.API_BASE && this.currentMedia.direct_stream_url) {
      App.showToast(`⚡ Direct mobile stream started for ${af.label}...`);
      const a = document.createElement('a');
      a.href = this.currentMedia.direct_stream_url;
      a.download = `${(this.currentMedia.title || 'audio').replace(/[/\\?%*:|"<>]/g, '')}.${af.ext === 'mp3' ? 'mp4' : af.ext}`;
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    }

    this.downloadFromUrl(
      this.currentMedia.webpage_url,
      af.quality_tag,
      encodeURIComponent(this.currentMedia.title),
      encodeURIComponent(this.currentMedia.uploader),
      encodeURIComponent(this.currentMedia.thumbnail)
    );
  },

  async downloadFromUrl(url, qualityTag = '320k', encTitle = '', encArtist = '', encThumb = '') {
    const title = decodeURIComponent(encTitle) || "Audio Track";
    const artist = decodeURIComponent(encArtist) || "";
    const thumbnail = decodeURIComponent(encThumb) || "";

    const progressPanel = document.getElementById('audio-download-progress');
    progressPanel.style.display = 'block';

    // Smooth scroll down to the celestial progress panel
    setTimeout(() => {
      progressPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);

    const statusBadge = document.getElementById('audio-progress-status');
    const pctLabel = document.getElementById('audio-progress-pct');
    const barFill = document.getElementById('audio-progress-fill');
    const speedLabel = document.getElementById('audio-progress-speed');
    const metaLabel = document.getElementById('audio-progress-meta');

    statusBadge.textContent = 'EXTRACTING';
    pctLabel.textContent = '0%';
    barFill.style.width = '2%';
    speedLabel.textContent = `Extracting ${title}...`;
    metaLabel.textContent = `Mastering ${qualityTag.toUpperCase()} high-definition audio...`;
    VideoDownloader.updatePlanetStage('audio-planet-sphere', 'audio-planet-name', 0);

    try {
      const res = await fetch(`${window.API_BASE || ''}/api/download/audio`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          quality_tag: qualityTag,
          title,
          artist,
          thumbnail
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(App.parseError(data, "Audio download failed."));

      this.pollProgress(data.job_id);
    } catch (err) {
      App.showToast(`Error: ${err.message}`);
      progressPanel.style.display = 'none';
    }
  },

  async togglePause() {
    if (!this.currentJobId) return;

    const pauseBtn = document.getElementById('audio-btn-pause');
    const sphere = document.getElementById('audio-planet-sphere');
    const barFill = document.getElementById('audio-progress-fill');
    const statusBadge = document.getElementById('audio-progress-status');
    const speedLabel = document.getElementById('audio-progress-speed');

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
        if (statusBadge) statusBadge.textContent = 'EXTRACTING';
        if (speedLabel) speedLabel.textContent = 'Resuming audio...';
        App.showToast("▶ Audio download resumed");
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
        App.showToast("⏸ Audio download paused");
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

      const statusBadge = document.getElementById('audio-progress-status');
      const speedLabel = document.getElementById('audio-progress-speed');
      const sphere = document.getElementById('audio-planet-sphere');
      const barFill = document.getElementById('audio-progress-fill');

      if (statusBadge) statusBadge.textContent = 'CANCELLED';
      if (speedLabel) speedLabel.textContent = 'Extraction cancelled by user';
      if (sphere) sphere.classList.remove('is-paused');
      if (barFill) barFill.classList.remove('is-paused');

      App.showToast("Audio extraction cancelled.");
      setTimeout(() => {
        const progressPanel = document.getElementById('audio-download-progress');
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
    const pauseBtn = document.getElementById('audio-btn-pause');
    const cancelBtn = document.getElementById('audio-btn-cancel');
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

    const sphere = document.getElementById('audio-planet-sphere');
    const barFill = document.getElementById('audio-progress-fill');
    if (sphere) sphere.classList.remove('is-paused');
    if (barFill) barFill.classList.remove('is-paused');

    if (this.activePollInterval) clearInterval(this.activePollInterval);

    const statusBadge = document.getElementById('audio-progress-status');
    const pctLabel = document.getElementById('audio-progress-pct');
    const speedLabel = document.getElementById('audio-progress-speed');
    const metaLabel = document.getElementById('audio-progress-meta');

    this.activePollInterval = setInterval(async () => {
      try {
        const res = await fetch(`${window.API_BASE || ''}/api/progress/${jobId}`);
        if (!res.ok) return;

        const info = await res.json();
        const pct = info.progress || 0;

        barFill.style.width = `${Math.max(pct, 2)}%`;
        pctLabel.textContent = `${pct}%`;

        VideoDownloader.updatePlanetStage('audio-planet-sphere', 'audio-planet-name', pct);

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
          statusBadge.textContent = 'DOWNLOADING STREAM';
          speedLabel.textContent = info.speed_str || 'Streaming...';
          metaLabel.textContent = `${info.downloaded_str} • ${info.eta_str}`;
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
          statusBadge.textContent = '320K ENCODING';
          speedLabel.textContent = 'Transcoding to 320k MP3 + Embedding Artwork...';
          metaLabel.textContent = 'Applying ID3 tags & Album Cover';
        } else if (info.status === 'ready') {
          clearInterval(this.activePollInterval);
          statusBadge.textContent = 'COMPLETE';
          statusBadge.style.color = '#ff2a4b';
          barFill.style.width = '100%';
          pctLabel.textContent = '100%';
          speedLabel.textContent = 'Master MP3 ready! Saving to your device...';
          const downloadUrl = `${window.API_BASE || ''}/api/download-file/${jobId}`;
          metaLabel.innerHTML = `
            <a href="${downloadUrl}" class="btn-job-action" style="text-decoration:none; display:inline-flex; align-items:center; gap:0.4rem; padding: 0.45rem 0.9rem; background:#ff2a4b; color:#050406; font-weight:800;" download="${info.filename || 'song.mp3'}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
              TAP TO SAVE MP3
            </a>
          `;

          if (pauseBtn) pauseBtn.style.display = 'none';
          if (cancelBtn) cancelBtn.style.display = 'none';

          VideoDownloader.updatePlanetStage('audio-planet-sphere', 'audio-planet-name', 100);

          // Direct browser download
          window.location.href = downloadUrl;
          App.showToast("✓ High-res song downloaded to your device!");
        } else if (info.status === 'error') {
          clearInterval(this.activePollInterval);
          statusBadge.textContent = 'FAILED';
          statusBadge.style.color = '#ff2a4b';
          const errStr = App.parseError(info.error, 'Audio extraction failed.');
          speedLabel.textContent = errStr;
          if (pauseBtn) pauseBtn.style.display = 'none';
          if (cancelBtn) cancelBtn.style.display = 'none';
          App.showToast(`Error: ${errStr}`);
        }
      } catch (err) {
        console.warn('Audio progress poll error:', err);
      }
    }, 1000);
  }
};

document.addEventListener('DOMContentLoaded', () => {
  AudioHub.init();
});
