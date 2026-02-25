// Vercel Serverless Function – LMC API Proxy
const https = require('https');
const url   = require('url');

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

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  let input;
  try {
    const raw = await readBody(req);
    input = JSON.parse(raw);
  } catch {
    res.status(400).json({ error: 'Invalid JSON' });
    return;
  }

  const { api_key, service, path: apiPath, method = 'GET', body: reqBody } = input;

  if (!api_key || !service || !apiPath || !SERVICES[service]) {
    res.status(400).json({ error: 'Missing api_key, service or path' });
    return;
  }

  const targetUrl = SERVICES[service] + apiPath;
  try {
    const result = await proxyRequest(targetUrl, method.toUpperCase(), api_key, reqBody ?? null);
    res.status(result.status).setHeader('Content-Type', 'application/json').send(result.body);
  } catch (e) {
    res.status(502).json({ error: 'Upstream error: ' + e.message });
  }
};
