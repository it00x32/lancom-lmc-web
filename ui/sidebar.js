import S from './lib/state.js';
import { markAllTabsDirty, renderTabIfActive, _dirtyTabs } from './lib/helpers.js';

function toggleSidebar() {
  const sb=document.getElementById('sidebar');
  const collapsed=sb.classList.toggle('collapsed');
  localStorage.setItem('sidebarCollapsed', collapsed?'1':'0');
}
(function(){ if(localStorage.getItem('sidebarCollapsed')==='1') document.getElementById('sidebar')?.classList.add('collapsed'); })();

async function showTab(id, skipHash) {
  S.activeTab=id;
  if(!skipHash) history.replaceState(null, '', '#'+id);
  document.querySelectorAll('.tab-section').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('tab-'+id)?.classList.add('active');
  const btn=document.getElementById('tab-btn-'+id);
  btn?.classList.add('active');
  const group=btn?.closest('details.sidebar-group');
  if(group) group.open=true;

  if(id==='neighbors')  await window.ensureLoaded?.('neighbors');
  if(id==='lldp'||id==='topology') await window.ensureLoaded?.('lldp');
  if(id==='devices'||id==='firmware') await window.ensureLoaded?.('config');

  if(_dirtyTabs.has(id)) {
    _dirtyTabs.delete(id);
    switch(id) {
      case 'devices':   window.renderDevices?.(); break;
      case 'wlan':      window.renderWlan?.(); break;
      case 'vpn':       window.renderVpn?.(); break;
      case 'wan':       window.renderWan?.(); break;
      case 'neighbors': window.renderNeighbors?.(); break;
      case 'lldp':      window.renderLldp?.(); break;
      case 'energy':    window.renderEnergy?.(); break;
      case 'lifecycle': window.renderLifecycle?.(); break;
      case 'firmware':  window.renderFirmware?.(); break;
      case 'sites':     window.loadSites?.(); break;
    }
  }
  if(id==='topology'&&Object.keys(S.devices).length) setTimeout(()=>{window.renderTopology?.();setTimeout(()=>window.topoFit?.(),80);},30);
  if(id==='traffic'&&Object.keys(S.devices).length&&!S._loaded.has('traffic')) window.loadTrafficData?.();
  if(id==='alerts'&&S.accountId&&!S._loaded.has('alerts')) window.loadAlerts?.();
  if(id==='addins'&&S.accountId&&!S._loaded.has('addins')) window.loadAddins?.();
  if(id==='client-explorer') window.ceInitDevices?.();
  if(id==='settings') window.loadSettingsUI?.();
  if(id==='energy'&&!_dirtyTabs.has('energy')) { window.loadEnergyPrice?.(); window.renderEnergy?.(); }
  if(id==='anomaly') window.renderAnomalyPage?.();
  if(id==='mesh') window.renderMeshPage?.();
  if(id==='l2tp') window.renderL2tpPage?.();
  if(id==='switch-events'&&S.accountId&&!S._loaded.has('switch-events')) window.loadSwitchEvents?.(true);
  if(id==='wlan-capacity'&&Object.keys(S.devices).length&&!S._loaded.has('wlan-capacity')) window.loadWlanCapacity?.();
  if(id==='if-util'&&Object.keys(S.devices).length&&!S._loaded.has('if-util')) window.loadIfUtil?.();
}

function fmtCountdown(s) {
  if(s>=60) { const m=Math.floor(s/60); return m+':'+(''+(s%60)).padStart(2,'0'); }
  return s+'s';
}

function setRefreshInterval(seconds) {
  S.refreshInterval=seconds;
  localStorage.setItem('refreshInterval', seconds);
  clearInterval(S.timer);
  S.timer=null;
  const info=document.getElementById('sync-info-text');
  if(seconds>0){
    info.style.display='';
    S.countdown=seconds;
    document.getElementById('countdown').textContent=fmtCountdown(seconds);
    S.timer=setInterval(()=>{
      S.countdown--;
      document.getElementById('countdown').textContent=fmtCountdown(S.countdown);
      if(S.countdown<=0){ clearInterval(S.timer); S.timer=null; window.refreshDashboard?.(); }
    },1000);
  } else {
    info.style.display='none';
  }
}

function startCountdown() {
  const sel=document.getElementById('refresh-select');
  if(sel) setRefreshInterval(S.refreshInterval);
}

export { toggleSidebar, showTab, setRefreshInterval, startCountdown };
