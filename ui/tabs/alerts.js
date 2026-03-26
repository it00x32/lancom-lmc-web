import S from '../lib/state.js';
import { escHtml, deviceName } from '../lib/helpers.js';
import { api, toast } from '../lib/api.js';

// ─── ALERTS ───────────────────────────────────────────────────────────────────
let alertsData = [];
async function loadAlerts() {
  S._loaded.add('alerts');
  const loadEl = document.getElementById('alerts-loading');
  const empty  = document.getElementById('alerts-empty');
  const tbody  = document.getElementById('alerts-tbody');
  if(loadEl) loadEl.style.display = 'flex';
  if(empty)  empty.style.display = 'none';
  if(tbody)  tbody.innerHTML = '';
  try {
    const data = await api('notification', `/accounts/${S.accountId}/alerts`);
    alertsData = Array.isArray(data) ? data : (data?.alerts || data?.items || data?.content || []);
    renderAlerts();
  } catch(e) {
    toast('error', 'Fehler beim Laden der Alerts', e.message);
    if(empty) empty.style.display = 'block';
  } finally {
    if(loadEl) loadEl.style.display = 'none';
  }
}
function renderAlerts() {
  const tbody   = document.getElementById('alerts-tbody');
  const empty   = document.getElementById('alerts-empty');
  const countEl = document.getElementById('alerts-count');
  const badgeEl = document.getElementById('badge-alerts');
  if(countEl) countEl.textContent = alertsData.length;
  if(badgeEl) badgeEl.textContent = alertsData.length || '–';

  const critN = alertsData.filter(a => (a.severity||a.level||'').toUpperCase() === 'CRITICAL').length;
  const warnN = alertsData.filter(a => (a.severity||a.level||'').toUpperCase() === 'WARNING').length;
  const miniEl = document.getElementById('alerts-mini-stats');
  if(miniEl) miniEl.innerHTML = `
    <div class="mini-stat"><div class="ms-icon" style="background:rgba(211,47,47,.15);color:var(--red)"><i class="fa-solid fa-circle-xmark"></i></div><div><div class="ms-val" style="color:var(--red)">${critN}</div><div class="ms-lbl">Kritisch</div></div></div>
    <div class="mini-stat"><div class="ms-icon" style="background:rgba(217,119,6,.15);color:var(--amber)"><i class="fa-solid fa-triangle-exclamation"></i></div><div><div class="ms-val" style="color:var(--amber)">${warnN}</div><div class="ms-lbl">Warnung</div></div></div>
    <div class="mini-stat"><div class="ms-icon" style="background:rgba(0,76,151,.15);color:var(--accent)"><i class="fa-solid fa-bell"></i></div><div><div class="ms-val" style="color:var(--accent)">${alertsData.length}</div><div class="ms-lbl">Gesamt</div></div></div>`;

  if(!alertsData.length) { if(tbody) tbody.innerHTML=''; if(empty) empty.style.display='block'; return; }
  if(empty) empty.style.display='none';
  if(!tbody) return;
  tbody.innerHTML = alertsData.map(a => {
    const rawSev = (a.severity||a.level||a.alertSeverity||'INFO').toUpperCase();
    const sevClass = rawSev==='CRITICAL'?'alert-sev-critical':rawSev==='WARNING'?'alert-sev-warning':'alert-sev-info';
    const icon = rawSev==='CRITICAL'?'fa-circle-xmark':rawSev==='WARNING'?'fa-triangle-exclamation':'fa-circle-info';
    const devId = a.deviceId||a.device?.id||'';
    const devName = a.deviceName||a.device?.name||(devId&&S.devices[devId]?S.devices[devId].status?.name||deviceName(S.devices[devId]):'–')||'–';
    const site = a.siteName||a.site?.name||(devId&&S.devices[devId]?S.devices[devId].siteName:'–')||'–';
    const msg  = a.message||a.description||a.summary||a.details||a.alertType||a.type||'–';
    const ts   = a.createdAt||a.timestamp||a.alertTimestamp||a.created||a.startTime||'';
    const tsF  = ts ? new Date(ts).toLocaleString('de-DE') : '–';
    const status = a.status||a.state||a.alertState||'';
    const rowCls = rawSev==='CRITICAL'?'alert-row-critical':rawSev==='WARNING'?'alert-row-warning':'';
    return `<tr class="${rowCls}">
      <td><span class="${sevClass}"><i class="fa-solid ${icon}"></i> ${escHtml(rawSev)}</span></td>
      <td class="device-ref">${escHtml(devName)}</td>
      <td class="muted">${escHtml(site)}</td>
      <td style="max-width:300px;white-space:normal">${escHtml(msg)}</td>
      <td class="muted mono" style="white-space:nowrap;font-size:11px">${tsF}</td>
      <td class="muted">${escHtml(status||'–')}</td>
    </tr>`;
  }).join('');
}
async function reloadAlerts() {
  alertsData = [];
  const icon = document.getElementById('alerts-refresh-icon');
  if(icon) icon.classList.add('fa-spin');
  await loadAlerts();
  if(icon) icon.classList.remove('fa-spin');
}

function resetAlertsState() { alertsData = []; }

export { alertsData, loadAlerts, renderAlerts, reloadAlerts, resetAlertsState };
