/**
 * EVERYTHING FREE — Audio & Song Hub
 * Dual-action search + direct URL audio extraction, full quality spectrum (320k to 64k),
 * 1-click downloads, smooth scroll to progress, and dynamic 3D celestial planet morphing.
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
        if (query && input) {
          input.value = query;
          this.searchOrAnalyze();
        }
      });
    });
  },

  async searchOrAnalyze() {
    const input = document.getElementById('audio-search-input');
    const query = input ? input.value.trim() : '';
    if (!query) {
      App.showToast("Enter a song name or paste a music link.");
      return;
    }

    const btn = document.getElementById('btn-search-audio');
    const originalText = btn ? btn.innerHTML : 'Search / Fetch';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span class="spinner"></span> SEARCHING...`;
    }

    const resultsContainer = document.getElementById('audio-results-container');
    const directCard = document.getElementById('audio-direct-card');
    if (resultsContainer) resultsContainer.innerHTML = '';
    if (directCard) directCard.style.display = 'none';

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
          if (directCard) directCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
      } else {
        this.renderSearchResults(data.results || [], query);
        setTimeout(() => {
          if (resultsContainer) resultsContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
      }
    } catch (err) {
      App.showToast(`Notice: ${err.message}`);
      if (resultsContainer) {
        resultsContainer.innerHTML = `
          <div style="grid-column: 1 / -1; text-align: center; padding: 2.5rem 1rem; color: var(--text-muted);">
            <p style="font-family: var(--font-display); font-size: 1.2rem; color: #ffffff; margin-bottom: 0.5rem;">TRACK NOT FOUND IN CATALOG</p>
            <p style="font-family: var(--font-mono); font-size: 0.85rem; color: var(--neon-green);">
              Paste the direct YouTube / YouTube Music / Spotify / SoundCloud song link above for instant master audio extraction.
            </p>
          </div>
        `;
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalText;
      }
    }
  },

  renderSearchResults(results, query) {
    const container = document.getElementById('audio-results-container');
    if (!container) return;
    container.innerHTML = '';

    if (!results || results.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 2.5rem 1rem; color: var(--text-muted);">
          <p style="font-family: var(--font-display); font-size: 1.2rem; color: #ffffff; margin-bottom: 0.5rem;">NO DIRECT MATCHES FOR "${query.toUpperCase()}"</p>
          <p style="font-family: var(--font-mono); font-size: 0.82rem; color: var(--gold-core);">
            Try adding the artist name or paste the exact media URL above.
          </p>
        </div>
      `;
      return;
    }

    results.forEach(item => {
      const card = document.createElement('div');
      card.className = 'song-card';
      const encTitle = encodeURIComponent(item.title);
      const encArtist = encodeURIComponent(item.artist);
      const encThumb = encodeURIComponent(item.thumbnail);
      const safeUrl = item.url;

      card.innerHTML = `
        <img class="song-thumb" src="${item.thumbnail}" alt="" onerror="this.src='https://via.placeholder.com/62?text=Audio'">
        <div class="song-details">
          <div class="song-title" title="${item.title}">${item.title}</div>
          <div class="song-artist" title="${item.artist}">${item.artist}</div>
          <div class="song-meta-pill">${item.duration_formatted} ${item.views ? '• ' + item.views : ''}</div>
        </div>
        <div class="song-action-group" style="display:flex; flex-direction:column; gap:0.35rem; align-items:flex-end;">
          <button class="song-action-btn primary" onclick="AudioHub.downloadFromUrl('${safeUrl}', '320k', '${encTitle}', '${encArtist}', '${encThumb}')" title="320kbps Master Quality MP3">
            ⚡ 320k MASTER
          </button>
          <div style="display:flex; gap:0.25rem;">
            <button class="song-action-btn-sm" onclick="AudioHub.downloadFromUrl('${safeUrl}', '256k', '${encTitle}', '${encArtist}', '${encThumb}')" title="256kbps Studio MP3">256k</button>
            <button class="song-action-btn-sm" onclick="AudioHub.downloadFromUrl('${safeUrl}', '128k', '${encTitle}', '${encArtist}', '${encThumb}')" title="128kbps Standard MP3">128k</button>
          </div>
        </div>
      `;
      container.appendChild(card);
    });
  },

  renderDirectAudio(media) {
    this.currentMedia = media;
    const card = document.getElementById('audio-direct-card');
    if (!card) return;

    const thumb = document.getElementById('audio-thumb');
    const duration = document.getElementById('audio-duration');
    const title = document.getElementById('audio-title');
    const uploader = document.getElementById('audio-uploader');

    if (thumb) thumb.src = media.thumbnail || 'https://via.placeholder.com/640x360?text=Audio';
    if (duration) duration.textContent = media.duration_formatted;
    if (title) title.textContent = media.title;
    if (uploader) uploader.textContent = media.uploader;

    const grid = document.getElementById('audio-formats-grid');
    if (!grid) return;
    grid.innerHTML = '';

    // If direct source stream is available, provide direct instant download card
    if (media.direct_stream_url) {
      const directEl = document.createElement('div');
      directEl.className = 'format-card direct-stream-card';
      directEl.innerHTML = `
        <div>
          <div class="format-badge-row">
            <span class="res-badge gold-badge">DIRECT STREAM</span>
            <span class="format-ext">SOURCE</span>
          </div>
          <div class="format-label">Pristine Source Stream (Instant Device Save)</div>
          <div class="format-size">Direct Platform Tunnel • Zero Wait Time</div>
        </div>
        <a class="btn-download-format btn-neon-green" href="${media.direct_stream_url}" target="_blank" download="${(media.title || 'audio_track').replace(/[/\\?%*:|"<>]/g, '')}.mp4">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          DIRECT SAVE
        </a>
      `;
      grid.appendChild(directEl);
    }

    const audioFormats = media.audio_formats || [];
    audioFormats.forEach((af, idx) => {
      const isMaster = af.bitrate === 320 || af.quality_tag === '320k';
      const isStudio = af.bitrate === 256 || af.quality_tag === '256k';
      const el = document.createElement('div');
      el.className = `format-card ${isMaster ? 'highlight-gold' : (isStudio ? 'highlight-green' : '')}`;
      el.innerHTML = `
        <div>
          <div class="format-badge-row">
            <span class="res-badge ${isMaster ? 'gold-badge' : (isStudio ? 'neon-badge' : '')}">${af.ext.toUpperCase()}</span>
            <span class="format-ext">${af.quality_tag}</span>
            ${isMaster ? '<span class="tier-tag gold-text">★ MASTER HQ</span>' : ''}
          </div>
          <div class="format-label">${af.label}</div>
          <div class="format-size">EST. SIZE: ${af.size_formatted}</div>
        </div>
        <button class="btn-download-format ${isMaster ? 'btn-gold' : 'btn-neon-green'}" onclick="AudioHub.downloadByIndex(${idx})">
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
    if (progressPanel) progressPanel.style.display = 'block';

    setTimeout(() => {
      if (progressPanel) progressPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);

    const statusBadge = document.getElementById('audio-progress-status');
    const pctLabel = document.getElementById('audio-progress-pct');
    const barFill = document.getElementById('audio-progress-fill');
    const speedLabel = document.getElementById('audio-progress-speed');
    const metaLabel = document.getElementById('audio-progress-meta');

    if (statusBadge) statusBadge.textContent = 'CONNECTING';
    if (pctLabel) pctLabel.textContent = '10%';
    if (barFill) barFill.style.width = '10%';
    if (speedLabel) speedLabel.textContent = `Extracting ${title}...`;
    if (metaLabel) metaLabel.textContent = `Mastering ${qualityTag.toUpperCase()} audio stream...`;
    if (typeof VideoDownloader !== 'undefined') {
      VideoDownloader.updatePlanetStage('audio-planet-sphere', 'audio-planet-name', 10);
    }

    const directStream = (this.currentMedia && this.currentMedia.direct_stream_url) || '';
    const downloadQuery = new URLSearchParams({
      url: url,
      title: title,
      format_selector: qualityTag,
      ext: 'mp3',
      direct_url: directStream
    }).toString();
    const directDownloadUrl = `${window.API_BASE || ''}/api/download?${downloadQuery}`;

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

      if (data.status === 'ready' || data.download_url) {
        const finalUrl = data.download_url || directDownloadUrl;
        if (barFill) barFill.style.width = '100%';
        if (pctLabel) pctLabel.textContent = '100%';
        if (statusBadge) {
          statusBadge.textContent = 'COMPLETE';
          statusBadge.style.color = 'var(--neon-green)';
        }
        if (speedLabel) speedLabel.textContent = 'Master MP3 ready! Saving directly to your device...';
        if (metaLabel) {
          metaLabel.innerHTML = `
            <a href="${finalUrl}" class="btn-job-action btn-gold" style="text-decoration:none; display:inline-flex; align-items:center; gap:0.4rem; padding: 0.6rem 1.2rem; font-weight:800; border-radius:4px;" download>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
              TAP TO SAVE ${qualityTag.toUpperCase()} MP3
            </a>
          `;
        }
        if (typeof VideoDownloader !== 'undefined') {
          VideoDownloader.updatePlanetStage('audio-planet-sphere', 'audio-planet-name', 100);
        }

        const a = document.createElement('a');
        a.href = finalUrl;
        a.download = `${title.replace(/[/\\?%*:|"<>]/g, '')}.mp3`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        App.showToast("✓ High-res song downloaded to your device!");
        return;
      }

      this.pollProgress(data.job_id);
    } catch (err) {
      // Direct stream fallback
      if (barFill) barFill.style.width = '100%';
      if (pctLabel) pctLabel.textContent = '100%';
      if (statusBadge) statusBadge.textContent = 'STREAM READY';
      if (speedLabel) speedLabel.textContent = 'Direct audio stream ready!';
      if (metaLabel) {
        metaLabel.innerHTML = `
          <a href="${directDownloadUrl}" class="btn-job-action btn-gold" style="text-decoration:none; display:inline-flex; align-items:center; gap:0.4rem; padding: 0.6rem 1.2rem; font-weight:800; border-radius:4px;" download>
            TAP TO DOWNLOAD MP3
          </a>
        `;
      }
      window.location.href = directDownloadUrl;
      App.showToast("⚡ Streaming audio directly to your device...");
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
          const p = pauseBtn.querySelector('.icon-pause');
          const pl = pauseBtn.querySelector('.icon-play');
          const txt = pauseBtn.querySelector('.btn-text');
          if (p) p.style.display = 'inline';
          if (pl) pl.style.display = 'none';
          if (txt) txt.textContent = 'PAUSE';
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
          const p = pauseBtn.querySelector('.icon-pause');
          const pl = pauseBtn.querySelector('.icon-play');
          const txt = pauseBtn.querySelector('.btn-text');
          if (p) p.style.display = 'none';
          if (pl) pl.style.display = 'inline';
          if (txt) txt.textContent = 'RESUME';
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

    const pauseBtn = document.getElementById('audio-btn-pause');
    const cancelBtn = document.getElementById('audio-btn-cancel');
    if (pauseBtn) {
      pauseBtn.style.display = 'inline-flex';
      pauseBtn.classList.remove('paused');
      const p = pauseBtn.querySelector('.icon-pause');
      const pl = pauseBtn.querySelector('.icon-play');
      const txt = pauseBtn.querySelector('.btn-text');
      if (p) p.style.display = 'inline';
      if (pl) pl.style.display = 'none';
      if (txt) txt.textContent = 'PAUSE';
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

        if (barFill) barFill.style.width = `${Math.max(pct, 2)}%`;
        if (pctLabel) pctLabel.textContent = `${pct}%`;

        if (typeof VideoDownloader !== 'undefined') {
          VideoDownloader.updatePlanetStage('audio-planet-sphere', 'audio-planet-name', pct);
        }

        if (info.status === 'paused' || this.isPaused) {
          this.isPaused = true;
          if (statusBadge) statusBadge.textContent = 'PAUSED';
          if (speedLabel) speedLabel.textContent = 'Download Paused';
          if (pauseBtn && !pauseBtn.classList.contains('paused')) {
            pauseBtn.classList.add('paused');
            const p = pauseBtn.querySelector('.icon-pause');
            const pl = pauseBtn.querySelector('.icon-play');
            const txt = pauseBtn.querySelector('.btn-text');
            if (p) p.style.display = 'none';
            if (pl) pl.style.display = 'inline';
            if (txt) txt.textContent = 'RESUME';
          }
          if (sphere) sphere.classList.add('is-paused');
          if (barFill) barFill.classList.add('is-paused');
        } else if (info.status === 'downloading') {
          if (statusBadge) statusBadge.textContent = 'DOWNLOADING STREAM';
          if (speedLabel) speedLabel.textContent = info.speed_str || 'Streaming...';
          if (metaLabel) metaLabel.textContent = `${info.downloaded_str} • ${info.eta_str}`;
          if (pauseBtn && pauseBtn.classList.contains('paused')) {
            pauseBtn.classList.remove('paused');
            const p = pauseBtn.querySelector('.icon-pause');
            const pl = pauseBtn.querySelector('.icon-play');
            const txt = pauseBtn.querySelector('.btn-text');
            if (p) p.style.display = 'inline';
            if (pl) pl.style.display = 'none';
            if (txt) txt.textContent = 'PAUSE';
          }
          if (sphere) sphere.classList.remove('is-paused');
          if (barFill) barFill.classList.remove('is-paused');
        } else if (info.status === 'cancelled') {
          clearInterval(this.activePollInterval);
          if (statusBadge) statusBadge.textContent = 'CANCELLED';
          if (speedLabel) speedLabel.textContent = 'Cancelled by user';
          if (pauseBtn) pauseBtn.style.display = 'none';
          if (cancelBtn) cancelBtn.style.display = 'none';
        } else if (info.status === 'processing') {
          if (statusBadge) statusBadge.textContent = '320K ENCODING';
          if (speedLabel) speedLabel.textContent = 'Transcoding to 320k MP3 + Embedding Artwork...';
          if (metaLabel) metaLabel.textContent = 'Applying ID3 tags & Album Cover';
        } else if (info.status === 'ready') {
          clearInterval(this.activePollInterval);
          if (statusBadge) {
            statusBadge.textContent = 'COMPLETE';
            statusBadge.style.color = 'var(--neon-green)';
          }
          if (barFill) barFill.style.width = '100%';
          if (pctLabel) pctLabel.textContent = '100%';
          if (speedLabel) speedLabel.textContent = 'Master MP3 ready! Saving to your device...';
          const downloadUrl = `${window.API_BASE || ''}/api/download-file/${jobId}`;
          if (metaLabel) {
            metaLabel.innerHTML = `
              <a href="${downloadUrl}" class="btn-job-action btn-gold" style="text-decoration:none; display:inline-flex; align-items:center; gap:0.4rem; padding: 0.45rem 0.9rem; font-weight:800;" download="${info.filename || 'song.mp3'}">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                TAP TO SAVE MP3
              </a>
            `;
          }

          if (pauseBtn) pauseBtn.style.display = 'none';
          if (cancelBtn) cancelBtn.style.display = 'none';

          if (typeof VideoDownloader !== 'undefined') {
            VideoDownloader.updatePlanetStage('audio-planet-sphere', 'audio-planet-name', 100);
          }

          // Direct browser download via anchor element
          const dlLink = document.createElement('a');
          dlLink.href = downloadUrl;
          dlLink.download = info.filename || 'song.mp3';
          dlLink.target = '_blank';
          document.body.appendChild(dlLink);
          dlLink.click();
          document.body.removeChild(dlLink);
          App.showToast("✓ High-res song downloaded to your device!");
        } else if (info.status === 'error') {
          clearInterval(this.activePollInterval);
          if (statusBadge) {
            statusBadge.textContent = 'FAILED';
            statusBadge.style.color = 'var(--crimson-core)';
          }
          const errStr = App.parseError(info.error, 'Audio extraction failed.');
          if (speedLabel) speedLabel.textContent = errStr;
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
