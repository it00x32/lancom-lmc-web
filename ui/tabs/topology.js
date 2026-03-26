import S from '../lib/state.js';
import { escHtml, deviceName, isOnline, statusDot, fmtRate, fmtBytes, signalBar, bandBadge } from '../lib/helpers.js';
import { api, toast } from '../lib/api.js';
import { snmpReqBody } from '../lib/snmp.js';
import { fmtSpeed, poeCell } from './lldp.js';

// ─── NETWORK TOPOLOGY ─────────────────────────────────────────────────────────
let topoTx = 0, topoTy = 0, topoScale = 1, topoRootId = '', topoSiteFilter = '';
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
  Object.values(S.devices).forEach(d => {
    [d.status?.name, d.label, d.name, topoDevName(d)].filter(Boolean).forEach(n => {
      if (n && n !== '–') nameToId[n.toLowerCase()] = d.id;
    });
    if (d.status?.ip) ipToId[d.status.ip] = d.id;
    if (d.status?.mac) macToId[d.status.mac.toLowerCase()] = d.id;
  });

  function resolveName(lldpName) {
    if (!lldpName) return null;
    const lc = lldpName.toLowerCase();
    if (nameToId[lc]) return nameToId[lc];
    if (macToId[lc]) return macToId[lc];
    // partial match: LLDP name might contain the device name or vice versa
    for (const [n, id] of Object.entries(nameToId)) {
      if (n.length > 3 && (lc.includes(n) || n.includes(lc))) return id;
    }
    return null;
  }

  // Nodes: devices of selected site (or all)
  const nodes = {};
  Object.values(S.devices).forEach(d => {
    if (topoSiteFilter && (d.siteName || '') !== topoSiteFilter) return;
    nodes[d.id] = {
      id: d.id,
      name: topoDevName(d),
      model: d.status?.model || '',
      siteName: d.siteName || '',
      online: isOnline(d),
      hasAlert: !!d.alerting?.hasAlert,
      isSwitch: false,
      wlanClients: S.wlanClients[d.id] || 0,
    };
  });

  const edgeMap = {};
  function addEdge(fromId, toId, portName, bps) {
    if (!fromId || !toId || fromId === toId) return;
    if (!nodes[fromId] || !nodes[toId]) return;
    const key = [fromId, toId].sort().join('|');
    if (!edgeMap[key]) edgeMap[key] = { from: fromId, to: toId, ports: {}, maxBps: 0 };
    if (portName) {
      if (!edgeMap[key].ports[fromId]) edgeMap[key].ports[fromId] = [];
      if (!edgeMap[key].ports[fromId].includes(portName))
        edgeMap[key].ports[fromId].push(portName);
    }
    if (bps > edgeMap[key].maxBps) edgeMap[key].maxBps = bps;
  }

  // 1) Edges from LLDP port data
  S.lldpNeighbors.forEach(port => {
    const fromId = port._deviceId;
    if (!nodes[fromId]) return;
    nodes[fromId].isSwitch = true;
    port.lldpNames.forEach(lldpName => {
      let toId = resolveName(lldpName);
      if (toId === fromId) return;
      if (!toId) {
        toId = 'ghost:' + lldpName;
        if (!nodes[toId]) nodes[toId] = {
          id: toId, name: lldpName, model: '', siteName: '',
          online: false, hasAlert: false, isSwitch: false, wlanClients: 0, isGhost: true,
        };
      }
      addEdge(fromId, toId, port.portName, (port.rxBitPerSec || 0) + (port.txBitPerSec || 0));
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
    addEdge(fromId, toId, row.name || '', 0);
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

  // Populate site selector
  const siteSel = document.getElementById('topo-site-select');
  const prevSite = siteSel.value || topoSiteFilter;
  const sites = [...new Set(allDevices.map(d => d.siteName || '').filter(Boolean))].sort();
  siteSel.innerHTML = `<option value="">Alle Standorte</option>` + sites.map(s => `<option value="${escHtml(s)}"${s === topoSiteFilter ? ' selected' : ''}>${escHtml(s)}</option>`).join('');
  if (prevSite && sites.includes(prevSite)) { siteSel.value = prevSite; topoSiteFilter = prevSite; }

  // Filtered device ids
  const ids = allDevices
    .filter(d => !topoSiteFilter || (d.siteName || '') === topoSiteFilter)
    .map(d => d.id);
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
  const ids = Object.values(S.devices)
    .filter(d => !topoSiteFilter || (d.siteName || '') === topoSiteFilter)
    .map(d => d.id);
  const empty = document.getElementById('topo-empty');
  const gEl = document.getElementById('topo-g');
  if (!ids.length) { empty.style.display = 'flex'; gEl.innerHTML = ''; return; }
  empty.style.display = 'none';

  buildTopoSelector();
  const rootId = document.getElementById('topo-root-select').value || topoRootId || ids[0];
  topoRootId = rootId;

  const { nodes, edges } = buildTopoGraph();
  const { pos, level, unconnected, maxLvl } = layoutTopo(nodes, edges, rootId);

  let svg = '';

  // Separator line for unconnected nodes
  if (unconnected.length) {
    const uy = unconnected.map(id => pos[id].y).reduce((a, b) => Math.min(a, b), Infinity);
    const xs = unconnected.map(id => pos[id].x);
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

    // ── Managed node ──────────────────────────────────────────────────────
    const borderColor = node.hasAlert ? 'rgba(217,119,6,.75)' : node.online ? 'rgba(26,138,62,.55)' : 'rgba(211,47,47,.4)';
    const dotColor = node.hasAlert ? '#d97706' : node.online ? '#1a8a3e' : '#d32f2f';
    const bgFill = node.hasAlert ? 'rgba(217,119,6,.06)' : node.online ? 'rgba(26,138,62,.05)' : 'rgba(211,47,47,.04)';
    const filter = isRoot ? 'filter="url(#topo-glow)"' : '';

    const dname = node.name.length > 21 ? node.name.slice(0, 20) + '…' : node.name;
    const dsub = (node.model || node.siteName);
    const dsubT = dsub.length > 24 ? dsub.slice(0, 23) + '…' : dsub;

    const typeLabel = node.isSwitch ? 'SW' : node.wlanClients > 0 ? 'AP' : 'GW';
    const typeBg = 'rgba(0,76,151,.12)';
    const typeColor = '#004c97';

    const nodeText = 'rgba(15,23,42,.92)';
    const nodeSub = 'rgba(71,85,105,.75)';

    svg += `<g class="topo-node" data-nid="${id}" data-x="${x}" data-y="${y}" onclick="topoOpenDetail('${id}')" ${filter}>
      <rect class="topo-node-rect" x="${rx}" y="${ry}" width="${NW}" height="${NH}" rx="10"
        fill="${bgFill}" stroke="${borderColor}" stroke-width="${isRoot ? 2.5 : 1.5}"/>
      ${isRoot ? `<rect x="${rx - 2}" y="${ry - 2}" width="${NW + 4}" height="${NH + 4}" rx="12" fill="none" stroke="${borderColor}" stroke-width="0.5" opacity="0.4"/>` : ''}
      <circle cx="${rx + 16}" cy="${y}" r="5" fill="${dotColor}"${node.online && !node.hasAlert ? ' filter="url(#topo-glow)"' : ''}/>
      <rect x="${rx + NW - 36}" y="${ry + 6}" width="28" height="16" rx="4" fill="${typeBg}"/>
      <text x="${rx + NW - 22}" y="${ry + 17}" text-anchor="middle" font-size="9" font-weight="800" fill="${typeColor}" font-family="'DM Sans',sans-serif">${typeLabel}</text>
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
  topoSiteFilter = site;
  topoRootId = '';
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

function topoExportSvg() {
  const gEl = document.getElementById('topo-g');
  if (!gEl || !gEl.children.length) { toast('info', 'Netzwerkplan leer', 'Kein Inhalt zum Exportieren.'); return; }
  const bbox = gEl.getBBox();
  const pad = 50;
  const W = Math.ceil(bbox.width + pad * 2);
  const H = Math.ceil(bbox.height + pad * 2);
  const tx = (pad - bbox.x).toFixed(1);
  const ty = (pad - bbox.y).toFixed(1);
  const svgStr = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="100%" height="100%" fill="#07091a"/>
<defs>
  <filter id="topo-glow" x="-40%" y="-40%" width="180%" height="180%">
    <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur"/>
    <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
</defs>
<g transform="translate(${tx},${ty})">${gEl.innerHTML}</g>
</svg>`;
  const blob = new Blob([svgStr], { type: 'image/svg+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'netzwerkplan.svg';
  a.click();
  URL.revokeObjectURL(a.href);
  toast('success', 'SVG exportiert', 'Netzwerkplan als SVG gespeichert.');
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
}

function resetTopoState() { topoRootId = ''; topoSiteFilter = ''; topoTx = 0; topoTy = 0; topoScale = 1; }

export {
  buildTopoSelector, buildTopoGraph, layoutTopo, renderTopology,
  topoSetRoot, topoOpenDetail, topoCloseDetail, topoChangeRoot, topoChangeSite, topoToggleFullscreen,
  topoFit, topoZoom, topoResetPositions, topoExportSvg,
  initTopoEvents, updateTopoTransform,
  loadSnmpMacTable, loadMacTable, inspectLldpRaw,
  resetTopoState,
};
