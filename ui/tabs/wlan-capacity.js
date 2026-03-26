import S from '../lib/state.js';
import { escHtml, deviceName, isOnline } from '../lib/helpers.js';
import { api, toast } from '../lib/api.js';

let wcData = {};   // { deviceId: { name, hourly: [{ts, count}], daily: [{ts, count}] } }
let wcLoading = false;

const HOUR_LABELS = ['00','01','02','03','04','05','06','07','08','09','10','11','12','13','14','15','16','17','18','19','20','21','22','23'];
const DAY_LABELS  = ['Mo','Di','Mi','Do','Fr','Sa','So'];
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

  const days = parseInt(document.getElementById('wc-period')?.value || '7');
  wcData = {};

  const batches = [];
  for (let i = 0; i < ids.length; i += 5) batches.push(ids.slice(i, i + 5));

  for (const batch of batches) {
    await Promise.allSettled(batch.map(async deviceId => {
      const dev = S.devices[deviceId];
      const name = deviceName(dev);
      const isAP = (dev.deviceType || '').includes('ACCESS_POINT') ||
                   (dev.status?.softwareVersion || '').includes('LX') ||
                   S.wlanClients[deviceId] > 0;
      if (!isAP && !S.wlanClients[deviceId]) return;

      try {
        const data = await api('monitoring',
          `/accounts/${S.accountId}/records/wlan_info_json?group=DEVICE&groupId=${deviceId}&period=HOUR1&type=json&name=stations&latest=${days * 24}`
        );
        const values = data?.items?.stations?.values || [];
        const timestamps = data?.items?.stations?.timestamps || [];

        const hourly = [];
        for (let i = 0; i < values.length; i++) {
          const stationList = values[i] || [];
          const ts = timestamps[i] ? new Date(timestamps[i]).getTime() : (Date.now() - (values.length - i) * 3600000);
          hourly.push({ ts, count: stationList.length });
        }

        if (hourly.length > 0) {
          wcData[deviceId] = { name, hourly, online: isOnline(dev), siteName: dev.siteName || '' };
        }
      } catch { /* skip device */ }
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
    wrap.innerHTML = `<div class="empty-state"><i class="fa-solid fa-chart-area"></i><h3>Keine WLAN-Daten</h3><p>Keine APs mit Client-Daten gefunden.</p></div>`;
    return;
  }

  const now = Date.now();
  let totalClientsNow = 0;
  let peakClients = 0;
  let peakAP = '';
  let peakTime = 0;
  let apCount = entries.length;

  const apStats = entries.map(([id, d]) => {
    const last = d.hourly[d.hourly.length - 1]?.count || 0;
    totalClientsNow += last;
    const max = Math.max(...d.hourly.map(h => h.count));
    const avg = d.hourly.reduce((s, h) => s + h.count, 0) / d.hourly.length;
    const peakEntry = d.hourly.find(h => h.count === max);
    if (max > peakClients) { peakClients = max; peakAP = d.name; peakTime = peakEntry?.ts || 0; }
    const overWarn = d.hourly.filter(h => h.count >= WARN_THRESHOLD).length;
    const overCrit = d.hourly.filter(h => h.count >= CRIT_THRESHOLD).length;

    return { id, name: d.name, siteName: d.siteName, online: d.online, current: last, peak: max, avg, peakTs: peakEntry?.ts || 0, overWarn, overCrit, hourly: d.hourly };
  }).sort((a, b) => b.peak - a.peak);

  const warnAPs = apStats.filter(a => a.overWarn > 0).length;
  const critAPs = apStats.filter(a => a.overCrit > 0).length;
  const avgAll = entries.reduce((s, [, d]) => s + d.hourly.reduce((s2, h) => s2 + h.count, 0) / d.hourly.length, 0);

  let html = `<div class="wc-stats">
    <div class="wc-stat"><div class="wc-stat-icon" style="background:rgba(0,76,151,.1);color:var(--accent)"><i class="fa-solid fa-wifi"></i></div><div class="wc-stat-val">${totalClientsNow}</div><div class="wc-stat-lbl">Clients jetzt</div></div>
    <div class="wc-stat"><div class="wc-stat-icon" style="background:rgba(211,47,47,.1);color:var(--red)"><i class="fa-solid fa-arrow-up"></i></div><div class="wc-stat-val">${peakClients}</div><div class="wc-stat-lbl">Peak (${peakAP})</div></div>
    <div class="wc-stat"><div class="wc-stat-icon" style="background:rgba(26,138,62,.1);color:var(--green)"><i class="fa-solid fa-chart-line"></i></div><div class="wc-stat-val">${avgAll.toFixed(1)}</div><div class="wc-stat-lbl">Ø Clients gesamt</div></div>
    <div class="wc-stat"><div class="wc-stat-icon" style="background:rgba(0,76,151,.1);color:var(--blue)"><i class="fa-solid fa-tower-broadcast"></i></div><div class="wc-stat-val">${apCount}</div><div class="wc-stat-lbl">Access Points</div></div>
    <div class="wc-stat"><div class="wc-stat-icon" style="background:rgba(217,119,6,.1);color:var(--amber)"><i class="fa-solid fa-triangle-exclamation"></i></div><div class="wc-stat-val">${warnAPs}</div><div class="wc-stat-lbl">APs ≥${WARN_THRESHOLD} Clients</div></div>
    <div class="wc-stat"><div class="wc-stat-icon" style="background:rgba(211,47,47,.1);color:var(--red)"><i class="fa-solid fa-circle-exclamation"></i></div><div class="wc-stat-val">${critAPs}</div><div class="wc-stat-lbl">APs ≥${CRIT_THRESHOLD} Clients</div></div>
  </div>`;

  // Heatmap: hours of week × APs
  html += `<div class="wc-section">
    <div class="wc-section-title"><i class="fa-solid fa-fire" style="color:var(--red)"></i> Heatmap – Clients pro Stunde</div>
    ${buildHeatmap(apStats)}
  </div>`;

  // Timeline
  html += `<div class="wc-section">
    <div class="wc-section-title"><i class="fa-solid fa-chart-area" style="color:var(--blue)"></i> Zeitverlauf</div>
    ${buildTimeline(apStats)}
  </div>`;

  // AP Table
  html += `<div class="wc-section">
    <div class="wc-section-title"><i class="fa-solid fa-table" style="color:var(--accent)"></i> AP-Kapazitätsübersicht</div>
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>Access Point</th><th>Standort</th><th>Jetzt</th><th>Peak</th><th>Ø</th><th>Peak-Zeit</th><th>Status</th><th>Auslastung</th></tr></thead>
      <tbody>${apStats.map(a => {
        const pct = Math.min(100, Math.round(a.peak / CRIT_THRESHOLD * 100));
        const barCol = a.overCrit ? 'var(--red)' : a.overWarn ? 'var(--amber)' : 'var(--green)';
        const statusLabel = a.overCrit ? '<span style="color:var(--red);font-weight:700">Kritisch</span>'
          : a.overWarn ? '<span style="color:var(--amber);font-weight:700">Warnung</span>'
          : '<span style="color:var(--green)">OK</span>';
        const peakDate = a.peakTs ? new Date(a.peakTs) : null;
        const peakStr = peakDate ? `${DAY_LABELS[peakDate.getDay() === 0 ? 6 : peakDate.getDay()-1]} ${peakDate.getHours()}:00` : '–';
        return `<tr>
          <td style="font-weight:600">${escHtml(a.name)}</td>
          <td class="muted">${escHtml(a.siteName || '–')}</td>
          <td style="font-weight:600;font-variant-numeric:tabular-nums">${a.current}</td>
          <td style="font-weight:700;color:${a.peak >= CRIT_THRESHOLD ? 'var(--red)' : a.peak >= WARN_THRESHOLD ? 'var(--amber)' : 'var(--text)'};font-variant-numeric:tabular-nums">${a.peak}</td>
          <td class="muted" style="font-variant-numeric:tabular-nums">${a.avg.toFixed(1)}</td>
          <td class="muted">${peakStr}</td>
          <td>${statusLabel}</td>
          <td><div class="wc-bar-wrap"><div class="wc-bar" style="width:${pct}%;background:${barCol}"></div><span class="wc-bar-label">${pct}%</span></div></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>
  </div>`;

  wrap.innerHTML = html;
}

function buildHeatmap(apStats) {
  if (!apStats.length) return '';
  const top = apStats.slice(0, 15);
  const grid = {};
  let maxCount = 1;

  top.forEach(a => {
    grid[a.id] = new Array(7 * 24).fill(0);
    a.hourly.forEach(h => {
      const d = new Date(h.ts);
      const dow = d.getDay() === 0 ? 6 : d.getDay() - 1;
      const hour = d.getHours();
      const idx = dow * 24 + hour;
      if (idx >= 0 && idx < 168) {
        grid[a.id][idx] = Math.max(grid[a.id][idx], h.count);
        if (h.count > maxCount) maxCount = h.count;
      }
    });
  });

  let html = `<div class="wc-heatmap-scroll"><table class="wc-heatmap"><thead><tr><th class="wc-hm-label"></th>`;
  for (let d = 0; d < 7; d++) {
    html += `<th class="wc-hm-day" colspan="24">${DAY_LABELS[d]}</th>`;
  }
  html += '</tr><tr><th class="wc-hm-label"></th>';
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      html += h % 6 === 0 ? `<th class="wc-hm-hour">${HOUR_LABELS[h]}</th>` : '<th class="wc-hm-hour"></th>';
    }
  }
  html += '</tr></thead><tbody>';

  top.forEach(a => {
    html += `<tr><td class="wc-hm-label" title="${escHtml(a.name)}">${escHtml(a.name.length > 18 ? a.name.slice(0, 17) + '…' : a.name)}</td>`;
    for (let i = 0; i < 168; i++) {
      const v = grid[a.id][i];
      const intensity = v / maxCount;
      const bg = v === 0 ? 'var(--card2)'
        : v >= CRIT_THRESHOLD ? `rgba(211,47,47,${0.3 + intensity * 0.7})`
        : v >= WARN_THRESHOLD ? `rgba(217,119,6,${0.2 + intensity * 0.6})`
        : `rgba(0,76,151,${0.08 + intensity * 0.5})`;
      html += `<td class="wc-hm-cell" style="background:${bg}" title="${a.name}: ${v} Clients (${DAY_LABELS[Math.floor(i/24)]} ${HOUR_LABELS[i%24]}:00)">${v > 0 ? v : ''}</td>`;
    }
    html += '</tr>';
  });

  html += '</tbody></table></div>';

  html += `<div class="wc-hm-legend">
    <span class="wc-hm-legend-item"><span class="wc-hm-swatch" style="background:var(--card2)"></span>0</span>
    <span class="wc-hm-legend-item"><span class="wc-hm-swatch" style="background:rgba(0,76,151,.25)"></span>1–${WARN_THRESHOLD-1}</span>
    <span class="wc-hm-legend-item"><span class="wc-hm-swatch" style="background:rgba(217,119,6,.5)"></span>${WARN_THRESHOLD}–${CRIT_THRESHOLD-1}</span>
    <span class="wc-hm-legend-item"><span class="wc-hm-swatch" style="background:rgba(211,47,47,.7)"></span>≥${CRIT_THRESHOLD}</span>
  </div>`;

  return html;
}

function buildTimeline(apStats) {
  if (!apStats.length) return '';
  const top = apStats.slice(0, 8);
  const allTs = [];
  top.forEach(a => a.hourly.forEach(h => { if (!allTs.includes(h.ts)) allTs.push(h.ts); }));
  allTs.sort((a, b) => a - b);
  if (!allTs.length) return '';

  const W = 960, H = 220, PL = 40, PR = 10, PT = 10, PB = 30;
  const cw = W - PL - PR, ch = H - PT - PB;
  const maxVal = Math.max(1, ...top.flatMap(a => a.hourly.map(h => h.count)));
  const minTs = allTs[0], maxTs = allTs[allTs.length - 1];
  const rangeTs = maxTs - minTs || 1;

  const colors = ['#004c97','#d32f2f','#1a8a3e','#d97706','#0891b2','#7c3aed','#be185d','#475569'];

  let svg = `<svg viewBox="0 0 ${W} ${H}" class="wc-timeline-svg">`;

  // grid lines
  for (let i = 0; i <= 4; i++) {
    const y = PT + ch - (i / 4) * ch;
    const val = Math.round(maxVal * i / 4);
    svg += `<line x1="${PL}" y1="${y}" x2="${W - PR}" y2="${y}" stroke="rgba(0,40,85,.08)" stroke-width="1"/>`;
    svg += `<text x="${PL - 4}" y="${y + 3}" text-anchor="end" font-size="9" fill="var(--text3)" font-family="var(--mono)">${val}</text>`;
  }

  // time axis
  const dayMs = 86400000;
  let cursor = new Date(minTs);
  cursor.setHours(0, 0, 0, 0);
  cursor = cursor.getTime() + dayMs;
  while (cursor < maxTs) {
    const x = PL + ((cursor - minTs) / rangeTs) * cw;
    const d = new Date(cursor);
    svg += `<line x1="${x}" y1="${PT}" x2="${x}" y2="${H - PB}" stroke="rgba(0,40,85,.06)" stroke-width="1"/>`;
    svg += `<text x="${x}" y="${H - PB + 14}" text-anchor="middle" font-size="9" fill="var(--text3)" font-family="var(--font)">${DAY_LABELS[d.getDay() === 0 ? 6 : d.getDay()-1]} ${d.getDate()}.${d.getMonth()+1}</text>`;
    cursor += dayMs;
  }

  // lines per AP
  top.forEach((a, idx) => {
    const sorted = [...a.hourly].sort((x, y) => x.ts - y.ts);
    if (sorted.length < 2) return;
    const pts = sorted.map(h => {
      const x = PL + ((h.ts - minTs) / rangeTs) * cw;
      const y = PT + ch - (h.count / maxVal) * ch;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    svg += `<polyline points="${pts}" fill="none" stroke="${colors[idx % colors.length]}" stroke-width="1.5" stroke-linejoin="round" opacity="0.8"/>`;
  });

  svg += '</svg>';

  // Legend
  let legend = '<div class="wc-timeline-legend">';
  top.forEach((a, idx) => {
    legend += `<span class="wc-tl-item"><span class="wc-tl-dot" style="background:${colors[idx % colors.length]}"></span>${escHtml(a.name.length > 20 ? a.name.slice(0, 19) + '…' : a.name)}</span>`;
  });
  legend += '</div>';

  return svg + legend;
}

function resetWcState() { wcData = {}; wcLoading = false; }

export { loadWlanCapacity, renderWlanCapacity, resetWcState };
