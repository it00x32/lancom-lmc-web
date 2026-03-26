import S from '../lib/state.js';
import { escHtml, deviceName, isOnline } from '../lib/helpers.js';
import { api, toast } from '../lib/api.js';
import { snmpReqBody } from './settings.js';

// ─── ACTIONS ──────────────────────────────────────────────────────────────────
async function actionReboot(deviceId, name) {
  if(!confirm(`Gerät "${name}" wirklich neu starten?`)) return;
  const btn=findActionBtn(deviceId,'btn-reboot');
  setButtonLoading(btn,true);
  try {
    await api('devices',`/accounts/${S.accountId}/actions/reboot`,'POST',[deviceId]);
    toast('success','Neustart gesendet',`"${name}" wird neu gestartet.`);
  } catch(e) { toast('error','Fehler beim Neustart',e.message); }
  finally { setButtonLoading(btn,false); }
}
async function actionFirmwareUpdate(deviceId, name) {
  if(!confirm(`Firmware von "${name}" aktualisieren?`)) return;
  const btn=findActionBtn(deviceId,'btn-fw');
  setButtonLoading(btn,true);
  try {
    const fwData=await api('devices',`/accounts/${S.accountId}/firmware/update?deviceIds=${deviceId}`);
    const recommendedId=fwData?.[deviceId]?.recommendedId;
    if(!recommendedId) throw new Error('Kein Firmware-Update verfügbar.');
    await api('devices',`/accounts/${S.accountId}/firmware/update`,'POST',[{deviceId,firmwareId:recommendedId}]);
    toast('success','Firmware-Update gestartet',`Update für "${name}" wurde eingeleitet.`);
  } catch(e) { toast('error','Fehler beim FW-Update',e.message); }
  finally { setButtonLoading(btn,false); }
}
async function actionConfigRollout(deviceId, name) {
  if(!confirm(`Konfiguration auf "${name}" ausrollen?`)) return;
  const btn=findActionBtn(deviceId,'btn-cfg');
  setButtonLoading(btn,true);
  try {
    await api('config',`/configdevice/accounts/${S.accountId}/devices/${deviceId}/rollout?forceRollout=false&addDependentCentralSites=false`,'POST');
    toast('success','Konfig-Rollout gestartet',`Konfiguration wird auf "${name}" ausgerollt.`);
  } catch(e) { toast('error','Fehler beim Konfig-Rollout',e.message); }
  finally { setButtonLoading(btn,false); }
}
function findActionBtn(deviceId,cls) { return document.getElementById(`card-${deviceId}`)?.querySelector(`.${cls}`); }
function setButtonLoading(btn,loading) {
  if(!btn) return;
  if(loading){ btn._orig=btn.innerHTML; btn.innerHTML='<i class="fa-solid fa-circle-notch fa-spin"></i>'; btn.disabled=true; }
  else { if(btn._orig) btn.innerHTML=btn._orig; btn.disabled=false; }
}

// ─── WEBCONFIG ────────────────────────────────────────────────────────────────
async function openWebconfig(deviceId, name) {
  const dev = S.devices[deviceId];
  if(!dev||!isOnline(dev)) { toast('info','Gerät offline','WEBconfig nur für Online-Geräte verfügbar.'); return; }
  const btn = document.querySelector(`#card-${deviceId} .btn-web`);
  if(btn) { btn._orig=btn.innerHTML; btn.innerHTML='<i class="fa-solid fa-circle-notch fa-spin"></i>'; btn.disabled=true; }
  try {
    const result = await api('devicetunnel',`/accounts/${S.accountId}/webconfig`,'POST',{type:'WEBCONFIG',deviceIds:[deviceId]});
    const entry  = Array.isArray(result) ? (result.find(r=>r.deviceId===deviceId)||result[0]) : result;
    const token  = entry?.entryToken||entry?.token||entry?.accessToken;
    if(token) {
      window.open(`https://cloud.lancom.de/webconfig?token=${encodeURIComponent(token)}`,'_blank');
      toast('success','WEBconfig gestartet', name);
    } else if(entry?.url) {
      window.open(entry.url,'_blank');
      toast('success','WEBconfig gestartet', name);
    } else {
      toast('error','WEBconfig fehlgeschlagen','Kein Token in der Antwort: '+JSON.stringify(result).slice(0,80));
    }
  } catch(e) {
    toast('error','WEBconfig Fehler', e.message);
  } finally {
    if(btn) { if(btn._orig) btn.innerHTML=btn._orig; btn.disabled=false; }
  }
}

// ─── CONFIG PREVIEW ───────────────────────────────────────────────────────────
async function openCfgPreview(deviceId, name) {
  const modal   = document.getElementById('cfg-preview-modal');
  const content = document.getElementById('cfg-preview-content');
  const titleEl = document.getElementById('cfg-preview-title');
  if(!modal) return;
  if(titleEl)   titleEl.textContent = 'Konfig-Vorschau: '+name;
  if(content)   content.textContent = 'Lade Vorschau…';
  modal.style.display = 'flex';
  try {
    const result = await api('config',`/configbuilder/accounts/${S.accountId}/devices/${deviceId}/preview`,'PUT',{});
    if(typeof result==='string') {
      if(content) content.textContent = result||'(leer)';
    } else {
      if(content) content.textContent = JSON.stringify(result,null,2);
    }
  } catch(e) {
    if(content) content.textContent = 'Fehler: '+e.message;
  }
}

function closeCfgPreview() {
  document.getElementById('cfg-preview-modal').style.display = 'none';
}

// ─── SNMP CARD DEBUG ──────────────────────────────────────────────────────────
async function snmpCardTest(deviceId, host) {
  const area = document.getElementById(`snmp-debug-${deviceId}`);
  const btn  = document.getElementById(`snmp-btn-${deviceId}`);
  if (!area) return;

  // Toggle: wenn Ergebnis schon sichtbar → schließen
  if (area.style.display === 'block') {
    area.style.display = 'none';
    if (btn) btn.innerHTML = '<i class="fa-solid fa-network-wired"></i> SNMP';
    return;
  }

  area.style.display = 'block';
  area.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Teste SNMP…';
  if (btn) btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> SNMP';

  try {
    const r = await fetch('/snmp', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(snmpReqBody(host, 'test')),
    });
    const result = await r.json();
    if (result.ok) {
      area.innerHTML = `<span style="color:var(--green)"><i class="fa-solid fa-circle-check"></i> SNMP OK</span><br><span style="color:var(--text2)">${escHtml(result.sysDescr)}</span>`;
    } else {
      area.innerHTML = `<span style="color:var(--amber)"><i class="fa-solid fa-triangle-exclamation"></i> Keine Antwort</span><br><span style="color:var(--text3)">${escHtml(result.sysDescr||'Timeout oder SNMP deaktiviert')}</span>`;
    }
  } catch(e) {
    area.innerHTML = `<span style="color:var(--red)"><i class="fa-solid fa-circle-xmark"></i> Fehler: ${escHtml(e.message)}</span>`;
  }
  if (btn) btn.innerHTML = '<i class="fa-solid fa-network-wired"></i> SNMP';
}

export {
  actionReboot,
  actionFirmwareUpdate,
  actionConfigRollout,
  openWebconfig,
  openCfgPreview,
  closeCfgPreview,
  snmpCardTest,
};
