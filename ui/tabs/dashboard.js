import S from '../lib/state.js';
import { api, toast } from '../lib/api.js';
import { deviceName, isOnline, markAllTabsDirty, fmtBytes, escHtml, _dirtyTabs } from '../lib/helpers.js';

// ─── DATA LOADING ─────────────────────────────────────────────────────────────
async function refreshDashboard() {
  clearInterval(S.timer);
  document.getElementById('refresh-icon').classList.add('fa-spin');
  window.setLoading?.(true,'Lade Gerätedaten…');
  S._loaded.clear();
  try {
    const [devList, stats] = await Promise.all([
      api('devices',`/accounts/${S.accountId}/devices`),
      api('devices',`/accounts/${S.accountId}/device_statistics`),
    ]);
    const devices=Array.isArray(devList)?devList:(devList?.devices||[]);
    S.devices={}; devices.forEach(d=>{ if(d.id) S.devices[d.id]=d; });
    S.statistics=stats||{};
    updateStats();

    const ids=Object.keys(S.devices);
    window.setLoading?.(true,'Lade Monitoring-Daten…');

    const [wlanResult, vpnData, wanData] = await Promise.all([
      loadWlanData(ids),
      loadTable(ids, 'vpn-connection', ['deviceId','timeMs','type','hsvpn','peerName','peerIp','active','role','networkName','rxCounterBytes','txCounterBytes','packetLossPercent','rttAvgUs']),
      loadTable(ids, 'wan-interface',  ['deviceId','timeMs','connectionType','logicalState','ipV4','ipV6','rxCounterBytes','txCounterBytes','mobileModemSignalDecibelMw']),
    ]);

    S.wlanClients=wlanResult.counts;
    S.wlanStations=wlanResult.stations;
    S.wlanNetworkMap=wlanResult.networkMap||{};
    S.vpnConnections=vpnData;
    S.wanInterfaces=wanData;
    S._loaded.add('wlan').add('vpn').add('wan');

    S.lastSync=new Date();
    document.getElementById('sync-bar').textContent='Letzte Aktualisierung: '+S.lastSync.toLocaleTimeString('de-DE');

    updateAllBadges();
    buildSiteFilter();
    renderCurrentTab();

  } catch(e) {
    toast('error','Fehler beim Laden',e.message);
  } finally {
    window.setLoading?.(false);
    document.getElementById('refresh-icon').classList.remove('fa-spin');
    window.startCountdown?.();
  }
}

async function ensureLoaded(key, loadFn) {
  if(S._loaded.has(key)) return;
  await loadFn();
  S._loaded.add(key);
}

async function loadNeighborsData() {
  const ids=Object.keys(S.devices);
  S.wlanNeighbors = await loadWlanNeighbors(ids);
}

async function loadLldpFullData() {
  const ids=Object.keys(S.devices);
  const [lldpData, lldpTableData] = await Promise.all([
    loadLldpData(ids),
    loadTable(ids, 'lan-interface', ['deviceId','name','lldpName','active','description']),
  ]);
  S.lldpNeighbors=lldpData;
  S.lldpTable=lldpTableData;
  updateAllBadges();
}

async function loadConfigData() {
  const ids=Object.keys(S.devices);
  const cfgMap = await loadConfigStatesBatched(ids);
  Object.assign(S.configStates, cfgMap);
}

async function renderCurrentTab() {
  markAllTabsDirty();
  window.buildTopoSelector?.();
  const tab = S.activeTab;
  _dirtyTabs.delete(tab);

  if(tab==='neighbors')  await ensureLoaded('neighbors', loadNeighborsData);
  if(tab==='lldp'||tab==='topology') await ensureLoaded('lldp', loadLldpFullData);
  if(tab==='devices'||tab==='firmware') await ensureLoaded('config', loadConfigData);

  switch(tab) {
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
    case 'topology':  setTimeout(()=>{window.renderTopology?.();setTimeout(window.topoFit,80);},30); break;
    case 'addins':    window.loadAddins?.(); break;
    case 'dashboard': window.renderSiteTiles?.(); break;
    default:          window.renderDevices?.(); break;
  }
}

// ─── WLAN DATA ────────────────────────────────────────────────────────────────
async function loadWlanData(deviceIds) {
  if(!deviceIds.length) return {counts:{}, stations:[], networkMap:{}};
  const [stationResults, ifRows] = await Promise.all([
    Promise.allSettled(deviceIds.map(async deviceId=>{
      try {
        const data=await api('monitoring',`/accounts/${S.accountId}/records/wlan_info_json?group=DEVICE&groupId=${deviceId}&period=MINUTE1&type=json&name=stations&latest=1`);
        const stations=(data?.items?.stations?.values?.[0])||[];
        const name=deviceName(S.devices[deviceId]);
        return {deviceId, stations:stations.map(s=>({...s,_deviceId:deviceId,_deviceName:name}))};
      } catch { return {deviceId, stations:[]}; }
    })),
    loadTable(deviceIds, 'wlan-interface', ['deviceId','ssid','name','networkName'], 'monitoring').catch(()=>[])
  ]);

  // Build networkMap: "{deviceId}:{ssid}" → internal LCOS LX network name (= lxTableIdentifier)
  // Priorität: interfaceName aus Station-Records (direkt vom Gerät) → wlan-interface Tabelle
  const networkMap={};
  const counts={}, allStations=[];

  // 1. Station-Records: interfaceName = lxTableIdentifier (höchste Priorität)
  stationResults.forEach(r=>{
    if(r.status==='fulfilled'){
      counts[r.value.deviceId]=r.value.stations.length;
      r.value.stations.forEach(s=>{
        if(s._deviceId && s.ssid && s.interfaceName)
          networkMap[s._deviceId+':'+s.ssid]=s.interfaceName;
        allStations.push(s);
      });
    }
  });

  // 2. wlan-interface Tabelle: nur ergänzen wo noch kein Eintrag
  ifRows.forEach(r=>{
    if(r.deviceId && r.ssid){
      const key=r.deviceId+':'+r.ssid;
      if(!networkMap[key]){
        const internalName=r.networkName||r.name;
        if(internalName) networkMap[key]=internalName;
      }
    }
  });

  return {counts, stations:allStations, networkMap};
}

async function loadWlanNeighbors(deviceIds) {
  if(!deviceIds.length) return [];
  const results=await Promise.allSettled(deviceIds.map(async deviceId=>{
    try {
      const data=await api('monitoring',`/accounts/${S.accountId}/records/wlan_info_json?group=DEVICE&groupId=${deviceId}&period=MINUTE1&type=json&name=neighbors&latest=1`);
      const neighbors=(data?.items?.neighbors?.values?.[0])||[];
      const name=deviceName(S.devices[deviceId]);
      return neighbors.map(n=>({...n,_deviceId:deviceId,_deviceName:name}));
    } catch { return []; }
  }));
  return results.flatMap(r=>r.status==='fulfilled'?r.value:[]);
}

async function loadRecords(deviceIds, recordType, metricName) {
  if(!deviceIds.length) return [];
  const results=await Promise.allSettled(deviceIds.map(async deviceId=>{
    try {
      const data=await api('monitoring',`/accounts/${S.accountId}/records/${recordType}?group=DEVICE&groupId=${deviceId}&period=MINUTE1&type=json&name=${metricName}&latest=1`);
      const rows=(data?.items?.[metricName]?.values?.[0])||[];
      const name=deviceName(S.devices[deviceId]);
      return rows.map(r=>({...r,_deviceId:deviceId,_deviceName:name}));
    } catch { return []; }
  }));
  return results.flatMap(r=>r.status==='fulfilled'?r.value:[]);
}

// Loads current-state data from the monitoring tables API (/api/{id}/tables/{tableName})
// Returns one row per logical entity (deduped by device+name, latest timeMs wins)
async function loadTable(deviceIds, tableName, columns, service) {
  if(!deviceIds.length) return [];
  const svc = service || 'monitoring';
  const from = new Date(Date.now() - 3600000).toISOString(); // last 1h
  const colStr = (columns||[]).map(c=>`column=${encodeURIComponent(c)}`).join('&');
  const all = [];
  for(let i=0; i<deviceIds.length; i+=10) {
    const chunk = deviceIds.slice(i,i+10);
    try {
      const qs = chunk.map(id=>`deviceId=${encodeURIComponent(id)}`).join('&')
               + `&from=${encodeURIComponent(from)}&limit=500`
               + (colStr ? `&${colStr}` : '');
      const data = await api(svc, `/api/${S.accountId}/tables/${tableName}?${qs}`);
      const rows = data?.data || [];
      // Deduplicate: per device keep one row per logical interface/tunnel (latest timeMs)
      // VPN key: connectionName; WAN key: connectionType+ip; fallback: timeMs
      const map = new Map();
      for(const r of rows) {
        const key = `${r.deviceId}__${
          r.peerName ||
          (r.connectionType ? r.connectionType+'__'+(r.ipV4||r.ipV6||'') : null) ||
          r.interfaceName || r.name ||
          r.timeMs
        }`;
        if(!map.has(key) || (r.timeMs||0) > (map.get(key).timeMs||0)) map.set(key, r);
      }
      for(const r of map.values()) {
        const dev = S.devices[r.deviceId];
        all.push({...r, _deviceId:r.deviceId, _deviceName: dev?.status?.name || deviceName(dev) || r.deviceId});
      }
    } catch(e) { console.error('[loadTable]', tableName, e.message); }
  }
  return all;
}

async function loadLldpData(deviceIds) {
  if(!deviceIds.length) return [];
  const all=[];
  for(let i=0;i<deviceIds.length;i+=6){
    const batch=deviceIds.slice(i,i+6);
    const results=await Promise.allSettled(batch.map(async deviceId=>{
      for(let attempt=0;attempt<2;attempt++){
        try {
          const data=await api('monitoring',`/accounts/${S.accountId}/records/lan_info_json?group=DEVICE&groupId=${deviceId}&period=MINUTE1&type=json&source=NEW&name=interfaces&latest=1`);
          const ports=data?.items?.interfaces?.values?.[0];
          if(!ports||typeof ports!=='object') return [];
          const devName=S.devices[deviceId]?.status?.name||deviceId;
          return Object.entries(ports)
            .map(([portNum,p])=>({
              _deviceId: deviceId,
              _deviceName: devName,
              portNum: parseInt(portNum),
              portName: p.name||`LAN-${portNum}`,
              description: p.description||'',
              lldpNames: p.lldpNames||[],
              active: !!p.active,
              loops: p.loops||0,
              speed: p.speed,
              vlan: p.vlan,
              poeStatus: p.poeStatus,
              poePower: p.poePower,
              rxBitPerSec: p.rxBitPerSec,
              txBitPerSec: p.txBitPerSec,
              configuration: p.configuration||'',
              qosClass: p.qosClass,
            }))
            .sort((a,b)=>a.portNum-b.portNum);
        } catch(e) {
          if(attempt===0) await new Promise(r=>setTimeout(r,400));
        }
      }
      return [];
    }));
    all.push(...results.flatMap(r=>r.status==='fulfilled'?r.value:[]));
    if(i+6<deviceIds.length) await new Promise(r=>setTimeout(r,100));
  }
  return all;
}

async function loadConfigState(deviceId) {
  try { const d=await api('devices',`/accounts/${S.accountId}/devices/${deviceId}`); return d?.config||{}; } catch { return {}; }
}
async function loadConfigStatesBatched(deviceIds) {
  const results={};
  for(let i=0;i<deviceIds.length;i+=10){
    const batch=deviceIds.slice(i,i+10);
    const settled=await Promise.allSettled(batch.map(id=>loadConfigState(id)));
    batch.forEach((id,j)=>{ results[id]=settled[j].status==='fulfilled'?settled[j].value:{}; });
  }
  return results;
}

// ─── STATS ────────────────────────────────────────────────────────────────────
function updateStats() {
  const set=(id,path)=>{
    const v=path.split('.').reduce((o,k)=>o?.[k],S.statistics);
    document.getElementById(id).textContent=v!==undefined?v:'–';
  };
  set('s-total','heartbeatState._total'); set('s-online','heartbeatState.active');
  set('s-offline','heartbeatState.inactive'); set('s-alerts','alertState.active');
  set('s-fw','firmwareState.obsolete'); set('s-cfg','configState.outdated');
}
function updateAllBadges() {
  const totalClients=Object.values(S.wlanClients).reduce((a,b)=>a+b,0);
  document.getElementById('s-wlan').textContent=Object.keys(S.wlanClients).length?totalClients:'–';
  document.getElementById('badge-devices').textContent=Object.keys(S.devices).length||'–';
  document.getElementById('badge-wlan').textContent=S.wlanStations.length||'–';
  document.getElementById('badge-vpn').textContent=S.vpnConnections.length||'–';
  document.getElementById('badge-wan').textContent=S.wanInterfaces.length||'–';
  document.getElementById('badge-neighbors').textContent=S.wlanNeighbors.length||'–';
  document.getElementById('badge-lldp').textContent=S.lldpNeighbors.filter(p=>p.lldpNames.length).length||'–';
}

function buildSiteFilter() {
  const sites=[...new Set(Object.values(S.devices).map(d=>d.siteName||'').filter(Boolean))].sort();
  const toolbar=document.getElementById('site-filter-toolbar');
  const group=document.getElementById('site-filter-group');
  if(sites.length<2){ toolbar.style.display='none'; window.renderSiteTiles?.(); return; }
  toolbar.style.display='flex';
  const siteFilter = S.siteFilter ?? 'all';
  group.innerHTML=`<button class="filter-btn${siteFilter==='all'?' active':''}" onclick="setSiteFilter('all',this)">Alle</button>`
    +sites.map(s=>`<button class="filter-btn${siteFilter===s?' active':''}" data-site="${s.replace(/&/g,'&amp;').replace(/"/g,'&quot;')}" onclick="setSiteFilter(this.dataset.site,this)">${escHtml(s)}</button>`).join('');
  window.renderSiteTiles?.();
}

let siteFilter = 'all';

function renderSiteTiles() {
  const tileEl = document.getElementById('site-tiles');
  if(!tileEl) return;
  const devs = Object.values(S.devices);
  const sites = [...new Set(devs.map(d=>d.siteName||'').filter(Boolean))].sort();
  if(sites.length < 2) { tileEl.style.display = 'none'; return; }
  tileEl.style.display = 'flex';
  tileEl.innerHTML = sites.map(s => {
    const sd = devs.filter(d => d.siteName === s);
    const onl = sd.filter(d => isOnline(d)).length;
    const al  = sd.filter(d => d.alerting?.hasAlert).length;
    const act = siteFilter === s;
    return `<div class="site-tile${act?' active':''}" onclick="tileSiteFilter(${JSON.stringify(s)})">
      <div class="site-tile-name"><i class="fa-solid fa-location-dot" style="margin-right:4px;opacity:.5"></i>${escHtml(s)}</div>
      <div class="site-tile-count">${sd.length}</div>
      <div class="site-tile-detail">
        <span style="color:var(--green)"><i class="fa-solid fa-circle" style="font-size:7px"></i> ${onl}</span>
        <span style="color:var(--red)"><i class="fa-solid fa-circle" style="font-size:7px"></i> ${sd.length-onl}</span>
        ${al?`<span style="color:var(--amber)"><i class="fa-solid fa-triangle-exclamation" style="font-size:9px"></i> ${al}</span>`:''}
      </div>
    </div>`;
  }).join('') + `<div class="site-tile${siteFilter==='all'?' active':''}" onclick="tileSiteFilter('all')" style="min-width:80px">
    <div class="site-tile-name">Alle</div>
    <div class="site-tile-count">${devs.length}</div>
    <div class="site-tile-detail" style="color:var(--text3)">Standorte: ${sites.length}</div>
  </div>`;
}

function tileSiteFilter(name) {
  siteFilter = name;
  S.siteFilter = name;
  document.querySelectorAll('#site-filter-group .filter-btn').forEach(b => {
    b.classList.toggle('active', (b.dataset.site||'all') === name || (name==='all' && !b.dataset.site));
  });
  window.renderDevices?.();
  renderSiteTiles();
}

export {
  refreshDashboard,
  renderCurrentTab,
  updateStats,
  updateAllBadges,
  buildSiteFilter,
  loadWlanData,
  loadConfigStatesBatched,
  loadRecords,
  loadTable,
  loadLldpData,
  loadWlanNeighbors,
  loadConfigState,
  renderSiteTiles,
  tileSiteFilter,
  siteFilter,
  ensureLoaded,
  loadNeighborsData,
  loadLldpFullData,
  loadConfigData,
};
