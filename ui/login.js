import S from './lib/state.js';
import { api, toast } from './lib/api.js';
import { escHtml } from './lib/helpers.js';

const APP_VERSION = 'v1.12.0';

document.getElementById('app-version').textContent = APP_VERSION;
document.getElementById('api-key-input').addEventListener('keydown', e=>{ if(e.key==='Enter') doLogin(); });
document.getElementById('api-base-input').addEventListener('keydown', e=>{ if(e.key==='Enter') doLogin(); });
(function(){
  const saved=localStorage.getItem('lmc_api_key');
  if(saved){ document.getElementById('api-key-input').value=saved; document.getElementById('save-token-cb').checked=true; }
  const savedBase=localStorage.getItem('lmc_api_base');
  if(savedBase){ document.getElementById('api-base-input').value=savedBase; document.getElementById('login-advanced').open=true; }
})();

let _pickerAccounts = [];

async function doLogin() {
  const key=document.getElementById('api-key-input').value.trim();
  if(!key) return;
  const customBase=document.getElementById('api-base-input').value.trim();
  const btn=document.getElementById('login-btn');
  const errEl=document.getElementById('login-error');
  btn.disabled=true; btn.innerHTML='<i class="fa-solid fa-circle-notch fa-spin"></i>&nbsp; Verbinde…';
  errEl.style.display='none';
  S.apiKey=key;
  S.apiBase=customBase;
  try {
    const accounts=await api('auth','/accounts');
    if(!accounts||!accounts.length) throw new Error('Keine Accounts für diesen API-Key gefunden.');
    if(document.getElementById('save-token-cb').checked) localStorage.setItem('lmc_api_key',key);
    else localStorage.removeItem('lmc_api_key');
    if(customBase) localStorage.setItem('lmc_api_base',customBase);
    else localStorage.removeItem('lmc_api_base');
    if(accounts.length===1) { await selectAccount(accounts[0].id); }
    else { showAccountPicker(accounts); }
  } catch(e) {
    errEl.textContent=e.message||'Verbindung fehlgeschlagen.';
    errEl.style.display='block';
    btn.disabled=false; btn.innerHTML='<i class="fa-solid fa-right-to-bracket"></i>&nbsp; Anmelden';
  }
}

function showAccountPicker(accounts) {
  _pickerAccounts = accounts;
  document.getElementById('account-picker').style.display='flex';
  const inp = document.getElementById('account-search');
  if(inp) { inp.value=''; setTimeout(()=>inp.focus(),80); }
  renderAccountList('');
}

function filterAccounts(q) {
  renderAccountList(q);
}

function renderAccountList(q) {
  const lq = q.trim().toLowerCase();
  const list = document.getElementById('account-list');
  const filtered = lq
    ? _pickerAccounts.filter(a => (a.name||'').toLowerCase().includes(lq) || (a.id||'').toLowerCase().includes(lq) || (a.identifier||'').toLowerCase().includes(lq))
    : _pickerAccounts;
  if(!filtered.length) {
    list.innerHTML=`<div style="text-align:center;color:var(--text3);font-size:13px;padding:24px 0"><i class="fa-solid fa-face-frown-open" style="display:block;font-size:22px;margin-bottom:8px;opacity:.4"></i>Kein Account gefunden</div>`;
    return;
  }
  list.innerHTML='';
  filtered.forEach(acc=>{
    const item=document.createElement('div');
    item.className='account-item';
    const displayName=acc.name||acc.identifier||acc.id.substring(0,8)+'…';
    item.innerHTML=`<div class="acc-icon"><i class="fa-solid fa-building"></i></div><div><div class="acc-name">${escHtml(displayName)}</div><div class="acc-id">${escHtml(acc.id)}</div></div><i class="fa-solid fa-chevron-right" style="color:var(--text3);margin-left:auto"></i>`;
    item.onclick=()=>{ document.getElementById('account-picker').style.display='none'; selectAccount(acc.id,acc.name); };
    list.appendChild(item);
  });
}

async function selectAccount(accountId, knownName) {
  S.accountId=accountId;
  if(knownName) { S.accountName=knownName; }
  else { try { const d=await api('auth',`/accounts/${accountId}`); S.accountName=d?.name||accountId; } catch { S.accountName=accountId; } }
  document.getElementById('login-screen').style.display='none';
  document.getElementById('app').style.display='flex';
  document.getElementById('header-account-name').textContent=S.accountName;
  // Gespeichertes Intervall laden
  const savedInterval=parseInt(localStorage.getItem('refreshInterval')||'0',10);
  S.refreshInterval=savedInterval;
  const sel=document.getElementById('refresh-select');
  if(sel) sel.value=String(savedInterval);
  window.loadBlacklist?.();
  window.loadAccountNetworks?.();
  await window.refreshDashboard?.();
  window.startCountdown?.();
}

function doLogout() {
  clearInterval(S.timer);
  S.apiKey=S.accountId=S.accountName=S.apiBase='';
  S.devices={}; S.statistics={}; S.wlanClients={}; S.wlanStations=[]; S.wlanNeighbors=[]; S.wlanNetworkMap={}; S.accountNetworks=[];
  S.vpnConnections=[]; S.wanInterfaces=[]; S.lldpNeighbors=[]; S.lldpTable=[]; S.configStates={};
  S.siteFilter='all'; S.devFilter='all';
  S._loaded.clear();
  window.resetTopoState?.();
  window.resetAlertsState?.();
  window.resetTrafficState?.();
  window.resetCeState?.();
  window.resetAddinsState?.();
  window.resetSweState?.();
  window.resetWcState?.();
  window.resetIfuState?.();
  window.resetSmState?.();
  window.resetSpState?.();
  window.resetSnState?.();
  window.resetFwmState?.();
  window.resetAtState?.();
  window.resetLaState?.();
  document.getElementById('badge-addins').textContent='–';
  document.getElementById('site-filter-toolbar').style.display='none';
  document.getElementById('site-tiles').style.display='none';
  localStorage.removeItem('lmc_api_key');
  document.getElementById('app').style.display='none';
  document.getElementById('login-screen').style.display='flex';
  document.getElementById('api-key-input').value='';
  document.getElementById('save-token-cb').checked=false;
  const btn=document.getElementById('login-btn');
  btn.disabled=false; btn.innerHTML='<i class="fa-solid fa-right-to-bracket"></i>&nbsp; Anmelden';
}

export { APP_VERSION, doLogin, showAccountPicker, filterAccounts, renderAccountList, selectAccount, doLogout };
