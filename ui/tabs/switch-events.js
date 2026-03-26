import S from '../lib/state.js';
import { escHtml, deviceName, sevBadge } from '../lib/helpers.js';
import { api, toast } from '../lib/api.js';

// ─── SWITCH EVENT MONITOR ─────────────────────────────────────────────────────
const SWE_PATTERNS = [
  { type: 'loop', rx: /loop/i, icon: 'fa-rotate', color: 'var(--red)', label: 'Loop' },
  { type: 'stp', rx: /stp|spanning|topology.?change|bpdu|root.?bridge|rstp/i, icon: 'fa-sitemap', color: 'var(--amber)', label: 'STP' },
  { type: 'port', rx: /port.*(down|up|disabled|enabled|link|flap|err)/i, icon: 'fa-ethernet', color: 'var(--blue)', label: 'Port' },
  { type: 'poe', rx: /poe|power.*(over|budget|denied)/i, icon: 'fa-plug', color: 'var(--amber)', label: 'PoE' },
  { type: 'vlan', rx: /vlan/i, icon: 'fa-layer-group', color: 'var(--teal)', label: 'VLAN' },
  { type: 'auth', rx: /802\.1x|radius|auth.*fail|mac.?auth/i, icon: 'fa-key', color: 'var(--purple)', label: 'Auth' },
  { type: 'stack', rx: /stack|member.*(join|leave|fail)/i, icon: 'fa-cubes', color: 'var(--amber)', label: 'Stack' },
];
const SWE_ALL_RX = new RegExp(SWE_PATTERNS.map(p => p.rx.source).join('|'), 'i');

let sweState = { events: [], nextOffset: null, loading: false, filter: 'all' };

function classifySweEvent(msg) {
  for (const p of SWE_PATTERNS) { if (p.rx.test(msg)) return p; }
  return { type: 'other', icon: 'fa-circle-info', color: 'var(--text3)', label: 'Sonstig' };
}

const sevLabel = sevBadge;

async function loadSwitchEvents(reset) {
  if (sweState.loading) return;
  S._loaded.add('switch-events');
  if (reset) { sweState.events = []; sweState.nextOffset = null; }
  sweState.loading = true;
  const btn = document.getElementById('swe-reload-btn');
  if (btn) btn.querySelector('i').classList.add('fa-spin');

  try {
    let allNew = [], pages = 0, offset = sweState.nextOffset;
    while (pages < 5) {
      let url = `/accounts/${S.accountId}/logs?limit=100`;
      if (offset != null) url += `&offset=${offset}`;
      const data = await api('siem', url);
      const logs = data?.deviceLogs || [];
      if (!logs.length) { sweState.nextOffset = null; break; }

      const switchLogs = logs.filter(l => SWE_ALL_RX.test(l.rawMessage || ''));
      switchLogs.forEach(l => {
        const dev = S.devices[l.deviceId];
        const cls = classifySweEvent(l.rawMessage || '');
        l._deviceName = dev ? deviceName(dev) : l.deviceId?.substring(0, 8) || '–';
        l._type = cls;
        l._sev = sevLabel(l.severity);
      });
      allNew.push(...switchLogs);

      offset = data?.nextOffset ?? null;
      sweState.nextOffset = offset;
      pages++;
      if (offset == null || offset === data?.endOffset) break;
      if (allNew.length >= 50) break;
    }

    sweState.events.push(...allNew);
    renderSwitchEvents();
  } catch (e) {
    toast('err', 'SIEM Fehler', e.message);
  } finally {
    sweState.loading = false;
    if (btn) btn.querySelector('i').classList.remove('fa-spin');
  }
}

function setSweFilter(f, btn) {
  sweState.filter = f;
  document.querySelectorAll('#swe-filter-group .filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderSwitchEvents();
}

function renderSwitchEvents() {
  const tbody = document.getElementById('swe-tbody');
  if (!tbody) return;
  const q = (document.getElementById('swe-search')?.value || '').toLowerCase();
  const f = sweState.filter;

  let rows = sweState.events;
  if (f === 'loop') rows = rows.filter(l => l._type.type === 'loop');
  else if (f === 'stp') rows = rows.filter(l => l._type.type === 'stp');
  else if (f === 'port') rows = rows.filter(l => l._type.type === 'port');
  else if (f === 'critical') rows = rows.filter(l => parseInt(l.severity) <= 3);

  if (q) rows = rows.filter(l => (l.rawMessage || '').toLowerCase().includes(q) || (l._deviceName || '').toLowerCase().includes(q));

  document.getElementById('swe-count').textContent = rows.length;

  // Mini stats
  const loopN = sweState.events.filter(l => l._type.type === 'loop').length;
  const stpN = sweState.events.filter(l => l._type.type === 'stp').length;
  const portN = sweState.events.filter(l => l._type.type === 'port').length;
  const critN = sweState.events.filter(l => parseInt(l.severity) <= 3).length;
  const miniEl = document.getElementById('swe-mini-stats');
  if (miniEl) miniEl.innerHTML = `
    <div class="mini-stat"><div class="ms-icon" style="background:rgba(211,47,47,.15);color:var(--red)"><i class="fa-solid fa-rotate"></i></div><div><div class="ms-val" style="color:var(--red)">${loopN}</div><div class="ms-lbl">Loops</div></div></div>
    <div class="mini-stat"><div class="ms-icon" style="background:rgba(217,119,6,.15);color:var(--amber)"><i class="fa-solid fa-sitemap"></i></div><div><div class="ms-val" style="color:var(--amber)">${stpN}</div><div class="ms-lbl">STP</div></div></div>
    <div class="mini-stat"><div class="ms-icon" style="background:rgba(0,76,151,.15);color:var(--blue)"><i class="fa-solid fa-ethernet"></i></div><div><div class="ms-val" style="color:var(--blue)">${portN}</div><div class="ms-lbl">Port</div></div></div>
    <div class="mini-stat"><div class="ms-icon" style="background:rgba(211,47,47,.15);color:var(--red)"><i class="fa-solid fa-circle-xmark"></i></div><div><div class="ms-val" style="color:var(--red)">${critN}</div><div class="ms-lbl">Kritisch</div></div></div>
  `;

  document.getElementById('badge-switch-events').textContent = sweState.events.length || '–';

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:32px">${sweState.events.length ? 'Keine Treffer für diesen Filter' : '<i class="fa-solid fa-circle-notch fa-spin"></i> Noch keine Events geladen – werden beim Öffnen automatisch abgerufen'}</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(l => {
    const t = l.createdAt ? new Date(l.createdAt).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '–';
    const sev = l._sev;
    const tp = l._type;
    const msg = escHtml(l.rawMessage || '').replace(SWE_ALL_RX, m => `<mark style="background:rgba(217,119,6,.2);color:var(--amber);border-radius:2px;padding:0 2px">${m}</mark>`);
    return `<tr>
      <td style="text-align:center"><span style="font-size:10px;font-weight:700;color:${sev.color};text-transform:uppercase">${sev.text}</span></td>
      <td style="white-space:nowrap;font-size:11px;font-family:var(--mono);color:var(--text2)">${t}</td>
      <td style="font-weight:600;font-size:12px">${escHtml(l._deviceName)}</td>
      <td><span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;padding:2px 8px;border-radius:4px;background:rgba(255,255,255,.05);color:${tp.color}"><i class="fa-solid ${tp.icon}" style="font-size:10px"></i>${tp.label}</span></td>
      <td style="font-size:11.5px;color:var(--text2);word-break:break-word">${msg}</td>
    </tr>`;
  }).join('');
}

function resetSweState() { sweState.events = []; sweState.nextOffset = null; sweState.loading = false; sweState.filter = 'all'; }

export { SWE_PATTERNS, SWE_ALL_RX, sweState, classifySweEvent, sevLabel, loadSwitchEvents, setSweFilter, renderSwitchEvents, resetSweState };
