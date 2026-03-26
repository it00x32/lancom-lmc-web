import S from '../lib/state.js';
import { api, toast } from '../lib/api.js';
import { snmpReqBody } from '../lib/snmp.js';

// ─── SNMP settings (persisted) ────────────────────────────────────────────────
let snmpVersion        = localStorage.getItem('snmpVersion')        || '2c';
let snmpReadCommunity  = localStorage.getItem('snmpReadCommunity')  || 'public';
let snmpWriteCommunity = localStorage.getItem('snmpWriteCommunity') || 'private';
let snmpV3Username     = localStorage.getItem('snmpV3Username')     || '';
let snmpV3SecLevel     = localStorage.getItem('snmpV3SecLevel')     || 'authPriv';
let snmpV3AuthProto    = localStorage.getItem('snmpV3AuthProto')    || 'SHA';
let snmpV3AuthPass     = localStorage.getItem('snmpV3AuthPass')     || '';
let snmpV3PrivProto    = localStorage.getItem('snmpV3PrivProto')    || 'AES';
let snmpV3PrivPass     = localStorage.getItem('snmpV3PrivPass')     || '';

function snmpToggleV3() {
  const ver = document.getElementById('set-snmp-version')?.value || '2c';
  const isV3 = ver === '3';
  document.getElementById('snmp-community-row')?.style && (document.getElementById('snmp-community-row').style.display = isV3 ? 'none' : '');
  document.getElementById('snmp-v3-fields')?.style && (document.getElementById('snmp-v3-fields').style.display = isV3 ? '' : 'none');
  snmpToggleV3AuthFields();
}
function snmpToggleV3AuthFields() {
  const lvl = document.getElementById('set-snmp-seclevel')?.value || 'authPriv';
  const showAuth = lvl === 'authNoPriv' || lvl === 'authPriv';
  const showPriv = lvl === 'authPriv';
  document.getElementById('snmp-v3-auth-row')?.style && (document.getElementById('snmp-v3-auth-row').style.display = showAuth ? '' : 'none');
  document.getElementById('snmp-v3-priv-row')?.style && (document.getElementById('snmp-v3-priv-row').style.display = showPriv ? '' : 'none');
}

function loadSettingsUI() {
  const ver = document.getElementById('set-snmp-version');
  const r   = document.getElementById('set-snmp-read');
  const w   = document.getElementById('set-snmp-write');
  if(ver) ver.value = snmpVersion;
  if(r) r.value = snmpReadCommunity;
  if(w) w.value = snmpWriteCommunity;
  const u  = document.getElementById('set-snmp-v3-user');
  const sl = document.getElementById('set-snmp-seclevel');
  const ap = document.getElementById('set-snmp-authproto');
  const ah = document.getElementById('set-snmp-authpass');
  const pp = document.getElementById('set-snmp-privproto');
  const ph = document.getElementById('set-snmp-privpass');
  if(u)  u.value  = snmpV3Username;
  if(sl) sl.value = snmpV3SecLevel;
  if(ap) ap.value = snmpV3AuthProto;
  if(ah) ah.value = snmpV3AuthPass;
  if(pp) pp.value = snmpV3PrivProto;
  if(ph) ph.value = snmpV3PrivPass;
  snmpToggleV3();
  // Management VLAN
  const vi = document.getElementById('set-mgmt-vlan');
  if(vi) vi.value = localStorage.getItem('lmc_mgmtvlan_id') || '1';
  // Status-Label aktualisieren
  const saved = S.accountId ? JSON.parse(localStorage.getItem('lmc_mgmtvlan_addins_' + S.accountId) || 'null') : null;
  const msg = document.getElementById('mgmt-vlan-msg');
  if(msg && saved) {
    const vlan = localStorage.getItem('lmc_mgmtvlan_id') || '1';
    msg.style.display = '';
    msg.style.color = 'var(--green)';
    msg.textContent = `\u2713 VLAN ${vlan} – Add-ins vorhanden`;
  }
}

function saveSnmpSettings() {
  snmpVersion        = document.getElementById('set-snmp-version')?.value        || '2c';
  snmpReadCommunity  = document.getElementById('set-snmp-read')?.value.trim()    || 'public';
  snmpWriteCommunity = document.getElementById('set-snmp-write')?.value.trim()   || 'private';
  snmpV3Username     = document.getElementById('set-snmp-v3-user')?.value.trim() || '';
  snmpV3SecLevel     = document.getElementById('set-snmp-seclevel')?.value       || 'authPriv';
  snmpV3AuthProto    = document.getElementById('set-snmp-authproto')?.value      || 'SHA';
  snmpV3AuthPass     = document.getElementById('set-snmp-authpass')?.value       || '';
  snmpV3PrivProto    = document.getElementById('set-snmp-privproto')?.value      || 'AES';
  snmpV3PrivPass     = document.getElementById('set-snmp-privpass')?.value       || '';
  localStorage.setItem('snmpVersion',        snmpVersion);
  localStorage.setItem('snmpReadCommunity',  snmpReadCommunity);
  localStorage.setItem('snmpWriteCommunity', snmpWriteCommunity);
  localStorage.setItem('snmpV3Username',     snmpV3Username);
  localStorage.setItem('snmpV3SecLevel',     snmpV3SecLevel);
  localStorage.setItem('snmpV3AuthProto',    snmpV3AuthProto);
  localStorage.setItem('snmpV3AuthPass',     snmpV3AuthPass);
  localStorage.setItem('snmpV3PrivProto',    snmpV3PrivProto);
  localStorage.setItem('snmpV3PrivPass',     snmpV3PrivPass);
  const msg = document.getElementById('snmp-save-msg');
  if(msg){ msg.style.display=''; setTimeout(()=>{ msg.style.display='none'; }, 2500); }
}

async function createSnmpAddins() {
  if(!S.accountId) { toast('error','Fehler','Kein Account angemeldet.'); return; }
  const body = snmpReqBody('0.0.0.0','test');
  const lines = [];
  lines.push(`# SNMP ${body.version === '3' ? 'v3' : body.version} Konfiguration`);
  if(body.version === '3') {
    lines.push(`set /Setup/SNMP/SNMPv3-USM-User/Admin Username=${body.v3Username||'admin'}`);
    lines.push(`set /Setup/SNMP/SNMPv3-USM-User/Admin AuthProtocol=${body.v3AuthProto||'SHA'}`);
    lines.push(`set /Setup/SNMP/SNMPv3-USM-User/Admin PrivProtocol=${body.v3PrivProto||'AES'}`);
  } else {
    lines.push(`set /Setup/SNMP/Read-Community ${body.community||'public'}`);
    lines.push(`set /Setup/SNMP/Write-Community ${localStorage.getItem('snmpWriteCommunity')||'private'}`);
  }
  const script = lines.join('\n');
  try {
    await api('config',`/accounts/${S.accountId}/config-applications`, 'POST', {
      name: `SNMP ${body.version === '3' ? 'v3' : body.version} Config`,
      description: 'Auto-generated SNMP configuration add-in',
      configScript: { script, scriptLanguage:'LCOS_SCRIPT' },
      applicableDeviceTypes: ['LCOS'],
    });
    toast('success','SNMP Add-in erstellt','Das Add-in wurde im LMC angelegt.');
    window.loadAddins?.();
  } catch(e) {
    toast('error','Fehler',e.message||'Add-in konnte nicht erstellt werden.');
  }
}

async function createMgmtVlanAddins() {
  if(!S.accountId) { toast('error','Fehler','Kein Account angemeldet.'); return; }
  const vlanId = document.getElementById('set-mgmt-vlan')?.value || '1';
  localStorage.setItem('lmc_mgmtvlan_id', vlanId);
  const script = [
    `# Management VLAN ${vlanId}`,
    `set /Setup/VLAN/VLAN-Modul active`,
    `set /Setup/VLAN/Porttabelle/LAN-1 VLAN-ID=${vlanId} Port-Member=tagged`,
  ].join('\n');
  try {
    await api('config',`/accounts/${S.accountId}/config-applications`, 'POST', {
      name: `Management VLAN ${vlanId}`,
      description: `Auto-generated Management VLAN ${vlanId} add-in`,
      configScript: { script, scriptLanguage:'LCOS_SCRIPT' },
      applicableDeviceTypes: ['LCOS'],
    });
    localStorage.setItem('lmc_mgmtvlan_addins_'+S.accountId, JSON.stringify({vlanId, ts:Date.now()}));
    const msg = document.getElementById('mgmt-vlan-msg');
    if(msg) { msg.style.display=''; msg.style.color='var(--green)'; msg.textContent=`\u2713 VLAN ${vlanId} – Add-in erstellt`; }
    toast('success','VLAN Add-in erstellt',`Management VLAN ${vlanId} Add-in angelegt.`);
    window.loadAddins?.();
  } catch(e) {
    toast('error','Fehler',e.message||'Add-in konnte nicht erstellt werden.');
  }
}

export {
  snmpVersion,
  snmpReadCommunity,
  snmpWriteCommunity,
  snmpV3Username,
  snmpV3SecLevel,
  snmpV3AuthProto,
  snmpV3AuthPass,
  snmpV3PrivProto,
  snmpV3PrivPass,
  snmpReqBody,
  saveSnmpSettings,
  snmpToggleV3,
  snmpToggleV3AuthFields,
  loadSettingsUI,
  createSnmpAddins,
  createMgmtVlanAddins,
};
