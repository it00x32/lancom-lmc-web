import S from '../lib/state.js';
import { escHtml, deviceName, signalBar, bandBadge, fmtRate } from '../lib/helpers.js';
import { api, toast } from '../lib/api.js';

let wlanFilter = 'all';
let wlanBlacklist = [];

function setWlanFilter(f, btn) {
  wlanFilter = f;
  document.querySelectorAll('#tab-wlan .filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderWlan();
}

function renderWlan() {
  const q = document.getElementById('wlan-search').value.toLowerCase();
  let rows = S.wlanStations.filter(s => {
    const band = (s.band || '').toUpperCase();
    if (wlanFilter !== 'all' && !band.includes(wlanFilter.replace('GHZ', ''))) return false;
    if (q) {
      const apName = S.devices[s.deviceId]?.status?.name || s._deviceName || '';
      const f = [s.mac, s.ip, apName, s.interfaceName, s.ssid, s.name, s.vendor];
      if (!f.some(x => x && String(x).toLowerCase().includes(q))) return false;
    }
    return true;
  });
  document.getElementById('wlan-count').textContent = rows.length;

  // Mini stats
  const by24 = S.wlanStations.filter(s => (s.band || '').toUpperCase().includes('24')).length;
  const by5 = S.wlanStations.filter(s => (s.band || '').toUpperCase().includes('5') && !(s.band || '').toUpperCase().includes('24')).length;
  const by6 = S.wlanStations.filter(s => (s.band || '').toUpperCase().includes('6') && !(s.band || '').toUpperCase().includes('24')).length;
  document.getElementById('wlan-mini-stats').innerHTML = `
    <div class="mini-stat"><div class="ms-icon" style="background:rgba(217,119,6,.15);color:var(--teal)"><i class="fa-solid fa-wifi"></i></div><div><div class="ms-val sv-wlan">${S.wlanStations.length}</div><div class="ms-lbl">Gesamt</div></div></div>
    <div class="mini-stat"><div class="ms-icon" style="background:rgba(0,76,151,.15);color:var(--blue)"><i class="fa-solid fa-wifi"></i></div><div><div class="ms-val" style="color:var(--blue)">${by24}</div><div class="ms-lbl">2.4 GHz</div></div></div>
    <div class="mini-stat"><div class="ms-icon" style="background:rgba(0,76,151,.15);color:var(--purple)"><i class="fa-solid fa-wifi"></i></div><div><div class="ms-val" style="color:var(--purple)">${by5}</div><div class="ms-lbl">5 GHz</div></div></div>
    <div class="mini-stat"><div class="ms-icon" style="background:rgba(217,119,6,.15);color:var(--teal)"><i class="fa-solid fa-wifi"></i></div><div><div class="ms-val" style="color:var(--teal)">${by6}</div><div class="ms-lbl">6 GHz</div></div></div>`;

  const tbody = document.getElementById('wlan-tbody');
  const empty = document.getElementById('wlan-empty');
  if (!rows.length) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  tbody.innerHTML = rows.map(s => {
    const rssi = s.rssi || s.signalLevel || s.signal || 0;
    const apName = S.devices[s.deviceId]?.status?.name || s._deviceName || '–';
    const hostname = s.name || '–';
    const vendorHint = s.vendor && s.vendor !== s.mac ? `<span class="muted" style="font-size:11px;display:block">${escHtml(s.vendor)}</span>` : '';
    const mac = s.mac || '';
    const ssid = s.ssid || '–';
    const networkName = S.wlanNetworkMap[s._deviceId + ':' + s.ssid] || s.ssid || '–';
    const isBlocked = wlanBlacklist.some(e => e.mac === mac);
    const blockFn = isBlocked ? `unblockMac('${mac}')` : `blockWlanClient('${mac}')`;
    const blockBtn = mac ? `<button class="btn-block${isBlocked ? ' blocked' : ''}" onclick="${blockFn}">${isBlocked ? '<i class="fa-solid fa-lock-open"></i> Entsperren' : '<i class="fa-solid fa-ban"></i> Sperren'}</button>` : '';
    return `<tr>
      <td class="device-ref">${escHtml(apName)}</td>
      <td class="muted">${escHtml(s.interfaceName || '–')}</td>
      <td class="mono" style="font-size:12px">${escHtml(ssid)}</td>
      <td class="muted" style="font-size:12px">${escHtml(networkName)}</td>
      <td>${escHtml(hostname)}${vendorHint}</td>
      <td class="mono">${escHtml(mac || '–')}</td>
      <td class="mono">${escHtml(s.ip) || '–'}</td>
      <td>${bandBadge(s.band)}</td>
      <td class="muted">${s.channel || '–'}</td>
      <td style="display:flex;align-items:center;gap:6px">${rssi ? signalBar(rssi) : ''}<span class="muted" style="font-size:11px">${rssi ? rssi + 'dBm' : ''}</span></td>
      <td class="muted">${fmtRate(s.actualRxRate)}</td>
      <td class="muted">${fmtRate(s.actualTxRate)}</td>
      <td class="muted">${fmtRate(s.actualRate)}</td>
      <td>${blockBtn}</td>
    </tr>`;
  }).join('');
}

function saveBlacklist() {
  localStorage.setItem('lmc_blacklist_' + S.accountId, JSON.stringify(wlanBlacklist));
}

function loadBlacklist() {
  try {
    const raw = localStorage.getItem('lmc_blacklist_' + S.accountId);
    wlanBlacklist = raw ? JSON.parse(raw) : [];
  } catch { wlanBlacklist = []; }
  renderBlacklist();
}

function blockWlanClient(mac) {
  if (!mac || wlanBlacklist.some(e => e.mac === mac.toUpperCase() || e.mac === mac)) return;
  const s = S.wlanStations.find(x => x.mac === mac) || {};
  const apName = S.devices[s.deviceId]?.status?.name || s._deviceName || '';
  const hostname = s.name || '';
  const ssid = s.ssid || '';
  const networkName = S.wlanNetworkMap[s._deviceId + ':' + s.ssid] || s.ssid || '';
  wlanBlacklist.push({ mac: mac.toUpperCase(), hostname, apName, ssid, networkName, blocked: new Date().toISOString() });
  saveBlacklist();
  renderBlacklist();
  renderWlan();
  toast('warn', 'Gesperrt', `${mac} wurde zur Sperrliste hinzugefügt.`);
}

function unblockMac(mac) {
  const idx = wlanBlacklist.findIndex(e => e.mac === mac.toUpperCase() || e.mac === mac);
  if (idx < 0) return;
  wlanBlacklist.splice(idx, 1);
  saveBlacklist();
  renderBlacklist();
  renderWlan();
  toast('info', 'Entsperrt', `${mac} wurde von der Sperrliste entfernt.`);
}

function renderBlacklist() {
  const el = document.getElementById('blacklist-list');
  const countEl = document.getElementById('blacklist-count');
  const infoEl = document.getElementById('blacklist-addin-info');
  const nameEl = document.getElementById('blacklist-addin-name');
  if (!el) return;
  if (countEl) countEl.textContent = wlanBlacklist.length;

  // Show/hide addin info
  const savedAddin = S.accountId ? JSON.parse(localStorage.getItem('lmc_blacklist_addin_' + S.accountId) || 'null') : null;
  if (infoEl && nameEl) {
    if (savedAddin?.name) { infoEl.style.display = 'flex'; nameEl.textContent = 'Add-in: ' + savedAddin.name; }
    else { infoEl.style.display = 'none'; }
  }

  if (!wlanBlacklist.length) {
    el.innerHTML = `<div id="blacklist-empty" style="padding:20px;text-align:center;color:var(--text3);font-size:13px;"><i class="fa-solid fa-circle-check" style="display:block;font-size:20px;margin-bottom:8px;opacity:.3;color:var(--green)"></i>Keine MAC-Adressen gesperrt</div>`;
    return;
  }
  el.innerHTML = `<table class="blacklist-table">
    <thead><tr><th>MAC-Adresse</th><th>SSID</th><th>Netzwerk</th><th>Hostname</th><th>Gesperrt am</th><th></th></tr></thead>
    <tbody>${wlanBlacklist.map(e => {
    const dt = e.blocked ? new Date(e.blocked).toLocaleString('de-DE') : '–';
    return `<tr>
        <td class="mono">${escHtml(e.mac)}</td>
        <td class="mono" style="font-size:12px">${escHtml(e.ssid || '–')}</td>
        <td class="muted" style="font-size:12px">${escHtml(e.networkName || '–')}</td>
        <td>${escHtml(e.hostname || '–')}</td>
        <td class="muted" style="font-size:12px">${dt}</td>
        <td><button class="btn-unblock" onclick="unblockMac('${e.mac}')"><i class="fa-solid fa-trash-can"></i></button></td>
      </tr>`;
  }).join('')}</tbody>
  </table>`;
}

async function generateBlacklistAddin() {
  if (!wlanBlacklist.length) { toast('warn', 'Leer', 'Sperrliste ist leer – zuerst MACs sperren.'); return; }
  const btn = document.getElementById('btn-gen-addin');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Generiere…'; }
  try {
    const script = generateBlacklistScript(wlanBlacklist);
    let savedAddin = JSON.parse(localStorage.getItem('lmc_blacklist_addin_' + S.accountId) || 'null');
    const addinName = 'Dashboard-WLAN-MAC-Sperrliste';

    if (savedAddin?.id) {
      // Update existing add-in – falls manuell gelöscht, fällt Code auf Neu-Erstellung zurück
      try {
        await api('config', `/configapplication/accounts/${S.accountId}/applications/${savedAddin.id}/script`, 'POST', { content: script, lcosLx: true });
        toast('ok', 'Add-in aktualisiert', `"${addinName}" wurde aktualisiert.`);
        renderBlacklist();
        return;
      } catch (_) {
        // Add-in existiert nicht mehr → localStorage leeren und neu erstellen
        localStorage.removeItem('lmc_blacklist_addin_' + S.accountId);
        savedAddin = null;
      }
    }

    // Neues Add-in erstellen
    const newAddin = await api('config', `/configapplication/accounts/${S.accountId}/applications`, 'POST', {
      name: addinName,
      comment: 'Automatisch generiert vom LANCOM LMC Dashboard. Aktiviert LEPS und setzt WLAN MAC-Sperrliste.',
      type: 'SCRIPT',
      enabled: true
    });
    const id = newAddin?.id || newAddin?.applicationId;
    if (!id) throw new Error('Keine Add-in-ID erhalten');
    await api('config', `/configapplication/accounts/${S.accountId}/applications/${id}/script`, 'POST', { content: script, lcosLx: true });
    localStorage.setItem('lmc_blacklist_addin_' + S.accountId, JSON.stringify({ id, name: addinName }));
    toast('ok', 'Add-in erstellt', `"${addinName}" wurde als neues Add-in erstellt.`);
    renderBlacklist();
  } catch (err) {
    toast('error', 'Fehler', 'Add-in konnte nicht generiert werden: ' + (err.message || err));
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-code"></i> Add-in generieren'; }
  }
}

function generateBlacklistScript(entries) {
  // Gruppiere nach SSID — interner Name wird zur Laufzeit per context.network.ssids[ssid].lxTableIdentifier ermittelt
  const bySsid = {};
  entries.forEach(e => {
    const ssid = e.ssid || 'Default';
    if (!bySsid[ssid]) bySsid[ssid] = [];
    bySsid[ssid].push(e);
  });

  const varLines = [];
  const profileLines = [];
  const userLines = [];
  Object.entries(bySsid).forEach(([ssid, macs]) => {
    // Sicherer JS-Variablenname aus der SSID
    const varName = 'lxNet_' + ssid.replace(/[^a-zA-Z0-9_]/g, '_');
    const profileName = 'Sperrliste-' + ssid;
    // Interner LCOS LX Netzwerkname wird zur Laufzeit aus dem Context gelesen
    varLines.push(`  var ${varName} = context.network.ssids[${JSON.stringify(ssid)}].lxTableIdentifier;`);
    profileLines.push(`  addLepsProfiles(${JSON.stringify(profileName)}, ${varName}, "Disabled", "0");`);
    macs.forEach(e => {
      const label = e.hostname || e.mac;
      userLines.push(`  addLepsUUser(${JSON.stringify(label)}, ${JSON.stringify(profileName)}, "", "${e.mac.toUpperCase()}", "0");`);
    });
  });

  return `// LMC-Dashboard: MAC-Sperrliste (LCOS LX)
// Generiert: ${new Date().toLocaleString('de-DE')} | Eintraege: ${entries.length}
/**
* @param {Config} config
* @param {Context} context
* Do not edit this comment or parameter types. Required for code suggestions
*/
exports.main = function(config, context) {

  // LEPS auf Access Point aktivieren
  config.setScalarByOid("13.2.20.133.1", "1");

  var addLepsProfiles = function(Name, NetworkName, CheckMacAddress, Vlan) {
    var t = config.getTableByOid("13.2.20.133.2");
    var r = t.createNewRow();
    r.setByOid(1, Name);
    r.setByOid(2, NetworkName);
    r.setByOid(3, CheckMacAddress);
    r.setByOid(4, Vlan);
    t.addOrMerge(r);
  };

  var addLepsUUser = function(Name, Profile, Passwort, MacAddress, Vlan) {
    var t = config.getTableByOid("13.2.20.133.3");
    var r = t.createNewRow();
    r.setByOid(1, Name);
    r.setByOid(2, Profile);
    r.setByOid(3, Passwort);
    r.setByOid(7, MacAddress);
    r.setByOid(4, Vlan);
    t.addOrMerge(r);
  };

  // Internen LCOS LX Netzwerknamen pro SSID aus Context lesen
${varLines.join('\n')}

  // LEPS-Profile pro SSID
${profileLines.join('\n')}

  // Gesperrte MAC-Adressen
${userLines.join('\n')}

};`;
}

export { setWlanFilter, renderWlan, loadBlacklist, renderBlacklist, blockWlanClient, unblockMac, generateBlacklistAddin, generateBlacklistScript };
