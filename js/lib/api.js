// Client for the official VEX Events API (https://events.vex.com/api/v2).
// Calls go straight from the browser (the API allows cross-origin requests) using the
// API key saved on this device, or through the optional Cloudflare Worker proxy.
import * as db from './db.js';
import { getState, workerUrl } from './state.js';
import { sleep } from './util.js';

const API = 'https://events.vex.com/api/v2';
const PUBLIC = 'https://events.vex.com/api';

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}
export class NoAuthError extends ApiError {
  constructor(message = 'Live VEX data needs an API key') { super(message, 401); this.noAuth = true; }
}

export const hasLive = () => !!(workerUrl() || getState().settings.apiToken);
const base = () => (workerUrl() ? workerUrl() + '/vex' : API);

// While set, every request skips the cache (used by pull-to-refresh / refresh buttons).
let forceUntil = 0;
export function forceFresh(ms = 4000) { forceUntil = Date.now() + ms; }
const forced = () => Date.now() < forceUntil;

function buildQuery(params = {}) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === '') continue;
    if (Array.isArray(v)) v.forEach((x) => sp.append(k.endsWith('[]') ? k : k + '[]', x));
    else sp.append(k, typeof v === 'boolean' ? (v ? 'true' : 'false') : v);
  }
  const s = sp.toString();
  return s ? '?' + s : '';
}

// ---- request queue: a few requests at a time, backing off when the API says so ----
const MAX_ACTIVE = 4;
let active = 0;
let pausedUntil = 0;
const waiting = [];

function schedule(task) {
  return new Promise((resolve, reject) => {
    waiting.push({ task, resolve, reject });
    pump();
  });
}
async function pump() {
  if (active >= MAX_ACTIVE || !waiting.length) return;
  const wait = pausedUntil - Date.now();
  if (wait > 0) { setTimeout(pump, wait + 20); return; }
  const job = waiting.shift();
  active++;
  try { job.resolve(await job.task()); } catch (e) { job.reject(e); } finally { active--; pump(); }
  pump();
}

async function request(url, { auth = true } = {}, attempt = 0) {
  const headers = { Accept: 'application/json' };
  const token = getState().settings.apiToken;
  if (auth && !workerUrl() && token) headers.Authorization = 'Bearer ' + token.trim();
  let res;
  try {
    res = await fetch(url, { headers, mode: 'cors' });
  } catch (e) {
    throw new ApiError(navigator.onLine ? 'Could not reach events.vex.com' : 'You are offline', 0);
  }
  const remaining = Number(res.headers.get('x-ratelimit-remaining'));
  if (!Number.isNaN(remaining) && remaining < 3) pausedUntil = Math.max(pausedUntil, Date.now() + 1500);
  if (res.status === 429 && attempt < 4) {
    const ra = Number(res.headers.get('retry-after'));
    pausedUntil = Date.now() + (ra > 0 ? ra * 1000 : 1500 * (attempt + 1));
    await sleep(pausedUntil - Date.now());
    return request(url, { auth }, attempt + 1);
  }
  if (res.status === 401 || res.status === 403) throw new NoAuthError(token ? 'The VEX API key was rejected — check it in Settings' : undefined);
  if (res.status === 404) throw new ApiError('Not found', 404);
  if (!res.ok) {
    if (res.status >= 500 && attempt < 2) { await sleep(800 * (attempt + 1)); return request(url, { auth }, attempt + 1); }
    throw new ApiError(`VEX API error (${res.status})`, res.status);
  }
  return res.json();
}

const cacheKey = (path, params) => 'api:' + path + buildQuery(params);

// Read a cached response regardless of age (used to paint instantly, then refresh).
export async function peek(path, params) {
  const c = await db.get('cache', cacheKey(path, params)).catch(() => null);
  return c ? c.v : undefined;
}

/**
 * GET an API path with caching.
 * ttl: seconds a cached copy stays fresh. Stale copies are still returned when offline.
 */
export async function api(path, params = {}, { ttl = 300, force = false } = {}) {
  const key = cacheKey(path, params);
  const cached = await db.get('cache', key).catch(() => null);
  if (cached && !force && !forced() && Date.now() - cached.t < ttl * 1000) return cached.v;
  if (!hasLive()) {
    if (cached) return cached.v;
    throw new NoAuthError();
  }
  try {
    const v = await schedule(() => request(base() + path + buildQuery(params)));
    db.put('cache', { t: Date.now(), v }, key).catch(() => {});
    return v;
  } catch (e) {
    if (cached && !e.noAuth) return cached.v;
    throw e;
  }
}

// Fetch every page of a paginated endpoint.
export async function apiAll(path, params = {}, opts = {}) {
  const key = cacheKey(path, { ...params, all: 1 });
  const ttl = opts.ttl ?? 300;
  const cached = await db.get('cache', key).catch(() => null);
  if (cached && !opts.force && !forced() && Date.now() - cached.t < ttl * 1000) return cached.v;
  if (!hasLive()) {
    if (cached) return cached.v;
    throw new NoAuthError();
  }
  try {
    const first = await schedule(() => request(base() + path + buildQuery({ ...params, per_page: 250, page: 1 })));
    let data = first.data || [];
    const last = (first.meta && first.meta.last_page) || 1;
    if (last > 1) {
      const rest = await Promise.all(Array.from({ length: last - 1 }, (_, i) =>
        schedule(() => request(base() + path + buildQuery({ ...params, per_page: 250, page: i + 2 })))));
      rest.forEach((r) => { data = data.concat(r.data || []); });
    }
    db.put('cache', { t: Date.now(), v: data }, key).catch(() => {});
    return data;
  } catch (e) {
    if (cached && !e.noAuth) return cached.v;
    throw e;
  }
}
export async function peekAll(path, params = {}) {
  const c = await db.get('cache', cacheKey(path, { ...params, all: 1 })).catch(() => null);
  return c ? c.v : undefined;
}

// World skills standings: a public endpoint (no API key needed).
export async function worldSkills(seasonId, grade = 'High School', { ttl = 900, force = false } = {}) {
  const key = `ws:${seasonId}:${grade}`;
  const cached = await db.get('cache', key).catch(() => null);
  if (cached && !force && !forced() && Date.now() - cached.t < ttl * 1000) return cached.v;
  try {
    const url = `${PUBLIC}/seasons/${seasonId}/skills?post_season=0&grade_level=${encodeURIComponent(grade)}`;
    const v = await schedule(() => request(url, { auth: false }));
    const list = Array.isArray(v) ? v : [];
    db.put('cache', { t: Date.now(), v: list }, key).catch(() => {});
    return list;
  } catch (e) {
    if (cached) return cached.v;
    throw e;
  }
}
export async function peekWorldSkills(seasonId, grade) {
  const c = await db.get('cache', `ws:${seasonId}:${grade}`).catch(() => null);
  return c ? c.v : undefined;
}

// Quick check used by Settings to validate a key.
export async function testKey() {
  const r = await request(base() + '/programs' + buildQuery({ per_page: 1 }));
  return !!r;
}

// ---------- Endpoint helpers ----------
export const ep = {
  seasons: (program) => api('/seasons', { 'program[]': [program], active: true }, { ttl: 86400 }),
  teamsByNumber: (numbers, program) => api('/teams', { 'number[]': numbers, 'program[]': program ? [program] : undefined }, { ttl: 86400 }),
  team: (id) => api(`/teams/${id}`, {}, { ttl: 86400 }),
  teamEvents: (id, season) => apiAll(`/teams/${id}/events`, { 'season[]': season ? [season] : undefined }, { ttl: 1800 }),
  teamMatches: (id, season, live) => apiAll(`/teams/${id}/matches`, { 'season[]': season ? [season] : undefined }, { ttl: live ? 30 : 900 }),
  teamRankings: (id, season) => apiAll(`/teams/${id}/rankings`, { 'season[]': season ? [season] : undefined }, { ttl: 900 }),
  teamSkills: (id, season) => apiAll(`/teams/${id}/skills`, { 'season[]': season ? [season] : undefined }, { ttl: 900 }),
  teamAwards: (id, season) => apiAll(`/teams/${id}/awards`, { 'season[]': season ? [season] : undefined }, { ttl: 3600 }),
  event: (id, ttl = 600) => api(`/events/${id}`, {}, { ttl }),
  eventsBySku: (skus) => api('/events', { 'sku[]': skus }, { ttl: 3600 }),
  eventTeams: (id) => apiAll(`/events/${id}/teams`, {}, { ttl: 1800 }),
  divisionMatches: (id, div, live) => apiAll(`/events/${id}/divisions/${div}/matches`, {}, { ttl: live ? 25 : 3600 }),
  divisionRankings: (id, div, live) => apiAll(`/events/${id}/divisions/${div}/rankings`, {}, { ttl: live ? 45 : 3600 }),
  divisionFinalists: (id, div, live) => apiAll(`/events/${id}/divisions/${div}/finalistRankings`, {}, { ttl: live ? 60 : 3600 }),
  eventSkills: (id, live) => apiAll(`/events/${id}/skills`, {}, { ttl: live ? 60 : 3600 }),
  eventAwards: (id, live) => apiAll(`/events/${id}/awards`, {}, { ttl: live ? 120 : 3600 }),
  seasonEvents: (season, params = {}) => apiAll(`/seasons/${season}/events`, params, { ttl: 3600 }),
  seasonQA: (season, force) => api(`/seasons/${season}/qa`, {}, { ttl: 1800, force }),
  judgingQA: (force) => api('/judging/qa', {}, { ttl: 3600, force })
};
