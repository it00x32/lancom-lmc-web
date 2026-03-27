import S from '../lib/state.js';
import { api } from '../lib/api.js';
import { escHtml, deviceName } from '../lib/helpers.js';

let dlData = [];
let dlLoading = false;
let dlSearch = '';

async function loadDhcpLeases() {
  if (dlLoading) return;
  dlLoading = true;
  S._loaded.add('dhcp-leases');

  const icon = document.getElementById('dl-refresh-icon');
  if (icon) icon.classList.add('fa-spin');
  dlData = [];

  const from = new Date(Date.now() - 120000).toISOString();
  const ids = Object.keys(S.devices);

  const batches = [];
  for (let i = 0; i < ids.length; i += 8) batches.push(ids.slice(i, i + 8));

  for (const batch of batches) {
    const results = await Promise.allSettled(batch.map(id =>
      api('monitor-frontend', `/api/${S.accountId}/tables/dhcp-lease?from=${from}&deviceId=${id}&column=deviceId&column=timeMs&column=hostname&column=ipAddress&column=macAddress&sort=timeMs&order=desc&limit=200`)
    ));
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value?.data) dlData.push(...r.value.data);
    }
  }

  // Deduplicate: keep latest entry per (deviceId + macAddress)
  const seen = new Map();
  for (const row of dlData) {
    const key = `${row.deviceId}:${row.macAddress}`;
    const existing = seen.get(key);
    if (!existing || row.timeMs > existing.timeMs) seen.set(key, row);
  }
  dlData = [...seen.values()].sort((a, b) => (a.ipAddress || '').localeCompare(b.ipAddress || '', undefined, { numeric: true }));

  dlLoading = false;
  if (icon) icon.classList.remove('fa-spin');
  renderDhcpLeases();
}

function setDlSearch(v) {
  dlSearch = (v || '').toLowerCase().trim();
  renderDhcpLeases();
}

function exportDhcpCsv() {
  const rows = getFiltered();
  let csv = 'Gerät;Hostname;IP;MAC;Zeitpunkt\n';
  for (const r of rows) {
    const dev = S.devices[r.deviceId];
    csv += `${deviceName(dev)};${r.hostname || '–'};${r.ipAddress || '–'};${r.macAddress || '–'};${new Date(r.timeMs).toLocaleString('de-DE')}\n`;
  }
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `dhcp-leases-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

function getFiltered() {
  if (!dlSearch) return dlData;
  return dlData.filter(r => {
    const dev = S.devices[r.deviceId];
    const haystack = [r.hostname, r.ipAddress, r.macAddress, deviceName(dev)].join(' ').toLowerCase();
    return haystack.includes(dlSearch);
  });
}

function renderDhcpLeases() {
  const wrap = document.getElementById('dl-wrap');
  if (!wrap) return;

  if (!dlData.length) {
    wrap.innerHTML = '<div class="empty-state"><i class="fa-solid fa-network-wired"></i><h3>Keine DHCP-Leases</h3><p>Keine aktiven DHCP-Leases gefunden.</p></div>';
    return;
  }

  const filtered = getFiltered();

  // Stats
  const uniqueIps = new Set(dlData.map(r => r.ipAddress));
  const uniqueMacs = new Set(dlData.map(r => r.macAddress));
  const uniqueDevices = new Set(dlData.map(r => r.deviceId));

  // Detect duplicate IPs
  const ipCounts = {};
  dlData.forEach(r => { if (r.ipAddress) ipCounts[r.ipAddress] = (ipCounts[r.ipAddress] || 0) + 1; });
  const duplicateIps = Object.entries(ipCounts).filter(([, c]) => c > 1);

  let html = `<div class="dl-stats">
    <div class="dl-stat"><div class="dl-stat-icon" style="background:rgba(0,76,151,.15);color:var(--blue)"><i class="fa-solid fa-network-wired"></i></div><div><div class="dl-stat-val">${dlData.length}</div><div class="dl-stat-lbl">Leases</div></div></div>
    <div class="dl-stat"><div class="dl-stat-icon" style="background:rgba(52,217,123,.15);color:var(--green)"><i class="fa-solid fa-laptop"></i></div><div><div class="dl-stat-val">${uniqueMacs.size}</div><div class="dl-stat-lbl">Clients</div></div></div>
    <div class="dl-stat"><div class="dl-stat-icon" style="background:rgba(139,92,246,.15);color:var(--purple)"><i class="fa-solid fa-hashtag"></i></div><div><div class="dl-stat-val">${uniqueIps.size}</div><div class="dl-stat-lbl">IPs</div></div></div>
    <div class="dl-stat"><div class="dl-stat-icon" style="background:rgba(251,191,36,.15);color:var(--amber)"><i class="fa-solid fa-server"></i></div><div><div class="dl-stat-val">${uniqueDevices.size}</div><div class="dl-stat-lbl">DHCP-Server</div></div></div>
    ${duplicateIps.length ? `<div class="dl-stat"><div class="dl-stat-icon" style="background:rgba(240,85,104,.15);color:var(--red)"><i class="fa-solid fa-triangle-exclamation"></i></div><div><div class="dl-stat-val">${duplicateIps.length}</div><div class="dl-stat-lbl">Doppelte IPs</div></div></div>` : ''}
  </div>`;

  if (duplicateIps.length) {
    html += `<div class="dl-section"><div class="dl-section-title" style="color:var(--red)"><i class="fa-solid fa-triangle-exclamation"></i> Doppelte IP-Adressen</div><div class="dl-dup-list">`;
    for (const [ip, count] of duplicateIps.slice(0, 10)) {
      const entries = dlData.filter(r => r.ipAddress === ip);
      html += `<div class="dl-dup"><span class="dl-dup-ip">${escHtml(ip)}</span><span class="dl-dup-count">${count}×</span><span class="dl-dup-macs">${entries.map(e => escHtml(e.hostname || e.macAddress)).join(', ')}</span></div>`;
    }
    html += `</div></div>`;
  }

  // Table
  html += `<div class="dl-section"><div class="dl-section-title"><i class="fa-solid fa-table"></i> Alle Leases (${filtered.length}${dlSearch ? ` von ${dlData.length}` : ''})</div>`;
  html += `<div class="dl-table-wrap"><table class="dl-table"><thead><tr>
    <th>Gerät</th><th>Hostname</th><th>IP-Adresse</th><th>MAC-Adresse</th><th>Zeitpunkt</th>
  </tr></thead><tbody>`;

  for (const r of filtered) {
    const dev = S.devices[r.deviceId];
    const isDup = (ipCounts[r.ipAddress] || 0) > 1;
    const time = new Date(r.timeMs).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    html += `<tr${isDup ? ' class="dl-row-dup"' : ''}>
      <td class="dl-td-dev">${escHtml(deviceName(dev))}</td>
      <td>${escHtml(r.hostname || '–')}</td>
      <td class="dl-td-mono">${escHtml(r.ipAddress || '–')}${isDup ? ' <i class="fa-solid fa-triangle-exclamation" style="color:var(--red);font-size:10px" title="Doppelte IP"></i>' : ''}</td>
      <td class="dl-td-mono">${escHtml(r.macAddress || '–')}</td>
      <td class="dl-td-time">${time}</td>
    </tr>`;
  }

  html += `</tbody></table></div></div>`;
  wrap.innerHTML = html;
}

function resetDlState() { dlData = []; dlLoading = false; dlSearch = ''; }

export { loadDhcpLeases, renderDhcpLeases, setDlSearch, exportDhcpCsv, resetDlState };
