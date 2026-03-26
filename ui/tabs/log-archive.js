import S from '../lib/state.js';
import { api } from '../lib/api.js';

let laData = null;
let laLoading = false;

async function loadLogArchive() {
  if (laLoading) return;
  laLoading = true;
  S._loaded.add('log-archive');

  const icon = document.getElementById('la-refresh-icon');
  if (icon) icon.classList.add('fa-spin');

  try {
    laData = await api('logging', `/accounts/${S.accountId}/logs/archives`);
    if (!Array.isArray(laData)) laData = [];
  } catch (e) {
    console.warn('[LogArchive]', e);
    laData = [];
  }

  laLoading = false;
  if (icon) icon.classList.remove('fa-spin');
  renderLogArchive();
}

function fmtNum(n) { return n >= 1000 ? (n / 1000).toFixed(1).replace('.0', '') + 'k' : String(n); }
function fmtSize(kb) { return kb >= 1024 ? (kb / 1024).toFixed(1) + ' MB' : kb + ' KB'; }

function renderLogArchive() {
  const wrap = document.getElementById('la-wrap');
  if (!wrap) return;

  if (!laData || !laData.length) {
    wrap.innerHTML = '<div class="empty-state"><i class="fa-solid fa-box-archive"></i><h3>Keine Log-Archive</h3><p>Keine monatlichen Log-Archive gefunden.</p></div>';
    return;
  }

  const sorted = [...laData].sort((a, b) => (b.year * 100 + b.month) - (a.year * 100 + a.month));
  const chronological = [...sorted].reverse();

  const totalLogs = sorted.reduce((s, a) => s + (a.logCount || 0), 0);
  const totalSize = sorted.reduce((s, a) => s + (a.fileSizeInKiloBytes || 0), 0);
  const avgPerMonth = Math.round(totalLogs / sorted.length);
  const maxLogs = Math.max(...sorted.map(a => a.logCount || 0));
  const months = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

  let html = `<div class="la-stats">
    <div class="la-stat"><div class="la-stat-icon" style="background:rgba(0,76,151,.15);color:var(--blue)"><i class="fa-solid fa-box-archive"></i></div><div><div class="la-stat-val">${sorted.length}</div><div class="la-stat-lbl">Archive</div></div></div>
    <div class="la-stat"><div class="la-stat-icon" style="background:rgba(139,92,246,.15);color:var(--purple)"><i class="fa-solid fa-list"></i></div><div><div class="la-stat-val">${fmtNum(totalLogs)}</div><div class="la-stat-lbl">Log-Einträge</div></div></div>
    <div class="la-stat"><div class="la-stat-icon" style="background:rgba(251,191,36,.15);color:var(--amber)"><i class="fa-solid fa-hard-drive"></i></div><div><div class="la-stat-val">${fmtSize(totalSize)}</div><div class="la-stat-lbl">Gesamtgröße</div></div></div>
    <div class="la-stat"><div class="la-stat-icon" style="background:rgba(52,217,123,.15);color:var(--green)"><i class="fa-solid fa-chart-line"></i></div><div><div class="la-stat-val">${fmtNum(avgPerMonth)}</div><div class="la-stat-lbl">Ø pro Monat</div></div></div>
  </div>`;

  // SVG bar chart
  const barGap = 6;
  const barW = Math.max(24, Math.floor(660 / chronological.length) - barGap);
  const xStart = 44;
  const chartH = 180;
  const svgW = xStart + chronological.length * (barW + barGap) + 20;

  html += `<div class="la-section"><div class="la-section-title"><i class="fa-solid fa-chart-bar"></i> Log-Volumen pro Monat</div>`;
  html += `<div style="overflow-x:auto;padding:0 24px"><svg viewBox="0 0 ${svgW} ${chartH + 40}" class="la-chart-svg">`;

  for (let i = 0; i <= 4; i++) {
    const y = 10 + (chartH / 4) * i;
    const val = Math.round(maxLogs * (1 - i / 4));
    html += `<line x1="${xStart}" y1="${y}" x2="${xStart + chronological.length * (barW + barGap)}" y2="${y}" stroke="rgba(255,255,255,.06)" stroke-width="1"/>`;
    html += `<text x="${xStart - 5}" y="${y + 4}" text-anchor="end" fill="var(--text3)" font-size="9" font-family="var(--mono)">${fmtNum(val)}</text>`;
  }

  chronological.forEach((a, i) => {
    const x = xStart + i * (barW + barGap);
    const h = maxLogs > 0 ? (a.logCount / maxLogs) * chartH : 0;
    const y = 10 + chartH - h;
    const label = months[a.month - 1] + ' ' + (a.year % 100);
    const opacity = 0.4 + (i / chronological.length) * 0.6;
    html += `<rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="3" fill="rgba(77,166,255,${opacity})" class="la-bar"/>`;
    html += `<text x="${x + barW / 2}" y="${y - 4}" text-anchor="middle" fill="var(--text2)" font-size="9" font-weight="700" font-family="var(--mono)">${fmtNum(a.logCount)}</text>`;
    html += `<text x="${x + barW / 2}" y="${chartH + 24}" text-anchor="middle" fill="var(--text3)" font-size="8" font-family="var(--font)">${label}</text>`;
  });

  html += `</svg></div></div>`;

  // Archive list
  html += `<div class="la-section"><div class="la-section-title"><i class="fa-solid fa-list"></i> Archive</div><div class="la-list">`;
  for (const a of sorted) {
    const label = months[a.month - 1] + ' ' + a.year;
    html += `<div class="la-row">
      <span class="la-row-date">${label}</span>
      <span class="la-row-count">${fmtNum(a.logCount)} Logs</span>
      <div class="la-row-bar-wrap"><div class="la-row-bar" style="width:${maxLogs ? Math.round(a.logCount / maxLogs * 100) : 0}%"></div></div>
      <span class="la-row-size">${fmtSize(a.fileSizeInKiloBytes)}</span>
      <span class="la-row-status" style="color:${a.status === 'created' ? 'var(--green)' : 'var(--text3)'}">${a.status === 'created' ? 'Bereit' : '–'}</span>
    </div>`;
  }
  html += `</div></div>`;

  wrap.innerHTML = html;
}

function resetLaState() { laData = null; laLoading = false; }

export { loadLogArchive, renderLogArchive, resetLaState };
