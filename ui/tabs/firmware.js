import S from '../lib/state.js';
import { escHtml, deviceName, isOnline } from '../lib/helpers.js';
import { api, toast } from '../lib/api.js';

// ─── FIRMWARE OVERVIEW ────────────────────────────────────────────────────────
function renderFirmware() {
  const wrap  = document.getElementById('firmware-wrap');
  const badge = document.getElementById('badge-firmware');
  const cnt   = document.getElementById('firmware-count');
  if(!wrap) return;
  const devices = Object.values(S.devices);
  if(!devices.length) {
    wrap.innerHTML = '<div class="empty-state"><i class="fa-solid fa-microchip"></i><h3>Keine Geräte</h3><p>Zuerst Geräte laden.</p></div>';
    return;
  }
  // Group by firmware label
  const groups = {};
  devices.forEach(d => {
    const fw = d.status?.fwLabel||'(unbekannt)';
    if(!groups[fw]) groups[fw] = {fw, devices:[], obsolete:0, online:0};
    groups[fw].devices.push(d);
    if(d.firmwareState==='OBSOLETE') groups[fw].obsolete++;
    if(isOnline(d)) groups[fw].online++;
  });
  const sorted = Object.values(groups).sort((a,b)=>b.obsolete-a.obsolete||b.devices.length-a.devices.length);
  if(cnt) cnt.textContent = devices.length;
  if(badge) badge.textContent = sorted.length;
  let html = '';
  sorted.forEach(g => {
    const isObs = g.obsolete>0;
    const bStyle = isObs
      ? 'background:rgba(0,76,151,.15);color:var(--blue);border:1px solid rgba(0,76,151,.3)'
      : 'background:rgba(26,138,62,.15);color:var(--green);border:1px solid rgba(26,138,62,.3)';
    html += `<div class="fw-group">
      <div class="fw-group-header">
        <span class="fw-group-label">${escHtml(g.fw)}</span>
        <span style="padding:2px 10px;border-radius:5px;font-size:11px;font-weight:700;${bStyle}">${isObs?'Veraltet':'Aktuell'}</span>
        <span style="font-size:12px;color:var(--text2)">${g.devices.length} Gerät${g.devices.length>1?'e':''} &nbsp;·&nbsp; ${g.online} online</span>
        <div style="flex:1"></div>
        ${isObs?`<button onclick="fwGroupUpdate(${JSON.stringify(g.devices.map(d=>d.id))})" style="background:rgba(0,76,151,.1);border:1px solid rgba(0,76,151,.3);border-radius:7px;color:var(--blue);font-size:12px;font-weight:600;padding:6px 14px;cursor:pointer;white-space:nowrap"><i class="fa-solid fa-arrow-up"></i> Alle updaten</button>`:''}
      </div>
      <div style="padding:0;overflow:auto">
        <table class="data-table">
          <thead><tr><th>Gerät</th><th>Modell</th><th>Seriennummer</th><th>Standort</th><th>Status</th><th>FW-Status</th></tr></thead>
          <tbody>${g.devices.map(d=>`<tr>
            <td class="device-ref">${escHtml(deviceName(d))}</td>
            <td class="muted">${escHtml(d.status?.model||'–')}</td>
            <td class="mono">${escHtml(d.status?.serial||'–')}</td>
            <td class="muted">${escHtml(d.siteName||'–')}</td>
            <td>${isOnline(d)?'<span class="sdot sdot-green">Online</span>':'<span class="sdot sdot-red">Offline</span>'}</td>
            <td>${d.firmwareState==='OBSOLETE'?'<span class="badge badge-fw-old"><i class="fa-solid fa-arrow-up-from-bracket"></i> OBSOLETE</span>':'<span class="badge badge-fw-ok"><i class="fa-solid fa-check"></i> CURRENT</span>'}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>
    </div>`;
  });
  wrap.innerHTML = html;
}

async function fwGroupUpdate(deviceIds) {
  const obsolete = deviceIds.filter(id=>S.devices[id]?.firmwareState==='OBSOLETE');
  if(!obsolete.length) { toast('info','Nichts zu tun','Alle Geräte dieser Gruppe haben aktuelle Firmware.'); return; }
  if(!confirm(`Firmware für ${obsolete.length} Gerät(e) dieser Gruppe aktualisieren?`)) return;
  openActionModal('Firmware-Update', obsolete);
  let done=0, errs=0;
  for(const id of obsolete) {
    try {
      const fwData = await api('devices',`/accounts/${S.accountId}/firmware/update?deviceIds=${id}`);
      const recId  = fwData?.[id]?.recommendedId;
      if(!recId) throw new Error('Kein Update verfügbar');
      await api('devices',`/accounts/${S.accountId}/firmware/update`,'POST',[{deviceId:id,firmwareId:recId}]);
      updateActionDeviceStatus(id,'ok'); done++;
    } catch(e) { updateActionDeviceStatus(id,'error',e.message); errs++; }
  }
  finalizeActionModal(done, errs);
}

export { renderFirmware, fwGroupUpdate };
