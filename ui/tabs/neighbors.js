import S from '../lib/state.js';
import { escHtml, signalBar, bandBadge } from '../lib/helpers.js';

let nbFilter = 'all';

function setNbFilter(f, btn) {
  nbFilter = f;
  document.querySelectorAll('#tab-neighbors .filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderNeighbors();
}

// ─── NEIGHBORS TABLE ──────────────────────────────────────────────────────────
function renderNeighbors() {
  const q = document.getElementById('nb-search').value.toLowerCase();
  let rows = S.wlanNeighbors.filter(n => {
    const band = (n.band || n.frequency || '').toUpperCase();
    if (nbFilter !== 'all' && !band.includes(nbFilter.replace('GHZ', ''))) return false;
    if (q) {
      const f = [n.ssid, n.bssid, n.mac, n._deviceName];
      if (!f.some(x => x && String(x).toLowerCase().includes(q))) return false;
    }
    return true;
  });
  document.getElementById('nb-count').textContent = rows.length;
  const ssids = new Set(rows.map(n => n.ssid || n.bssid).filter(Boolean)).size;
  document.getElementById('nb-mini-stats').innerHTML = `
    <div class="mini-stat"><div class="ms-icon" style="background:rgba(217,119,6,.15);color:var(--pink)"><i class="fa-solid fa-satellite-dish"></i></div><div><div class="ms-val" style="color:var(--pink)">${rows.length}</div><div class="ms-lbl">AP gesamt</div></div></div>
    <div class="mini-stat"><div class="ms-icon" style="background:rgba(0,76,151,.15);color:var(--accent)"><i class="fa-solid fa-broadcast-tower"></i></div><div><div class="ms-val" style="color:var(--accent)">${ssids}</div><div class="ms-lbl">Netze</div></div></div>`;
  const tbody = document.getElementById('nb-tbody');
  const empty = document.getElementById('nb-empty');
  if (!rows.length) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  // Sort by signal
  rows.sort((a, b) => (Number(b.rssi || b.signal || 0)) - (Number(a.rssi || a.signal || 0)));
  tbody.innerHTML = rows.map(n => {
    const rssi = n.rssi || n.signal || n.signalLevel || 0;
    const own = n.own === true || n.ownNetwork === true || n.isOwn === true;
    return `<tr>
      <td class="device-ref">${escHtml(n._deviceName)}</td>
      <td>${n.ssid ? `<strong>${escHtml(n.ssid)}</strong>` : '<span class="muted">(hidden)</span>'}</td>
      <td class="mono">${escHtml(n.bssid || n.mac || '–')}</td>
      <td>${bandBadge(n.band || n.frequency)}</td>
      <td class="muted">${n.channel || '–'}</td>
      <td style="display:flex;align-items:center;gap:6px">${rssi ? signalBar(rssi) : ''}<span class="muted" style="font-size:11px">${rssi ? rssi + 'dBm' : ''}</span></td>
      <td class="muted">${escHtml(n.security || n.encryption || n.authMode || '–')}</td>
      <td>${own ? '<span class="badge badge-online"><i class="fa-solid fa-check"></i>Ja</span>' : '<span class="muted">–</span>'}</td>
    </tr>`;
  }).join('');
}

export { renderNeighbors, nbFilter, setNbFilter };
