import S from '../lib/state.js';
import { escHtml, deviceName, isOnline, fmtRate, isWanUp } from '../lib/helpers.js';
import { api } from '../lib/api.js';

let trafficHistory = {};

function makeSpark(rates, color) {
  if (!rates.length) return '';
  const max = Math.max(...rates, 1), W = 100, H = 40;
  const pts = rates.map((v, i) => `${((i / Math.max(rates.length - 1, 1)) * W).toFixed(1)},${(H - (v / max) * (H - 6) - 3).toFixed(1)}`).join(' ');
  return `<polygon points="0,${H} ${pts} ${W},${H}" fill="${color}" opacity="0.13"/>
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>`;
}

function renderTraffic() {
  const grid = document.getElementById('traffic-grid');
  const empty = document.getElementById('traffic-empty');
  const cards = [];
  Object.entries(trafficHistory).forEach(([deviceId, ifaces]) => {
    const dev = S.devices[deviceId]; if (!dev) return;
    Object.entries(ifaces).forEach(([ifKey, d]) => {
      cards.push({ deviceId, devName: deviceName(dev), online: isOnline(dev), ifKey, ...d });
    });
  });
  document.getElementById('traffic-count').textContent = cards.length || 0;
  document.getElementById('badge-traffic').textContent = cards.length || '–';
  const since = document.getElementById('traffic-since');
  if (S.lastSync) since.textContent = 'Stand: ' + S.lastSync.toLocaleTimeString('de-DE');
  if (!cards.length) { grid.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  cards.sort((a, b) => (b.online - a.online) || ((b.curRx + b.curTx) - (a.curRx + a.curTx)));
  grid.innerHTML = cards.map(c => {
    const m = c.meta;
    const ifLbl = [m.interfaceName || m.connectionType || m.name || c.ifKey.split('__')[0]].filter(Boolean).join(' · ');
    const ip = m.ipV4 || m.ipV6 || m.ip || m.ipAddress || '';
    const npts = Math.max(c.rxRates.length, c.txRates.length);
    const maxRx = c.rxRates.length ? fmtRate(Math.max(...c.rxRates) / 1000) : '–';
    const maxTx = c.txRates.length ? fmtRate(Math.max(...c.txRates) / 1000) : '–';
    const dot = c.up ? 'var(--green)' : 'var(--red)';
    const spark = npts ? `
      <svg class="tc-spark" viewBox="0 0 100 40" preserveAspectRatio="none">
        ${makeSpark(c.rxRates.map(v => v / 1000), '#004c97')}
        ${makeSpark(c.txRates.map(v => v / 1000), '#1a8a3e')}
      </svg>
      <div class="tc-scale"><span>${npts}min</span><span style="color:var(--text2)">Max ↓${maxRx} ↑${maxTx}</span><span>jetzt</span></div>`
      : '<div style="font-size:11px;color:var(--text3);padding:6px 0;text-align:center">Keine Verlaufsdaten</div>';
    return `<div class="tc${c.online ? '' : ' tc-offline'}">
      <div style="display:flex;align-items:flex-start;margin-bottom:2px;">
        <div style="min-width:0;flex:1">
          <div class="tc-dev"><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${dot};margin-right:6px;vertical-align:middle;flex-shrink:0"></span>${escHtml(c.devName)}</div>
          <div class="tc-if">${escHtml(ifLbl)}${ip ? ' · <span class="mono" style="font-size:10px">' + escHtml(ip) + '</span>' : ''}</div>
        </div>
      </div>
      <div class="tc-rates">
        <div class="tc-rate" style="color:#004c97">↓ ${fmtRate(c.curRx / 1000)}<div class="tc-rate-lbl">Download</div></div>
        <div class="tc-rate" style="color:#1a8a3e">↑ ${fmtRate(c.curTx / 1000)}<div class="tc-rate-lbl">Upload</div></div>
      </div>
      ${spark}
    </div>`;
  }).join('');
}

async function loadTrafficData() {
  const ids = Object.keys(S.devices);
  if (!ids.length) return;
  S._loaded.add('traffic');
  const loading = document.getElementById('traffic-loading');
  const grid = document.getElementById('traffic-grid');
  const empty = document.getElementById('traffic-empty');
  loading.style.display = 'flex';
  grid.innerHTML = '';
  empty.style.display = 'none';
  trafficHistory = {};

  const from = new Date(Date.now() - 3600000).toISOString(); // last 1h
  for (let i = 0; i < ids.length; i += 5) {
    const batch = ids.slice(i, i + 5);
    await Promise.allSettled(batch.map(async deviceId => {
      try {
        const cols = ['deviceId', 'timeMs', 'connectionType', 'logicalState', 'ipV4', 'ipV6', 'rxCounterBytes', 'txCounterBytes'].map(c => `column=${c}`).join('&');
        const qs = `deviceId=${encodeURIComponent(deviceId)}&from=${encodeURIComponent(from)}&limit=200&sort=timeMs&order=asc&${cols}`;
        const data = await api('monitoring', `/api/${S.accountId}/tables/wan-interface?${qs}`);
        const rows = data?.data;
        if (!rows?.length) return;
        // Group rows by interface key (connectionType + ip = one interface)
        const byIf = {};
        rows.forEach(r => {
          const key = (r.connectionType || 'wan') + '__' + (r.ipV4 || r.ipV6 || '');
          if (!byIf[key]) byIf[key] = { pts: [], meta: null };
          byIf[key].pts.push({
            rx: r.rxCounterBytes ?? 0,
            tx: r.txCounterBytes ?? 0,
            up: isWanUp(r.logicalState || ''),
            timeMs: r.timeMs || 0,
          });
          byIf[key].meta = r; // last row = most recent
        });
        Object.entries(byIf).forEach(([key, d]) => {
          const rxR = [], txR = [];
          for (let j = 1; j < d.pts.length; j++) {
            const p = d.pts[j - 1], c = d.pts[j];
            const dt = ((c.timeMs - p.timeMs) / 1000) || 60;
            rxR.push(Math.max(0, c.rx - p.rx) * 8 / dt);
            txR.push(Math.max(0, c.tx - p.tx) * 8 / dt);
          }
          if (!trafficHistory[deviceId]) trafficHistory[deviceId] = {};
          trafficHistory[deviceId][key] = {
            rxRates: rxR, txRates: txR,
            curRx: rxR[rxR.length - 1] ?? 0,
            curTx: txR[txR.length - 1] ?? 0,
            meta: d.meta || {}, up: d.pts[d.pts.length - 1]?.up ?? false,
          };
        });
      } catch (e) { console.error('[traffic]', deviceId, e.message); }
    }));
    if (i + 5 < ids.length) await new Promise(r => setTimeout(r, 200));
  }
  loading.style.display = 'none';
  renderTraffic();
}

async function reloadTraffic() {
  trafficHistory = {};
  const icon = document.getElementById('traffic-refresh-icon');
  icon?.classList.add('fa-spin');
  await loadTrafficData();
  icon?.classList.remove('fa-spin');
}

function resetTrafficState() { trafficHistory = {}; }

export { trafficHistory, makeSpark, renderTraffic, loadTrafficData, reloadTraffic, resetTrafficState };
