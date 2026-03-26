import S from '../lib/state.js';
import { escHtml, deviceName, isOnline } from '../lib/helpers.js';
import { api, toast } from '../lib/api.js';
import { LC_AP_MAX_CLIENTS } from './lifecycle.js';

// ─── PREDICTIVE ANOMALY ───────────────────────────────────────────────────────
const PA_DAYS = 30;

let paState = {
  loaded: false,
  loading: false,
  results: {},          // deviceId → { predictions[], riskScore }
  progress: { total: 0, done: 0, current: '' },
  lastRun: null
};

/* ── ML Helpers ── */

// Exponential Moving Average (smoothing, α=0.3)
function paEMA(vals, alpha = 0.3) {
  if (!vals.length) return [];
  let e = vals[0];
  return vals.map(v => { e = alpha * v + (1 - alpha) * e; return e; });
}

// Linear Regression → { slope, intercept, r2, predict(x) }
function paLinReg(vals) {
  const n = vals.length;
  if (n < 2) return { slope: 0, intercept: vals[0] || 0, r2: 0, predict: () => vals[0] || 0 };
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  vals.forEach((v, i) => { sumX += i; sumY += v; sumXY += i * v; sumX2 += i * i; });
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX) || 0;
  const intercept = (sumY - slope * sumX) / n;
  const mean = sumY / n;
  let ssTot = 0, ssRes = 0;
  vals.forEach((v, i) => { ssTot += (v - mean) ** 2; ssRes += (v - (slope * i + intercept)) ** 2; });
  const r2 = ssTot > 0 ? Math.max(0, 1 - ssRes / ssTot) : 0;
  return { slope, intercept, r2, predict: x => slope * x + intercept };
}

// Isolation Forest via Z-score → anomaly score [0..1] per value
function paAnomalyScores(vals) {
  if (vals.length < 3) return vals.map(() => 0);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const std = Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length) || 1;
  return vals.map(v => Math.min(1, Math.abs(v - mean) / (std * 3)));
}

// Days until trend reaches threshold from index fromIdx
function paDaysTo(reg, fromIdx, threshold) {
  if (Math.abs(reg.slope) < 0.0001) return Infinity;
  const d = (threshold - reg.predict(fromIdx)) / reg.slope;
  return d > 0 ? d : Infinity;
}

// Confidence score [0..1] combining trend strength, anomaly frequency, urgency
function paConf(r2, aniFreq, urgencyDays) {
  const trendScore  = Math.min(1, r2);
  const freqScore   = Math.min(1, aniFreq / 0.3);
  const urgScore    = urgencyDays < Infinity ? Math.max(0, 1 - urgencyDays / 30) : 0;
  return Math.round((trendScore * 0.4 + freqScore * 0.35 + urgScore * 0.25) * 100);
}

// Overall device risk score 0-100
function paRiskScore(predictions) {
  if (!predictions.length) return 0;
  let score = 0;
  predictions.forEach(p => {
    const base = p.severity === 'critical' ? 20 : 8;
    score += base * (p.conf / 100);
  });
  return Math.min(100, Math.round(score));
}

/* ── Data Fetching ── */

// Parse Records API type=table response { keys/columns, values } → array of row-objects
function paParseTableRecord(tableData) {
  if (!tableData) return [];
  const keys = tableData.keys || tableData.columns || [];
  const values = tableData.values || [];
  const rows = values.map(row => {
    const obj = {};
    keys.forEach((k, i) => { obj[k] = row[i]; });
    // Normalize timestamp → timeMs if needed
    if (obj.timestamp !== undefined && obj.timeMs === undefined) obj.timeMs = obj.timestamp;
    return obj;
  });
  return rows.sort((a, b) => (a.timeMs || 0) - (b.timeMs || 0));
}

// Fetch 30-day telemetry for one device
async function paFetchDevice(deviceId) {
  const fromMs = Date.now() - PA_DAYS * 86400000;
  const fromStr = new Date(fromMs).toISOString().slice(0, 19) + 'Z';
  // All tables via monitor-frontend service (correct field names + period support)
  const tables = {
    'device-info':    ['timeMs','cpuLoadPercent','totalMemoryKb','freeMemoryKb','temperature'],
    'lan-interface':  ['timeMs','name','active','loopCounter','poePowerMilliWatt','rxDeltaBytes','txDeltaBytes'],
    'vpn-connection': ['timeMs','peerName','active','packetLossPercent','rttAvgUs','jitterUs'],
    'wan-interface':  ['timeMs','connectionType','logicalState','mobileModemSignalDecibelMw','backupInActiveUse'],
    'wlan-interface': ['timeMs','clientCount','band','transmitPowerDecibelMw','noiseDecibelMw','rxErrorPermill'],
  };
  const results = {};

  await Promise.allSettled(Object.entries(tables).map(async ([table, cols]) => {
    try {
      const colStr = cols.map(c => `column=${encodeURIComponent(c)}`).join('&');
      const qs = `deviceId=${encodeURIComponent(deviceId)}&from=${encodeURIComponent(fromStr)}&limit=2000&sort=timeMs&order=asc&${colStr}`;
      const data = await api('monitor-frontend', `/api/${S.accountId}/tables/${table}?${qs}`);
      results[table] = (data?.data || []);
    } catch { results[table] = []; }
  }));

  // WLAN time-series (Records API)
  try {
    const data = await api('monitoring', `/accounts/${S.accountId}/records/wlan_info_json?group=DEVICE&groupId=${deviceId}&period=DAY1&type=json&name=stations&latest=${PA_DAYS}`);
    results['wlan'] = data?.items?.stations?.values || [];
  } catch { results['wlan'] = []; }
  return results;
}

// Bin rows by day-index (0 = oldest) → array of daily avg values for a field
function paBinByDay(rows, timeField, valueField, aggFn = 'avg') {
  const fromMs = Date.now() - PA_DAYS * 86400000;
  const buckets = {};
  rows.forEach(r => {
    const t = r[timeField] || r.timeMs;
    if (!t || t < fromMs) return;
    const dayIdx = Math.floor((t - fromMs) / 86400000);
    if (!buckets[dayIdx]) buckets[dayIdx] = [];
    const v = parseFloat(r[valueField]);
    if (!isNaN(v)) buckets[dayIdx].push(v);
  });
  const result = [];
  for (let i = 0; i < PA_DAYS; i++) {
    const vals = buckets[i] || [];
    if (!vals.length) { result.push(null); continue; }
    if (aggFn === 'avg') result.push(vals.reduce((a, b) => a + b, 0) / vals.length);
    else if (aggFn === 'max') result.push(Math.max(...vals));
    else if (aggFn === 'min') result.push(Math.min(...vals));
  }
  return result;
}

// Fill nulls with linear interpolation for ML (use last-seen for gaps)
function paFillNulls(arr) {
  const filled = [...arr];
  let last = 0;
  for (let i = 0; i < filled.length; i++) {
    if (filled[i] !== null) { last = filled[i]; }
    else { filled[i] = last; }
  }
  return filled;
}

/* ── Analysis ── */

function paAnalyzeDevice(deviceId, raw) {
  const dev = S.devices[deviceId] || {};
  const name = deviceName(dev);
  const predictions = [];

  // Helper: push prediction
  const push = (type, title, desc, severity, conf, vals, unit, threshold, daysTo, autofix) => {
    predictions.push({ type, title, desc, severity, conf: Math.max(1, Math.min(99, conf)), vals, unit, threshold, daysTo, autofix });
  };

  // ── 1. CPU overload trend ──────────────────────────────────────────────────
  const cpuRows = raw['device-info'] || [];
  const cpuDaily = paFillNulls(paBinByDay(cpuRows, 'timeMs', 'cpu_load', 'avg'));
  if (cpuDaily.length >= 5) {
    const smooth = paEMA(cpuDaily);
    const reg = paLinReg(smooth);
    const ani = paAnomalyScores(cpuDaily);
    const aniFreq = ani.filter(s => s > 0.5).length / ani.length;
    const last = smooth[smooth.length - 1];
    const daysTo90 = paDaysTo(reg, smooth.length - 1, 90);
    if (last > 70 || (reg.slope > 1.5 && reg.r2 > 0.4)) {
      const sev = last > 85 || daysTo90 < 7 ? 'critical' : 'warning';
      const conf = paConf(reg.r2, aniFreq, daysTo90);
      if (conf > 20) push('cpu_overload',
        `CPU-Überlastung: ${name}`,
        daysTo90 < Infinity ? `Trend: 90 % in ~${Math.round(daysTo90)} Tagen erreicht (aktuell ${Math.round(last)} %)` : `Aktuell ${Math.round(last)} % – Anomaliefrequenz erhöht`,
        sev, conf, cpuDaily, '%', 90, daysTo90, ['Prozesse prüfen', 'Firmware-Update', 'Gerät neustarten']);
    }
  }

  // ── 2. Memory leak ────────────────────────────────────────────────────────
  // Compute utilization % from totalMemoryKb + freeMemoryKb
  const memComputedRows = cpuRows.map(r => {
    const total = r.totalMemoryKb || 0;
    const free  = r.freeMemoryKb  || 0;
    return { ...r, _memUtil: total > 0 ? Math.round((1 - free / total) * 100) : 0 };
  });
  const memDaily = paFillNulls(paBinByDay(memComputedRows, 'timeMs', '_memUtil', 'avg'));
  if (memDaily.length >= 5) {
    const smooth = paEMA(memDaily);
    const reg = paLinReg(smooth);
    const last = smooth[smooth.length - 1];
    const daysTo95 = paDaysTo(reg, smooth.length - 1, 95);
    if (reg.slope > 0.5 && reg.r2 > 0.45 && last > 60) {
      const sev = daysTo95 < 14 ? 'critical' : 'warning';
      const conf = paConf(reg.r2, 0, daysTo95);
      if (conf > 20) push('memory_leak',
        `Memory-Leak-Verdacht: ${name}`,
        `RAM-Auslastung steigt monoton (${Math.round(reg.slope * 10) / 10}%/Tag). 95 % in ~${isFinite(daysTo95) ? Math.round(daysTo95) : '>30'} Tagen.`,
        sev, conf, memDaily, '%', 95, daysTo95, ['Gerät neustarten', 'Firmware-Update', 'Prozess-Diagnose via LCOS']);
    }
  }

  // ── 3. Overheating ────────────────────────────────────────────────────────
  const tempDaily = paFillNulls(paBinByDay(cpuRows, 'timeMs', 'temperature', 'max'));
  if (tempDaily.some(v => v > 0)) {
    const reg = paLinReg(paEMA(tempDaily));
    const last = tempDaily.filter(v => v > 0).slice(-1)[0] || 0;
    const daysTo75 = paDaysTo(reg, tempDaily.length - 1, 75);
    if (last > 60 || (reg.slope > 0.3 && reg.r2 > 0.4)) {
      const sev = last > 70 ? 'critical' : 'warning';
      const conf = paConf(reg.r2, 0, daysTo75);
      if (conf > 15) push('overheating',
        `Überhitzung: ${name}`,
        `Temperatur: ${Math.round(last)} °C${isFinite(daysTo75) ? ` – 75 °C in ~${Math.round(daysTo75)} Tagen` : ''}`,
        sev, conf, tempDaily, '°C', 75, daysTo75, ['Belüftung prüfen', 'Montageort optimieren', 'Hardware-Check']);
    }
  }

  // ── 4. Port flapping (LAN-Interface) ─────────────────────────────────────
  const lanRows = raw['lan-interface'] || [];
  const portMap = {};
  lanRows.forEach(r => {
    const p = r.name || 'unk';
    if (!portMap[p]) portMap[p] = [];
    portMap[p].push(r);
  });
  Object.entries(portMap).forEach(([port, rows]) => {
    if (rows.length < 10) return;
    // Count state changes (active flips)
    let flaps = 0;
    let prev = rows[0].active;
    rows.forEach(r => { if (r.active !== prev) { flaps++; prev = r.active; } });
    const flapsPerDay = flaps / PA_DAYS;
    if (flapsPerDay > 0.5) {
      const sev = flapsPerDay > 2 ? 'critical' : 'warning';
      const conf = Math.min(90, 30 + Math.round(flapsPerDay * 15));
      const daysTo = flapsPerDay > 3 ? 2 : 7;
      push('port_flapping',
        `Port-Flapping: ${name} – ${port}`,
        `Port ${port} schaltete ${flaps}× in ${PA_DAYS} Tagen (${Math.round(flapsPerDay * 10) / 10}×/Tag). Ausfall in ~${daysTo} Tagen möglich.`,
        sev, conf, [], 'Flaps/Tag', 2, daysTo, ['Kabel tauschen', 'SFP prüfen', 'PoE-Reset', 'Port deaktivieren & aktivieren']);
    }
  });

  // ── 5. VPN instability ────────────────────────────────────────────────────
  const vpnRows = raw['vpn-connection'] || [];
  const vpnLoss  = paFillNulls(paBinByDay(vpnRows, 'timeMs', 'packetLossPercent', 'avg'));
  const vpnRtt   = paFillNulls(paBinByDay(vpnRows, 'timeMs', 'rttAvgUs', 'avg'));
  if (vpnLoss.some(v => v > 0)) {
    const reg = paLinReg(paEMA(vpnLoss));
    const ani = paAnomalyScores(vpnLoss);
    const aniFreq = ani.filter(s => s > 0.5).length / ani.length;
    const last = vpnLoss.filter(v => v > 0).slice(-1)[0] || 0;
    if (last > 3 || (reg.slope > 0.1 && reg.r2 > 0.35)) {
      const sev = last > 8 ? 'critical' : 'warning';
      const daysTo = paDaysTo(reg, vpnLoss.length - 1, 15);
      const conf = paConf(reg.r2, aniFreq, daysTo);
      if (conf > 15) push('vpn_instability',
        `VPN-Instabilität: ${name}`,
        `Paketverlust ${Math.round(last * 10) / 10} %${isFinite(daysTo) ? `, 15 % in ~${Math.round(daysTo)} Tagen` : ''}. RTT ⌀ ${Math.round((vpnRtt.filter(v=>v>0).slice(-1)[0]||0)/1000)} ms.`,
        sev, conf, vpnLoss, '%', 15, daysTo, ['WAN-Interface prüfen', 'MTU anpassen', 'ISP-Ticket', 'Backup-VPN aktivieren']);
    }
  }

  // ── 6. WAN signal degradation ─────────────────────────────────────────────
  const wanRows = raw['wan-interface'] || [];
  const sigDaily = paFillNulls(paBinByDay(wanRows, 'timeMs', 'mobileModemSignalDecibelMw', 'avg'));
  if (sigDaily.some(v => v < -50)) {
    const smooth = paEMA(sigDaily.map(v => v || 0));
    const reg = paLinReg(smooth);
    const last = smooth[smooth.length - 1];
    if (reg.slope < -0.2 && reg.r2 > 0.35 && last < -70) {
      const daysToLost = paDaysTo(reg, smooth.length - 1, -95);
      const conf = paConf(reg.r2, 0, daysToLost);
      if (conf > 15) push('wan_signal',
        `LTE-Signal-Abbau: ${name}`,
        `Signalpegel ${Math.round(last)} dBm und sinkend. Verbindungsabbruch in ~${isFinite(daysToLost) ? Math.round(daysToLost) : '>30'} Tagen.`,
        'warning', conf, sigDaily, 'dBm', -95, daysToLost, ['Antenne ausrichten', 'Antennen-Upgrade', 'SIM-Karte wechseln']);
    }
  }

  // ── 7. WLAN capacity saturation ───────────────────────────────────────────
  // Sum clientCount across all radios per day
  const wlanRows = raw['wlan-interface'] || [];
  const wlanVals = paFillNulls(paBinByDay(wlanRows, 'timeMs', 'clientCount', 'avg'));
  if (wlanVals.length >= 5) {
    const reg = paLinReg(paEMA(wlanVals));
    const last = wlanVals[wlanVals.length - 1];
    const daysTo40 = paDaysTo(reg, wlanVals.length - 1, LC_AP_MAX_CLIENTS);
    if (last > 20 || (reg.slope > 0.3 && reg.r2 > 0.35)) {
      const sev = last > 35 || daysTo40 < 14 ? 'critical' : 'warning';
      const conf = paConf(reg.r2, 0, daysTo40);
      if (conf > 20) push('wlan_capacity',
        `WLAN-Sättigung: ${name}`,
        `${Math.round(last)} Clients aktuell. Kapazitätsgrenze (${LC_AP_MAX_CLIENTS}) in ~${isFinite(daysTo40) ? Math.round(daysTo40) : '>30'} Tagen.`,
        sev, conf, wlanVals, 'Clients', LC_AP_MAX_CLIENTS, daysTo40, ['AP hinzufügen', 'Band Steering aktivieren', 'TX-Power optimieren']);
    }
  }

  // ── Collect current telemetry snapshot ────────────────────────────────────
  const lastPos = arr => arr.filter(v => v !== null && !isNaN(v) && v > 0).slice(-1)[0] ?? null;
  // Latest raw values directly from last device-info row
  const lastDevRow = cpuRows.slice(-1)[0] || {};
  const rawCpu  = lastDevRow.cpuLoadPercent != null ? Math.round(lastDevRow.cpuLoadPercent) : (cpuDaily.length ? Math.round(paEMA(cpuDaily).slice(-1)[0]) : null);
  const rawTotal = lastDevRow.totalMemoryKb || 0;
  const rawFree  = lastDevRow.freeMemoryKb  || 0;
  const rawMem   = rawTotal > 0 ? Math.round((1 - rawFree / rawTotal) * 100) : (memDaily.length ? Math.round(paEMA(memDaily).slice(-1)[0]) : null);
  const rawTemp  = lastDevRow.temperature   != null ? Math.round(lastDevRow.temperature) : lastPos(tempDaily);
  const currentVals = {
    cpu:         rawCpu,
    mem:         rawMem,
    temp:        rawTemp != null ? Math.round(rawTemp) : null,
    vpnLoss:     vpnLoss.some(v => v > 0) ? Math.round(vpnLoss.filter(v=>v>0).slice(-1)[0] * 10) / 10 : null,
    vpnRtt:      vpnRtt.some(v => v > 0)  ? Math.round(vpnRtt.filter(v=>v>0).slice(-1)[0] / 1000)      : null,
    wanSignal:   sigDaily.some(v => v < -10) ? Math.round(sigDaily.filter(v=>v<-10).slice(-1)[0])       : null,
    wlanClients: wlanVals.length ? Math.round(wlanVals.filter(v=>v!==null).slice(-1)[0] ?? 0) : null,
    ports: Object.entries(portMap).map(([pname, prows]) => {
      let flaps = 0, prev = prows[0]?.active;
      prows.forEach(r => { if (r.active !== prev) { flaps++; prev = r.active; } });
      return { name: pname, active: !!(prows[prows.length - 1]?.active), flapsTotal: flaps };
    })
  };
  return { predictions, currentVals };
}

/* ── SVG Sparkline ── */

function paSparkSvg(vals, sev, threshold) {
  const w = 120, h = 36, pad = 4;
  const clean = vals.filter(v => v !== null && !isNaN(v));
  if (clean.length < 2) return '<svg width="120" height="36"></svg>';
  const mn = Math.min(...clean), mx = Math.max(...clean, threshold || 0);
  const rng = mx - mn || 1;
  const sx = i => pad + (i / (vals.length - 1)) * (w - 2 * pad);
  const sy = v => pad + (1 - (v - mn) / rng) * (h - 2 * pad);
  const pts = vals.map((v, i) => [sx(i), sy(v !== null ? v : mn)]);
  const polyline = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const col = sev === 'critical' ? '#d32f2f' : '#004c97';
  let thLine = '';
  if (threshold !== undefined) {
    const ty = sy(threshold).toFixed(1);
    thLine = `<line x1="${pad}" y1="${ty}" x2="${w-pad}" y2="${ty}" stroke="rgba(255,255,255,.25)" stroke-width="1" stroke-dasharray="3,3"/>`;
  }
  return `<svg width="${w}" height="${h}" style="display:block"><polyline points="${polyline}" fill="none" stroke="${col}" stroke-width="1.8" stroke-linejoin="round"/>${thLine}</svg>`;
}

function paRenderCurrentVals(cv) {
  if (!cv) return '<em style="color:var(--text3);font-size:12px">Keine Messdaten verfügbar.</em>';
  const chip = (col, icon, text) => {
    const bg  = col==='r' ? 'rgba(211,47,47,.12)'    : col==='a' ? 'rgba(0,76,151,.1)'   : 'rgba(26,138,62,.1)';
    const bdr = col==='r' ? 'rgba(211,47,47,.3)'     : col==='a' ? 'rgba(0,76,151,.3)'   : 'rgba(26,138,62,.25)';
    const clr = col==='r' ? '#d32f2f'               : col==='a' ? '#004c97'              : '#1a8a3e';
    return `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:6px;font-size:11.5px;font-weight:600;background:${bg};border:1px solid ${bdr};color:${clr}"><i class="fa-solid fa-${icon}" style="font-size:10px;opacity:.8"></i>${text}</span>`;
  };
  const chips = [];
  if (cv.cpu         !== null) chips.push(chip(cv.cpu  >= 70 ? 'r' : cv.cpu  >= 50 ? 'a' : 'g', 'microchip',        `CPU: ${cv.cpu} %`));
  if (cv.mem         !== null) chips.push(chip(cv.mem  >= 75 ? 'r' : cv.mem  >= 60 ? 'a' : 'g', 'memory',           `RAM: ${cv.mem} %`));
  if (cv.temp        !== null) chips.push(chip(cv.temp >= 65 ? 'r' : cv.temp >= 50 ? 'a' : 'g', 'temperature-half', `Temp: ${cv.temp} °C`));
  if (cv.vpnLoss     !== null) chips.push(chip(cv.vpnLoss >= 5 ? 'r' : cv.vpnLoss >= 2 ? 'a' : 'g', 'shield-halved', `VPN-Verlust: ${cv.vpnLoss} %`));
  if (cv.vpnRtt      !== null) chips.push(chip(cv.vpnRtt  >= 100 ? 'r' : cv.vpnRtt  >= 50 ? 'a' : 'g', 'clock',     `VPN-RTT: ${cv.vpnRtt} ms`));
  if (cv.wanSignal   !== null) chips.push(chip(cv.wanSignal <= -80 ? 'r' : cv.wanSignal <= -70 ? 'a' : 'g', 'signal', `LTE: ${cv.wanSignal} dBm`));
  if (cv.wlanClients !== null) chips.push(chip(cv.wlanClients >= 30 ? 'r' : cv.wlanClients >= 20 ? 'a' : 'g', 'wifi', `WLAN: ${cv.wlanClients} Clients`));
  if (cv.ports?.length) {
    const active = cv.ports.filter(p => p.active).length;
    chips.push(chip(active < cv.ports.length * 0.5 ? 'a' : 'g', 'ethernet', `Ports: ${active}/${cv.ports.length} aktiv`));
    cv.ports.filter(p => p.flapsTotal > 0).forEach(p => {
      const fpd = Math.round(p.flapsTotal / PA_DAYS * 10) / 10;
      chips.push(chip(fpd > 2 ? 'r' : 'a', 'bolt', `${p.name}: ${fpd}×/Tag`));
    });
  }
  if (!chips.length) return '<em style="color:var(--text3);font-size:12px">Keine Messdaten in 30 Tagen.</em>';
  return chips.join('');
}

/* ── Progress & Rendering ── */

function paToggleDetail(id) {
  const el = document.getElementById(`pa-detail-${id}`);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

async function paLoadAll() {
  if (!S.accountId || !Object.keys(S.devices).length) return;
  paState.loading = true;
  paState.loaded  = false;
  paState.results = {};
  const ids = Object.keys(S.devices).filter(id => isOnline(S.devices[id]));
  paState.progress = { total: ids.length, done: 0, current: '' };
  renderAnomalyPage();

  // Process in batches of 3
  const batchSize = 3;
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    await Promise.allSettled(batch.map(async id => {
      paState.progress.current = deviceName(S.devices[id]);
      try {
        const raw = await paFetchDevice(id);
        const { predictions: preds, currentVals } = paAnalyzeDevice(id, raw);
        paState.results[id] = { predictions: preds, riskScore: paRiskScore(preds), currentVals };
      } catch { paState.results[id] = { predictions: [], riskScore: 0, currentVals: null }; }
      paState.progress.done++;
    }));
    // Update progress bar
    const wrap = document.getElementById('pa-wrap');
    const pb = wrap?.querySelector('.pa-progress-bar');
    if (pb) { pb.style.width = `${Math.round(paState.progress.done / paState.progress.total * 100)}%`; }
    const pl = wrap?.querySelector('.pa-progress-label');
    if (pl) pl.textContent = `Analysiere ${paState.progress.current}… (${paState.progress.done}/${paState.progress.total})`;
  }
  paState.loading = false;
  paState.loaded  = true;
  paState.lastRun = new Date();
  const lr = document.getElementById('pa-last-run');
  if (lr) lr.textContent = 'Letzte Analyse: ' + paState.lastRun.toLocaleTimeString('de-DE');
  renderAnomalyPage();
}

function renderAnomalyPage() {
  const wrap = document.getElementById('pa-wrap');
  if (!wrap) return;

  // No devices loaded yet
  if (!Object.keys(S.devices).length) {
    wrap.innerHTML = `<div class="empty-state"><i class="fa-solid fa-brain"></i><h3>Keine Geräte geladen</h3><p>Zuerst oben verbinden und Gerätedaten laden.</p></div>`;
    return;
  }

  // Not yet started → show start button
  if (!paState.loaded && !paState.loading) {
    wrap.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-brain" style="color:var(--accent)"></i>
        <h3>30-Tage Telemetry-Analyse</h3>
        <p>Analysiert CPU, RAM, Temperatur, Port-Flapping, VPN, WAN-Signal und WLAN-Kapazität<br>
        für ${Object.values(S.devices).filter(d=>isOnline(d)).length} online Geräte (von ${Object.keys(S.devices).length} gesamt) mit 3 ML-Modellen.</p>
        <div style="margin-top:16px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
          <div class="pa-model-row"><span class="pa-model-badge">EMA</span> Exponential Moving Average</div>
          <div class="pa-model-row"><span class="pa-model-badge" style="background:rgba(217,119,6,.15);color:#d97706">LinReg</span> Linear Regression</div>
          <div class="pa-model-row"><span class="pa-model-badge" style="background:rgba(211,47,47,.15);color:#d32f2f">IsoForest</span> Isolation Forest (Z-Score)</div>
        </div>
        <button onclick="paLoadAll()" style="margin-top:20px;background:linear-gradient(135deg,#001f40,#004c97);border:none;border-radius:10px;color:#fff;font-size:14px;font-weight:700;padding:12px 28px;cursor:pointer;display:inline-flex;align-items:center;gap:8px">
          <i class="fa-solid fa-play"></i> Analyse starten
        </button>
      </div>`;
    return;
  }

  // Loading / Progress
  if (paState.loading) {
    const pct = paState.progress.total ? Math.round(paState.progress.done / paState.progress.total * 100) : 0;
    wrap.innerHTML = `
      <div style="max-width:500px;margin:60px auto;text-align:center">
        <i class="fa-solid fa-brain fa-spin" style="font-size:40px;color:var(--accent);margin-bottom:20px"></i>
        <h3 style="color:var(--text);margin-bottom:12px">Telemetry wird analysiert…</h3>
        <div style="background:var(--border);border-radius:8px;height:10px;overflow:hidden;margin-bottom:12px">
          <div class="pa-progress-bar" style="height:100%;width:${pct}%;background:linear-gradient(90deg,#001f40,#004c97);transition:width .3s"></div>
        </div>
        <p class="pa-progress-label" style="color:var(--text2);font-size:13px">Analysiere… (${paState.progress.done}/${paState.progress.total})</p>
      </div>`;
    return;
  }

  // Results
  const allPreds = [];
  const deviceScores = Object.entries(paState.results)
    .map(([id, r]) => ({ id, dev: S.devices[id], score: r.riskScore, preds: r.predictions, cv: r.currentVals || null }))
    .sort((a, b) => b.score - a.score);

  deviceScores.forEach(d => d.preds.forEach(p => allPreds.push({ ...p, deviceId: d.id, deviceName: deviceName(d.dev || {}) })));

  const critical = allPreds.filter(p => p.severity === 'critical');
  const warnings = allPreds.filter(p => p.severity === 'warning');
  const devWithRisk = deviceScores.filter(d => d.score > 0).length;
  const avgRisk = deviceScores.length ? Math.round(deviceScores.reduce((a, d) => a + d.score, 0) / deviceScores.length) : 0;

  // Update sidebar badge
  const badge = document.getElementById('badge-anomaly');
  if (badge) badge.textContent = (critical.length + warnings.length) || '–';

  // 48h predictions (high-confidence, short timeframe)
  const next48h = allPreds.filter(p => p.daysTo !== undefined && p.daysTo < 3 && p.conf > 40)
    .sort((a, b) => a.daysTo - b.daysTo).slice(0, 5);

  let html = `
    <!-- KPI Row -->
    <div class="pa-kpi-row">
      <div class="pa-kpi">
        <div class="pa-kpi-icon pki-red"><i class="fa-solid fa-triangle-exclamation"></i></div>
        <div class="pa-kpi-val">${critical.length}</div>
        <div class="pa-kpi-lbl">Kritische Anomalien</div>
      </div>
      <div class="pa-kpi">
        <div class="pa-kpi-icon pki-amber"><i class="fa-solid fa-circle-exclamation"></i></div>
        <div class="pa-kpi-val">${warnings.length}</div>
        <div class="pa-kpi-lbl">Warnungen</div>
      </div>
      <div class="pa-kpi">
        <div class="pa-kpi-icon pki-blue"><i class="fa-solid fa-server"></i></div>
        <div class="pa-kpi-val">${devWithRisk}</div>
        <div class="pa-kpi-lbl">Geräte mit Risiko</div>
      </div>
      <div class="pa-kpi">
        <div class="pa-kpi-icon pki-green"><i class="fa-solid fa-gauge-high"></i></div>
        <div class="pa-kpi-val">${avgRisk}</div>
        <div class="pa-kpi-lbl">Ø Risk-Score</div>
      </div>
    </div>

    <!-- Analysetypen Info-Panel -->
    <details style="background:var(--card);border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-bottom:4px;">
      <summary style="padding:11px 16px;cursor:pointer;font-size:12px;font-weight:700;color:var(--text2);display:flex;align-items:center;gap:8px;list-style:none;user-select:none;">
        <i class="fa-solid fa-circle-info" style="color:var(--accent)"></i>
        Analysetypen &amp; Erkennungsschwellenwerte
        <i class="fa-solid fa-chevron-down" style="margin-left:auto;font-size:10px;opacity:.5"></i>
      </summary>
      <div style="padding:0 16px 14px;display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px;margin-top:4px;">
        <div style="background:var(--bg2);border-radius:8px;padding:10px 12px;font-size:11.5px;">
          <div style="font-weight:700;margin-bottom:6px;display:flex;align-items:center;gap:6px;color:var(--text)">
            <i class="fa-solid fa-microchip" style="color:#d32f2f"></i> CPU-Überlastung
          </div>
          <div style="color:var(--text2);line-height:1.8">
            <span class="pa-conf-badge" style="background:rgba(211,47,47,.15);color:#d32f2f">Kritisch</span> Last &gt; <strong style="color:var(--text)">85 %</strong> oder Trend → 90 % in &lt; 7 Tagen<br>
            <span class="pa-conf-badge" style="background:rgba(0,76,151,.1);color:var(--accent)">Warnung</span> Last &gt; <strong style="color:var(--text)">70 %</strong> oder Trend steigend (R² &gt; 0.4)<br>
            <span style="opacity:.5;font-size:11px">Quelle: records/device_info · cpu_load</span>
          </div>
        </div>
        <div style="background:var(--bg2);border-radius:8px;padding:10px 12px;font-size:11.5px;">
          <div style="font-weight:700;margin-bottom:6px;display:flex;align-items:center;gap:6px;color:var(--text)">
            <i class="fa-solid fa-memory" style="color:#d32f2f"></i> Memory-Leak
          </div>
          <div style="color:var(--text2);line-height:1.8">
            <span class="pa-conf-badge" style="background:rgba(211,47,47,.15);color:#d32f2f">Kritisch</span> Monotoner Anstieg → 95 % in &lt; 14 Tagen<br>
            <span class="pa-conf-badge" style="background:rgba(0,76,151,.1);color:var(--accent)">Warnung</span> Slope &gt; 0.5 %/Tag &amp; RAM &gt; <strong style="color:var(--text)">60 %</strong> &amp; R² &gt; 0.45<br>
            <span style="opacity:.5;font-size:11px">Quelle: records/device_info · (total_memory − free_memory) / total_memory</span>
          </div>
        </div>
        <div style="background:var(--bg2);border-radius:8px;padding:10px 12px;font-size:11.5px;">
          <div style="font-weight:700;margin-bottom:6px;display:flex;align-items:center;gap:6px;color:var(--text)">
            <i class="fa-solid fa-temperature-half" style="color:#d32f2f"></i> Überhitzung
          </div>
          <div style="color:var(--text2);line-height:1.8">
            <span class="pa-conf-badge" style="background:rgba(211,47,47,.15);color:#d32f2f">Kritisch</span> Temperatur &gt; <strong style="color:var(--text)">70 °C</strong><br>
            <span class="pa-conf-badge" style="background:rgba(0,76,151,.1);color:var(--accent)">Warnung</span> &gt; <strong style="color:var(--text)">60 °C</strong> oder Trend steigend → 75 °C<br>
            <span style="opacity:.5;font-size:11px">Quelle: records/device_info · temperature</span>
          </div>
        </div>
        <div style="background:var(--bg2);border-radius:8px;padding:10px 12px;font-size:11.5px;">
          <div style="font-weight:700;margin-bottom:6px;display:flex;align-items:center;gap:6px;color:var(--text)">
            <i class="fa-solid fa-ethernet" style="color:var(--accent)"></i> Port-Flapping
          </div>
          <div style="color:var(--text2);line-height:1.8">
            <span class="pa-conf-badge" style="background:rgba(211,47,47,.15);color:#d32f2f">Kritisch</span> &gt; <strong style="color:var(--text)">2 Flaps/Tag</strong> (Link up/down)<br>
            <span class="pa-conf-badge" style="background:rgba(0,76,151,.1);color:var(--accent)">Warnung</span> &gt; <strong style="color:var(--text)">0.5 Flaps/Tag</strong> in 30 Tagen<br>
            <span style="opacity:.5;font-size:11px">Quelle: lan-interface · active (Zustandswechsel)</span>
          </div>
        </div>
        <div style="background:var(--bg2);border-radius:8px;padding:10px 12px;font-size:11.5px;">
          <div style="font-weight:700;margin-bottom:6px;display:flex;align-items:center;gap:6px;color:var(--text)">
            <i class="fa-solid fa-shield-halved" style="color:var(--accent)"></i> VPN-Instabilität
          </div>
          <div style="color:var(--text2);line-height:1.8">
            <span class="pa-conf-badge" style="background:rgba(211,47,47,.15);color:#d32f2f">Kritisch</span> Paketverlust &gt; <strong style="color:var(--text)">8 %</strong><br>
            <span class="pa-conf-badge" style="background:rgba(0,76,151,.1);color:var(--accent)">Warnung</span> Paketverlust &gt; <strong style="color:var(--text)">3 %</strong> oder Trend → 15 %<br>
            <span style="opacity:.5;font-size:11px">Quelle: vpn-connection · packetLossPercent, rttAvgUs</span>
          </div>
        </div>
        <div style="background:var(--bg2);border-radius:8px;padding:10px 12px;font-size:11.5px;">
          <div style="font-weight:700;margin-bottom:6px;display:flex;align-items:center;gap:6px;color:var(--text)">
            <i class="fa-solid fa-signal" style="color:var(--accent)"></i> LTE-Signal-Abbau
          </div>
          <div style="color:var(--text2);line-height:1.8">
            <span class="pa-conf-badge" style="background:rgba(0,76,151,.1);color:var(--accent)">Warnung</span> Signal &lt; <strong style="color:var(--text)">-70 dBm</strong> &amp; Slope &lt; -0.2 dBm/Tag<br>
            Trend-Grenzwert: <strong style="color:var(--text)">-95 dBm</strong> (Verbindungsabbruch)<br>
            <span style="opacity:.5;font-size:11px">Quelle: wan-interface · mobileModemSignalDecibelMw</span>
          </div>
        </div>
        <div style="background:var(--bg2);border-radius:8px;padding:10px 12px;font-size:11.5px;">
          <div style="font-weight:700;margin-bottom:6px;display:flex;align-items:center;gap:6px;color:var(--text)">
            <i class="fa-solid fa-wifi" style="color:var(--blue)"></i> WLAN-Sättigung
          </div>
          <div style="color:var(--text2);line-height:1.8">
            <span class="pa-conf-badge" style="background:rgba(211,47,47,.15);color:#d32f2f">Kritisch</span> &gt; <strong style="color:var(--text)">35 Clients</strong> oder Trend → ${LC_AP_MAX_CLIENTS} in &lt; 14 Tagen<br>
            <span class="pa-conf-badge" style="background:rgba(0,76,151,.1);color:var(--accent)">Warnung</span> &gt; <strong style="color:var(--text)">20 Clients</strong> oder Trend steigend (R² &gt; 0.35)<br>
            <span style="opacity:.5;font-size:11px">Quelle: wlan_info_json · stations (DAY1-Period)</span>
          </div>
        </div>
        <div style="background:var(--bg2);border-radius:8px;padding:10px 12px;font-size:11.5px;">
          <div style="font-weight:700;margin-bottom:6px;display:flex;align-items:center;gap:6px;color:var(--text)">
            <i class="fa-solid fa-brain" style="color:var(--accent)"></i> ML-Modelle &amp; Konfidenz
          </div>
          <div style="color:var(--text2);line-height:1.8">
            <span class="pa-model-badge">EMA</span> Glättung (α=0.3) · Rauschen reduzieren<br>
            <span class="pa-model-badge" style="background:rgba(217,119,6,.15);color:#d97706">LinReg</span> Trendstärke via R² (0–1)<br>
            <span class="pa-model-badge" style="background:rgba(211,47,47,.15);color:#d32f2f">IsoForest</span> Z-Score Anomalie-Frequenz<br>
            <span style="opacity:.5;font-size:11px">Konfidenz = Trend×40% + Frequenz×35% + Dringlichkeit×25%</span>
          </div>
        </div>
      </div>
    </details>

    <!-- 48h Predictions -->
    ${next48h.length ? `
    <div class="pa-section-title"><i class="fa-solid fa-clock" style="color:#d32f2f"></i> Vorhersagen nächste 48 Stunden</div>
    <div class="pa-alert-list">
      ${next48h.map(p => `
        <div class="pa-alert ${p.severity === 'critical' ? 'pa-alert-critical' : 'pa-alert-warning'}">
          <div class="pa-alert-icon ${p.severity === 'critical' ? 'pai-critical' : 'pai-warning'}">
            <i class="fa-solid fa-${p.severity === 'critical' ? 'skull' : 'bolt'}"></i>
          </div>
          <div class="pa-alert-body">
            <div class="pa-alert-title">${p.title}</div>
            <div class="pa-alert-desc">${p.desc}</div>
            <div class="pa-alert-meta">
              <span class="pa-model-badge">EMA+LinReg</span>
              <span class="pa-conf-badge" style="color:${p.conf>70?'#1a8a3e':p.conf>40?'#004c97':'var(--text3)'}">Konfidenz ${p.conf}%</span>
              <span style="color:var(--text3);font-size:11px">In ~${Math.round(p.daysTo * 24)} Stunden</span>
            </div>
            ${p.autofix?.length ? `<div class="pa-fixes">${p.autofix.map(f=>`<span class="pa-fix-chip"><i class="fa-solid fa-wrench"></i>${f}</span>`).join('')}</div>` : ''}
          </div>
        </div>`).join('')}
    </div>` : ''}

    <!-- Risk Table -->
    <div class="pa-section-title"><i class="fa-solid fa-table-cells" style="color:var(--accent)"></i> Geräte-Risikoübersicht</div>
    ${!deviceScores.filter(d => d.score > 0).length
      ? `<div style="padding:10px 14px;background:rgba(26,138,62,.07);border:1px solid rgba(26,138,62,.25);border-radius:8px;color:#1a8a3e;font-size:13px;display:flex;align-items:center;gap:8px;margin-bottom:10px"><i class="fa-solid fa-circle-check"></i> Keine Anomalien erkannt – alle Geräte im Normbereich.</div>`
      : ''}
    <table class="pa-risk-table">
      <thead><tr><th>Gerät</th><th>Standort</th><th>CPU</th><th>RAM</th><th>Temp</th><th>Risk-Score</th><th>Anomalien</th><th></th></tr></thead>
      <tbody>
      ${deviceScores.map(d => {
        const riskCol = d.score >= 60 ? '#d32f2f' : d.score >= 30 ? '#004c97' : '#1a8a3e';
        const riskLabel = d.score >= 60 ? 'Kritisch' : d.score >= 30 ? 'Warnung' : 'OK';
        const devInfo = d.dev || {};
        const devLabel = devInfo.status?.name || devInfo.label || devInfo.name || devInfo.id?.substring(0,8) || '–';
        const cpu = d.cv?.cpu; const mem = d.cv?.mem; const temp = d.cv?.temp;
        const cpuCol  = cpu  >= 70 ? '#d32f2f' : cpu  >= 50 ? '#004c97' : '#1a8a3e';
        const memCol  = mem  >= 75 ? '#d32f2f' : mem  >= 60 ? '#004c97' : '#1a8a3e';
        const tempCol = temp >= 65 ? '#d32f2f' : temp >= 50 ? '#004c97' : '#1a8a3e';
        return `<tr>
          <td style="font-weight:600;color:var(--text)">${escHtml(devLabel)}</td>
          <td style="color:var(--text2);font-size:12px">${escHtml(devInfo.siteName)||'–'}</td>
          <td style="font-size:12px;font-weight:700;color:${cpu  != null ? cpuCol  : 'var(--text3)'}">
            ${cpu  != null ? cpu  + ' %' : '–'}</td>
          <td style="font-size:12px;font-weight:700;color:${mem  != null ? memCol  : 'var(--text3)'}">
            ${mem  != null ? mem  + ' %' : '–'}</td>
          <td style="font-size:12px;font-weight:700;color:${temp != null ? tempCol : 'var(--text3)'}">
            ${temp != null ? temp + ' °C' : '–'}</td>
          <td>
            <div style="display:flex;align-items:center;gap:8px">
              <div style="flex:1;background:var(--border);border-radius:4px;height:6px;min-width:60px">
                <div style="width:${d.score}%;height:100%;background:${riskCol};border-radius:4px"></div>
              </div>
              <span style="color:${riskCol};font-weight:700;font-size:13px;min-width:24px">${d.score}</span>
              <span style="color:${riskCol};font-size:11px">${riskLabel}</span>
            </div>
          </td>
          <td>${d.preds.length ? d.preds.map(p => `<span style="font-size:11px;padding:2px 6px;border-radius:4px;margin-right:3px;background:${p.severity==='critical'?'rgba(211,47,47,.15)':'rgba(0,76,151,.1)'};color:${p.severity==='critical'?'#d32f2f':'#004c97'}">${p.type.replace(/_/g,' ')}</span>`).join('') : '<span style="color:var(--text3);font-size:12px">–</span>'}</td>
          <td><button onclick="paToggleDetail('${d.id}')" style="background:rgba(255,255,255,.06);border:1px solid var(--border);border-radius:6px;color:var(--text2);font-size:12px;padding:4px 10px;cursor:pointer" title="Messwerte & Details"><i class="fa-solid fa-chevron-down"></i></button></td>
        </tr>
        <tr id="pa-detail-${d.id}" style="display:none"><td colspan="8" style="padding:0">
          <div class="pa-device-detail">
            <!-- Current values row -->
            <div style="padding:10px 14px 8px;border-bottom:${d.preds.length?'1px solid var(--border)':'none'}">
              <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:7px"><i class="fa-solid fa-chart-simple"></i> Aktuelle Messwerte (30-Tage-Ø / letzter Wert)</div>
              <div style="display:flex;flex-wrap:wrap;gap:6px">${paRenderCurrentVals(d.cv)}</div>
            </div>
            <!-- Anomaly prediction cards -->
            ${d.preds.map(p => `
              <div class="pa-pred-card ${p.severity === 'critical' ? 'pa-pred-critical' : 'pa-pred-warning'}">
                <div class="pa-pred-header">
                  <span class="pa-pred-icon ${p.severity === 'critical' ? 'ppi-critical' : 'ppi-warning'}"><i class="fa-solid fa-${p.severity==='critical'?'triangle-exclamation':'circle-exclamation'}"></i></span>
                  <div>
                    <div class="pa-pred-title">${p.title}</div>
                    <div class="pa-pred-desc">${p.desc}</div>
                  </div>
                  <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;margin-left:auto;flex-shrink:0">
                    ${p.vals?.length ? paSparkSvg(p.vals, p.severity, p.threshold) : ''}
                    <span class="pa-conf-badge">Konfidenz ${p.conf}%</span>
                  </div>
                </div>
                ${p.autofix?.length ? `<div class="pa-fixes">${p.autofix.map(f=>`<span class="pa-fix-chip"><i class="fa-solid fa-wrench"></i>${f}</span>`).join('')}</div>` : ''}
              </div>`).join('')}
          </div>
        </td></tr>`;
      }).join('')}
      </tbody>
    </table>
  `;

  wrap.innerHTML = html;
}

export {
  PA_DAYS,
  paState,
  paEMA,
  paLinReg,
  paAnomalyScores,
  paDaysTo,
  paConf,
  paRiskScore,
  paParseTableRecord,
  paFetchDevice,
  paBinByDay,
  paFillNulls,
  paAnalyzeDevice,
  paSparkSvg,
  paRenderCurrentVals,
  paToggleDetail,
  paLoadAll,
  renderAnomalyPage,
};
