import S from '../lib/state.js';
import { api } from '../lib/api.js';
import { escHtml, deviceName, isOnline } from '../lib/helpers.js';

let hsAlerts = null;
let hsLoading = false;

async function loadHealthScore() {
  if (hsLoading) return;
  hsLoading = true;
  S._loaded.add('health-score');
  try {
    const r = await api('notification', `/accounts/${S.accountId}/alerts`);
    hsAlerts = r?.alerts || (Array.isArray(r) ? r : []);
  } catch { hsAlerts = []; }
  hsLoading = false;
  renderHealthScore();
}

function renderHealthScore() {
  const wrap = document.getElementById('hs-wrap');
  if (!wrap) return;
  const devs = Object.values(S.devices);
  if (!devs.length) { wrap.innerHTML = '<div class="empty-state"><i class="fa-solid fa-heart-pulse"></i><h3>Keine Daten</h3><p>Zuerst Geräte laden.</p></div>'; return; }

  const total = devs.length;
  const online = devs.filter(d => isOnline(d)).length;
  const onlinePct = total > 0 ? online / total : 0;

  const openAlerts = (hsAlerts || []).filter(a => a.state === 'open').length;
  const alertScore = openAlerts === 0 ? 1 : openAlerts <= 2 ? 0.7 : openAlerts <= 5 ? 0.4 : 0.1;

  const releaseCount = devs.filter(d => { const rt = (d.status?.fwReleaseType || '').toUpperCase(); return rt === 'RELEASE' || rt === 'RELEASE_UPDATE'; }).length;
  const fwScore = total > 0 ? releaseCount / total : 0;

  const now = Date.now();
  const cfgAges = devs.map(d => {
    const ts = d.status?.cfgTimeStamp;
    if (!ts) return 365;
    const days = (now - new Date(ts).getTime()) / 86400000;
    return Math.min(365, Math.max(0, days));
  });
  const avgCfgAge = cfgAges.reduce((a, b) => a + b, 0) / cfgAges.length;
  const cfgScore = avgCfgAge <= 7 ? 1 : avgCfgAge <= 30 ? 0.8 : avgCfgAge <= 90 ? 0.6 : avgCfgAge <= 180 ? 0.3 : 0.1;

  const debugCount = devs.filter(d => (d.status?.fwReleaseType || '').toUpperCase() === 'DEBUG').length;
  const secScore = total > 0 ? 1 - (debugCount / total) : 1;

  const w = { online: 0.30, alerts: 0.20, firmware: 0.25, config: 0.15, security: 0.10 };
  const overall = Math.round((onlinePct * w.online + alertScore * w.alerts + fwScore * w.firmware + cfgScore * w.config + secScore * w.security) * 100);

  const scores = [
    { label: 'Verfügbarkeit', score: Math.round(onlinePct * 100), detail: `${online}/${total} online`, color: 'var(--green)', icon: 'fa-circle-check', weight: '30%' },
    { label: 'Alerts', score: Math.round(alertScore * 100), detail: `${openAlerts} offen`, color: 'var(--amber)', icon: 'fa-bell', weight: '20%' },
    { label: 'Firmware', score: Math.round(fwScore * 100), detail: `${releaseCount}/${total} Release`, color: 'var(--blue)', icon: 'fa-microchip', weight: '25%' },
    { label: 'Konfig-Alter', score: Math.round(cfgScore * 100), detail: `Ø ${Math.round(avgCfgAge)}d`, color: 'var(--purple)', icon: 'fa-gear', weight: '15%' },
    { label: 'Sicherheit', score: Math.round(secScore * 100), detail: `${debugCount} Debug-FW`, color: 'var(--red)', icon: 'fa-shield-halved', weight: '10%' },
  ];

  const gradeColor = overall >= 80 ? 'var(--green)' : overall >= 60 ? 'var(--teal)' : overall >= 40 ? 'var(--amber)' : 'var(--red)';
  const gradeLabel = overall >= 90 ? 'Exzellent' : overall >= 80 ? 'Sehr gut' : overall >= 70 ? 'Gut' : overall >= 60 ? 'Befriedigend' : overall >= 40 ? 'Verbesserungsbedarf' : 'Kritisch';

  // SVG gauge
  const R = 100, CX = 120, CY = 120, SW = 14;
  const circumference = 2 * Math.PI * R;
  const arc = circumference * 0.75;
  const dashOffset = arc - (arc * overall / 100);
  const startAngle = 135;

  let html = `<div class="hs-hero">
    <div class="hs-gauge-wrap">
      <svg viewBox="0 0 240 240" class="hs-gauge-svg">
        <circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="var(--card2)" stroke-width="${SW}"
          stroke-dasharray="${arc} ${circumference}" stroke-dashoffset="0"
          transform="rotate(${startAngle} ${CX} ${CY})" stroke-linecap="round"/>
        <circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${gradeColor}" stroke-width="${SW}"
          stroke-dasharray="${arc} ${circumference}" stroke-dashoffset="${dashOffset}"
          transform="rotate(${startAngle} ${CX} ${CY})" stroke-linecap="round"
          class="hs-gauge-arc" style="filter:drop-shadow(0 0 8px ${gradeColor})"/>
      </svg>
      <div class="hs-gauge-center">
        <div class="hs-gauge-val" style="color:${gradeColor}">${overall}</div>
        <div class="hs-gauge-label">${gradeLabel}</div>
      </div>
    </div>
    <div class="hs-hero-info">
      <div class="hs-hero-title">Network Health Score</div>
      <div class="hs-hero-sub">${total} Geräte · ${online} online · ${openAlerts} offene Alerts</div>
      <div class="hs-hero-time">Berechnet: ${new Date().toLocaleTimeString('de-DE')}</div>
    </div>
  </div>`;

  // Sub-scores
  html += `<div class="hs-scores">`;
  for (const s of scores) {
    const barColor = s.score >= 80 ? 'var(--green)' : s.score >= 60 ? 'var(--teal)' : s.score >= 40 ? 'var(--amber)' : 'var(--red)';
    html += `<div class="hs-score-card">
      <div class="hs-score-header">
        <div class="hs-score-icon" style="color:${s.color}"><i class="fa-solid ${s.icon}"></i></div>
        <div class="hs-score-label">${s.label}</div>
        <div class="hs-score-weight">${s.weight}</div>
      </div>
      <div class="hs-score-body">
        <div class="hs-score-val" style="color:${barColor}">${s.score}</div>
        <div class="hs-score-bar-wrap"><div class="hs-score-bar" style="width:${s.score}%;background:${barColor}"></div></div>
        <div class="hs-score-detail">${s.detail}</div>
      </div>
    </div>`;
  }
  html += `</div>`;

  // Recommendations
  const recs = [];
  if (onlinePct < 1) recs.push({ icon: 'fa-circle-xmark', color: 'var(--red)', title: `${total - online} Geräte offline`, desc: 'Überprüfe die Erreichbarkeit und Stromversorgung der betroffenen Geräte.' });
  if (debugCount > 0) recs.push({ icon: 'fa-bug', color: 'var(--red)', title: `${debugCount} Geräte mit Debug-Firmware`, desc: 'Debug-Firmware ist nicht für den Produktiveinsatz gedacht. Aktualisiere auf eine Release-Version.' });
  if (openAlerts > 0) recs.push({ icon: 'fa-bell', color: 'var(--amber)', title: `${openAlerts} offene Alerts`, desc: 'Überprüfe und schließe offene Alerts um die Netzwerk-Gesundheit zu verbessern.' });
  if (fwScore < 0.8) recs.push({ icon: 'fa-microchip', color: 'var(--amber)', title: 'Firmware nicht einheitlich', desc: `Nur ${releaseCount} von ${total} Geräten laufen auf einer Release-Firmware.` });
  if (avgCfgAge > 90) recs.push({ icon: 'fa-gear', color: 'var(--amber)', title: 'Konfiguration veraltet', desc: `Durchschnittliches Config-Alter: ${Math.round(avgCfgAge)} Tage. Erwäge ein Config-Rollout.` });
  if (!recs.length) recs.push({ icon: 'fa-circle-check', color: 'var(--green)', title: 'Alles in Ordnung', desc: 'Keine Handlungsempfehlungen. Dein Netzwerk ist in gutem Zustand.' });

  html += `<div class="hs-section"><div class="hs-section-title"><i class="fa-solid fa-lightbulb"></i> Empfehlungen</div><div class="hs-recs">`;
  for (const r of recs) {
    html += `<div class="hs-rec"><div class="hs-rec-icon" style="color:${r.color}"><i class="fa-solid ${r.icon}"></i></div><div><div class="hs-rec-title">${escHtml(r.title)}</div><div class="hs-rec-desc">${escHtml(r.desc)}</div></div></div>`;
  }
  html += `</div></div>`;
  wrap.innerHTML = html;
}

function resetHsState() { hsAlerts = null; hsLoading = false; }

export { loadHealthScore, renderHealthScore, resetHsState };
