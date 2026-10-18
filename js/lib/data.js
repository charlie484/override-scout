// Unified data layer. Combines:
//  1. the season snapshot published by the GitHub Action (TrueSkill, team index, events, matches) — no key needed
//  2. the live VEX Events API (needs an API key on the device, or the Worker proxy) — for up-to-the-minute data
import { useState, useEffect, useRef, useCallback } from './html.js';
import * as db from './db.js';
import { ep, hasLive, worldSkills, NoAuthError, forceFresh } from './api.js';
import { getState, subscribe } from './state.js';
import { PROGRAM_IDS, eventStatus, norm, matchScore } from './util.js';
import { TS } from './stats.js';

const CFG = window.OVERRIDE_CONFIG || {};
const DATA = (CFG.dataBase || 'data').replace(/\/+$/, '');
const prog = () => getState().settings.program || 'V5RC';
const pdir = (p = prog()) => p.toLowerCase();

// ---------- Snapshot files ----------
const snapMem = new Map();
export async function snap(path, { fresh = false } = {}) {
  if (!fresh && snapMem.has(path)) return snapMem.get(path);
  const p = fetch(`${DATA}/${path}`, { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  snapMem.set(path, p);
  const v = await p;
  if (v == null) setTimeout(() => snapMem.delete(path), 60000);
  return v;
}
export const manifest = () => snap('manifest.json');

function expandRows(t) {
  if (!t || !t.fields) return [];
  return t.rows.map((r) => Object.fromEntries(t.fields.map((f, i) => [f, r[i]])));
}

// ---------- Normalizing matches ----------
function side(a) {
  if (!a) return { score: 0, teams: [], sitting: [] };
  const teams = (a.teams || []).map((t) => (t.team && (t.team.name || t.team.code)) || '').filter(Boolean);
  const sitting = (a.teams || []).filter((t) => t.sitting).map((t) => t.team && t.team.name).filter(Boolean);
  return { score: a.score == null ? 0 : a.score, teams, sitting };
}
export function normMatch(m) {
  const red = (m.alliances || []).find((a) => a.color === 'red');
  const blue = (m.alliances || []).find((a) => a.color === 'blue');
  return {
    id: m.id, event: m.event, division: m.division, round: m.round, instance: m.instance, matchnum: m.matchnum,
    scheduled: m.scheduled || null, started: m.started || null, field: m.field || '', scored: !!m.scored, name: m.name,
    red: side(red), blue: side(blue)
  };
}
// Snapshot matches are stored compactly: {i,e,d,r,n,m,s,f,rt,bt,rs,bs,sc,rx,bx}
export function expandMatch(c, eventMeta) {
  return {
    id: c.i, event: eventMeta || { id: c.e }, division: { id: c.d }, round: c.r, instance: c.n, matchnum: c.m,
    scheduled: c.s || null, started: c.st || null, field: c.f || '', scored: !!c.sc, name: '',
    red: { score: c.rs || 0, teams: c.rt || [], sitting: c.rx || [] },
    blue: { score: c.bs || 0, teams: c.bt || [], sitting: c.bx || [] }
  };
}
export const isPlayed = (m) => m.scored || m.red.score > 0 || m.blue.score > 0;
export const inMatch = (m, team) => m.red.teams.includes(team) || m.blue.teams.includes(team);
export function sideOf(m, team) { return m.red.teams.includes(team) ? 'red' : m.blue.teams.includes(team) ? 'blue' : null; }
export function resultFor(m, team) {
  const s = sideOf(m, team);
  if (!s || !isPlayed(m)) return null;
  const own = m[s].score, opp = m[s === 'red' ? 'blue' : 'red'].score;
  return own > opp ? 'W' : own < opp ? 'L' : 'T';
}

// ---------- Season ----------
let seasonMem = {};
export async function seasonId(program = prog()) {
  if (seasonMem[program]) return seasonMem[program];
  if (hasLive()) {
    try {
      const r = await ep.seasons(PROGRAM_IDS[program]);
      const list = (r.data || []).sort((a, b) => b.id - a.id);
      if (list.length) { seasonMem[program] = list[0].id; return list[0].id; }
    } catch (e) { /* fall back */ }
  }
  const m = await manifest();
  const id = (m && m.programs && m.programs[program] && m.programs[program].season) ||
    (CFG.fallbackSeasons && CFG.fallbackSeasons[program]) || 204;
  seasonMem[program] = id;
  return id;
}

// ---------- Team index (search + TrueSkill rankings) ----------
const indexMem = {};
export async function teamIndex(program = prog()) {
  if (indexMem[program]) return indexMem[program];
  const t = await snap(`${pdir(program)}/teams.json`);
  if (!t) return null;
  const list = expandRows(t).map((r) => ({ ...r, _s: norm(`${r.number} ${r.name} ${r.org} ${r.city} ${r.region} ${r.country}`) }));
  const byNumber = new Map(list.map((r) => [String(r.number).toUpperCase(), r]));
  const idx = { list, byNumber, generated: t.generated };
  indexMem[program] = idx;
  return idx;
}

export async function searchTeams(q, { limit = 40, program = prog() } = {}) {
  const query = norm(q);
  const idx = await teamIndex(program);
  const results = [];
  if (idx && query) {
    for (const r of idx.list) {
      const num = norm(r.number);
      let s = num === query ? 200 : num.startsWith(query) ? 150 - num.length : 0;
      if (!s) s = matchScore(query, r.name) || (r._s.includes(query) ? 20 : 0);
      if (s) results.push({ ...r, _score: s + (r.ts ? r.ts / 100 : 0) });
    }
    results.sort((a, b) => b._score - a._score);
  }
  // Fall back to an exact number lookup through the live API
  if (!results.length && query && hasLive() && /^[a-z0-9]{2,8}$/i.test(q.trim())) {
    try {
      const r = await ep.teamsByNumber([q.trim().toUpperCase()], PROGRAM_IDS[program]);
      for (const t of r.data || []) results.push(fromApiTeam(t));
    } catch (e) { /* ignore */ }
  }
  return results.slice(0, limit);
}

function fromApiTeam(t) {
  const l = t.location || {};
  return {
    id: t.id, number: t.number, name: t.team_name, org: t.organization, robot: t.robot_name,
    city: l.city, region: l.region, country: l.country, grade: t.grade, registered: t.registered,
    program: t.program && (t.program.code || t.program.name)
  };
}

/** Find a team by number: snapshot stats + live profile when available. */
export async function findTeam(number, program = prog()) {
  number = String(number).toUpperCase();
  const idx = await teamIndex(program);
  const row = idx ? idx.byNumber.get(number) : null;
  let live = null;
  if (hasLive()) {
    try {
      const r = await ep.teamsByNumber([number], PROGRAM_IDS[program]);
      live = (r.data || []).find((t) => t.number.toUpperCase() === number) || null;
    } catch (e) { if (!row) throw e; }
  }
  if (!row && !live) return null;
  const base = live ? fromApiTeam(live) : {};
  return { ...(row || {}), ...Object.fromEntries(Object.entries(base).filter(([, v]) => v != null && v !== '')), number };
}

// Ratings for predictions: Map(number -> {mu, sigma}); OPR: Map(number -> {opr, dpr, ccwm})
export async function seasonRatings(program = prog()) {
  const idx = await teamIndex(program);
  const ratings = new Map(), oprs = new Map();
  if (idx) {
    for (const r of idx.list) {
      if (r.mu != null) ratings.set(r.number, { mu: r.mu, sigma: r.sigma });
      if (r.opr != null) oprs.set(r.number, { opr: r.opr, dpr: r.dpr, ccwm: r.ccwm });
    }
  }
  return { ratings, oprs, available: ratings.size > 0 };
}

// ---------- Team season detail ----------
export async function teamSeason(team, season, { live = false } = {}) {
  const program = prog();
  if (hasLive() && team.id) {
    const [events, matches, rankings, awards, skills] = await Promise.all([
      ep.teamEvents(team.id, season),
      ep.teamMatches(team.id, season, live),
      ep.teamRankings(team.id, season).catch(() => []),
      ep.teamAwards(team.id, season).catch(() => []),
      ep.teamSkills(team.id, season).catch(() => [])
    ]);
    return { source: 'live', events, matches: matches.map(normMatch), rankings, awards, skills };
  }
  const s = await snap(`${pdir(program)}/team/${encodeURIComponent(team.number)}.json`);
  if (s) {
    const evById = new Map((s.events || []).map((e) => [e.id, e]));
    return {
      source: 'snapshot', events: s.events || [], rankings: s.rankings || [], awards: s.awards || [], skills: s.skills || [],
      history: s.history || [],
      matches: (s.matches || []).map((c) => expandMatch(c, evById.has(c.e) ? { id: c.e, name: evById.get(c.e).name } : { id: c.e }))
    };
  }
  if (!hasLive()) throw new NoAuthError();
  return { source: 'none', events: [], matches: [], rankings: [], awards: [], skills: [] };
}

export async function teamAllAwards(team) {
  if (hasLive() && team.id) return ep.teamAwards(team.id);
  return null;
}

// ---------- Events ----------
export async function seasonEvents(program = prog()) {
  const season = await seasonId(program);
  if (hasLive()) {
    try { return { source: 'live', season, list: await ep.seasonEvents(season) }; } catch (e) { if (!e.noAuth) console.warn(e); }
  }
  const s = await snap(`${pdir(program)}/events.json`);
  if (s) {
    const list = expandRows(s).map((e) => ({
      id: e.id, sku: e.sku, name: e.name, start: e.start, end: e.end, level: e.level, event_type: e.type,
      location: { city: e.city, region: e.region, country: e.country, venue: e.venue, coordinates: e.lat != null ? { lat: e.lat, lon: e.lon } : null },
      divisions: (e.divisions || []).map(([id, name]) => ({ id, name })), teamCount: e.teams, ongoing: false
    }));
    return { source: 'snapshot', season, list };
  }
  throw new NoAuthError();
}

export async function eventData(id) {
  if (hasLive()) {
    const event = await ep.event(id, 120);
    const live = eventStatus(event) === 'live';
    const [teams, skills, awards, divisions] = await Promise.all([
      ep.eventTeams(id).catch(() => []),
      ep.eventSkills(id, live).catch(() => []),
      ep.eventAwards(id, live).catch(() => []),
      Promise.all((event.divisions || []).map(async (d) => {
        const [matches, rankings] = await Promise.all([
          ep.divisionMatches(id, d.id, live).catch(() => []),
          ep.divisionRankings(id, d.id, live).catch(() => [])
        ]);
        return { ...d, matches: matches.map(normMatch), rankings };
      }))
    ]);
    return { source: 'live', event, teams, skills, awards, divisions, live };
  }
  const s = await snap(`${pdir()}/event/${id}.json`);
  if (s) {
    const meta = { id: s.event.id, name: s.event.name };
    return {
      source: 'snapshot', event: s.event, teams: s.teams || [], skills: s.skills || [], awards: s.awards || [],
      divisions: (s.divisions || []).map((d) => ({ ...d, matches: (d.matches || []).map((c) => expandMatch(c, meta)) })),
      live: eventStatus(s.event) === 'live'
    };
  }
  throw new NoAuthError();
}

// ---------- Q&A ----------
export async function qaData(kind, season) {
  if (hasLive()) {
    try { return kind === 'judging' ? await ep.judgingQA() : await ep.seasonQA(season); } catch (e) { if (!e.noAuth && e.status !== 404) console.warn(e); }
  }
  const s = await snap(kind === 'judging' ? 'qa/judging.json' : `qa/${season}.json`);
  if (s) return s;
  throw new NoAuthError();
}

// ---------- World skills (public, no key) ----------
export async function skillsStandings(grade, program = prog()) {
  const season = await seasonId(program);
  return worldSkills(season, grade);
}
export async function skillsFor(number, program = prog()) {
  const out = {};
  let failed = 0;
  const grades = program === 'VIQRC' ? ['Middle School', 'Elementary School'] : program === 'VEXU' ? ['College'] : ['High School', 'Middle School'];
  for (const g of grades) {
    try {
      const list = await skillsStandings(g, program);
      const e = list.find((x) => x.team && String(x.team.team).toUpperCase() === number);
      if (e) { out.entry = e; out.grade = g; out.total = list.length; break; }
    } catch (e) { failed++; }
  }
  if (!out.entry && failed === grades.length) throw new Error('Could not load skills standings');
  return out;
}

// ---------- React-style data hook with stale-while-revalidate ----------
/**
 * useData(key, loader, { ttl, poll })
 * Paints the last cached result immediately (IndexedDB), refreshes in the background,
 * and optionally polls (e.g. live events). Returns { data, error, loading, refreshing, refresh, updatedAt }.
 */
export function useData(key, loader, { ttl = 300, poll = 0 } = {}) {
  const [st, setSt] = useState({ data: undefined, error: null, loading: !!key, refreshing: false, updatedAt: 0 });
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const alive = useRef(true);
  const [tick, setTick] = useState(0);

  // Re-run when the API key / worker changes, so data appears right after connecting.
  useEffect(() => {
    let prev = getState().settings.apiToken + '|' + getState().settings.workerUrl;
    return subscribe((s) => {
      const cur = s.settings.apiToken + '|' + s.settings.workerUrl;
      if (cur !== prev) { prev = cur; setTick((t) => t + 1); }
    });
  }, []);

  const lastKey = useRef(null);
  const run = useCallback(async (force = false) => {
    if (!key) return;
    setSt((s) => ({ ...s, refreshing: true }));
    if (force) forceFresh();
    try {
      const data = await loaderRef.current();
      if (!alive.current || lastKey.current !== key) return;
      const t = Date.now();
      setSt({ data, error: null, loading: false, refreshing: false, updatedAt: t });
      db.put('cache', { t, v: data }, 'cx:' + key).catch(() => {});
    } catch (error) {
      if (!alive.current || lastKey.current !== key) return;
      setSt((s) => ({ ...s, error, loading: false, refreshing: false }));
    }
  }, [key]);

  useEffect(() => {
    alive.current = true;
    if (!key) { setSt({ data: undefined, error: null, loading: false, refreshing: false, updatedAt: 0 }); return; }
    let cancelled = false;
    const sameKey = lastKey.current === key;
    lastKey.current = key;
    if (sameKey) { run(false); return () => { cancelled = true; }; } // API key changed: refresh in place
    setSt({ data: undefined, error: null, loading: true, refreshing: false, updatedAt: 0 });
    (async () => {
      const c = await db.get('cache', 'cx:' + key).catch(() => null);
      if (cancelled) return;
      if (c) setSt({ data: c.v, error: null, loading: false, refreshing: true, updatedAt: c.t });
      if (!c || Date.now() - c.t > ttl * 1000) await run(false);
      else setSt((s) => ({ ...s, refreshing: false }));
    })();
    return () => { cancelled = true; };
  }, [key, tick]);

  useEffect(() => () => { alive.current = false; }, []);

  useEffect(() => {
    if (!poll || !key) return;
    const id = setInterval(() => { if (document.visibilityState === 'visible' && navigator.onLine) run(false); }, poll * 1000);
    return () => clearInterval(id);
  }, [key, poll, run]);

  return { ...st, refresh: () => run(true) };
}

export const DEFAULT_RATING = { mu: TS.mu, sigma: TS.sigma };
