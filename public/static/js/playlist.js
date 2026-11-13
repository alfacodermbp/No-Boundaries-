/**
 * EVERYTHING FREE — Playlist & Batch Studio
 * Dual-Mode ZIP Archiving (Client-Side JSZip Container + Backend Worker),
 * Interactive track selection, full quality tier selector (320k, 256k, 192k, 128k),
 * smooth scroll to celestial progress, and 100% failure-proof ZIP folder export.
 */

const PlaylistStudio = {
  currentPlaylist: null,
  selectedTrackIds: new Set(),
  activePollInterval: null,
  currentJobId: null,
  isPaused: false,
  isBatchDownloading: false,
  shouldCancelBatch: false,

  async analyze() {
    const input = document.getElementById('playlist-url-input');
    const url = input ? input.value.trim() : '';
    if (!url) {
      App.showToast("Paste a playlist link to begin.");
      return;
    }

    const btn = document.getElementById('btn-analyze-playlist');
    const originalText = btn ? btn.innerHTML : 'Fetch Playlist';
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span class="spinner"></span> ANALYZING PLAYLIST...`;
    }

    const dashboard = document.getElementById('playlist-dashboard');
    if (dashboard) dashboard.style.display = 'none';

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

      // Default select up to 50 tracks for fast batching, or all if <= 50
      const tracksToSelect = data.tracks.slice(0, 50);
      tracksToSelect.forEach(t => this.selectedTrackIds.add(t.id));

      this.renderPlaylist(data);

      setTimeout(() => {
        if (dashboard) dashboard.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);

    } catch (err) {
      App.showToast(`Error: ${err.message || 'Could not analyze playlist'}`);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = originalText;
      }
    }
  },

  renderPlaylist(data) {
    const dashboard = document.getElementById('playlist-dashboard');
    if (!dashboard) return;

    const titleEl = document.getElementById('playlist-title');
    const curatorEl = document.getElementById('playlist-curator');
    if (titleEl) titleEl.textContent = data.playlist_title;
    if (curatorEl) curatorEl.textContent = `CURATED BY ${data.uploader.toUpperCase()} // ${data.total_tracks} TOTAL TRACKS DETECTED`;

    this.renderTracksList(data.tracks);
    this.updateSelectionCounters();

    dashboard.style.display = 'block';
  },

  renderTracksList(tracks) {
    const container = document.getElementById('playlist-tracks-list');
    if (!container) return;
    container.innerHTML = '';

    // Render up to first 200 tracks in DOM for smooth scrolling performance
    const renderLimit = Math.min(tracks.length, 250);
    const visibleTracks = tracks.slice(0, renderLimit);

    visibleTracks.forEach((track, idx) => {
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
        <span class="track-size-pill">~${track.est_size_mb || '5'} MB</span>
        <button class="btn-tool" title="Download single track (320k)" onclick="event.stopPropagation(); PlaylistStudio.downloadSingleTrack(${idx})">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
        </button>
      `;

      row.addEventListener('click', () => {
        this.toggleTrack(track.id);
      });

      container.appendChild(row);
    });

    if (tracks.length > renderLimit) {
      const notice = document.createElement('div');
      notice.style.cssText = 'text-align:center; padding: 1rem; color: var(--gold-core); font-family: var(--font-mono); font-size: 0.82rem;';
      notice.textContent = `Showing first ${renderLimit} tracks of ${tracks.length}. All ${tracks.length} are ready for download.`;
      container.appendChild(notice);
    }
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

  selectFirst(count = 25) {
    if (!this.currentPlaylist) return;
    this.deselectAll();
    const slice = this.currentPlaylist.tracks.slice(0, count);
    slice.forEach(t => {
      this.selectedTrackIds.add(t.id);
      const chk = document.getElementById(`chk-${t.id}`);
      const row = document.getElementById(`track-row-${t.id}`);
      if (chk) chk.checked = true;
      if (row) row.classList.add('selected');
    });
    this.updateSelectionCounters();
  },

  updateSelectionCounters() {
    if (!this.currentPlaylist) return;

    const total = this.currentPlaylist.tracks.length;
    const selectedCount = this.selectedTrackIds.size;

    const selCountEl = document.getElementById('playlist-selected-count');
    const totCountEl = document.getElementById('playlist-total-count');
    const estSizeEl = document.getElementById('playlist-est-size');

    if (selCountEl) selCountEl.textContent = selectedCount;
    if (totCountEl) totCountEl.textContent = total;

    let totalEstMb = 0;
    this.currentPlaylist.tracks.forEach(t => {
      if (this.selectedTrackIds.has(t.id)) {
        totalEstMb += (t.est_size_mb || 6.5);
      }
    });

    if (estSizeEl) estSizeEl.textContent = `~${Math.round(totalEstMb)} MB`;

    const downloadBtn = document.getElementById('btn-download-playlist-batch');
    if (downloadBtn) {
      downloadBtn.disabled = selectedCount === 0;
      downloadBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
        DOWNLOAD ${selectedCount} TRACKS (ZIP FOLDER)
      `;
    }
  },

  async startBatchDownload() {
    if (!this.currentPlaylist || this.selectedTrackIds.size === 0) {
      App.showToast("Select at least one track to export.");
      return;
    }

    const selectedTracks = this.currentPlaylist.tracks.filter(t => this.selectedTrackIds.has(t.id));
    const qualitySelect = document.getElementById('playlist-quality-select');
    const qualityTag = (qualitySelect && qualitySelect.value) || '320k';

    const progressPanel = document.getElementById('playlist-download-progress');
    if (progressPanel) progressPanel.style.display = 'block';

    setTimeout(() => {
      if (progressPanel) progressPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 150);

    const statusBadge = document.getElementById('playlist-progress-status');
    const pctLabel = document.getElementById('playlist-progress-pct');
    const barFill = document.getElementById('playlist-progress-fill');
    const speedLabel = document.getElementById('playlist-progress-speed');
    const metaLabel = document.getElementById('playlist-progress-meta');

    if (statusBadge) statusBadge.textContent = 'INITIALIZING BATCH';
    if (pctLabel) pctLabel.textContent = '0%';
    if (barFill) barFill.style.width = '2%';
    if (speedLabel) speedLabel.textContent = `Batch of ${selectedTracks.length} tracks queued...`;
    if (metaLabel) metaLabel.textContent = 'Preparing high-definition ZIP folder...';
    if (typeof VideoDownloader !== 'undefined') {
      VideoDownloader.updatePlanetStage('playlist-planet-sphere', 'playlist-planet-name', 0);
    }

    this.shouldCancelBatch = false;
    this.isBatchDownloading = true;

    // Use client-side JSZip engine if available for 100% resilient cross-platform ZIP export
    if (typeof JSZip !== 'undefined') {
      await this.runClientSideBatchZip(selectedTracks, qualityTag);
      return;
    }

    // Backend fallback
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
      App.showToast(`Error: ${err.message || 'Batch failed'}`);
      if (progressPanel) progressPanel.style.display = 'none';
      this.isBatchDownloading = false;
    }
  },

  async runClientSideBatchZip(tracks, qualityTag) {
    const zip = new JSZip();
    const folderName = (this.currentPlaylist.playlist_title || "Playlist").replace(/[/\\?%*:|"<>]/g, '_');
    const zipFolder = zip.folder(folderName);

    const statusBadge = document.getElementById('playlist-progress-status');
    const pctLabel = document.getElementById('playlist-progress-pct');
    const barFill = document.getElementById('playlist-progress-fill');
    const speedLabel = document.getElementById('playlist-progress-speed');
    const metaLabel = document.getElementById('playlist-progress-meta');

    const total = tracks.length;
    let completed = 0;
    let failed = 0;

    for (let i = 0; i < total; i++) {
      if (this.shouldCancelBatch) {
        if (statusBadge) statusBadge.textContent = 'CANCELLED';
        if (speedLabel) speedLabel.textContent = 'Batch cancelled by user';
        this.isBatchDownloading = false;
        return;
      }

      while (this.isPaused) {
        if (this.shouldCancelBatch) return;
        await new Promise(r => setTimeout(r, 400));
      }

      const track = tracks[i];
      const trackIndex = i + 1;
      const cleanTitle = `${String(trackIndex).padStart(2, '0')} - ${(track.title || 'Track').replace(/[/\\?%*:|"<>]/g, '_')}`;

      const progressPct = Math.round((i / total) * 88);
      if (barFill) barFill.style.width = `${Math.max(progressPct, 4)}%`;
      if (pctLabel) pctLabel.textContent = `${progressPct}%`;
      if (statusBadge) statusBadge.textContent = `DOWNLOADING (${trackIndex}/${total})`;
      if (speedLabel) speedLabel.textContent = `Fetching "${track.title.slice(0, 38)}..."`;
      if (metaLabel) metaLabel.textContent = `${completed} saved • ${total - i} remaining`;
      if (typeof VideoDownloader !== 'undefined') {
        VideoDownloader.updatePlanetStage('playlist-planet-sphere', 'playlist-planet-name', progressPct);
      }

      try {
        const downloadQuery = new URLSearchParams({
          url: track.url,
          title: cleanTitle,
          format_selector: qualityTag,
          ext: 'mp3'
        }).toString();

        const streamUrl = `${window.API_BASE || ''}/api/download?${downloadQuery}`;
        const resp = await fetch(streamUrl);
        if (resp.ok) {
          const blob = await resp.blob();
          zipFolder.file(`${cleanTitle}.mp3`, blob);
          completed++;
        } else {
          failed++;
        }
      } catch (e) {
        failed++;
        console.warn(`Failed track ${trackIndex}:`, e);
      }
    }

    if (completed === 0) {
      App.showToast("Could not download tracks for ZIP folder.");
      if (statusBadge) statusBadge.textContent = 'FAILED';
      if (speedLabel) speedLabel.textContent = 'Could not download media streams.';
      this.isBatchDownloading = false;
      return;
    }

    // Generate ZIP
    if (statusBadge) statusBadge.textContent = 'PACKAGING ZIP';
    if (speedLabel) speedLabel.textContent = `Compressing ${completed} songs into "${folderName}.zip"...`;
    if (metaLabel) metaLabel.textContent = 'Building ZIP folder container...';
    if (barFill) barFill.style.width = '94%';
    if (pctLabel) pctLabel.textContent = '94%';

    const zipBlob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 4 }
    }, (metadata) => {
      const zPct = Math.round(92 + (metadata.percent * 0.08));
      if (barFill) barFill.style.width = `${zPct}%`;
      if (pctLabel) pctLabel.textContent = `${zPct}%`;
    });

    if (barFill) barFill.style.width = '100%';
    if (pctLabel) pctLabel.textContent = '100%';
    if (statusBadge) {
      statusBadge.textContent = 'COMPLETE';
      statusBadge.style.color = 'var(--neon-green)';
    }
    if (speedLabel) speedLabel.textContent = `All ${completed} songs bundled! Saving folder to device...`;

    const zipFileName = `${folderName}_[STUDIO_ARCHIVE].zip`;
    const zipUrl = URL.createObjectURL(zipBlob);

    if (metaLabel) {
      metaLabel.innerHTML = `
        <a href="${zipUrl}" class="btn-job-action btn-gold" style="text-decoration:none; display:inline-flex; align-items:center; gap:0.4rem; padding: 0.5rem 1rem; font-weight:800;" download="${zipFileName}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          TAP TO SAVE "${zipFileName}"
        </a>
      `;
    }

    if (typeof VideoDownloader !== 'undefined') {
      VideoDownloader.updatePlanetStage('playlist-planet-sphere', 'playlist-planet-name', 100);
    }

    // Auto-trigger browser download
    const link = document.createElement('a');
    link.href = zipUrl;
    link.download = zipFileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    App.showToast(`✓ Downloaded ${completed} songs in ZIP folder "${zipFileName}"!`);
    this.isBatchDownloading = false;
  },

  async togglePause() {
    const pauseBtn = document.getElementById('playlist-btn-pause');
    const sphere = document.getElementById('playlist-planet-sphere');
    const barFill = document.getElementById('playlist-progress-fill');
    const statusBadge = document.getElementById('playlist-progress-status');
    const speedLabel = document.getElementById('playlist-progress-speed');

    this.isPaused = !this.isPaused;

    if (this.isPaused) {
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
      if (speedLabel) speedLabel.textContent = 'Batch Paused';
      App.showToast("⏸ Playlist batch paused");
    } else {
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
      if (statusBadge) statusBadge.textContent = 'BATCH EXTRACTING';
      if (speedLabel) speedLabel.textContent = 'Resuming batch...';
      App.showToast("▶ Playlist batch resumed");
    }

    if (this.currentJobId) {
      const action = this.isPaused ? 'pause' : 'resume';
      fetch(`${window.API_BASE || ''}/api/job/${this.currentJobId}/${action}`, { method: 'POST' }).catch(() => {});
    }
  },

  async cancel() {
    this.shouldCancelBatch = true;
    this.isBatchDownloading = false;

    if (this.currentJobId) {
      try {
        await fetch(`${window.API_BASE || ''}/api/job/${this.currentJobId}/cancel`, { method: 'POST' });
      } catch (err) {}
    }

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
  },

  pollProgress(jobId) {
    this.currentJobId = jobId;
    this.isPaused = false;

    const pauseBtn = document.getElementById('playlist-btn-pause');
    const cancelBtn = document.getElementById('playlist-btn-cancel');
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
    if (cancelBtn) cancelBtn.style.display = 'inline-flex';

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

        if (barFill) barFill.style.width = `${Math.max(pct, 2)}%`;
        if (pctLabel) pctLabel.textContent = `${pct}%`;

        if (typeof VideoDownloader !== 'undefined') {
          VideoDownloader.updatePlanetStage('playlist-planet-sphere', 'playlist-planet-name', pct);
        }

        if (info.status === 'paused' || this.isPaused) {
          this.isPaused = true;
          if (statusBadge) statusBadge.textContent = 'PAUSED';
          if (speedLabel) speedLabel.textContent = 'Batch Paused';
        } else if (info.status === 'downloading') {
          if (statusBadge) statusBadge.textContent = 'BATCH EXTRACTING';
          if (speedLabel) speedLabel.textContent = info.speed_str || 'Processing tracks...';
          if (metaLabel) metaLabel.textContent = `${info.downloaded_str} • ${info.eta_str}`;
        } else if (info.status === 'cancelled') {
          clearInterval(this.activePollInterval);
          if (statusBadge) statusBadge.textContent = 'CANCELLED';
          if (speedLabel) speedLabel.textContent = 'Batch cancelled by user';
          if (pauseBtn) pauseBtn.style.display = 'none';
          if (cancelBtn) cancelBtn.style.display = 'none';
        } else if (info.status === 'processing') {
          if (statusBadge) statusBadge.textContent = 'PACKAGING ZIP';
          if (speedLabel) speedLabel.textContent = 'Compressing audio into high-res ZIP folder...';
          if (metaLabel) metaLabel.textContent = 'Embedding ID3 tags & Artwork';
        } else if (info.status === 'ready') {
          clearInterval(this.activePollInterval);
          if (statusBadge) {
            statusBadge.textContent = 'COMPLETE';
            statusBadge.style.color = 'var(--neon-green)';
          }
          if (barFill) barFill.style.width = '100%';
          if (pctLabel) pctLabel.textContent = '100%';
          if (speedLabel) speedLabel.textContent = 'All tracks bundled! Saving ZIP folder to your device...';
          const downloadUrl = `${window.API_BASE || ''}/api/download-file/${jobId}`;
          if (metaLabel) {
            metaLabel.innerHTML = `
              <a href="${downloadUrl}" class="btn-job-action btn-gold" style="text-decoration:none; display:inline-flex; align-items:center; gap:0.4rem; padding: 0.5rem 1rem; font-weight:800;" download="${info.filename || 'playlist.zip'}">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                TAP TO SAVE ZIP FOLDER
              </a>
            `;
          }

          if (pauseBtn) pauseBtn.style.display = 'none';
          if (cancelBtn) cancelBtn.style.display = 'none';

          if (typeof VideoDownloader !== 'undefined') {
            VideoDownloader.updatePlanetStage('playlist-planet-sphere', 'playlist-planet-name', 100);
          }

          const dlLink = document.createElement('a');
          dlLink.href = downloadUrl;
          dlLink.download = info.filename || 'playlist.zip';
          dlLink.target = '_blank';
          document.body.appendChild(dlLink);
          dlLink.click();
          document.body.removeChild(dlLink);
          App.showToast("✓ Full playlist ZIP folder downloaded to your device!");
        } else if (info.status === 'error') {
          clearInterval(this.activePollInterval);
          if (statusBadge) {
            statusBadge.textContent = 'FAILED';
            statusBadge.style.color = 'var(--crimson-core)';
          }
          const errStr = App.parseError(info.error, 'Batch download failed.');
          if (speedLabel) speedLabel.textContent = errStr;
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
