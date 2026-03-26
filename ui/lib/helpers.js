import S from './state.js';

function isOnline(d) {
  const s = d.heartbeatState || d.status?.heartbeatState || '';
  return typeof s === 'string' && s.toUpperCase() === 'ACTIVE';
}
// WAN logicalState: LANCOM uses eWan* enum values (e.g. "eWanInit" = active)
// "UP" covers REST-standard; anything with Disconnect/Idle/Down = inactive
function isWanUp(s) {
  if(!s) return false;
  const l = s.toLowerCase();
  return !(l.includes('disconnect') || l.includes('idle') || l === 'down' || l === 'false');
}
function fmtWanState(s) {
  if(!s) return '–';
  if(s === 'UP' || s === 'eWanInit' || s === 'eWanConnected') return 'UP';
  if(isWanUp(s)) return s.replace(/^eWan/, ''); // strip prefix → e.g. "Init"
  return s.replace(/^eWan/, ''); // show raw value without prefix
}
function fmt(v, unit='') { return (v===undefined||v===null||v==='') ? '–' : (v+unit); }
function fmtBytes(b) {
  if (!b && b!==0) return '–';
  b=Number(b); if(isNaN(b)) return '–';
  if(b<1024) return b+'B';
  if(b<1048576) return (b/1024).toFixed(1)+'K';
  if(b<1073741824) return (b/1048576).toFixed(1)+'M';
  return (b/1073741824).toFixed(2)+'G';
}
function fmtRate(kbps) {
  if(!kbps && kbps!==0) return '–';
  kbps=Number(kbps); if(isNaN(kbps)) return '–';
  return kbps<1000 ? kbps+'kbps' : (kbps/1000).toFixed(1)+'Mbps';
}
function signalLevel(rssi) {
  rssi=Number(rssi)||0;
  if(rssi>=-60) return 4;
  if(rssi>=-70) return 3;
  if(rssi>=-80) return 2;
  return 1;
}
function signalBar(rssi) {
  const lvl=signalLevel(rssi);
  return `<div class="signal-bar s${lvl}"><span></span><span></span><span></span><span></span></div>`;
}
function bandBadge(band) {
  if(!band) return '–';
  const b=band.toUpperCase();
  if(b.includes('6')) return '<span class="band-6">6 GHz</span>';
  if(b.includes('5')) return '<span class="band-5">5 GHz</span>';
  return '<span class="band-24">2.4 GHz</span>';
}
function statusDot(up, label='') {
  const cl = up ? 'sdot-green' : 'sdot-red';
  return `<span class="sdot ${cl}">${label||(up?'Up':'Down')}</span>`;
}
function escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function deviceName(d) {
  if(!d) return '–';
  return d.label||d.name||d.status?.name||d.status?.deviceLabel||d.siteName||d.id?.substring(0,8)||'–';
}

function fmtRelTime(ts) {
  if(!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff/60000);
  const h = Math.floor(m/60);
  const d = Math.floor(h/24);
  if(d>0) return `seit ${d}d ${h%24}h`;
  if(h>0) return `seit ${h}h ${m%60}m`;
  if(m>0) return `seit ${m}m`;
  return 'gerade eben';
}

function debounce(fn, ms) {
  let t; return function(...a) { clearTimeout(t); t=setTimeout(()=>fn.apply(this,a), ms); };
}

// ─── DIRTY TAB TRACKING ──────────────────────────────────────────────────────
const _dirtyTabs = new Set();
function markAllTabsDirty() {
  ['devices','wlan','vpn','wan','neighbors','lldp','topology','energy','lifecycle','firmware','sites'].forEach(t=>_dirtyTabs.add(t));
}
function renderTabIfActive(tabId, renderFn) {
  if(S.activeTab===tabId) renderFn();
  else _dirtyTabs.add(tabId);
}

const debouncedRenderDevices   = debounce(()=>window.renderDevices?.(),   150);
const debouncedRenderWlan      = debounce(()=>window.renderWlan?.(),      150);
const debouncedRenderVpn       = debounce(()=>window.renderVpn?.(),       150);
const debouncedRenderWan       = debounce(()=>window.renderWan?.(),       150);
const debouncedRenderNeighbors = debounce(()=>window.renderNeighbors?.(), 150);
const debouncedRenderLldp      = debounce(()=>window.renderLldp?.(),      150);
const debouncedRenderLogTable  = debounce(()=>window.renderLogTable?.(),  150);

const SEV_NAMES = ['Emergency','Alert','Critical','Error','Warning','Notice','Info','Debug'];
function sevName(sev)  { const n=parseInt(sev); return SEV_NAMES[n]||('Sev '+sev); }
function sevClass(sev) { const n=parseInt(sev); if(isNaN(n))return '6'; if(n<=2)return '0'; if(n<=3)return '2'; if(n<=5)return '4'; return '6'; }
function sevBadge(sev) {
  const n=parseInt(sev);
  if(n<=2) return {text:'CRIT', cls:'alert-sev-critical', color:'var(--red)'};
  if(n<=4) return {text:'WARN', cls:'alert-sev-warning',  color:'var(--amber)'};
  return      {text:'INFO', cls:'alert-sev-info',     color:'var(--text3)'};
}

export {
  isOnline, isWanUp, fmtWanState, fmt, fmtBytes, fmtRate, signalLevel, signalBar,
  bandBadge, statusDot, escHtml, deviceName, fmtRelTime, debounce,
  _dirtyTabs, markAllTabsDirty, renderTabIfActive,
  debouncedRenderDevices, debouncedRenderWlan, debouncedRenderVpn, debouncedRenderWan,
  debouncedRenderNeighbors, debouncedRenderLldp, debouncedRenderLogTable,
  sevName, sevClass, sevBadge,
};
