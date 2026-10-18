// Tiny hash router (works on static hosting like GitHub Pages, no rewrites needed).
import { useState, useEffect } from './html.js';

const scrollMemory = new Map();
let pushed = false;
let depth = 0; // in-app navigations this session, so "back" never leaves the app

export function parseHash(hash = location.hash) {
  const h = hash.replace(/^#/, '') || '/';
  const qi = h.indexOf('?');
  const path = qi >= 0 ? h.slice(0, qi) : h;
  const qs = qi >= 0 ? h.slice(qi + 1) : '';
  const parts = path.split('/').filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch (e) { return p; } });
  const query = Object.fromEntries(new URLSearchParams(qs));
  return { path: '/' + parts.join('/'), parts, query, raw: h };
}

export function href(path, query) {
  const q = query ? new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== '')).toString() : '';
  return '#' + path + (q ? '?' + q : '');
}

export function navigate(path, opts = {}) {
  const target = path.startsWith('#') ? path : '#' + path;
  scrollMemory.set(location.hash, window.scrollY);
  if (opts.replace) {
    history.replaceState(history.state, '', target);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    pushed = true;
    depth++;
    location.hash = target;
  }
}

export function back(fallback = '/') {
  if (depth > 0) { depth--; history.back(); }
  else navigate(fallback, { replace: true });
}

// Update the query string of the current route without adding a history entry (e.g. switching tabs).
export function setQuery(patch) {
  const r = parseHash();
  const q = { ...r.query, ...patch };
  Object.keys(q).forEach((k) => (q[k] == null || q[k] === '') && delete q[k]);
  const qs = new URLSearchParams(q).toString();
  history.replaceState(history.state, '', '#' + r.path + (qs ? '?' + qs : ''));
  window.dispatchEvent(new CustomEvent('os:query'));
}

export function useRoute() {
  const [route, setRoute] = useState(parseHash());
  useEffect(() => {
    const onChange = () => {
      const r = parseHash();
      setRoute(r);
      const y = pushed ? 0 : (scrollMemory.get(location.hash) || 0);
      pushed = false;
      requestAnimationFrame(() => window.scrollTo(0, y));
    };
    const onQuery = () => setRoute(parseHash());
    window.addEventListener('hashchange', onChange);
    window.addEventListener('os:query', onQuery);
    return () => { window.removeEventListener('hashchange', onChange); window.removeEventListener('os:query', onQuery); };
  }, []);
  return route;
}

// Match "/team/:num" style patterns.
export function matchRoute(pattern, path) {
  const a = pattern.split('/').filter(Boolean);
  const b = path.split('/').filter(Boolean);
  if (a.length !== b.length) return null;
  const params = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = b[i];
    else if (a[i] !== b[i]) return null;
  }
  return params;
}
