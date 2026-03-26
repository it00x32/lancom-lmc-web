import S from '../lib/state.js';
import { escHtml, deviceName, isOnline } from '../lib/helpers.js';

// ─── ENERGIE / CO₂ DASHBOARD ──────────────────────────────────────────────────
// Schätzwerte Grundlast je Gerätetyp (Watt)
const ENERGY_BASE = { router: 18, ap: 12, switch: 9, other: 15 };
const CO2_PER_KWH = 400; // g CO₂/kWh (DE-Strommix ~2024)
const EUR_PER_KWH = 0.32; // €/kWh Standardwert

function saveEnergyPrice() {
  const v = document.getElementById('energy-price-input')?.value;
  if (v) localStorage.setItem('lmc_energy_price', v);
}
function loadEnergyPrice() {
  const saved = localStorage.getItem('lmc_energy_price');
  const el = document.getElementById('energy-price-input');
  if (saved && el) el.value = saved;
}

function energyDeviceType(d) {
  const m = (d.status?.model || d.label || d.name || '').toUpperCase();
  if (/\bW-\d|\bWAP\b|ACCESS.?POINT|\bAP\b|W\d{3,}/.test(m)) return 'ap';
  if (/\bGS-|\bGS\d|SWITCH|SW\d/.test(m)) return 'switch';
  if (/ROUTER|FIREWALL|GATEWAY|VPN|IAP-\d|R\d{3,}|FX\d|1[0-9]{3}|OAP/.test(m)) return 'router';
  // Fallback: Geräte ohne WLAN-Clients = Router, sonst AP
  if (S.wlanClients[d.id] > 0) return 'ap';
  return 'router';
}

function energyTypeBadge(type) {
  const map = {
    router: ['etb-router','fa-shield-halved','Router'],
    ap:     ['etb-ap',    'fa-wifi',         'Access Point'],
    switch: ['etb-switch','fa-diagram-project','Switch'],
    other:  ['etb-other', 'fa-microchip',    'Sonstige'],
  };
  const [cls, icon, label] = map[type] || map.other;
  return `<span class="energy-type-badge ${cls}"><i class="fa-solid ${icon}"></i>${label}</span>`;
}

function renderEnergy() {
  const wrap = document.getElementById('energy-wrap');
  if (!wrap) return;
  const devs = Object.values(S.devices);
  if (!devs.length) {
    wrap.innerHTML = '<div class="empty-state"><i class="fa-solid fa-leaf"></i><h3>Keine Daten</h3><p>Zuerst Geräte laden.</p></div>';
    return;
  }

  // ── PoE-Daten aus lldpNeighbors ──────────────────────────────────
  // S.lldpNeighbors enthält pro Port: { _deviceId, poePower, poeStatus }
  const poeByDevice = {};
  for (const port of (S.lldpNeighbors || [])) {
    const w = parseFloat(port.poePower) || 0;
    if (w > 0) {
      if (!poeByDevice[port._deviceId]) poeByDevice[port._deviceId] = 0;
      poeByDevice[port._deviceId] += w;
    }
  }

  // ── Pro Gerät: Typ + Leistung schätzen ────────────────────────────
  const deviceRows = devs.map(d => {
    const type     = energyDeviceType(d);
    const baseW    = ENERGY_BASE[type];
    const poeW     = poeByDevice[d.id] || 0;
    const totalW   = baseW + poeW;
    const online   = isOnline(d);
    return { d, type, baseW, poeW, totalW, online, site: d.siteName || '(kein Standort)' };
  });

  // ── Gesamtwerte ───────────────────────────────────────────────────
  const totalW    = deviceRows.reduce((s,r) => s + (r.online ? r.totalW : 0), 0);
  const totalPoeW = deviceRows.reduce((s,r) => s + (r.online ? r.poeW  : 0), 0);
  const totalPoeCount = (S.lldpNeighbors||[]).filter(p => (parseFloat(p.poePower)||0) > 0).length;
  const eurPerKwh = parseFloat(document.getElementById('energy-price-input')?.value) || EUR_PER_KWH;
  const co2PerDay = (totalW * 24 / 1000) * CO2_PER_KWH;       // g
  const costMonth = (totalW * 24 * 30 / 1000) * eurPerKwh;    // €

  // ── Per-Standort ──────────────────────────────────────────────────
  const siteMap = {};
  for (const r of deviceRows) {
    if (!siteMap[r.site]) siteMap[r.site] = { name:r.site, rows:[] };
    siteMap[r.site].rows.push(r);
  }
  const sites = Object.values(siteMap).sort((a,b)=>a.name.localeCompare(b.name));
  const maxSiteW = Math.max(1, ...sites.map(s => s.rows.reduce((x,r)=>x+(r.online?r.totalW:0),0)));

  // ── Optimierungsvorschläge ────────────────────────────────────────
  const suggestions = [];
  // Monatliche Ersparnis in Euro berechnen: saveW Watt für hoursDay Stunden/Tag
  const eurSave = (saveW, hoursDay=24) => {
    const eur = saveW * hoursDay * 30 / 1000 * eurPerKwh;
    return eur >= 0.01 ? `~${eur.toFixed(2)} €/Monat` : null;
  };

  // 1. TX-Power Reduktion: APs mit wenig Clients
  const sparseAPs = deviceRows.filter(r => r.type==='ap' && r.online && (S.wlanClients[r.d.id]||0) <= 2);
  if (sparseAPs.length) {
    const saveW = sparseAPs.length * 3;
    suggestions.push({
      icon:'fa-wifi', cls:'esi-green',
      title:'TX-Power-Reduktion möglich',
      desc: `${sparseAPs.length} Access Point${sparseAPs.length>1?'s haben':'hat'} ≤ 2 WLAN-Clients. `+
            `Durch Reduktion der Sendeleistung (z. B. auf 50 %) lassen sich ca. ~${saveW} W einsparen.`,
      badge: `~${saveW} W`, eur: eurSave(saveW),
    });
  }

  // 2. Zeitplan für APs nachts (6 h Abschaltung/Dimmung)
  const apCount = deviceRows.filter(r => r.type==='ap' && r.online).length;
  if (apCount > 0) {
    const saveW = Math.round(apCount * ENERGY_BASE.ap * 0.5);
    suggestions.push({
      icon:'fa-clock', cls:'esi-blue',
      title:'WLAN-Zeitplan einrichten',
      desc: `Ein Nacht-Zeitplan (00:00–06:00) für ${apCount} Access Point${apCount>1?'s':''} `+
            `reduziert den Verbrauch um ca. ${saveW} W während 6 h/Tag.`,
      badge: `${apCount} APs`, eur: eurSave(saveW, 6),
    });
  }

  // 3. PoE-Zeitplan für Bürozeiten (12 h Off außerhalb der Arbeitszeit)
  const poeActiveCount = (S.lldpNeighbors||[]).filter(p=>(parseFloat(p.poePower)||0)>0).length;
  if (poeActiveCount > 0) {
    suggestions.push({
      icon:'fa-plug', cls:'esi-amber',
      title:'PoE-Zeitplan für Bürozeiten',
      desc: `${poeActiveCount} PoE-Port${poeActiveCount>1?'s liefern':'liefert'} zusammen ${totalPoeW.toFixed(1)} W. `+
            `Ein Schedule (Mo–Fr 07:00–19:00) spart außerhalb der Bürozeiten ~${(totalPoeW*12/24).toFixed(0)} Wh/Tag.`,
      badge: `${totalPoeW.toFixed(0)} W`, eur: eurSave(totalPoeW, 12),
    });
  }

  // 4. Hohe PoE-Einzelverbraucher (> 20 W pro Port)
  const heavyPoe = (S.lldpNeighbors||[]).filter(p=>(parseFloat(p.poePower)||0)>20);
  if (heavyPoe.length) {
    const totalSaveW = heavyPoe.reduce((s,p)=>s+Math.max(0,parseFloat(p.poePower)-15),0);
    const names = [...new Set(heavyPoe.map(p=>p._deviceName||''))].filter(Boolean).slice(0,3).join(', ');
    suggestions.push({
      icon:'fa-bolt', cls:'esi-amber',
      title:`${heavyPoe.length} PoE-Port${heavyPoe.length>1?'s':''} mit hohem Verbrauch (> 20 W)`,
      desc: `Prüfen Sie ob Geräte an diesen Ports (${names||'–'}) durch effizientere Alternativen `+
            `ersetzt werden können. Potenzial bei Reduktion auf 15 W: ~${totalSaveW.toFixed(0)} W.`,
      badge: `${heavyPoe.length} Ports`, eur: eurSave(totalSaveW),
    });
  }

  // 5. 2.4 GHz-dominierte APs → Band-Steering-Potenzial
  const apBy24 = {}, apByTotal = {};
  for (const st of (S.wlanStations||[])) {
    const id = st._deviceId||st.deviceId; if(!id) continue;
    apByTotal[id] = (apByTotal[id]||0)+1;
    if ((st.band||'').includes('24')) apBy24[id] = (apBy24[id]||0)+1;
  }
  const band24APs = deviceRows.filter(r => r.type==='ap' && r.online &&
    (apByTotal[r.d.id]||0) >= 3 && (apBy24[r.d.id]||0) / apByTotal[r.d.id] > 0.6);
  if (band24APs.length) {
    suggestions.push({
      icon:'fa-signal', cls:'esi-purple',
      title:`Band-Steering aktivieren (${band24APs.length} AP${band24APs.length>1?'s':''})`,
      desc: `${band24APs.length} Access Point${band24APs.length>1?'s haben':'hat'} > 60 % der Clients auf 2.4 GHz. `+
            `2.4 GHz belegt mehr Airtime pro Client → höhere AP-Auslastung. `+
            `Band-Steering auf 5 GHz/6 GHz spart Energie und verbessert den Durchsatz.`,
      badge: `${band24APs.length} APs`, eur: null,
    });
  }

  // 6. Mobile WAN-Verbindungen (Modem ~6 W Mehrverbrauch ggü. Kabel)
  const mobileWans = (S.wanInterfaces||[]).filter(w =>
    w.mobileModemSignalDecibelMw != null ||
    /mobile|lte|4g|5g|umts|gsm/i.test(w.connectionType||''));
  const mobileDevIds = [...new Set(mobileWans.map(w=>w._deviceId||w.deviceId).filter(Boolean))];
  if (mobileDevIds.length) {
    const saveW = mobileDevIds.length * 6;
    suggestions.push({
      icon:'fa-tower-broadcast', cls:'esi-blue',
      title:`${mobileDevIds.length} Gerät${mobileDevIds.length>1?'e nutzen':'e nutzt'} mobiles WAN`,
      desc: `LTE/5G-Modems verbrauchen ~6 W mehr als kabelgebundene Anschlüsse (DSL/Glasfaser). `+
            `Falls ein Kabelanschluss verfügbar ist, lohnt sich ein Wechsel.`,
      badge: `${mobileDevIds.length} Geräte`, eur: eurSave(saveW),
    });
  }

  // 7. Veraltete Firmware (fehlende Power-Management-Verbesserungen)
  const obsoleteFw = deviceRows.filter(r=>r.d.firmwareState==='OBSOLETE' && r.online);
  if (obsoleteFw.length) {
    suggestions.push({
      icon:'fa-microchip', cls:'esi-purple',
      title:`Firmware-Update für ${obsoleteFw.length} Gerät${obsoleteFw.length>1?'e':''}`,
      desc: `Neuere Firmware enthält oft verbesserte Power-Management-Features und Bugfixes. `+
            `${obsoleteFw.length} Online-Gerät${obsoleteFw.length>1?'e haben':'hat'} eine veraltete Firmware (OBSOLETE).`,
      badge: `${obsoleteFw.length} Geräte`, eur: null,
    });
  }

  // 8. Offline-Geräte (Info – könnten noch Strom ziehen)
  const offlineCount = deviceRows.filter(r=>!r.online).length;
  if (offlineCount > 0) {
    suggestions.push({
      icon:'fa-power-off', cls:'esi-purple',
      title:`${offlineCount} Gerät${offlineCount>1?'e offline':' offline'}`,
      desc: `Offline-Geräte werden im Verbrauch nicht gezählt. Prüfen Sie, ob diese physisch `+
            `ausgeschaltet sind oder ein Problem vorliegt – im letzteren Fall ziehen sie ggf. noch Strom.`,
      badge: `${offlineCount} Geräte`, eur: null,
    });
  }

  // ── Rendern ───────────────────────────────────────────────────────
  wrap.innerHTML = `

    <!-- KPI-Zeile -->
    <div class="energy-kpi-row">
      <div class="energy-kpi">
        <div class="energy-kpi-icon eki-power"><i class="fa-solid fa-bolt"></i></div>
        <div class="energy-kpi-val" style="color:var(--amber)">${totalW.toFixed(0)} <span style="font-size:16px;font-weight:400">W</span></div>
        <div class="energy-kpi-lbl">Echtzeit-Verbrauch</div>
        <div class="energy-kpi-sub">davon ${totalPoeW.toFixed(0)} W PoE</div>
      </div>
      <div class="energy-kpi">
        <div class="energy-kpi-icon eki-co2"><i class="fa-solid fa-leaf"></i></div>
        <div class="energy-kpi-val" style="color:var(--green)">${co2PerDay>=1000?(co2PerDay/1000).toFixed(2)+' <span style="font-size:16px;font-weight:400">kg</span>':co2PerDay.toFixed(0)+' <span style="font-size:16px;font-weight:400">g</span>'}</div>
        <div class="energy-kpi-lbl">CO₂ pro Tag</div>
        <div class="energy-kpi-sub">@ ${CO2_PER_KWH} g/kWh (DE-Strommix)</div>
      </div>
      <div class="energy-kpi">
        <div class="energy-kpi-icon eki-cost"><i class="fa-solid fa-euro-sign"></i></div>
        <div class="energy-kpi-val" style="color:var(--accent2)">${costMonth.toFixed(2)} <span style="font-size:16px;font-weight:400">€</span></div>
        <div class="energy-kpi-lbl">Kosten / Monat</div>
        <div class="energy-kpi-sub">@ ${EUR_PER_KWH} €/kWh</div>
      </div>
      <div class="energy-kpi">
        <div class="energy-kpi-icon eki-poe"><i class="fa-solid fa-plug"></i></div>
        <div class="energy-kpi-val" style="color:var(--blue)">${totalPoeCount}</div>
        <div class="energy-kpi-lbl">PoE-Ports aktiv</div>
        <div class="energy-kpi-sub">${totalPoeW.toFixed(1)} W gesamt</div>
      </div>
      <div class="energy-kpi">
        <div class="energy-kpi-icon eki-dev"><i class="fa-solid fa-server"></i></div>
        <div class="energy-kpi-val" style="color:var(--purple)">${devs.filter(d=>isOnline(d)).length}</div>
        <div class="energy-kpi-lbl">Geräte online</div>
        <div class="energy-kpi-sub">von ${devs.length} gesamt</div>
      </div>
    </div>

    <!-- Pro Standort -->
    <div>
      <div class="energy-section-title"><i class="fa-solid fa-location-dot"></i>Verbrauch pro Standort</div>
      <div class="energy-sites-grid">
        ${sites.map(s => {
          const sW   = s.rows.reduce((x,r)=>x+(r.online?r.totalW:0),0);
          const sPoe = s.rows.reduce((x,r)=>x+(r.online?r.poeW:0),0);
          const sCo2 = (sW*24/1000)*CO2_PER_KWH;
          const sCost = (sW*24*30/1000)*eurPerKwh;
          const pct  = Math.round((sW/maxSiteW)*100);
          const onl  = s.rows.filter(r=>r.online).length;
          const aps  = s.rows.filter(r=>r.type==='ap').length;
          const rtrs = s.rows.filter(r=>r.type==='router').length;
          const swts = s.rows.filter(r=>r.type==='switch').length;

          // PoE-Ports dieses Standorts
          const siteDevIds = new Set(s.rows.map(r=>r.d.id));
          const sitePorts = (S.lldpNeighbors||[])
            .filter(p => siteDevIds.has(p._deviceId) && (parseFloat(p.poePower)||0) > 0)
            .sort((a,b) => (parseFloat(b.poePower)||0) - (parseFloat(a.poePower)||0));
          const maxPortW = sitePorts.length ? parseFloat(sitePorts[0].poePower)||0 : 1;

          return `<div class="energy-site-card">
            <div class="energy-site-name"><i class="fa-solid fa-location-dot"></i>${escHtml(s.name)}</div>
            <div class="energy-site-stats">
              <div class="energy-site-stat">
                <div class="energy-site-stat-val" style="color:var(--amber)">${sW.toFixed(0)} W</div>
                <div class="energy-site-stat-lbl">Gesamt</div>
              </div>
              <div class="energy-site-stat">
                <div class="energy-site-stat-val" style="color:var(--blue)">${sPoe.toFixed(1)} W</div>
                <div class="energy-site-stat-lbl">PoE</div>
              </div>
              <div class="energy-site-stat">
                <div class="energy-site-stat-val" style="color:var(--accent2)">${sCost.toFixed(2)} €</div>
                <div class="energy-site-stat-lbl">Kosten/Mo.</div>
              </div>
              <div class="energy-site-stat">
                <div class="energy-site-stat-val" style="color:var(--text2)">${onl}/${s.rows.length}</div>
                <div class="energy-site-stat-lbl">Online</div>
              </div>
            </div>
            <div class="energy-bar-wrap"><div class="energy-bar" style="width:${pct}%"></div></div>
            <div class="energy-note" style="margin-top:8px">
              ${rtrs?`<i class="fa-solid fa-shield-halved" style="color:var(--accent2)"></i> ${rtrs} Router &nbsp;`:''}
              ${aps?`<i class="fa-solid fa-wifi" style="color:var(--teal)"></i> ${aps} APs &nbsp;`:''}
              ${swts?`<i class="fa-solid fa-diagram-project" style="color:var(--blue)"></i> ${swts} Switches`:''}
            </div>
            ${sitePorts.length ? `
            <div style="margin-top:14px;border-top:1px solid var(--border);padding-top:12px;">
              <div style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;">
                <i class="fa-solid fa-plug" style="color:var(--blue)"></i> PoE-Ports (${sitePorts.length})
              </div>
              ${sitePorts.slice(0,6).map(p => {
                const pw = parseFloat(p.poePower)||0;
                const pp = Math.round((pw/maxPortW)*100);
                return `<div style="margin-bottom:6px;">
                  <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px;">
                    <span style="color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:70%">${escHtml(p._deviceName)} · ${escHtml(p.portName)}</span>
                    <span style="font-weight:700;color:var(--blue);flex-shrink:0">${pw.toFixed(1)} W</span>
                  </div>
                  <div style="background:var(--bg);border-radius:3px;height:4px;overflow:hidden;">
                    <div style="width:${pp}%;height:100%;border-radius:3px;background:linear-gradient(90deg,var(--blue),var(--accent));"></div>
                  </div>
                </div>`;
              }).join('')}
              ${sitePorts.length>6?`<div style="font-size:10px;color:var(--text3);margin-top:4px">+${sitePorts.length-6} weitere Ports</div>`:''}
            </div>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>

    <!-- Gerätdetails-Tabelle -->
    <div>
      <div class="energy-section-title"><i class="fa-solid fa-table-list"></i>Gerätedetails</div>
      <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;overflow:hidden;">
        <table class="energy-dev-table">
          <thead><tr>
            <th>Gerät</th><th>Standort</th><th>Typ</th>
            <th>Grundlast</th><th>PoE</th><th>Gesamt</th><th>Status</th>
          </tr></thead>
          <tbody>
            ${deviceRows
              .sort((a,b)=>b.totalW-a.totalW)
              .map(r=>`<tr>
                <td style="font-weight:600">${escHtml(deviceName(r.d))}</td>
                <td class="muted">${escHtml(r.site)}</td>
                <td>${energyTypeBadge(r.type)}</td>
                <td class="muted">${r.online?r.baseW+' W':'–'}</td>
                <td>${r.poeW>0?`<span style="color:var(--blue);font-weight:600">${r.poeW.toFixed(1)} W</span>`:'<span class="muted">–</span>'}</td>
                <td><span style="font-weight:700;color:${r.online?'var(--amber)':'var(--text3)'}">${r.online?r.totalW.toFixed(0)+' W':'offline'}</span></td>
                <td>${r.online?'<span class="sdot sdot-green">Online</span>':'<span class="sdot sdot-red">Offline</span>'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Optimierungsvorschläge -->
    <div>
      <div class="energy-section-title"><i class="fa-solid fa-lightbulb"></i>Optimierungsvorschläge</div>
      ${suggestions.length ? `<div class="energy-suggest-list">
        ${suggestions.map(s=>`<div class="energy-suggest">
          <div class="energy-suggest-icon ${s.cls}"><i class="fa-solid ${s.icon}"></i></div>
          <div class="energy-suggest-body">
            <div class="energy-suggest-title">${s.title}</div>
            <div class="energy-suggest-desc">${s.desc}</div>
          </div>
          <div style="display:flex;flex-direction:column;gap:4px;align-self:flex-start;flex-shrink:0;text-align:right">
            <div class="energy-suggest-badge">${s.badge}</div>
            ${s.eur ? `<div class="energy-suggest-badge" style="background:rgba(26,138,62,.15);color:var(--green);border-color:rgba(26,138,62,.25)">${s.eur}</div>` : ''}
          </div>
        </div>`).join('')}
      </div>` : `<div class="empty-state" style="padding:30px"><i class="fa-solid fa-circle-check" style="color:var(--green)"></i><h3>Alles optimal</h3><p>Keine Verbesserungsvorschläge.</p></div>`}
    </div>

    <div class="energy-note" style="text-align:center;padding-bottom:8px">
      Grundlastschätzung: Router ${ENERGY_BASE.router} W · Access Point ${ENERGY_BASE.ap} W · Switch ${ENERGY_BASE.switch} W.
      PoE-Werte stammen aus dem Live-Monitoring (lan_info_json).
      CO₂: ${CO2_PER_KWH} g/kWh · Strompreis: ${eurPerKwh.toFixed(4)} €/kWh.
    </div>
  `;
}

export {
  ENERGY_BASE,
  CO2_PER_KWH,
  EUR_PER_KWH,
  saveEnergyPrice,
  loadEnergyPrice,
  energyDeviceType,
  energyTypeBadge,
  renderEnergy,
};
