const https = require('https');
const url   = require('url');

const DEFAULT_BASE = 'cloud.lancom.de';
const SERVICE_NAMES = ['devices','monitoring','monitor-frontend','useragent','auth','config','notification','devicetunnel','siem','logging','licenses'];

function buildServices(base) {
  const host = base || DEFAULT_BASE;
  const obj = {};
  SERVICE_NAMES.forEach(s => { obj[s] = `https://${host}/cloud-service-${s}`; });
  return obj;
}

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

module.exports = { DEFAULT_BASE, SERVICE_NAMES, buildServices, proxyRequest };
