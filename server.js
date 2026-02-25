#!/usr/bin/env node
/**
 * LANCOM LMC Dashboard – API Proxy + Static Server
 * Uses only Node.js built-in modules (no npm required)
 * Usage: node server.js [port]
 */

const http   = require('http');
const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const url    = require('url');
const { spawn } = require('child_process');

const PORT = parseInt(process.argv[2] || process.env.PORT || '3001', 10);

const SERVICES = {
  devices:          'https://cloud.lancom.de/cloud-service-devices',
  monitoring:       'https://cloud.lancom.de/cloud-service-monitoring',
  'monitor-frontend': 'https://cloud.lancom.de/cloud-service-monitor-frontend',
  useragent:        'https://cloud.lancom.de/cloud-service-useragent',
  auth:             'https://cloud.lancom.de/cloud-service-auth',
  config:           'https://cloud.lancom.de/cloud-service-config',
  notification:     'https://cloud.lancom.de/cloud-service-notification',
  devicetunnel:     'https://cloud.lancom.de/cloud-service-devicetunnel',
  siem:             'https://cloud.lancom.de/cloud-service-siem',
  logging:          'https://cloud.lancom.de/cloud-service-logging',
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
};

// ── SNMP helpers ──────────────────────────────────────────────────────────────
function runSnmpWalk(host, community, version, oid) {
  return new Promise((resolve) => {
    const cmd  = version === '1' ? 'snmpwalk' : 'snmpbulkwalk';
    const args = ['-v', version, '-c', community, '-On', '-t', '5', '-r', '1', host, oid];
    const proc = spawn(cmd, args);
    let out = '';
    proc.stdout.on('data', d => (out += d));
    const timer = setTimeout(() => { try { proc.kill(); } catch {} }, 12000);
    proc.on('close', () => { clearTimeout(timer); resolve(out); });
    proc.on('error', () => { clearTimeout(timer); resolve(''); });
  });
}

function macFromDecOid(suffix) {
  const parts = suffix.split('.');
  if (parts.length !== 6) return null;
  return parts.map(n => parseInt(n, 10).toString(16).padStart(2, '0')).join(':');
}

function macFromHexStr(str) {
  const hex = str.replace(/[:\s]/g, '').toLowerCase();
  if (hex.length !== 12) return null;
  return hex.match(/.{2}/g).join(':');
}

// ── LANCOM enterprise WLAN client table (LCOS-LX APs) ────────────────────────
// OID: 1.3.6.1.4.1.2356.13.1.3.4.1.1.{col}.{mac6bytes} – indexed by client MAC
// SSID: 1.3.6.1.4.1.2356.13.1.3.32.1.3.{mac6bytes}
async function snmpLancomWlanClients(host, community, version) {
  const [clientOut, ssidOut, arpOut] = await Promise.all([
    runSnmpWalk(host, community, version, '1.3.6.1.4.1.2356.13.1.3.4.1.1'),  // WLAN client table
    runSnmpWalk(host, community, version, '1.3.6.1.4.1.2356.13.1.3.32.1.3'), // SSID per client
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.4.22.1.2'),           // ARP: ip → mac
  ]);

  // ARP: MAC → IP
  const macToIp = {};
  arpOut.split('\n').forEach(line => {
    const m = line.match(/4\.22\.1\.2\.\d+\.([\d.]+)\s*=\s*(?:Hex-STRING:\s*)?([\dA-Fa-f ]+)\s*$/);
    if (m && m[1].split('.').length === 4) {
      const mac = macFromHexStr(m[2].trim());
      if (mac) macToIp[mac] = m[1];
    }
  });

  // SSID: MAC → SSID string
  const macToSsid = {};
  ssidOut.split('\n').forEach(line => {
    const m = line.match(/2356\.13\.1\.3\.32\.1\.3\.([\d.]+)\s*=\s*(?:STRING:\s*)?\"?([^"\n]+?)\"?\s*$/);
    if (m) {
      const mac = macFromDecOid(m[1]);
      if (mac) macToSsid[mac] = m[2].trim();
    }
  });

  // Client table: extract unique MACs with channel/band info
  const clients = {};
  clientOut.split('\n').forEach(line => {
    // OID suffix: {col}.{b1}.{b2}.{b3}.{b4}.{b5}.{b6}
    const m = line.match(/2356\.13\.1\.3\.4\.1\.1\.(\d+)\.([\d.]+)\s*=\s*(.*)/);
    if (!m) return;
    const col = parseInt(m[1]);
    const mac = macFromDecOid(m[2]);
    if (!mac) return;
    if (!clients[mac]) clients[mac] = { mac, channel: null, band: null };
    const val = m[3].trim();
    const n = val.match(/(\d+)/);
    if (col === 2 && n) clients[mac].channel = parseInt(n[1]); // channel number
    if (col === 3 && n) clients[mac].band    = parseInt(n[1]); // 1=2.4GHz, 2=5GHz (typical)
  });

  const entries = Object.values(clients).map(c => {
    const ssid = macToSsid[c.mac] || '';
    let portName = ssid ? `WLAN: ${ssid}` : 'WLAN';
    if (c.band)    portName += c.band === 1 ? ' (2.4G)' : c.band === 2 ? ' (5G)' : '';
    if (c.channel) portName += ` CH${c.channel}`;
    return { mac: c.mac, bridgePort: 0, portName, ip: macToIp[c.mac] || null };
  });

  entries.sort((a, b) => a.portName.localeCompare(b.portName, undefined, { numeric: true }));
  return {
    entries,
    count: entries.length,
    countWithIp: entries.filter(e => e.ip).length,
    hasMacTable: entries.length > 0,
    source: 'wlan-clients',
  };
}

async function snmpMacTable(host, community, version) {
  const [fdbOut, qfdbOut, bpOut, ifNameOut, arpOut] = await Promise.all([
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.17.4.3.1.2'), // dot1dTpFdbPort (classic Bridge MIB)
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.17.7.1.2.2.1.2'), // dot1qTpFdbPort (Q-Bridge MIB)
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.17.1.4.1.2'), // dot1dBasePortIfIndex
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.31.1.1.1.1'), // ifName
    runSnmpWalk(host, community, version, '1.3.6.1.2.1.4.22.1.2'),   // ARP: ipNetToMediaPhysAddress
  ]);

  // MAC → bridge port number — try classic Bridge MIB first, fall back to Q-Bridge MIB
  const macToBp = {};

  // Classic Bridge MIB: OID suffix = {mac_6_bytes} → port
  fdbOut.split('\n').forEach(line => {
    const m = line.match(/17\.4\.3\.1\.2\.([\d.]+)\s*=\s*INTEGER:\s*(\d+)/);
    if (m) { const mac = macFromDecOid(m[1]); if (mac) macToBp[mac] = parseInt(m[2]); }
  });

  // Q-Bridge MIB fallback: OID suffix = {vlan}.{mac_6_bytes} → port
  if (Object.keys(macToBp).length === 0) {
    qfdbOut.split('\n').forEach(line => {
      // OID: ...17.7.1.2.2.1.2.{vlan}.{b1}.{b2}.{b3}.{b4}.{b5}.{b6} = INTEGER: port
      const m = line.match(/17\.7\.1\.2\.2\.1\.2\.\d+\.([\d.]+)\s*=\s*INTEGER:\s*(\d+)/);
      if (m) {
        const mac = macFromDecOid(m[1]);
        // Q-Bridge may have duplicate MACs per VLAN — keep first (lowest VLAN)
        if (mac && !macToBp[mac]) macToBp[mac] = parseInt(m[2]);
      }
    });
  }

  // bridge port → ifIndex
  const bpToIf = {};
  bpOut.split('\n').forEach(line => {
    const m = line.match(/17\.1\.4\.1\.2\.(\d+)\s*=\s*INTEGER:\s*(\d+)/);
    if (m) bpToIf[m[1]] = parseInt(m[2]);
  });

  // ifIndex → interface name
  const ifNames = {};
  ifNameOut.split('\n').forEach(line => {
    const m = line.match(/31\.1\.1\.1\.1\.(\d+)\s*=\s*(?:STRING:\s*)?"?([^"\n]+?)"?\s*$/);
    if (m) ifNames[m[1]] = m[2].trim();
  });

  // ARP: MAC → IP  (OID suffix = ifIdx.A.B.C.D, value = hex MAC)
  const macToIp = {};
  arpOut.split('\n').forEach(line => {
    const m = line.match(/4\.22\.1\.2\.\d+\.([\d.]+)\s*=\s*(?:Hex-STRING:\s*)?([\dA-Fa-f ]+)\s*$/);
    if (m && m[1].split('.').length === 4) {
      const mac = macFromHexStr(m[2].trim());
      if (mac) macToIp[mac] = m[1];
    }
  });

  const entries = Object.entries(macToBp).map(([mac, bp]) => {
    const ifIdx   = bpToIf[String(bp)];
    const portName = ifIdx ? (ifNames[String(ifIdx)] || `Port ${bp}`) : `Port ${bp}`;
    return { mac, bridgePort: bp, portName, ip: macToIp[mac] || null };
  });

  entries.sort((a, b) => a.portName.localeCompare(b.portName, undefined, { numeric: true }));

  // If Bridge MIB yielded nothing, try LANCOM enterprise WLAN client table (LCOS-LX APs)
  if (entries.length === 0) {
    return snmpLancomWlanClients(host, community, version);
  }

  return {
    entries,
    count: entries.length,
    countWithIp: entries.filter(e => e.ip).length,
    hasMacTable: entries.length > 0,
    source: 'bridge',
  };
}

// ── Proxy helper ──────────────────────────────────────────────────────────────
function proxyRequest(targetUrl, method, apiKey, body) {
  return new Promise((resolve, reject) => {
    const parsed  = new url.URL(targetUrl);
    const bodyStr = body !== null && body !== undefined ? JSON.stringify(body) : '';

    const options = {
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method:   method,
      headers: {
        'Authorization': `LMC-API-KEY ${apiKey}`,
        'Accept':        '*/*',
        ...(bodyStr ? {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
        } : {}),
      },
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── HTTP Server ───────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url);

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── API proxy endpoint ──
  if (parsedUrl.pathname === '/api' && req.method === 'POST') {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', async () => {
      let input;
      try { input = JSON.parse(body); } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
        return;
      }

      const { api_key, service, path: apiPath, method = 'GET', body: reqBody } = input;

      if (!api_key || !service || !apiPath || !SERVICES[service]) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing api_key, service or path' }));
        return;
      }

      const targetUrl = SERVICES[service] + apiPath;

      try {
        const result = await proxyRequest(targetUrl, method.toUpperCase(), api_key, reqBody ?? null);
        if (result.status < 200 || result.status >= 300) {
          console.error(`[LMC API] ${method.toUpperCase()} ${targetUrl} → ${result.status}: ${result.body}`);
        }
        res.writeHead(result.status, { 'Content-Type': 'application/json' });
        res.end(result.body);
      } catch (e) {
        console.error(`[LMC Proxy] Error proxying ${method.toUpperCase()} ${targetUrl}:`, e.message);
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Upstream error: ' + e.message }));
      }
    });
    return;
  }

  // ── SNMP endpoint ──
  if (parsedUrl.pathname === '/snmp' && req.method === 'POST') {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', async () => {
      let input;
      try { input = JSON.parse(body); } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' })); return;
      }

      const { host, community = 'public', version = '2c', type = 'mac-table' } = input;

      // Basic validation – prevent shell injection
      if (!host || !/^[a-zA-Z0-9.\-]+$/.test(host)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Ungültige Host-Adresse' })); return;
      }
      if (!community || !/^[\w\-@.!#%&*+=]+$/.test(community)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Ungültiger Community-String' })); return;
      }
      if (!['1', '2c'].includes(version)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Version muss 1 oder 2c sein' })); return;
      }

      try {
        let result;
        if (type === 'mac-table') {
          result = await snmpMacTable(host, community, version);
        } else if (type === 'test') {
          const out = await runSnmpWalk(host, community, version, '1.3.6.1.2.1.1.1.0');
          const m = out.match(/STRING:\s*"?([^\n"]+)"?\s*$/m);
          result = { ok: !!m, sysDescr: m ? m[1].trim() : (out.trim().slice(0, 200) || 'Keine Antwort') };
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unbekannter Typ' })); return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (e) {
        console.error('[SNMP]', e.message);
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ── Static files ──
  let filePath = path.join(__dirname, parsedUrl.pathname === '/' ? 'index.html' : parsedUrl.pathname);
  const ext = path.extname(filePath);

  if (!fs.existsSync(filePath)) {
    filePath = path.join(__dirname, 'index.html'); // SPA fallback
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'text/plain',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`LANCOM LMC Dashboard running at http://0.0.0.0:${PORT}`);
});
