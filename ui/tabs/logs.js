import S from '../lib/state.js';
import { escHtml, deviceName, sevName, sevClass } from '../lib/helpers.js';
import { api, toast } from '../lib/api.js';

// ─── DEVICE LOG MODAL ─────────────────────────────────────────────────────────
let logState = { deviceId:'', deviceName:'', allLogs:[], nextOffset:null, sevFilter:'all', source:'device' };

const sevLabel = sevName;

// Normalize log entries from different sources into { _time, _sev, _msg }
function normalizeLogs(logs, source) {
  return logs.map(l => {
    const time = l.timestamp || l.createdAt || l.time || l.date || '';
    const sev  = l.severity ?? l.level ?? l.priority ?? 6;
    const msg  = l.message || l.rawMessage || l.text || l.description || l.msg || '';
    return { ...l, _time: time, _sev: sev, _msg: msg };
  });
}

async function openLogModal(deviceId, deviceName) {
  logState = { deviceId, deviceName, allLogs:[], nextOffset:null, sevFilter:'all', source:'device' };
  // Reset source tabs
  document.getElementById('log-src-device')?.classList.add('active');
  document.getElementById('log-src-siem')?.classList.remove('active');
  document.getElementById('log-modal-title').textContent = deviceName + ' – Gerätelog';
  document.getElementById('log-modal-sub').textContent = '';
  document.getElementById('log-tbody').innerHTML = '<tr><td colspan="3" class="log-empty"><i class="fa-solid fa-circle-notch fa-spin"></i> Lade…</td></tr>';
  document.getElementById('log-empty').style.display = 'none';
  document.getElementById('log-search-input').value = '';
  document.getElementById('log-count-info').textContent = 'Lade…';
  document.getElementById('log-load-more').disabled = true;
  // Reset severity filter
  document.querySelectorAll('.log-filter-btn').forEach((b,i) => b.classList.toggle('active', i===0));
  document.getElementById('log-modal').style.display = 'flex';
  await loadMoreLogs(true);
}

function closeLogModal() {
  document.getElementById('log-modal').style.display = 'none';
}

async function setLogSource(src, btn) {
  if(logState.source === src) return;
  logState.source = src;
  logState.allLogs = [];
  logState.nextOffset = null;
  document.querySelectorAll('.log-source-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const title = src === 'device'
    ? logState.deviceName + ' – Gerätelog'
    : logState.deviceName + ' – SIEM';
  document.getElementById('log-modal-title').textContent = title;
  document.getElementById('log-modal-sub').textContent = '';
  document.getElementById('log-search-input').value = '';
  document.getElementById('log-count-info').textContent = 'Lade…';
  document.getElementById('log-load-more').disabled = true;
  document.getElementById('log-tbody').innerHTML = '<tr><td colspan="3" class="log-empty"><i class="fa-solid fa-circle-notch fa-spin"></i> Lade…</td></tr>';
  document.getElementById('log-empty').style.display = 'none';
  await loadMoreLogs(true);
}

function setLogSevFilter(f, btn) {
  logState.sevFilter = f;
  document.querySelectorAll('.log-filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderLogTable();
}

async function loadMoreLogs(initial=false) {
  const btn = document.getElementById('log-load-more');
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Lade…';
  try {
    let rawLogs = [];
    let hasMore  = false;

    if(logState.source === 'device') {
      // cloud-service-logging — per-device paginated endpoint
      let url = `/accounts/${S.accountId}/logs/devices/${logState.deviceId}/paginated?lang=DE&limit=50`;
      if(!initial && logState.nextOffset !== null) url += `&offset=${logState.nextOffset}`;
      const data = await api('logging', url);
      // Normalize various response shapes
      rawLogs = data?.items || data?.logs || data?.entries || (Array.isArray(data) ? data : []);
      // Pagination: check common fields
      const next = data?.nextOffset ?? data?.next ?? data?.pagination?.next ?? null;
      logState.nextOffset = next;
      hasMore = next != null && next !== '' && next !== logState.nextOffset;
    } else {
      // cloud-service-siem — account-level, filter by deviceId client-side
      let url = `/accounts/${S.accountId}/logs?limit=100`;
      if(!initial && logState.nextOffset !== null) url += `&offset=${logState.nextOffset}`;
      const data = await api('siem', url);
      rawLogs = (data?.deviceLogs || []).filter(l => l.deviceId === logState.deviceId);
      logState.nextOffset = data?.nextOffset ?? null;
      hasMore = data?.nextOffset != null && data.nextOffset !== data.endOffset;
    }

    const normalized = normalizeLogs(rawLogs, logState.source);
    logState.allLogs.push(...normalized);
    renderLogTable();
    const total = logState.allLogs.length;
    document.getElementById('log-count-info').textContent =
      `${total} Eintr${total===1?'ag':'äge'} geladen`;
    btn.disabled = !hasMore;
    btn.innerHTML = '<i class="fa-solid fa-angles-down"></i> Mehr laden';
  } catch(e) {
    document.getElementById('log-tbody').innerHTML =
      `<tr><td colspan="3" style="padding:20px;color:var(--red);text-align:center"><i class="fa-solid fa-circle-exclamation"></i> Fehler: ${escHtml(e.message)}</td></tr>`;
    btn.innerHTML = '<i class="fa-solid fa-angles-down"></i> Mehr laden';
  }
}

function renderLogTable() {
  const q = document.getElementById('log-search-input').value.toLowerCase();
  const f = logState.sevFilter;
  let rows = logState.allLogs.filter(l => {
    const sev = parseInt(l._sev);
    if(f==='critical' && sev > 2) return false;
    if(f==='warning'  && (sev < 3 || sev > 4)) return false;
    if(f==='info'     && (sev < 5 || sev > 6)) return false;
    if(q && !l._msg.toLowerCase().includes(q)) return false;
    return true;
  });

  const tbody = document.getElementById('log-tbody');
  const empty = document.getElementById('log-empty');
  if(!rows.length) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  // Newest first
  rows = rows.slice().sort((a,b) => new Date(b._time) - new Date(a._time));
  tbody.innerHTML = rows.map(l => {
    const dt = l._time ? new Date(l._time).toLocaleString('de-DE') : '–';
    const sc = sevClass(l._sev);
    const sl = sevLabel(l._sev);
    const msg = escHtml(l._msg || '–');
    return `<tr>
      <td style="white-space:nowrap;color:var(--text3);font-size:11px">${dt}</td>
      <td><span class="log-sev log-sev-${sc}">${sl}</span></td>
      <td class="log-raw">${msg}</td>
    </tr>`;
  }).join('');
  document.getElementById('log-modal-sub').textContent = `${rows.length} angezeigt`;
}

export {
  logState,
  sevClass,
  sevLabel,
  openLogModal,
  closeLogModal,
  setLogSource,
  setLogSevFilter,
  renderLogTable,
  loadMoreLogs,
};
