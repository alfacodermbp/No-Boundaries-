/**
 * EVERYTHING FREE — A PRISON-LESS DIGITAL LIFE
 * Inspired by Artem Militonian (war.artmilitonian.com)
 * Core App Controller: Scroll Effects, Particle Canvas, Navigation & Toasts
 */

// Production API Base URL (empty string for relative /api with Vercel rewrites, or custom backend URL)
window.API_BASE = window.API_BASE || '';

const App = {
  activeTab: 'video',

  init() {
    this.setupScrollProgress();
    this.setupParticleCanvas();
    this.setupTabs();
    this.setupClipboardButtons();
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
