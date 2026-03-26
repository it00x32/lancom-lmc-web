import S from '../lib/state.js';
import { escHtml, deviceName, isOnline } from '../lib/helpers.js';
import { api } from '../lib/api.js';

// ─── SITES TAB ────────────────────────────────────────────────────────────────
let sitesData = [];

async function loadSites() {
  const wrap  = document.getElementById('sites-grid');
  const badge = document.getElementById('badge-sites');
  if(!wrap) return;
  wrap.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><i class="fa-solid fa-circle-notch fa-spin" style="font-size:28px;color:var(--accent)"></i><p style="color:var(--text2);margin-top:10px">Lade Standorte…</p></div>';
  try {
    const data = await api('devices',`/accounts/${S.accountId}/sites`);
    sitesData  = Array.isArray(data) ? data : (data?.sites||[]);
    if(sitesData.length) renderSites();
    else renderSitesFromDevices();
  } catch(e) {
    renderSitesFromDevices();
  }
}

function renderSites() {
  const wrap  = document.getElementById('sites-grid');
  const cnt   = document.getElementById('sites-count');
  const badge = document.getElementById('badge-sites');
  if(!wrap) return;
  const items = sitesData.length ? sitesData : null;
  if(!items) { renderSitesFromDevices(); return; }
  if(cnt)   cnt.textContent   = items.length;
  if(badge) badge.textContent = items.length;
  let html = '';
  items.forEach(site => {
    const siteDevs = Object.values(S.devices).filter(d=>d.siteId===site.id||d.siteName===site.name);
    const online   = siteDevs.filter(d=>isOnline(d)).length;
    const alerts   = siteDevs.filter(d=>d.alerting?.hasAlert).length;
    const fwOld    = siteDevs.filter(d=>d.firmwareState==='OBSOLETE').length;
    html += siteCardHtml(site.name||(site.siteName||'Unbekannt'), siteDevs.length, online, alerts, fwOld, site.name||'');
  });
  wrap.innerHTML = html || '<div class="empty-state" style="grid-column:1/-1"><i class="fa-solid fa-location-dot"></i><h3>Keine Standorte</h3><p>Keine Standort-Daten vorhanden.</p></div>';
}

function renderSitesFromDevices() {
  const wrap  = document.getElementById('sites-grid');
  const cnt   = document.getElementById('sites-count');
  const badge = document.getElementById('badge-sites');
  if(!wrap) return;
  const map = {};
  Object.values(S.devices).forEach(d => {
    const n = d.siteName||'(kein Standort)';
    if(!map[n]) map[n] = {name:n, devices:[]};
    map[n].devices.push(d);
  });
  const sites = Object.values(map).sort((a,b)=>a.name.localeCompare(b.name));
  if(cnt)   cnt.textContent   = sites.length;
  if(badge) badge.textContent = sites.length||'–';
  if(!sites.length) { wrap.innerHTML='<div class="empty-state" style="grid-column:1/-1"><i class="fa-solid fa-location-dot"></i><h3>Keine Standorte</h3><p>Zuerst Geräte laden.</p></div>'; return; }
  wrap.innerHTML = sites.map(s => {
    const online = s.devices.filter(d=>isOnline(d)).length;
    const alerts = s.devices.filter(d=>d.alerting?.hasAlert).length;
    const fwOld  = s.devices.filter(d=>d.firmwareState==='OBSOLETE').length;
    return siteCardHtml(s.name, s.devices.length, online, alerts, fwOld, s.name);
  }).join('');
}

function siteCardHtml(name, total, online, alerts, fwOld, siteName) {
  return `<div class="site-card" onclick="showTab('devices');setTimeout(()=>{const btn=document.querySelector('#site-filter-group [data-site]');if(btn)setSiteFilter(${JSON.stringify(siteName)},document.querySelector('#site-filter-group [data-site=\\'+${JSON.stringify(siteName)}+'\\']')||document.createElement('button'));},200)">
    <div class="site-card-name"><i class="fa-solid fa-location-dot" style="color:var(--accent);font-size:13px;flex-shrink:0"></i><span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(name)}</span></div>
    <div class="site-stat-row">
      <div class="site-stat"><div class="site-stat-val" style="color:var(--text)">${total}</div><div class="site-stat-lbl">Gesamt</div></div>
      <div class="site-stat"><div class="site-stat-val" style="color:var(--green)">${online}</div><div class="site-stat-lbl">Online</div></div>
      <div class="site-stat"><div class="site-stat-val" style="color:var(--red)">${total-online}</div><div class="site-stat-lbl">Offline</div></div>
      ${alerts?`<div class="site-stat"><div class="site-stat-val" style="color:var(--amber)">${alerts}</div><div class="site-stat-lbl">Alerts</div></div>`:''}
      ${fwOld?`<div class="site-stat"><div class="site-stat-val" style="color:var(--blue)">${fwOld}</div><div class="site-stat-lbl">FW alt</div></div>`:''}
    </div>
  </div>`;
}

export { sitesData, loadSites, renderSites, renderSitesFromDevices, siteCardHtml };
