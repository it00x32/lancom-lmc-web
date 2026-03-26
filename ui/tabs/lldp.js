import S from '../lib/state.js';
import { escHtml, statusDot, fmtRate } from '../lib/helpers.js';

// ─── LLDP / PORTS TABLES ──────────────────────────────────────────────────────
let lldpView = 'lldp';

function setLldpView(v, btn) {
  lldpView = v;
  document.querySelectorAll('#tab-lldp .filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('lldp-view-lldp').style.display = v === 'lldp' ? '' : 'none';
  document.getElementById('lldp-view-ports').style.display = v === 'ports' ? '' : 'none';
  renderLldp();
}

function lldpBadge(names) {
  if (!names || !names.length) return '<span class="muted">–</span>';
  return names.map(n => `<span style="background:rgba(217,119,6,.15);color:var(--teal);padding:2px 7px;border-radius:4px;font-size:12px;font-weight:600">${escHtml(n)}</span>`).join(' ');
}

function speedMbit(s) {
  return s ? Math.round(s / 1000000) + '&nbsp;Mbit/s' : '–';
}

function poeCell(status, power) {
  if (!status || status === 'Unknown') return '<span class="muted">–</span>';
  return `${escHtml(status)}${power ? ` <span class="muted">${power}W</span>` : ''}`;
}

function renderLldp() {
  const q = document.getElementById('lldp-search').value.toLowerCase();
  const allPorts = S.lldpNeighbors;
  const switches = new Set(allPorts.map(p => p._deviceId)).size;
  const loopPorts = allPorts.filter(p => p.loops > 0).length;
  const withLldp = allPorts.filter(p => p.lldpNames.length).length;

  document.getElementById('lldp-mini-stats').innerHTML = `
    <div class="mini-stat"><div class="ms-icon" style="background:rgba(217,119,6,.15);color:var(--amber)"><i class="fa-solid fa-server"></i></div><div><div class="ms-val" style="color:var(--amber)">${switches}</div><div class="ms-lbl">Switches</div></div></div>
    <div class="mini-stat"><div class="ms-icon" style="background:rgba(0,76,151,.15);color:var(--accent)"><i class="fa-solid fa-plug"></i></div><div><div class="ms-val" style="color:var(--accent)">${allPorts.filter(p => p.active).length}</div><div class="ms-lbl">Ports aktiv</div></div></div>
    <div class="mini-stat"><div class="ms-icon" style="background:rgba(217,119,6,.15);color:var(--teal)"><i class="fa-solid fa-diagram-project"></i></div><div><div class="ms-val" style="color:var(--teal)">${withLldp}</div><div class="ms-lbl">LLDP Nachbarn</div></div></div>
    ${loopPorts ? `<div class="mini-stat"><div class="ms-icon" style="background:rgba(211,47,47,.2);color:var(--red)"><i class="fa-solid fa-triangle-exclamation"></i></div><div><div class="ms-val" style="color:var(--red)">${loopPorts}</div><div class="ms-lbl">Loops!</div></div></div>` : ''}`;

  if (lldpView === 'lldp') {
    let rows = allPorts.filter(p => {
      if (!p.lldpNames.length) return false;
      if (!q) return true;
      return [p._deviceName, p.portName, p.description, ...p.lldpNames].some(x => x && x.toLowerCase().includes(q));
    });
    document.getElementById('lldp-count').textContent = rows.length;
    const tbody = document.getElementById('lldp-tbody');
    const empty = document.getElementById('lldp-empty');
    if (!rows.length) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
    empty.style.display = 'none';
    tbody.innerHTML = rows.map(p => `<tr>
      <td class="device-ref">${escHtml(p._deviceName)}</td>
      <td><strong>${escHtml(p.portName)}</strong></td>
      <td class="muted">${escHtml(p.description) || '–'}</td>
      <td>${lldpBadge(p.lldpNames)}</td>
      <td>${statusDot(p.active)}</td>
      <td class="muted">${speedMbit(p.speed)}</td>
      <td class="muted">${p.vlan ?? '–'}</td>
      <td class="muted" style="white-space:nowrap">${poeCell(p.poeStatus, p.poePower)}</td>
      <td class="muted">${fmtRate(p.rxBitPerSec)}</td>
      <td class="muted">${fmtRate(p.txBitPerSec)}</td>
    </tr>`).join('');

  } else {
    let rows = allPorts.filter(p => {
      if (!q) return true;
      return [p._deviceName, p.portName, p.description, ...p.lldpNames].some(x => x && x.toLowerCase().includes(q));
    });
    document.getElementById('lldp-count').textContent = rows.length;
    const tbody = document.getElementById('ports-tbody');
    const empty = document.getElementById('ports-empty');
    if (!rows.length) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
    empty.style.display = 'none';
    tbody.innerHTML = rows.map(p => {
      const loopCell = p.loops > 0
        ? `<span style="background:rgba(211,47,47,.15);color:var(--red);padding:2px 8px;border-radius:4px;font-size:12px;font-weight:700"><i class="fa-solid fa-triangle-exclamation"></i> ${p.loops}</span>`
        : '<span class="muted">0</span>';
      const rowStyle = p.loops > 0 ? 'background:rgba(211,47,47,.05);' : !p.active ? 'opacity:.5' : '';
      return `<tr style="${rowStyle}">
        <td class="device-ref">${escHtml(p._deviceName)}</td>
        <td><strong>${escHtml(p.portName)}</strong></td>
        <td class="muted">${escHtml(p.description) || '–'}</td>
        <td>${lldpBadge(p.lldpNames)}</td>
        <td>${statusDot(p.active)}</td>
        <td>${loopCell}</td>
        <td class="muted">${speedMbit(p.speed)}</td>
        <td class="muted">${p.vlan ?? '–'}</td>
        <td class="muted">${escHtml(p.configuration) || '–'}</td>
        <td class="muted" style="white-space:nowrap">${poeCell(p.poeStatus, p.poePower)}</td>
        <td class="muted">${p.active ? fmtRate(p.rxBitPerSec) : '–'}</td>
        <td class="muted">${p.active ? fmtRate(p.txBitPerSec) : '–'}</td>
      </tr>`;
    }).join('');
  }
}

export { lldpView, setLldpView, lldpBadge, speedMbit, poeCell, renderLldp };
