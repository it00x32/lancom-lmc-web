import S from '../lib/state.js';
import { escHtml, deviceName, isOnline } from '../lib/helpers.js';
import { api, toast } from '../lib/api.js';

let wcData = {};
let wcLoading = false;

const WARN_THRESHOLD = 20;
const CRIT_THRESHOLD = 35;

async function loadWlanCapacity() {
  const ids = Object.keys(S.devices);
  if (!ids.length) return;
  if (wcLoading) return;
  wcLoading = true;
  S._loaded.add('wlan-capacity');

  const icon = document.getElementById('wc-refresh-icon');
  if (icon) icon.classList.add('fa-spin');
  wcData = {};

  const batches = [];
  for (let i = 0; i < ids.length; i += 5) batches.push(ids.slice(i, i + 5));

  for (const batch of batches) {
    await Promise.allSettled(batch.map(async deviceId => {
      const dev = S.devices[deviceId];
      const name = deviceName(dev);
      try {
        const data = await api('monitoring',
          `/accounts/${S.accountId}/records/wlan_info_json?group=DEVICE&groupId=${deviceId}&period=MINUTE1&type=json&name=stations&latest=1`
        );
        const clients = data?.items?.stations?.values?.[0];
        if (!Array.isArray(clients) || !clients.length) return;
        wcData[deviceId] = {
          name,
          online: isOnline(dev),
          siteName: dev.siteName || '',
          model: dev.status?.model || '',
          clients
        };
      } catch (err) {
        console.warn(`[WC] ${name}:`, err?.message || err);
      }
    }));
  }

  wcLoading = false;
  if (icon) icon.classList.remove('fa-spin');
  renderWlanCapacity();
}

function renderWlanCapacity() {
  const wrap = document.getElementById('wc-wrap');
  if (!wrap) return;

  const entries = Object.entries(wcData);
  if (!entries.length) {
    const total = Object.keys(S.devices).length;
    wrap.innerHTML = `<div class="empty-state"><i class="fa-solid fa-chart-area"></i><h3>Keine WLAN-Daten</h3><p>Keine APs mit verbundenen Clients gefunden (${total} Geräte geprüft).</p></div>`;
    return;
  }

  const allClients = entries.flatMap(([, d]) => d.clients);
  const totalClients = allClients.length;
  const apCount = entries.length;

  const band24 = allClients.filter(c => c.band === 'GHZ24').length;
  const band50 = allClients.filter(c => c.band === 'GHZ50' || c.band === 'GHZ5').length;
  const band6 = allClients.filter(c => c.band === 'GHZ60' || c.band === 'GHZ6E').length;

  const signals = allClients.map(c => c.signal).filter(s => typeof s === 'number');
  const avgSignal = signals.length ? Math.round(signals.reduce((a, b) => a + b, 0) / signals.length) : 0;
  const weakClients = signals.filter(s => s < 30).length;

  const ssidMap = {};
  allClients.forEach(c => { const s = c.ssid || '?'; ssidMap[s] = (ssidMap[s] || 0) + 1; });
  const ssids = Object.entries(ssidMap).sort((a, b) => b[1] - a[1]);

  const standardMap = {};
  allClients.forEach(c => { const s = c.standard || '?'; standardMap[s] = (standardMap[s] || 0) + 1; });

  const apStats = entries.map(([id, d]) => {
    const n = d.clients.length;
    const b24 = d.clients.filter(c => c.band === 'GHZ24').length;
    const b50 = d.clients.filter(c => c.band === 'GHZ50' || c.band === 'GHZ5').length;
    const sigs = d.clients.map(c => c.signal).filter(s => typeof s === 'number');
    const avg = sigs.length ? Math.round(sigs.reduce((a, b) => a + b, 0) / sigs.length) : 0;
    return { id, name: d.name, siteName: d.siteName, model: d.model, online: d.online, count: n, band24: b24, band50: b50, avgSignal: avg, clients: d.clients };
  }).sort((a, b) => b.count - a.count);

  const warnAPs = apStats.filter(a => a.count >= WARN_THRESHOLD).length;
  const critAPs = apStats.filter(a => a.count >= CRIT_THRESHOLD).length;

  let html = `<div class="wc-stats">
    <div class="wc-stat"><div class="wc-stat-icon" style="background:rgba(0,76,151,.1);color:var(--accent)"><i class="fa-solid fa-wifi"></i></div><div class="wc-stat-val">${totalClients}</div><div class="wc-stat-lbl">Clients gesamt</div></div>
    <div class="wc-stat"><div class="wc-stat-icon" style="background:rgba(0,76,151,.1);color:var(--blue)"><i class="fa-solid fa-tower-broadcast"></i></div><div class="wc-stat-val">${apCount}</div><div class="wc-stat-lbl">Aktive APs</div></div>
    <div class="wc-stat"><div class="wc-stat-icon" style="background:rgba(217,119,6,.1);color:var(--amber)"><i class="fa-solid fa-signal"></i></div><div class="wc-stat-val">${avgSignal}%</div><div class="wc-stat-lbl">Ø Signal</div></div>
    <div class="wc-stat"><div class="wc-stat-icon" style="background:rgba(211,47,47,.1);color:var(--red)"><i class="fa-solid fa-signal" style="opacity:.5"></i></div><div class="wc-stat-val">${weakClients}</div><div class="wc-stat-lbl">Schwach (&lt;30%)</div></div>
    <div class="wc-stat"><div class="wc-stat-icon" style="background:rgba(26,138,62,.1);color:var(--green)"><i class="fa-solid fa-chart-pie"></i></div><div class="wc-stat-val">${band50}/${band24}</div><div class="wc-stat-lbl">5 GHz / 2.4 GHz</div></div>
    <div class="wc-stat"><div class="wc-stat-icon" style="background:rgba(211,47,47,.1);color:var(--red)"><i class="fa-solid fa-triangle-exclamation"></i></div><div class="wc-stat-val">${warnAPs}</div><div class="wc-stat-lbl">APs ≥${WARN_THRESHOLD} Clients</div></div>
  </div>`;

  // Band & SSID distribution
  html += `<div class="wc-grid2">`;
  html += buildBandChart(band24, band50, band6);
  html += buildSsidChart(ssids, totalClients);
  html += `</div>`;

  // AP capacity bars
  html += `<div class="wc-section">
    <div class="wc-section-title"><i class="fa-solid fa-tower-broadcast" style="color:var(--accent)"></i> Auslastung pro AP</div>
    <div class="wc-ap-list">${apStats.map(a => {
      const pct = Math.min(100, Math.round(a.count / CRIT_THRESHOLD * 100));
      const col = a.count >= CRIT_THRESHOLD ? 'var(--red)' : a.count >= WARN_THRESHOLD ? 'var(--amber)' : 'var(--green)';
      const sigCol = a.avgSignal >= 60 ? 'var(--green)' : a.avgSignal >= 30 ? 'var(--amber)' : 'var(--red)';
      return `<div class="wc-ap-card">
        <div class="wc-ap-head">
          <span class="wc-ap-name" title="${escHtml(a.name)}">${escHtml(a.name)}</span>
          <span class="wc-ap-meta">${escHtml(a.model)}</span>
        </div>
        <div class="wc-ap-metrics">
          <span class="wc-ap-count" style="color:${col}">${a.count}</span>
          <span class="wc-ap-sub">Clients</span>
          <span class="wc-ap-badge" style="background:rgba(0,76,151,.1);color:var(--blue)">${a.band50} × 5G</span>
          <span class="wc-ap-badge" style="background:rgba(217,119,6,.1);color:var(--amber)">${a.band24} × 2.4G</span>
          <span class="wc-ap-badge" style="background:${sigCol === 'var(--green)' ? 'rgba(26,138,62,.1)' : sigCol === 'var(--amber)' ? 'rgba(217,119,6,.1)' : 'rgba(211,47,47,.1)'};color:${sigCol}">Ø ${a.avgSignal}%</span>
        </div>
        <div class="wc-bar-wrap"><div class="wc-bar" style="width:${pct}%;background:${col}"></div><span class="wc-bar-label">${a.count}/${CRIT_THRESHOLD}</span></div>
      </div>`;
    }).join('')}</div>
  </div>`;

  // Signal distribution
  html += buildSignalHistogram(signals);

  // Client table
  html += `<div class="wc-section">
    <div class="wc-section-title"><i class="fa-solid fa-table" style="color:var(--accent)"></i> Client-Details (${totalClients})</div>
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>Client</th><th>AP</th><th>SSID</th><th>Band</th><th>Kanal</th><th>Standard</th><th>Signal</th><th>Rate</th><th>Vendor</th></tr></thead>
      <tbody>${allClients.map(c => {
        const apName = entries.find(([id]) => id === c.deviceId)?.[1]?.name || '?';
        const sigPct = typeof c.signal === 'number' ? c.signal : 0;
        const sigCol = sigPct >= 60 ? 'var(--green)' : sigPct >= 30 ? 'var(--amber)' : 'var(--red)';
        const band = c.band === 'GHZ24' ? '2.4 GHz' : c.band === 'GHZ50' || c.band === 'GHZ5' ? '5 GHz' : c.band === 'GHZ60' || c.band === 'GHZ6E' ? '6 GHz' : c.band || '–';
        const rate = c.actualRate ? fmtWlanRate(c.actualRate) : '–';
        const clientName = c.name || c.ip || c.mac || '–';
        return `<tr>
          <td title="${escHtml(c.mac || '')}" style="font-weight:500">${escHtml(clientName.length > 22 ? clientName.slice(0, 21) + '…' : clientName)}</td>
          <td class="muted">${escHtml(apName.length > 16 ? apName.slice(0, 15) + '…' : apName)}</td>
          <td><span class="wc-ssid-pill">${escHtml(c.ssid || '–')}</span></td>
          <td>${band}</td>
          <td style="text-align:center;font-variant-numeric:tabular-nums">${c.channel || '–'}</td>
          <td style="text-align:center">${fmtStandard(c.standard)}</td>
          <td><span style="color:${sigCol};font-weight:600;font-variant-numeric:tabular-nums">${sigPct}%</span></td>
          <td class="muted" style="font-variant-numeric:tabular-nums">${rate}</td>
          <td class="muted" title="${escHtml(c.vendor || '')}">${escHtml((c.vendor || '–').length > 18 ? (c.vendor || '–').slice(0, 17) + '…' : (c.vendor || '–'))}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>
  </div>`;

  wrap.innerHTML = html;
}

function buildBandChart(b24, b50, b6) {
  const total = b24 + b50 + b6 || 1;
  const p24 = Math.round(b24 / total * 100);
  const p50 = Math.round(b50 / total * 100);
  const p6 = Math.round(b6 / total * 100);
  let bar = '';
  if (b50) bar += `<div style="width:${p50}%;background:var(--blue);border-radius:4px 0 0 4px" title="5 GHz: ${b50} (${p50}%)"></div>`;
  if (b24) bar += `<div style="width:${p24}%;background:var(--amber)" title="2.4 GHz: ${b24} (${p24}%)"></div>`;
  if (b6) bar += `<div style="width:${p6}%;background:var(--green);border-radius:0 4px 4px 0" title="6 GHz: ${b6} (${p6}%)"></div>`;
  return `<div class="wc-chart-card">
    <div class="wc-chart-title">Band-Verteilung</div>
    <div class="wc-stacked-bar">${bar}</div>
    <div class="wc-chart-legend">
      <span><span class="wc-dot" style="background:var(--blue)"></span>5 GHz: ${b50} (${p50}%)</span>
      <span><span class="wc-dot" style="background:var(--amber)"></span>2.4 GHz: ${b24} (${p24}%)</span>
      ${b6 ? `<span><span class="wc-dot" style="background:var(--green)"></span>6 GHz: ${b6} (${p6}%)</span>` : ''}
    </div>
  </div>`;
}

function buildSsidChart(ssids, total) {
  const colors = ['var(--blue)', 'var(--amber)', 'var(--green)', 'var(--red)', '#7c3aed', '#0891b2', '#be185d'];
  let bar = '';
  ssids.forEach(([name, count], i) => {
    const pct = Math.round(count / total * 100);
    const r = i === 0 ? '4px 0 0 4px' : i === ssids.length - 1 ? '0 4px 4px 0' : '0';
    bar += `<div style="width:${pct}%;background:${colors[i % colors.length]};border-radius:${r}" title="${name}: ${count} (${pct}%)"></div>`;
  });
  return `<div class="wc-chart-card">
    <div class="wc-chart-title">SSID-Verteilung</div>
    <div class="wc-stacked-bar">${bar}</div>
    <div class="wc-chart-legend">
      ${ssids.map(([name, count], i) => `<span><span class="wc-dot" style="background:${colors[i % colors.length]}"></span>${escHtml(name)}: ${count}</span>`).join('')}
    </div>
  </div>`;
}

function buildSignalHistogram(signals) {
  if (!signals.length) return '';
  const buckets = [0, 0, 0, 0, 0];
  const labels = ['0–20%', '20–40%', '40–60%', '60–80%', '80–100%'];
  const bucketColors = ['var(--red)', '#e65100', 'var(--amber)', '#7cb342', 'var(--green)'];
  signals.forEach(s => {
    if (s < 20) buckets[0]++;
    else if (s < 40) buckets[1]++;
    else if (s < 60) buckets[2]++;
    else if (s < 80) buckets[3]++;
    else buckets[4]++;
  });
  const max = Math.max(1, ...buckets);

  return `<div class="wc-section">
    <div class="wc-section-title"><i class="fa-solid fa-signal" style="color:var(--amber)"></i> Signalqualität-Verteilung</div>
    <div class="wc-histo">
      ${buckets.map((count, i) => {
        const h = Math.max(4, Math.round(count / max * 120));
        return `<div class="wc-histo-col">
          <div class="wc-histo-val">${count}</div>
          <div class="wc-histo-bar" style="height:${h}px;background:${bucketColors[i]}"></div>
          <div class="wc-histo-lbl">${labels[i]}</div>
        </div>`;
      }).join('')}
    </div>
  </div>`;
}

function fmtWlanRate(bps) {
  if (!bps) return '–';
  if (bps >= 1000000) return (bps / 1000000).toFixed(1) + ' Mbps';
  if (bps >= 1000) return Math.round(bps / 1000) + ' kbps';
  return bps + ' bps';
}

function fmtStandard(s) {
  if (!s) return '–';
  const map = { 'a': 'a', 'b': 'b', 'g': 'g', 'n': 'Wi-Fi 4', 'ac': 'Wi-Fi 5', 'ax': 'Wi-Fi 6', 'be': 'Wi-Fi 7' };
  return map[s] || s;
}

function resetWcState() { wcData = {}; wcLoading = false; }

export { loadWlanCapacity, renderWlanCapacity, resetWcState };
