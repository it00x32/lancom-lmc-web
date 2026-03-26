import S from '../lib/state.js';
import { escHtml, deviceName, isOnline } from '../lib/helpers.js';

let tvInterval = null;
let tvSlide = 0;
let tvActive = false;

function enterTvMode() {
  tvActive = true;
  tvSlide = 0;
  const overlay = document.getElementById('tv-overlay');
  overlay.style.display = 'flex';
  document.documentElement.requestFullscreen?.().catch(() => {});
  renderTvSlide();
  tvInterval = setInterval(() => { tvSlide = (tvSlide + 1) % 4; renderTvSlide(); }, 8000);
}

function exitTvMode() {
  tvActive = false;
  clearInterval(tvInterval); tvInterval = null;
  document.getElementById('tv-overlay').style.display = 'none';
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}

function renderTvSlide() {
  const content = document.getElementById('tv-content');
  const dots = document.getElementById('tv-dots');
  if (!content) return;

  const devs = Object.values(S.devices);
  const total = devs.length;
  const online = devs.filter(d => isOnline(d)).length;
  const offline = total - online;

  // Clock
  const now = new Date();
  document.getElementById('tv-clock').textContent = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  document.getElementById('tv-date').textContent = now.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  // Dots
  dots.innerHTML = [0, 1, 2, 3].map(i => `<span class="tv-dot${i === tvSlide ? ' tv-dot-active' : ''}"></span>`).join('');

  let html = '';
  if (tvSlide === 0) {
    // Device overview
    const onPct = total > 0 ? Math.round(online / total * 100) : 0;
    html = `<div class="tv-slide-title">Geräte-Status</div>
      <div class="tv-big-numbers">
        <div class="tv-big"><div class="tv-big-val tv-green">${online}</div><div class="tv-big-lbl">Online</div></div>
        <div class="tv-big"><div class="tv-big-val tv-red">${offline}</div><div class="tv-big-lbl">Offline</div></div>
        <div class="tv-big"><div class="tv-big-val">${total}</div><div class="tv-big-lbl">Gesamt</div></div>
        <div class="tv-big"><div class="tv-big-val" style="color:${onPct >= 90 ? 'var(--green)' : onPct >= 70 ? 'var(--amber)' : 'var(--red)'}">${onPct}%</div><div class="tv-big-lbl">Verfügbarkeit</div></div>
      </div>
      <div class="tv-device-bar"><div class="tv-device-bar-on" style="width:${onPct}%"></div></div>
      <div class="tv-device-legend"><span class="tv-green">● Online ${online}</span><span class="tv-red">● Offline ${offline}</span></div>`;
  } else if (tvSlide === 1) {
    // Device types
    const byType = {};
    devs.forEach(d => { const t = d.status?.type || 'UNKNOWN'; byType[t] = (byType[t] || 0) + 1; });
    const typeLabels = { ROUTER: 'Router', ACCESS_POINT: 'Access Points', SWITCH: 'Switches', FIREWALL: 'Firewalls' };
    const typeIcons = { ROUTER: 'fa-globe', ACCESS_POINT: 'fa-wifi', SWITCH: 'fa-network-wired', FIREWALL: 'fa-shield-halved' };
    html = `<div class="tv-slide-title">Geräte-Typen</div><div class="tv-type-grid">`;
    for (const [t, c] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
      html += `<div class="tv-type-card"><i class="fa-solid ${typeIcons[t] || 'fa-server'}" style="font-size:32px;color:var(--accent2);margin-bottom:12px"></i><div class="tv-big-val">${c}</div><div class="tv-big-lbl">${typeLabels[t] || t}</div></div>`;
    }
    html += `</div>`;
  } else if (tvSlide === 2) {
    // Firmware status
    const releaseTypes = {};
    devs.forEach(d => { const rt = d.status?.fwReleaseType || 'UNKNOWN'; releaseTypes[rt] = (releaseTypes[rt] || 0) + 1; });
    const rtColors = { RELEASE: '#34d97b', RELEASE_UPDATE: '#2dd4bf', SECURITY_UPDATE: '#fbbf24', DEBUG: '#f05568' };
    html = `<div class="tv-slide-title">Firmware-Status</div><div class="tv-big-numbers">`;
    for (const [rt, count] of Object.entries(releaseTypes).sort((a, b) => b[1] - a[1])) {
      html += `<div class="tv-big"><div class="tv-big-val" style="color:${rtColors[rt] || '#9ca3af'}">${count}</div><div class="tv-big-lbl">${rt.replace(/_/g, ' ')}</div></div>`;
    }
    html += `</div>`;
  } else {
    // Sites
    const sites = {};
    devs.forEach(d => { const s = d.siteName || 'Kein Standort'; if (!sites[s]) sites[s] = { total: 0, online: 0 }; sites[s].total++; if (isOnline(d)) sites[s].online++; });
    html = `<div class="tv-slide-title">Standorte</div><div class="tv-site-grid">`;
    for (const [name, s] of Object.entries(sites).sort((a, b) => b[1].total - a[1].total)) {
      const allOn = s.online === s.total;
      html += `<div class="tv-site-card"><div class="tv-site-dot" style="background:${allOn ? 'var(--green)' : s.online > 0 ? 'var(--amber)' : 'var(--red)'}"></div><div class="tv-site-name">${escHtml(name)}</div><div class="tv-site-count">${s.online}/${s.total}</div></div>`;
    }
    html += `</div>`;
  }

  content.innerHTML = html;
}

function resetTvState() { exitTvMode(); }

export { enterTvMode, exitTvMode, renderTvSlide, resetTvState };
