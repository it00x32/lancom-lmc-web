import S from '../lib/state.js';
import { escHtml, deviceName, isOnline, fmtRate } from '../lib/helpers.js';
import { api } from '../lib/api.js';

let ifuData = [];    // [{_deviceId, _deviceName, portName, speed, rxKbps, txKbps, linked, ...}]
let ifuLoading = false;
let ifuHistory = {}; // deviceId → portName → [{ts, rx, tx}]

const WARN_PCT = 50;
const CRIT_PCT = 80;

// Port has a real link partner (not just admin-up with broadcast flooding)
function hasLink(p) {
  if (!p.active) return false;
  if (p.rxKbps > 0) return true;
  if (p.speed > 10000) return true;
  return false;
}

// All values from lan_info_json are in kbit/s
function fmtSpeed(kbps) {
  if (!kbps || kbps <= 0) return '–';
  if (kbps >= 1e7) return (kbps / 1e6).toFixed(0) + ' Gbit/s';
  if (kbps >= 1e6) return (kbps / 1e6).toFixed(1) + ' Gbit/s';
  if (kbps >= 1e3) return (kbps / 1e3).toFixed(0) + ' Mbit/s';
  return kbps + ' kbit/s';
}

function utilPct(rxKbps, txKbps, speedKbps) {
  if (!speedKbps || speedKbps <= 0) return 0;
  return Math.min(100, Math.max(rxKbps || 0, txKbps || 0) / speedKbps * 100);
}

function utilColor(pct) {
  if (pct >= CRIT_PCT) return 'var(--red)';
  if (pct >= WARN_PCT) return 'var(--amber)';
  if (pct > 0) return 'var(--green)';
  return 'var(--text3)';
}

function utilLabel(pct) {
  if (pct >= CRIT_PCT) return '<span style="color:var(--red);font-weight:700">Kritisch</span>';
  if (pct >= WARN_PCT) return '<span style="color:var(--amber);font-weight:700">Warnung</span>';
  return '<span style="color:var(--green)">OK</span>';
}

async function loadIfUtil() {
  const ids = Object.keys(S.devices);
  if (!ids.length) return;
  if (ifuLoading) return;
  ifuLoading = true;
  S._loaded.add('if-util');

  const icon = document.getElementById('ifu-refresh-icon');
  if (icon) icon.classList.add('fa-spin');

  ifuData = [];
  ifuHistory = {};

  const batches = [];
  for (let i = 0; i < ids.length; i += 5) batches.push(ids.slice(i, i + 5));

  for (const batch of batches) {
    await Promise.allSettled(batch.map(async deviceId => {
      const dev = S.devices[deviceId];
      const devN = deviceName(dev);
      const online = isOnline(dev);

      // Current snapshot via Records API
      try {
        const data = await api('monitoring',
          `/accounts/${S.accountId}/records/lan_info_json?group=DEVICE&groupId=${deviceId}&period=MINUTE1&type=json&source=NEW&name=interfaces&latest=1`
        );
        const ports = data?.items?.interfaces?.values?.[0];
        if (ports && typeof ports === 'object') {
          Object.entries(ports).forEach(([num, p]) => {
            const entry = {
              _deviceId: deviceId,
              _deviceName: devN,
              online,
              siteName: dev.siteName || '',
              portNum: parseInt(num),
              portName: p.name || `LAN-${num}`,
              description: p.description || '',
              active: !!p.active,
              speed: p.speed || 0,
              rxKbps: p.rxBitPerSec || 0,
              txKbps: p.txBitPerSec || 0,
              vlan: p.vlan,
              lldpNames: p.lldpNames || [],
            };
            entry.linked = hasLink(entry);
            ifuData.push(entry);
          });
        }
      } catch { /* skip */ }

      // Historical data via Tables API (last 1h, for sparklines)
      try {
        const from = new Date(Date.now() - 3600000).toISOString();
        const cols = ['timeMs', 'name', 'rxDeltaBytes', 'txDeltaBytes'].map(c => `column=${c}`).join('&');
        const qs = `deviceId=${encodeURIComponent(deviceId)}&from=${encodeURIComponent(from)}&limit=500&sort=timeMs&order=asc&${cols}`;
        const data = await api('monitor-frontend', `/api/${S.accountId}/tables/lan-interface?${qs}`);
        const rows = data?.data || [];
        if (rows.length) {
          if (!ifuHistory[deviceId]) ifuHistory[deviceId] = {};
          rows.forEach(r => {
            const name = r.name || 'unk';
            if (!ifuHistory[deviceId][name]) ifuHistory[deviceId][name] = [];
            ifuHistory[deviceId][name].push({
              ts: r.timeMs || 0,
              rx: r.rxDeltaBytes || 0,
              tx: r.txDeltaBytes || 0,
            });
          });
        }
      } catch { /* skip */ }
    }));
  }

  ifuLoading = false;
  if (icon) icon.classList.remove('fa-spin');
  renderIfUtil();
}

function sparkSvg(pts, color, maxVal) {
  if (!pts.length) return '';
  const W = 80, H = 24;
  const m = maxVal || Math.max(...pts, 1);
  const coords = pts.map((v, i) =>
    `${((i / Math.max(pts.length - 1, 1)) * W).toFixed(1)},${(H - (v / m) * (H - 4) - 2).toFixed(1)}`
  ).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" style="width:80px;height:24px;vertical-align:middle"><polyline points="${coords}" fill="none" stroke="${color}" stroke-width="1.2" stroke-linejoin="round"/></svg>`;
}

function renderIfUtil() {
  const wrap = document.getElementById('ifu-wrap');
  if (!wrap) return;

  if (!ifuData.length) {
    wrap.innerHTML = '<div class="empty-state"><i class="fa-solid fa-gauge-high"></i><h3>Keine Interface-Daten</h3><p>Keine Geräte mit Port-Informationen gefunden.</p></div>';
    return;
  }

  const activeOnly = document.getElementById('ifu-active-only')?.checked;
  const sortBy = document.getElementById('ifu-sort')?.value || 'util';

  let ports = ifuData.map(p => ({
    ...p,
    pct: utilPct(p.rxKbps, p.txKbps, p.speed),
  }));

  if (activeOnly) ports = ports.filter(p => p.linked);

  if (sortBy === 'util') ports.sort((a, b) => b.pct - a.pct || a._deviceName.localeCompare(b._deviceName));
  else if (sortBy === 'speed') ports.sort((a, b) => b.speed - a.speed || b.pct - a.pct);
  else ports.sort((a, b) => a._deviceName.localeCompare(b._deviceName) || a.portNum - b.portNum);

  // Stats only for linked ports
  const linkedPorts = ifuData.filter(p => p.linked);
  const avgUtil = linkedPorts.length ? linkedPorts.reduce((s, p) => s + utilPct(p.rxKbps, p.txKbps, p.speed), 0) / linkedPorts.length : 0;
  const warnPorts = linkedPorts.filter(p => utilPct(p.rxKbps, p.txKbps, p.speed) >= WARN_PCT);
  const critPorts = linkedPorts.filter(p => utilPct(p.rxKbps, p.txKbps, p.speed) >= CRIT_PCT);
  const topPort = linkedPorts.reduce((best, p) => {
    const u = utilPct(p.rxKbps, p.txKbps, p.speed);
    return u > (best?.pct || 0) ? { ...p, pct: u } : best;
  }, null);
  const devices = new Set(ifuData.map(p => p._deviceId));

  let html = `<div class="ifu-stats">
    <div class="ifu-stat"><div class="ifu-stat-icon" style="background:rgba(0,76,151,.1);color:var(--accent)"><i class="fa-solid fa-ethernet"></i></div><div class="ifu-stat-val">${linkedPorts.length}<span class="ifu-stat-sub">/ ${ifuData.length}</span></div><div class="ifu-stat-lbl">Verlinkt / Gesamt</div></div>
    <div class="ifu-stat"><div class="ifu-stat-icon" style="background:rgba(0,76,151,.1);color:var(--blue)"><i class="fa-solid fa-server"></i></div><div class="ifu-stat-val">${devices.size}</div><div class="ifu-stat-lbl">Geräte</div></div>
    <div class="ifu-stat"><div class="ifu-stat-icon" style="background:rgba(26,138,62,.1);color:var(--green)"><i class="fa-solid fa-gauge-high"></i></div><div class="ifu-stat-val">${avgUtil.toFixed(1)}%</div><div class="ifu-stat-lbl">Ø Auslastung</div></div>
    <div class="ifu-stat"><div class="ifu-stat-icon" style="background:rgba(217,119,6,.1);color:var(--amber)"><i class="fa-solid fa-triangle-exclamation"></i></div><div class="ifu-stat-val">${warnPorts.length}</div><div class="ifu-stat-lbl">Ports ≥${WARN_PCT}%</div></div>
    <div class="ifu-stat"><div class="ifu-stat-icon" style="background:rgba(211,47,47,.1);color:var(--red)"><i class="fa-solid fa-circle-exclamation"></i></div><div class="ifu-stat-val">${critPorts.length}</div><div class="ifu-stat-lbl">Ports ≥${CRIT_PCT}%</div></div>
    <div class="ifu-stat"><div class="ifu-stat-icon" style="background:rgba(211,47,47,.1);color:var(--red)"><i class="fa-solid fa-arrow-up"></i></div><div class="ifu-stat-val">${topPort ? topPort.pct.toFixed(1) + '%' : '–'}</div><div class="ifu-stat-lbl">${topPort ? escHtml(topPort._deviceName + ' ' + topPort.portName) : 'Top Port'}</div></div>
  </div>`;

  // Top 10 most utilized
  if (sortBy === 'util') {
    const top10 = ports.filter(p => p.linked && p.pct > 0).slice(0, 10);
    if (top10.length) {
      html += `<div class="ifu-section"><div class="ifu-section-title"><i class="fa-solid fa-ranking-star" style="color:var(--amber)"></i> Top 10 – Höchste Auslastung</div><div class="ifu-top10">`;
      top10.forEach((p, i) => {
        html += `<div class="ifu-top-row">
          <span class="ifu-top-rank">#${i + 1}</span>
          <span class="ifu-top-name">${escHtml(p._deviceName)} <span style="color:var(--text2);font-weight:400">· ${escHtml(p.portName)}</span></span>
          <span class="ifu-top-speed">${fmtSpeed(p.speed)}</span>
          <span class="ifu-top-rates"><span style="color:#004c97">↓${fmtRate(p.rxKbps)}</span> <span style="color:#1a8a3e">↑${fmtRate(p.txKbps)}</span></span>
          <div class="ifu-top-bar-wrap"><div class="ifu-top-bar" style="width:${p.pct}%;background:${utilColor(p.pct)}"></div></div>
          <span class="ifu-top-pct" style="color:${utilColor(p.pct)}">${p.pct.toFixed(1)}%</span>
        </div>`;
      });
      html += '</div></div>';
    }
  }

  // Full port table grouped by device
  html += `<div class="ifu-section"><div class="ifu-section-title"><i class="fa-solid fa-table" style="color:var(--accent)"></i> Alle Interfaces (${ports.length})</div>`;
  html += `<div class="table-wrap"><table class="data-table ifu-table">
    <thead><tr>
      <th>Gerät</th><th>Port</th><th>Beschreibung</th><th>Neighbor</th><th>Speed</th>
      <th>RX</th><th>TX</th><th style="min-width:100px">Auslastung</th><th>%</th><th>Status</th><th>Verlauf (1h)</th>
    </tr></thead><tbody>`;

  ports.forEach(p => {
    const pct = p.pct;
    const col = utilColor(pct);
    const neighbor = p.lldpNames.length ? p.lldpNames.map(n => escHtml(n)).join(', ') : '–';

    // Build sparkline from history
    const hist = ifuHistory[p._deviceId]?.[p.portName] || [];
    let spark = '';
    if (hist.length >= 2) {
      const rates = [];
      for (let i = 1; i < hist.length; i++) {
        const dt = ((hist[i].ts - hist[i - 1].ts) / 1000) || 60;
        const kbps = (Math.max(0, hist[i].rx - hist[i - 1].rx) + Math.max(0, hist[i].tx - hist[i - 1].tx)) * 8 / dt / 1000;
        rates.push(kbps);
      }
      const maxR = p.speed || Math.max(...rates, 1);
      spark = sparkSvg(rates, col === 'var(--text3)' ? '#93a3b8' : col, maxR);
    }

    const linkState = !p.active ? '<span class="muted">Aus</span>'
      : !p.linked ? '<span style="color:var(--text3)"><i class="fa-solid fa-link-slash" style="font-size:10px"></i> Kein Link</span>'
      : utilLabel(pct);

    html += `<tr${!p.linked ? ' style="opacity:.45"' : ''}>
      <td style="font-weight:600;white-space:nowrap">${escHtml(p._deviceName)}</td>
      <td class="mono" style="font-weight:600">${escHtml(p.portName)}</td>
      <td class="muted" style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(p.description) || '–'}</td>
      <td style="font-size:11px">${neighbor}</td>
      <td class="muted mono" style="white-space:nowrap">${fmtSpeed(p.speed)}</td>
      <td style="color:#004c97;font-variant-numeric:tabular-nums;white-space:nowrap;font-weight:600;font-size:12px">${p.linked ? '↓ ' + fmtRate(p.rxKbps) : '–'}</td>
      <td style="color:#1a8a3e;font-variant-numeric:tabular-nums;white-space:nowrap;font-weight:600;font-size:12px">${p.linked ? '↑ ' + fmtRate(p.txKbps) : '–'}</td>
      <td><div class="ifu-bar-wrap"><div class="ifu-bar" style="width:${p.linked ? pct : 0}%;background:${col}"></div></div></td>
      <td style="font-weight:700;color:${col};font-variant-numeric:tabular-nums;text-align:right;font-size:13px">${p.linked && p.speed ? pct.toFixed(1) + '%' : '–'}</td>
      <td>${linkState}</td>
      <td>${spark || '<span class="muted" style="font-size:10px">–</span>'}</td>
    </tr>`;
  });

  html += '</tbody></table></div></div>';
  wrap.innerHTML = html;
}

function resetIfuState() { ifuData = []; ifuHistory = {}; ifuLoading = false; }

export { loadIfUtil, renderIfUtil, resetIfuState };
