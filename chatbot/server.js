const http = require('http');
const fs = require('fs');
const path = require('path');

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 8088);
const qwenBaseUrl = process.env.QWEN_BASE_URL || 'http://127.0.0.1:1234/v1';
const qwenModel = process.env.QWEN_MODEL || 'qwen3-4b-instruct-2507-q5_k_m';
const qwenApiKey = process.env.QWEN_API_KEY || '';
const accessToken = process.env.CHATBOT_ACCESS_TOKEN || '';
const allowedOrigins = (process.env.CHATBOT_ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const publicDir = __dirname;

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

function corsHeaders(request) {
  const origin = request.headers.origin;
  if (!origin || !allowedOrigins.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };
}

function sendJson(request, response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...corsHeaders(request)
  });
  response.end(JSON.stringify(payload));
}

function isAuthorized(request) {
  if (!accessToken && host === '127.0.0.1') return true;
  const header = request.headers.authorization || '';
  return header === `Bearer ${accessToken}`;
}

function readRequestJson(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        request.destroy();
        reject(new Error('Request body too large.'));
      }
    });
    request.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error('Invalid JSON request.'));
      }
    });
    request.on('error', reject);
  });
}

async function handleChat(request, response) {
  if (!isAuthorized(request)) {
    sendJson(request, response, 401, { error: 'Missing or invalid access token.' });
    return;
  }

  try {
    const body = await readRequestJson(request);
    const upstreamResponse = await fetch(`${qwenBaseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(qwenApiKey ? { Authorization: `Bearer ${qwenApiKey}` } : {})
      },
      body: JSON.stringify({
        model: body.model || qwenModel,
        messages: Array.isArray(body.messages) ? body.messages : [],
        temperature: Number.isFinite(body.temperature) ? body.temperature : 0.7,
        stream: false
      })
    });

    const text = await upstreamResponse.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (error) {
      data = { raw: text };
    }

    if (!upstreamResponse.ok) {
      sendJson(request, response, upstreamResponse.status, {
        error: data.error || data.raw || `Qwen request failed: ${upstreamResponse.status}`
      });
      return;
    }

    const reply = data.choices?.[0]?.message?.content || data.choices?.[0]?.text || '';
    sendJson(request, response, 200, { reply });
  } catch (error) {
    sendJson(request, response, 500, { error: error.message });
  }
}

function serveStatic(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  const safePath = requestUrl.pathname === '/' ? '/index.html' : decodeURIComponent(requestUrl.pathname);
  const filePath = path.normalize(path.join(publicDir, safePath));

  if (!filePath.startsWith(publicDir)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }

    response.writeHead(200, {
      'Content-Type': mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
    });
    response.end(content);
  });
}

const server = http.createServer((request, response) => {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, corsHeaders(request));
    response.end();
    return;
  }

  if (request.url.startsWith('/api/chat')) {
    if (request.method !== 'POST') {
      sendJson(request, response, 405, { error: 'POST required.' });
      return;
    }
    handleChat(request, response);
    return;
  }

  if (request.method !== 'GET') {
    response.writeHead(405);
    response.end('GET required.');
    return;
  }

  serveStatic(request, response);
});

server.listen(port, host, () => {
  console.log(`Qwen chat widget server listening at http://${host}:${port}`);
  console.log(`Relay target: ${qwenBaseUrl}/chat/completions`);
  if (host !== '127.0.0.1' && !accessToken) {
    console.warn('Public host without CHATBOT_ACCESS_TOKEN is not recommended.');
  }
});
