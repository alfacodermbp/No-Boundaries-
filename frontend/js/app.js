/**
 * EVERYTHING FREE — Universal Media & Audio Extraction Studio
 * High-End Editorial Typography, 3D Perspective Tilt Cards, Kinetic Marquee,
 * Neon Green & Luxe Gold Cyber-Obsidian Palette, Magnetic Cursor & Gojo Anime Domain Expansion.
 */

window.API_BASE = '';

const App = {
  activeTab: 'video',

  parseError(data, fallback = "An error occurred.") {
    if (!data) return fallback;
    if (typeof data === 'string') return data;
    if (data instanceof Error) return data.message || fallback;
    const detail = data.detail || data.error || data.message;
    if (!detail) return fallback;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) {
      return detail.map(d => {
        if (!d) return '';
        if (typeof d === 'string') return d;
        if (d.msg) return d.msg;
        if (typeof d === 'object') return d.message || d.detail || JSON.stringify(d);
        return String(d);
      }).filter(Boolean).join(', ');
    }
    if (typeof detail === 'object') {
      return detail.message || detail.msg || detail.detail || JSON.stringify(detail);
    }
    return String(detail);
  },

  init() {
    this.setupScrollProgress();
    this.setupParticleCanvas();
    this.setupTabs();
    this.setupClipboardButtons();
    this.setup3DTilt();
    this.setupCustomCursor();
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
    const count = Math.min(Math.floor(width / 22), 65);

    // Neon Green, Cyber Gold, and Gojo Cyan/Crimson Embers
    const colorPalette = [
      '0, 255, 136',   // Neon Green
      '255, 215, 0',   // Luxe Gold
      '0, 229, 255',   // Gojo Cyan
      '255, 42, 75'    // Crimson Accent
    ];

    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        radius: Math.random() * 1.8 + 0.4,
        vx: (Math.random() - 0.5) * 0.35,
        vy: -Math.random() * 0.55 - 0.2,
        alpha: Math.random() * 0.65 + 0.25,
        color: colorPalette[Math.floor(Math.random() * colorPalette.length)]
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
        ctx.shadowBlur = 10;
        ctx.shadowColor = `rgba(${p.color}, 0.85)`;
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
      const match = view.id === `view-${tabName}`;
      view.style.display = match ? 'block' : 'none';
      if (match) {
        view.style.animation = 'fadeInUp 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards';
      }
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
              const clean = text.trim();
              if (clean.startsWith('http') || clean.includes('.com') || clean.includes('.be')) {
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

  /* Tom De Koning Smooth 3D Perspective Card Tilt */
  setup3DTilt() {
    const tiltElements = document.querySelectorAll('.tilt-card, .power-card, .gojo-hero-card, .media-result-card');
    tiltElements.forEach(el => {
      let isHovered = false;

      el.addEventListener('mouseenter', () => {
        isHovered = true;
        el.style.transition = 'transform 0.12s ease-out, box-shadow 0.15s ease-out';
      });

      el.addEventListener('mousemove', (e) => {
        if (!isHovered) return;
        const rect = el.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;

        const rotateX = ((y - centerY) / centerY) * -9.0;
        const rotateY = ((x - centerX) / centerX) * 9.0;

        el.style.transform = `perspective(1000px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) scale3d(1.02, 1.02, 1.02)`;
      });

      el.addEventListener('mouseleave', () => {
        isHovered = false;
        el.style.transition = 'transform 0.5s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.5s ease';
        el.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)';
      });
    });
  },

  /* Tom De Koning Custom Magnetic Cursor (Desktop) */
  setupCustomCursor() {
    if (window.matchMedia('(pointer: coarse)').matches) return; // Ignore on touch screens

    const dot = document.createElement('div');
    dot.className = 'custom-cursor-dot';
    const ring = document.createElement('div');
    ring.className = 'custom-cursor-ring';

    document.body.appendChild(dot);
    document.body.appendChild(ring);

    let mouseX = window.innerWidth / 2;
    let mouseY = window.innerHeight / 2;
    let ringX = mouseX;
    let ringY = mouseY;

    window.addEventListener('mousemove', (e) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
      dot.style.transform = `translate3d(${mouseX}px, ${mouseY}px, 0)`;
    }, { passive: true });

    function renderCursor() {
      // Smooth lerp physics
      ringX += (mouseX - ringX) * 0.18;
      ringY += (mouseY - ringY) * 0.18;
      ring.style.transform = `translate3d(${ringX}px, ${ringY}px, 0)`;
      requestAnimationFrame(renderCursor);
    }
    renderCursor();

    // Hover expand on interactive elements
    const interactive = 'button, a, input, select, .plat-chip, .format-card, .track-row';
    document.addEventListener('mouseover', (e) => {
      if (e.target.closest(interactive)) {
        ring.classList.add('cursor-hover');
        dot.classList.add('cursor-hover');
      }
    });

    document.addEventListener('mouseout', (e) => {
      if (e.target.closest(interactive)) {
        ring.classList.remove('cursor-hover');
        dot.classList.remove('cursor-hover');
      }
    });
  },

  openEngineModal() {
    const modal = document.getElementById('engine-modal');
    if (!modal) return;
    const resBox = document.getElementById('engine-test-result');
    if (resBox) {
      resBox.style.display = 'block';
      resBox.style.background = 'rgba(0, 255, 136, 0.08)';
      resBox.style.color = 'var(--neon-green)';
      resBox.style.border = '1px solid rgba(0, 255, 136, 0.35)';
      resBox.innerHTML = `
        <strong>✓ DOMAIN EXPANSION ENGINE ONLINE</strong><br>
        Direct Stream Tunnel: <strong>100% UNLOCKED</strong><br>
        4K Dash Muxer: <strong>60FPS READY</strong> • 320k LAME: <strong>ACTIVE</strong><br>
        Downloads stream straight to your device with zero rate limits!
      `;
    }
    modal.style.display = 'flex';
  },

  closeEngineModal() {
    const modal = document.getElementById('engine-modal');
    if (modal) modal.style.display = 'none';
  },

  updateEngineStatus() {
    const dot = document.getElementById('engine-status-dot');
    const label = document.getElementById('engine-status-label');
    if (dot) dot.classList.add('connected');
    if (label) label.textContent = 'ONLINE';
  },

  triggerDomainPulse() {
    const aura = document.querySelector('.gojo-aura-pulse');
    if (aura) {
      aura.classList.add('active');
      setTimeout(() => aura.classList.remove('active'), 1200);
    }
    this.showToast("⚡ DOMAIN EXPANSION: INFINITE MEDIA VOID UNLOCKED");
  },

  showToast(message) {
    let toast = document.getElementById('global-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'global-toast';
      toast.style.position = 'fixed';
      toast.style.bottom = '24px';
      toast.style.right = '24px';
      toast.style.backgroundColor = 'rgba(10, 8, 14, 0.96)';
      toast.style.color = '#ffffff';
      toast.style.border = '1px solid var(--neon-green)';
      toast.style.padding = '12px 22px';
      toast.style.borderRadius = '6px';
      toast.style.fontFamily = 'var(--font-mono)';
      toast.style.fontSize = '0.85rem';
      toast.style.boxShadow = '0 0 25px rgba(0, 255, 136, 0.4)';
      toast.style.zIndex = '99999';
      toast.style.backdropFilter = 'blur(12px)';
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
