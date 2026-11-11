/**
 * EVERYTHING FREE — A PRISON-LESS DIGITAL LIFE
 * Inspired by Artem Militonian (war.artmilitonian.com)
 * Core App Controller: Scroll Effects, Particle Canvas, Navigation & Toasts
 */

// Production API Base URL (reads from localStorage if user connects custom Render backend, or relative /api)
window.API_BASE = localStorage.getItem('API_BASE') || window.API_BASE || '';

const App = {
  activeTab: 'video',

  parseError(data, fallback = "An error occurred.") {
    if (!data) return fallback;
    if (typeof data === 'string') return data;
    const detail = data.detail || data.error || data.message;
    if (!detail) return fallback;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) {
      return detail.map(d => (typeof d === 'string' ? d : d.msg || JSON.stringify(d))).join(', ');
    }
    return JSON.stringify(detail);
  },

  init() {
    this.setupScrollProgress();
    this.setupParticleCanvas();
    this.setupTabs();
    this.setupClipboardButtons();
    this.updateEngineStatus();
  },

  setupScrollProgress() {
    const bar = document.getElementById('scroll-progress-bar');
    if (!bar) return;

    window.addEventListener('scroll', () => {
      const scrollTop = document.documentElement.scrollTop || document.body.scrollTop;
      const scrollHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
      const progress = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;
      bar.style.width = `${progress}%`;
    }, { passive: true });
  },

  setupParticleCanvas() {
    const canvas = document.getElementById('ambient-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    let width = canvas.width = window.innerWidth;
    let height = canvas.height = window.innerHeight;

    window.addEventListener('resize', () => {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    });

    const particles = [];
    const count = Math.min(Math.floor(width / 24), 60);

    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        radius: Math.random() * 1.6 + 0.4,
        vx: (Math.random() - 0.5) * 0.3,
        vy: -Math.random() * 0.5 - 0.2, // float upward
        alpha: Math.random() * 0.6 + 0.2,
        color: Math.random() > 0.4 ? '255, 42, 75' : '255, 255, 255'
      });
    }

    function render() {
      ctx.clearRect(0, 0, width, height);

      particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;

        if (p.y < 0) {
          p.y = height + 10;
          p.x = Math.random() * width;
        }
        if (p.x < 0) p.x = width;
        if (p.x > width) p.x = 0;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.color}, ${p.alpha})`;
        ctx.shadowBlur = 8;
        ctx.shadowColor = `rgba(${p.color}, 0.8)`;
        ctx.fill();
      });

      requestAnimationFrame(render);
    }

    render();
  },

  setupTabs() {
    const tabs = document.querySelectorAll('.nav-tab-btn');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.tab;
        this.switchTab(target);
      });
    });
  },

  switchTab(tabName) {
    this.activeTab = tabName;

    document.querySelectorAll('.nav-tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    document.querySelectorAll('.tab-view-content').forEach(view => {
      view.style.display = view.id === `view-${tabName}` ? 'block' : 'none';
    });
  },

  setupClipboardButtons() {
    document.querySelectorAll('.btn-paste').forEach(btn => {
      btn.addEventListener('click', async () => {
        const targetInputId = btn.dataset.target;
        const inputEl = document.getElementById(targetInputId);
        if (!inputEl) return;

        try {
          if (navigator.clipboard && navigator.clipboard.readText) {
            const text = await navigator.clipboard.readText();
            if (text && text.trim()) {
              inputEl.value = text.trim();
              inputEl.focus();
              App.showToast("✓ Link pasted from clipboard!");
              if (text.startsWith('http')) {
                if (targetInputId === 'video-url-input') {
                  VideoDownloader.analyze();
                } else if (targetInputId === 'playlist-url-input') {
                  PlaylistStudio.analyze();
                } else if (targetInputId === 'audio-search-input') {
                  AudioHub.searchOrAnalyze();
                }
              }
              return;
            }
          }
          inputEl.focus();
          App.showToast("Tap inside the box to paste your copied link");
        } catch (err) {
          inputEl.focus();
          App.showToast("Tap inside the box to paste your copied link");
        }
      });
    });
  },

  openEngineModal() {
    const modal = document.getElementById('engine-modal');
    if (!modal) return;
    const input = document.getElementById('engine-url-input');
    if (input) input.value = localStorage.getItem('API_BASE') || '';
    const resBox = document.getElementById('engine-test-result');
    if (resBox) resBox.style.display = 'none';
    modal.style.display = 'flex';
  },

  closeEngineModal() {
    const modal = document.getElementById('engine-modal');
    if (modal) modal.style.display = 'none';
  },

  async saveEngineUrl() {
    const input = document.getElementById('engine-url-input');
    const resBox = document.getElementById('engine-test-result');
    if (!input || !resBox) return;

    let url = input.value.trim();
    if (!url) {
      this.resetEngineUrl();
      return;
    }
    url = url.replace(/\/+$/, '');

    resBox.style.display = 'block';
    resBox.style.background = 'rgba(255, 255, 255, 0.05)';
    resBox.style.color = '#ffffff';
    resBox.innerHTML = `Pinging <code>${url}/api/health</code>...`;

    try {
      const res = await fetch(`${url}/api/health`, { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to reach backend`);
      const data = await res.json();
      
      localStorage.setItem('API_BASE', url);
      window.API_BASE = url;

      resBox.style.background = 'rgba(0, 255, 136, 0.12)';
      resBox.style.color = '#00ff88';
      resBox.style.border = '1px solid rgba(0, 255, 136, 0.4)';
      resBox.innerHTML = `
        <strong>✓ CONNECTED SUCCESSFULLY!</strong><br>
        Engine: ${data.service || 'Everything Free Studio'}<br>
        FFmpeg 9.0: <strong>${data.ffmpeg ? 'ACTIVE (Full 4K & MP3 Muxing)' : 'Disabled'}</strong>
      `;

      this.updateEngineStatus();
      App.showToast("✓ Connected to Render Cloud Engine!");

      setTimeout(() => {
        this.closeEngineModal();
      }, 1800);

    } catch (err) {
      resBox.style.background = 'rgba(255, 42, 75, 0.12)';
      resBox.style.color = '#ff2a4b';
      resBox.style.border = '1px solid rgba(255, 42, 75, 0.4)';
      resBox.innerHTML = `
        <strong>✗ CONNECTION FAILED</strong><br>
        ${err.message}<br>
        <small>Verify that your Render service is finished building and shows "Live".</small>
      `;
    }
  },

  resetEngineUrl() {
    localStorage.removeItem('API_BASE');
    window.API_BASE = '';
    const input = document.getElementById('engine-url-input');
    if (input) input.value = '';
    const resBox = document.getElementById('engine-test-result');
    if (resBox) {
      resBox.style.display = 'block';
      resBox.style.background = 'rgba(255, 255, 255, 0.05)';
      resBox.style.color = '#ffffff';
      resBox.style.border = 'none';
      resBox.innerHTML = 'Reset to default Vercel Edge routing.';
    }
    this.updateEngineStatus();
    App.showToast("Reset to default Vercel routing");
    setTimeout(() => {
      this.closeEngineModal();
    }, 1200);
  },

  updateEngineStatus() {
    const dot = document.getElementById('engine-status-dot');
    const label = document.getElementById('engine-status-label');
    const customUrl = localStorage.getItem('API_BASE');

    if (customUrl) {
      if (dot) dot.classList.add('connected');
      if (label) label.textContent = 'RENDER CLOUD';
    } else {
      if (dot) dot.classList.remove('connected');
      if (label) label.textContent = 'ENGINE';
    }
  },

  showToast(message) {
    let toast = document.getElementById('global-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'global-toast';
      toast.style.position = 'fixed';
      toast.style.bottom = '24px';
      toast.style.right = '24px';
      toast.style.backgroundColor = '#11090d';
      toast.style.color = '#ffffff';
      toast.style.border = '1px solid #ff2a4b';
      toast.style.padding = '12px 20px';
      toast.style.borderRadius = '4px';
      toast.style.fontFamily = 'var(--font-mono)';
      toast.style.fontSize = '0.82rem';
      toast.style.boxShadow = '0 0 25px rgba(255, 42, 75, 0.4)';
      toast.style.zIndex = '99999';
      toast.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(8px)';
    }, 3800);
  }
};

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
