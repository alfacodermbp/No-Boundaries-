/**
 * EVERYTHING FREE — Playlist & Batch Studio
 * Interactive track checkboxes, select all/remove all, size estimation,
 * smooth scroll to celestial progress, and batch ZIP archiving.
 */

const PlaylistStudio = {
  currentPlaylist: null,
  selectedTrackIds: new Set(),
  activePollInterval: null,
  currentJobId: null,
  isPaused: false,

  async analyze() {
    const input = document.getElementById('playlist-url-input');
    const url = input.value.trim();
    if (!url) {
      App.showToast("Paste a playlist link to begin.");
      return;
    }

    const btn = document.getElementById('btn-analyze-playlist');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> ANALYZING PLAYLIST...`;

    const dashboard = document.getElementById('playlist-dashboard');
    dashboard.style.display = 'none';

    try {
      const res = await fetch(`${window.API_BASE || ''}/api/playlist/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(App.parseError(data, "Failed to load playlist."));
      }

      this.currentPlaylist = data;
      this.selectedTrackIds.clear();

      // Default select all tracks
      data.tracks.forEach(t => this.selectedTrackIds.add(t.id));

      this.renderPlaylist(data);

      setTimeout(() => {
        dashboard.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);

    } catch (err) {
      App.showToast(`Error: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  },

  renderPlaylist(data) {
    const dashboard = document.getElementById('playlist-dashboard');

    document.getElementById('playlist-title').textContent = data.playlist_title;
    document.getElementById('playlist-curator').textContent = `CURATED BY ${data.uploader.toUpperCase()} // ${data.total_tracks} TRACKS`;

    this.renderTracksList(data.tracks);
    this.updateSelectionCounters();

    dashboard.style.display = 'block';
  },

  renderTracksList(tracks) {
    const container = document.getElementById('playlist-tracks-list');
    container.innerHTML = '';

    tracks.forEach((track, idx) => {
      const isSelected = this.selectedTrackIds.has(track.id);
      const row = document.createElement('div');
      row.className = `track-row ${isSelected ? 'selected' : ''}`;
      row.id = `track-row-${track.id}`;

      row.innerHTML = `
        <input type="checkbox" class="track-checkbox" id="chk-${track.id}" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation(); PlaylistStudio.toggleTrack('${track.id}')">
        <span class="track-num">${String(track.index).padStart(2, '0')}</span>
        <img class="track-thumb-mini" src="${track.thumbnail}" alt="" onerror="this.src='https://via.placeholder.com/44?text=Audio'">
        <div class="track-title-col">
          <div class="track-name" title="${track.title}">${track.title}</div>
          <div class="track-author" title="${track.artist}">${track.artist}</div>
        </div>
        <span class="track-duration-pill">${track.duration_formatted}</span>
        <span class="track-size-pill">~${track.est_size_mb} MB</span>
        <button class="btn-tool" title="Download single track" onclick="event.stopPropagation(); PlaylistStudio.downloadSingleTrack(${idx})">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
        </button>
      `;

      row.addEventListener('click', () => {
        this.toggleTrack(track.id);
      });

      container.appendChild(row);
    });
  },

  downloadSingleTrack(idx) {
    if (!this.currentPlaylist || !this.currentPlaylist.tracks || !this.currentPlaylist.tracks[idx]) return;
    const track = this.currentPlaylist.tracks[idx];
    AudioHub.downloadFromUrl(
      track.url,
      '320k',
      encodeURIComponent(track.title),
      encodeURIComponent(track.artist),
      encodeURIComponent(track.thumbnail)
    );
  },

  toggleTrack(trackId) {
    const chk = document.getElementById(`chk-${trackId}`);
    const row = document.getElementById(`track-row-${trackId}`);

    if (this.selectedTrackIds.has(trackId)) {
      this.selectedTrackIds.delete(trackId);
      if (chk) chk.checked = false;
      if (row) row.classList.remove('selected');
    } else {
      this.selectedTrackIds.add(trackId);
      if (chk) chk.checked = true;
      if (row) row.classList.add('selected');
    }

    this.updateSelectionCounters();
  },

  selectAll() {
    if (!this.currentPlaylist) return;
    this.currentPlaylist.tracks.forEach(t => {
      this.selectedTrackIds.add(t.id);
      const chk = document.getElementById(`chk-${t.id}`);
      const row = document.getElementById(`track-row-${t.id}`);
      if (chk) chk.checked = true;
      if (row) row.classList.add('selected');
    });
    this.updateSelectionCounters();
  },

  deselectAll() {
    if (!this.currentPlaylist) return;
    this.currentPlaylist.tracks.forEach(t => {
      this.selectedTrackIds.delete(t.id);
      const chk = document.getElementById(`chk-${t.id}`);
      const row = document.getElementById(`track-row-${t.id}`);
      if (chk) chk.checked = false;
      if (row) row.classList.remove('selected');
    });
    this.updateSelectionCounters();
  },

  updateSelectionCounters() {
    if (!this.currentPlaylist) return;

    const total = this.currentPlaylist.tracks.length;
    const selectedCount = this.selectedTrackIds.size;

    document.getElementById('playlist-selected-count').textContent = selectedCount;
    document.getElementById('playlist-total-count').textContent = total;

    let totalEstMb = 0;
    this.currentPlaylist.tracks.forEach(t => {
      if (this.selectedTrackIds.has(t.id)) {
        totalEstMb += (t.est_size_mb || 7.5);
      }
    });

    document.getElementById('playlist-est-size').textContent = `~${Math.round(totalEstMb)} MB`;

    const downloadBtn = document.getElementById('btn-download-playlist-batch');
    downloadBtn.disabled = selectedCount === 0;
    downloadBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
      DOWNLOAD ${selectedCount} TRACKS (ZIP)
    `;
  },

  async startBatchDownload() {
    if (!this.currentPlaylist || this.selectedTrackIds.size === 0) {
      App.showToast("Select at least one track to export.");
      return;
    }

    const selectedTracks = this.currentPlaylist.tracks.filter(t => this.selectedTrackIds.has(t.id));
    const qualityTag = document.getElementById('playlist-quality-select').value || '320k';

    // Playlist batch ZIP archiving requires the persistent Render engine with FFmpeg & background worker
    if (!window.API_BASE) {
      App.showToast("⚡ Full Playlist ZIP bundling requires the Render Engine. Tap ENGINE at top to connect!");
      if (typeof App.openEngineModal === 'function') {
        App.openEngineModal();
      }
      return;
    }

    const progressPanel = document.getElementById('playlist-download-progress');
    progressPanel.style.display = 'block';

    setTimeout(() => {
      progressPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);

    const statusBadge = document.getElementById('playlist-progress-status');
    const pctLabel = document.getElementById('playlist-progress-pct');
    const barFill = document.getElementById('playlist-progress-fill');
    const speedLabel = document.getElementById('playlist-progress-speed');
    const metaLabel = document.getElementById('playlist-progress-meta');

    statusBadge.textContent = 'INITIALIZING';
    pctLabel.textContent = '0%';
    barFill.style.width = '2%';
    speedLabel.textContent = `Batch of ${selectedTracks.length} tracks queued...`;
    metaLabel.textContent = 'Allocating ZIP container buffer...';
    VideoDownloader.updatePlanetStage('playlist-planet-sphere', 'playlist-planet-name', 0);

    try {
      const res = await fetch(`${window.API_BASE || ''}/api/playlist/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playlist_title: this.currentPlaylist.playlist_title,
          selected_tracks: selectedTracks,
          quality_tag: qualityTag
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(App.parseError(data, "Failed to start batch playlist download."));

      this.pollProgress(data.job_id);
    } catch (err) {
      App.showToast(`Error: ${err.message}`);
      progressPanel.style.display = 'none';
    }
  },

  async togglePause() {
    if (!this.currentJobId) return;

    const pauseBtn = document.getElementById('playlist-btn-pause');
    const sphere = document.getElementById('playlist-planet-sphere');
    const barFill = document.getElementById('playlist-progress-fill');
    const statusBadge = document.getElementById('playlist-progress-status');
    const speedLabel = document.getElementById('playlist-progress-speed');

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
        if (statusBadge) statusBadge.textContent = 'BATCH DOWNLOADING';
        if (speedLabel) speedLabel.textContent = 'Resuming batch...';
        App.showToast("▶ Playlist download resumed");
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
        if (speedLabel) speedLabel.textContent = 'Batch Paused';
        App.showToast("⏸ Playlist download paused");
      }
    } catch (err) {
      console.warn("Playlist toggle pause failed:", err);
    }
  },

  async cancel() {
    if (!this.currentJobId) return;
    try {
      await fetch(`${window.API_BASE || ''}/api/job/${this.currentJobId}/cancel`, { method: 'POST' });
      if (this.activePollInterval) clearInterval(this.activePollInterval);

      const statusBadge = document.getElementById('playlist-progress-status');
      const speedLabel = document.getElementById('playlist-progress-speed');
      const sphere = document.getElementById('playlist-planet-sphere');
      const barFill = document.getElementById('playlist-progress-fill');

      if (statusBadge) statusBadge.textContent = 'CANCELLED';
      if (speedLabel) speedLabel.textContent = 'Batch cancelled by user';
      if (sphere) sphere.classList.remove('is-paused');
      if (barFill) barFill.classList.remove('is-paused');

      App.showToast("Playlist download cancelled.");
      setTimeout(() => {
        const progressPanel = document.getElementById('playlist-download-progress');
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
    const pauseBtn = document.getElementById('playlist-btn-pause');
    const cancelBtn = document.getElementById('playlist-btn-cancel');
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

    const sphere = document.getElementById('playlist-planet-sphere');
    const barFill = document.getElementById('playlist-progress-fill');
    if (sphere) sphere.classList.remove('is-paused');
    if (barFill) barFill.classList.remove('is-paused');

    if (this.activePollInterval) clearInterval(this.activePollInterval);

    const statusBadge = document.getElementById('playlist-progress-status');
    const pctLabel = document.getElementById('playlist-progress-pct');
    const speedLabel = document.getElementById('playlist-progress-speed');
    const metaLabel = document.getElementById('playlist-progress-meta');

    this.activePollInterval = setInterval(async () => {
      try {
        const res = await fetch(`${window.API_BASE || ''}/api/progress/${jobId}`);
        if (!res.ok) return;

        const info = await res.json();
        const pct = info.progress || 0;

        barFill.style.width = `${Math.max(pct, 2)}%`;
        pctLabel.textContent = `${pct}%`;

        VideoDownloader.updatePlanetStage('playlist-planet-sphere', 'playlist-planet-name', pct);

        if (info.status === 'paused' || this.isPaused) {
          this.isPaused = true;
          statusBadge.textContent = 'PAUSED';
          speedLabel.textContent = 'Batch Paused';
          if (pauseBtn && !pauseBtn.classList.contains('paused')) {
            pauseBtn.classList.add('paused');
            pauseBtn.querySelector('.icon-pause').style.display = 'none';
            pauseBtn.querySelector('.icon-play').style.display = 'inline';
            pauseBtn.querySelector('.btn-text').textContent = 'RESUME';
          }
          if (sphere) sphere.classList.add('is-paused');
          if (barFill) barFill.classList.add('is-paused');
        } else if (info.status === 'downloading') {
          statusBadge.textContent = 'BATCH EXTRACTING';
          speedLabel.textContent = info.speed_str || 'Processing tracks...';
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
          speedLabel.textContent = 'Batch cancelled by user';
          if (pauseBtn) pauseBtn.style.display = 'none';
          if (cancelBtn) cancelBtn.style.display = 'none';
        } else if (info.status === 'processing') {
          statusBadge.textContent = 'PACKAGING ZIP';
          speedLabel.textContent = 'Compressing audio into high-res ZIP archive...';
          metaLabel.textContent = 'Embedding ID3 tags & Artwork';
        } else if (info.status === 'ready') {
          clearInterval(this.activePollInterval);
          statusBadge.textContent = 'COMPLETE';
          statusBadge.style.color = '#ff2a4b';
          barFill.style.width = '100%';
          pctLabel.textContent = '100%';
          speedLabel.textContent = 'All tracks bundled! Saving ZIP to your device...';
          const downloadUrl = `${window.API_BASE || ''}/api/download-file/${jobId}`;
          metaLabel.innerHTML = `
            <a href="${downloadUrl}" class="btn-job-action" style="text-decoration:none; display:inline-flex; align-items:center; gap:0.4rem; padding: 0.45rem 0.9rem; background:#ff2a4b; color:#050406; font-weight:800;" download="${info.filename || 'playlist.zip'}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
              TAP TO SAVE ZIP ARCHIVE
            </a>
          `;

          if (pauseBtn) pauseBtn.style.display = 'none';
          if (cancelBtn) cancelBtn.style.display = 'none';

          VideoDownloader.updatePlanetStage('playlist-planet-sphere', 'playlist-planet-name', 100);

          // Trigger browser ZIP download via anchor element
          const dlLink = document.createElement('a');
          dlLink.href = downloadUrl;
          dlLink.download = info.filename || 'playlist.zip';
          dlLink.target = '_blank';
          document.body.appendChild(dlLink);
          dlLink.click();
          document.body.removeChild(dlLink);
          App.showToast("✓ Full playlist ZIP archive downloaded to your device!");
        } else if (info.status === 'error') {
          clearInterval(this.activePollInterval);
          statusBadge.textContent = 'FAILED';
          statusBadge.style.color = '#ff2a4b';
          const errStr = App.parseError(info.error, 'Batch download failed.');
          speedLabel.textContent = errStr;
          if (pauseBtn) pauseBtn.style.display = 'none';
          if (cancelBtn) cancelBtn.style.display = 'none';
          App.showToast(`Error: ${errStr}`);
        }
      } catch (err) {
        console.warn('Playlist progress check error:', err);
      }
    }, 1200);
  }
};
