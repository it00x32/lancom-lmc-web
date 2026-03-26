import S from '../lib/state.js';
import { escHtml, statusDot, fmtBytes } from '../lib/helpers.js';

function renderVpn() {
  const q = document.getElementById('vpn-search').value.toLowerCase();
  let rows = S.vpnConnections.filter(v => !q || [v._deviceName, v.peerName, v.networkName, v.peerIp, v.type, v.hsvpn === true ? 'HSVPN' : 'IPsec'].some(x => x && String(x).toLowerCase().includes(q)));
  document.getElementById('vpn-count').textContent = rows.length;
  const upCount = rows.filter(v => v.active === true || v.active === 'true').length;
  document.getElementById('vpn-mini-stats').innerHTML = `
    <div class="mini-stat"><div class="ms-icon" style="background:rgba(0,76,151,.15);color:var(--accent)"><i class="fa-solid fa-shield-halved"></i></div><div><div class="ms-val" style="color:var(--accent)">${rows.length}</div><div class="ms-lbl">Gesamt</div></div></div>
    <div class="mini-stat"><div class="ms-icon" style="background:rgba(26,138,62,.15);color:var(--green)"><i class="fa-solid fa-circle-check"></i></div><div><div class="ms-val sv-online">${upCount}</div><div class="ms-lbl">Aktiv</div></div></div>
    <div class="mini-stat"><div class="ms-icon" style="background:rgba(211,47,47,.15);color:var(--red)"><i class="fa-solid fa-circle-xmark"></i></div><div><div class="ms-val sv-offline">${rows.length - upCount}</div><div class="ms-lbl">Inaktiv</div></div></div>`;
  const tbody = document.getElementById('vpn-tbody');
  const empty = document.getElementById('vpn-empty');
  if (!rows.length) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  tbody.innerHTML = rows.map(v => {
    const up = v.active === true || v.active === 'true';
    const name = v.peerName || v.networkName || '–';
    const proto = v.hsvpn === true ? 'HSVPN' : (v.type === 'SD_VPN' ? 'SD-VPN' : v.type === 'LTA' ? 'LTA' : 'IPsec');
    const remote = v.peerIp || '–';
    const rtt = v.rttAvgUs ? (v.rttAvgUs / 1000).toFixed(1) + ' ms' : '–';
    const loss = v.packetLossPercent != null ? v.packetLossPercent + '%' : '–';
    return `<tr>
      <td class="device-ref">${escHtml(v._deviceName)}</td>
      <td>${escHtml(name)}</td>
      <td class="muted">${escHtml(proto)}</td>
      <td>${statusDot(up)}</td>
      <td class="mono">${escHtml(v.role || '–')}</td>
      <td class="mono">${escHtml(remote)}</td>
      <td class="muted">${fmtBytes(v.rxCounterBytes)}</td>
      <td class="muted">${fmtBytes(v.txCounterBytes)}</td>
    </tr>`;
  }).join('');
}

export { renderVpn };
