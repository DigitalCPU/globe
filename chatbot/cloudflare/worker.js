const ALLOWED_ORIGINS = new Set([
  'https://livesatellite.netlify.app',
  'https://digitalcpu.github.io',
  'http://127.0.0.1:8019',
  'http://localhost:8019'
]);

const MAX_TEXT_FILE_BYTES = 512 * 1024;

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allowOrigin = ALLOWED_ORIGINS.has(origin) ? origin : 'https://livesatellite.netlify.app';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Update-Secret, X-Admin-Secret, X-Globe-User',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Vary': 'Origin'
  };
}

function json(data, status, request) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(request)
    }
  });
}

function normalizeEndpoint(value) {
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    return '';
  }
  if (url.protocol !== 'https:') return '';
  if (!url.hostname.endsWith('.trycloudflare.com')) return '';
  return url.origin;
}

function userKey(request) {
  const header = request.headers.get('X-Globe-User') || '';
  const auth = request.headers.get('Authorization') || '';
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : '';
  const value = (header || token).trim();
  return /^[a-zA-Z0-9_-]{24,96}$/.test(value) ? value : '';
}

function adminAllowed(request, env) {
  const provided = request.headers.get('X-Admin-Secret')
    || request.headers.get('X-Update-Secret')
    || new URL(request.url).searchParams.get('secret')
    || '';
  return provided === env.UPDATE_SECRET;
}

function newId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function titleFromMessages(messages) {
  const firstUser = messages.find((message) => message.role === 'user');
  const raw = String(firstUser?.content || 'New chat').replace(/\s+/g, ' ').trim();
  return raw.slice(0, 70) || 'New chat';
}

async function readJson(request, maxBytes = 1024 * 1024) {
  const size = Number(request.headers.get('Content-Length') || 0);
  if (size > maxBytes) throw new Error('Request body is too large.');
  return request.json();
}

async function proxyToTunnel(request, env, pathname) {
  const tunnelBase = await env.RELAY.get('tunnel_base');
  if (!tunnelBase) return json({ error: 'Tunnel is not online yet.' }, 503, request);

  const upstream = new URL(pathname, tunnelBase);
  const headers = new Headers(request.headers);
  headers.delete('host');
  const response = await fetch(upstream, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    redirect: 'manual'
  });
  const outHeaders = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(request))) outHeaders.set(key, value);
  return new Response(response.body, { status: response.status, headers: outHeaders });
}

async function listConversations(request, env, user) {
  const rows = await env.DB.prepare(
    'SELECT id, title, created_at, updated_at FROM conversations WHERE user_key = ? ORDER BY updated_at DESC LIMIT 50'
  ).bind(user).all();
  return json({ conversations: rows.results || [] }, 200, request);
}

async function getConversation(request, env, user, id) {
  const conversation = await env.DB.prepare(
    'SELECT id, title, created_at, updated_at FROM conversations WHERE user_key = ? AND id = ?'
  ).bind(user, id).first();
  if (!conversation) return json({ error: 'Conversation not found.' }, 404, request);

  const messages = await env.DB.prepare(
    'SELECT role, content, created_at FROM messages WHERE user_key = ? AND conversation_id = ? ORDER BY created_at ASC'
  ).bind(user, id).all();
  return json({ conversation, messages: messages.results || [] }, 200, request);
}

async function saveConversation(request, env, user) {
  const body = await readJson(request);
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (!messages.length) return json({ error: 'messages are required.' }, 400, request);

  const now = new Date().toISOString();
  const id = String(body.id || '').startsWith('chat_') ? String(body.id) : newId('chat');
  const title = String(body.title || titleFromMessages(messages)).slice(0, 120);

  await env.DB.prepare(
    `INSERT INTO conversations (id, user_key, title, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at`
  ).bind(id, user, title, now, now).run();

  await env.DB.prepare('DELETE FROM messages WHERE user_key = ? AND conversation_id = ?').bind(user, id).run();

  const statements = messages
    .filter((message) => ['system', 'user', 'assistant'].includes(message.role))
    .slice(-300)
    .map((message, index) => env.DB.prepare(
      'INSERT INTO messages (id, conversation_id, user_key, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(
      newId('msg'),
      id,
      user,
      message.role,
      String(message.content || '').slice(0, 200000),
      new Date(Date.now() + index).toISOString()
    ));

  if (statements.length) await env.DB.batch(statements);
  return json({ ok: true, conversation: { id, title, created_at: now, updated_at: now } }, 200, request);
}

async function deleteConversation(request, env, user, id) {
  await env.DB.prepare('DELETE FROM messages WHERE user_key = ? AND conversation_id = ?').bind(user, id).run();
  await env.DB.prepare('DELETE FROM conversations WHERE user_key = ? AND id = ?').bind(user, id).run();
  return json({ ok: true }, 200, request);
}

async function uploadTextFile(request, env, user) {
  const body = await readJson(request, MAX_TEXT_FILE_BYTES + 2048);
  const content = String(body.content || '');
  const size = new TextEncoder().encode(content).length;
  if (!body.name || !content) return json({ error: 'name and content are required.' }, 400, request);
  if (size > MAX_TEXT_FILE_BYTES) return json({ error: 'Text file exceeds the 512 KB v1 limit.' }, 413, request);

  const now = new Date().toISOString();
  const id = newId('file');
  await env.DB.prepare(
    `INSERT INTO files (id, user_key, conversation_id, name, type, size, content, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    user,
    body.conversation_id || null,
    String(body.name).slice(0, 180),
    String(body.type || 'text/plain').slice(0, 120),
    size,
    content,
    now
  ).run();

  return json({ ok: true, file: { id, name: body.name, type: body.type || 'text/plain', size, created_at: now } }, 200, request);
}

async function listFiles(request, env, user) {
  const rows = await env.DB.prepare(
    'SELECT id, conversation_id, name, type, size, created_at FROM files WHERE user_key = ? ORDER BY created_at DESC LIMIT 50'
  ).bind(user).all();
  return json({ files: rows.results || [] }, 200, request);
}

async function getFile(request, env, user, id) {
  const file = await env.DB.prepare(
    'SELECT id, conversation_id, name, type, size, content, created_at FROM files WHERE user_key = ? AND id = ?'
  ).bind(user, id).first();
  if (!file) return json({ error: 'File not found.' }, 404, request);
  return json({ file }, 200, request);
}

async function handleCloudStorage(request, env, url) {
  const user = userKey(request);
  if (!user) return json({ error: 'Missing X-Globe-User.' }, 401, request);

  const parts = url.pathname.split('/').filter(Boolean);
  const resource = parts[2];
  const id = parts[3] || '';

  if (resource === 'conversations' && request.method === 'GET' && !id) return listConversations(request, env, user);
  if (resource === 'conversations' && request.method === 'POST' && !id) return saveConversation(request, env, user);
  if (resource === 'conversations' && request.method === 'GET' && id) return getConversation(request, env, user, id);
  if (resource === 'conversations' && request.method === 'DELETE' && id) return deleteConversation(request, env, user, id);

  if (resource === 'files' && request.method === 'GET' && !id) return listFiles(request, env, user);
  if (resource === 'files' && request.method === 'POST' && !id) return uploadTextFile(request, env, user);
  if (resource === 'files' && request.method === 'GET' && id) return getFile(request, env, user, id);

  return json({ error: 'Cloud storage route not found.' }, 404, request);
}

async function adminListUsers(request, env) {
  const rows = await env.DB.prepare(
    `SELECT
       user_key,
       COUNT(*) AS conversations,
       MIN(created_at) AS first_seen,
       MAX(updated_at) AS last_seen
     FROM conversations
     GROUP BY user_key
     ORDER BY last_seen DESC
     LIMIT 200`
  ).all();
  return json({ users: rows.results || [] }, 200, request);
}

async function adminListConversations(request, env) {
  const rows = await env.DB.prepare(
    `SELECT
       id,
       user_key,
       title,
       created_at,
       updated_at
     FROM conversations
     ORDER BY updated_at DESC
     LIMIT 200`
  ).all();
  return json({ conversations: rows.results || [] }, 200, request);
}

async function adminGetConversation(request, env, id) {
  const conversation = await env.DB.prepare(
    'SELECT id, user_key, title, created_at, updated_at FROM conversations WHERE id = ?'
  ).bind(id).first();
  if (!conversation) return json({ error: 'Conversation not found.' }, 404, request);

  const messages = await env.DB.prepare(
    'SELECT role, content, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
  ).bind(id).all();
  return json({ conversation, messages: messages.results || [] }, 200, request);
}

async function adminListFiles(request, env) {
  const rows = await env.DB.prepare(
    `SELECT
       id,
       user_key,
       conversation_id,
       name,
       type,
       size,
       created_at
     FROM files
     ORDER BY created_at DESC
     LIMIT 200`
  ).all();
  return json({ files: rows.results || [] }, 200, request);
}

async function handleAdmin(request, env, url) {
  if (!adminAllowed(request, env)) return json({ error: 'Unauthorized.' }, 401, request);

  const parts = url.pathname.split('/').filter(Boolean);
  const offset = parts[0] === 'api' ? 2 : 1;
  const resource = parts[offset];
  const id = parts[offset + 1] || '';

  if (resource === 'users' && request.method === 'GET') return adminListUsers(request, env);
  if (resource === 'conversations' && request.method === 'GET' && !id) return adminListConversations(request, env);
  if (resource === 'conversations' && request.method === 'GET' && id) return adminGetConversation(request, env, id);
  if (resource === 'files' && request.method === 'GET') return adminListFiles(request, env);

  return json({ error: 'Admin route not found.' }, 404, request);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request) });

    if (url.pathname === '/admin/tunnel' && request.method === 'POST') {
      const provided = request.headers.get('X-Update-Secret') || url.searchParams.get('secret') || '';
      if (provided !== env.UPDATE_SECRET) return json({ error: 'Unauthorized.' }, 401, request);
      const body = await request.json().catch(() => ({}));
      const tunnelBase = normalizeEndpoint(body.endpoint || body.tunnel || '');
      if (!tunnelBase) return json({ error: 'Expected an https://*.trycloudflare.com endpoint.' }, 400, request);
      await env.RELAY.put('tunnel_base', tunnelBase);
      await env.RELAY.put('updated_at', new Date().toISOString());
      return json({ ok: true, tunnel_base: tunnelBase }, 200, request);
    }

    if (url.pathname.startsWith('/admin/') || url.pathname.startsWith('/api/admin/')) {
      return handleAdmin(request, env, url);
    }

    if (url.pathname === '/api/status' && request.method === 'GET') return proxyToTunnel(request, env, '/api/status');
    if (url.pathname === '/api/news' && request.method === 'GET') return proxyToTunnel(request, env, `/api/news${url.search}`);
    if (url.pathname === '/api/geocode' && request.method === 'GET') return proxyToTunnel(request, env, `/api/geocode${url.search}`);
    if (url.pathname === '/api/geo' && request.method === 'POST') return proxyToTunnel(request, env, '/api/geo');
    if (url.pathname === '/api/voice/status' && request.method === 'GET') return proxyToTunnel(request, env, '/api/voice/status');
    if (url.pathname === '/api/voice/providers' && request.method === 'GET') return proxyToTunnel(request, env, '/api/voice/providers');
    if (url.pathname === '/api/voice/voices' && request.method === 'GET') return proxyToTunnel(request, env, `/api/voice/voices${url.search}`);
    if (url.pathname === '/api/voice/tts' && request.method === 'POST') return proxyToTunnel(request, env, '/api/voice/tts');
    if (url.pathname === '/api/voice/last.wav' && request.method === 'GET') return proxyToTunnel(request, env, '/api/voice/last.wav');
    if ((url.pathname === '/api/chat' || url.pathname === '/v1/chat/completions') && request.method === 'POST') {
      return proxyToTunnel(request, env, url.pathname);
    }
    if (url.pathname.startsWith('/api/cloud/')) return handleCloudStorage(request, env, url);

    if (url.pathname === '/' && request.method === 'GET') {
      const tunnelBase = await env.RELAY.get('tunnel_base');
      const updatedAt = await env.RELAY.get('updated_at');
      return json({
        service: 'globe-qwen-relay',
        ready: Boolean(tunnelBase),
        storage: Boolean(env.DB),
        tunnel_base: tunnelBase || null,
        updated_at: updatedAt || null
      }, 200, request);
    }

    return json({ error: 'Not found.' }, 404, request);
  }
};
