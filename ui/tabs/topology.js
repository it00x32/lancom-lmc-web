import S from '../lib/state.js';
import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import { escHtml, deviceName, deviceTypeLabel, isOnline, statusDot, fmtRate, fmtBytes, signalBar, bandBadge } from '../lib/helpers.js';
import { api, toast } from '../lib/api.js';
import { snmpReqBody } from '../lib/snmp.js';
import { fmtSpeed, poeCell } from './lldp.js';

// ─── NETWORK TOPOLOGY ─────────────────────────────────────────────────────────
let topoTx = 0, topoTy = 0, topoScale = 1, topoRootId = '', topoSiteFilter = '';

let topoHideAP = false;
let topoHideOffline = false;
let topoHideUnconnected = false;
let topoHideGhost = false;
(function loadTopoHideOpts() {
  try {
    if (localStorage.getItem('lmc_topo_hide_ap') === '1') topoHideAP = true;
    if (localStorage.getItem('lmc_topo_hide_offline') === '1') topoHideOffline = true;
    if (localStorage.getItem('lmc_topo_hide_unconnected') === '1') topoHideUnconnected = true;
    if (localStorage.getItem('lmc_topo_hide_ghost') === '1') topoHideGhost = true;
  } catch {}
})();

function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** Netzwerkplan: immer ein konkreter Standort (kein „alle Standorte“). '' = nur Geräte ohne Standortname. */
function topoMatchesSite(d) {
  const sn = (d.siteName || '').trim();
  if (topoSiteFilter === '') return !sn;
  return sn === topoSiteFilter;
}

const TOPO_KIND = { ROUTER: 'ROUTER', ACCESS_POINT: 'ACCESS_POINT', SWITCH: 'SWITCH', FIREWALL: 'FIREWALL', UNKNOWN: 'UNKNOWN' };

/** Gerätetyp für Farbe/Badge (API > Heuristik LLDP/WLAN). */
function topoResolveKind(node) {
  const raw = (node.deviceType || '').toString().trim().toUpperCase();
  if (raw === 'ROUTER') return TOPO_KIND.ROUTER;
  if (raw === 'ACCESS_POINT') return TOPO_KIND.ACCESS_POINT;
  if (raw === 'SWITCH') return TOPO_KIND.SWITCH;
  if (raw === 'FIREWALL') return TOPO_KIND.FIREWALL;
  if (raw) return TOPO_KIND.UNKNOWN;
  if (node.isSwitch) return TOPO_KIND.SWITCH;
  if (node.wlanClients > 0) return TOPO_KIND.ACCESS_POINT;
  return TOPO_KIND.ROUTER;
}

function topoKindStyle(kind) {
  switch (kind) {
    case TOPO_KIND.ACCESS_POINT:
      return {
        short: 'AP',
        badgeBg: 'rgba(167,139,250,.26)',
        badgeFg: '#c4b5fd',
        fillOnline: 'rgba(139,92,246,.1)',
        strokeOnline: 'rgba(167,139,250,.65)',
      };
    case TOPO_KIND.SWITCH:
      return {
        short: 'SW',
        badgeBg: 'rgba(45,212,191,.24)',
        badgeFg: '#5eead4',
        fillOnline: 'rgba(13,148,136,.11)',
        strokeOnline: 'rgba(34,211,238,.62)',
      };
    case TOPO_KIND.FIREWALL:
      return {
        short: 'FW',
        badgeBg: 'rgba(251,146,60,.28)',
        badgeFg: '#fdba74',
        fillOnline: 'rgba(234,88,12,.1)',
        strokeOnline: 'rgba(251,146,60,.68)',
      };
    case TOPO_KIND.UNKNOWN:
      return {
        short: '?',
        badgeBg: 'rgba(148,163,184,.22)',
        badgeFg: '#cbd5e1',
        fillOnline: 'rgba(100,116,139,.09)',
        strokeOnline: 'rgba(148,163,184,.52)',
      };
    case TOPO_KIND.ROUTER:
    default:
      return {
        short: 'GW',
        badgeBg: 'rgba(96,165,250,.24)',
        badgeFg: '#93c5fd',
        fillOnline: 'rgba(37,99,235,.09)',
        strokeOnline: 'rgba(59,130,246,.65)',
      };
  }
}

function persistTopoHideFlag(key, val) {
  try { localStorage.setItem(key, val ? '1' : '0'); } catch {}
}

function syncTopoFilterCheckboxes() {
  const pairs = [
    ['topo-hide-ap', topoHideAP],
    ['topo-hide-offline', topoHideOffline],
    ['topo-hide-unconnected', topoHideUnconnected],
    ['topo-hide-ghost', topoHideGhost],
  ];
  pairs.forEach(([id, v]) => {
    const el = document.getElementById(id);
    if (el) el.checked = v;
  });
}

/** Entfernt Knoten aus dem Graphen vor Layout (AP / offline / nicht verwaltet). */
function applyTopoGraphFilters(nodesIn, edgesIn) {
  const nodes = { ...nodesIn };
  const remove = new Set();
  Object.entries(nodes).forEach(([id, node]) => {
    if (topoHideGhost && node.isGhost) remove.add(id);
    if (!node.isGhost && topoHideOffline && !node.online) remove.add(id);
    if (!node.isGhost && topoHideAP && topoResolveKind(node) === TOPO_KIND.ACCESS_POINT) remove.add(id);
  });
  remove.forEach(id => { delete nodes[id]; });
  const edges = edgesIn.filter(e => nodes[e.from] && nodes[e.to]);
  return { nodes, edges };
}

function topoPickRootIfMissing(nodes, preferredRootId) {
  const ids = Object.keys(nodes);
  if (!ids.length) return '';
  if (preferredRootId && nodes[preferredRootId]) return preferredRootId;
  const managed = ids.filter(id => !nodes[id].isGhost).sort((a, b) =>
    (nodes[a].name || '').localeCompare(nodes[b].name || '', 'de'));
  return managed[0] || ids[0];
}

function topoSetHideAp(v) {
  topoHideAP = !!v;
  persistTopoHideFlag('lmc_topo_hide_ap', topoHideAP);
  renderTopology();
  setTimeout(topoFit, 80);
}
function topoSetHideOffline(v) {
  topoHideOffline = !!v;
  persistTopoHideFlag('lmc_topo_hide_offline', topoHideOffline);
  renderTopology();
  setTimeout(topoFit, 80);
}
function topoSetHideUnconnected(v) {
  topoHideUnconnected = !!v;
  persistTopoHideFlag('lmc_topo_hide_unconnected', topoHideUnconnected);
  renderTopology();
  setTimeout(topoFit, 80);
}
function topoSetHideGhost(v) {
  topoHideGhost = !!v;
  persistTopoHideFlag('lmc_topo_hide_ghost', topoHideGhost);
  renderTopology();
  setTimeout(topoFit, 80);
}
/** null = alle Ebenen; sonst max. BFS-Level vom Startknoten (0 = nur Start) */
let topoDepthLimit = null;
try {
  const raw = localStorage.getItem('lmc_topo_max_depth');
  if (raw !== null && raw !== '') {
    const n = parseInt(raw, 10);
    if (!Number.isNaN(n) && n >= 0) topoDepthLimit = n;
  }
} catch {}
function saveTopoDepthLimit() {
  if (topoDepthLimit === null || topoDepthLimit === undefined) {
    localStorage.removeItem('lmc_topo_max_depth');
  } else {
    localStorage.setItem('lmc_topo_max_depth', String(topoDepthLimit));
  }
}
function syncTopoDepthSelect() {
  const depthSel = document.getElementById('topo-depth-select');
  if (depthSel) depthSel.value = topoDepthLimit === null ? '' : String(topoDepthLimit);
}
const topoDrag = { active: false, sx: 0, sy: 0, tx: 0, ty: 0 };
let _nodeDrag = null; // {el,id,ox,oy,sx,sy}
let topoCustomPos = {};
try { topoCustomPos = JSON.parse(localStorage.getItem('lmc_topo_pos') || '{}'); } catch {}
function saveTopoPos() { localStorage.setItem('lmc_topo_pos', JSON.stringify(topoCustomPos)); }
function topoResetPositions() { topoCustomPos = {}; saveTopoPos(); renderTopology(); setTimeout(topoFit, 80); }
const NW = 190, NH = 66, HG = 220, VG = 140;

function buildTopoGraph() {
  const topoDevName = d => d.status?.name || d.label || d.name || d.id?.substring(0, 8) || '–';

  // Build lookup maps: name → id, ip → id, mac → id
  const nameToId = {}, ipToId = {}, macToId = {};
  function addIp(ip, id) {
    const s = String(ip || '').trim();
    if (!s) return;
    ipToId[s] = id;
  }
  function addMac(m, id) {
    if (!m) return;
    const h = String(m).replace(/[^0-9a-fA-F]/g, '').toLowerCase();
    if (h.length !== 12) return;
    const c = h.match(/.{2}/g).join(':');
    macToId[c] = id;
    macToId[h] = id;
  }
  Object.values(S.devices).forEach(d => {
    [d.status?.name, d.label, d.name, topoDevName(d)].filter(Boolean).forEach(n => {
      if (n && n !== '–') nameToId[n.toLowerCase()] = d.id;
    });
    addIp(d.status?.ip, d.id);
    addIp(d.status?.ipAddress, d.id);
    addIp(d.status?.lastIp, d.id);
    if (d.status?.mac) {
      const lc = d.status.mac.toLowerCase();
      macToId[lc] = d.id;
      addMac(d.status.mac, d.id);
    }
  });

  const IPV4_RE = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d{1,2})\.){3}(?:25[0-5]|2[0-4]\d|1?\d{1,2})\b/g;
  const MAC_IN_STR_RE = /(?:[0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}/g;

  function lldpNeighborKey(x) {
    if (x == null) return '';
    if (typeof x === 'string') return x.trim();
    if (typeof x === 'object') {
      return String(
        x.name || x.systemName || x.hostName || x.lldpName || x.sysName || x.chassisId || ''
      ).trim();
    }
    return String(x).trim();
  }

  function macIdFromString(s) {
    if (!s) return null;
    const raw = String(s);
    MAC_IN_STR_RE.lastIndex = 0;
    let m;
    while ((m = MAC_IN_STR_RE.exec(raw)) !== null) {
      const h = m[0].replace(/[^0-9a-fA-F]/g, '').toLowerCase();
      if (h.length === 12) {
        if (macToId[h]) return macToId[h];
        const c = h.match(/.{2}/g).join(':');
        if (macToId[c]) return macToId[c];
      }
    }
    return null;
  }

  function resolveName(lldpName) {
    if (lldpName == null) return null;
    const raw = lldpNeighborKey(lldpName);
    if (!raw) return null;
    const lc = raw.toLowerCase();
    if (nameToId[lc]) return nameToId[lc];
    if (macToId[lc]) return macToId[lc];
    if (ipToId[raw]) return ipToId[raw];
    if (ipToId[lc]) return ipToId[lc];
    let m;
    IPV4_RE.lastIndex = 0;
    while ((m = IPV4_RE.exec(raw)) !== null) {
      const ip = m[0];
      if (ipToId[ip]) return ipToId[ip];
    }
    const byMac = macIdFromString(raw);
    if (byMac) return byMac;
    // partial match: LLDP name might contain the device name or vice versa
    for (const [n, id] of Object.entries(nameToId)) {
      if (n.length > 3 && (lc.includes(n) || n.includes(lc))) return id;
    }
    return null;
  }

  // Nodes: nur Geräte des gewählten Standorts (bzw. ohne Standort wenn '' gewählt)
  const nodes = {};
  Object.values(S.devices).forEach(d => {
    if (!topoMatchesSite(d)) return;
    nodes[d.id] = {
      id: d.id,
      name: topoDevName(d),
      model: d.status?.model || '',
      siteName: d.siteName || '',
      deviceType: (d.status?.type || d.deviceType || '').toString().trim(),
      online: isOnline(d),
      hasAlert: !!d.alerting?.hasAlert,
      isSwitch: false,
      wlanClients: S.wlanClients[d.id] || 0,
    };
  });

  const edgeMap = {};
  function addEdge(fromId, toId, fromPortName, bps, toPortName) {
    if (!fromId || !toId || fromId === toId) return;
    if (!nodes[fromId] || !nodes[toId]) return;
    const key = [fromId, toId].sort().join('|');
    if (!edgeMap[key]) edgeMap[key] = { from: fromId, to: toId, ports: {}, maxBps: 0 };
    if (fromPortName) {
      if (!edgeMap[key].ports[fromId]) edgeMap[key].ports[fromId] = [];
      if (!edgeMap[key].ports[fromId].includes(fromPortName))
        edgeMap[key].ports[fromId].push(fromPortName);
    }
    if (toPortName) {
      if (!edgeMap[key].ports[toId]) edgeMap[key].ports[toId] = [];
      if (!edgeMap[key].ports[toId].includes(toPortName))
        edgeMap[key].ports[toId].push(toPortName);
    }
    if (bps > edgeMap[key].maxBps) edgeMap[key].maxBps = bps;
  }

  function normMacHex(m) {
    if (!m) return '';
    const h = String(m).replace(/[^0-9a-fA-F]/g, '').toLowerCase();
    return h.length === 12 ? h : '';
  }

  const lldpPortByDevNum = new Map();
  const lldpPortByDevMac = new Map();
  S.lldpNeighbors.forEach(p => {
    const did = p._deviceId;
    lldpPortByDevNum.set(`${did}\t${p.portNum}`, p);
    lldpPortByDevNum.set(`${did}\t${String(p.portNum)}`, p);
    const lanM = /^LAN-(\d+)$/i.exec(p.portName || '');
    if (lanM) lldpPortByDevNum.set(`${did}\t${lanM[1]}`, p);
    const pm = normMacHex(p.portMac);
    if (pm) lldpPortByDevMac.set(`${did}\t${pm}`, p);
  });

  // 1) Edges from LLDP port data
  S.lldpNeighbors.forEach(port => {
    const fromId = port._deviceId;
    if (!nodes[fromId]) return;
    nodes[fromId].isSwitch = true;
    port.lldpNames.forEach((lldpName, idx) => {
      const nbRaw = lldpNeighborKey(lldpName);
      let toId = resolveName(lldpName);
      if (toId === fromId) return;
      if (!toId) {
        toId = 'ghost:' + (nbRaw || String(lldpName));
        if (!nodes[toId]) nodes[toId] = {
          id: toId, name: nbRaw || String(lldpName), model: '', siteName: '',
          online: false, hasAlert: false, isSwitch: false, wlanClients: 0, isGhost: true,
        };
      }
      const rPorts = port.lldpRemotePorts;
      let toPort = (rPorts && rPorts[idx]) ? String(rPorts[idx]).trim() : '';
      if (!toPort && port.lldpNames.length === 1 && port.lldpRemotePort) {
        toPort = String(port.lldpRemotePort).trim();
      }
      if (!toPort && port.lldpRemoteIfNames && port.lldpRemoteIfNames[idx]) {
        toPort = String(port.lldpRemoteIfNames[idx]).trim();
      }
      addEdge(
        fromId,
        toId,
        port.portName,
        (port.rxBitPerSec || 0) + (port.txBitPerSec || 0),
        toPort || undefined
      );
    });
  });

  // 2) Supplement from lan-interface table
  S.lldpTable.forEach(row => {
    const lldpName = (row.lldpName || '').trim();
    if (!lldpName) return;
    const fromId = row.deviceId || row._deviceId;
    if (!nodes[fromId]) return;
    nodes[fromId].isSwitch = true;

    let toId = resolveName(lldpName);
    if (!toId) {
      toId = 'ghost:' + lldpName;
      if (!nodes[toId]) nodes[toId] = {
        id: toId, name: lldpName, model: '', siteName: '',
        online: false, hasAlert: false, isSwitch: false, wlanClients: 0, isGhost: true,
      };
    }
    const toPort = (row.peerPort || row.remotePort || row.lldpRemotePort || '').toString().trim();
    addEdge(fromId, toId, row.name || '', 0, toPort || undefined);
  });

  // 3) wired-station: lokaler Port + Gegenstelle per MAC/Name; Remote-Port aus Monitoring
  (S.wiredStations || []).forEach(row => {
    const fromId = row._deviceId || row.deviceId;
    if (!fromId || !nodes[fromId]) return;
    nodes[fromId].isSwitch = true;

    let toId = null;
    if (row.remoteMacAddress) {
      const h = String(row.remoteMacAddress).replace(/[^0-9a-fA-F]/g, '').toLowerCase();
      if (h.length === 12) {
        toId = macToId[h] || macToId[h.match(/.{2}/g).join(':')];
      }
    }
    if (!toId && row.remoteName) toId = resolveName(row.remoteName);
    if (!toId && row.remoteDescription) toId = resolveName(row.remoteDescription);

    const ghostKey = row.remoteName || row.remoteMacAddress || row.remoteDescription || row.macAddress || 'wired';
    if (!toId) {
      toId = 'ghost:' + ghostKey;
      if (!nodes[toId]) {
        nodes[toId] = {
          id: toId,
          name: String(ghostKey),
          model: '', siteName: '',
          online: false, hasAlert: false, isSwitch: false, wlanClients: 0, isGhost: true,
        };
      }
    }
    if (toId === fromId) return;

    const lpNum = row.localPortId;
    let fromPortLabel = '';
    if (lpNum != null && lpNum !== '') {
      const pr = lldpPortByDevNum.get(`${fromId}\t${Number(lpNum)}`)
        || lldpPortByDevNum.get(`${fromId}\t${String(lpNum)}`);
      fromPortLabel = pr?.portName || `Port ${lpNum}`;
    }
    if (!fromPortLabel) {
      const wm = normMacHex(row.macAddress);
      if (wm) {
        const pr = lldpPortByDevMac.get(`${fromId}\t${wm}`);
        if (pr?.portName) fromPortLabel = pr.portName;
      }
    }
    const toPort = row.remotePortId != null && row.remotePortId !== ''
      ? String(row.remotePortId).trim()
      : '';
    addEdge(fromId, toId, fromPortLabel, 0, toPort || undefined);
  });

  const edges = Object.values(edgeMap);
  return { nodes, edges };
}

function layoutTopo(nodes, edges, rootId) {
  // Adjacency list
  const adj = {};
  Object.keys(nodes).forEach(id => { adj[id] = []; });
  edges.forEach(e => { adj[e.from]?.push(e.to); adj[e.to]?.push(e.from); });

  // BFS from root → assign levels
  const level = {}, byLevel = {};
  const queue = [rootId];
  let head = 0;
  level[rootId] = 0; byLevel[0] = [rootId];
  while (head < queue.length) {
    const curr = queue[head++];
    (adj[curr] || []).forEach(next => {
      if (level[next] === undefined) {
        level[next] = level[curr] + 1;
        if (!byLevel[level[next]]) byLevel[level[next]] = [];
        byLevel[level[next]].push(next);
        queue.push(next);
      }
    });
  }

  // Position each layer horizontally centered
  const pos = {};
  const levels = Object.keys(byLevel).map(Number).sort((a, b) => a - b);
  levels.forEach(lvl => {
    const ids = byLevel[lvl];
    const totalW = (ids.length - 1) * HG;
    ids.forEach((id, i) => { pos[id] = { x: i * HG - totalW / 2, y: lvl * VG }; });
  });

  // Unconnected nodes below a separator
  const unconnected = Object.keys(nodes).filter(id => level[id] === undefined);
  const maxLvl = levels.length ? Math.max(...levels) : 0;
  const unconnY = (maxLvl + 2) * VG;
  const totalUW = (unconnected.length - 1) * HG;
  unconnected.forEach((id, i) => { pos[id] = { x: i * HG - totalUW / 2, y: unconnY }; });

  // Apply custom (user-dragged) positions
  Object.entries(topoCustomPos).forEach(([id, p]) => { if (pos[id]) pos[id] = { x: p.x, y: p.y }; });

  return { pos, level, byLevel, unconnected, maxLvl };
}

function buildTopoSelector() {
  const allDevices = Object.values(S.devices);
  if (!allDevices.length) return;

  const siteSel = document.getElementById('topo-site-select');
  if (!siteSel) return;

  const namedSites = [...new Set(allDevices.map(d => (d.siteName || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
  const hasUnnamed = allDevices.some(d => !(d.siteName || '').trim());

  const prevSelected = siteSel.value;
  let opts = '';
  namedSites.forEach(s => {
    opts += `<option value="${escAttr(s)}">${escHtml(s)}</option>`;
  });
  if (hasUnnamed) {
    opts += `<option value="">Ohne Standort</option>`;
  }
  siteSel.innerHTML = opts;

  const valid = new Set(namedSites);
  if (hasUnnamed) valid.add('');

  let next = topoSiteFilter;
  if (valid.has(prevSelected)) next = prevSelected;
  else if (!valid.has(topoSiteFilter)) {
    next = namedSites.length ? namedSites[0] : '';
  }
  topoSiteFilter = next;
  siteSel.value = topoSiteFilter;

  const ids = allDevices.filter(d => topoMatchesSite(d)).map(d => d.id);
  if (!ids.length) return;

  const sel = document.getElementById('topo-root-select');
  const prev = sel.value || topoRootId;

  // Default root: node with most LLDP edges in current site
  if (!topoRootId || !ids.includes(topoRootId)) {
    const deg = {};
    ids.forEach(id => { deg[id] = 0; });
    S.lldpNeighbors.forEach(p => {
      if (deg[p._deviceId] !== undefined) deg[p._deviceId]++;
    });
    const sorted = [...ids].sort((a, b) => deg[b] - deg[a]);
    topoRootId = sorted[0] || ids[0];
  }

  const topoDevName = d => d.status?.name || d.label || d.name || d.id?.substring(0, 8) || '–';
  const sorted = [...ids].sort((a, b) => topoDevName(S.devices[a]).localeCompare(topoDevName(S.devices[b])));
  sel.innerHTML = sorted.map(id => {
    const n = topoDevName(S.devices[id]);
    return `<option value="${id}"${id === topoRootId ? ' selected' : ''}>${escHtml(n)}</option>`;
  }).join('');
  if (prev && ids.includes(prev)) { sel.value = prev; topoRootId = prev; }
}

function renderTopology() {
  buildTopoSelector();
  syncTopoFilterCheckboxes();

  const ids = Object.values(S.devices)
    .filter(d => topoMatchesSite(d))
    .map(d => d.id);
  const empty = document.getElementById('topo-empty');
  const gEl = document.getElementById('topo-g');
  if (!ids.length) {
    empty.style.display = 'flex'; gEl.innerHTML = '';
    const depthBanner = document.getElementById('topo-depth-banner');
    if (depthBanner) { depthBanner.style.display = 'none'; depthBanner.innerHTML = ''; }
    return;
  }
  empty.style.display = 'none';

  syncTopoDepthSelect();
  let rootId = document.getElementById('topo-root-select').value || topoRootId || ids[0];

  let { nodes, edges } = buildTopoGraph();
  ({ nodes, edges } = applyTopoGraphFilters(nodes, edges));

  if (!Object.keys(nodes).length) {
    const depthBanner = document.getElementById('topo-depth-banner');
    if (depthBanner) { depthBanner.style.display = 'none'; depthBanner.innerHTML = ''; }
    gEl.innerHTML = '';
    empty.style.display = 'flex';
    const eh = empty.querySelector('h3');
    const ep = empty.querySelector('p');
    if (eh) eh.textContent = 'Ansicht leer';
    if (ep) ep.textContent = 'Alle Knoten sind durch die aktiven Filter ausgeblendet. Bitte Filter anpassen.';
    return;
  }
  const eh = empty.querySelector('h3');
  const ep = empty.querySelector('p');
  if (eh) eh.textContent = 'Keine Topologie-Daten';
  if (ep) ep.textContent = 'Keine LLDP-Verbindungen oder Geräte vorhanden.';

  rootId = topoPickRootIfMissing(nodes, rootId);
  topoRootId = rootId;
  const rootSel = document.getElementById('topo-root-select');
  if (rootSel && nodes[rootId]) rootSel.value = rootId;

  const { pos, level, unconnected } = layoutTopo(nodes, edges, rootId);

  function inSpanningTree(id) {
    return level[id] !== undefined;
  }

  /** Darstellung: Pfad vom Startgerät inkl. Tiefenlimit; „ohne Verbindung“ nur bei unbegrenzter Tiefe und wenn nicht gefiltert. */
  function showTopoNode(id) {
    if (!nodes[id]) return false;
    if (inSpanningTree(id)) {
      return topoDepthLimit == null || level[id] <= topoDepthLimit;
    }
    if (topoDepthLimit != null) return false;
    if (topoHideUnconnected) return false;
    return true;
  }

  const depthBanner = document.getElementById('topo-depth-banner');
  if (depthBanner) {
    if (topoDepthLimit == null) {
      depthBanner.style.display = 'none';
      depthBanner.innerHTML = '';
    } else {
      const reachable = Object.keys(level).length;
      const shown = Object.keys(nodes).filter(id => showTopoNode(id)).length;
      depthBanner.style.display = 'flex';
      depthBanner.innerHTML = `<span class="topo-depth-banner-text">Ansicht begrenzt auf <strong>${topoDepthLimit}</strong> Hop(s) vom Startgerät (${shown} von ${reachable} Knoten im Pfad). Für die volle Topologie: <strong>Unbegrenzt</strong> wählen oder hier klicken.</span><button type="button" class="topo-depth-banner-btn" onclick="topoChangeDepth('')">Alle Ebenen anzeigen</button>`;
    }
  }

  let svg = '';

  const uncShown = topoDepthLimit == null && !topoHideUnconnected
    ? unconnected.filter(id => nodes[id] && showTopoNode(id))
    : [];
  if (uncShown.length) {
    const uy = uncShown.map(id => pos[id].y).reduce((a, b) => Math.min(a, b), Infinity);
    const xs = uncShown.map(id => pos[id].x);
    const x1 = Math.min(...xs) - NW / 2 - 30, x2 = Math.max(...xs) + NW / 2 + 30;
    svg += `<line x1="${x1}" y1="${uy - 55}" x2="${x2}" y2="${uy - 55}" stroke="rgba(255,255,255,.06)" stroke-width="1" stroke-dasharray="6,5"/>`;
    svg += `<text x="${(x1 + x2) / 2}" y="${uy - 64}" text-anchor="middle" font-size="9" font-weight="600" fill="rgba(148,163,184,.35)" font-family="'DM Sans',sans-serif" letter-spacing="0.1em">KEINE VERBINDUNG</text>`;
  }

  // Helper: point on the rectangle border (cx,cy, half-width hw, half-height hh)
  // in the direction from (cx,cy) toward (tx,ty)
  const hw = NW / 2, hh = NH / 2;
  function borderPt(cx, cy, tx, ty) {
    const dx = tx - cx, dy = ty - cy;
    if (!dx && !dy) return { x: cx, y: cy + hh };
    const sX = dx ? hw / Math.abs(dx) : Infinity;
    const sY = dy ? hh / Math.abs(dy) : Infinity;
    const s = Math.min(sX, sY);
    return { x: cx + dx * s, y: cy + dy * s };
  }
  // Label position: just outside the border point, at fixed offset.
  const LOFF = 13; // px outside border
  function labelPt(cx, cy, bx, by) {
    const eps = 0.5;
    if (Math.abs(Math.abs(by - cy) - hh) < eps) {
      return { x: bx, y: cy + Math.sign(by - cy) * (hh + LOFF), anchor: 'middle' };
    } else {
      return { x: cx + Math.sign(bx - cx) * (hw + LOFF), y: by, anchor: bx > cx ? 'start' : 'end' };
    }
  }

  // Edges (curved bezier paths) with bandwidth coloring + port labels
  edges.forEach(e => {
    if (!showTopoNode(e.from) || !showTopoNode(e.to)) return;
    const f = pos[e.from], t = pos[e.to];
    if (!f || !t) return;
    const bothOnline = nodes[e.from]?.online && nodes[e.to]?.online;

    const cy = (f.y + t.y) / 2;
    const fs = borderPt(f.x, f.y, t.x, t.y);
    const te = borderPt(t.x, t.y, f.x, f.y);

    const bps = e.maxBps || 0;
    let color, w;
    if (!bothOnline) {
      color = 'rgba(0,76,151,.2)'; w = 1.5;
    } else if (bps > 900000000) {
      color = 'rgba(211,47,47,.75)'; w = 3;
    } else if (bps > 100000000) {
      color = 'rgba(217,119,6,.75)'; w = 2.5;
    } else if (bps > 10000000) {
      color = 'rgba(26,138,62,.65)'; w = 2;
    } else if (bps > 1000000) {
      color = 'rgba(217,119,6,.65)'; w = 2;
    } else {
      color = 'rgba(0,76,151,.55)'; w = 2;
    }
    const dash = bothOnline ? '' : '5,4';
    svg += `<path d="M${fs.x.toFixed(1)},${fs.y.toFixed(1)} C${fs.x.toFixed(1)},${cy} ${te.x.toFixed(1)},${cy} ${te.x.toFixed(1)},${te.y.toFixed(1)}" stroke="${color}" stroke-width="${w}" fill="none"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;

    if (bothOnline && bps > 1000000) {
      const mx = (fs.x + te.x) / 2, my = (fs.y + te.y) / 2;
      const bLabel = bps > 1000000000 ? `${(bps / 1000000000).toFixed(1)}G` : (bps > 1000000 ? `${Math.round(bps / 1000000)}M` : `${Math.round(bps / 1000)}K`);
      svg += `<text x="${mx.toFixed(1)}" y="${my.toFixed(1)}" text-anchor="middle" font-size="9" fill="${color}" font-family="'DM Sans',sans-serif" paint-order="stroke" stroke="rgba(10,22,40,.9)" stroke-width="3" stroke-linejoin="round">${bLabel}</text>`;
    }

    const lp = (e.ports?.[e.from] || []).join(', ');
    const rp = (e.ports?.[e.to] || []).join(', ');
    if (lp || rp) {
      const ts = `font-size="10" font-weight="600" fill="rgba(30,50,80,.88)" font-family="'DM Sans',sans-serif" paint-order="stroke" stroke="rgba(240,244,248,.95)" stroke-width="4" stroke-linejoin="round" dominant-baseline="middle"`;
      if (lp) {
        const lpos = labelPt(f.x, f.y, fs.x, fs.y);
        svg += `<text x="${lpos.x.toFixed(1)}" y="${lpos.y.toFixed(1)}" text-anchor="${lpos.anchor}" ${ts}>${escHtml(lp)}</text>`;
      }
      if (rp) {
        const rpos = labelPt(t.x, t.y, te.x, te.y);
        svg += `<text x="${rpos.x.toFixed(1)}" y="${rpos.y.toFixed(1)}" text-anchor="${rpos.anchor}" ${ts}>${escHtml(rp)}</text>`;
      }
    }
  });

  // Nodes
  Object.entries(pos).forEach(([id, { x, y }]) => {
    if (!showTopoNode(id)) return;
    const node = nodes[id]; if (!node) return;
    const isRoot = id === rootId;
    const rx = x - NW / 2, ry = y - NH / 2;

    // ── Ghost node (unmanaged LLDP neighbor) ──────────────────────────────
    if (node.isGhost) {
      const dname = node.name.length > 22 ? node.name.slice(0, 21) + '…' : node.name;
      svg += `<g class="topo-node" data-nid="${id}" data-x="${x}" data-y="${y}" opacity="0.7" style="cursor:grab">
        <rect x="${rx}" y="${ry}" width="${NW}" height="${NH}" rx="10"
          fill="rgba(220,230,245,.7)" stroke="rgba(100,116,139,.4)" stroke-width="1.5" stroke-dasharray="6,4"/>
        <text x="${rx + NW / 2}" y="${ry + 27}" text-anchor="middle" font-size="12" font-weight="600"
          fill="rgba(51,65,85,.85)" font-family="'DM Sans',sans-serif">${escHtml(dname)}</text>
        <text x="${rx + NW / 2}" y="${ry + 44}" text-anchor="middle" font-size="9"
          fill="rgba(100,116,139,.8)" font-family="'DM Sans',sans-serif" font-style="italic">nicht verwaltet</text>
      </g>`;
      return;
    }

    // ── Managed node (Typ farblich: Router / AP / Switch / Firewall) ───────
    const kind = topoResolveKind(node);
    const ks = topoKindStyle(kind);
    const borderColor = node.hasAlert
      ? 'rgba(217,119,6,.82)'
      : !node.online
        ? 'rgba(211,47,47,.45)'
        : ks.strokeOnline;
    const dotColor = node.hasAlert ? '#d97706' : node.online ? '#1a8a3e' : '#d32f2f';
    const bgFill = node.hasAlert
      ? 'rgba(217,119,6,.09)'
      : !node.online
        ? 'rgba(71,85,105,.08)'
        : ks.fillOnline;
    const filter = isRoot ? 'filter="url(#topo-glow)"' : '';

    const dname = node.name.length > 21 ? node.name.slice(0, 20) + '…' : node.name;
    const dsub = (node.model || node.siteName);
    const dsubT = dsub.length > 24 ? dsub.slice(0, 23) + '…' : dsub;

    const dev = S.devices[id];
    const tip = escHtml(dev ? deviceTypeLabel(dev) : ks.short);

    const nodeText = 'rgba(15,23,42,.92)';
    const nodeSub = 'rgba(71,85,105,.75)';

    svg += `<g class="topo-node" data-nid="${id}" data-x="${x}" data-y="${y}" onclick="topoOpenDetail('${id}')" ${filter}>
      <title>${tip}</title>
      <rect class="topo-node-rect" x="${rx}" y="${ry}" width="${NW}" height="${NH}" rx="10"
        fill="${bgFill}" stroke="${borderColor}" stroke-width="${isRoot ? 2.5 : 1.5}"/>
      ${isRoot ? `<rect x="${rx - 2}" y="${ry - 2}" width="${NW + 4}" height="${NH + 4}" rx="12" fill="none" stroke="${borderColor}" stroke-width="0.5" opacity="0.4"/>` : ''}
      <circle cx="${rx + 16}" cy="${y}" r="5" fill="${dotColor}"${node.online && !node.hasAlert ? ' filter="url(#topo-glow)"' : ''}/>
      <rect x="${rx + NW - 36}" y="${ry + 6}" width="28" height="16" rx="4" fill="${ks.badgeBg}"/>
      <text x="${rx + NW - 22}" y="${ry + 17}" text-anchor="middle" font-size="9" font-weight="800" fill="${ks.badgeFg}" font-family="'DM Sans',sans-serif">${ks.short}</text>
      <text x="${rx + 28}" y="${ry + 24}" font-size="13" font-weight="700" fill="${nodeText}" font-family="'DM Sans',sans-serif">${escHtml(dname)}</text>
      <text x="${rx + 28}" y="${ry + 42}" font-size="10" fill="${nodeSub}" font-family="'DM Sans',sans-serif">${escHtml(dsubT || '–')}</text>
    </g>`;
  });

  gEl.innerHTML = svg;
  updateTopoTransform();
}

function topoSetRoot(id) {
  topoRootId = id;
  document.getElementById('topo-root-select').value = id;
  renderTopology();
  setTimeout(topoFit, 80);
}

function topoOpenDetail(id) {
  const device = S.devices[id]; if (!device) return;
  const topoDevName = d => d.status?.name || d.label || d.name || d.id?.substring(0, 8) || '–';
  const name = topoDevName(device);
  const online = isOnline(device), hasAlert = !!device.alerting?.hasAlert;

  document.getElementById('topo-detail-dot').style.background = hasAlert ? '#d97706' : online ? '#1a8a3e' : '#d32f2f';
  document.getElementById('topo-detail-name').textContent = name;
  const deviceIpLink = device.status?.ip
    ? `<a href="http://${encodeURI(device.status.ip)}" target="_blank" rel="noopener" title="WEBconfig öffnen" style="color:var(--accent2);text-decoration:none">${escHtml(device.status.ip)}<i class="fa-solid fa-arrow-up-right-from-square" style="font-size:8px;margin-left:3px;opacity:.7"></i></a>`
    : null;
  document.getElementById('topo-detail-sub').innerHTML = [escHtml(device.status?.model), escHtml(device.siteName), deviceIpLink].filter(Boolean).join(' · ') || '–';
  document.getElementById('topo-detail-setroot').onclick = () => { topoSetRoot(id); };

  let html = '';

  // Switch-Ports / LLDP outgoing connections
  const myPorts = S.lldpNeighbors.filter(p => p._deviceId === id);
  if (myPorts.length) {
    html += `<div class="detail-section-title">Switch-Ports (${myPorts.length})</div>`;
    html += `<table class="data-table"><thead><tr><th>Port</th><th>LLDP-Nachbar</th><th>Status</th><th>Speed</th><th>PoE</th></tr></thead><tbody>`;
    myPorts.forEach(p => {
      const neighbor = p.lldpNames.length ? escHtml(p.lldpNames.join(', ')) : '<span class="muted">–</span>';
      html += `<tr${p.loops > 0 ? ' style="background:rgba(211,47,47,.05)"' : ''}>
        <td><strong>${escHtml(p.portName)}</strong>${p.description ? `<div style="font-size:10px;color:var(--text2)">${escHtml(p.description)}</div>` : ''}</td>
        <td>${neighbor}</td>
        <td>${statusDot(p.active)}</td>
        <td class="muted" style="white-space:nowrap">${fmtSpeed(p.speed)}</td>
        <td class="muted" style="white-space:nowrap">${poeCell(p.poeStatus, p.poePower)}</td>
      </tr>`;
    });
    html += `</tbody></table>`;
  }

  // Incoming connections
  const incoming = S.lldpNeighbors.filter(p => p._deviceId !== id && p.lldpNames.some(n => n.toLowerCase() === name.toLowerCase()));
  if (incoming.length) {
    html += `<div class="detail-section-title">Verbunden über</div>`;
    html += `<table class="data-table"><thead><tr><th>Switch</th><th>Port</th><th>Status</th><th>Speed</th></tr></thead><tbody>`;
    incoming.forEach(p => {
      html += `<tr>
        <td class="device-ref">${escHtml(p._deviceName)}</td>
        <td><strong>${escHtml(p.portName)}</strong>${p.description ? `<div style="font-size:10px;color:var(--text2)">${escHtml(p.description)}</div>` : ''}</td>
        <td>${statusDot(p.active)}</td>
        <td class="muted" style="white-space:nowrap">${fmtSpeed(p.speed)}</td>
      </tr>`;
    });
    html += `</tbody></table>`;
  }

  // WLAN clients (if AP)
  const clients = S.wlanStations.filter(s => s._deviceId === id);
  if (clients.length) {
    html += `<div class="detail-section-title">WLAN Clients (${clients.length})</div>`;
    html += `<table class="data-table"><thead><tr><th>Hostname</th><th>MAC</th><th>IP</th><th>Band</th><th>Signal</th><th>SSID</th></tr></thead><tbody>`;
    clients.forEach(c => {
      const hostname = c.name || '–';
      const vendor = c.vendor ? `<div style="font-size:10px;color:var(--text2)">${escHtml(c.vendor)}</div>` : '';
      html += `<tr>
        <td>${escHtml(hostname)}${vendor}</td>
        <td class="mono">${escHtml(c.mac || '–')}</td>
        <td class="mono">${escHtml(c.ip || '–')}</td>
        <td>${bandBadge(c.band)}</td>
        <td>${signalBar(c.signal)}</td>
        <td class="muted">${escHtml(c.ssid || '–')}</td>
      </tr>`;
    });
    html += `</tbody></table>`;
  }

  if (!myPorts.length && !incoming.length && !clients.length) {
    html = `<div style="color:var(--text2);font-size:13px;padding:24px 0;text-align:center"><i class="fa-solid fa-diagram-project" style="display:block;font-size:28px;color:var(--text3);margin-bottom:10px"></i>Keine Verbindungsdaten verfügbar.</div>`;
  }

  // SNMP MAC-Tabelle
  if (online) {
    const deviceIp = device.status?.ip || device.status?.ipAddress || '';
    html += `<div class="detail-section-title">Verbundene Geräte (SNMP)</div>
    <div id="mac-table-area">
      <div style="display:flex;gap:6px;align-items:center;margin-bottom:8px;">
        ${deviceIp
      ? `<button onclick="loadSnmpMacTable('${id}','${escHtml(deviceIp)}')" style="background:rgba(0,76,151,.15);border:1px solid var(--border);border-radius:6px;color:var(--accent2);font-size:12px;font-weight:600;padding:5px 10px;cursor:pointer;white-space:nowrap;"><i class="fa-solid fa-ethernet"></i> SNMP abfragen</button>`
      : `<span style="color:var(--text3);font-size:11px">Keine IP bekannt</span>`
    }
      </div>
      <div id="snmp-result-area" style="color:var(--text3);font-size:11px">${deviceIp ? escHtml(deviceIp) : 'Keine IP-Adresse verfügbar'}</div>
    </div>
    <div style="margin-top:8px">
      <button onclick="inspectLldpRaw('${id}')" style="background:none;border:none;color:var(--text3);font-size:10px;cursor:pointer;padding:0;text-decoration:underline">LLDP-Rohdaten (Debug)</button>
    </div>`;
  }

  document.getElementById('topo-detail-content').innerHTML = html;
  document.getElementById('topo-detail').style.display = 'flex';
}

async function loadSnmpMacTable(deviceId, host) {
  const area = document.getElementById('snmp-result-area');
  if (!area) return;
  area.innerHTML = `<div style="color:var(--text2);font-size:12px"><i class="fa-solid fa-circle-notch fa-spin"></i> SNMP-Abfrage (Bridge-MIB + ARP)…</div>`;
  try {
    const r = await fetch('/snmp', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(snmpReqBody(host, 'mac-table')) });
    const result = await r.json();

    if (result.error) {
      area.innerHTML = `<div style="color:var(--red);font-size:12px"><i class="fa-solid fa-triangle-exclamation"></i> ${escHtml(result.error)}</div>`;
      return;
    }
    if (!result.hasMacTable) {
      area.innerHTML = `<div style="color:var(--text2);font-size:12px">Keine MAC-Einträge gefunden.<br><span style="font-size:10px;color:var(--text3)">Mögliche Ursachen: SNMP nicht aktiviert, falsche Community, kein Switch.</span></div>`;
      return;
    }

    const srcLabel = result.source === 'wlan-clients'
      ? `<span style="background:rgba(217,119,6,.15);border:1px solid rgba(217,119,6,.3);border-radius:3px;padding:1px 5px;color:var(--teal);margin-left:6px;font-size:10px"><i class="fa-solid fa-wifi"></i> WLAN-Clients</span>`
      : '';
    let html = `<div style="font-size:10px;color:var(--text3);margin-bottom:6px">${result.count} MACs · ${result.countWithIp} mit IP · ${escHtml(host)}${srcLabel}</div>`;
    const portHeader = result.source === 'wlan-clients' ? 'SSID / Kanal' : 'Port';
    html += `<table class="data-table"><thead><tr><th>${portHeader}</th><th>MAC</th><th>IP</th></tr></thead><tbody>`;
    result.entries.forEach(e => {
      html += `<tr>
        <td><strong>${escHtml(e.portName)}</strong></td>
        <td class="mono" style="font-size:11px">${escHtml(e.mac)}</td>
        <td class="mono" style="font-size:11px">${e.ip ? escHtml(e.ip) : '<span class="muted">–</span>'}</td>
      </tr>`;
    });
    html += `</tbody></table>`;
    area.innerHTML = html;
  } catch (e) {
    area.innerHTML = `<div style="color:var(--red);font-size:12px"><i class="fa-solid fa-triangle-exclamation"></i> Verbindungsfehler: ${escHtml(e.message)}</div>`;
  }
}

// Legacy API-Explorer (nicht mehr im UI, aber noch aufrufbar)
async function loadMacTable(deviceId) {
  const area = document.getElementById('snmp-result-area') || document.getElementById('mac-table-area');
  if (!area) return;
  area.innerHTML = `<div style="color:var(--text2);font-size:12px;padding:8px 0"><i class="fa-solid fa-circle-notch fa-spin"></i> Erkunde 28 Endpunkt-Varianten…</div>`;

  const monBase = `/accounts/${S.accountId}/records`;
  const devBase = `/accounts/${S.accountId}`;
  const qBase = `group=DEVICE&groupId=${deviceId}&period=MINUTE1&type=json&latest=1`;

  const candidates = [
    { svc: 'monitoring', path: `${monBase}/lan_info_json?${qBase}&source=NEW&name=arp`, label: 'lan_info_json NEW name=arp' },
    { svc: 'monitoring', path: `${monBase}/lan_info_json?${qBase}&source=NEW&name=arp-table`, label: 'lan_info_json NEW name=arp-table' },
    { svc: 'monitoring', path: `${monBase}/lan_info_json?${qBase}&source=NEW&name=mac-table`, label: 'lan_info_json NEW name=mac-table' },
    { svc: 'monitoring', path: `${monBase}/lan_info_json?${qBase}&source=NEW&name=mactable`, label: 'lan_info_json NEW name=mactable' },
    { svc: 'monitoring', path: `${monBase}/lan_info_json?${qBase}&source=NEW&name=hosts`, label: 'lan_info_json NEW name=hosts' },
    { svc: 'monitoring', path: `${monBase}/lan_info_json?${qBase}&source=NEW&name=stations`, label: 'lan_info_json NEW name=stations' },
    { svc: 'monitoring', path: `${monBase}/lan_info_json?${qBase}&source=NEW&name=bridge`, label: 'lan_info_json NEW name=bridge' },
    { svc: 'monitoring', path: `${monBase}/lan_info_json?${qBase}&source=NEW&name=eth`, label: 'lan_info_json NEW name=eth' },
    { svc: 'monitoring', path: `${monBase}/lan_info_json?${qBase}&source=NEW&name=clients`, label: 'lan_info_json NEW name=clients' },
    { svc: 'monitoring', path: `${monBase}/lan_info_json?${qBase}&source=NEW&name=forward`, label: 'lan_info_json NEW name=forward' },
    { svc: 'monitoring', path: `${monBase}/lan_info_json?${qBase}&source=NEW`, label: 'lan_info_json NEW (kein name)' },
    { svc: 'monitoring', path: `${monBase}/lan_info_json?${qBase}&name=arp`, label: 'lan_info_json (kein source) name=arp' },
    { svc: 'monitoring', path: `${monBase}/lan_info_json?${qBase}&name=mac-table`, label: 'lan_info_json (kein source) name=mac-table' },
    { svc: 'monitoring', path: `${monBase}/lan_info_json?${qBase}&name=hosts`, label: 'lan_info_json (kein source) name=hosts' },
    { svc: 'monitoring', path: `${monBase}/lan_info_json?${qBase}`, label: 'lan_info_json (kein source, kein name)' },
    { svc: 'monitoring', path: `${monBase}/arp_info_json?${qBase}&source=NEW`, label: 'arp_info_json NEW' },
    { svc: 'monitoring', path: `${monBase}/arp_info_json?${qBase}`, label: 'arp_info_json (kein source)' },
    { svc: 'monitoring', path: `${monBase}/mac_table_json?${qBase}&source=NEW`, label: 'mac_table_json NEW' },
    { svc: 'monitoring', path: `${monBase}/mac_table_json?${qBase}`, label: 'mac_table_json (kein source)' },
    { svc: 'monitoring', path: `${monBase}/neighbor_info_json?${qBase}&source=NEW`, label: 'neighbor_info_json NEW' },
    { svc: 'monitoring', path: `${monBase}/dhcp_info?${qBase}&source=NEW`, label: 'dhcp_info NEW' },
    { svc: 'monitoring', path: `${monBase}/dhcp_info?${qBase}`, label: 'dhcp_info (kein source)' },
    { svc: 'monitoring', path: `${monBase}/device_info?${qBase}&source=NEW`, label: 'device_info NEW' },
    { svc: 'devices', path: `${devBase}/devices/${deviceId}/neighbors`, label: 'devices-API: /neighbors' },
    { svc: 'devices', path: `${devBase}/devices/${deviceId}/clients`, label: 'devices-API: /clients' },
    { svc: 'devices', path: `${devBase}/devices/${deviceId}/arp`, label: 'devices-API: /arp' },
    { svc: 'devices', path: `${devBase}/devices/${deviceId}/mac-table`, label: 'devices-API: /mac-table' },
    { svc: 'devices', path: `${devBase}/devices/${deviceId}/connected`, label: 'devices-API: /connected' },
  ];

  const results = [];
  for (const c of candidates) {
    try {
      const data = await api(c.svc, c.path);
      const json = JSON.stringify(data);
      const hasData = data && json.length > 30 && json !== 'null' && json !== '{}';
      results.push({ ...c, ok: true, hasData, data });
    } catch (e) {
      results.push({ ...c, ok: false, hasData: false, error: e.message });
    }
  }

  const working = results.filter(r => r.ok && r.hasData);
  let html = '';

  if (working.length) {
    html += `<div style="margin-bottom:8px;font-size:11px;color:var(--green)"><i class="fa-solid fa-circle-check"></i> ${working.length} Endpunkt(e) mit Daten gefunden</div>`;
    working.forEach(r => {
      const json = JSON.stringify(r.data, null, 2);
      const preview = json.length > 1200 ? json.slice(0, 1200) + '…' : json;
      html += `<div style="margin-bottom:10px">
        <div style="font-size:11px;font-weight:700;color:var(--teal);margin-bottom:4px"><i class="fa-solid fa-circle-check"></i> ${escHtml(r.label)}</div>
        <pre style="background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:8px;font-size:10px;color:var(--text2);overflow-x:auto;white-space:pre-wrap;word-break:break-all;max-height:200px;overflow-y:auto;margin:0">${escHtml(preview)}</pre>
      </div>`;
    });
  } else {
    html += `<div style="color:var(--amber);font-size:12px;margin-bottom:8px"><i class="fa-solid fa-triangle-exclamation"></i> Kein Endpunkt hat nutzbare Daten zurückgegeben.</div>`;
  }

  html += `<details style="margin-top:8px"><summary style="font-size:10px;color:var(--text3);cursor:pointer;user-select:none">Alle Ergebnisse (${results.length})</summary>
    <div style="margin-top:6px;display:flex;flex-direction:column;gap:3px">`;
  results.forEach(r => {
    const icon = r.ok && r.hasData ? '✓' : r.ok ? '○' : '✗';
    const color = r.ok && r.hasData ? 'var(--green)' : r.ok ? 'var(--text3)' : 'var(--red)';
    html += `<div style="font-size:10px;color:${color};font-family:monospace">${icon} ${escHtml(r.label)}</div>`;
  });
  html += `</div></details>`;

  area.innerHTML = html;
}

function topoCloseDetail() {
  document.getElementById('topo-detail').style.display = 'none';
}

async function inspectLldpRaw(deviceId) {
  const area = document.getElementById('snmp-result-area') || document.getElementById('mac-table-area');
  if (!area) return;
  area.innerHTML = `<div style="color:var(--text2);font-size:12px;padding:8px 0"><i class="fa-solid fa-circle-notch fa-spin"></i> Lade Rohdaten…</div>`;

  const base = `/accounts/${S.accountId}/records/lan_info_json?group=DEVICE&groupId=${deviceId}&period=MINUTE1&type=json&latest=1`;
  const variants = [
    { label: 'source=NEW, name=interfaces', url: `${base}&source=NEW&name=interfaces` },
    { label: 'source=NEW (kein name)', url: `${base}&source=NEW` },
    { label: 'kein source, name=interfaces', url: `${base}&name=interfaces` },
    { label: 'kein source, kein name', url: `${base}` },
    { label: 'source=NEW, name=lldp', url: `${base}&source=NEW&name=lldp` },
    { label: 'source=NEW, name=switch', url: `${base}&source=NEW&name=switch` },
  ];

  let html = '';
  for (const v of variants) {
    let raw, parsed, err;
    try {
      const r = await fetch('/api', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: S.apiKey, service: 'monitoring', path: v.url }) });
      raw = await r.text();
      parsed = JSON.parse(raw);
    } catch (e) { err = e.message; }

    const isEmpty = !parsed || JSON.stringify(parsed).length < 30;
    const color = err ? 'var(--red)' : isEmpty ? 'var(--text3)' : 'var(--teal)';
    const icon = err ? '✗' : isEmpty ? '○' : '✓';
    const preview = err ? err : (raw?.length > 800 ? raw.slice(0, 800) + '…' : raw) || '(leer)';

    html += `<div style="margin-bottom:10px">
      <div style="font-size:11px;font-weight:700;color:${color};margin-bottom:3px">${icon} ${escHtml(v.label)}</div>
      <pre style="background:var(--bg2);border:1px solid var(--border);border-radius:6px;padding:8px;font-size:9.5px;color:var(--text2);overflow-x:auto;white-space:pre-wrap;word-break:break-all;max-height:180px;overflow-y:auto;margin:0">${escHtml(preview)}</pre>
    </div>`;
  }
  area.innerHTML = html;
}

function topoChangeRoot() {
  topoRootId = document.getElementById('topo-root-select').value;
  renderTopology();
  setTimeout(topoFit, 80);
}

function topoChangeSite(site) {
  topoSiteFilter = site === undefined || site === null ? '' : String(site);
  topoRootId = '';
  renderTopology();
  setTimeout(topoFit, 80);
}

function topoChangeDepth(value) {
  if (value === '' || value === null || value === undefined) {
    topoDepthLimit = null;
  } else {
    const n = parseInt(value, 10);
    topoDepthLimit = Number.isNaN(n) ? null : Math.max(0, n);
  }
  saveTopoDepthLimit();
  syncTopoDepthSelect();
  renderTopology();
  setTimeout(topoFit, 80);
}

function topoToggleFullscreen() {
  const el = document.getElementById('tab-topology');
  if (!document.fullscreenElement) {
    el.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen();
  }
}

document.addEventListener('fullscreenchange', () => {
  const btn = document.getElementById('topo-fs-btn');
  if (!btn) return;
  if (document.fullscreenElement) {
    btn.querySelector('i').className = 'fa-solid fa-compress';
    btn.title = 'Vollbild beenden';
  } else {
    btn.querySelector('i').className = 'fa-solid fa-expand';
    btn.title = 'Vollbild';
  }
});

function topoFit() {
  const g = document.getElementById('topo-g');
  const svg = document.getElementById('topo-svg');
  if (!g || !svg || !g.children.length) return;
  const bbox = g.getBBox();
  if (!bbox || bbox.width === 0) return;
  const rect = svg.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const pad = 80;
  const sx = (rect.width - pad * 2) / bbox.width;
  const sy = (rect.height - pad * 2) / bbox.height;
  topoScale = Math.max(0.55, Math.min(sx, sy, 1.6));
  topoTx = rect.width / 2 - (bbox.x + bbox.width / 2) * topoScale;
  topoTy = rect.height / 2 - (bbox.y + bbox.height / 2) * topoScale;
  updateTopoTransform();
}

function topoZoom(factor) {
  const svg = document.getElementById('topo-svg');
  const r = svg.getBoundingClientRect();
  const cx = r.width / 2, cy = r.height / 2;
  const ns = Math.max(0.15, Math.min(4, topoScale * factor));
  const sf = ns / topoScale;
  topoTx = cx - (cx - topoTx) * sf;
  topoTy = cy - (cy - topoTy) * sf;
  topoScale = ns;
  updateTopoTransform();
}

function updateTopoTransform() {
  document.getElementById('topo-g').setAttribute('transform', `translate(${topoTx.toFixed(2)},${topoTy.toFixed(2)}) scale(${topoScale.toFixed(4)})`);
}

/** SVG-Inhalt für hellen Hintergrund: Kontrast bei Hilfslinien/Text anheben */
function topoSvgInnerForExport(html) {
  return html
    .replace(/stroke="rgba\(255,255,255,\.06\)"/g, 'stroke="rgba(15,23,42,0.14)"')
    .replace(/fill="rgba\(148,163,184,\.35\)"/g, 'fill="rgba(71,85,105,0.88)"');
}

function topoSiteExportLabel() {
  if (topoSiteFilter === '') return 'Ohne Standort';
  return topoSiteFilter || '–';
}

function topoExportFilenameSlug() {
  const raw = topoSiteFilter === '' ? 'ohne-standort' : topoSiteFilter;
  const s = String(raw).replace(/[^\w\-äöüÄÖÜß]+/gi, '-').replace(/^-+|-+$/g, '');
  return (s || 'standort').slice(0, 48);
}

/** SVG → PNG (Data-URL) für PDF-Einbettung */
async function topoSvgToPngDataUrl(svgXml) {
  const blob = new Blob([svgXml], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Topologie-Grafik konnte nicht gerendert werden'));
      i.src = url;
    });
    const natW = img.naturalWidth || img.width || 800;
    const natH = img.naturalHeight || img.height || 600;
    const canvas = document.createElement('canvas');
    const dpr = 2;
    canvas.width = natW * dpr;
    canvas.height = natH * dpr;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(dpr, dpr);
    ctx.drawImage(img, 0, 0);
    const aspect = natH / natW;
    return { dataUrl: canvas.toDataURL('image/png'), aspect };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Alle LLDP-Portzeilen (Monitoring) für Geräte am aktuellen Netzwerkplan-Standort */
function topoLldpRowsForSite() {
  const siteIds = new Set(Object.values(S.devices).filter(d => topoMatchesSite(d)).map(d => d.id));
  return (S.lldpNeighbors || [])
    .filter(p => siteIds.has(p._deviceId))
    .sort((a, b) => {
      const c = (a._deviceName || '').localeCompare(b._deviceName || '', 'de');
      if (c !== 0) return c;
      return (a.portName || '').localeCompare(b.portName || '', 'de');
    });
}

/** LAN-Interface-Tabelle (Monitoring), gefiltert nach Standort */
function topoLldpTableRowsForSite() {
  const siteIds = new Set(Object.values(S.devices).filter(d => topoMatchesSite(d)).map(d => d.id));
  return (S.lldpTable || [])
    .filter(row => siteIds.has(row.deviceId || row._deviceId))
    .sort((a, b) => {
      const na = S.devices[a.deviceId || a._deviceId]?.status?.name || '';
      const nb = S.devices[b.deviceId || b._deviceId]?.status?.name || '';
      const c = na.localeCompare(nb, 'de');
      if (c !== 0) return c;
      return (a.name || '').localeCompare(b.name || '', 'de');
    });
}

function topoFmtSpeedPlain(kbps) {
  if (!kbps || kbps <= 0) return '–';
  if (kbps >= 1e7) return `${(kbps / 1e6).toFixed(0)} Gbit/s`;
  if (kbps >= 1e6) return `${(kbps / 1e6).toFixed(1)} Gbit/s`;
  if (kbps >= 1e3) return `${(kbps / 1e3).toFixed(0)} Mbit/s`;
  return `${kbps} kbit/s`;
}

/** PDF-Datei herunterladen: Topologie als PNG + LLDP-Tabellen (jsPDF) */
async function topoExportPdf() {
  const gEl = document.getElementById('topo-g');
  if (!gEl || !gEl.children.length) {
    toast('info', 'Netzwerkplan leer', 'Kein Inhalt zum Exportieren.');
    return;
  }

  window.setLoading?.(true, 'PDF wird erzeugt…');
  try {
    const bbox = gEl.getBBox();
    const pad = 50;
    const W = Math.ceil(bbox.width + pad * 2);
    const H = Math.ceil(bbox.height + pad * 2);
    const tx = (pad - bbox.x).toFixed(1);
    const ty = (pad - bbox.y).toFixed(1);
    const inner = topoSvgInnerForExport(gEl.innerHTML);

    const svgBlock = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
  <filter id="topo-glow" x="-40%" y="-40%" width="180%" height="180%">
    <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur"/>
    <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
</defs>
<rect width="100%" height="100%" fill="#f8fafc"/>
<g transform="translate(${tx},${ty})">${inner}</g>
</svg>`;

    const { dataUrl, aspect } = await topoSvgToPngDataUrl(svgBlock);

    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 14;
    let y = margin;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(15, 23, 42);
    doc.text('Netzwerkplan', margin, y);
    y += 9;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(71, 85, 105);
    doc.text(`Standort: ${topoSiteExportLabel()} · ${new Date().toLocaleString('de-DE')}`, margin, y);
    y += 11;

    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text('Topologie', margin, y);
    y += 6;

    const maxImgW = pageW - 2 * margin;
    const roomBelow = pageH - y - margin - 6;
    let imgW = maxImgW;
    let imgH = imgW * aspect;
    if (imgH > roomBelow) {
      imgH = roomBelow;
      imgW = imgH / aspect;
    }
    doc.addImage(dataUrl, 'PNG', margin, y, imgW, imgH);
    y += imgH + 10;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(0, 76, 151);
    doc.text('LLDP / Ports (Monitoring)', margin, y);
    y += 5;

    const portRows = topoLldpRowsForSite();
    const portHead = [['Gerät', 'Port', 'Beschreibung', 'LLDP-Nachbarn', 'Aktiv', 'Speed', 'VLAN', 'QoS', 'PoE', 'RX', 'TX', 'Loops']];
    const portBody = portRows.length
      ? portRows.map(p => [
          String(p._deviceName || ''),
          String(p.portName || ''),
          String(p.description || ''),
          (p.lldpNames || []).join(', ') || '–',
          p.active ? 'Ja' : 'Nein',
          topoFmtSpeedPlain(p.speed),
          String(p.vlan ?? '–'),
          p.qosClass !== undefined && p.qosClass !== null ? String(p.qosClass) : '–',
          [p.poeStatus, p.poePower != null && p.poePower !== '' ? `${p.poePower} W` : ''].filter(Boolean).join(', ') || '–',
          fmtRate(p.rxBitPerSec),
          fmtRate(p.txBitPerSec),
          p.loops > 0 ? String(p.loops) : '0',
        ])
      : [['–', '–', '–', 'Keine Daten (Tab „LLDP“ laden)', '–', '–', '–', '–', '–', '–', '–', '–']];

    autoTable(doc, {
      startY: y,
      head: portHead,
      body: portBody,
      styles: { fontSize: 7, cellPadding: 1.2, overflow: 'linebreak', textColor: [15, 23, 42] },
      headStyles: { fillColor: [0, 76, 151], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: margin, right: margin },
      theme: 'striped',
    });

    let nextY = (doc.lastAutoTable && typeof doc.lastAutoTable.finalY === 'number')
      ? doc.lastAutoTable.finalY + 10
      : y + 40;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(0, 76, 151);
    doc.text('Schnittstellen mit LLDP (Konfig-Tabelle)', margin, nextY);
    nextY += 5;

    const ifRows = topoLldpTableRowsForSite();
    const ifHead = [['Gerät', 'Schnittstelle', 'LLDP-Name', 'LLDP-Cap.', 'Aktiv', 'Beschreibung']];
    const ifBody = ifRows.length
      ? ifRows.map(row => {
          const did = row.deviceId || row._deviceId;
          const cap = row.lldpCapabilities ? String(row.lldpCapabilities).slice(0, 40) + (String(row.lldpCapabilities).length > 40 ? '…' : '') : '–';
          return [
            deviceName(S.devices[did]) || String(did || ''),
            String(row.name || '–'),
            String(row.lldpName || '–'),
            cap,
            row.active ? 'Ja' : 'Nein',
            String(row.description || ''),
          ];
        })
      : [['–', '–', '–', '–', '–', 'Keine Daten']];

    autoTable(doc, {
      startY: nextY,
      head: ifHead,
      body: ifBody,
      styles: { fontSize: 7, cellPadding: 1.2, overflow: 'linebreak', textColor: [15, 23, 42] },
      headStyles: { fillColor: [0, 76, 151], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: margin, right: margin },
      theme: 'striped',
    });

    const fname = `netzwerkplan-${topoExportFilenameSlug()}-${new Date().toISOString().slice(0, 10)}.pdf`;
    doc.save(fname);
    toast('success', 'PDF heruntergeladen', fname);
  } catch (e) {
    console.error(e);
    toast('error', 'PDF fehlgeschlagen', e?.message || String(e));
  } finally {
    window.setLoading?.(false);
  }
}

function initTopoEvents() {
  const svg = document.getElementById('topo-svg');
  // Wheel zoom
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const r = svg.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const ns = Math.max(0.15, Math.min(4, topoScale * factor));
    const sf = ns / topoScale;
    topoTx = mx - (mx - topoTx) * sf;
    topoTy = my - (my - topoTy) * sf;
    topoScale = ns;
    updateTopoTransform();
  }, { passive: false });
  // Drag pan + node drag
  svg.addEventListener('mousedown', e => {
    const nodeEl = e.target.closest('.topo-node[data-nid]');
    if (nodeEl) {
      e.preventDefault(); e.stopPropagation();
      _nodeDrag = {
        el: nodeEl, id: nodeEl.dataset.nid,
        ox: parseFloat(nodeEl.dataset.x), oy: parseFloat(nodeEl.dataset.y),
        sx: e.clientX, sy: e.clientY,
      };
      nodeEl.style.cursor = 'grabbing';
      return;
    }
    topoDrag.active = true; topoDrag.sx = e.clientX; topoDrag.sy = e.clientY;
    topoDrag.tx = topoTx; topoDrag.ty = topoTy;
    svg.style.cursor = 'grabbing';
  });
  window.addEventListener('mousemove', e => {
    if (_nodeDrag) {
      const dx = (e.clientX - _nodeDrag.sx) / topoScale;
      const dy = (e.clientY - _nodeDrag.sy) / topoScale;
      _nodeDrag.el.setAttribute('transform', `translate(${dx},${dy})`);
      return;
    }
    if (!topoDrag.active) return;
    topoTx = topoDrag.tx + (e.clientX - topoDrag.sx);
    topoTy = topoDrag.ty + (e.clientY - topoDrag.sy);
    updateTopoTransform();
  });
  window.addEventListener('mouseup', e => {
    if (_nodeDrag) {
      const dx = (e.clientX - _nodeDrag.sx) / topoScale;
      const dy = (e.clientY - _nodeDrag.sy) / topoScale;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        topoCustomPos[_nodeDrag.id] = { x: _nodeDrag.ox + dx, y: _nodeDrag.oy + dy };
        saveTopoPos();
        renderTopology();
      } else {
        _nodeDrag.el.removeAttribute('transform');
      }
      _nodeDrag = null;
      return;
    }
    if (topoDrag.active) { topoDrag.active = false; document.getElementById('topo-svg').style.cursor = 'grab'; }
  });
  syncTopoFilterCheckboxes();
}

function resetTopoState() { topoRootId = ''; topoSiteFilter = ''; topoTx = 0; topoTy = 0; topoScale = 1; }

export {
  buildTopoSelector, buildTopoGraph, layoutTopo, renderTopology,
  topoSetRoot, topoOpenDetail, topoCloseDetail, topoChangeRoot, topoChangeSite, topoChangeDepth, topoToggleFullscreen,
  topoFit, topoZoom, topoResetPositions, topoExportPdf,
  initTopoEvents, updateTopoTransform,
  loadSnmpMacTable, loadMacTable, inspectLldpRaw,
  resetTopoState,
  topoSetHideAp, topoSetHideOffline, topoSetHideUnconnected, topoSetHideGhost,
};
