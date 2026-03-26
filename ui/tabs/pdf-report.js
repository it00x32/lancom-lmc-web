import S from '../lib/state.js';
import { escHtml, deviceName, isOnline } from '../lib/helpers.js';

function renderReportPage() {
  const wrap = document.getElementById('rpt-wrap');
  if (!wrap) return;

  const devs = Object.values(S.devices);
  if (!devs.length) { wrap.innerHTML = '<div class="empty-state"><i class="fa-solid fa-file-pdf"></i><h3>Keine Daten</h3><p>Zuerst Geräte laden.</p></div>'; return; }

  const total = devs.length;
  const online = devs.filter(d => isOnline(d)).length;
  const byType = {};
  devs.forEach(d => { const t = d.status?.type || 'UNKNOWN'; byType[t] = (byType[t] || 0) + 1; });
  const releaseCount = devs.filter(d => { const r = (d.status?.fwReleaseType || '').toUpperCase(); return r === 'RELEASE' || r === 'RELEASE_UPDATE'; }).length;
  const debugCount = devs.filter(d => (d.status?.fwReleaseType || '').toUpperCase() === 'DEBUG').length;
  const fwVersions = new Set(devs.map(d => d.status?.fwLabel || '?'));

  let html = `<div class="rpt-preview">
    <div class="rpt-section">
      <div class="rpt-section-title"><i class="fa-solid fa-file-pdf"></i> Netzwerkreport</div>
      <p style="color:var(--text2);font-size:13px;margin-bottom:16px">
        Erstelle einen druckbaren Netzwerkreport mit allen wichtigen Informationen.
        Der Report wird in einem neuen Fenster geöffnet und kann dort als PDF gedruckt werden.
      </p>
      <button onclick="generateReport()" class="rpt-btn"><i class="fa-solid fa-print"></i> Report generieren &amp; drucken</button>
    </div>
    <div class="rpt-section">
      <div class="rpt-section-title"><i class="fa-solid fa-eye"></i> Vorschau</div>
      <div class="rpt-card-grid">
        <div class="rpt-prev-card"><div class="rpt-prev-val">${total}</div><div class="rpt-prev-lbl">Geräte</div></div>
        <div class="rpt-prev-card"><div class="rpt-prev-val" style="color:var(--green)">${online}</div><div class="rpt-prev-lbl">Online</div></div>
        <div class="rpt-prev-card"><div class="rpt-prev-val">${fwVersions.size}</div><div class="rpt-prev-lbl">FW-Versionen</div></div>
        <div class="rpt-prev-card"><div class="rpt-prev-val" style="color:var(--amber)">${Object.keys(byType).length}</div><div class="rpt-prev-lbl">Gerätetypen</div></div>
      </div>
    </div>
    <div class="rpt-section">
      <div class="rpt-section-title"><i class="fa-solid fa-list-check"></i> Inhalt des Reports</div>
      <div class="rpt-checklist">
        <div class="rpt-check"><i class="fa-solid fa-check" style="color:var(--green)"></i> Executive Summary</div>
        <div class="rpt-check"><i class="fa-solid fa-check" style="color:var(--green)"></i> Geräteliste mit Details (${total} Geräte)</div>
        <div class="rpt-check"><i class="fa-solid fa-check" style="color:var(--green)"></i> Firmware-Compliance-Matrix</div>
        <div class="rpt-check"><i class="fa-solid fa-check" style="color:var(--green)"></i> Gerätetyp-Verteilung</div>
        <div class="rpt-check"><i class="fa-solid fa-check" style="color:var(--green)"></i> Standort-Übersicht</div>
      </div>
    </div>
  </div>`;
  wrap.innerHTML = html;
}

function generateReport() {
  const devs = Object.values(S.devices);
  const total = devs.length;
  const online = devs.filter(d => isOnline(d)).length;
  const date = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const time = new Date().toLocaleTimeString('de-DE');

  const byType = {};
  devs.forEach(d => { const t = d.status?.type || 'UNKNOWN'; byType[t] = (byType[t] || 0) + 1; });
  const typeLabels = { ROUTER: 'Router', ACCESS_POINT: 'Access Points', SWITCH: 'Switches', FIREWALL: 'Firewalls' };

  const releaseTypes = {};
  devs.forEach(d => { const rt = d.status?.fwReleaseType || 'UNKNOWN'; releaseTypes[rt] = (releaseTypes[rt] || 0) + 1; });

  const sites = {};
  devs.forEach(d => { const s = d.siteName || 'Kein Standort'; if (!sites[s]) sites[s] = { total: 0, online: 0 }; sites[s].total++; if (isOnline(d)) sites[s].online++; });

  const esc = escHtml;
  let doc = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Netzwerkreport – ${esc(S.accountName)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',system-ui,sans-serif;color:#1a1a2e;font-size:11pt;line-height:1.5;padding:40px}
h1{font-size:22pt;margin-bottom:4px}
h2{font-size:14pt;margin:28px 0 12px;padding-bottom:6px;border-bottom:2px solid #004c97;color:#004c97}
h3{font-size:11pt;margin:16px 0 8px;color:#333}
.meta{color:#666;font-size:10pt;margin-bottom:24px}
table{width:100%;border-collapse:collapse;margin:12px 0;font-size:9.5pt}
th{background:#004c97;color:#fff;padding:6px 10px;text-align:left;font-size:8.5pt;text-transform:uppercase;letter-spacing:.3px}
td{padding:5px 10px;border-bottom:1px solid #e0e0e0}
tr:nth-child(even) td{background:#f8f9fa}
.stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:16px 0}
.stat-box{border:1px solid #e0e0e0;border-radius:8px;padding:14px;text-align:center}
.stat-val{font-size:28pt;font-weight:800;color:#004c97}
.stat-lbl{font-size:9pt;color:#666;text-transform:uppercase;letter-spacing:.5px;margin-top:4px}
.green{color:#16a34a} .red{color:#dc2626} .amber{color:#d97706}
.badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:8pt;font-weight:700}
.b-release{background:#dcfce7;color:#16a34a} .b-debug{background:#fee2e2;color:#dc2626}
.b-security{background:#fef3c7;color:#d97706} .b-update{background:#e0f2fe;color:#0284c7}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px}
.dot-on{background:#16a34a} .dot-off{background:#dc2626}
.footer{margin-top:40px;padding-top:16px;border-top:1px solid #e0e0e0;font-size:9pt;color:#999;text-align:center}
@media print{body{padding:20px}h2{break-before:auto}table{break-inside:auto}tr{break-inside:avoid}}
</style></head><body>`;

  // Cover
  doc += `<h1>Netzwerkreport</h1><div class="meta">${esc(S.accountName)} · ${date} ${time}</div>`;

  // Executive Summary
  doc += `<h2>Executive Summary</h2>
  <div class="stat-grid">
    <div class="stat-box"><div class="stat-val">${total}</div><div class="stat-lbl">Geräte</div></div>
    <div class="stat-box"><div class="stat-val green">${online}</div><div class="stat-lbl">Online</div></div>
    <div class="stat-box"><div class="stat-val red">${total - online}</div><div class="stat-lbl">Offline</div></div>
    <div class="stat-box"><div class="stat-val">${Math.round(online / total * 100)}%</div><div class="stat-lbl">Verfügbarkeit</div></div>
  </div>`;

  // Device types
  doc += `<h3>Gerätetypen</h3><table><tr><th>Typ</th><th>Anzahl</th></tr>`;
  for (const [t, c] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    doc += `<tr><td>${esc(typeLabels[t] || t)}</td><td>${c}</td></tr>`;
  }
  doc += `</table>`;

  // Firmware
  doc += `<h3>Firmware Release-Typen</h3><table><tr><th>Typ</th><th>Anzahl</th></tr>`;
  const rtClasses = { RELEASE: 'b-release', RELEASE_UPDATE: 'b-update', SECURITY_UPDATE: 'b-security', DEBUG: 'b-debug' };
  for (const [rt, count] of Object.entries(releaseTypes).sort((a, b) => b[1] - a[1])) {
    doc += `<tr><td><span class="badge ${rtClasses[rt] || ''}">${esc(rt)}</span></td><td>${count}</td></tr>`;
  }
  doc += `</table>`;

  // Device list
  doc += `<h2>Geräteliste</h2><table><tr><th>Name</th><th>Modell</th><th>Typ</th><th>Status</th><th>IP</th><th>MAC</th><th>Serial</th><th>Firmware</th><th>Standort</th></tr>`;
  const sorted = [...devs].sort((a, b) => deviceName(a).localeCompare(deviceName(b)));
  for (const d of sorted) {
    const on = isOnline(d);
    const s = d.status || {};
    doc += `<tr>
      <td><span class="dot ${on ? 'dot-on' : 'dot-off'}"></span>${esc(deviceName(d))}</td>
      <td>${esc((s.model || '').replace('LANCOM ', ''))}</td>
      <td>${esc(s.type || '–')}</td>
      <td style="color:${on ? '#16a34a' : '#dc2626'}">${on ? 'Online' : 'Offline'}</td>
      <td style="font-family:monospace;font-size:9pt">${esc(s.ip || '–')}</td>
      <td style="font-family:monospace;font-size:9pt">${esc(s.mac || '–')}</td>
      <td style="font-family:monospace;font-size:9pt">${esc(s.serial || '–')}</td>
      <td><span class="badge ${rtClasses[s.fwReleaseType] || ''}">${esc(s.fwLabel || '–')}</span></td>
      <td>${esc(d.siteName || '–')}</td>
    </tr>`;
  }
  doc += `</table>`;

  // Sites
  doc += `<h2>Standorte</h2><table><tr><th>Standort</th><th>Geräte</th><th>Online</th><th>Status</th></tr>`;
  for (const [name, s] of Object.entries(sites).sort((a, b) => b[1].total - a[1].total)) {
    const allOn = s.online === s.total;
    doc += `<tr><td>${esc(name)}</td><td>${s.total}</td><td>${s.online}</td><td style="color:${allOn ? '#16a34a' : s.online > 0 ? '#d97706' : '#dc2626'}">${allOn ? 'Alle online' : `${s.total - s.online} offline`}</td></tr>`;
  }
  doc += `</table>`;

  doc += `<div class="footer">Generiert von OnSite Web · ${date} ${time}</div></body></html>`;

  const win = window.open('', '_blank');
  win.document.write(doc);
  win.document.close();
  setTimeout(() => win.print(), 500);
}

function resetRptState() {}

export { renderReportPage, generateReport, resetRptState };
