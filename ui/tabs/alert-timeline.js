import S from '../lib/state.js';
import { api } from '../lib/api.js';
import { escHtml, deviceName } from '../lib/helpers.js';

let atData = null;
let atLoading = false;
let atFilter = 'all';

async function loadAlertTimeline() {
  if (atLoading) return;
  atLoading = true;
  S._loaded.add('alert-timeline');

  const icon = document.getElementById('at-refresh-icon');
  if (icon) icon.classList.add('fa-spin');

  try {
    const result = await api('notification', `/accounts/${S.accountId}/alerts`);
    atData = result?.alerts || (Array.isArray(result) ? result : []);
  } catch (e) {
    console.warn('[AlertTimeline]', e);
    atData = [];
  }

  atLoading = false;
  if (icon) icon.classList.remove('fa-spin');
  renderAlertTimeline();
}

function setAtFilter(f, btn) {
  atFilter = f;
  btn?.closest('.filter-group')?.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn?.classList.add('active');
  renderAlertTimeline();
}

function extractAlertType(typeStr) {
  if (!typeStr) return 'Unbekannt';
  const parts = typeStr.split(':');
  return parts.length > 1 ? parts[parts.length - 1] : typeStr;
}

function renderAlertTimeline() {
  const wrap = document.getElementById('at-wrap');
  if (!wrap) return;

  if (!atData || !atData.length) {
    wrap.innerHTML = '<div class="empty-state"><i class="fa-solid fa-bell"></i><h3>Keine Alerts</h3><p>Keine Alerts in diesem Account gefunden.</p></div>';
    return;
  }

  let filtered = atData;
  if (atFilter === 'open') filtered = atData.filter(a => a.state === 'open');
  else if (atFilter === 'closed') filtered = atData.filter(a => a.state === 'closed');

  const openCount = atData.filter(a => a.state === 'open').length;
  const closedCount = atData.filter(a => a.state === 'closed').length;
  const byType = {};
  atData.forEach(a => { const t = extractAlertType(a.type); byType[t] = (byType[t] || 0) + 1; });

  let html = `<div class="at-stats">
    <div class="at-stat"><div class="at-stat-icon" style="background:rgba(0,76,151,.15);color:var(--blue)"><i class="fa-solid fa-bell"></i></div><div><div class="at-stat-val">${atData.length}</div><div class="at-stat-lbl">Gesamt</div></div></div>
    <div class="at-stat"><div class="at-stat-icon" style="background:rgba(240,85,104,.15);color:var(--red)"><i class="fa-solid fa-circle-exclamation"></i></div><div><div class="at-stat-val">${openCount}</div><div class="at-stat-lbl">Offen</div></div></div>
    <div class="at-stat"><div class="at-stat-icon" style="background:rgba(52,217,123,.15);color:var(--green)"><i class="fa-solid fa-circle-check"></i></div><div><div class="at-stat-val">${closedCount}</div><div class="at-stat-lbl">Geschlossen</div></div></div>
    <div class="at-stat"><div class="at-stat-icon" style="background:rgba(139,92,246,.15);color:var(--purple)"><i class="fa-solid fa-tags"></i></div><div><div class="at-stat-val">${Object.keys(byType).length}</div><div class="at-stat-lbl">Typen</div></div></div>
  </div>`;

  // Type distribution
  html += `<div class="at-section"><div class="at-section-title"><i class="fa-solid fa-chart-pie"></i> Alert-Typen</div><div class="at-type-list">`;
  for (const [t, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    const pct = Math.round(count / atData.length * 100);
    html += `<div class="at-type-row"><span class="at-type-name">${escHtml(t)}</span><div class="at-type-bar-wrap"><div class="at-type-bar" style="width:${pct}%"></div></div><span class="at-type-count">${count}</span></div>`;
  }
  html += `</div></div>`;

  // Timeline
  html += `<div class="at-section"><div class="at-section-title"><i class="fa-solid fa-timeline"></i> Timeline (${filtered.length})</div><div class="at-timeline">`;
  const sorted = [...filtered].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  for (const alert of sorted) {
    const type = extractAlertType(alert.type);
    const isOpen = alert.state === 'open';
    const created = alert.createdAt ? new Date(alert.createdAt).toLocaleString('de-DE') : '–';
    const updated = alert.stateUpdatedAt ? new Date(alert.stateUpdatedAt).toLocaleString('de-DE') : '';
    const devIds = alert.deviceIds || (alert.deviceId ? [alert.deviceId] : []);
    const devNames = devIds.map(id => deviceName(S.devices[id])).filter(n => n !== '–');

    html += `<div class="at-item${isOpen ? ' at-item-open' : ''}">
      <div class="at-item-dot" style="background:${isOpen ? 'var(--red)' : 'var(--green)'}"></div>
      <div class="at-item-content">
        <div class="at-item-head">
          <span class="at-item-type">${escHtml(type)}</span>
          <span class="at-item-state" style="color:${isOpen ? 'var(--red)' : 'var(--green)'}">${isOpen ? 'Offen' : 'Geschlossen'}</span>
        </div>
        ${devNames.length ? `<div class="at-item-devs">${devNames.map(n => `<span class="at-dev-pill">${escHtml(n)}</span>`).join('')}</div>` : ''}
        <div class="at-item-time"><i class="fa-regular fa-clock"></i> ${created}${updated && !isOpen ? ` · geschlossen ${updated}` : ''}</div>
      </div>
    </div>`;
  }
  html += `</div></div>`;

  wrap.innerHTML = html;
}

function resetAtState() { atData = null; atLoading = false; atFilter = 'all'; }

export { loadAlertTimeline, renderAlertTimeline, setAtFilter, resetAtState };
