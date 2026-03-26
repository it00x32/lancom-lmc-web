import S from './lib/state.js';
import { escHtml, deviceName, isOnline } from './lib/helpers.js';

function openSearch() {
  const overlay = document.getElementById('search-overlay');
  overlay.style.display = 'flex';
  const inp = document.getElementById('search-modal-input');
  inp.value = '';
  inp.focus();
  runSearch('');
}
function closeSearch() {
  document.getElementById('search-overlay').style.display = 'none';
}
function runSearch(q) {
  const results = document.getElementById('search-results');
  const lq = (q||'').toLowerCase().trim();
  if(!lq || lq.length < 2) {
    results.innerHTML = `<div class="search-hint"><i class="fa-solid fa-magnifying-glass" style="font-size:28px;color:var(--text3);margin-bottom:12px;display:block;opacity:.5"></i>Mindestens 2 Zeichen eingeben…</div>`;
    return;
  }
  let html = '';

  // Devices
  const devHits = Object.values(S.devices).filter(d => {
    const f = [d.label,d.name,d.siteName,d.status?.name,d.status?.model,d.status?.serial,d.status?.ip].filter(Boolean);
    return f.some(x => String(x).toLowerCase().includes(lq));
  }).slice(0, 8);
  if(devHits.length) {
    html += `<div class="search-section-header"><i class="fa-solid fa-server" style="margin-right:5px"></i>Geräte</div>`;
    html += devHits.map(d => {
      const name = deviceName(d);
      const sub = [d.status?.model, d.siteName, d.status?.ip].filter(Boolean).join(' · ');
      const dot = isOnline(d) ? '#1a8a3e' : '#d32f2f';
      return `<div class="search-result-item" onclick="closeSearch();showTab('devices');setTimeout(()=>{const el=document.getElementById('card-${d.id}');if(el){el.scrollIntoView({behavior:'smooth',block:'center'});el.style.outline='2px solid var(--accent)';setTimeout(()=>{el.style.outline='';},2000);}},120)">
        <div class="search-result-icon" style="background:rgba(0,76,151,.1)"><span style="width:9px;height:9px;border-radius:50%;background:${dot};display:inline-block"></span></div>
        <div style="min-width:0"><div class="search-result-name">${escHtml(name)}</div><div class="search-result-sub">${escHtml(sub)}</div></div>
        <span class="search-result-badge">Gerät</span>
      </div>`;
    }).join('');
  }

  // WLAN
  const wlanHits = S.wlanStations.filter(s => {
    const f = [s.mac, s.ip, s.name, s.ssid, s._deviceName, s.vendor].filter(Boolean);
    return f.some(x => String(x).toLowerCase().includes(lq));
  }).slice(0, 6);
  if(wlanHits.length) {
    html += `<div class="search-section-header"><i class="fa-solid fa-wifi" style="margin-right:5px"></i>WLAN Clients</div>`;
    html += wlanHits.map(s => {
      const sub = [s._deviceName, s.ssid, s.band].filter(Boolean).join(' · ');
      const searchVal = JSON.stringify(s.mac||s.name||'');
      return `<div class="search-result-item" onclick="closeSearch();showTab('wlan');setTimeout(()=>{const inp=document.getElementById('wlan-search');if(inp){inp.value=${searchVal};renderWlan();}},100)">
        <div class="search-result-icon" style="background:rgba(0,76,151,.12);color:var(--purple)"><i class="fa-solid fa-wifi" style="font-size:13px"></i></div>
        <div style="min-width:0"><div class="search-result-name">${escHtml(s.name||s.mac||'–')}</div><div class="search-result-sub">${escHtml(sub)}</div></div>
        <span class="search-result-badge">WLAN</span>
      </div>`;
    }).join('');
  }

  // VPN
  const vpnHits = S.vpnConnections.filter(c => {
    const f = [c._deviceName, c.peerName, c.networkName, c.peerIp].filter(Boolean);
    return f.some(x => String(x).toLowerCase().includes(lq));
  }).slice(0, 5);
  if(vpnHits.length) {
    html += `<div class="search-section-header"><i class="fa-solid fa-shield-halved" style="margin-right:5px"></i>VPN</div>`;
    html += vpnHits.map(c => `<div class="search-result-item" onclick="closeSearch();showTab('vpn')">
      <div class="search-result-icon" style="background:rgba(0,76,151,.12);color:var(--accent)"><i class="fa-solid fa-shield-halved" style="font-size:13px"></i></div>
      <div style="min-width:0"><div class="search-result-name">${escHtml(c.peerName||c.networkName||'–')}</div><div class="search-result-sub">${escHtml(c._deviceName||'')} ${c.peerIp?'→ '+escHtml(c.peerIp):''}</div></div>
      <span class="search-result-badge">VPN</span>
    </div>`).join('');
  }

  // WAN
  const wanHits = S.wanInterfaces.filter(w => {
    const f = [w._deviceName, w.interfaceName, w.name, w.ipV4, w.ipV6, w.ip, w.connectionType].filter(Boolean);
    return f.some(x => String(x).toLowerCase().includes(lq));
  }).slice(0, 4);
  if(wanHits.length) {
    html += `<div class="search-section-header"><i class="fa-solid fa-globe" style="margin-right:5px"></i>WAN</div>`;
    html += wanHits.map(w => `<div class="search-result-item" onclick="closeSearch();showTab('wan')">
      <div class="search-result-icon" style="background:rgba(0,76,151,.12);color:var(--blue)"><i class="fa-solid fa-globe" style="font-size:13px"></i></div>
      <div style="min-width:0"><div class="search-result-name">${escHtml(w.interfaceName||w.connectionType||w.name||'–')}</div><div class="search-result-sub">${escHtml(w._deviceName||'')} ${(w.ipV4||w.ipV6||w.ip)?'– '+escHtml(w.ipV4||w.ipV6||w.ip):''}</div></div>
      <span class="search-result-badge">WAN</span>
    </div>`).join('');
  }

  if(!html) {
    html = `<div class="search-hint"><i class="fa-solid fa-face-frown-open" style="font-size:28px;color:var(--text3);margin-bottom:12px;display:block;opacity:.5"></i>Keine Ergebnisse für „${escHtml(lq)}"</div>`;
  }
  results.innerHTML = html;
}
document.addEventListener('keydown', e => {
  if(e.key === '/' && !e.ctrlKey && !e.altKey && !e.metaKey) {
    const tag = (e.target.tagName||'').toLowerCase();
    if(tag !== 'input' && tag !== 'textarea' && tag !== 'select') { e.preventDefault(); openSearch(); }
  }
  if(e.key === 'Escape') { closeSearch(); window.ceMacTableClose?.(); }
});

export { openSearch, closeSearch, runSearch };
