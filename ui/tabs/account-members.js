import S from '../lib/state.js';
import { api } from '../lib/api.js';
import { escHtml } from '../lib/helpers.js';

let amMembers = null;
let amUser = null;
let amLicense = null;
let amLoading = false;

async function loadAccountMembers() {
  if (amLoading) return;
  amLoading = true;
  S._loaded.add('account-members');

  const icon = document.getElementById('am-refresh-icon');
  if (icon) icon.classList.add('fa-spin');

  const results = await Promise.allSettled([
    api('auth', `/accounts/${S.accountId}/members`),
    api('auth', '/users/self'),
    api('licenses', `/accounts/${S.accountId}/pools`),
    api('licenses', `/accounts/${S.accountId}/records`),
    api('licenses', `/accounts/${S.accountId}/condition`),
  ]);

  amMembers = results[0].status === 'fulfilled' ? results[0].value : [];
  amUser = results[1].status === 'fulfilled' ? results[1].value : null;
  const pools = results[2].status === 'fulfilled' ? results[2].value : [];
  const records = results[3].status === 'fulfilled' ? results[3].value : [];
  const condition = results[4].status === 'fulfilled' ? results[4].value : null;
  amLicense = { pools: Array.isArray(pools) ? pools : [], records: Array.isArray(records) ? records : [], condition };

  if (!Array.isArray(amMembers)) amMembers = [];

  amLoading = false;
  if (icon) icon.classList.remove('fa-spin');
  renderAccountMembers();
}

function fmtDate(iso) {
  if (!iso) return '–';
  return new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtDateTime(iso) {
  if (!iso) return '–';
  return new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function timeAgo(iso) {
  if (!iso) return '–';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `vor ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `vor ${hours}h`;
  const days = Math.floor(hours / 24);
  return `vor ${days}d`;
}

function renderAccountMembers() {
  const wrap = document.getElementById('am-wrap');
  if (!wrap) return;

  if (!amMembers?.length && !amUser) {
    wrap.innerHTML = '<div class="empty-state"><i class="fa-solid fa-users"></i><h3>Keine Daten</h3><p>Benutzer-Daten konnten nicht geladen werden.</p></div>';
    return;
  }

  const activeMembers = amMembers.filter(m => m.state === 'ACTIVE');
  const withApiKey = amMembers.filter(m => m.hasValidApiKey);
  const owners = amMembers.filter(m => m.type === 'OWNER');

  let html = `<div class="am-stats">
    <div class="am-stat"><div class="am-stat-icon" style="background:rgba(0,76,151,.15);color:var(--blue)"><i class="fa-solid fa-users"></i></div><div><div class="am-stat-val">${amMembers.length}</div><div class="am-stat-lbl">Mitglieder</div></div></div>
    <div class="am-stat"><div class="am-stat-icon" style="background:rgba(52,217,123,.15);color:var(--green)"><i class="fa-solid fa-circle-check"></i></div><div><div class="am-stat-val">${activeMembers.length}</div><div class="am-stat-lbl">Aktiv</div></div></div>
    <div class="am-stat"><div class="am-stat-icon" style="background:rgba(251,191,36,.15);color:var(--amber)"><i class="fa-solid fa-key"></i></div><div><div class="am-stat-val">${withApiKey.length}</div><div class="am-stat-lbl">API-Key</div></div></div>
    <div class="am-stat"><div class="am-stat-icon" style="background:rgba(139,92,246,.15);color:var(--purple)"><i class="fa-solid fa-crown"></i></div><div><div class="am-stat-val">${owners.length}</div><div class="am-stat-lbl">Owner</div></div></div>
  </div>`;

  // Current user info
  if (amUser) {
    const c = amUser.contact || {};
    html += `<div class="am-section"><div class="am-section-title"><i class="fa-solid fa-user"></i> Angemeldeter Benutzer</div>
    <div class="am-user-card">
      <div class="am-user-avatar"><i class="fa-solid fa-user-circle"></i></div>
      <div class="am-user-info">
        <div class="am-user-name">${escHtml(c.firstName || '')} ${escHtml(c.lastName || '')}</div>
        <div class="am-user-email">${escHtml(amUser.email || '–')}</div>
        <div class="am-user-meta">
          <span><i class="fa-solid fa-shield-halved"></i> ${escHtml(amUser.authenticationType || '–')}</span>
          <span><i class="fa-solid fa-lock"></i> 2FA: ${amUser.twoFactorAuthenticationType || 'Keine'}</span>
          <span class="am-user-active" style="color:${amUser.active ? 'var(--green)' : 'var(--red)'}"><i class="fa-solid fa-circle" style="font-size:8px"></i> ${amUser.active ? 'Aktiv' : 'Inaktiv'}</span>
        </div>
      </div>
    </div></div>`;
  }

  // License info
  if (amLicense.pools.length || amLicense.records.length) {
    html += `<div class="am-section"><div class="am-section-title"><i class="fa-solid fa-id-card"></i> Lizenzen</div><div class="am-license-grid">`;

    for (const pool of amLicense.pools) {
      const durationYears = pool.duration ? (pool.duration / 365).toFixed(1) : '?';
      html += `<div class="am-license-card">
        <div class="am-lic-head"><i class="fa-solid fa-certificate" style="color:var(--accent2)"></i> Lizenz-Pool</div>
        <div class="am-lic-body">
          <div class="am-lic-row"><span>Anzahl</span><span class="am-lic-val">${pool.amount}</span></div>
          <div class="am-lic-row"><span>Laufzeit</span><span class="am-lic-val">${durationYears} Jahre</span></div>
        </div>
      </div>`;
    }

    for (const rec of amLicense.records) {
      html += `<div class="am-license-card">
        <div class="am-lic-head"><i class="fa-solid fa-key" style="color:var(--amber)"></i> Aktivierung</div>
        <div class="am-lic-body">
          <div class="am-lic-row"><span>Aktiviert</span><span class="am-lic-val">${fmtDate(rec.activation)}</span></div>
          <div class="am-lic-row"><span>Von</span><span class="am-lic-val">${escHtml(rec.activatedByName || '–')}</span></div>
          <div class="am-lic-row"><span>Geräte</span><span class="am-lic-val">${rec.amount || '–'}</span></div>
          <div class="am-lic-row"><span>Laufzeit</span><span class="am-lic-val">${rec.duration ? (rec.duration / 365).toFixed(1) + 'J' : '–'}</span></div>
        </div>
      </div>`;
    }

    if (amLicense.condition) {
      const cond = amLicense.condition;
      html += `<div class="am-license-card">
        <div class="am-lic-head"><i class="fa-solid fa-gear" style="color:var(--text3)"></i> Konditionen</div>
        <div class="am-lic-body">
          <div class="am-lic-row"><span>Modus</span><span class="am-lic-val">${escHtml(cond.mode || '–')}</span></div>
          <div class="am-lic-row"><span>Testlaufzeit</span><span class="am-lic-val">${cond.testDurationDays || '–'} Tage</span></div>
          <div class="am-lic-row"><span>LTA</span><span class="am-lic-val">${cond.ltaConnectionsEnabled ? 'Aktiv' : 'Aus'}</span></div>
        </div>
      </div>`;
    }
    html += `</div></div>`;
  }

  // Members table
  html += `<div class="am-section"><div class="am-section-title"><i class="fa-solid fa-users"></i> Account-Mitglieder (${amMembers.length})</div>`;
  html += `<div class="dl-table-wrap"><table class="dl-table"><thead><tr>
    <th>Name</th><th>E-Mail</th><th>Rolle</th><th>Status</th><th>Letzte Aktivität</th><th>API-Key</th><th>Erstellt</th>
  </tr></thead><tbody>`;

  const sortedMembers = [...amMembers].sort((a, b) => new Date(b.lastActivity || 0) - new Date(a.lastActivity || 0));
  for (const m of sortedMembers) {
    const isActive = m.state === 'ACTIVE';
    const hasKey = m.hasValidApiKey;
    const keyExpiry = m.apiKeyValidUntil ? fmtDate(m.apiKeyValidUntil) : '';
    const lastAct = m.lastActivity;
    const recentlyActive = lastAct && (Date.now() - new Date(lastAct).getTime()) < 86400000;

    html += `<tr>
      <td style="font-weight:600">${escHtml(m.name || '–')}</td>
      <td>${escHtml(m.email || '–')}</td>
      <td><span class="am-role-badge am-role-${(m.type || '').toLowerCase()}">${escHtml(m.type || '–')}</span></td>
      <td><span style="color:${isActive ? 'var(--green)' : 'var(--red)'}"><i class="fa-solid fa-circle" style="font-size:7px"></i> ${isActive ? 'Aktiv' : m.state || '–'}</span></td>
      <td><span${recentlyActive ? ' style="color:var(--green);font-weight:600"' : ''}>${lastAct ? timeAgo(lastAct) : '–'}</span></td>
      <td>${hasKey ? `<span style="color:var(--green)"><i class="fa-solid fa-check"></i></span>${keyExpiry ? ` <span style="font-size:10px;color:var(--text3)">bis ${keyExpiry}</span>` : ''}` : '<span style="color:var(--text3)">–</span>'}</td>
      <td class="dl-td-time">${fmtDate(m.created)}</td>
    </tr>`;
  }
  html += `</tbody></table></div></div>`;

  // Security overview
  const noTwoFa = amMembers.filter(m => m.state === 'ACTIVE');
  const expiredInvites = amMembers.filter(m => m.invitationState === 'PENDING' && m.invitationExpiration && new Date(m.invitationExpiration) < new Date());

  html += `<div class="am-section"><div class="am-section-title"><i class="fa-solid fa-shield-halved"></i> Sicherheits-Übersicht</div><div class="am-sec-grid">`;
  html += `<div class="am-sec-item"><div class="am-sec-icon" style="color:${activeMembers.length <= 3 ? 'var(--green)' : 'var(--amber)'}"><i class="fa-solid fa-users"></i></div><div class="am-sec-title">${activeMembers.length} aktive Benutzer</div><div class="am-sec-desc">${activeMembers.length <= 3 ? 'Normale Anzahl' : 'Prüfe, ob alle Zugänge benötigt werden'}</div></div>`;
  html += `<div class="am-sec-item"><div class="am-sec-icon" style="color:${withApiKey.length <= 2 ? 'var(--green)' : 'var(--amber)'}"><i class="fa-solid fa-key"></i></div><div class="am-sec-title">${withApiKey.length} API-Keys aktiv</div><div class="am-sec-desc">${withApiKey.length <= 2 ? 'Im normalen Bereich' : 'Viele aktive API-Keys — überprüfe die Nutzung'}</div></div>`;
  if (expiredInvites.length) {
    html += `<div class="am-sec-item"><div class="am-sec-icon" style="color:var(--red)"><i class="fa-solid fa-envelope"></i></div><div class="am-sec-title">${expiredInvites.length} abgelaufene Einladungen</div><div class="am-sec-desc">Einladungen sind abgelaufen und sollten entfernt oder erneuert werden.</div></div>`;
  }
  html += `</div></div>`;

  wrap.innerHTML = html;
}

function resetAmState() { amMembers = null; amUser = null; amLicense = null; amLoading = false; }

export { loadAccountMembers, renderAccountMembers, resetAmState };
