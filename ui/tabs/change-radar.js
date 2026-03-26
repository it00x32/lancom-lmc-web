import S from '../lib/state.js';
import { api } from '../lib/api.js';
import { escHtml, deviceName, isOnline } from '../lib/helpers.js';

let crAlerts = null;
let crArchives = null;
let crLoading = false;

async function loadChangeRadar() {
  if (crLoading) return;
  crLoading = true;
  S._loaded.add('change-radar');

  const icon = document.getElementById('cr-refresh-icon');
  if (icon) icon.classList.add('fa-spin');

  try {
    const [alertResult, archiveResult] = await Promise.allSettled([
      api('notification', `/accounts/${S.accountId}/alerts`),
      api('logging', `/accounts/${S.accountId}/logs/archives`),
    ]);
    crAlerts = alertResult.status === 'fulfilled' ? (alertResult.value?.alerts || (Array.isArray(alertResult.value) ? alertResult.value : [])) : [];
    crArchives = archiveResult.status === 'fulfilled' ? (Array.isArray(archiveResult.value) ? archiveResult.value : []) : [];
  } catch { crAlerts = []; crArchives = []; }

  crLoading = false;
  if (icon) icon.classList.remove('fa-spin');
  renderChangeRadar();
}

function renderChangeRadar() {
  const wrap = document.getElementById('cr-wrap');
  if (!wrap) return;

  const devs = Object.values(S.devices);
  if (!devs.length) { wrap.innerHTML = '<div class="empty-state"><i class="fa-solid fa-radar"></i><h3>Keine Daten</h3><p>Zuerst Geräte laden.</p></div>'; return; }

  // Collect all events into a unified timeline
  const events = [];

  // Config changes from device timestamps
  devs.forEach(d => {
    const ts = d.status?.cfgTimeStamp;
    if (ts && ts !== '1970-01-21T12:43:53.48Z') {
      events.push({
        time: new Date(ts), type: 'config', icon: 'fa-gear', color: 'var(--purple)',
        title: 'Config geändert', detail: deviceName(d), deviceId: d.id
      });
    }
    const fwDate = d.status?.fwDate;
    if (fwDate) {
      events.push({
        time: new Date(fwDate), type: 'firmware', icon: 'fa-microchip', color: 'var(--blue)',
        title: 'Firmware-Build', detail: `${deviceName(d)} → ${d.status?.fwLabel || '?'}`, deviceId: d.id
      });
    }
  });

  // Alerts
  (crAlerts || []).forEach(a => {
    const t = a.type?.split(':').pop() || 'Alert';
    events.push({
      time: new Date(a.createdAt), type: 'alert', icon: 'fa-bell', color: a.state === 'open' ? 'var(--red)' : 'var(--amber)',
      title: t, detail: a.state === 'open' ? 'Offen' : 'Geschlossen',
      closed: a.stateUpdatedAt ? new Date(a.stateUpdatedAt) : null
    });
  });

  // Sort newest first
  events.sort((a, b) => b.time - a.time);

  // Stats
  const cfgEvents = events.filter(e => e.type === 'config');
  const fwEvents = events.filter(e => e.type === 'firmware');
  const alertEvents = events.filter(e => e.type === 'alert');

  // Recent changes (last 30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
  const recentCfg = cfgEvents.filter(e => e.time > thirtyDaysAgo).length;
  const recentAlerts = alertEvents.filter(e => e.time > thirtyDaysAgo).length;

  let html = `<div class="cr-stats">
    <div class="cr-stat"><div class="cr-stat-icon" style="background:rgba(139,92,246,.15);color:var(--purple)"><i class="fa-solid fa-gear"></i></div><div><div class="cr-stat-val">${cfgEvents.length}</div><div class="cr-stat-lbl">Config-Änderungen</div></div></div>
    <div class="cr-stat"><div class="cr-stat-icon" style="background:rgba(0,76,151,.15);color:var(--blue)"><i class="fa-solid fa-microchip"></i></div><div><div class="cr-stat-val">${fwEvents.length}</div><div class="cr-stat-lbl">FW-Builds</div></div></div>
    <div class="cr-stat"><div class="cr-stat-icon" style="background:rgba(251,191,36,.15);color:var(--amber)"><i class="fa-solid fa-bell"></i></div><div><div class="cr-stat-val">${alertEvents.length}</div><div class="cr-stat-lbl">Alerts</div></div></div>
    <div class="cr-stat"><div class="cr-stat-icon" style="background:rgba(52,217,123,.15);color:var(--green)"><i class="fa-solid fa-clock"></i></div><div><div class="cr-stat-val">${recentCfg + recentAlerts}</div><div class="cr-stat-lbl">Letzte 30 Tage</div></div></div>
  </div>`;

  // Log volume chart (monthly)
  if (crArchives && crArchives.length) {
    const chrono = [...crArchives].sort((a, b) => (a.year * 100 + a.month) - (b.year * 100 + b.month));
    const maxLogs = Math.max(...chrono.map(a => a.logCount || 0));
    const months = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

    // Count alerts per month
    const alertsByMonth = {};
    alertEvents.forEach(e => { const k = e.time.getFullYear() * 100 + (e.time.getMonth() + 1); alertsByMonth[k] = (alertsByMonth[k] || 0) + 1; });

    html += `<div class="cr-section"><div class="cr-section-title"><i class="fa-solid fa-chart-bar"></i> Aktivität pro Monat (Logs + Alerts)</div>`;
    html += `<div class="cr-month-grid">`;
    for (const a of chrono) {
      const k = a.year * 100 + a.month;
      const alertCount = alertsByMonth[k] || 0;
      const logPct = maxLogs > 0 ? Math.round((a.logCount || 0) / maxLogs * 100) : 0;
      const label = months[a.month - 1] + ' ' + (a.year % 100);
      const isHigh = logPct > 70;
      html += `<div class="cr-month-col">
        <div class="cr-month-bars">
          <div class="cr-month-bar" style="height:${logPct}%;background:${isHigh ? 'var(--amber)' : 'var(--accent)'}"></div>
        </div>
        ${alertCount ? `<div class="cr-month-alert">${alertCount} <i class="fa-solid fa-bell" style="font-size:8px"></i></div>` : ''}
        <div class="cr-month-val">${a.logCount >= 1000 ? (a.logCount / 1000).toFixed(1) + 'k' : a.logCount}</div>
        <div class="cr-month-lbl">${label}</div>
      </div>`;
    }
    html += `</div></div>`;
  }

  // Correlation insights
  html += `<div class="cr-section"><div class="cr-section-title"><i class="fa-solid fa-magnifying-glass-chart"></i> Korrelation</div><div class="cr-insights">`;
  // Config changes that happened close to alerts
  const cfgAlertCorr = [];
  for (const cfg of cfgEvents) {
    const nearbyAlerts = alertEvents.filter(a => Math.abs(a.time - cfg.time) < 86400000);
    if (nearbyAlerts.length) cfgAlertCorr.push({ cfg, alerts: nearbyAlerts.length });
  }
  if (cfgAlertCorr.length) {
    html += `<div class="cr-insight"><div class="cr-insight-icon" style="color:var(--amber)"><i class="fa-solid fa-link"></i></div><div><div class="cr-insight-title">${cfgAlertCorr.length} Config-Änderungen nahe Alerts</div><div class="cr-insight-desc">Diese Konfigurationsänderungen erfolgten innerhalb von 24h nach einem Alert.</div></div></div>`;
  }
  if (fwEvents.length > 0) {
    const fwDates = new Set(fwEvents.map(e => e.time.toISOString().split('T')[0]));
    html += `<div class="cr-insight"><div class="cr-insight-icon" style="color:var(--blue)"><i class="fa-solid fa-code-branch"></i></div><div><div class="cr-insight-title">${fwDates.size} verschiedene FW-Build-Daten</div><div class="cr-insight-desc">${fwEvents.length} Firmware-Builds über ${fwDates.size} Zeitpunkte verteilt.</div></div></div>`;
  }
  if (!cfgAlertCorr.length && !fwEvents.length) {
    html += `<div class="cr-insight"><div class="cr-insight-icon" style="color:var(--green)"><i class="fa-solid fa-check"></i></div><div><div class="cr-insight-title">Keine Auffälligkeiten</div><div class="cr-insight-desc">Keine Korrelation zwischen Config-Änderungen und Alerts gefunden.</div></div></div>`;
  }
  html += `</div></div>`;

  // Unified timeline
  html += `<div class="cr-section"><div class="cr-section-title"><i class="fa-solid fa-timeline"></i> Timeline (${Math.min(events.length, 50)} von ${events.length})</div><div class="cr-timeline">`;
  let lastDateStr = '';
  for (const evt of events.slice(0, 50)) {
    const dateStr = evt.time.toLocaleDateString('de-DE');
    if (dateStr !== lastDateStr) {
      html += `<div class="cr-date-sep">${dateStr}</div>`;
      lastDateStr = dateStr;
    }
    const timeStr = evt.time.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    html += `<div class="cr-event">
      <div class="cr-event-time">${timeStr}</div>
      <div class="cr-event-dot" style="background:${evt.color}"></div>
      <div class="cr-event-body">
        <span class="cr-event-title">${escHtml(evt.title)}</span>
        <span class="cr-event-detail">${escHtml(evt.detail)}</span>
      </div>
    </div>`;
  }
  html += `</div></div>`;

  wrap.innerHTML = html;
}

function resetCrState() { crAlerts = null; crArchives = null; crLoading = false; }

export { loadChangeRadar, renderChangeRadar, resetCrState };
