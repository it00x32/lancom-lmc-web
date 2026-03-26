import S from '../lib/state.js';
import { escHtml } from '../lib/helpers.js';
import { api, toast } from '../lib/api.js';

// ─── ADD-INS ──────────────────────────────────────────────────────────────────
let addinsData      = [];   // full list of ConfigApplicationResponseDto
let addinsNetworks  = {};   // { applicationId: [{networkName,...}] }
let addinsScripts   = {};   // { applicationId: ConfigScript }
let addinsFilterQ   = '';

async function loadAddins() {
  const loadEl = document.getElementById('addins-loading');
  const empty  = document.getElementById('addins-empty');
  const wrap   = document.getElementById('addins-table-wrap');
  const icon   = document.getElementById('addins-refresh-icon');
  if(!S.accountId) return;
  S._loaded.add('addins');
  if(loadEl) loadEl.style.display='flex';
  if(wrap)   wrap.style.display='none';
  if(empty)  empty.style.display='none';
  if(icon)   icon.classList.add('fa-spin');
  try {
    const data = await api('config', `/configapplication/accounts/${S.accountId}/applications`);
    addinsData = Array.isArray(data) ? data : [];
    // Fetch network assignments for all add-ins (parallel, ignore errors)
    const netResults = await Promise.allSettled(addinsData.map(a =>
      api('config', `/configapplication/accounts/${S.accountId}/applications/${a.id}/networks`)
        .then(r => ({ id: a.id, nets: Array.isArray(r) ? r : [] }))
        .catch(() => ({ id: a.id, nets: [] }))
    ));
    addinsNetworks = {};
    netResults.forEach(r => { if(r.status==='fulfilled') addinsNetworks[r.value.id] = r.value.nets; });
    document.getElementById('badge-addins').textContent = addinsData.length || '–';
    document.getElementById('addins-count').textContent = addinsData.length;
    addinsRender();
  } catch(e) {
    toast('error', 'Add-ins Fehler', e.message);
    if(empty) { empty.style.display='flex'; empty.querySelector('div').textContent = 'Fehler: ' + e.message; }
  } finally {
    if(loadEl) loadEl.style.display='none';
    if(icon)   icon.classList.remove('fa-spin');
  }
}

function addinsFilter(q) {
  addinsFilterQ = q.trim().toLowerCase();
  addinsRender();
}

function addinsRender() {
  const tbody = document.getElementById('addins-tbody');
  const wrap  = document.getElementById('addins-table-wrap');
  const empty = document.getElementById('addins-empty');
  if(!tbody) return;
  const rows = addinsFilterQ
    ? addinsData.filter(a => a.name?.toLowerCase().includes(addinsFilterQ) || (a.comment||'').toLowerCase().includes(addinsFilterQ))
    : addinsData;
  if(!rows.length) {
    if(wrap)  wrap.style.display='none';
    if(empty) { empty.style.display='flex'; }
    return;
  }
  if(empty) empty.style.display='none';
  if(wrap)  wrap.style.display='block';
  tbody.innerHTML = rows.map(a => {
    const nets  = addinsNetworks[a.id] || [];
    const onetimeBadge = a.usedForOneTimeExecution
      ? `<span style="background:rgba(217,119,6,.12);border:1px solid rgba(217,119,6,.25);color:var(--amber);font-size:10px;font-weight:600;padding:1px 6px;border-radius:4px;margin-left:5px" title="Einmalige Ausführung"><i class="fa-solid fa-bolt"></i></span>`
      : '';
    const netStr = nets.length
      ? `<span style="font-weight:600;color:var(--teal)">${nets.length}</span> <span style="font-size:11px;color:var(--text3)">${nets.slice(0,2).map(n=>escHtml(n.networkName||'–')).join(', ')}${nets.length>2?', …':''}</span>`
      : '<span style="color:var(--text3);font-size:11px">–</span>';
    const chk = a.enabled ? 'checked' : '';
    return `<tr>
      <td style="text-align:center;vertical-align:middle">
        <label class="toggle-switch" style="margin:0" title="${a.enabled?'Aktiv – zum Deaktivieren klicken':'Inaktiv – zum Aktivieren klicken'}">
          <input type="checkbox" ${chk} onchange='addinToggleEnabled(${JSON.stringify(a.id)},this.checked)'>
          <span class="toggle-slider"></span>
        </label>
      </td>
      <td>
        <div style="font-weight:700;font-size:13px">${escHtml(a.name||'–')}${onetimeBadge}</div>
        <div style="margin-top:2px;font-size:11px;color:var(--text3)">${escHtml(a.type||'SCRIPT')}</div>
      </td>
      <td>${netStr}</td>
      <td style="font-size:12px;color:var(--text2);max-width:240px">${escHtml(a.comment||'')}</td>
      <td style="white-space:nowrap">
        <button onclick='addinEditOpen(${JSON.stringify(a.id)})'
          style="background:rgba(255,255,255,.06);border:1px solid var(--border);border-radius:6px;color:var(--text2);font-size:11px;font-weight:600;padding:4px 10px;cursor:pointer;margin-right:5px">
          <i class="fa-solid fa-pen" style="margin-right:3px"></i>Edit</button>
        <button onclick='addinScriptOpen(${JSON.stringify(a.id)},${JSON.stringify(a.name||'')})'
          style="background:rgba(0,76,151,.1);border:1px solid rgba(0,76,151,.25);border-radius:6px;color:var(--accent2);font-size:11px;font-weight:600;padding:4px 10px;cursor:pointer;white-space:nowrap;margin-right:5px">
          <i class="fa-solid fa-code" style="margin-right:3px"></i>Skript</button>
        <button onclick='addinDelete(${JSON.stringify(a.id)},${JSON.stringify(a.name||'')})'
          style="background:rgba(211,47,47,.08);border:1px solid rgba(211,47,47,.25);border-radius:6px;color:var(--red);font-size:11px;font-weight:600;padding:4px 10px;cursor:pointer;white-space:nowrap" title="Löschen">
          <i class="fa-solid fa-trash-can"></i></button>
      </td>
    </tr>`;
  }).join('');
}

async function addinDelete(id, name) {
  if (!confirm(`Add-in "${name}" wirklich löschen?`)) return;
  try {
    await api('config', `/configapplication/accounts/${S.accountId}/applications/${id}`, 'DELETE');
    addinsData = addinsData.filter(a => a.id !== id);
    document.getElementById('badge-addins').textContent = addinsData.length || '–';
    document.getElementById('addins-count').textContent = addinsData.length;
    // Auch aus localStorage entfernen falls es ein Dashboard-Add-in ist
    for (const lsKey of ['lmc_snmp_addins_', 'lmc_mgmtvlan_addins_']) {
      const stored = JSON.parse(localStorage.getItem(lsKey + S.accountId) || '{}');
      let changed = false;
      for (const k of Object.keys(stored)) { if (stored[k] === id) { delete stored[k]; changed = true; } }
      if (changed) localStorage.setItem(lsKey + S.accountId, JSON.stringify(stored));
    }
    addinsRender();
    toast('ok', 'Gelöscht', `Add-in "${name}" wurde entfernt.`);
  } catch(e) {
    toast('error', 'Fehler', e.message);
  }
}

async function addinToggleEnabled(id, enabled) {
  const app = addinsData.find(a => a.id === id);
  if(!app) return;
  const prev = app.enabled;
  app.enabled = enabled; // optimistic update
  try {
    await api('config', `/configapplication/accounts/${S.accountId}/applications/${id}`, 'PUT',
      { name: app.name, enabled, comment: app.comment || '', type: app.type || 'SCRIPT' });
    toast('success', enabled ? 'Add-in aktiviert' : 'Add-in deaktiviert', app.name);
  } catch(e) {
    app.enabled = prev; // rollback
    addinsRender();
    toast('error', 'Fehler', e.message);
  }
}

const OS_LABELS = { lcos:'LCOS', lcosLx:'LCOS-LX', swos:'GS-2xxx (SwOS)', lcosSxSdk4:'GS-3xxx (SDK4)', lcosSxXs:'XS-5xxx', lcosFx:'LCOS-FX' };

async function addinScriptOpen(applicationId, name) {
  const modal    = document.getElementById('addin-script-modal');
  const title    = document.getElementById('addin-script-title');
  const content  = document.getElementById('addin-script-content');
  const osTabs   = document.getElementById('addin-script-os-tabs');
  const infoBar  = document.getElementById('addin-script-info');
  if(!modal) return;
  title.textContent = name;
  content.textContent = '⏳ Lade Skript…';
  osTabs.innerHTML = '';
  infoBar.innerHTML = '';
  modal.style.display = 'flex';
  try {
    let script = addinsScripts[applicationId];
    if(!script) {
      script = await api('config', `/configapplication/accounts/${S.accountId}/applications/${applicationId}/script`);
      addinsScripts[applicationId] = script;
    }
    // Build OS tab buttons for OS types that are true
    const osList = Object.entries(OS_LABELS).filter(([k]) => script[k] === true || (Object.values(OS_LABELS).length === 1 && k === 'lcos'));
    // If none explicitly true, show all content in one block
    if(osList.length <= 1) {
      content.textContent = script.content || '(kein Skript-Inhalt)';
      if(osList[0]) {
        osTabs.innerHTML = `<span style="background:rgba(0,76,151,.15);border:1px solid rgba(0,76,151,.3);border-radius:6px;padding:3px 10px;font-size:11px;font-weight:700;color:var(--accent2)">${OS_LABELS[osList[0][0]]}</span>`;
      }
    } else {
      // Multiple OS scripts: each OS key may have its own content in the future;
      // Currently API has single `content` + boolean flags. Show OS tags.
      osList.forEach(([k,label],i) => {
        const btn = document.createElement('button');
        btn.textContent = label;
        btn.style.cssText = `background:rgba(0,76,151,.${i===0?'2':'1'});border:1px solid rgba(0,76,151,.${i===0?'4':'25'});border-radius:6px;padding:3px 10px;font-size:11px;font-weight:700;color:var(--accent2);cursor:default`;
        osTabs.appendChild(btn);
      });
      content.textContent = script.content || '(kein Skript-Inhalt)';
    }
    // Info bar: meta from addinsData
    const meta = addinsData.find(a => a.id === applicationId);
    if(meta) {
      const tags = [
        meta.resetToDefault ? `<span style="background:rgba(217,119,6,.12);border:1px solid rgba(217,119,6,.25);color:var(--amber);font-size:11px;padding:2px 8px;border-radius:4px">Reset to Default</span>` : '',
        meta.usedForOneTimeExecution ? `<span style="background:rgba(0,76,151,.12);border:1px solid rgba(0,76,151,.25);color:var(--accent2);font-size:11px;padding:2px 8px;border-radius:4px"><i class="fa-solid fa-bolt" style="margin-right:3px"></i>Einmalige Ausführung</span>` : '',
      ].filter(Boolean).join('');
      if(meta.markdown) {
        infoBar.innerHTML = `<div style="font-size:12px;color:var(--text2);flex:1;padding-bottom:8px">${escHtml(meta.markdown).replace(/\n/g,'<br>')}</div>`;
      } else if(tags) {
        infoBar.innerHTML = `<div style="padding-bottom:8px;display:flex;gap:6px">${tags}</div>`;
      }
    }
  } catch(e) {
    content.textContent = 'Fehler: ' + e.message;
  }
}

function addinScriptClose() {
  const modal = document.getElementById('addin-script-modal');
  if(modal) modal.style.display='none';
}

let addinEditId = null; // null = create mode, string = edit mode (id of app)

const OS_ID_MAP = { lcos:'addin-os-lcos', lcosLx:'addin-os-lcoslx', swos:'addin-os-swos',
                    lcosSxSdk4:'addin-os-sdk4', lcosSxXs:'addin-os-xs', lcosFx:'addin-os-fx' };

function osLabelClick(lbl) {
  const radio = lbl.querySelector('input[type=radio]');
  if(!radio) return;
  // deactivate all labels in the group first
  document.querySelectorAll('#addin-create-os-wrap label').forEach(l => {
    const r = l.querySelector('input[type=radio]');
    if(r) { r.checked = false; osApplyStyle(l, false); }
  });
  radio.checked = true;
  osApplyStyle(lbl, true);
}
function osApplyStyle(lbl, active) {
  if(active) {
    lbl.style.border      = '1px solid rgba(0,76,151,.5)';
    lbl.style.background  = 'rgba(0,76,151,.18)';
    lbl.style.color       = 'var(--accent2)';
    lbl.style.fontWeight  = '600';
  } else {
    lbl.style.border      = '1px solid var(--border)';
    lbl.style.background  = 'rgba(255,255,255,.04)';
    lbl.style.color       = 'var(--text2)';
    lbl.style.fontWeight  = '';
  }
}
function osResetAll(defaultCheckedId) {
  Object.values(OS_ID_MAP).forEach(elId => {
    const rb  = document.getElementById(elId);
    const lbl = rb?.closest('label');
    if(!rb || !lbl) return;
    rb.checked = (elId === defaultCheckedId);
    osApplyStyle(lbl, rb.checked);
  });
}

function _addinModalReset() {
  document.getElementById('addin-create-name').value = '';
  document.getElementById('addin-create-name').readOnly = false;
  document.getElementById('addin-create-name').style.borderColor = '';
  document.getElementById('addin-create-name').style.color = '';
  document.getElementById('addin-create-name-err').style.display = 'none';
  document.getElementById('addin-create-enabled').checked = true;
  document.getElementById('addin-create-comment').value = '';
  document.getElementById('addin-create-script').value = '';
  document.getElementById('addin-create-error').style.display = 'none';
  const netWrap = document.getElementById('addin-net-section-wrap');
  if(netWrap) netWrap.style.display = 'none';
  osResetAll('addin-os-lcos');
  const saveBtn = document.getElementById('addin-create-save-btn');
  if(saveBtn) { saveBtn.disabled=false; saveBtn.style.opacity='1'; }
}

function addinCreateOpen() {
  addinEditId = null;
  _addinModalReset();
  document.getElementById('addin-modal-title').textContent = 'Neues Add-in erstellen';
  document.getElementById('addin-save-icon').className = 'fa-solid fa-floppy-disk';
  document.getElementById('addin-save-text').textContent = 'Erstellen';
  document.getElementById('addin-create-modal').style.display = 'flex';
  setTimeout(() => document.getElementById('addin-create-name').focus(), 50);
}

async function addinEditOpen(id) {
  const app = addinsData.find(a => a.id === id);
  if(!app) return;
  addinEditId = id;
  _addinModalReset();
  // Fill metadata
  document.getElementById('addin-create-name').value = app.name || '';
  document.getElementById('addin-create-name').readOnly = true; // name cannot be changed
  document.getElementById('addin-create-name').style.color = 'var(--text3)';
  document.getElementById('addin-create-enabled').checked = !!app.enabled;
  document.getElementById('addin-create-comment').value = app.comment || '';
  document.getElementById('addin-modal-title').textContent = 'Add-in bearbeiten: ' + (app.name || '');
  document.getElementById('addin-save-icon').className = 'fa-solid fa-check';
  document.getElementById('addin-save-text').textContent = 'Speichern';
  document.getElementById('addin-create-modal').style.display = 'flex';
  // Show network assignment section
  const netWrap = document.getElementById('addin-net-section-wrap');
  const netSection = document.getElementById('addin-net-section');
  if(netWrap) netWrap.style.display = '';
  if(netSection) netSection.innerHTML = addinNetworksSectionHtml(id);
  // Lazy-load network list if not yet available
  if(S.accountNetworks.length === 0) {
    loadAccountNetworks().then(() => {
      const s2 = document.getElementById('addin-net-section');
      if(s2 && addinEditId === id) s2.innerHTML = addinNetworksSectionHtml(id);
    });
  }
  // Load script (from cache or API)
  try {
    let script = addinsScripts[id];
    if(!script) {
      script = await api('config', `/configapplication/accounts/${S.accountId}/applications/${id}/script`);
      addinsScripts[id] = script;
    }
    if(script) {
      document.getElementById('addin-create-script').value = script.content || '';
      // Find which OS is active (first true flag wins) and select it
      const activeOs = Object.entries(OS_ID_MAP).find(([k]) => script[k] === true);
      osResetAll(activeOs ? activeOs[1] : 'addin-os-lcos');
    }
  } catch(e) {
    // script load failed - not fatal, user can still edit metadata
  }
  setTimeout(() => document.getElementById('addin-create-comment').focus(), 50);
}

function addinCreateClose() {
  document.getElementById('addin-create-modal').style.display = 'none';
  addinEditId = null;
  // Reset name field appearance
  const nameEl = document.getElementById('addin-create-name');
  if(nameEl) { nameEl.readOnly = false; nameEl.style.color = ''; }
}

function addinCreateValidateName(input) {
  const errEl = document.getElementById('addin-create-name-err');
  if(!errEl) return true;
  const ok = /^[a-zA-Z0-9\-]+$/.test(input.value) || input.value === '';
  errEl.style.display = ok ? 'none' : 'block';
  input.style.borderColor = ok ? '' : 'var(--red)';
  return ok || input.value === '';
}

async function addinCreateSave() {
  const nameEl  = document.getElementById('addin-create-name');
  const errEl   = document.getElementById('addin-create-error');
  const saveBtn = document.getElementById('addin-create-save-btn');
  const name    = (nameEl?.value || '').trim();
  const enabled = document.getElementById('addin-create-enabled').checked;
  const comment = document.getElementById('addin-create-comment').value.trim();
  const script  = document.getElementById('addin-create-script').value;
  const osFlags = {};
  Object.entries(OS_ID_MAP).forEach(([k, elId]) => {
    osFlags[k] = document.getElementById(elId)?.checked === true;
  });

  if(!addinEditId) {
    // Create mode: validate name
    if(!name) { nameEl.focus(); return; }
    if(!/^[a-zA-Z0-9\-]+$/.test(name)) {
      document.getElementById('addin-create-name-err').style.display='block';
      nameEl.focus(); return;
    }
  }

  errEl.style.display='none';
  saveBtn.disabled=true; saveBtn.style.opacity='0.6';
  try {
    if(addinEditId) {
      // ── Edit mode: PUT metadata + POST script ──
      const app = addinsData.find(a => a.id === addinEditId);
      await api('config', `/configapplication/accounts/${S.accountId}/applications/${addinEditId}`, 'PUT',
        { name: app.name, enabled, comment, type: app.type || 'SCRIPT' });
      await api('config', `/configapplication/accounts/${S.accountId}/applications/${addinEditId}/script`, 'POST',
        { content: script, ...osFlags });
      delete addinsScripts[addinEditId]; // invalidate cache
      toast('success', 'Add-in gespeichert', app.name);
    } else {
      // ── Create mode: POST app + POST script ──
      const created = await api('config', `/configapplication/accounts/${S.accountId}/applications`, 'POST',
        { name, enabled, comment, type: 'SCRIPT' });
      if(script || Object.values(osFlags).some(Boolean)) {
        await api('config', `/configapplication/accounts/${S.accountId}/applications/${created.id}/script`, 'POST',
          { content: script, ...osFlags });
      }
      toast('success', 'Add-in erstellt', name);
    }
    addinCreateClose();
    await loadAddins();
  } catch(e) {
    errEl.textContent = 'Fehler: ' + e.message;
    errEl.style.display='block';
    saveBtn.disabled=false; saveBtn.style.opacity='1';
  }
}

// ─── VARIABLES MANAGEMENT ─────────────────────────────────────────────────────
let varsData = [];

async function openVarsModal() {
  const modal = document.getElementById('vars-modal');
  const list  = document.getElementById('vars-list');
  if(!modal) return;
  if(list) list.innerHTML = '<div style="color:var(--text2);font-size:13px;padding:24px 20px"><i class="fa-solid fa-circle-notch fa-spin"></i> Lade Variablen…</div>';
  modal.style.display = 'flex';
  try {
    const data = await api('config',`/configapplication/accounts/${S.accountId}/staticvariables`);
    varsData = Array.isArray(data) ? data : (data?.variables||data?.items||[]);
    renderVars();
  } catch(e) {
    if(list) list.innerHTML = `<div style="color:var(--red);font-size:13px;padding:24px 20px"><i class="fa-solid fa-circle-xmark"></i> Fehler: ${escHtml(e.message)}</div>`;
  }
}

function renderVars() {
  const list  = document.getElementById('vars-list');
  const cntEl = document.getElementById('vars-count');
  if(!list) return;
  if(cntEl) cntEl.textContent = varsData.length ? `${varsData.length} Variable${varsData.length>1?'n':''}` : '';
  if(!varsData.length) {
    list.innerHTML = '<div class="empty-state"><i class="fa-solid fa-sliders"></i><h3>Keine Variablen</h3><p>Es wurden noch keine Add-in Variablen definiert.</p></div>';
    return;
  }
  list.innerHTML = `<div style="display:grid;grid-template-columns:180px 1fr 90px;gap:10px;padding:10px 20px 6px;background:var(--bg2);border-bottom:1px solid var(--border)">
    <div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase">Name</div>
    <div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase">Wert</div>
    <div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase">Typ</div>
  </div>
  <div style="padding:8px 20px 16px">` +
    varsData.map((v,i) => `<div class="var-row">
      <div style="font-size:13px;font-weight:600;font-family:'Courier New',monospace;color:var(--accent2)">${escHtml(v.name||v.key||'–')}</div>
      <div><input class="var-val-input" id="var-val-${i}" type="text" value="${escHtml(v.value||v.defaultValue||'')}" placeholder="(kein Wert)" onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='var(--border)'"></div>
      <div style="font-size:11px;color:var(--text3)">${escHtml(v.type||'String')}</div>
    </div>`).join('')
  + '</div>';
}

function closeVarsModal() {
  document.getElementById('vars-modal').style.display = 'none';
}

// ─── ADD-IN NETWORK ASSIGNMENT ────────────────────────────────────────────────
function addinNetworksSectionHtml(appId) {
  const nets = addinsNetworks[appId] || [];
  const items = nets.map(n => {
    const nid  = n.networkId||n.id||'';
    const nname= n.networkName||n.name||nid;
    return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.04)">
      <i class="fa-solid fa-network-wired" style="color:var(--text3);font-size:11px;flex-shrink:0"></i>
      <span style="font-size:13px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">${escHtml(nname)}</span>
      <span style="font-size:10px;color:var(--text3);font-family:monospace">${escHtml(nid.slice(0,8))}…</span>
      <button onclick='addinNetworkRemove(${JSON.stringify(appId)},${JSON.stringify(nid)})' style="background:rgba(211,47,47,.1);border:1px solid rgba(211,47,47,.25);border-radius:5px;color:var(--red);font-size:11px;padding:3px 8px;cursor:pointer;flex-shrink:0">
        <i class="fa-solid fa-times"></i>
      </button>
    </div>`;
  }).join('');
  // Build network options: S.accountNetworks minus already-assigned ones
  const assignedIds = new Set(nets.map(n => n.networkId||n.id||''));
  const availableNets = S.accountNetworks.filter(n => !assignedIds.has(n.id));
  let netSelector;
  if(availableNets.length) {
    const opts = availableNets.map(n =>
      `<option value=${JSON.stringify(n.id)}>${escHtml(n.name)}${n.name!==n.id?' ('+escHtml(n.id.slice(0,8))+'…)':''}</option>`
    ).join('');
    netSelector = `<select id="addin-net-add-id" style="flex:1;background:rgba(255,255,255,.06);border:1px solid var(--border);border-radius:7px;color:var(--text);padding:7px 10px;font-size:12px;outline:none;cursor:pointer"
      onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='var(--border)'">
      <option value="">— Netzwerk wählen —</option>${opts}</select>`;
  } else if(S.accountNetworks.length === 0) {
    netSelector = `<input id="addin-net-add-id" type="text" placeholder="Netzwerk-UUID eingeben"
      style="flex:1;background:rgba(255,255,255,.06);border:1px solid var(--border);border-radius:7px;color:var(--text);padding:7px 10px;font-size:12px;outline:none;font-family:'Courier New',monospace"
      onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='var(--border)'">`;
  } else {
    netSelector = `<div style="flex:1;font-size:12px;color:var(--text3);padding:7px 10px;background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:7px">Alle Netzwerke bereits zugewiesen</div>`;
  }
  return `<div>${nets.length ? items : '<div style="font-size:12px;color:var(--text3);padding:4px 0">Keine Netzwerke zugewiesen</div>'}</div>
  <div style="display:flex;gap:8px;margin-top:10px">
    ${netSelector}
    <button onclick="addinNetworkAdd()" style="background:rgba(0,76,151,.15);border:1px solid rgba(0,76,151,.3);border-radius:7px;color:var(--accent2);font-size:12px;font-weight:600;padding:7px 14px;cursor:pointer;white-space:nowrap">
      <i class="fa-solid fa-plus"></i> Hinzufügen
    </button>
  </div>`;
}

async function addinNetworkAdd() {
  if(!addinEditId) return;
  const el = document.getElementById('addin-net-add-id');
  const networkId = (el?.value||'').trim();
  if(!networkId) { toast('info','Nichts gewählt','Bitte ein Netzwerk auswählen.'); return; }
  const netObj = S.accountNetworks.find(n => n.id === networkId);
  const networkName = netObj?.name || networkId;
  try {
    await api('config',`/configapplication/accounts/${S.accountId}/applications/${addinEditId}/networks/${networkId}`,'PUT',{});
    if(!addinsNetworks[addinEditId]) addinsNetworks[addinEditId] = [];
    addinsNetworks[addinEditId].push({networkId, networkName});
    const netSection = document.getElementById('addin-net-section');
    if(netSection) netSection.innerHTML = addinNetworksSectionHtml(addinEditId);
    toast('success','Netzwerk hinzugefügt', networkName);
  } catch(e) { toast('error','Fehler', e.message); }
}

async function addinNetworkRemove(appId, networkId) {
  try {
    await api('config',`/configapplication/accounts/${S.accountId}/applications/${appId}/networks/${networkId}`,'DELETE');
    if(addinsNetworks[appId]) addinsNetworks[appId] = addinsNetworks[appId].filter(n=>(n.networkId||n.id)!==networkId);
    const netSection = document.getElementById('addin-net-section');
    if(netSection) netSection.innerHTML = addinNetworksSectionHtml(appId);
    toast('success','Netzwerk entfernt','');
  } catch(e) { toast('error','Fehler', e.message); }
}

/// ─── NETWORKS LIST ────────────────────────────────────────────────────────────
async function loadAccountNetworks() {
  try {
    const data = await api('config', `/confignetwork/accounts/${S.accountId}/networks`);
    const list = Array.isArray(data) ? data : (data?.items || data?.networks || data?.data || []);
    S.accountNetworks = list.map(n => ({
      id:   n.networkId || n.id || '',
      name: n.networkName || n.name || n.networkId || n.id || ''
    })).filter(n => n.id);
  } catch(e) {
    console.warn('loadAccountNetworks failed:', e.message);
    S.accountNetworks = [];
  }
}

export {
  addinsData, addinsNetworks, addinsScripts, addinsFilterQ,
  loadAddins, addinsRender, addinsFilter, addinToggleEnabled, addinCreateOpen, addinCreateClose, addinCreateSave, addinCreateValidateName, addinEditOpen, addinDelete, addinScriptOpen, addinScriptClose,
  openVarsModal, closeVarsModal, renderVars, varsData,
  addinNetworksSectionHtml, addinNetworkAdd, addinNetworkRemove, loadAccountNetworks,
  osLabelClick, osApplyStyle, osResetAll, resetAddinsState,
};

function resetAddinsState() { addinsData = []; addinsNetworks = {}; addinsScripts = {}; }
