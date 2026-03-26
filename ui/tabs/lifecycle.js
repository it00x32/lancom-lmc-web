import S from '../lib/state.js';
import { escHtml, deviceName, isOnline } from '../lib/helpers.js';
import { energyDeviceType, energyTypeBadge } from './energy.js';

// ─── LIFECYCLE PLANNER ────────────────────────────────────────────────────────
const LC_AP_MAX_CLIENTS = 40;   // Max. WLAN-Clients pro AP (konservativ)
const LC_GROWTH_RATE    = 0.08; // Angenommenes Wachstum 8 %/Monat

let lcFilter = 'all';

function lcMonthsToFull(current, max) {
  if (current <= 0) return Infinity;
  if (current >= max) return 0;
  return Math.log(max / current) / Math.log(1 + LC_GROWTH_RATE);
}

function lcRiskBadge(months) {
  if (months <= 3)  return { cls:'lrm-critical', label: months <= 0 ? 'Jetzt kritisch' : `In ${Math.round(months)} Mon.` };
  if (months <= 7)  return { cls:'lrm-soon',     label: `In ~${Math.round(months)} Monaten` };
  if (months <= 12) return { cls:'lrm-medium',   label: `In ~${Math.round(months)} Monaten` };
  return null;
}

function lcSetFilter(f, btn) {
  lcFilter = f;
  document.querySelectorAll('.lc-filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderLifecycle();
}

function renderLifecycle() {
  const wrap = document.getElementById('lc-wrap');
  if (!wrap) return;
  const devs = Object.values(S.devices);
  if (!devs.length) {
    wrap.innerHTML = '<div class="empty-state"><i class="fa-solid fa-timeline"></i><h3>Keine Daten</h3><p>Zuerst Geräte laden.</p></div>';
    return;
  }

  // ── Jedes Gerät analysieren ───────────────────────────────────────
  const deviceRows = devs.map(d => {
    const risks  = [];
    const online = isOnline(d);
    const type   = energyDeviceType(d);

    // 1. Lifecycle-Status (EOL / EOS)
    const lcStat = (d.status?.lifecycle?.status || '').toUpperCase();
    if (/END.OF.LIFE|EOL/.test(lcStat)) {
      risks.push({
        icon:'fa-skull', icls:'lri-red', level:'critical', months:0,
        title:'End-of-Life erreicht',
        desc:'Kein Hersteller-Support mehr – Sicherheitslücken werden nicht mehr gepatcht.',
        upgrade:'Sofortiger Geräteersatz empfohlen – aktuelle LANCOM-Generation evaluieren.',
      });
    } else if (/END.OF.SALE|EOS|END.OF.SUPPORT/.test(lcStat)) {
      risks.push({
        icon:'fa-cart-flatbed', icls:'lri-amber', level:'soon', months:6,
        title:'End-of-Sale / End-of-Support',
        desc:'Gerät wird nicht mehr aktiv verkauft oder ist außerhalb des regulären Supports.',
        upgrade:'Nachfolgemodell evaluieren und Migrationstermin mittelfristig planen.',
      });
    }

    // 2. Firmware OBSOLETE
    if (d.firmwareState === 'OBSOLETE' && online) {
      risks.push({
        icon:'fa-microchip', icls:'lri-amber', level:'soon', months:3,
        title:'Firmware veraltet (OBSOLETE)',
        desc:'Veraltete Firmware: Sicherheitsrisiken, fehlende Bugfixes und Power-Management-Verbesserungen.',
        upgrade:'Firmware-Update sofort über LMC → Verwaltung → Firmware durchführen.',
      });
    }

    // 3. WLAN-Kapazität (nur APs)
    if (type === 'ap' && online) {
      const clients = S.wlanClients[d.id] || 0;
      const pct = clients / LC_AP_MAX_CLIENTS;
      if (pct >= 0.4) {
        const months = lcMonthsToFull(clients, LC_AP_MAX_CLIENTS);
        const level  = pct >= 0.8 ? 'critical' : pct >= 0.6 ? 'soon' : 'medium';
        const iCls   = pct >= 0.8 ? 'lri-red'  : pct >= 0.6 ? 'lri-amber' : 'lri-blue';
        risks.push({
          icon:'fa-wifi', icls:iCls, level, months, pct,
          title:`WLAN-Kapazität: ${clients}/${LC_AP_MAX_CLIENTS} Clients (${Math.round(pct*100)} %)`,
          desc: pct >= 0.8
            ? `AP nahezu ausgelastet – Verbindungsabbrüche und Performanceverlust können jederzeit auftreten.`
            : `Bei ${Math.round(LC_GROWTH_RATE*100)} % monatlichem Wachstum: Überlast in ~${Math.max(0,Math.round(months))} Monaten.`,
          upgrade:'Weiteren Access Point installieren oder Zellenplanung überarbeiten (TX-Power reduzieren, Clients auf 5/6 GHz steuern).',
        });
      }
    }

    // 4. VPN-Qualität (Paketverlust / Latenz)
    const devVpn = (S.vpnConnections||[]).filter(v => (v._deviceId||v.deviceId)===d.id && v.active);
    for (const vpn of devVpn) {
      const loss = parseFloat(vpn.packetLossPercent) || 0;
      const rtt  = parseFloat(vpn.rttAvgUs) || 0;
      const peer = escHtml(vpn.peerName || vpn.networkName || '–');
      if (loss > 5) {
        risks.push({
          icon:'fa-shield-halved', icls:'lri-red', level:'critical', months:0,
          title:`VPN-Paketverlust kritisch: ${loss.toFixed(1)} %`,
          desc:`Tunnel „${peer}": Hoher Paketverlust – Verbindungsqualität gefährdet produktiven Betrieb.`,
          upgrade:'ISP-Leitungsqualität prüfen, MTU/MSS anpassen oder redundanten WAN-Anschluss ergänzen.',
        });
      } else if (loss > 2) {
        risks.push({
          icon:'fa-shield-halved', icls:'lri-amber', level:'soon', months:2,
          title:`VPN-Paketverlust erhöht: ${loss.toFixed(1)} %`,
          desc:`Tunnel „${peer}": Erhöhter Paketverlust – Trend beobachten, Ursache klären.`,
          upgrade:'WAN-Verbindungsqualität überwachen, QoS-Konfiguration und ISP-Vertrag prüfen.',
        });
      } else if (rtt > 100000) {
        risks.push({
          icon:'fa-network-wired', icls:'lri-blue', level:'medium', months:6,
          title:`VPN-Latenz hoch: ${(rtt/1000).toFixed(0)} ms`,
          desc:`Tunnel „${peer}": Hohe Latenz beeinträchtigt Echtzeitanwendungen (VoIP, Video, RDP).`,
          upgrade:'ISP-Wechsel prüfen oder QoS-Priorisierung für Echtzeit-Traffic einrichten.',
        });
      }
    }

    // 5. WAN: Mobile-Backup als primäre Leitung
    const devWan = (S.wanInterfaces||[]).filter(w => (w._deviceId||w.deviceId)===d.id);
    const primaryMobile = devWan.filter(w =>
      w.mobileModemSignalDecibelMw != null ||
      /mobile|lte|4g|5g|umts/i.test(w.connectionType||''));
    if (primaryMobile.length && online) {
      risks.push({
        icon:'fa-signal', icls:'lri-blue', level:'medium', months:12,
        title:`Mobiles WAN aktiv (${primaryMobile.length} Interface${primaryMobile.length>1?'s':''})`,
        desc:'LTE/5G-Verbindungen sind teurer, weniger stabil und haben höhere Latenz als kabelgebundene Anschlüsse.',
        upgrade:'Kabelgebundenen Anschluss (DSL/Glasfaser) als primäre Leitung evaluieren, Mobilfunk als Backup.',
      });
    }

    // 6. Aktive Alerts
    if (d.alerting?.hasAlert && online) {
      risks.push({
        icon:'fa-bell', icls:'lri-red', level:'critical', months:0,
        title:'Aktive Meldungen in LMC',
        desc:'Dieses Gerät hat aktive Alarme – mögliche Hardware-, Konfigurations- oder Verbindungsprobleme.',
        upgrade:'Meldungen unter Verwaltung → Alerts prüfen und beheben.',
      });
    }

    // Gesamt-Dringlichkeit
    let urgency = 'ok';
    if (risks.some(r => r.level==='critical')) urgency = 'critical';
    else if (risks.some(r => r.level==='soon'))   urgency = 'soon';
    else if (risks.some(r => r.level==='medium'))  urgency = 'medium';

    return { d, risks, urgency, online, type };
  });

  // ── Zähler ────────────────────────────────────────────────────────
  const nCritical = deviceRows.filter(r => r.urgency==='critical').length;
  const nSoon     = deviceRows.filter(r => r.urgency==='soon').length;
  const nMedium   = deviceRows.filter(r => r.urgency==='medium').length;
  const nOk       = deviceRows.filter(r => r.urgency==='ok').length;

  // Badge in Sidebar updaten
  const lcBadge = document.getElementById('badge-lifecycle');
  if (lcBadge) lcBadge.textContent = (nCritical + nSoon) || '–';

  // ── Filter anwenden ───────────────────────────────────────────────
  const urgOrder = {critical:0, soon:1, medium:2, ok:3};
  const filtered = deviceRows
    .filter(r => {
      if (lcFilter==='critical') return r.urgency==='critical';
      if (lcFilter==='soon')     return r.urgency==='critical' || r.urgency==='soon';
      if (lcFilter==='medium')   return r.urgency !== 'ok';
      return true;
    })
    .sort((a,b) => urgOrder[a.urgency]-urgOrder[b.urgency] || deviceName(a.d).localeCompare(deviceName(b.d)));

  // ── Rendern ───────────────────────────────────────────────────────
  wrap.innerHTML = `

    <!-- KPIs -->
    <div class="lc-kpi-row">
      <div class="lc-kpi">
        <div class="lc-kpi-icon lki-red"><i class="fa-solid fa-circle-exclamation"></i></div>
        <div class="lc-kpi-val" style="color:var(--red)">${nCritical}</div>
        <div class="lc-kpi-lbl">Sofort handeln</div>
      </div>
      <div class="lc-kpi">
        <div class="lc-kpi-icon lki-amber"><i class="fa-solid fa-triangle-exclamation"></i></div>
        <div class="lc-kpi-val" style="color:var(--amber)">${nSoon}</div>
        <div class="lc-kpi-lbl">≤ 6 Monate</div>
      </div>
      <div class="lc-kpi">
        <div class="lc-kpi-icon lki-blue"><i class="fa-solid fa-clock"></i></div>
        <div class="lc-kpi-val" style="color:var(--blue)">${nMedium}</div>
        <div class="lc-kpi-lbl">≤ 12 Monate</div>
      </div>
      <div class="lc-kpi">
        <div class="lc-kpi-icon lki-green"><i class="fa-solid fa-circle-check"></i></div>
        <div class="lc-kpi-val" style="color:var(--green)">${nOk}</div>
        <div class="lc-kpi-lbl">Kein Handlungsbedarf</div>
      </div>
    </div>

    <!-- Filter -->
    <div class="lc-filter-row">
      <button class="lc-filter-btn${lcFilter==='all'?' active':''}" onclick="lcSetFilter('all',this)">
        Alle <span class="lc-count-badge lcb-green">${deviceRows.length}</span>
      </button>
      <button class="lc-filter-btn${lcFilter==='critical'?' active':''}" onclick="lcSetFilter('critical',this)">
        Kritisch <span class="lc-count-badge lcb-red">${nCritical}</span>
      </button>
      <button class="lc-filter-btn${lcFilter==='soon'?' active':''}" onclick="lcSetFilter('soon',this)">
        ≤ 6 Monate <span class="lc-count-badge lcb-amber">${nSoon}</span>
      </button>
      <button class="lc-filter-btn${lcFilter==='medium'?' active':''}" onclick="lcSetFilter('medium',this)">
        ≤ 12 Monate <span class="lc-count-badge lcb-blue">${nMedium}</span>
      </button>
    </div>

    <!-- Kriterien-Info -->
    <details style="background:var(--card);border:1px solid var(--border);border-radius:10px;overflow:hidden;">
      <summary style="padding:11px 16px;cursor:pointer;font-size:12px;font-weight:700;color:var(--text2);display:flex;align-items:center;gap:8px;list-style:none;user-select:none;">
        <i class="fa-solid fa-circle-info" style="color:var(--accent2)"></i>
        Analysekriterien &amp; Schwellenwerte
        <i class="fa-solid fa-chevron-down" style="margin-left:auto;font-size:10px;opacity:.5"></i>
      </summary>
      <div style="padding:0 16px 14px;display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px;margin-top:4px;">
        <div style="background:var(--bg2);border-radius:8px;padding:10px 12px;font-size:11.5px;">
          <div style="font-weight:700;margin-bottom:6px;display:flex;align-items:center;gap:6px;color:var(--text)">
            <i class="fa-solid fa-skull" style="color:var(--red)"></i> Lifecycle-Status
          </div>
          <div style="color:var(--text2);line-height:1.8">
            <span class="lc-risk-months lrm-critical">Kritisch</span> Status <code style="font-size:10px;color:var(--accent2)">END_OF_LIFE</code><br>
            <span class="lc-risk-months lrm-soon">≤ 6 Mon.</span> Status <code style="font-size:10px;color:var(--accent2)">END_OF_SALE / END_OF_SUPPORT</code>
          </div>
        </div>
        <div style="background:var(--bg2);border-radius:8px;padding:10px 12px;font-size:11.5px;">
          <div style="font-weight:700;margin-bottom:6px;display:flex;align-items:center;gap:6px;color:var(--text)">
            <i class="fa-solid fa-microchip" style="color:var(--amber)"></i> Firmware
          </div>
          <div style="color:var(--text2);line-height:1.8">
            <span class="lc-risk-months lrm-soon">≤ 6 Mon.</span> <code style="font-size:10px;color:var(--accent2)">firmwareState = OBSOLETE</code><br>
            <span style="opacity:.4;font-size:11px">kein Risiko bei CURRENT</span>
          </div>
        </div>
        <div style="background:var(--bg2);border-radius:8px;padding:10px 12px;font-size:11.5px;">
          <div style="font-weight:700;margin-bottom:6px;display:flex;align-items:center;gap:6px;color:var(--text)">
            <i class="fa-solid fa-wifi" style="color:var(--blue)"></i> WLAN-Kapazität
          </div>
          <div style="color:var(--text2);line-height:1.8">
            Max. <strong style="color:var(--text)">${LC_AP_MAX_CLIENTS} Clients/AP</strong> · Wachstum <strong style="color:var(--text)">${Math.round(LC_GROWTH_RATE*100)} %/Mon.</strong><br>
            <span class="lc-risk-months lrm-critical">Kritisch</span> ≥ 80 % Auslastung (≥ ${Math.round(LC_AP_MAX_CLIENTS*0.8)} Clients)<br>
            <span class="lc-risk-months lrm-soon">≤ 6 Mon.</span> ≥ 60 % (≥ ${Math.round(LC_AP_MAX_CLIENTS*0.6)} Clients)<br>
            <span class="lc-risk-months lrm-medium">≤ 12 Mon.</span> ≥ 40 % (≥ ${Math.round(LC_AP_MAX_CLIENTS*0.4)} Clients)
          </div>
        </div>
        <div style="background:var(--bg2);border-radius:8px;padding:10px 12px;font-size:11.5px;">
          <div style="font-weight:700;margin-bottom:6px;display:flex;align-items:center;gap:6px;color:var(--text)">
            <i class="fa-solid fa-shield-halved" style="color:var(--red)"></i> VPN-Qualität
          </div>
          <div style="color:var(--text2);line-height:1.8">
            <span class="lc-risk-months lrm-critical">Kritisch</span> Paketverlust &gt; <strong style="color:var(--text)">5 %</strong><br>
            <span class="lc-risk-months lrm-soon">≤ 6 Mon.</span> Paketverlust &gt; <strong style="color:var(--text)">2 %</strong><br>
            <span class="lc-risk-months lrm-medium">≤ 12 Mon.</span> Latenz &gt; <strong style="color:var(--text)">100 ms</strong>
          </div>
        </div>
        <div style="background:var(--bg2);border-radius:8px;padding:10px 12px;font-size:11.5px;">
          <div style="font-weight:700;margin-bottom:6px;display:flex;align-items:center;gap:6px;color:var(--text)">
            <i class="fa-solid fa-signal" style="color:var(--blue)"></i> Mobiles WAN
          </div>
          <div style="color:var(--text2);line-height:1.8">
            <span class="lc-risk-months lrm-medium">≤ 12 Mon.</span> LTE/5G als aktive WAN-Verbindung<br>
            <span style="opacity:.4;font-size:11px">erkannt via mobileModemSignal oder connectionType</span>
          </div>
        </div>
        <div style="background:var(--bg2);border-radius:8px;padding:10px 12px;font-size:11.5px;">
          <div style="font-weight:700;margin-bottom:6px;display:flex;align-items:center;gap:6px;color:var(--text)">
            <i class="fa-solid fa-bell" style="color:var(--red)"></i> Aktive Alerts
          </div>
          <div style="color:var(--text2);line-height:1.8">
            <span class="lc-risk-months lrm-critical">Kritisch</span> <code style="font-size:10px;color:var(--accent2)">alerting.hasAlert = true</code><br>
            <span style="opacity:.4;font-size:11px">Details unter Verwaltung → Alerts</span>
          </div>
        </div>
      </div>
    </details>

    <!-- Gerätekarten -->
    <div class="lc-grid">
      ${filtered.length ? filtered.map(r => {
        const cardCls = r.urgency==='critical'?'lc-critical':r.urgency==='soon'?'lc-soon':'';
        const upgrades = [...new Set(r.risks.map(rx=>rx.upgrade).filter(Boolean))];
        return `<div class="lc-card ${cardCls}">
          <div class="lc-card-header">
            <div class="lc-card-name">${escHtml(deviceName(r.d))}</div>
            <div class="lc-card-meta">
              ${r.d.siteName?`<span><i class="fa-solid fa-location-dot" style="color:var(--accent);font-size:10px"></i> ${escHtml(r.d.siteName)}</span>`:''}
              ${energyTypeBadge(r.type)}
              ${r.online?'<span class="sdot sdot-green">Online</span>':'<span class="sdot sdot-red">Offline</span>'}
              ${r.d.status?.model?`<span style="color:var(--text3);font-family:monospace;font-size:10px">${escHtml(r.d.status.model)}</span>`:''}
            </div>
          </div>
          ${r.risks.length ? `
          <div class="lc-risks">
            ${r.risks.map(risk => {
              const badge = lcRiskBadge(risk.months);
              const barColor = risk.pct>=0.8?'var(--red)':risk.pct>=0.6?'var(--amber)':'var(--blue)';
              return `<div class="lc-risk">
                <div class="lc-risk-icon ${risk.icls}"><i class="fa-solid ${risk.icon}"></i></div>
                <div class="lc-risk-body">
                  <div class="lc-risk-title">${risk.title}</div>
                  <div class="lc-risk-desc">${risk.desc}</div>
                  ${risk.pct !== undefined ? `<div class="lc-cap-bar-wrap"><div class="lc-cap-bar" style="width:${Math.min(100,Math.round(risk.pct*100))}%;background:${barColor}"></div></div>` : ''}
                </div>
                ${badge ? `<div class="lc-risk-months ${badge.cls}">${badge.label}</div>` : ''}
              </div>`;
            }).join('')}
          </div>
          ${upgrades.length ? `<div class="lc-upgrade">
            <i class="fa-solid fa-lightbulb" style="color:var(--accent2)"></i>
            <strong>Empfehlung:</strong> ${escHtml(upgrades[0])}
            ${upgrades.slice(1).map(u=>`<br><i class="fa-solid fa-arrow-right" style="color:var(--accent2);margin-right:3px"></i>${escHtml(u)}`).join('')}
          </div>` : ''}
          ` : `<div class="lc-ok-state"><i class="fa-solid fa-circle-check"></i> Kein Handlungsbedarf</div>`}
        </div>`;
      }).join('')
      : `<div class="empty-state" style="grid-column:1/-1">
          <i class="fa-solid fa-circle-check" style="color:var(--green)"></i>
          <h3>Keine Geräte in dieser Kategorie</h3>
          <p>Wähle einen anderen Filter.</p>
        </div>`}
    </div>

    <div class="energy-note" style="text-align:center;padding-bottom:8px">
      Kapazitätsprognose: Max. ${LC_AP_MAX_CLIENTS} Clients/AP · Wachstumsannahme: ${Math.round(LC_GROWTH_RATE*100)} %/Monat.
      Lifecycle-Daten aus LANCOM LMC · VPN-Qualität und WLAN-Clients aus Live-Monitoring.
    </div>
  `;
}

export {
  LC_AP_MAX_CLIENTS,
  LC_GROWTH_RATE,
  lcFilter,
  lcMonthsToFull,
  lcRiskBadge,
  lcSetFilter,
  renderLifecycle,
};
