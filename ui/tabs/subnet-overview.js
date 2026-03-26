import S from '../lib/state.js';
import { api } from '../lib/api.js';
import { escHtml } from '../lib/helpers.js';

let snData = null;
let snLoading = false;

async function loadSubnetOverview() {
  if (snLoading) return;
  snLoading = true;
  S._loaded.add('subnet-overview');

  const icon = document.getElementById('sn-refresh-icon');
  if (icon) icon.classList.add('fa-spin');

  try {
    snData = await api('config', `/configsubnet/accounts/${S.accountId}/subnets`);
    if (!Array.isArray(snData)) snData = [];
  } catch (e) {
    console.warn('[SubnetOverview]', e);
    snData = [];
  }

  snLoading = false;
  if (icon) icon.classList.remove('fa-spin');
  renderSubnetOverview();
}

function ipToNum(ip) {
  return ip.split('.').reduce((acc, o) => (acc << 8) + parseInt(o), 0) >>> 0;
}

function renderSubnetOverview() {
  const wrap = document.getElementById('sn-wrap');
  if (!wrap) return;

  if (!snData || !snData.length) {
    wrap.innerHTML = '<div class="empty-state"><i class="fa-solid fa-network-wired"></i><h3>Keine Subnetze</h3><p>Keine konfigurierten Subnetze gefunden.</p></div>';
    return;
  }

  const groups = {};
  snData.forEach(s => { const g = s.subnetGroupId || 'none'; if (!groups[g]) groups[g] = []; groups[g].push(s); });

  const centralCount = snData.filter(s => s.central).length;
  const dhcpCount = snData.filter(s => s.dhcpServer).length;
  const enabledCount = snData.filter(s => s.enabled).length;

  let html = `<div class="sn-stats">
    <div class="sn-stat"><div class="sn-stat-icon" style="background:rgba(0,76,151,.15);color:var(--blue)"><i class="fa-solid fa-network-wired"></i></div><div><div class="sn-stat-val">${snData.length}</div><div class="sn-stat-lbl">Subnetze</div></div></div>
    <div class="sn-stat"><div class="sn-stat-icon" style="background:rgba(52,217,123,.15);color:var(--green)"><i class="fa-solid fa-check"></i></div><div><div class="sn-stat-val">${enabledCount}</div><div class="sn-stat-lbl">Aktiv</div></div></div>
    <div class="sn-stat"><div class="sn-stat-icon" style="background:rgba(251,191,36,.15);color:var(--amber)"><i class="fa-solid fa-server"></i></div><div><div class="sn-stat-val">${dhcpCount}</div><div class="sn-stat-lbl">DHCP aktiv</div></div></div>
    <div class="sn-stat"><div class="sn-stat-icon" style="background:rgba(139,92,246,.15);color:var(--purple)"><i class="fa-solid fa-star"></i></div><div><div class="sn-stat-val">${centralCount}</div><div class="sn-stat-lbl">Zentral</div></div></div>
    <div class="sn-stat"><div class="sn-stat-icon" style="background:rgba(0,76,151,.1);color:var(--text3)"><i class="fa-solid fa-layer-group"></i></div><div><div class="sn-stat-val">${Object.keys(groups).length}</div><div class="sn-stat-lbl">Gruppen</div></div></div>
  </div><div class="sn-grid">`;

  for (const subnet of snData.sort((a, b) => (a.netAbsolute || '').localeCompare(b.netAbsolute || ''))) {
    const net = subnet.netAbsolute || '?';
    const prefix = (net.split('/')[1]) || '?';
    const hostBits = 32 - parseInt(prefix);
    const totalIps = Math.pow(2, hostBits);
    let dhcpSize = 0;
    if (subnet.dhcpRangeStartAbsolute && subnet.dhcpRangeEndAbsolute) {
      dhcpSize = ipToNum(subnet.dhcpRangeEndAbsolute) - ipToNum(subnet.dhcpRangeStartAbsolute) + 1;
    }
    const dhcpPct = totalIps > 0 ? Math.min(100, Math.round(dhcpSize / totalIps * 100)) : 0;
    const range = subnet.dhcpServer ? `${subnet.dhcpRangeStartAbsolute || '?'} – ${subnet.dhcpRangeEndAbsolute || '?'}` : '';

    html += `<div class="sn-card${!subnet.enabled ? ' sn-card-disabled' : ''}">
      <div class="sn-card-head">
        <span class="sn-net-badge">${escHtml(net)}</span>
        ${subnet.central ? '<span class="sn-central-badge">Zentral</span>' : ''}
        ${!subnet.enabled ? '<span class="sn-disabled-badge">Deaktiviert</span>' : ''}
      </div>
      <div class="sn-card-body">
        <div class="sn-row"><span class="sn-label">IPs</span><span class="sn-value">${totalIps} (/${prefix})</span></div>
        <div class="sn-row"><span class="sn-label">DHCP</span><span class="sn-value">${subnet.dhcpServer ? `<span style="color:var(--green)">Aktiv</span> · ${subnet.dhcpMode || '?'}` : '<span style="color:var(--text3)">Aus</span>'}</span></div>
        ${range ? `<div class="sn-row"><span class="sn-label">Range</span><span class="sn-value" style="font-family:var(--mono);font-size:11px">${escHtml(range)}</span></div>` : ''}
        ${subnet.dhcpServer ? `<div class="sn-row"><span class="sn-label">Pool</span><div style="flex:1;display:flex;align-items:center;gap:8px"><div class="sn-bar-wrap"><div class="sn-bar" style="width:${dhcpPct}%"></div></div><span class="sn-value">${dhcpSize} IPs (${dhcpPct}%)</span></div></div>` : ''}
        <div class="sn-row"><span class="sn-label">Gateway</span><span class="sn-value">${(subnet.gatewayIds || []).join(', ') || '–'}</span></div>
      </div>
    </div>`;
  }
  html += `</div>`;
  wrap.innerHTML = html;
}

function resetSnState() { snData = null; snLoading = false; }

export { loadSubnetOverview, renderSubnetOverview, resetSnState };
