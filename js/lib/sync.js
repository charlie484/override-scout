// Optional cloud sync for team workspaces (requires the Cloudflare Worker in /worker).
// Without a worker, sharing still works through QR codes, links and files (see share.js).
import { getState, setState, saveDocsFromRemote, updateSettings, workerUrl } from './state.js';
import * as db from './db.js';
import { debounce } from './util.js';

export const SYNC_TYPES = ['scout', 'picklist', 'social', 'checklist', 'practice'];
let timer = null;
let running = false;

async function call(path, { method = 'GET', body, ws } = {}) {
  const base = workerUrl();
  if (!base) throw new Error('No sync server configured');
  const headers = { 'Content-Type': 'application/json' };
  if (ws) headers['X-Workspace-Key'] = ws.key;
  const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Sync failed (${res.status})`);
  return data;
}

export const canSync = () => !!workerUrl();

export async function createWorkspace(name) {
  const p = getState().settings.profile;
  const r = await call('/ws', { method: 'POST', body: { name, member: p } });
  updateSettings({ workspace: { id: r.id, key: r.key, name: r.name, cursor: 0 } });
  await syncNow();
  return r;
}

export async function joinWorkspace({ id, key, name }) {
  updateSettings({ workspace: { id, key, name, cursor: 0 } });
  await syncNow(true);
}

export function leaveWorkspace() {
  updateSettings({ workspace: null });
  setState({ syncStatus: 'idle', members: [] });
}

function strip(d) { const { dirty, ...rest } = d; return rest; }

export async function syncNow(full = false) {
  const ws = getState().settings.workspace;
  if (!ws || !workerUrl() || running || !navigator.onLine) return;
  running = true;
  setState({ syncStatus: 'syncing' });
  try {
    const profile = getState().settings.profile;
    const dirty = getState().docs.filter((d) => d.dirty && SYNC_TYPES.includes(d.type));
    if (dirty.length) {
      await call(`/ws/${ws.id}/push`, { method: 'POST', ws, body: { member: profile, docs: dirty.map(strip) } });
      const clean = dirty.map((d) => ({ ...d, dirty: false }));
      await db.putMany('docs', clean);
      const byId = new Map(clean.map((d) => [d.id, d]));
      setState((s) => ({ docs: s.docs.map((d) => byId.get(d.id) || d) }));
    }
    let since = full ? 0 : (ws.cursor || 0);
    let r;
    for (let page = 0; page < 20; page++) { // the server returns up to 1000 changes per call
      r = await call(`/ws/${ws.id}/pull?since=${since}&member=${encodeURIComponent(profile.id)}`, { ws });
      if (r.docs && r.docs.length) await saveDocsFromRemote(r.docs);
      since = r.cursor || since;
      if (!r.docs || r.docs.length < 1000) break;
    }
    const cur = getState().settings.workspace;
    if (cur && cur.id === ws.id) updateSettings({ workspace: { ...cur, cursor: since, name: r.name || cur.name } });
    setState({ syncStatus: 'ok', lastSync: Date.now(), members: r.members || [] });
  } catch (e) {
    console.warn('sync', e);
    setState({ syncStatus: 'error', syncError: e.message });
  } finally {
    running = false;
  }
}

const soon = debounce(() => syncNow(), 2500);

export function startSync() {
  document.addEventListener('os:docs-changed', soon);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  window.addEventListener('online', () => syncNow());
  clearInterval(timer);
  timer = setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 45000);
  syncNow();
}
