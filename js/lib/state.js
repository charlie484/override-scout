// App-wide state: settings, favourites, user documents (scouting data), UI (toasts, sheets).
import { useState, useEffect, useRef } from './html.js';
import * as db from './db.js';
import { uid } from './util.js';

const CFG = window.OVERRIDE_CONFIG || {};
const LS_SETTINGS = 'os.settings';
const LS_FAVS = 'os.favs';

function readLS(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? { ...fallback, ...JSON.parse(v) } : { ...fallback }; } catch (e) { return { ...fallback }; }
}
function writeLS(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage full or blocked */ }
}

const defaultSettings = {
  myTeam: CFG.homeTeam || '1940D',
  program: CFG.defaultProgram || 'V5RC',
  theme: 'system',
  apiToken: '',
  workerUrl: '',
  sound: true,
  haptics: true,
  grade: 'any',
  profile: null,
  workspace: null, // { id, key, name } when cloud sync is joined
  onboarded: false
};

let state = {
  settings: readLS(LS_SETTINGS, defaultSettings),
  favs: readLS(LS_FAVS, { teams: [], events: [] }),
  docs: [],
  docsReady: false,
  toasts: [],
  sheet: null,
  online: navigator.onLine,
  updateReady: false,
  syncStatus: 'idle'
};

if (!state.settings.profile) {
  state.settings.profile = { id: uid('u'), name: '', team: state.settings.myTeam };
  writeLS(LS_SETTINGS, state.settings);
}

const listeners = new Set();
export const getState = () => state;
export function setState(patch) {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  listeners.forEach((l) => l(state));
}
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

// Re-render a component when the selected slice of state changes.
export function useStore(selector = (s) => s) {
  const [, force] = useState(0);
  const sel = useRef(selector);
  sel.current = selector;
  const last = useRef(selector(state));
  last.current = selector(state);
  useEffect(() => subscribe((s) => {
    const next = sel.current(s);
    if (next !== last.current) { last.current = next; force((n) => n + 1); }
  }), []);
  return last.current;
}

// ---------- Settings ----------
export function updateSettings(patch) {
  const settings = { ...state.settings, ...patch };
  writeLS(LS_SETTINGS, settings);
  setState({ settings });
  if ('theme' in patch) applyTheme();
}
export function applyTheme() {
  let t = state.settings.theme || 'system';
  if (t === 'system') t = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', t);
  const meta = document.querySelector('meta[name="theme-color"]:not([media])') || (() => {
    const m = document.createElement('meta'); m.name = 'theme-color'; document.head.appendChild(m); return m;
  })();
  meta.content = t === 'light' ? '#F5F5F3' : '#0A0A0B';
}
try { matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyTheme); } catch (e) { /* old Safari */ }

export const myTeam = () => (state.settings.myTeam || '').toUpperCase();
export const workerUrl = () => (state.settings.workerUrl || CFG.workerUrl || '').replace(/\/+$/, '');

// ---------- Favourites ----------
export function isFav(kind, id) { return (state.favs[kind] || []).includes(String(id)); }
export function toggleFav(kind, id) {
  id = String(id);
  const list = state.favs[kind] || [];
  const next = list.includes(id) ? list.filter((x) => x !== id) : [id, ...list];
  const favs = { ...state.favs, [kind]: next };
  writeLS(LS_FAVS, favs);
  setState({ favs });
  return next.includes(id);
}

// ---------- Documents (scouting entries, practice runs, pick lists, friends ...) ----------
export async function loadDocs() {
  const docs = await db.all('docs');
  setState({ docs: docs.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)), docsReady: true });
}

function author() {
  const p = state.settings.profile || {};
  return { id: p.id, name: p.name || 'Me', team: p.team || state.settings.myTeam };
}

export async function saveDoc(doc, { silent = false, fromSync = false } = {}) {
  const now = Date.now();
  const d = fromSync ? doc : {
    ...doc,
    id: doc.id || uid(doc.type ? doc.type.slice(0, 2) + '_' : 'd_'),
    createdAt: doc.createdAt || now,
    updatedAt: now,
    author: doc.author || author(),
    dirty: true
  };
  await db.put('docs', d);
  const docs = [d, ...state.docs.filter((x) => x.id !== d.id)].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  setState({ docs });
  if (!silent && !fromSync) document.dispatchEvent(new CustomEvent('os:docs-changed'));
  return d;
}

export async function saveDocsFromRemote(list) {
  if (!list.length) return;
  const byId = new Map(state.docs.map((d) => [d.id, d]));
  const changed = [];
  for (const r of list) {
    const cur = byId.get(r.id);
    if (!cur || (r.updatedAt || 0) > (cur.updatedAt || 0)) {
      const d = { ...r, dirty: false };
      byId.set(r.id, d);
      changed.push(d);
    }
  }
  if (!changed.length) return 0;
  await db.putMany('docs', changed);
  setState({ docs: [...byId.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)) });
  return changed.length;
}

export async function deleteDoc(id) {
  const cur = state.docs.find((d) => d.id === id);
  if (!cur) return;
  if (cur.blobId) await db.del('blobs', cur.blobId).catch(() => {});
  await saveDoc({ ...cur, deleted: true });
}

export const liveDocs = (docs, type) => docs.filter((d) => !d.deleted && (!type || d.type === type));

// ---------- Toasts & sheets ----------
export function toast(message, opts = {}) {
  const id = uid('t');
  const t = { id, message, icon: opts.icon || 'check', action: opts.action, onAction: opts.onAction };
  setState((s) => ({ toasts: [...s.toasts, t] }));
  setTimeout(() => setState((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), opts.duration || 3200);
}
export function openSheet(render, opts = {}) { setState({ sheet: { render, ...opts } }); }
export function closeSheet() { setState({ sheet: null }); }

window.addEventListener('online', () => setState({ online: true }));
window.addEventListener('offline', () => setState({ online: false }));
