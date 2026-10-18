// Override Scout team server (optional) — a Cloudflare Worker.
//
// 1. /vex/*  proxies the VEX Events API with your API key kept secret on the server,
//            and caches responses at the edge so the whole team shares one fast cache.
// 2. /ws/*   team workspaces: scouting notes, pick lists and practice runs sync between phones.
//
// Bindings (Worker → Settings → Variables and Secrets / Bindings):
//   VEX_API_TOKEN    secret   your events.vex.com API key
//   DB               D1       a D1 database (tables are created automatically)
//   ALLOWED_ORIGINS  text     e.g. https://yourname.github.io  (comma separated; empty = allow all)

const API = 'https://events.vex.com/api/v2';

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const cors = corsHeaders(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (cors === null) return json({ error: 'Origin not allowed' }, {}, 403);
    try {
      if (url.pathname === '/health') return json({ ok: true, proxy: !!env.VEX_API_TOKEN, sync: !!env.DB }, cors);
      if (url.pathname.startsWith('/vex/')) return withHeaders(await proxy(req, url, env, ctx), cors);
      if (url.pathname === '/ws' && req.method === 'POST') return json(await createWorkspace(req, env), cors);
      const m = url.pathname.match(/^\/ws\/([A-Za-z0-9_-]{6,40})\/(push|pull)$/);
      if (m) {
        await ensureSchema(env);
        const ws = await auth(env, m[1], req.headers.get('X-Workspace-Key'));
        if (!ws) return json({ error: 'Workspace not found or wrong key' }, cors, 401);
        if (m[2] === 'push' && req.method === 'POST') return json(await push(req, env, ws), cors);
        if (m[2] === 'pull') return json(await pull(url, env, ws), cors);
      }
      return json({ error: 'Not found' }, cors, 404);
    } catch (e) {
      return json({ error: e.message || 'Server error' }, cors, 500);
    }
  }
};

// ---------- helpers ----------
function corsHeaders(req, env) {
  const origin = req.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (origin && allowed.length && !allowed.includes(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Workspace-Key',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}
function json(body, headers = {}, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}
function withHeaders(res, headers) {
  const r = new Response(res.body, res);
  Object.entries(headers).forEach(([k, v]) => r.headers.set(k, v));
  return r;
}
function randomId(bytes = 12) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function sha256(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- VEX API proxy with edge caching ----------
function ttlFor(path) {
  if (/\/(matches|rankings|finalistRankings)$/.test(path)) return 20;
  if (/\/(skills|awards)$/.test(path)) return 60;
  if (/\/qa$/.test(path)) return 900;
  if (/^\/(seasons|programs)/.test(path)) return 3600;
  return 300;
}
async function proxy(req, url, env, ctx) {
  if (req.method !== 'GET') return json({ error: 'GET only' }, {}, 405);
  if (!env.VEX_API_TOKEN) return json({ error: 'VEX_API_TOKEN is not configured on the server' }, {}, 401);
  const path = url.pathname.slice(4); // strip "/vex"
  const target = API + path + url.search;
  const cache = caches.default;
  const key = new Request('https://cache.override-scout' + path + url.search);
  const hit = await cache.match(key);
  if (hit) return hit;
  const res = await fetch(target, { headers: { Authorization: 'Bearer ' + env.VEX_API_TOKEN, Accept: 'application/json' } });
  const out = new Response(res.body, res);
  out.headers.delete('set-cookie');
  if (res.ok) {
    out.headers.set('Cache-Control', `public, max-age=${ttlFor(path)}`);
    ctx.waitUntil(cache.put(key, out.clone()));
  }
  return out;
}

// ---------- Workspaces (D1) ----------
let schemaReady = false;
async function ensureSchema(env) {
  if (!env.DB) throw new Error('No D1 database bound as DB');
  if (schemaReady) return;
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS ws (id TEXT PRIMARY KEY, key_hash TEXT NOT NULL, name TEXT, created INTEGER, seq INTEGER NOT NULL DEFAULT 0)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS docs (ws TEXT NOT NULL, id TEXT NOT NULL, seq INTEGER NOT NULL, updated INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY (ws, id))'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS docs_seq ON docs (ws, seq)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS members (ws TEXT NOT NULL, id TEXT NOT NULL, name TEXT, team TEXT, last_seen INTEGER, PRIMARY KEY (ws, id))')
  ]);
  schemaReady = true;
}

async function createWorkspace(req, env) {
  await ensureSchema(env);
  const body = await req.json().catch(() => ({}));
  const id = randomId(8);
  const key = randomId(18);
  const name = String(body.name || 'Scouting').slice(0, 60);
  await env.DB.prepare('INSERT INTO ws (id, key_hash, name, created, seq) VALUES (?, ?, ?, ?, 0)').bind(id, await sha256(key), name, Date.now()).run();
  if (body.member && body.member.id) await touchMember(env, id, body.member);
  return { id, key, name };
}

async function auth(env, id, key) {
  if (!key) return null;
  const ws = await env.DB.prepare('SELECT id, name, key_hash FROM ws WHERE id = ?').bind(id).first();
  if (!ws || ws.key_hash !== await sha256(key)) return null;
  return ws;
}

async function touchMember(env, ws, m) {
  await env.DB.prepare('INSERT INTO members (ws, id, name, team, last_seen) VALUES (?, ?, ?, ?, ?) ON CONFLICT(ws, id) DO UPDATE SET name = excluded.name, team = excluded.team, last_seen = excluded.last_seen')
    .bind(ws, String(m.id).slice(0, 40), String(m.name || '').slice(0, 60), String(m.team || '').slice(0, 12), Date.now()).run();
}

async function push(req, env, ws) {
  const body = await req.json();
  const docs = (Array.isArray(body.docs) ? body.docs : []).filter((d) => d && typeof d.id === 'string' && d.id.length <= 64).slice(0, 500);
  if (body.member && body.member.id) await touchMember(env, ws.id, body.member);
  if (!docs.length) return { ok: true, stored: 0 };
  // Keep only docs newer than what the server has
  const existing = new Map();
  for (let i = 0; i < docs.length; i += 90) {
    const ids = docs.slice(i, i + 90).map((d) => d.id);
    const rows = await env.DB.prepare(`SELECT id, updated FROM docs WHERE ws = ? AND id IN (${ids.map(() => '?').join(',')})`).bind(ws.id, ...ids).all();
    (rows.results || []).forEach((r) => existing.set(r.id, r.updated));
  }
  const fresh = docs.filter((d) => !existing.has(d.id) || (Number(d.updatedAt) || 0) > existing.get(d.id))
    .map((d) => ({ d, body: JSON.stringify(d) })).filter((x) => x.body.length <= 200000);
  if (!fresh.length) return { ok: true, stored: 0 };
  // Reserve a block of sequence numbers atomically
  const top = await env.DB.prepare('UPDATE ws SET seq = seq + ? WHERE id = ? RETURNING seq').bind(fresh.length, ws.id).first();
  let seq = top.seq - fresh.length;
  await env.DB.batch(fresh.map(({ d, body: b }) => env.DB.prepare(
    'INSERT INTO docs (ws, id, seq, updated, body) VALUES (?, ?, ?, ?, ?) ON CONFLICT(ws, id) DO UPDATE SET seq = excluded.seq, updated = excluded.updated, body = excluded.body'
  ).bind(ws.id, d.id, ++seq, Number(d.updatedAt) || Date.now(), b)));
  return { ok: true, stored: fresh.length };
}

async function pull(url, env, ws) {
  const since = Math.max(0, Number(url.searchParams.get('since')) || 0);
  const member = url.searchParams.get('member');
  if (member) await env.DB.prepare('UPDATE members SET last_seen = ? WHERE ws = ? AND id = ?').bind(Date.now(), ws.id, member).run();
  const rows = await env.DB.prepare('SELECT seq, body FROM docs WHERE ws = ? AND seq > ? ORDER BY seq LIMIT 1000').bind(ws.id, since).all();
  const list = rows.results || [];
  const members = await env.DB.prepare('SELECT id, name, team, last_seen AS lastSeen FROM members WHERE ws = ? ORDER BY last_seen DESC LIMIT 100').bind(ws.id).all();
  return {
    name: ws.name,
    docs: list.map((r) => JSON.parse(r.body)),
    cursor: list.length ? list[list.length - 1].seq : since,
    members: members.results || []
  };
}
