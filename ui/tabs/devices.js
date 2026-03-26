import S from '../lib/state.js';
import { escHtml, deviceName, isOnline, fmtRelTime } from '../lib/helpers.js';
import { api, toast } from '../lib/api.js';

// ─── FILTER / SEARCH / DEVICE RENDER ──────────────────────────────────────────
function setFilter(f,btn) { S.devFilter=f; document.querySelectorAll('#status-filter-group .filter-btn').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); renderDevices(); }
function setSiteFilter(f,btn) { S.siteFilter=f; document.querySelectorAll('#site-filter-group .filter-btn').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); renderDevices(); window.renderSiteTiles?.(); }

function renderDevices() {
  const grid=document.getElementById('device-grid');
  const q=document.getElementById('search-input').value.toLowerCase();
  let visible=Object.values(S.devices).filter(d=>{
    if(S.devFilter==='online'&&!isOnline(d)) return false;
    if(S.devFilter==='offline'&&isOnline(d)) return false;
    if(S.devFilter==='alert'&&!d.alerting?.hasAlert) return false;
    if(S.siteFilter!=='all'&&(d.siteName||'')!==S.siteFilter) return false;
    if(q){
      const f=[d.label,d.name,d.siteName,d.status?.deviceLabel,d.status?.model,d.status?.serial,d.status?.mac,d.status?.ip,d.id];
      if(!f.some(x=>x&&x.toLowerCase().includes(q))) return false;
    }
    return true;
  });
  document.getElementById('device-count').textContent=visible.length;
  if(!visible.length){ grid.innerHTML=`<div style="text-align:center;padding:48px 20px;color:var(--text3);font-family:var(--mono)"><div style="font-size:28px;margin-bottom:10px;opacity:.3"><i class="fa-solid fa-satellite-dish"></i></div>Keine Geräte gefunden</div>`; return; }

  visible.sort((a,b)=>{
    const sA=(a.siteName||'').localeCompare(b.siteName||'');
    if(sA!==0) return sA;
    const aA=a.alerting?.hasAlert?0:1, bA=b.alerting?.hasAlert?0:1;
    if(aA!==bA) return aA-bA;
    const aO=isOnline(a)?0:1, bO=isOnline(b)?0:1;
    if(aO!==bO) return aO-bO;
    return deviceName(a).localeCompare(deviceName(b));
  });

  const wlanLoaded=Object.keys(S.wlanClients).length>0;
  const multiSite=S.siteFilter==='all'&&new Set(visible.map(d=>d.siteName||'')).size>1;
  let rows='', lastSite=null;
  for(const d of visible) {
    const site=d.siteName||'(kein Standort)';
    if(multiSite&&site!==lastSite) {
      const siteCount=visible.filter(x=>(x.siteName||'(kein Standort)')===site).length;
      const cols=wlanLoaded?11:10;
      rows+=`<tr><td colspan="${cols}" style="background:var(--card2);padding:8px 14px;font-family:var(--font);font-size:11px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;color:var(--text2)"><i class="fa-solid fa-location-dot" style="margin-right:5px;opacity:.5"></i>${escHtml(site)} <span style="color:var(--accent);font-family:var(--mono);font-weight:400;margin-left:6px">${siteCount}</span></td></tr>`;
      lastSite=site;
    }
    rows+=deviceRow(d,wlanLoaded);
  }
  grid.innerHTML=`<div class="table-section"><table class="data-table"><thead><tr>
    <th style="width:32px"></th>
    <th>Gerät</th>
    <th>Standort</th>
    <th>Modell</th>
    <th>MAC</th>
    <th>IP</th>
    <th>Firmware</th>
    <th>FW</th>
    <th>CFG</th>
    ${wlanLoaded?'<th>WLAN</th>':''}
    <th>Aktionen</th>
  </tr></thead><tbody>${rows}</tbody></table></div>`;
}

function deviceRow(d, wlanLoaded) {
  const id=d.id, online=isOnline(d), hasAlert=d.alerting?.hasAlert===true;
  const fwState=d.firmwareState||'', cfgCat=S.configStates[id]?.category||'';
  const wlan=S.wlanClients[id];
  const name=deviceName(d);
  const site=d.siteName||'';
  const mac=d.status?.mac||'–';
  const model=d.status?.model||'–', ip=d.status?.ip||'–';
  const fw=d.status?.fwLabel||'–';
  const fwOld=fwState==='OBSOLETE', cfgOld=['OUTDATED','ROLLOUT_PENDING'].includes(cfgCat);
  const offlineTs=!online?fmtRelTime(d.status?.lastHeartbeatDate):'';
  const isBulkSel=bulkSelected.has(id);

  const statusDot=online
    ?`<span class="sdot sdot-green" style="font-size:0"></span>`
    :`<span class="sdot sdot-red" style="font-size:0"></span>`;

  const fwBadge=fwOld?`<span class="badge badge-fw-old" style="font-size:9px"><i class="fa-solid fa-arrow-up"></i> ${escHtml(fwState)}</span>`
    :(fwState==='CURRENT'?`<span class="badge badge-fw-ok" style="font-size:9px"><i class="fa-solid fa-check"></i> OK</span>`
    :`<span style="color:var(--text3);font-size:11px">${escHtml(fwState)||'–'}</span>`);

  const cfgBadge=cfgOld?`<span class="badge badge-cfg-old" style="font-size:9px"><i class="fa-solid fa-gear"></i> ${escHtml(cfgCat)}</span>`
    :(cfgCat==='CURRENT'?`<span class="badge badge-cfg-ok" style="font-size:9px"><i class="fa-solid fa-check"></i> OK</span>`
    :`<span style="color:var(--text3);font-size:11px">${escHtml(cfgCat)||'–'}</span>`);

  const wlanCell=wlanLoaded?`<td style="font-family:var(--mono);font-size:12px${wlan>0?';color:var(--teal);font-weight:600':''}">${wlan!==undefined?wlan:'–'}</td>`:'';
  const alertIcon=hasAlert?` <i class="fa-solid fa-triangle-exclamation" style="color:var(--amber);font-size:10px;margin-left:4px" title="Alert"></i>`:'';

  return `<tr id="card-${id}" class="${!online?'dev-row-offline':''}" onclick="if(bulkMode){bulkToggleDevice('${id}',event)}" style="${!online?'opacity:.65':''}">
    <td style="text-align:center;width:32px">${bulkMode?`<input type="checkbox" ${isBulkSel?'checked':''} onclick="event.stopPropagation()" onchange="bulkToggleDevice('${id}',event)" style="width:15px;height:15px;cursor:pointer;accent-color:var(--accent)">`:statusDot}</td>
    <td><span style="font-weight:600">${escHtml(name)}</span>${alertIcon}${offlineTs?`<div style="font-size:10px;color:var(--text3);margin-top:1px"><i class="fa-solid fa-clock" style="margin-right:2px;opacity:.5"></i>${offlineTs}</div>`:''}</td>
    <td style="color:var(--text2);font-size:12px">${escHtml(site)||'–'}</td>
    <td style="font-size:12px">${escHtml(model)}</td>
    <td class="mono" style="font-size:11px">${escHtml(mac)}</td>
    <td class="mono" style="font-size:11.5px">${escHtml(ip)}</td>
    <td class="mono" style="font-size:10.5px">${escHtml(fw)}</td>
    <td>${fwBadge}</td>
    <td>${cfgBadge}</td>
    ${wlanCell}
    <td style="white-space:nowrap">
      <button class="action-btn btn-reboot btn-sm" onclick="event.stopPropagation();actionReboot('${id}','${escHtml(name)}')" title="Neustart" style="padding:3px 7px;font-size:10px"><i class="fa-solid fa-power-off"></i></button>
      <button class="action-btn btn-fw btn-sm" ${!fwOld?'disabled':''} onclick="event.stopPropagation();actionFirmwareUpdate('${id}','${escHtml(name)}')" title="FW Update" style="padding:3px 7px;font-size:10px"><i class="fa-solid fa-microchip"></i></button>
      <button class="action-btn btn-cfg btn-sm" ${!cfgOld?'disabled':''} onclick="event.stopPropagation();actionConfigRollout('${id}','${escHtml(name)}')" title="Rollout" style="padding:3px 7px;font-size:10px"><i class="fa-solid fa-rotate"></i></button>
      <button class="action-btn btn-snmp btn-sm" id="snmp-btn-${id}" ${!online||ip==='–'?'disabled':''} onclick="event.stopPropagation();snmpCardTest('${id}','${escHtml(ip)}')" title="SNMP" style="padding:3px 7px;font-size:10px"><i class="fa-solid fa-network-wired"></i></button>
      <button class="action-btn btn-fw btn-sm" ${!online?'disabled':''} onclick="event.stopPropagation();openWebconfig('${id}','${escHtml(name)}')" title="WEBconfig" style="padding:3px 7px;font-size:10px"><i class="fa-solid fa-display"></i></button>
      <button class="action-btn btn-cfg btn-sm" onclick="event.stopPropagation();openCfgPreview('${id}','${escHtml(name)}')" title="Konfig" style="padding:3px 7px;font-size:10px"><i class="fa-solid fa-file-lines"></i></button>
      <button class="action-btn btn-sm" style="padding:3px 7px;font-size:10px;background:transparent;border-color:rgba(0,76,151,.2);color:var(--text3)" onclick="event.stopPropagation();openLogModal('${id}','${escHtml(name)}')" title="Log"><i class="fa-solid fa-scroll"></i></button>
    </td>
  </tr>`;
}

// ─── BULK SELECTION ───────────────────────────────────────────────────────────
let bulkMode = false;
let bulkSelected = new Set();
function _syncBulkToWindow() { if(typeof window!=='undefined'){ window.bulkMode=bulkMode; window.bulkSelected=bulkSelected; } }

function toggleBulkMode() {
  bulkMode = !bulkMode;
  bulkSelected.clear();
  _syncBulkToWindow();
  const btn  = document.getElementById('bulk-mode-btn');
  const bar  = document.getElementById('bulk-bar');
  const grid = document.getElementById('device-grid');
  if(bulkMode) {
    if(btn)  { btn.style.background='rgba(0,76,151,.25)'; btn.style.borderColor='var(--accent)'; btn.style.color='var(--accent2)'; }
    if(grid) grid.classList.add('bulk-mode');
  } else {
    if(btn)  { btn.style.background=''; btn.style.borderColor=''; btn.style.color=''; }
    if(grid) grid.classList.remove('bulk-mode');
    if(bar)  bar.style.display='none';
  }
  _syncBulkToWindow();
  renderDevices();
}

function bulkToggleDevice(id, ev) {
  if(ev) ev.stopPropagation();
  if(!bulkMode) return;
  if(bulkSelected.has(id)) bulkSelected.delete(id);
  else bulkSelected.add(id);
  updateBulkBar();
  const card = document.getElementById(`card-${id}`);
  if(card) card.classList.toggle('bulk-selected', bulkSelected.has(id));
  const cb = card?.querySelector('input[type=checkbox]');
  if(cb) cb.checked = bulkSelected.has(id);
}

function updateBulkBar() {
  const bar = document.getElementById('bulk-bar');
  const cnt = document.getElementById('bulk-count');
  if(!bar) return;
  if(bulkSelected.size > 0) {
    bar.style.display = 'flex';
    if(cnt) cnt.textContent = `${bulkSelected.size} Gerät${bulkSelected.size>1?'e':''} ausgewählt`;
  } else {
    bar.style.display = 'none';
  }
}

function bulkSelectAll() {
  const q = document.getElementById('search-input').value.toLowerCase();
  Object.values(S.devices).forEach(d => {
    if(S.devFilter==='online'&&!isOnline(d)) return;
    if(S.devFilter==='offline'&&isOnline(d)) return;
    if(S.devFilter==='alert'&&!d.alerting?.hasAlert) return;
    if(S.siteFilter!=='all'&&(d.siteName||'')!==S.siteFilter) return;
    if(q){const f=[d.label,d.name,d.siteName,d.status?.deviceLabel,d.status?.model,d.status?.serial,d.status?.ip,d.id];if(!f.some(x=>x&&x.toLowerCase().includes(q)))return;}
    bulkSelected.add(d.id);
  });
  updateBulkBar();
  renderDevices();
}

function bulkClear() {
  bulkSelected.clear();
  updateBulkBar();
  renderDevices();
}

async function bulkActionReboot() {
  if(!bulkSelected.size) return;
  const ids = [...bulkSelected];
  const names = ids.map(id=>deviceName(S.devices[id])||id).join(', ');
  if(!confirm(`${ids.length} Gerät(e) neu starten?\n\n${names}`)) return;
  openActionModal('Neustart', ids);
  let done=0, errs=0;
  for(const id of ids) {
    try {
      await api('devices',`/accounts/${S.accountId}/actions/reboot`,'POST',[id]);
      updateActionDeviceStatus(id,'ok'); done++;
    } catch(e) { updateActionDeviceStatus(id,'error',e.message); errs++; }
  }
  finalizeActionModal(done, errs);
}

async function bulkActionFirmware() {
  if(!bulkSelected.size) return;
  const ids = [...bulkSelected].filter(id=>S.devices[id]?.firmwareState==='OBSOLETE');
  if(!ids.length) { toast('info','Keine Updates','Alle ausgewählten Geräte haben aktuelle Firmware.'); return; }
  if(!confirm(`Firmware für ${ids.length} Gerät(e) aktualisieren?`)) return;
  openActionModal('Firmware-Update', ids);
  let done=0, errs=0;
  for(const id of ids) {
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

async function bulkActionRollout() {
  if(!bulkSelected.size) return;
  const ids = [...bulkSelected];
  if(!confirm(`Konfiguration auf ${ids.length} Gerät(e) ausrollen?`)) return;
  openActionModal('Konfig-Rollout', ids);
  let done=0, errs=0;
  for(const id of ids) {
    try {
      await api('config',`/configdevice/accounts/${S.accountId}/devices/${id}/rollout?forceRollout=false&addDependentCentralSites=false`,'POST');
      updateActionDeviceStatus(id,'ok'); done++;
    } catch(e) { updateActionDeviceStatus(id,'error',e.message); errs++; }
  }
  finalizeActionModal(done, errs);
}

// ─── ACTION STATUS MODAL ──────────────────────────────────────────────────────
function findActionBtn(deviceId,cls) { return document.getElementById(`card-${deviceId}`)?.querySelector(`.${cls}`); }
function setButtonLoading(btn,loading) {
  if(!btn) return;
  if(loading){ btn._orig=btn.innerHTML; btn.innerHTML='<i class="fa-solid fa-circle-notch fa-spin"></i>'; btn.disabled=true; }
  else { if(btn._orig) btn.innerHTML=btn._orig; btn.disabled=false; }
}

function openActionModal(title, deviceIds) {
  const modal  = document.getElementById('action-modal');
  const titleEl= document.getElementById('action-modal-title');
  const list   = document.getElementById('action-device-list');
  if(!modal||!list) return;
  if(titleEl) titleEl.textContent = title + '…';
  list.innerHTML = deviceIds.map(id => {
    const name = S.devices[id] ? deviceName(S.devices[id]) : id;
    return `<div class="action-device-row" id="adr-${id}">
      <div class="action-device-status" id="ads-${id}"><i class="fa-solid fa-circle-notch fa-spin" style="color:var(--text3)"></i></div>
      <div style="font-size:13px;font-weight:600;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(name)}</div>
      <div id="ade-${id}" style="font-size:11px;color:var(--red);max-width:200px;text-align:right"></div>
    </div>`;
  }).join('');
  document.getElementById('action-modal-summary').textContent = '';
  document.getElementById('action-modal-close-btn').style.display = 'none';
  modal.style.display = 'flex';
}

function updateActionDeviceStatus(id, status, errMsg) {
  const statusEl = document.getElementById(`ads-${id}`);
  const errEl    = document.getElementById(`ade-${id}`);
  if(!statusEl) return;
  if(status==='ok') statusEl.innerHTML = '<i class="fa-solid fa-circle-check" style="color:var(--green)"></i>';
  else {
    statusEl.innerHTML = '<i class="fa-solid fa-circle-xmark" style="color:var(--red)"></i>';
    if(errEl&&errMsg) errEl.textContent = errMsg.slice(0,55);
  }
}

function finalizeActionModal(done, errs) {
  const sum     = document.getElementById('action-modal-summary');
  const closeBtn= document.getElementById('action-modal-close-btn');
  const titleEl = document.getElementById('action-modal-title');
  const icon    = document.querySelector('#action-modal .fa-gear');
  if(icon)    { icon.classList.remove('fa-spin'); }
  if(titleEl) titleEl.textContent = titleEl.textContent.replace('…','');
  if(sum)     sum.textContent = `${done} OK${errs?', '+errs+' Fehler':''}`;
  if(closeBtn)closeBtn.style.display = '';
  if(!errs)   toast('success','Aktion abgeschlossen',`${done} Gerät(e) erfolgreich`);
  else        toast('error','Teilweise fehlgeschlagen',`${done} OK · ${errs} Fehler`);
}

function closeActionModal() {
  document.getElementById('action-modal').style.display = 'none';
}

// ─── CSV EXPORT ───────────────────────────────────────────────────────────────
function exportDevicesCsv() {
  const devices = Object.values(S.devices);
  if(!devices.length) { toast('info','Keine Daten','Zuerst Geräte laden.'); return; }
  const headers = ['Name','Modell','Seriennummer','IP-Adresse','Standort','Status','Firmware','FW-Status','CFG-Status','WLAN-Clients','Lifecycle'];
  const rows = devices.map(d => {
    const wlan = S.wlanClients[d.id]!==undefined ? String(S.wlanClients[d.id]) : '–';
    return [
      deviceName(d), d.status?.model||'–', d.status?.serial||'–', d.status?.ip||'–',
      d.siteName||'–', isOnline(d)?'Online':'Offline', d.status?.fwLabel||'–',
      d.firmwareState||'–', S.configStates[d.id]?.category||'–', wlan,
      d.status?.lifecycle?.status||'–',
    ].map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',');
  });
  const csv = [headers.join(','),...rows].join('\n');
  const blob = new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8;'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `lancom-geraete-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('success','Export erfolgreich',`${devices.length} Geräte exportiert.`);
}

export {
  setFilter,
  setSiteFilter,
  renderDevices,
  deviceRow,
  exportDevicesCsv,
  bulkMode,
  bulkSelected,
  toggleBulkMode,
  bulkToggleDevice,
  bulkSelectAll,
  bulkClear,
  bulkActionReboot,
  bulkActionFirmware,
  bulkActionRollout,
  findActionBtn,
  setButtonLoading,
  openActionModal,
  updateActionDeviceStatus,
  finalizeActionModal,
  closeActionModal,
  updateBulkBar,
};

_syncBulkToWindow();
