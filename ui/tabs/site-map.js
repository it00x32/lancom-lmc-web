import S from '../lib/state.js';
import { api } from '../lib/api.js';
import { escHtml, deviceName, isOnline } from '../lib/helpers.js';

let smData = null;
let smLoading = false;
let smMap = null;

async function loadSiteMap() {
  if (smLoading) return;
  smLoading = true;
  S._loaded.add('site-map');

  try {
    smData = await api('devices', `/accounts/${S.accountId}/sites`);
    if (!Array.isArray(smData)) smData = [];
  } catch (e) {
    console.warn('[SiteMap]', e);
    smData = [];
  }

  smLoading = false;
  renderSiteMap();
}

function renderSiteMap() {
  const wrap = document.getElementById('sm-wrap');
  if (!wrap) return;

  if (!smData || !smData.length) {
    wrap.innerHTML = '<div class="empty-state"><i class="fa-solid fa-map-location-dot"></i><h3>Keine Standorte</h3><p>Keine Standorte gefunden.</p></div>';
    return;
  }

  const withGps = smData.filter(s => s.position?.latitude && s.position?.longitude);
  const devsBySite = {};
  Object.values(S.devices).forEach(d => {
    const sid = d.siteId;
    if (sid) { if (!devsBySite[sid]) devsBySite[sid] = []; devsBySite[sid].push(d); }
  });

  const totalDevices = Object.keys(S.devices).length;
  const activeDevices = Object.values(S.devices).filter(d => isOnline(d)).length;

  let html = `<div class="sm-stats">
    <div class="sm-stat"><div class="sm-stat-icon" style="background:rgba(0,76,151,.15);color:var(--blue)"><i class="fa-solid fa-location-dot"></i></div><div><div class="sm-stat-val">${smData.length}</div><div class="sm-stat-lbl">Standorte</div></div></div>
    <div class="sm-stat"><div class="sm-stat-icon" style="background:rgba(52,217,123,.15);color:var(--green)"><i class="fa-solid fa-map-pin"></i></div><div><div class="sm-stat-val">${withGps.length}</div><div class="sm-stat-lbl">Mit GPS</div></div></div>
    <div class="sm-stat"><div class="sm-stat-icon" style="background:rgba(251,191,36,.15);color:var(--amber)"><i class="fa-solid fa-server"></i></div><div><div class="sm-stat-val">${totalDevices}</div><div class="sm-stat-lbl">Geräte</div></div></div>
    <div class="sm-stat"><div class="sm-stat-icon" style="background:rgba(52,217,123,.15);color:var(--green)"><i class="fa-solid fa-circle-check"></i></div><div><div class="sm-stat-val">${activeDevices}</div><div class="sm-stat-lbl">Online</div></div></div>
  </div>`;

  if (withGps.length) {
    html += `<div id="sm-map" style="height:420px;border-radius:var(--r);border:1px solid var(--border);margin:16px 24px 0;background:var(--card);position:relative;z-index:1"></div>`;
  }

  html += `<div class="sm-section"><div class="sm-section-title"><i class="fa-solid fa-list"></i> Alle Standorte</div><div class="sm-site-list">`;
  for (const site of smData) {
    const devs = devsBySite[site.id] || [];
    const onlineCount = devs.filter(d => isOnline(d)).length;
    const hasGps = site.position?.latitude && site.position?.longitude;
    const addr = site.address ? [site.address.street, site.address.zipCode, site.address.city].filter(Boolean).join(', ') : '';
    let sc = 'var(--text3)';
    if (devs.length > 0) sc = onlineCount === devs.length ? 'var(--green)' : onlineCount > 0 ? 'var(--amber)' : 'var(--red)';

    html += `<div class="sm-site-card">
      <div class="sm-site-head">
        <span style="color:${sc};font-size:10px"><i class="fa-solid fa-circle"></i></span>
        <span class="sm-site-name">${escHtml(site.name)}</span>
        <span class="sm-site-count">${devs.length} Geräte${onlineCount ? ` (${onlineCount} online)` : ''}</span>
        ${hasGps ? '<span class="sm-gps-badge"><i class="fa-solid fa-map-pin"></i> GPS</span>' : ''}
      </div>
      ${addr ? `<div class="sm-site-addr"><i class="fa-solid fa-location-dot" style="color:var(--text3);margin-right:4px"></i>${escHtml(addr)}</div>` : ''}
      ${devs.length ? `<div class="sm-site-devs">${devs.map(d => {
        const on = isOnline(d);
        return `<span class="sm-dev-pill" style="border-color:${on ? 'rgba(52,217,123,.3)' : 'rgba(240,85,104,.2)'}"><span class="sm-dev-dot" style="background:${on ? 'var(--green)' : 'var(--red)'}"></span>${escHtml(deviceName(d))} <span style="color:var(--text3);font-size:10px">${escHtml((d.status?.model || '').replace('LANCOM ', ''))}</span></span>`;
      }).join('')}</div>` : ''}
    </div>`;
  }
  html += `</div></div>`;
  wrap.innerHTML = html;

  if (withGps.length) initLeafletMap(withGps, devsBySite);
}

async function initLeafletMap(sites, devsBySite) {
  if (!window.L) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  const el = document.getElementById('sm-map');
  if (!el) return;
  if (smMap) { smMap.remove(); smMap = null; }

  smMap = L.map('sm-map', { scrollWheelZoom: true });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap', maxZoom: 18
  }).addTo(smMap);

  const bounds = [];
  for (const site of sites) {
    const lat = site.position.latitude, lng = site.position.longitude;
    bounds.push([lat, lng]);
    const devs = devsBySite[site.id] || [];
    const onlineCount = devs.filter(d => isOnline(d)).length;
    const total = devs.length;
    let color = '#6b7280';
    if (total > 0) color = onlineCount === total ? '#34d97b' : onlineCount > 0 ? '#fbbf24' : '#f05568';

    const marker = L.circleMarker([lat, lng], {
      radius: Math.max(8, Math.min(20, 6 + total * 2)),
      fillColor: color, color: 'rgba(255,255,255,.8)', weight: 2, fillOpacity: 0.85
    }).addTo(smMap);

    marker.bindPopup(`<div style="font-family:system-ui;min-width:160px">
      <strong style="font-size:14px">${escHtml(site.name)}</strong><br>
      <span style="color:#888;font-size:12px">${total} Geräte · ${onlineCount} online</span>
      ${devs.length ? '<hr style="margin:6px 0;border-color:#eee">' + devs.map(d => `<div style="font-size:11px;margin:2px 0"><span style="color:${isOnline(d) ? '#34d97b' : '#f05568'}">●</span> ${escHtml(deviceName(d))}</div>`).join('') : ''}
    </div>`);
  }

  if (bounds.length === 1) smMap.setView(bounds[0], 14);
  else smMap.fitBounds(bounds, { padding: [40, 40] });
}

function resetSmState() {
  smData = null; smLoading = false;
  if (smMap) { smMap.remove(); smMap = null; }
}

export { loadSiteMap, renderSiteMap, resetSmState };
