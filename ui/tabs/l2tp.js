import S from '../lib/state.js';
import { escHtml, deviceName, isOnline } from '../lib/helpers.js';
import { toast } from '../lib/api.js';
import { snmpReqBody } from '../lib/snmp.js';

// ─── L2TPv3 ───────────────────────────────────────────────────────────────────
const l2tpState = { scanning: false, results: [], lastScan: null };

function renderL2tpPage() {
  const wrap = document.getElementById('l2tp-wrap');
  if (!wrap) return;
  if (!l2tpState.lastScan) {
    wrap.innerHTML = `<div class="empty-state"><i class="fa-solid fa-arrow-right-arrow-left"></i><h3>Kein Scan</h3><p>Alle Online-Geräte nach L2TPv3-Endpunkten scannen.</p></div>`;
    return;
  }

  const total   = l2tpState.results.length;
  const withL2  = l2tpState.results.filter(r => r.configured).length;
  const errors  = l2tpState.results.filter(r => r.error).length;
  const noL2    = l2tpState.results.filter(r => !r.error && !r.configured).length;

  let html = `<div style="display:flex;align-items:center;gap:24px;padding:0 4px 8px">
    <div class="mesh-summary">
      <div class="mesh-summary-stat"><div class="ms-num">${total}</div><div class="ms-lbl">Geräte gescannt</div></div>
      <div class="mesh-summary-stat"><div class="ms-num" style="color:var(--accent)">${withL2}</div><div class="ms-lbl">Mit L2TPv3</div></div>
      ${noL2  ? `<div class="mesh-summary-stat"><div class="ms-num" style="color:var(--text3)">${noL2}</div><div class="ms-lbl">Ohne L2TPv3</div></div>` : ''}
      ${errors ? `<div class="mesh-summary-stat"><div class="ms-num" style="color:var(--red)">${errors}</div><div class="ms-lbl">Fehler</div></div>` : ''}
    </div>
  </div>`;

  const l2tpDevs = l2tpState.results.filter(r => r.configured);

  if (!l2tpDevs.length) {
    html += `<div class="empty-state" style="padding:40px"><i class="fa-solid fa-arrow-right-arrow-left" style="opacity:.3"></i><h3>Keine L2TPv3-Endpunkte</h3><p>Kein Online-Gerät hat einen L2TPv3-Endpunkt konfiguriert.</p></div>`;
    wrap.innerHTML = html;
    return;
  }

  for (const r of l2tpDevs) {
    const devName = r.dev.status?.name || r.dev.label || r.dev.name || r.dev.id?.substring(0,8) || '–';
    const site    = r.dev.siteName && r.dev.siteName !== devName ? r.dev.siteName : '';
    const ip      = r.ip || '–';

    // Config + Status zusammenführen, Schlüssel = Endpoint-Name
    const epMap = {};
    (r.configEndpoints || []).forEach(ep => { epMap[ep.name] = { ...ep }; });
    (r.statusEntries   || []).forEach(se => {
      const key = se.endpointName || se.remoteEnd;
      if (!epMap[key]) epMap[key] = {};
      Object.assign(epMap[key], se);
    });

    html += `<div class="mesh-ap-card">
      <div class="mesh-ap-header">
        <div style="flex:1;min-width:0">
          <div class="mesh-ap-name">${escHtml(devName)}</div>
          ${site ? `<div style="font-size:11px;color:var(--text3)">${escHtml(site)}</div>` : ''}
        </div>
        <div class="mesh-ap-ip">${escHtml(ip)}</div>
        <span class="mesh-ap-badge wds-yes"><i class="fa-solid fa-arrow-right-arrow-left" style="font-size:10px"></i> L2TPv3 aktiv</span>
      </div>
      <table class="mesh-link-table">
        <thead><tr>
          <th>Endpoint</th><th>Gegenstelle</th><th>Remote-IP</th><th>Port</th>
          <th>Status</th><th>Interface</th><th>Verbunden seit</th>
        </tr></thead><tbody>`;

    for (const [, ep] of Object.entries(epMap)) {
      const up      = ep.state === 'UP';
      const opBadge = ep.operating === 0 ? `<span style="color:var(--text3);font-size:10px">(inaktiv)</span>` : '';
      html += `<tr>
        <td style="font-weight:700">${escHtml(ep.name || '–')} ${opBadge}</td>
        <td>${escHtml(ep.remoteEnd || '–')}</td>
        <td style="font-family:monospace;font-size:11px">${escHtml(ep.remoteIp || '–')}</td>
        <td>${ep.port || '–'}</td>
        <td><span class="mesh-dot ${up ? 'mesh-dot-on' : 'mesh-dot-off'}"></span>${escHtml(ep.state || '–')}</td>
        <td style="font-family:monospace;font-size:11px">${escHtml(ep.iface || '–')}</td>
        <td style="font-size:11px;color:var(--text2)">${escHtml(ep.connStartTime || '–')}</td>
      </tr>`;
    }
    html += `</tbody></table></div>`;
  }
  wrap.innerHTML = html;
}

async function l2tpScanAll() {
  if (l2tpState.scanning) return;
  const devs = Object.values(S.devices || {}).filter(d => isOnline(d));
  if (!devs.length) { alert('Keine Online-Geräte gefunden. Zuerst Gerätedaten laden.'); return; }

  l2tpState.scanning = true;
  l2tpState.results  = [];

  const btn  = document.getElementById('l2tp-scan-btn');
  const lbl  = document.getElementById('l2tp-status-lbl');
  const wrap = document.getElementById('l2tp-wrap');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Scanne…'; }

  for (let i = 0; i < devs.length; i++) {
    const dev   = devs[i];
    const devNm = dev.status?.name || dev.label || dev.name || dev.id?.substring(0,8) || '?';
    const ip    = dev.status?.ip || dev.status?.ipAddress || dev.status?.lastIp;
    if (lbl)  lbl.textContent = `${i + 1} / ${devs.length} – ${devNm}`;
    if (wrap) wrap.innerHTML  = `<div style="padding:24px;color:var(--text2);display:flex;align-items:center;gap:12px">
      <i class="fa-solid fa-spinner fa-spin" style="color:var(--accent);font-size:18px"></i>
      <span>Scanne <b>${escHtml(devNm)}</b> (${i + 1} / ${devs.length})…</span>
    </div>`;

    if (!ip) { l2tpState.results.push({ dev, ip: null, error: 'Keine IP-Adresse' }); continue; }

    try {
      const resp = await fetch('/snmp', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(snmpReqBody(ip, 'l2tp-scan')),
      });
      const data = await resp.json();
      l2tpState.results.push(data.error ? { dev, ip, error: data.error } : { dev, ip, ...data });
    } catch (e) {
      l2tpState.results.push({ dev, ip, error: e.message });
    }
  }

  l2tpState.scanning = false;
  l2tpState.lastScan = new Date();
  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-rotate"></i> Neu scannen'; }
  if (lbl) lbl.textContent = `Letzter Scan: ${l2tpState.lastScan.toLocaleTimeString('de-DE')}`;
  renderL2tpPage();
}

export {
  l2tpState, renderL2tpPage, l2tpScanAll,
};
