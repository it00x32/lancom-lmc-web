const S = {
  apiKey:'', apiBase:'', accountId:'', accountName:'',
  devices:{}, statistics:{},
  wlanClients:{},      // {deviceId: count}
  wlanStations:[],     // full station objects
  wlanNetworkMap:{},   // "{deviceId}:{ssid}" → internal LCOS LX network name
  wlanNeighbors:[], // neighbor AP objects
  accountNetworks:[], // [{id, name}] — LMC config networks
  vpnConnections:[], wanInterfaces:[], lldpNeighbors:[], lldpTable:[],
  configStates:{},
  lastSync:null, filter:'all', wlanFilter:'all', nbFilter:'all',
  devFilter:'all', siteFilter:'all',
  activeTab:'dashboard',
  timer:null, countdown:0, refreshInterval:0,
  _loaded: new Set(),
};
export default S;
