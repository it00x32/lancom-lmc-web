import S from '../lib/state.js';
import { escHtml, deviceName, isOnline } from '../lib/helpers.js';
import { toast } from '../lib/api.js';
import { snmpReqBody } from '../lib/snmp.js';

// ─── WIFI MESH ────────────────────────────────────────────────────────────────
const meshState = { scanning: false, results: [], lastScan: null };

function renderMeshPage() {
  const wrap = document.getElementById('mesh-wrap');
  if (!wrap) return;
  if (!meshState.lastScan) {
    wrap.innerHTML = `<div class="empty-state"><i class="fa-solid fa-wifi"></i><h3>Kein Scan</h3><p>Alle Online-Access-Points nach WDS-Verbindungen scannen.</p></div>`;
    return;
  }

  const total   = meshState.results.length;
  const withWds = meshState.results.filter(r => r.configured).length;
  const errors  = meshState.results.filter(r => r.error).length;
  const noWds   = meshState.results.filter(r => !r.error && !r.configured).length;

  let html = `<div style="display:flex;align-items:center;gap:24px;padding:0 4px 8px">
    <div class="mesh-summary">
      <div class="mesh-summary-stat"><div class="ms-num">${total}</div><div class="ms-lbl">APs gescannt</div></div>
      <div class="mesh-summary-stat"><div class="ms-num" style="color:var(--accent)">${withWds}</div><div class="ms-lbl">Mit WDS</div></div>
      ${noWds  ? `<div class="mesh-summary-stat"><div class="ms-num" style="color:var(--text3)">${noWds}</div><div class="ms-lbl">Ohne WDS</div></div>` : ''}
      ${errors ? `<div class="mesh-summary-stat"><div class="ms-num" style="color:var(--red)">${errors}</div><div class="ms-lbl">Fehler</div></div>` : ''}
    </div>
  </div>`;

  // Nur APs mit konfiguriertem WDS anzeigen
  const wdsAps = meshState.results.filter(r => r.configured);

  if (!wdsAps.length) {
    html += `<div class="empty-state" style="padding:40px"><i class="fa-solid fa-wifi" style="opacity:.3"></i><h3>Keine WDS-Verbindungen</h3><p>Kein Online-Access-Point hat eine WDS-Verbindung konfiguriert.</p></div>`;
    wrap.innerHTML = html;
    return;
  }

  for (const r of wdsAps) {
    const devName = r.dev.status?.name || r.dev.label || r.dev.name || r.dev.id?.substring(0,8) || '–';
    const site    = r.dev.siteName && r.dev.siteName !== devName ? r.dev.siteName : '';
    const ip      = r.ip || '–';

    // Config + Status zusammenführen
    const linkMap = {};
    (r.configLinks || []).forEach(cl => { linkMap[cl.linkName] = { ...cl }; });
    (r.statusEntries || []).forEach(se => {
      if (!linkMap[se.linkName]) linkMap[se.linkName] = {};
      Object.assign(linkMap[se.linkName], se);
    });

    html += `<div class="mesh-ap-card">
      <div class="mesh-ap-header">
        <div style="flex:1;min-width:0">
          <div class="mesh-ap-name">${escHtml(devName)}</div>
          ${site ? `<div style="font-size:11px;color:var(--text3)">${escHtml(site)}</div>` : ''}
        </div>
        <div class="mesh-ap-ip">${escHtml(ip)}</div>
        <span class="mesh-ap-badge wds-yes"><i class="fa-solid fa-wifi" style="font-size:10px"></i> WDS aktiv</span>
      </div>
      <table class="mesh-link-table">
        <thead><tr>
          <th>Link</th><th>Band</th><th>Status</th><th>Rx-Phy-Signal</th>
          <th>Peer MAC</th><th>Tx / Rx</th><th>WPA</th>
        </tr></thead><tbody>`;

    for (const [, l] of Object.entries(linkMap)) {
      const band  = l.radio === 1 ? '2.4 GHz' : l.radio === 2 ? '5 GHz' : '–';
      const conn  = !!l.connected;
      const sig   = l.signal != null ? l.signal : null;
      const sigColor = sig >= 200 ? 'var(--green)' : sig >= 100 ? 'var(--amber)' : 'var(--red)';
      const txRx = (l.txRate != null && l.rxRate != null) ? `${l.txRate} / ${l.rxRate} Mbps` : '–';
      const wpa  = l.wpaVersion === 3 ? 'WPA3' : l.wpaVersion === 2 ? 'WPA2' : l.wpaVersion === 1 ? 'WPA1' : l.wpaVersion === 0 ? 'Offen' : '–';
      html += `<tr>
        <td style="font-weight:700">${escHtml(l.linkName || '–')}</td>
        <td>${band}</td>
        <td><span class="mesh-dot ${conn ? 'mesh-dot-on' : 'mesh-dot-off'}"></span>${conn ? 'Verbunden' : 'Getrennt'}</td>
        <td style="color:${conn && sig != null ? sigColor : 'var(--text3)'};font-weight:600">
          ${conn && sig != null ? sig : '–'}</td>
        <td style="font-family:monospace;font-size:11px">${escHtml(l.mac || '–')}</td>
        <td>${conn ? txRx : '–'}</td>
        <td>${conn ? wpa : '–'}</td>
      </tr>`;
    }
    html += `</tbody></table></div>`;
  }
  wrap.innerHTML = html;
}

async function meshScanAll() {
  if (meshState.scanning) return;
  const aps = Object.values(S.devices || {}).filter(d => isOnline(d));
  if (!aps.length) { alert('Keine Online-Geräte gefunden. Zuerst Gerätedaten laden.'); return; }

  meshState.scanning = true;
  meshState.results  = [];

  const btn  = document.getElementById('mesh-scan-btn');
  const lbl  = document.getElementById('mesh-status-lbl');
  const wrap = document.getElementById('mesh-wrap');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Scanne…'; }

  for (let i = 0; i < aps.length; i++) {
    const dev     = aps[i];
    const devNm   = dev.status?.name || dev.label || dev.name || dev.id?.substring(0,8) || '?';
    const ip      = dev.status?.ip || dev.status?.ipAddress || dev.status?.lastIp;
    if (lbl)  lbl.textContent = `${i + 1} / ${aps.length} – ${devNm}`;
    if (wrap) wrap.innerHTML  = `<div style="padding:24px;color:var(--text2);display:flex;align-items:center;gap:12px">
      <i class="fa-solid fa-spinner fa-spin" style="color:var(--accent);font-size:18px"></i>
      <span>Scanne <b>${escHtml(devNm)}</b> (${i + 1} / ${aps.length})…</span>
    </div>`;

    if (!ip) { meshState.results.push({ dev, ip: null, error: 'Keine IP-Adresse' }); continue; }

    try {
      const resp = await fetch('/snmp', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(snmpReqBody(ip, 'wds-scan')),
      });
      const data = await resp.json();
      meshState.results.push(data.error ? { dev, ip, error: data.error } : { dev, ip, ...data });
    } catch (e) {
      meshState.results.push({ dev, ip, error: e.message });
    }
  }

  meshState.scanning = false;
  meshState.lastScan = new Date();
  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Neu scannen'; }
  if (lbl) lbl.textContent = `Letzter Scan: ${meshState.lastScan.toLocaleTimeString('de-DE')}`;
  renderMeshPage();
}

export {
  meshState, renderMeshPage, meshScanAll,
};
