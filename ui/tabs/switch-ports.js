import S from '../lib/state.js';
import { api } from '../lib/api.js';
import { escHtml, deviceName, isOnline, fmtRate } from '../lib/helpers.js';

let spData = {};
let spLoading = false;

async function loadSwitchPorts() {
  if (spLoading) return;
  spLoading = true;
  S._loaded.add('switch-ports');

  const icon = document.getElementById('sp-refresh-icon');
  if (icon) icon.classList.add('fa-spin');
  spData = {};

  const switches = Object.entries(S.devices).filter(([, d]) => {
    const t = (d.status?.type || d.deviceType || '').toUpperCase();
    return t === 'SWITCH';
  });

  for (const [id, dev] of switches) {
    try {
      const details = await api('config', `/configdevice/accounts/${S.accountId}/devices/${id}/portdetails`);
      if (details?.units) {
        spData[id] = {
          name: deviceName(dev), model: dev.status?.model || '', online: isOnline(dev),
          details, interfaces: dev.interfaces || []
        };
      }
    } catch (e) {
      console.warn(`[SwitchPorts] ${deviceName(dev)}:`, e?.message);
    }
  }

  spLoading = false;
  if (icon) icon.classList.remove('fa-spin');
  renderSwitchPorts();
}

function renderSwitchPorts() {
  const wrap = document.getElementById('sp-wrap');
  if (!wrap) return;

  const entries = Object.entries(spData);
  if (!entries.length) {
    const swCount = Object.values(S.devices).filter(d => (d.status?.type || '').toUpperCase() === 'SWITCH').length;
    wrap.innerHTML = `<div class="empty-state"><i class="fa-solid fa-ethernet"></i><h3>Keine Switch-Daten</h3><p>${swCount} Switches erkannt, keine Port-Details verfügbar.</p></div>`;
    return;
  }

  let totalPorts = 0, totalLag = 0;
  entries.forEach(([, sw]) => {
    sw.details.units.forEach(u => totalPorts += u.ports.length);
    totalLag += sw.details.lagGroupCount || 0;
  });

  let html = `<div class="sp-stats">
    <div class="sp-stat"><div class="sp-stat-icon" style="background:rgba(0,76,151,.15);color:var(--blue)"><i class="fa-solid fa-server"></i></div><div><div class="sp-stat-val">${entries.length}</div><div class="sp-stat-lbl">Switches</div></div></div>
    <div class="sp-stat"><div class="sp-stat-icon" style="background:rgba(52,217,123,.15);color:var(--green)"><i class="fa-solid fa-ethernet"></i></div><div><div class="sp-stat-val">${totalPorts}</div><div class="sp-stat-lbl">Ports</div></div></div>
    <div class="sp-stat"><div class="sp-stat-icon" style="background:rgba(251,191,36,.15);color:var(--amber)"><i class="fa-solid fa-link"></i></div><div><div class="sp-stat-val">${totalLag}</div><div class="sp-stat-lbl">LAG Gruppen</div></div></div>
  </div><div class="sp-switches">`;

  for (const [devId, sw] of entries) html += renderSwitchCard(devId, sw);
  html += `</div>`;
  wrap.innerHTML = html;
}

function renderSwitchCard(devId, sw) {
  const { name, model, online, details, interfaces } = sw;
  const ifMap = {};
  if (interfaces) interfaces.forEach(iface => {
    const n = (iface.name || iface.ifName || '').replace(/[^0-9]/g, '');
    if (n) ifMap[n] = iface;
  });

  let html = `<div class="sp-card">
    <div class="sp-card-head">
      <span style="color:${online ? 'var(--green)' : 'var(--red)'};font-size:9px"><i class="fa-solid fa-circle"></i></span>
      <span class="sp-card-name">${escHtml(name)}</span>
      <span class="sp-card-model">${escHtml(model.replace('LANCOM ', ''))}</span>
      <span style="margin-left:auto;font-size:11px;color:var(--text3)">${details.lagGroupCount || 0} LAG</span>
    </div>`;

  for (const unit of details.units) {
    html += `<div class="sp-unit">`;
    if (details.units.length > 1) html += `<div class="sp-unit-label">Unit ${unit.number}</div>`;
    html += `<div class="sp-port-grid">`;

    for (const port of unit.ports) {
      const iface = ifMap[String(port.number)];
      const linked = iface && iface.active && (iface.speed > 10000 || iface.rxBitPerSec > 0 || iface.txBitPerSec > 0);
      const speed = iface?.speed;
      let speedLabel = '';
      if (speed) {
        if (speed >= 10000000) speedLabel = '10G';
        else if (speed >= 2500000) speedLabel = '2.5G';
        else if (speed >= 1000000) speedLabel = '1G';
        else if (speed >= 100000) speedLabel = '100M';
        else speedLabel = '10M';
      }

      let cls = 'sp-port';
      if (linked) cls += ' sp-port-linked';
      else if (iface?.active) cls += ' sp-port-active';
      else cls += ' sp-port-down';
      if (port.isStackable) cls += ' sp-port-sfp';

      const rxTx = iface ? `↓${fmtRate((iface.rxBitPerSec || 0) / 1000)} ↑${fmtRate((iface.txBitPerSec || 0) / 1000)}` : '';
      const title = `Port ${port.number}${speedLabel ? ' · ' + speedLabel : ''}${rxTx ? ' · ' + rxTx : ''} · Mode: ${port.mode || '?'}`;

      html += `<div class="${cls}" title="${escHtml(title)}">
        <span class="sp-port-num">${port.number}</span>
        ${speedLabel ? `<span class="sp-port-speed">${speedLabel}</span>` : ''}
      </div>`;
    }
    html += `</div></div>`;
  }

  html += `</div>`;
  return html;
}

function resetSpState() { spData = {}; spLoading = false; }

export { loadSwitchPorts, renderSwitchPorts, resetSpState };
