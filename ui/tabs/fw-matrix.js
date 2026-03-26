import S from '../lib/state.js';
import { escHtml, deviceName, isOnline } from '../lib/helpers.js';

function renderFwMatrix() {
  const wrap = document.getElementById('fwm-wrap');
  if (!wrap) return;

  const devs = Object.values(S.devices);
  if (!devs.length) {
    wrap.innerHTML = '<div class="empty-state"><i class="fa-solid fa-microchip"></i><h3>Keine Daten</h3><p>Zuerst Geräte laden.</p></div>';
    return;
  }

  const byType = {};
  devs.forEach(d => {
    const type = (d.status?.type || 'UNKNOWN').toUpperCase();
    if (!byType[type]) byType[type] = [];
    byType[type].push(d);
  });

  const fwVersions = new Set(devs.map(d => d.status?.fwLabel || '?'));
  const releaseTypes = {};
  devs.forEach(d => { const rt = d.status?.fwReleaseType || 'UNKNOWN'; releaseTypes[rt] = (releaseTypes[rt] || 0) + 1; });
  const debugCount = devs.filter(d => (d.status?.fwReleaseType || '').toUpperCase() === 'DEBUG').length;
  const suCount = devs.filter(d => (d.status?.fwReleaseType || '').toUpperCase().includes('SECURITY')).length;

  const rtColors = { RELEASE: 'var(--green)', RELEASE_UPDATE: 'var(--teal)', SECURITY_UPDATE: 'var(--amber)', DEBUG: 'var(--red)', UNKNOWN: 'var(--text3)' };
  const rtLabels = { RELEASE: 'Release', RELEASE_UPDATE: 'Release Update', SECURITY_UPDATE: 'Security Update', DEBUG: 'Debug', UNKNOWN: 'Unbekannt' };
  const typeOrder = ['ROUTER', 'ACCESS_POINT', 'SWITCH', 'FIREWALL'];
  const typeLabels = { ROUTER: 'Router', ACCESS_POINT: 'Access Points', SWITCH: 'Switches', FIREWALL: 'Firewalls' };
  const typeIcons = { ROUTER: 'fa-globe', ACCESS_POINT: 'fa-wifi', SWITCH: 'fa-network-wired', FIREWALL: 'fa-shield-halved' };

  let html = `<div class="fwm-stats">
    <div class="fwm-stat"><div class="fwm-stat-icon" style="background:rgba(0,76,151,.15);color:var(--blue)"><i class="fa-solid fa-server"></i></div><div><div class="fwm-stat-val">${devs.length}</div><div class="fwm-stat-lbl">Geräte</div></div></div>
    <div class="fwm-stat"><div class="fwm-stat-icon" style="background:rgba(139,92,246,.15);color:var(--purple)"><i class="fa-solid fa-code-branch"></i></div><div><div class="fwm-stat-val">${fwVersions.size}</div><div class="fwm-stat-lbl">FW-Versionen</div></div></div>
    <div class="fwm-stat"><div class="fwm-stat-icon" style="background:rgba(240,85,104,.15);color:var(--red)"><i class="fa-solid fa-bug"></i></div><div><div class="fwm-stat-val">${debugCount}</div><div class="fwm-stat-lbl">Debug-FW</div></div></div>
    <div class="fwm-stat"><div class="fwm-stat-icon" style="background:rgba(251,191,36,.15);color:var(--amber)"><i class="fa-solid fa-shield-halved"></i></div><div><div class="fwm-stat-val">${suCount}</div><div class="fwm-stat-lbl">Security Update</div></div></div>
  </div>`;

  // Release type distribution bar
  const total = devs.length;
  html += `<div class="fwm-section"><div class="fwm-section-title"><i class="fa-solid fa-chart-pie"></i> Release-Typ Verteilung</div>`;
  html += `<div class="fwm-release-bar">`;
  for (const [rt, count] of Object.entries(releaseTypes).sort((a, b) => b[1] - a[1])) {
    const pct = count / total * 100;
    html += `<div style="width:${pct}%;background:${rtColors[rt] || 'var(--text3)'};min-width:${pct > 3 ? 0 : 2}px" title="${rtLabels[rt] || rt}: ${count}"></div>`;
  }
  html += `</div><div class="fwm-release-legend">`;
  for (const [rt, count] of Object.entries(releaseTypes).sort((a, b) => b[1] - a[1])) {
    html += `<span class="fwm-legend-item"><span class="fwm-legend-dot" style="background:${rtColors[rt] || 'var(--text3)'}"></span>${rtLabels[rt] || rt} (${count})</span>`;
  }
  html += `</div></div>`;

  // Matrix per device type
  const allTypes = [...typeOrder, ...Object.keys(byType).filter(t => !typeOrder.includes(t))];
  for (const type of allTypes) {
    const devices = byType[type];
    if (!devices) continue;

    const label = typeLabels[type] || type;
    const icon = typeIcons[type] || 'fa-server';
    const byFw = {};
    devices.forEach(d => { const fw = d.status?.fwLabel || 'Unbekannt'; if (!byFw[fw]) byFw[fw] = []; byFw[fw].push(d); });
    const sortedFw = Object.entries(byFw).sort((a, b) => {
      const da = a[1][0].status?.fwDate || '', db = b[1][0].status?.fwDate || '';
      return db.localeCompare(da);
    });

    html += `<div class="fwm-section"><div class="fwm-section-title"><i class="fa-solid ${icon}"></i> ${label} <span style="color:var(--text3);font-weight:400">(${devices.length})</span></div><div class="fwm-group">`;

    for (const [fw, fwDevs] of sortedFw) {
      const rt = fwDevs[0].status?.fwReleaseType || 'UNKNOWN';
      const rtColor = rtColors[rt] || 'var(--text3)';
      const rtLabel = rtLabels[rt] || rt;
      const fwDate = fwDevs[0].status?.fwDate || '–';

      html += `<div class="fwm-fw-row">
        <div class="fwm-fw-header">
          <span class="fwm-fw-badge" style="border-color:${rtColor};color:${rtColor}">${escHtml(rtLabel)}</span>
          <span class="fwm-fw-version">${escHtml(fw)}</span>
          <span class="fwm-fw-date">${fwDate}</span>
          <span class="fwm-fw-count">${fwDevs.length}×</span>
        </div>
        <div class="fwm-fw-devices">${fwDevs.map(d => {
          const on = isOnline(d);
          return `<span class="fwm-dev-chip"><span style="color:${on ? 'var(--green)' : 'var(--red)'}"><i class="fa-solid fa-circle" style="font-size:6px"></i></span> ${escHtml(deviceName(d))}</span>`;
        }).join('')}</div>
      </div>`;
    }
    html += `</div></div>`;
  }

  wrap.innerHTML = html;
}

function resetFwmState() {}

export { renderFwMatrix, resetFwmState };
