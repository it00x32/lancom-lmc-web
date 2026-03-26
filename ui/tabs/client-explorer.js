import S from '../lib/state.js';
import { escHtml, deviceName, isOnline, fmtRelTime } from '../lib/helpers.js';
import { toast } from '../lib/api.js';
import { snmpReqBody } from '../lib/snmp.js';

// ─── CE MAC TABLE MODAL ───────────────────────────────────────────────────────
let _ceMacRows = [];  // all rows, built once on open

function ceMacTableOpen() {
  // Collect all entries from scanned devices
  _ceMacRows = [];
  Object.values(ceData).forEach(cd => {
    if(cd.status !== 'done' || !cd.entries?.length) return;
    const devName = cd.device?.status?.name || deviceName(cd.device) || cd.deviceId;
    cd.entries.forEach(e => {
      _ceMacRows.push({
        mac:      e.mac,
        ip:       e.ip || '',
        devName,
        port:     e.portName || '',
        scannedAt: cd.scannedAt,
      });
    });
  });
  // Sort: device name, then port (natural)
  _ceMacRows.sort((a,b) => {
    const d = a.devName.localeCompare(b.devName);
    if(d !== 0) return d;
    return a.port.localeCompare(b.port, undefined, {numeric:true});
  });

  const modal = document.getElementById('ce-mac-modal');
  if(modal) modal.style.display = 'flex';
  const q = document.getElementById('ce-mac-modal-q');
  if(q) { q.value = ''; setTimeout(()=>q.focus(), 60); }
  ceMacTableRender('');
}

function ceMacTableClose() {
  const modal = document.getElementById('ce-mac-modal');
  if(modal) modal.style.display = 'none';
}

function ceMacTableFilter(q) {
  ceMacTableRender(q.trim().toLowerCase());
}

function ceMacTableRender(q) {
  const rows = q
    ? _ceMacRows.filter(r => r.mac.includes(q) || r.ip.includes(q) ||
        r.devName.toLowerCase().includes(q) || r.port.toLowerCase().includes(q))
    : _ceMacRows;

  const count  = document.getElementById('ce-mac-modal-count');
  const tbody  = document.getElementById('ce-mac-modal-tbody');
  const empty  = document.getElementById('ce-mac-modal-empty');
  if(count) count.textContent = rows.length + ' Einträge';
  if(!tbody || !empty) return;

  if(!rows.length) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  tbody.innerHTML = rows.map(r => {
    const ts = r.scannedAt ? fmtRelTime(r.scannedAt) : '–';
    return `<tr>
      <td class="mono" style="font-size:12px;user-select:all">${escHtml(r.mac)}</td>
      <td class="mono" style="font-size:12px">${r.ip ? escHtml(r.ip) : '<span class="muted">–</span>'}</td>
      <td class="device-ref">${escHtml(r.devName)}</td>
      <td><span style="background:var(--bg2);border:1px solid var(--border);border-radius:5px;padding:2px 8px;font-size:11px;font-weight:600">${escHtml(r.port)}</span></td>
      <td class="muted" style="text-align:right;font-size:11px">${ts}</td>
    </tr>`;
  }).join('');
}

// ─── CLIENT EXPLORER ──────────────────────────────────────────────────────────
let ceData         = {};   // { deviceId: {device, ip, status, entries, error, scannedAt, macCount} }
let ceScanActive   = false;
let ceScanAbort    = false;

// Normalize MAC to xx:xx:xx:xx:xx:xx lowercase
function ceNormalizeMac(raw) {
  const c = (raw||'').replace(/[^0-9a-fA-F]/g,'').toLowerCase();
  if(c.length !== 12) return null;
  return c.match(/.{2}/g).join(':');
}

function ceFormatHint(val) {
  const hint = document.getElementById('ce-mac-hint');
  if(!hint) return;
  const norm = ceNormalizeMac(val);
  const hexLen = val.replace(/[^0-9a-fA-F]/g,'').length;
  if(!val) {
    hint.innerHTML = 'Formate: <code>aa:bb:cc:dd:ee:ff</code> &nbsp;·&nbsp; <code>aa-bb-cc-dd-ee-ff</code> &nbsp;·&nbsp; <code>aabbccddeeff</code>';
  } else if(norm) {
    hint.innerHTML = `<span style="color:var(--green)"><i class="fa-solid fa-circle-check"></i> Erkannt: <code>${norm}</code></span>`;
  } else {
    hint.innerHTML = `<span style="color:var(--amber)">${hexLen}/12 Hex-Zeichen eingegeben</span>`;
  }
}

function ceClearResult() {
  const a = document.getElementById('ce-result-area');
  if(a) { a.style.display='none'; a.innerHTML=''; }
  const inp = document.getElementById('ce-mac-input');
  if(inp) { inp.value=''; ceFormatHint(''); }
}

function ceInitDevices() {
  // Register all devices without clearing existing scan results
  Object.values(S.devices).forEach(d => {
    if(!ceData[d.id]) {
      ceData[d.id] = { device:d, ip:d.status?.ip||'', status:'pending', entries:[], error:null, scannedAt:null, macCount:0 };
    } else {
      ceData[d.id].device = d;
      ceData[d.id].ip     = d.status?.ip||'';
    }
  });
  ceRenderDeviceTable();
  const badge = document.getElementById('badge-client-explorer');
  const total = Object.values(ceData).filter(d=>d.status==='done').reduce((s,d)=>s+(d.macCount||0),0);
  if(badge) badge.textContent = total || Object.keys(S.devices).length || '–';
}

async function startCeScan() {
  if(ceScanActive) return;
  ceScanActive = true;
  ceScanAbort  = false;

  // Only scan online devices with known IP
  const ids = Object.values(S.devices).filter(d => d.status?.ip && isOnline(d)).map(d => d.id);

  // Reset status for all to-be-scanned devices
  ids.forEach(id => {
    if(!ceData[id]) ceData[id] = { device:S.devices[id], ip:S.devices[id].status?.ip||'', status:'pending', entries:[], error:null, scannedAt:null, macCount:0 };
    else { ceData[id].status='pending'; }
  });

  const startBtn  = document.getElementById('ce-scan-start-btn');
  const cancelBtn = document.getElementById('ce-scan-cancel-btn');
  const progWrap  = document.getElementById('ce-progress-wrap');
  if(startBtn)  startBtn.disabled = true;
  if(cancelBtn) cancelBtn.style.display = '';
  if(progWrap)  progWrap.style.display = 'flex';

  ceRenderDeviceTable();

  let done = 0;
  const total = ids.length;

  for(const id of ids) {
    if(ceScanAbort) break;
    await ceScanOneDevice(id);
    done++;
    const pct = Math.round(done/total*100);
    const bar  = document.getElementById('ce-prog');
    const txt  = document.getElementById('ce-progress-text');
    if(bar) bar.style.width = pct+'%';
    if(txt) txt.textContent = `${done} / ${total}`;
  }

  ceScanActive = false;
  ceScanAbort  = false;
  if(startBtn)  startBtn.disabled = false;
  if(cancelBtn) cancelBtn.style.display = 'none';
  if(progWrap)  progWrap.style.display = 'none';

  const doneCnt   = Object.values(ceData).filter(d=>d.status==='done').length;
  const totalMacs = Object.values(ceData).reduce((s,d)=>s+(d.macCount||0),0);
  const summary   = document.getElementById('ce-scan-summary');
  if(summary) summary.textContent = `${doneCnt} Geräte · ${totalMacs} MACs`;
  const badge = document.getElementById('badge-client-explorer');
  if(badge) badge.textContent = totalMacs || '–';

  if(!ceScanAbort) toast('success','Scan abgeschlossen',`${doneCnt} Geräte · ${totalMacs} MACs gefunden`);
}

function cancelCeScan() {
  ceScanAbort = true;
  toast('info','Scan abgebrochen','Laufende Anfrage wird noch abgeschlossen.');
}

function ceDeviceIp(dev) {
  return dev?.status?.ip || dev?.status?.ipAddress || dev?.status?.lastIp || '';
}

function ceDeviceType(dev) {
  const t = (dev?.status?.type || '').toUpperCase();
  if(t === 'SWITCH')       return { label:'Switch',       color:'#004c97', icon:'fa-network-wired' };
  if(t === 'ACCESS_POINT') return { label:'Access Point', color:'#2d5fff', icon:'fa-wifi' };
  if(t === 'FIREWALL')     return { label:'Firewall',     color:'#d32f2f', icon:'fa-shield-halved' };
  if(t === 'ROUTER')       return { label:'Router',       color:'#004c97', icon:'fa-route' };
  // Fallback from LLDP / WLAN heuristics
  if(S.lldpNeighbors.some(p => p._deviceId === dev?.id))
    return { label:'Switch',       color:'#004c97', icon:'fa-network-wired' };
  if((S.wlanClients[dev?.id] || 0) > 0)
    return { label:'Access Point', color:'#2d5fff', icon:'fa-wifi' };
  return { label:'Router', color:'#004c97', icon:'fa-route' };
}

async function ceScanOneDevice(deviceId) {
  const d  = S.devices[deviceId];
  const ip = ceDeviceIp(d);
  if(!ip) { ceData[deviceId].status = 'no-ip'; ceRenderDeviceRow(deviceId); return; }

  ceData[deviceId].status = 'scanning';
  ceRenderDeviceRow(deviceId);

  try {
    const r = await fetch('/snmp', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(snmpReqBody(ip, 'mac-table'))
    });
    const result = await r.json();
    if(result.error) {
      ceData[deviceId].status = 'error';
      ceData[deviceId].error  = result.error;
      ceData[deviceId].entries = [];
    } else if(!result.hasMacTable) {
      ceData[deviceId].status = 'no-table';
      ceData[deviceId].entries = [];
    } else {
      ceData[deviceId].status   = 'done';
      ceData[deviceId].entries  = result.entries || [];
      ceData[deviceId].macCount = result.count   || 0;
      ceData[deviceId].source   = result.source  || 'bridge';
    }
  } catch(e) {
    ceData[deviceId].status = 'error';
    ceData[deviceId].error  = e.message;
  }
  ceData[deviceId].scannedAt = new Date();
  ceRenderDeviceRow(deviceId);
}

async function ceScanSingle(deviceId) {
  if(ceScanActive) { toast('info','Scan läuft','Warte bis der aktuelle Scan beendet ist.'); return; }
  const dev = S.devices[deviceId];
  if(!ceDeviceIp(dev)) { toast('warning','Keine IP','Für dieses Gerät ist keine IP-Adresse bekannt.'); return; }
  await ceScanOneDevice(deviceId);
}

// ── MAC Lookup ────────────────────────────────────────────────────────────────
function ceLookup() {
  const raw = (document.getElementById('ce-mac-input')?.value||'').trim();
  const mac = ceNormalizeMac(raw);
  const area = document.getElementById('ce-result-area');
  if(!area) return;
  area.style.display = 'block';

  if(!mac) {
    area.innerHTML = `<div style="background:rgba(211,47,47,.1);border:1px solid rgba(211,47,47,.3);border-radius:10px;padding:14px 18px;color:var(--red);font-size:13px"><i class="fa-solid fa-triangle-exclamation" style="margin-right:7px"></i>Ungültige MAC-Adresse. Erwartet: 6 Byte Hex, z.B. <code>aa:bb:cc:dd:ee:ff</code></div>`;
    return;
  }

  const scannedDevices = Object.values(ceData).filter(d=>d.status==='done');
  if(!scannedDevices.length) {
    area.innerHTML = `<div style="background:rgba(217,119,6,.1);border:1px solid rgba(217,119,6,.3);border-radius:10px;padding:14px 18px;color:var(--amber);font-size:13px"><i class="fa-solid fa-triangle-exclamation" style="margin-right:7px"></i>Noch kein erfolgreicher Scan vorhanden. Bitte zuerst <strong>"Online-Geräte scannen"</strong> klicken.</div>`;
    return;
  }

  // Find all devices that have this MAC in their table
  const hits = [];
  Object.entries(ceData).forEach(([deviceId, cd]) => {
    if(cd.status !== 'done') return;
    const entry = cd.entries.find(e => e.mac === mac);
    if(!entry) return;

    const portName = entry.portName;

    // Determine if this is a direct port or an uplink:
    // A port is INDIRECT if it has an LLDP neighbor → the MAC arrived through another managed device
    const lldpEntry = S.lldpNeighbors.find(p =>
      p._deviceId === deviceId && p.portName === portName && p.lldpNames.length > 0
    );

    // Find which managed device is behind this LLDP port
    let viaName = null, viaId = null;
    if(lldpEntry) {
      viaName = lldpEntry.lldpNames[0];
      // Try to find that device in our device list
      viaId = Object.values(S.devices).find(dev => {
        const n = (dev.status?.name||dev.label||dev.name||'').toLowerCase();
        return n === viaName.toLowerCase();
      })?.id || null;
    }

    const hitDev = S.devices[deviceId];
    hits.push({
      deviceId,
      devName:   hitDev?.status?.name || hitDev?.label || hitDev?.name || deviceName(hitDev),
      portName,
      ip:        entry.ip,
      isDirect:  !lldpEntry,
      viaName,
      viaId,
      lldpEntry,
      online:    isOnline(hitDev),
      scannedAt: cd.scannedAt,
    });
  });

  if(!hits.length) {
    area.innerHTML = `<div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:20px 24px;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <i class="fa-solid fa-circle-xmark" style="font-size:20px;color:var(--text3)"></i>
        <div>
          <div style="font-size:14px;font-weight:700">MAC nicht gefunden</div>
          <div style="font-size:12px;color:var(--text2);margin-top:2px">
            <code style="font-size:13px;background:var(--bg2);padding:2px 7px;border-radius:5px">${escHtml(mac)}</code>
            wurde in ${scannedDevices.length} Geräten nicht gefunden.
          </div>
        </div>
      </div>
      <div style="font-size:11px;color:var(--text3);line-height:1.6;border-top:1px solid var(--border);padding-top:10px;margin-top:4px">
        Mögliche Ursachen: Gerät gerade nicht verbunden · SNMP-Scan veraltet (neu scannen) ·
        Gerät hinter einem nicht gescannten oder nicht erreichbaren Switch
      </div>
    </div>`;
    return;
  }

  // Sort: direct first
  hits.sort((a,b) => (b.isDirect?1:0)-(a.isDirect?1:0));
  const directHits   = hits.filter(h => h.isDirect);
  const indirectHits = hits.filter(h => !h.isDirect);

  let html = `<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap">
    <i class="fa-solid fa-magnifying-glass" style="color:var(--accent);font-size:14px"></i>
    <span style="font-size:12px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.07em">Ergebnis für</span>
    <code style="font-size:14px;font-weight:700;background:var(--bg2);padding:3px 10px;border-radius:7px;border:1px solid var(--border)">${escHtml(mac)}</code>
    <span style="font-size:11px;color:var(--text3)">${hits.length} Treffer in ${scannedDevices.length} gescannten Geräten</span>
  </div>`;

  // ── Direct hits ──
  if(directHits.length) {
    html += `<div style="font-size:11px;font-weight:700;color:var(--green);text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px;display:flex;align-items:center;gap:6px">
      <i class="fa-solid fa-plug-circle-check"></i> Direkter Anschluss
    </div>`;
    directHits.forEach(h => {
      html += `<div class="ce-hit direct" style="margin-bottom:10px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap">
          <span style="width:10px;height:10px;border-radius:50%;background:${h.online?'var(--green)':'var(--red)'};flex-shrink:0"></span>
          <span class="ce-hit-device">${escHtml(h.devName)}</span>
          <span style="background:rgba(26,138,62,.15);color:var(--green);border:1px solid rgba(26,138,62,.3);font-size:10px;font-weight:700;padding:2px 9px;border-radius:10px">DIREKTER ANSCHLUSS</span>
        </div>
        <div style="display:flex;gap:24px;flex-wrap:wrap">
          <div class="ce-field">
            <div class="ce-field-lbl">Switch-Port</div>
            <div class="ce-hit-port">${escHtml(h.portName)}</div>
          </div>
          ${h.ip ? `<div class="ce-field"><div class="ce-field-lbl">IP-Adresse (ARP)</div><div class="ce-field-val" style="font-family:'Courier New',monospace">${escHtml(h.ip)}</div></div>` : ''}
          <div class="ce-field">
            <div class="ce-field-lbl">MAC</div>
            <div class="ce-field-val" style="font-family:'Courier New',monospace">${escHtml(mac)}</div>
          </div>
          <div class="ce-field">
            <div class="ce-field-lbl">Gerät-Status</div>
            <div class="ce-field-val"><span class="sdot ${h.online?'sdot-green':'sdot-red'}">${h.online?'Online':'Offline'}</span></div>
          </div>
          <div class="ce-field">
            <div class="ce-field-lbl">Scan-Zeit</div>
            <div class="ce-field-val" style="color:var(--text2);font-size:11px">${h.scannedAt?h.scannedAt.toLocaleTimeString('de-DE'):'–'}</div>
          </div>
        </div>
      </div>`;
    });
  }

  // ── Indirect hits (uplink path) ──
  if(indirectHits.length) {
    html += `<div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.07em;margin:${directHits.length?14:0}px 0 8px;display:flex;align-items:center;gap:6px">
      <i class="fa-solid fa-route"></i> Uplink-Pfad (MAC auch gesehen auf)
    </div>`;
    indirectHits.forEach(h => {
      const viaLabel = h.viaName
        ? `<i class="fa-solid fa-arrow-right" style="font-size:10px;color:var(--text3);margin:0 4px"></i><span style="color:var(--accent2)">${escHtml(h.viaName)}</span> (LLDP-Nachbar auf diesem Port)`
        : `<span style="color:var(--text3)">LLDP-Uplink</span>`;
      html += `<div class="ce-hit via" style="margin-bottom:8px">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span style="width:8px;height:8px;border-radius:50%;background:${h.online?'var(--green)':'var(--red)'};flex-shrink:0"></span>
          <span style="font-size:13px;font-weight:700">${escHtml(h.devName)}</span>
          <span style="background:var(--card2);border:1px solid var(--border);font-size:10px;font-weight:600;padding:2px 8px;border-radius:8px;color:var(--text3)">Port ${escHtml(h.portName)}</span>
          ${viaLabel}
        </div>
      </div>`;
    });
    if(directHits.length) {
      html += `<div style="font-size:11px;color:var(--text3);margin-top:4px;padding:8px 12px;background:var(--bg2);border-radius:8px"><i class="fa-solid fa-circle-info" style="margin-right:5px"></i>Diese Geräte sehen die MAC auf einem Trunk-/Uplink-Port – der Client ist <strong>nicht direkt</strong> dort angeschlossen.</div>`;
    }
  }

  area.innerHTML = html;
}

// ── Render helpers ────────────────────────────────────────────────────────────
function ceRenderDeviceTable() {
  const tbody = document.getElementById('ce-device-tbody');
  const empty = document.getElementById('ce-device-empty');
  if(!tbody) return;
  const devs = Object.values(S.devices);
  if(!devs.length) { tbody.innerHTML=''; if(empty) empty.style.display='block'; return; }
  if(empty) empty.style.display='none';
  tbody.innerHTML = devs
    .sort((a,b)=>deviceName(a).localeCompare(deviceName(b)))
    .map(d=>ceBuildDeviceRow(d.id)).join('');
}

function ceBuildDeviceRow(deviceId) {
  const dev = S.devices[deviceId];
  if(!dev) return '';
  const cd     = ceData[deviceId];
  const name   = dev.status?.name || dev.label || dev.name || deviceName(dev);
  const ip     = ceDeviceIp(dev) || '–';
  const online = isOnline(dev);
  const type   = ceDeviceType(dev);
  const scanningThis = cd?.status === 'scanning';

  let statusCell = `<span style="color:var(--text3);font-size:11px"><i class="fa-solid fa-clock"></i> Ausstehend</span>`;
  let macCell    = '<span style="color:var(--text3)">–</span>';
  let rowCls     = '';

  if(cd) {
    if(cd.status === 'scanning') {
      statusCell = `<span style="color:var(--accent);font-size:11px"><i class="fa-solid fa-circle-notch fa-spin"></i> Scanne…</span>`;
      rowCls = 'ce-row-scanning';
    } else if(cd.status === 'done') {
      const srcBadge = cd.source === 'wlan-clients'
        ? `<span style="font-size:10px;background:rgba(217,119,6,.15);border:1px solid rgba(217,119,6,.3);border-radius:3px;padding:1px 5px;color:var(--teal);margin-left:5px" title="LANCOM Enterprise WLAN-Clients MIB"><i class="fa-solid fa-wifi"></i> WLAN</span>`
        : '';
      statusCell = `<span style="color:var(--green);font-size:11px"><i class="fa-solid fa-circle-check"></i> ${cd.scannedAt?cd.scannedAt.toLocaleTimeString('de-DE'):''}${srcBadge}</span>`;
      macCell = `<span style="font-weight:700;color:var(--teal)">${cd.macCount}</span>`;
      rowCls = 'ce-row-done';
    } else if(cd.status === 'no-table') {
      statusCell = `<span style="color:var(--text2);font-size:11px"><i class="fa-solid fa-minus-circle"></i> Keine MAC-Tabelle</span>`;
    } else if(cd.status === 'no-ip') {
      statusCell = `<span style="color:var(--text3);font-size:11px"><i class="fa-solid fa-unlink"></i> Keine IP</span>`;
    } else if(cd.status === 'error') {
      const errMsg = (cd.error||'Fehler').substring(0,40);
      statusCell = `<span style="color:var(--red);font-size:11px" title="${escHtml(cd.error||'')}"><i class="fa-solid fa-circle-xmark"></i> ${escHtml(errMsg)}</span>`;
      rowCls = 'ce-row-error';
    }
  }

  const btnDisabled = scanningThis || ceScanActive;
  return `<tr id="ce-row-${deviceId}" class="${rowCls}">
    <td><span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${online?'var(--green)':'var(--red)'};margin-right:7px;vertical-align:middle;flex-shrink:0"></span><span class="device-ref">${escHtml(name)}</span></td>
    <td class="mono">${escHtml(ip)}</td>
    <td><span style="background:rgba(0,76,151,.12);border:1px solid var(--border);font-size:11px;font-weight:700;padding:2px 8px;border-radius:4px;color:${type.color}"><i class="fa-solid ${type.icon}" style="margin-right:4px;font-size:10px"></i>${type.label}</span></td>
    <td>${macCell}</td>
    <td>${statusCell}</td>
    <td><button onclick="ceScanSingle('${deviceId}')" ${btnDisabled?'disabled':''} style="background:rgba(0,76,151,.1);border:1px solid rgba(0,76,151,.2);border-radius:5px;color:var(--accent2);font-size:11px;font-weight:600;padding:4px 10px;cursor:${btnDisabled?'not-allowed':'pointer'};opacity:${btnDisabled?.4:1};white-space:nowrap"><i class="fa-solid fa-ethernet"></i> Scan</button></td>
  </tr>`;
}

function ceRenderDeviceRow(deviceId) {
  const el = document.getElementById(`ce-row-${deviceId}`);
  if(!el) return;
  const tmp = document.createElement('tbody');
  tmp.innerHTML = ceBuildDeviceRow(deviceId);
  const newRow = tmp.firstElementChild;
  if(newRow) el.replaceWith(newRow);
}

export {
  ceMacTableOpen, ceMacTableFilter, ceMacTableRender, ceMacTableClose,
  ceNormalizeMac, ceDeviceIp, ceDeviceType,
  startCeScan, cancelCeScan, ceScanSingle,
  ceLookup, ceFormatHint, ceClearResult,
  ceBuildDeviceRow, ceRenderDeviceRow, ceRenderDeviceTable,
  ceInitDevices, ceScanOneDevice, resetCeState,
};

function resetCeState() { ceData = {}; }
