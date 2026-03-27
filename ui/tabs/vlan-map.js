import S from '../lib/state.js';
import { api } from '../lib/api.js';
import { escHtml } from '../lib/helpers.js';

let vmData = null;
let vmLoading = false;

async function loadVlanMap() {
  if (vmLoading) return;
  vmLoading = true;
  S._loaded.add('vlan-map');

  const icon = document.getElementById('vm-refresh-icon');
  if (icon) icon.classList.add('fa-spin');

  try {
    vmData = await api('config', `/confignetwork/accounts/${S.accountId}/networks`);
    if (!Array.isArray(vmData)) vmData = [];
  } catch (e) {
    console.warn('[VlanMap]', e);
    vmData = [];
  }

  vmLoading = false;
  if (icon) icon.classList.remove('fa-spin');
  renderVlanMap();
}

function renderVlanMap() {
  const wrap = document.getElementById('vm-wrap');
  if (!wrap) return;

  if (!vmData || !vmData.length) {
    wrap.innerHTML = '<div class="empty-state"><i class="fa-solid fa-network-wired"></i><h3>Keine Netzwerke</h3><p>Keine konfigurierten Netzwerke gefunden.</p></div>';
    return;
  }

  const withVlan = vmData.filter(n => n.data?.vlan != null);
  const withDhcp = vmData.filter(n => n.presetDhcpServer);
  const withVpn = vmData.filter(n => n.data?.vpn);
  const withL7 = vmData.filter(n => n.layer7Detection);

  let html = `<div class="vm-stats">
    <div class="vm-stat"><div class="vm-stat-icon" style="background:rgba(0,76,151,.15);color:var(--blue)"><i class="fa-solid fa-network-wired"></i></div><div><div class="vm-stat-val">${vmData.length}</div><div class="vm-stat-lbl">Netzwerke</div></div></div>
    <div class="vm-stat"><div class="vm-stat-icon" style="background:rgba(139,92,246,.15);color:var(--purple)"><i class="fa-solid fa-tags"></i></div><div><div class="vm-stat-val">${withVlan.length}</div><div class="vm-stat-lbl">Mit VLAN-Tag</div></div></div>
    <div class="vm-stat"><div class="vm-stat-icon" style="background:rgba(52,217,123,.15);color:var(--green)"><i class="fa-solid fa-server"></i></div><div><div class="vm-stat-val">${withDhcp.length}</div><div class="vm-stat-lbl">DHCP aktiv</div></div></div>
    <div class="vm-stat"><div class="vm-stat-icon" style="background:rgba(251,191,36,.15);color:var(--amber)"><i class="fa-solid fa-shield-halved"></i></div><div><div class="vm-stat-val">${withVpn.length}</div><div class="vm-stat-lbl">VPN</div></div></div>
    <div class="vm-stat"><div class="vm-stat-icon" style="background:rgba(77,166,255,.15);color:var(--accent)"><i class="fa-solid fa-eye"></i></div><div><div class="vm-stat-val">${withL7.length}</div><div class="vm-stat-lbl">Layer-7</div></div></div>
  </div>`;

  // Visual VLAN map
  html += `<div class="vm-section"><div class="vm-section-title"><i class="fa-solid fa-diagram-project"></i> VLAN-Karte</div><div class="vm-grid">`;

  const sorted = [...vmData].sort((a, b) => (a.data?.vlan || 0) - (b.data?.vlan || 0));
  for (const net of sorted) {
    const d = net.data || {};
    const vlan = d.vlan != null ? d.vlan : '–';
    const color = net.frontendData || '#4da6ff';
    const enabled = d.enabled !== false;
    const internet = d.internet || '–';

    const badges = [];
    if (net.presetDhcpServer) badges.push({ label: 'DHCP', color: 'var(--green)' });
    if (d.vpn) badges.push({ label: 'VPN', color: 'var(--amber)' });
    if (net.layer7Detection) badges.push({ label: 'L7', color: 'var(--accent)' });
    if (net.layer7UserTracking) badges.push({ label: 'Tracking', color: 'var(--purple)' });
    if (net.offerHotspot) badges.push({ label: 'Hotspot', color: 'var(--red)' });
    if (net.dns?.active) badges.push({ label: 'DNS', color: 'var(--teal)' });

    html += `<div class="vm-card${!enabled ? ' vm-card-disabled' : ''}" style="border-top:3px solid ${color}">
      <div class="vm-card-head">
        <span class="vm-vlan-tag" style="background:${color};color:#fff">${vlan}</span>
        <span class="vm-card-name">${escHtml(net.name)}</span>
        ${!enabled ? '<span class="vm-disabled-badge">Aus</span>' : ''}
      </div>
      <div class="vm-card-body">
        <div class="vm-row"><span class="vm-label">Internet</span><span class="vm-value">${escHtml(internet)}</span></div>
        <div class="vm-row"><span class="vm-label">Subnet-Größe</span><span class="vm-value">/${net.presetSubnetSize || '?'}</span></div>
        <div class="vm-row"><span class="vm-label">DHCP-Modus</span><span class="vm-value">${net.presetDhcpServer ? escHtml(net.presetDhcpMode || '?') : '<span style="color:var(--text3)">Aus</span>'}</span></div>
        <div class="vm-row"><span class="vm-label">Subnetze</span><span class="vm-value">${net.subnetCount || 0}</span></div>
        ${net.routings?.length ? `<div class="vm-row"><span class="vm-label">Routing</span><span class="vm-value">${net.routings.length} Regeln</span></div>` : ''}
      </div>
      ${badges.length ? `<div class="vm-badges">${badges.map(b => `<span class="vm-badge" style="color:${b.color};border-color:${b.color}">${b.label}</span>`).join('')}</div>` : ''}
    </div>`;
  }
  html += `</div></div>`;

  // Detail table
  html += `<div class="vm-section"><div class="vm-section-title"><i class="fa-solid fa-table"></i> Details</div>`;
  html += `<div class="dl-table-wrap"><table class="dl-table"><thead><tr>
    <th>Name</th><th>VLAN</th><th>Internet</th><th>Subnet</th><th>DHCP</th><th>VPN</th><th>Layer-7</th><th>DNS</th><th>Subnetze</th>
  </tr></thead><tbody>`;
  for (const net of sorted) {
    const d = net.data || {};
    const color = net.frontendData || '#4da6ff';
    html += `<tr>
      <td><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color};margin-right:6px"></span>${escHtml(net.name)}</td>
      <td style="font-weight:700">${d.vlan != null ? d.vlan : '–'}</td>
      <td>${escHtml(d.internet || '–')}</td>
      <td>/${net.presetSubnetSize || '?'}</td>
      <td>${net.presetDhcpServer ? `<span style="color:var(--green)">✓</span> ${escHtml(net.presetDhcpMode || '')}` : '<span style="color:var(--text3)">–</span>'}</td>
      <td>${d.vpn ? '<span style="color:var(--amber)">✓</span>' : '–'}</td>
      <td>${net.layer7Detection ? `<span style="color:var(--accent)">✓</span> ${net.layer7DetectionMode || ''}` : '–'}</td>
      <td>${net.dns?.active ? '<span style="color:var(--teal)">✓</span>' : '–'}</td>
      <td>${net.subnetCount || 0}</td>
    </tr>`;
  }
  html += `</tbody></table></div></div>`;

  wrap.innerHTML = html;
}

function resetVmState() { vmData = null; vmLoading = false; }

export { loadVlanMap, renderVlanMap, resetVmState };
