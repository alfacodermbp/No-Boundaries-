/**
 * EVERYTHING FREE — Playlist & Batch Studio
 * Dual-Mode Engine:
 * 1. Line-by-Line Track-by-Track Direct Device Download (One by One straight to Downloads)
 * 2. High-Fidelity Client-Side JSZip Container Export
 * Features: Tail/Last selection (Latest 25, 50, 100, 200 songs from end), Custom N deselect/select,
 * Fault-tolerant skipping (one failed track cannot affect others), and Retry for skipped tracks.
 */

const PlaylistStudio = {
  currentPlaylist: null,
  selectedTrackIds: new Set(),
  activePollInterval: null,
  currentJobId: null,
  isPaused: false,
  isBatchDownloading: false,
  shouldCancelBatch: false,
  failedTracks: [],

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
      this.failedTracks = [];

      // Default select the LATEST 50 songs (from the tail/end of playlist)
      const total = data.tracks.length;
      const defaultCount = Math.min(50, total);
      const startIndex = Math.max(0, total - defaultCount);
      const latestTracks = data.tracks.slice(startIndex);
      latestTracks.forEach(t => this.selectedTrackIds.add(t.id));

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

    // Hide failed tracks panel initially
    const failedPanel = document.getElementById('playlist-failed-panel');
    if (failedPanel) failedPanel.style.display = 'none';

    dashboard.style.display = 'block';
  },

  renderTracksList(tracks) {
    const container = document.getElementById('playlist-tracks-list');
    if (!container) return;
    container.innerHTML = '';

    // Render up to first 300 tracks in DOM for smooth scrolling performance
    const renderLimit = Math.min(tracks.length, 300);
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
        <button class="btn-tool" title="Download single track (320k MP3)" onclick="event.stopPropagation(); PlaylistStudio.downloadSingleTrack(${idx})">
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
      notice.style.cssText = 'text-align:center; padding: 1.2rem; color: var(--gold-core); font-family: var(--font-mono); font-size: 0.85rem;';
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
    App.showToast(`✓ Selected all ${this.currentPlaylist.tracks.length} tracks.`);
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
    App.showToast("✕ Cleared all selections.");
  },

  /* Select the newest/latest songs from the END of playlist */
  selectLast(count = 50) {
    if (!this.currentPlaylist) return;
    this.deselectAll();
    const tracks = this.currentPlaylist.tracks;
    const total = tracks.length;
    const startIndex = Math.max(0, total - count);
    const slice = tracks.slice(startIndex);
    slice.forEach(t => {
      this.selectedTrackIds.add(t.id);
      const chk = document.getElementById(`chk-${t.id}`);
      const row = document.getElementById(`track-row-${t.id}`);
      if (chk) chk.checked = true;
      if (row) row.classList.add('selected');
    });
    this.updateSelectionCounters();
    App.showToast(`✓ Selected the last ${slice.length} latest songs from end of playlist.`);
  },

  /* Deselect the last N songs from the END of playlist */
  deselectLast(count = 50) {
    if (!this.currentPlaylist) return;
    const tracks = this.currentPlaylist.tracks;
    const total = tracks.length;
    const startIndex = Math.max(0, total - count);
    const slice = tracks.slice(startIndex);
    slice.forEach(t => {
      this.selectedTrackIds.delete(t.id);
      const chk = document.getElementById(`chk-${t.id}`);
      const row = document.getElementById(`track-row-${t.id}`);
      if (chk) chk.checked = false;
      if (row) row.classList.remove('selected');
    });
    this.updateSelectionCounters();
    App.showToast(`✕ Deselected the last ${slice.length} songs from end.`);
  },

  /* Select oldest songs from START */
  selectFirst(count = 50) {
    if (!this.currentPlaylist) return;
    this.deselectAll();
    const tracks = this.currentPlaylist.tracks;
    const slice = tracks.slice(0, count);
    slice.forEach(t => {
      this.selectedTrackIds.add(t.id);
      const chk = document.getElementById(`chk-${t.id}`);
      const row = document.getElementById(`track-row-${t.id}`);
      if (chk) chk.checked = true;
      if (row) row.classList.add('selected');
    });
    this.updateSelectionCounters();
    App.showToast(`✓ Selected the first ${slice.length} songs from start.`);
  },

  /* Deselect oldest songs from START */
  deselectFirst(count = 50) {
    if (!this.currentPlaylist) return;
    const tracks = this.currentPlaylist.tracks;
    const slice = tracks.slice(0, count);
    slice.forEach(t => {
      this.selectedTrackIds.delete(t.id);
      const chk = document.getElementById(`chk-${t.id}`);
      const row = document.getElementById(`track-row-${t.id}`);
      if (chk) chk.checked = false;
      if (row) row.classList.remove('selected');
    });
    this.updateSelectionCounters();
    App.showToast(`✕ Deselected the first ${slice.length} songs from start.`);
  },

  handleRangeSelect(val) {
    if (!val) return;
    if (val === 'all') this.selectAll();
    else if (val === 'clear') this.deselectAll();
    else if (val.startsWith('select_last_')) {
      const n = parseInt(val.replace('select_last_', ''), 10);
      this.selectLast(n);
    } else if (val.startsWith('deselect_last_')) {
      const n = parseInt(val.replace('deselect_last_', ''), 10);
      this.deselectLast(n);
    } else if (val.startsWith('select_first_')) {
      const n = parseInt(val.replace('select_first_', ''), 10);
      this.selectFirst(n);
    } else if (val.startsWith('deselect_first_')) {
      const n = parseInt(val.replace('deselect_first_', ''), 10);
      this.deselectFirst(n);
    }
  },

  applyCustomCount(action) {
    const input = document.getElementById('playlist-custom-num');
    const n = input ? parseInt(input.value, 10) : 50;
    if (!n || n <= 0) {
      App.showToast("Enter a valid number of songs.");
      return;
    }
    if (action === 'select_last') this.selectLast(n);
    else if (action === 'deselect_last') this.deselectLast(n);
    else if (action === 'select_first') this.selectFirst(n);
    else if (action === 'deselect_first') this.deselectFirst(n);
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

    const lineBtn = document.getElementById('btn-download-line-by-line');
    const zipBtn = document.getElementById('btn-download-playlist-batch');
    const disabled = selectedCount === 0;

    if (lineBtn) {
      lineBtn.disabled = disabled;
      lineBtn.innerHTML = `
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
        DOWNLOAD ${selectedCount} TRACKS (ONE BY ONE TO DEVICE)
      `;
    }

    if (zipBtn) {
      zipBtn.disabled = disabled;
      zipBtn.innerHTML = `
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="21 8 21 21 3 21 3 8"></polyline><rect x="1" y="3" width="22" height="5"></rect><line x1="10" y1="12" x2="14" y2="12"></line></svg>
        DOWNLOAD ${selectedCount} AS ZIP FOLDER
      `;
    }
  },

  /* ============================================================
     LINE-BY-LINE INDEPENDENT DIRECT DEVICE DOWNLOAD
     Downloads tracks one by one, saving directly to Downloads folder.
     If one track fails, skips gracefully without interrupting others.
  ============================================================ */
  async startLineByLineDownload() {
    if (!this.currentPlaylist || this.selectedTrackIds.size === 0) {
      App.showToast("Select at least one track to download.");
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

    this.shouldCancelBatch = false;
    this.isBatchDownloading = true;
    this.isPaused = false;
    this.failedTracks = [];

    const total = selectedTracks.length;
    let successCount = 0;

    for (let i = 0; i < total; i++) {
      if (this.shouldCancelBatch) {
        if (statusBadge) statusBadge.textContent = 'CANCELLED';
        if (speedLabel) speedLabel.textContent = 'Batch stopped by user.';
        this.isBatchDownloading = false;
        return;
      }

      while (this.isPaused) {
        if (this.shouldCancelBatch) return;
        await new Promise(r => setTimeout(r, 400));
      }

      const track = selectedTracks[i];
      const trackNum = i + 1;
      const cleanTitle = `${String(track.index || trackNum).padStart(2, '0')} - ${(track.title || 'Track').replace(/[/\\?%*:|"<>]/g, '_')}`;

      const progressPct = Math.round((i / total) * 100);
      if (barFill) barFill.style.width = `${Math.max(progressPct, 4)}%`;
      if (pctLabel) pctLabel.textContent = `${progressPct}%`;
      if (statusBadge) {
        statusBadge.textContent = `DOWNLOADING (${trackNum}/${total})`;
        statusBadge.style.color = 'var(--gold-core)';
      }
      if (speedLabel) speedLabel.textContent = `Saving track ${trackNum} of ${total}: "${track.title.slice(0, 36)}..."`;
      if (metaLabel) metaLabel.textContent = `${successCount} saved • ${this.failedTracks.length} skipped • ${total - i} remaining`;

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

        // Trigger browser direct file save
        const a = document.createElement('a');
        a.href = streamUrl;
        a.download = `${cleanTitle}.mp3`;
        a.target = '_blank';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        successCount++;
        // Short breathing pause to let phone/desktop queue file downloads smoothly
        await new Promise(r => setTimeout(r, 900));

      } catch (err) {
        console.warn(`Track ${trackNum} download error:`, err);
        this.failedTracks.push({
          index: trackNum,
          track: track,
          error: err.message || 'Stream error'
        });
        this.renderFailedTracksList();
        App.showToast(`Track "${track.title.slice(0, 24)}" skipped (unavailable) — continuing remaining songs.`);
        await new Promise(r => setTimeout(r, 400));
      }
    }

    if (barFill) barFill.style.width = '100%';
    if (pctLabel) pctLabel.textContent = '100%';
    if (statusBadge) {
      statusBadge.textContent = 'BATCH COMPLETE';
      statusBadge.style.color = 'var(--neon-green)';
    }
    if (speedLabel) {
      speedLabel.textContent = `Done! ${successCount} songs saved directly to your device.` + 
        (this.failedTracks.length > 0 ? ` (${this.failedTracks.length} skipped - click Retry below)` : '');
    }
    if (typeof VideoDownloader !== 'undefined') {
      VideoDownloader.updatePlanetStage('playlist-planet-sphere', 'playlist-planet-name', 100);
    }
    this.isBatchDownloading = false;
    App.showToast(`✓ Completed line-by-line download of ${successCount} songs!`);
  },

  /* ============================================================
     ZIP ARCHIVE BUNDLER (WITH JSZIP & PURE AUDIO STREAM)
  ============================================================ */
  async startBatchZipDownload() {
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

    if (statusBadge) statusBadge.textContent = 'PREPARING ZIP FOLDER';
    if (pctLabel) pctLabel.textContent = '0%';
    if (barFill) barFill.style.width = '3%';
    if (speedLabel) speedLabel.textContent = `Batch of ${selectedTracks.length} tracks queued for ZIP...`;
    if (metaLabel) metaLabel.textContent = 'Initializing ZIP archive container...';

    this.shouldCancelBatch = false;
    this.isBatchDownloading = true;
    this.failedTracks = [];

    const zip = (typeof JSZip !== 'undefined') ? new JSZip() : null;
    if (!zip) {
      App.showToast("ZIP engine initializing — downloading line-by-line instead.");
      return this.startLineByLineDownload();
    }

    const folderName = (this.currentPlaylist.playlist_title || "Playlist").replace(/[/\\?%*:|"<>]/g, '_');
    const zipFolder = zip.folder(folderName);
    const total = selectedTracks.length;
    let completed = 0;

    for (let i = 0; i < total; i++) {
      if (this.shouldCancelBatch) {
        if (statusBadge) statusBadge.textContent = 'CANCELLED';
        if (speedLabel) speedLabel.textContent = 'Batch stopped by user.';
        this.isBatchDownloading = false;
        return;
      }

      while (this.isPaused) {
        if (this.shouldCancelBatch) return;
        await new Promise(r => setTimeout(r, 400));
      }

      const track = selectedTracks[i];
      const trackIndex = i + 1;
      const cleanTitle = `${String(trackIndex).padStart(2, '0')} - ${(track.title || 'Track').replace(/[/\\?%*:|"<>]/g, '_')}`;

      const progressPct = Math.round((i / total) * 85);
      if (barFill) barFill.style.width = `${Math.max(progressPct, 4)}%`;
      if (pctLabel) pctLabel.textContent = `${progressPct}%`;
      if (statusBadge) statusBadge.textContent = `ADDING TO ZIP (${trackIndex}/${total})`;
      if (speedLabel) speedLabel.textContent = `Fetching audio for "${track.title.slice(0, 36)}..."`;
      if (metaLabel) metaLabel.textContent = `${completed} bundled • ${this.failedTracks.length} skipped • ${total - i} remaining`;

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
          throw new Error(`HTTP ${resp.status}`);
        }
      } catch (e) {
        console.warn(`Failed track ${trackIndex}:`, e);
        this.failedTracks.push({ index: trackIndex, track: track, error: e.message || 'Stream error' });
        this.renderFailedTracksList();
        App.showToast(`Track "${track.title.slice(0, 20)}" skipped — continuing ZIP build.`);
      }
    }

    if (completed === 0) {
      App.showToast("Could not download audio streams for ZIP.");
      if (statusBadge) statusBadge.textContent = 'FAILED';
      this.isBatchDownloading = false;
      return;
    }

    // Build ZIP Blob
    if (statusBadge) statusBadge.textContent = 'PACKAGING ZIP';
    if (speedLabel) speedLabel.textContent = `Compressing ${completed} MP3 songs into "${folderName}.zip"...`;
    if (barFill) barFill.style.width = '92%';
    if (pctLabel) pctLabel.textContent = '92%';

    const zipBlob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 4 }
    }, (meta) => {
      const zPct = Math.round(90 + (meta.percent * 0.1));
      if (barFill) barFill.style.width = `${zPct}%`;
      if (pctLabel) pctLabel.textContent = `${zPct}%`;
    });

    if (barFill) barFill.style.width = '100%';
    if (pctLabel) pctLabel.textContent = '100%';
    if (statusBadge) {
      statusBadge.textContent = 'COMPLETE';
      statusBadge.style.color = 'var(--neon-green)';
    }
    if (speedLabel) speedLabel.textContent = `All ${completed} songs bundled! Saving ZIP folder to device...`;

    const zipFileName = `${folderName}_[AUDIO_FOLDER].zip`;
    const zipUrl = URL.createObjectURL(zipBlob);

    if (metaLabel) {
      metaLabel.innerHTML = `
        <a href="${zipUrl}" class="btn-job-action btn-gold" style="text-decoration:none; display:inline-flex; align-items:center; gap:0.4rem; padding: 0.5rem 1rem; font-weight:800;" download="${zipFileName}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          TAP TO SAVE "${zipFileName}"
        </a>
      `;
    }

    const link = document.createElement('a');
    link.href = zipUrl;
    link.download = zipFileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    App.showToast(`✓ Downloaded ${completed} songs in ZIP folder "${zipFileName}"!`);
    this.isBatchDownloading = false;
  },

  /* Render list of failed / skipped songs with 1-click retry */
  renderFailedTracksList() {
    const panel = document.getElementById('playlist-failed-panel');
    const countEl = document.getElementById('failed-tracks-count');
    const listEl = document.getElementById('failed-tracks-list');
    if (!panel || !listEl) return;

    if (this.failedTracks.length === 0) {
      panel.style.display = 'none';
      return;
    }

    if (countEl) countEl.textContent = this.failedTracks.length;
    listEl.innerHTML = '';

    this.failedTracks.forEach((item, fIdx) => {
      const row = document.createElement('div');
      row.className = 'failed-track-row';
      row.innerHTML = `
        <div style="display:flex; align-items:center; gap:0.5rem; overflow:hidden;">
          <span style="color:var(--crimson-core); font-weight:700;">#${item.index || fIdx + 1}</span>
          <span style="color:#ffffff; text-overflow:ellipsis; white-space:nowrap; overflow:hidden;" title="${item.track.title}">${item.track.title}</span>
        </div>
        <button class="btn-tool-sm btn-tool-gold" onclick="PlaylistStudio.retrySingleFailed(${fIdx})">↺ RETRY</button>
      `;
      listEl.appendChild(row);
    });

    panel.style.display = 'block';
  },

  retrySingleFailed(fIdx) {
    if (!this.failedTracks || !this.failedTracks[fIdx]) return;
    const item = this.failedTracks[fIdx];
    AudioHub.downloadFromUrl(
      item.track.url,
      '320k',
      encodeURIComponent(item.track.title),
      encodeURIComponent(item.track.artist),
      encodeURIComponent(item.track.thumbnail)
    );
  },

  retryAllFailed() {
    if (!this.failedTracks || this.failedTracks.length === 0) {
      App.showToast("No failed tracks to retry.");
      return;
    }
    const toRetry = [...this.failedTracks];
    this.failedTracks = [];
    this.renderFailedTracksList();
    this.selectedTrackIds.clear();
    toRetry.forEach(item => this.selectedTrackIds.add(item.track.id));
    this.updateSelectionCounters();
    this.startLineByLineDownload();
  },

  togglePause() {
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
  },

  cancel() {
    this.shouldCancelBatch = true;
    this.isBatchDownloading = false;

    const statusBadge = document.getElementById('playlist-progress-status');
    const speedLabel = document.getElementById('playlist-progress-speed');
    const sphere = document.getElementById('playlist-planet-sphere');
    const barFill = document.getElementById('playlist-progress-fill');

    if (statusBadge) statusBadge.textContent = 'CANCELLED';
    if (speedLabel) speedLabel.textContent = 'Batch stopped by user.';
    if (sphere) sphere.classList.remove('is-paused');
    if (barFill) barFill.classList.remove('is-paused');

    App.showToast("Playlist download cancelled.");
    setTimeout(() => {
      const progressPanel = document.getElementById('playlist-download-progress');
      if (progressPanel) progressPanel.style.display = 'none';
      this.isPaused = false;
    }, 1500);
  }
};
