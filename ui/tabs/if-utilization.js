import S from '../lib/state.js';
import { escHtml, deviceName, isOnline, fmtRate } from '../lib/helpers.js';
import { api } from '../lib/api.js';

let ifuData = [];
let ifuLoading = false;
let ifuHistory = {};  // deviceId → portName → [{ts, rxKbps, txKbps}]
let ifuExpanded = {}; // deviceId:portName → true (expanded chart)

const WARN_PCT = 50;
const CRIT_PCT = 80;
const COLORS_RX = '#004c97';
const COLORS_TX = '#1a8a3e';

function hasLink(p) {
  if (!p.active) return false;
  if (p.rxKbps > 0) return true;
  if (p.speed > 10000) return true;
  return false;
}

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

function getHours() {
  return parseInt(document.getElementById('ifu-period')?.value || '24');
}

function fmtTime(ts) {
  const d = new Date(ts);
  const h = getHours();
  if (h <= 6) return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  if (h <= 24) return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
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

  const hours = getHours();
  const from = new Date(Date.now() - hours * 3600000).toISOString();
  const limit = hours <= 6 ? 500 : hours <= 24 ? 1500 : 5000;

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
              rxKbps: (p.rxBitPerSec || 0) / 1000,
              txKbps: (p.txBitPerSec || 0) / 1000,
              vlan: p.vlan,
              lldpNames: p.lldpNames || [],
            };
            entry.linked = hasLink(entry);
            ifuData.push(entry);
          });
        }
      } catch { /* skip */ }

      // Historical data via Tables API
      try {
        const cols = ['timeMs', 'name', 'rxDeltaBytes', 'txDeltaBytes'].map(c => `column=${c}`).join('&');
        const qs = `deviceId=${encodeURIComponent(deviceId)}&from=${encodeURIComponent(from)}&limit=${limit}&sort=timeMs&order=asc&${cols}`;
        const data = await api('monitor-frontend', `/api/${S.accountId}/tables/lan-interface?${qs}`);
        const rows = data?.data || [];
        if (rows.length) {
          if (!ifuHistory[deviceId]) ifuHistory[deviceId] = {};
          rows.forEach(r => {
            const name = r.name || 'unk';
            if (!ifuHistory[deviceId][name]) ifuHistory[deviceId][name] = [];
            ifuHistory[deviceId][name].push({
              ts: r.timeMs || 0,
              rxBytes: r.rxDeltaBytes || 0,
              txBytes: r.txDeltaBytes || 0,
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

function computeRates(hist) {
  if (!hist || hist.length < 2) return [];
  const rates = [];
  for (let i = 1; i < hist.length; i++) {
    const dt = ((hist[i].ts - hist[i - 1].ts) / 1000) || 60;
    const rxKbps = Math.max(0, hist[i].rxBytes - hist[i - 1].rxBytes) * 8 / dt / 1000;
    const txKbps = Math.max(0, hist[i].txBytes - hist[i - 1].txBytes) * 8 / dt / 1000;
    rates.push({ ts: hist[i].ts, rxKbps, txKbps });
  }
  return rates;
}

function peakFromHistory(rates, speedKbps) {
  if (!rates.length) return { peakRx: 0, peakTx: 0, peakPct: 0, peakTs: 0, avgPct: 0 };
  let peakRx = 0, peakTx = 0, peakTs = 0, sumPct = 0;
  rates.forEach(r => {
    if (r.rxKbps > peakRx) { peakRx = r.rxKbps; }
    if (r.txKbps > peakTx) { peakTx = r.txKbps; }
    const m = Math.max(r.rxKbps, r.txKbps);
    if (m > Math.max(peakRx, peakTx) - 0.01 || (peakTs === 0 && m > 0)) peakTs = r.ts;
    sumPct += speedKbps > 0 ? Math.min(100, m / speedKbps * 100) : 0;
  });
  // re-find exact peak ts
  const peakVal = Math.max(peakRx, peakTx);
  const peakEntry = rates.find(r => Math.max(r.rxKbps, r.txKbps) >= peakVal - 0.01);
  if (peakEntry) peakTs = peakEntry.ts;
  const peakPct = speedKbps > 0 ? Math.min(100, peakVal / speedKbps * 100) : 0;
  const avgPct = sumPct / rates.length;
  return { peakRx, peakTx, peakPct, peakTs, avgPct };
}

// ── SVG Chart ──────────────────────────────────────────────────────────────────

function sparkSvg(pts, color, maxVal) {
  if (!pts.length) return '';
  const W = 80, H = 24;
  const m = maxVal || Math.max(...pts, 1);
  const coords = pts.map((v, i) =>
    `${((i / Math.max(pts.length - 1, 1)) * W).toFixed(1)},${(H - (v / m) * (H - 4) - 2).toFixed(1)}`
  ).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" style="width:80px;height:24px;vertical-align:middle"><polyline points="${coords}" fill="none" stroke="${color}" stroke-width="1.2" stroke-linejoin="round"/></svg>`;
}

function buildChart(rates, speedKbps, portKey) {
  if (!rates.length) return '<div style="color:var(--text3);font-size:12px;padding:12px 0;text-align:center">Keine historischen Daten für diesen Port.</div>';

  const W = 800, H = 180, PL = 55, PR = 10, PT = 10, PB = 28;
  const cw = W - PL - PR, ch = H - PT - PB;

  const maxVal = Math.max(1, ...rates.flatMap(r => [r.rxKbps, r.txKbps]));
  const minTs = rates[0].ts, maxTs = rates[rates.length - 1].ts;
  const rangeTs = maxTs - minTs || 1;

  let svg = `<svg viewBox="0 0 ${W} ${H}" class="ifu-chart-svg" id="ifu-chart-${portKey}">`;

  // Speed line (max capacity)
  if (speedKbps > 0 && speedKbps <= maxVal * 1.5) {
    const y = PT + ch - (speedKbps / maxVal) * ch;
    svg += `<line x1="${PL}" y1="${y}" x2="${W - PR}" y2="${y}" stroke="var(--red)" stroke-width="0.8" stroke-dasharray="4,3" opacity="0.5"/>`;
    svg += `<text x="${PL - 4}" y="${y + 3}" text-anchor="end" font-size="8" fill="var(--red)" opacity="0.7" font-family="var(--mono)">Max</text>`;
  }

  // Y-axis grid
  for (let i = 0; i <= 4; i++) {
    const y = PT + ch - (i / 4) * ch;
    const val = maxVal * i / 4;
    svg += `<line x1="${PL}" y1="${y}" x2="${W - PR}" y2="${y}" stroke="rgba(0,40,85,.07)" stroke-width="1"/>`;
    svg += `<text x="${PL - 4}" y="${y + 3}" text-anchor="end" font-size="8" fill="var(--text3)" font-family="var(--mono)">${fmtRate(val)}</text>`;
  }

  // X-axis labels
  const hours = getHours();
  const tickCount = hours <= 6 ? 6 : hours <= 24 ? 8 : 7;
  for (let i = 0; i <= tickCount; i++) {
    const ts = minTs + (i / tickCount) * rangeTs;
    const x = PL + (i / tickCount) * cw;
    const d = new Date(ts);
    const lbl = hours <= 24
      ? d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'numeric' });
    svg += `<text x="${x}" y="${H - PB + 14}" text-anchor="middle" font-size="8" fill="var(--text3)" font-family="var(--font)">${lbl}</text>`;
  }

  // RX area + line
  const rxPts = rates.map(r => {
    const x = PL + ((r.ts - minTs) / rangeTs) * cw;
    const y = PT + ch - (r.rxKbps / maxVal) * ch;
    return { x, y };
  });
  const txPts = rates.map(r => {
    const x = PL + ((r.ts - minTs) / rangeTs) * cw;
    const y = PT + ch - (r.txKbps / maxVal) * ch;
    return { x, y };
  });

  // RX fill
  svg += `<polygon points="${PL},${PT + ch} ${rxPts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} ${PL + cw},${PT + ch}" fill="${COLORS_RX}" opacity="0.08"/>`;
  svg += `<polyline points="${rxPts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}" fill="none" stroke="${COLORS_RX}" stroke-width="1.5" stroke-linejoin="round"/>`;

  // TX fill
  svg += `<polygon points="${PL},${PT + ch} ${txPts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} ${PL + cw},${PT + ch}" fill="${COLORS_TX}" opacity="0.08"/>`;
  svg += `<polyline points="${txPts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}" fill="none" stroke="${COLORS_TX}" stroke-width="1.5" stroke-linejoin="round"/>`;

  svg += '</svg>';

  // Legend + peak info
  const peak = peakFromHistory(rates, speedKbps);
  svg += `<div class="ifu-chart-footer">
    <span class="ifu-chart-legend"><span class="ifu-chart-dot" style="background:${COLORS_RX}"></span>RX (Download)</span>
    <span class="ifu-chart-legend"><span class="ifu-chart-dot" style="background:${COLORS_TX}"></span>TX (Upload)</span>
    <span class="ifu-chart-peak">Peak RX: <strong>${fmtRate(peak.peakRx)}</strong></span>
    <span class="ifu-chart-peak">Peak TX: <strong>${fmtRate(peak.peakTx)}</strong></span>
    <span class="ifu-chart-peak">Peak: <strong style="color:${utilColor(peak.peakPct)}">${peak.peakPct.toFixed(1)}%</strong></span>
    ${peak.peakTs ? `<span class="ifu-chart-peak">@ ${fmtTime(peak.peakTs)}</span>` : ''}
  </div>`;

  return svg;
}

// ── Render ──────────────────────────────────────────────────────────────────────

function renderIfUtil() {
  const wrap = document.getElementById('ifu-wrap');
  if (!wrap) return;

  if (!ifuData.length) {
    wrap.innerHTML = '<div class="empty-state"><i class="fa-solid fa-gauge-high"></i><h3>Keine Interface-Daten</h3><p>Keine Geräte mit Port-Informationen gefunden.</p></div>';
    return;
  }

  const activeOnly = document.getElementById('ifu-active-only')?.checked;
  const sortBy = document.getElementById('ifu-sort')?.value || 'util';
  const hours = getHours();

  let ports = ifuData.map(p => {
    const hist = ifuHistory[p._deviceId]?.[p.portName];
    const rates = computeRates(hist);
    const peak = peakFromHistory(rates, p.speed);
    return { ...p, pct: utilPct(p.rxKbps, p.txKbps, p.speed), rates, peak };
  });

  if (activeOnly) ports = ports.filter(p => p.linked);

  if (sortBy === 'util') ports.sort((a, b) => b.pct - a.pct || a._deviceName.localeCompare(b._deviceName));
  else if (sortBy === 'peak') ports.sort((a, b) => b.peak.peakPct - a.peak.peakPct || b.pct - a.pct);
  else if (sortBy === 'speed') ports.sort((a, b) => b.speed - a.speed || b.pct - a.pct);
  else ports.sort((a, b) => a._deviceName.localeCompare(b._deviceName) || a.portNum - b.portNum);

  const linkedPorts = ifuData.filter(p => hasLink(p));
  const linkedWithHist = linkedPorts.map(p => {
    const rates = computeRates(ifuHistory[p._deviceId]?.[p.portName]);
    return { ...p, rates, peak: peakFromHistory(rates, p.speed) };
  });

  const avgUtil = linkedPorts.length ? linkedPorts.reduce((s, p) => s + utilPct(p.rxKbps, p.txKbps, p.speed), 0) / linkedPorts.length : 0;
  const warnPorts = linkedWithHist.filter(p => p.peak.peakPct >= WARN_PCT);
  const critPorts = linkedWithHist.filter(p => p.peak.peakPct >= CRIT_PCT);
  const topPort = linkedWithHist.reduce((best, p) => (!best || p.peak.peakPct > best.peak.peakPct) ? p : best, null);
  const devices = new Set(ifuData.map(p => p._deviceId));
  const periodLabel = hours <= 1 ? '1h' : hours <= 6 ? '6h' : hours <= 24 ? '24h' : '7d';

  const topName = topPort ? escHtml(topPort._deviceName.length > 12 ? topPort._deviceName.slice(0, 11) + '…' : topPort._deviceName) + ' ' + escHtml(topPort.portName) : 'Top Peak';

  let html = `<div class="ifu-stats">
    <div class="ifu-stat"><div class="ifu-stat-icon" style="background:rgba(0,76,151,.1);color:var(--accent)"><i class="fa-solid fa-ethernet"></i></div><div><div class="ifu-stat-val">${linkedPorts.length}<span class="ifu-stat-sub">/ ${ifuData.length}</span></div><div class="ifu-stat-lbl">Link / Gesamt</div></div></div>
    <div class="ifu-stat"><div class="ifu-stat-icon" style="background:rgba(0,76,151,.1);color:var(--blue)"><i class="fa-solid fa-server"></i></div><div><div class="ifu-stat-val">${devices.size}</div><div class="ifu-stat-lbl">Geräte</div></div></div>
    <div class="ifu-stat"><div class="ifu-stat-icon" style="background:rgba(26,138,62,.1);color:var(--green)"><i class="fa-solid fa-gauge-high"></i></div><div><div class="ifu-stat-val">${avgUtil.toFixed(1)}%</div><div class="ifu-stat-lbl">Ø jetzt</div></div></div>
    <div class="ifu-stat"><div class="ifu-stat-icon" style="background:rgba(217,119,6,.1);color:var(--amber)"><i class="fa-solid fa-triangle-exclamation"></i></div><div><div class="ifu-stat-val">${warnPorts.length}</div><div class="ifu-stat-lbl">≥${WARN_PCT}% ${periodLabel}</div></div></div>
    <div class="ifu-stat"><div class="ifu-stat-icon" style="background:rgba(211,47,47,.1);color:var(--red)"><i class="fa-solid fa-circle-exclamation"></i></div><div><div class="ifu-stat-val">${critPorts.length}</div><div class="ifu-stat-lbl">≥${CRIT_PCT}% ${periodLabel}</div></div></div>
    <div class="ifu-stat"><div class="ifu-stat-icon" style="background:rgba(211,47,47,.1);color:var(--red)"><i class="fa-solid fa-arrow-up"></i></div><div><div class="ifu-stat-val">${topPort ? topPort.peak.peakPct.toFixed(1) + '%' : '–'}</div><div class="ifu-stat-lbl">${topName}</div></div></div>
  </div>`;

  // Top 10 by peak
  if (sortBy === 'util' || sortBy === 'peak') {
    const top10 = ports.filter(p => p.linked && p.peak.peakPct > 0).slice(0, 10);
    if (top10.length) {
      html += `<div class="ifu-section"><div class="ifu-section-title"><i class="fa-solid fa-ranking-star" style="color:var(--amber)"></i> Top 10 – Höchste Auslastung (Peak ${periodLabel})</div><div class="ifu-top10">`;
      top10.forEach((p, i) => {
        const pk = p.peak;
        const barPct = sortBy === 'peak' ? pk.peakPct : p.pct;
        const barCol = utilColor(pk.peakPct);
        html += `<div class="ifu-top-row" style="cursor:pointer" onclick="toggleIfuChart('${p._deviceId}:${p.portName}')">
          <span class="ifu-top-rank">#${i + 1}</span>
          <span class="ifu-top-name">${escHtml(p._deviceName)} <span style="color:var(--text2);font-weight:400">· ${escHtml(p.portName)}</span></span>
          <span class="ifu-top-speed">${fmtSpeed(p.speed)}</span>
          <span class="ifu-top-rates"><span style="color:${COLORS_RX}">↓${fmtRate(pk.peakRx)}</span> <span style="color:${COLORS_TX}">↑${fmtRate(pk.peakTx)}</span></span>
          <div class="ifu-top-bar-wrap"><div class="ifu-top-bar" style="width:${barPct}%;background:${barCol}"></div></div>
          <span class="ifu-top-pct" style="color:${barCol}">${pk.peakPct.toFixed(1)}%</span>
          <i class="fa-solid fa-chart-area" style="color:var(--text3);font-size:11px;margin-left:4px"></i>
        </div>`;
        const key = `${p._deviceId}:${p.portName}`;
        if (ifuExpanded[key]) {
          html += `<div class="ifu-chart-wrap">${buildChart(p.rates, p.speed, key.replace(/[^a-z0-9]/gi, '_'))}</div>`;
        }
      });
      html += '</div></div>';
    }
  }

  // Device-grouped charts
  const byDevice = {};
  ports.filter(p => p.linked).forEach(p => {
    if (!byDevice[p._deviceId]) byDevice[p._deviceId] = { name: p._deviceName, ports: [] };
    byDevice[p._deviceId].ports.push(p);
  });

  html += `<div class="ifu-section"><div class="ifu-section-title"><i class="fa-solid fa-chart-area" style="color:var(--blue)"></i> Durchsatz-Verlauf pro Gerät (${periodLabel})</div>`;
  Object.entries(byDevice).forEach(([devId, d]) => {
    const portsWithData = d.ports.filter(p => p.rates.length >= 2);
    if (!portsWithData.length) return;

    html += `<div class="ifu-device-block">
      <div class="ifu-device-header" onclick="this.parentElement.classList.toggle('collapsed')">
        <i class="fa-solid fa-chevron-down ifu-device-chevron"></i>
        <strong>${escHtml(d.name)}</strong>
        <span class="muted" style="font-size:11px;margin-left:6px">${portsWithData.length} Ports mit Verlauf</span>
      </div>
      <div class="ifu-device-charts">`;

    portsWithData.forEach(p => {
      const pk = p.peak;
      const key = `${devId}_${p.portName}`.replace(/[^a-z0-9]/gi, '_');
      html += `<div class="ifu-port-chart">
        <div class="ifu-port-chart-header">
          <strong>${escHtml(p.portName)}</strong>
          <span class="muted">${fmtSpeed(p.speed)}</span>
          <span style="color:${COLORS_RX}">↓ Jetzt ${fmtRate(p.rxKbps)}</span>
          <span style="color:${COLORS_TX}">↑ Jetzt ${fmtRate(p.txKbps)}</span>
          <span style="color:${utilColor(p.pct)};font-weight:700">${p.pct.toFixed(1)}%</span>
          <span class="muted">Peak ${pk.peakPct.toFixed(1)}%${pk.peakTs ? ' @ ' + fmtTime(pk.peakTs) : ''}</span>
        </div>
        ${buildChart(p.rates, p.speed, key)}
      </div>`;
    });

    html += '</div></div>';
  });
  html += '</div>';

  // Full port table
  html += `<div class="ifu-section"><div class="ifu-section-title"><i class="fa-solid fa-table" style="color:var(--accent)"></i> Alle Interfaces (${ports.length})</div>`;
  html += `<div class="table-wrap"><table class="data-table ifu-table">
    <thead><tr>
      <th>Gerät</th><th>Port</th><th>Beschreibung</th><th>Neighbor</th><th>Speed</th>
      <th>RX</th><th>TX</th><th style="min-width:100px">Jetzt</th><th>%</th>
      <th>Peak RX</th><th>Peak TX</th><th>Peak %</th><th>Peak Zeit</th><th>Status</th>
    </tr></thead><tbody>`;

  ports.forEach(p => {
    const pct = p.pct;
    const col = utilColor(pct);
    const pk = p.peak;
    const pkCol = utilColor(pk.peakPct);
    const neighbor = p.lldpNames.length ? p.lldpNames.map(n => escHtml(n)).join(', ') : '–';

    const linkState = !p.active ? '<span class="muted">Aus</span>'
      : !p.linked ? '<span style="color:var(--text3)"><i class="fa-solid fa-link-slash" style="font-size:10px"></i> Kein Link</span>'
      : utilLabel(Math.max(pct, pk.peakPct));

    html += `<tr${!p.linked ? ' style="opacity:.45"' : ''}>
      <td style="font-weight:600;white-space:nowrap">${escHtml(p._deviceName)}</td>
      <td class="mono" style="font-weight:600">${escHtml(p.portName)}</td>
      <td class="muted" style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(p.description) || '–'}</td>
      <td style="font-size:11px">${neighbor}</td>
      <td class="muted mono" style="white-space:nowrap">${fmtSpeed(p.speed)}</td>
      <td style="color:${COLORS_RX};font-variant-numeric:tabular-nums;white-space:nowrap;font-weight:600;font-size:12px">${p.linked ? '↓ ' + fmtRate(p.rxKbps) : '–'}</td>
      <td style="color:${COLORS_TX};font-variant-numeric:tabular-nums;white-space:nowrap;font-weight:600;font-size:12px">${p.linked ? '↑ ' + fmtRate(p.txKbps) : '–'}</td>
      <td><div class="ifu-bar-wrap"><div class="ifu-bar" style="width:${p.linked ? pct : 0}%;background:${col}"></div></div></td>
      <td style="font-weight:700;color:${col};font-variant-numeric:tabular-nums;text-align:right;font-size:13px">${p.linked && p.speed ? pct.toFixed(1) + '%' : '–'}</td>
      <td style="color:${COLORS_RX};font-size:12px;font-variant-numeric:tabular-nums">${pk.peakRx > 0 ? fmtRate(pk.peakRx) : '–'}</td>
      <td style="color:${COLORS_TX};font-size:12px;font-variant-numeric:tabular-nums">${pk.peakTx > 0 ? fmtRate(pk.peakTx) : '–'}</td>
      <td style="font-weight:700;color:${pkCol};font-variant-numeric:tabular-nums;text-align:right">${pk.peakPct > 0 ? pk.peakPct.toFixed(1) + '%' : '–'}</td>
      <td class="muted" style="font-size:11px;white-space:nowrap">${pk.peakTs ? fmtTime(pk.peakTs) : '–'}</td>
      <td>${linkState}</td>
    </tr>`;
  });

  html += '</tbody></table></div></div>';
  wrap.innerHTML = html;
}

function toggleIfuChart(key) {
  ifuExpanded[key] = !ifuExpanded[key];
  renderIfUtil();
}

function resetIfuState() { ifuData = []; ifuHistory = {}; ifuLoading = false; ifuExpanded = {}; }

export { loadIfUtil, renderIfUtil, toggleIfuChart, resetIfuState };
