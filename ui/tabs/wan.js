import S from '../lib/state.js';
import { escHtml, statusDot, fmtWanState, isWanUp, fmtBytes } from '../lib/helpers.js';

function renderWan() {
  const q = document.getElementById('wan-search').value.toLowerCase();
  let rows = S.wanInterfaces.filter(w => !q || [w._deviceName, w.interfaceName, w.name, w.interface, w.ipV4, w.ipV6, w.ip, w.connectionType, w.type].some(x => x && String(x).toLowerCase().includes(q)));
  document.getElementById('wan-count').textContent = rows.length;
  const upCount = rows.filter(w => isWanUp(w.logicalState || w.state || w.status || w.linkState || '') || w.connected === true).length;
  document.getElementById('wan-mini-stats').innerHTML = `
    <div class="mini-stat"><div class="ms-icon" style="background:rgba(0,76,151,.15);color:var(--blue)"><i class="fa-solid fa-globe"></i></div><div><div class="ms-val" style="color:var(--blue)">${rows.length}</div><div class="ms-lbl">Interfaces</div></div></div>
    <div class="mini-stat"><div class="ms-icon" style="background:rgba(26,138,62,.15);color:var(--green)"><i class="fa-solid fa-circle-check"></i></div><div><div class="ms-val sv-online">${upCount}</div><div class="ms-lbl">Online</div></div></div>`;
  const tbody = document.getElementById('wan-tbody');
  const empty = document.getElementById('wan-empty');
  if (!rows.length) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  tbody.innerHTML = rows.map(w => {
    const up = isWanUp(w.logicalState || w.state || w.status || w.linkState || '') || w.connected === true;
    const iface = w.interfaceName || w.name || w.interface || w.connectionType || '–';
    const type = w.connectionType || w.type || w.medium || '–';
    const ip = w.ipV4 || w.ipV6 || w.ip || w.ipAddress || '–';
    const gw = w.gateway || w.defaultGateway || '–';
    return `<tr>
      <td class="device-ref">${escHtml(w._deviceName)}</td>
      <td>${escHtml(iface)}</td>
      <td class="muted">${escHtml(type)}</td>
      <td>${statusDot(up, fmtWanState(w.logicalState || w.state || ''))}</td>
      <td class="mono">${escHtml(ip)}</td>
      <td class="mono">${escHtml(gw)}</td>
      <td class="muted">${fmtBytes(w.rxCounterBytes || w.rxBytes || w.rx)}</td>
      <td class="muted">${fmtBytes(w.txCounterBytes || w.txBytes || w.tx)}</td>
    </tr>`;
  }).join('');
}

export { renderWan };
