import S from './lib/state.js';
import { escHtml, deviceName, isOnline, fmtBytes, fmtRate, statusDot, signalBar, bandBadge, markAllTabsDirty, renderTabIfActive, _dirtyTabs, debouncedRenderDevices, debouncedRenderWlan, debouncedRenderVpn, debouncedRenderWan, debouncedRenderNeighbors, debouncedRenderLldp, debouncedRenderLogTable } from './lib/helpers.js';
import { api, toast } from './lib/api.js';

import { APP_VERSION, doLogin, showAccountPicker, filterAccounts, renderAccountList, selectAccount, doLogout } from './login.js';
import { toggleSidebar, showTab, setRefreshInterval, startCountdown } from './sidebar.js';
import { openSearch, closeSearch, runSearch } from './search.js';

import { refreshDashboard, renderCurrentTab, updateStats, updateAllBadges, buildSiteFilter, loadWlanData, loadConfigStatesBatched, loadRecords, loadTable, loadLldpData, loadWlanNeighbors, ensureLoaded, loadNeighborsData, loadLldpFullData, loadConfigData } from './tabs/dashboard.js';
import { setFilter, setSiteFilter, renderDevices, deviceRow, exportDevicesCsv, toggleBulkMode, bulkToggleDevice, bulkSelectAll, bulkClear, bulkActionReboot, bulkActionFirmware, bulkActionRollout, findActionBtn, setButtonLoading, openActionModal, updateActionDeviceStatus, finalizeActionModal, closeActionModal } from './tabs/devices.js';
import { setWlanFilter, renderWlan, loadBlacklist, renderBlacklist, blockWlanClient, unblockMac, generateBlacklistAddin } from './tabs/wlan.js';
import { renderVpn } from './tabs/vpn.js';
import { renderWan } from './tabs/wan.js';
import { renderTraffic, loadTrafficData, reloadTraffic, resetTrafficState } from './tabs/traffic.js';
import { renderNeighbors, setNbFilter } from './tabs/neighbors.js';
import { setLldpView, renderLldp } from './tabs/lldp.js';
import { loadSwitchEvents, setSweFilter, renderSwitchEvents, resetSweState } from './tabs/switch-events.js';
import { buildTopoSelector, renderTopology, topoSetRoot, topoOpenDetail, topoCloseDetail, topoChangeRoot, topoChangeSite, topoToggleFullscreen, topoFit, topoZoom, topoResetPositions, topoExportSvg, initTopoEvents, loadSnmpMacTable, loadMacTable, inspectLldpRaw, resetTopoState } from './tabs/topology.js';
import { lcSetFilter, renderLifecycle } from './tabs/lifecycle.js';
import { renderEnergy, saveEnergyPrice, loadEnergyPrice } from './tabs/energy.js';
import { paLoadAll, paToggleDetail, renderAnomalyPage, paState } from './tabs/anomaly.js';
import { loadWlanCapacity, renderWlanCapacity, resetWcState } from './tabs/wlan-capacity.js';
import { startCeScan, cancelCeScan, ceScanSingle, ceLookup, ceFormatHint, ceClearResult, ceMacTableOpen, ceMacTableClose, ceMacTableFilter, ceRenderDeviceTable, ceInitDevices, resetCeState } from './tabs/client-explorer.js';
import { meshScanAll, renderMeshPage } from './tabs/mesh.js';
import { l2tpScanAll, renderL2tpPage } from './tabs/l2tp.js';
import { loadAddins, addinsRender, addinsFilter, addinToggleEnabled, addinCreateOpen, addinCreateClose, addinCreateSave, addinCreateValidateName, addinEditOpen, addinDelete, addinScriptOpen, addinScriptClose, openVarsModal, closeVarsModal, addinNetworkAdd, addinNetworkRemove, loadAccountNetworks, osLabelClick, resetAddinsState } from './tabs/addins.js';
import { renderFirmware, fwGroupUpdate } from './tabs/firmware.js';
import { loadSites, renderSites } from './tabs/sites.js';
import { loadAlerts, renderAlerts, reloadAlerts, resetAlertsState } from './tabs/alerts.js';
import { saveSnmpSettings, snmpToggleV3, snmpToggleV3AuthFields, loadSettingsUI, createSnmpAddins, createMgmtVlanAddins } from './tabs/settings.js';
import { openLogModal, closeLogModal, setLogSource, setLogSevFilter, renderLogTable, loadMoreLogs } from './tabs/logs.js';
import { actionReboot, actionFirmwareUpdate, actionConfigRollout, openWebconfig, openCfgPreview, closeCfgPreview, snmpCardTest } from './tabs/actions.js';
import { renderSiteTiles, tileSiteFilter } from './tabs/dashboard.js';

// ── Window bindings (needed for inline onclick handlers in index.html) ────────

// State (for inline references)
window.S = S;
window.bulkMode = false;
window.bulkSelected = new Set();

// Core
window.doLogin = doLogin;
window.filterAccounts = filterAccounts;
window.selectAccount = selectAccount;
window.doLogout = doLogout;
window.toggleSidebar = toggleSidebar;
window.showTab = showTab;
window.setRefreshInterval = setRefreshInterval;
window.startCountdown = startCountdown;
window.refreshDashboard = refreshDashboard;
window.renderCurrentTab = renderCurrentTab;

// Search
window.openSearch = openSearch;
window.closeSearch = closeSearch;
window.runSearch = runSearch;

// Dashboard
window.updateStats = updateStats;
window.updateAllBadges = updateAllBadges;
window.renderSiteTiles = renderSiteTiles;
window.tileSiteFilter = tileSiteFilter;
window.buildSiteFilter = buildSiteFilter;

const _lazyLoaders = {
  neighbors: loadNeighborsData,
  lldp: loadLldpFullData,
  config: loadConfigData,
};
window.ensureLoaded = async (key) => {
  if(S._loaded.has(key)) return;
  const loader = _lazyLoaders[key];
  if(!loader) return;
  await loader();
  S._loaded.add(key);
};

// Devices
window.setFilter = setFilter;
window.setSiteFilter = setSiteFilter;
window.renderDevices = renderDevices;
window.exportDevicesCsv = exportDevicesCsv;
window.toggleBulkMode = toggleBulkMode;
window.bulkToggleDevice = bulkToggleDevice;
window.bulkSelectAll = bulkSelectAll;
window.bulkClear = bulkClear;
window.bulkActionReboot = bulkActionReboot;
window.bulkActionFirmware = bulkActionFirmware;
window.bulkActionRollout = bulkActionRollout;
window.closeActionModal = closeActionModal;

// WLAN + Blacklist
window.setWlanFilter = setWlanFilter;
window.renderWlan = renderWlan;
window.loadBlacklist = loadBlacklist;
window.renderBlacklist = renderBlacklist;
window.blockWlanClient = blockWlanClient;
window.unblockMac = unblockMac;
window.generateBlacklistAddin = generateBlacklistAddin;

// Monitoring tables
window.renderVpn = renderVpn;
window.renderWan = renderWan;
window.renderTraffic = renderTraffic;
window.loadTrafficData = loadTrafficData;
window.reloadTraffic = reloadTraffic;
window.resetTrafficState = resetTrafficState;
window.renderNeighbors = renderNeighbors;
window.setNbFilter = setNbFilter;

// LLDP
window.setLldpView = setLldpView;
window.renderLldp = renderLldp;

// Switch Events
window.loadSwitchEvents = loadSwitchEvents;
window.setSweFilter = setSweFilter;
window.renderSwitchEvents = renderSwitchEvents;
window.resetSweState = resetSweState;

// Topology
window.buildTopoSelector = buildTopoSelector;
window.renderTopology = renderTopology;
window.topoSetRoot = topoSetRoot;
window.topoOpenDetail = topoOpenDetail;
window.topoCloseDetail = topoCloseDetail;
window.topoChangeRoot = topoChangeRoot;
window.topoChangeSite = topoChangeSite;
window.topoToggleFullscreen = topoToggleFullscreen;
window.topoFit = topoFit;
window.topoZoom = topoZoom;
window.topoResetPositions = topoResetPositions;
window.topoExportSvg = topoExportSvg;
window.loadSnmpMacTable = loadSnmpMacTable;
window.loadMacTable = loadMacTable;
window.inspectLldpRaw = inspectLldpRaw;
window.resetTopoState = resetTopoState;

// Analysis
window.lcSetFilter = lcSetFilter;
window.renderLifecycle = renderLifecycle;
window.renderEnergy = renderEnergy;
window.saveEnergyPrice = saveEnergyPrice;
window.loadEnergyPrice = loadEnergyPrice;
window.paLoadAll = paLoadAll;
window.paToggleDetail = paToggleDetail;
window.renderAnomalyPage = renderAnomalyPage;
window.paState = paState;

// WLAN Capacity
window.loadWlanCapacity = loadWlanCapacity;
window.renderWlanCapacity = renderWlanCapacity;
window.resetWcState = resetWcState;

// Client Explorer
window.startCeScan = startCeScan;
window.cancelCeScan = cancelCeScan;
window.ceScanSingle = ceScanSingle;
window.ceLookup = ceLookup;
window.ceFormatHint = ceFormatHint;
window.ceClearResult = ceClearResult;
window.ceMacTableOpen = ceMacTableOpen;
window.ceMacTableClose = ceMacTableClose;
window.ceMacTableFilter = ceMacTableFilter;
window.ceRenderDeviceTable = ceRenderDeviceTable;
window.ceInitDevices = ceInitDevices;
window.resetCeState = resetCeState;

// SNMP local
window.meshScanAll = meshScanAll;
window.renderMeshPage = renderMeshPage;
window.l2tpScanAll = l2tpScanAll;
window.renderL2tpPage = renderL2tpPage;

// Add-ins
window.loadAddins = loadAddins;
window.addinsRender = addinsRender;
window.addinsFilter = addinsFilter;
window.addinToggleEnabled = addinToggleEnabled;
window.addinCreateOpen = addinCreateOpen;
window.addinCreateClose = addinCreateClose;
window.addinCreateSave = addinCreateSave;
window.addinCreateValidateName = addinCreateValidateName;
window.addinEditOpen = addinEditOpen;
window.addinDelete = addinDelete;
window.addinScriptOpen = addinScriptOpen;
window.addinScriptClose = addinScriptClose;
window.openVarsModal = openVarsModal;
window.closeVarsModal = closeVarsModal;
window.addinNetworkAdd = addinNetworkAdd;
window.addinNetworkRemove = addinNetworkRemove;
window.loadAccountNetworks = loadAccountNetworks;
window.osLabelClick = osLabelClick;
window.resetAddinsState = resetAddinsState;

// Management
window.renderFirmware = renderFirmware;
window.fwGroupUpdate = fwGroupUpdate;
window.loadSites = loadSites;
window.renderSites = renderSites;
window.loadAlerts = loadAlerts;
window.renderAlerts = renderAlerts;
window.reloadAlerts = reloadAlerts;
window.resetAlertsState = resetAlertsState;

// Settings
window.saveSnmpSettings = saveSnmpSettings;
window.snmpToggleV3 = snmpToggleV3;
window.snmpToggleV3AuthFields = snmpToggleV3AuthFields;
window.loadSettingsUI = loadSettingsUI;
window.createSnmpAddins = createSnmpAddins;
window.createMgmtVlanAddins = createMgmtVlanAddins;

// Logs
window.openLogModal = openLogModal;
window.closeLogModal = closeLogModal;
window.setLogSource = setLogSource;
window.setLogSevFilter = setLogSevFilter;
window.renderLogTable = renderLogTable;
window.loadMoreLogs = loadMoreLogs;

// Actions
window.actionReboot = actionReboot;
window.actionFirmwareUpdate = actionFirmwareUpdate;
window.actionConfigRollout = actionConfigRollout;
window.openWebconfig = openWebconfig;
window.openCfgPreview = openCfgPreview;
window.closeCfgPreview = closeCfgPreview;
window.snmpCardTest = snmpCardTest;

// Debounced search helpers (for oninput in index.html)
window.debouncedRenderDevices = debouncedRenderDevices;
window.debouncedRenderWlan = debouncedRenderWlan;
window.debouncedRenderVpn = debouncedRenderVpn;
window.debouncedRenderWan = debouncedRenderWan;
window.debouncedRenderNeighbors = debouncedRenderNeighbors;
window.debouncedRenderLldp = debouncedRenderLldp;
window.debouncedRenderLogTable = debouncedRenderLogTable;

// Helpers exposed for inline HTML
window.escHtml = escHtml;
window.deviceName = deviceName;
window.isOnline = isOnline;
window.toast = toast;
window.api = api;

// ── Loading overlay ───────────────────────────────────────────────────────────
function setLoading(show, text) {
  const overlay = document.getElementById('loading-overlay');
  const msg = document.getElementById('loading-text');
  if(!overlay) return;
  overlay.style.display = show ? 'flex' : 'none';
  if(msg && text) msg.textContent = text;
}
window.setLoading = setLoading;

// ── Init ──────────────────────────────────────────────────────────────────────
function init() {
  document.getElementById('app-version').textContent = APP_VERSION;

  const saved = localStorage.getItem('lmc_api_key');
  if (saved) {
    document.getElementById('api-key-input').value = saved;
    document.getElementById('save-token-cb').checked = true;
  }
  const savedBase = localStorage.getItem('lmc_api_base');
  if (savedBase) document.getElementById('api-base-input').value = savedBase;

  const savedInterval = localStorage.getItem('lmc_refresh_interval');
  if (savedInterval) {
    const sel = document.getElementById('refresh-select');
    if (sel) sel.value = savedInterval;
  }

  loadSettingsUI();
  loadEnergyPrice();
  initTopoEvents();

  document.getElementById('api-key-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') doLogin();
  });

  const hashTab = location.hash.replace('#','');
  if(hashTab && document.getElementById('tab-'+hashTab)) {
    showTab(hashTab, true);
  }
  window.addEventListener('hashchange', () => {
    const t = location.hash.replace('#','');
    if(t && t !== S.activeTab && document.getElementById('tab-'+t)) showTab(t, true);
  });
}

document.addEventListener('DOMContentLoaded', init);
