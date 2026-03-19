// Vercel Serverless Function – LMC API Proxy
const https = require('https');
const url   = require('url');

const DEFAULT_BASE = 'cloud.lancom.de';
const SERVICE_NAMES = ['devices','monitoring','monitor-frontend','useragent','auth','config','notification','devicetunnel','siem','logging'];

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

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => (body += c));
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function parseInput(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (req.body && typeof req.body === 'string') return JSON.parse(req.body);
  return readBody(req).then(raw => JSON.parse(raw));
}

const PKG_VERSION = '1.6.0';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('X-App-Version', PKG_VERSION);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method === 'GET') {
    res.status(200).json({ status: 'ok', version: PKG_VERSION });
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  let input;
  try {
    input = await parseInput(req);
  } catch (e) {
    res.status(400).json({ error: 'Invalid JSON', detail: e.message, bodyType: typeof req.body });
    return;
  }

  const { api_key, service, path: apiPath, method = 'GET', body: reqBody, base_url } = input;
  const services = buildServices(base_url);

  if (!api_key || !service || !apiPath || !services[service]) {
    res.status(400).json({
      error: 'Missing api_key, service or path',
      debug: { hasKey: !!api_key, keyLen: (api_key||'').length, service, path: apiPath, base_url: base_url||null }
    });
    return;
  }

  const targetUrl = services[service] + apiPath;
  try {
    const result = await proxyRequest(targetUrl, method.toUpperCase(), api_key, reqBody ?? null);
    if (result.status === 401) {
      res.status(401).json({
        error: 'Authentication failed (401)',
        upstream: targetUrl.replace(/cloud-service-\w+/, 'cloud-service-***'),
        keyPrefix: api_key.substring(0, 8) + '…',
        upstreamBody: result.body.substring(0, 500)
      });
      return;
    }
    res.status(result.status).setHeader('Content-Type', 'application/json').send(result.body);
  } catch (e) {
    res.status(502).json({ error: 'Upstream error: ' + e.message });
  }
};
