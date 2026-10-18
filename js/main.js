import { html, render, useState, useEffect } from './lib/html.js';
import { Icon } from './lib/icons.js';
import { cx } from './lib/util.js';
import { useRoute, matchRoute, navigate } from './lib/router.js';
import { useStore, loadDocs, applyTheme, toast, setState, getState } from './lib/state.js';
import { SheetHost, Toasts, Screen, Empty, Skeleton } from './components/ui.js';
import { startSync } from './lib/sync.js';

// ---------- Lazy-loaded screens ----------
function lazy(loader, name) {
  let Comp = null, promise = null, failed = null;
  return function Lazy(props) {
    const [, force] = useState(0);
    if (Comp) return html`<${Comp} ...${props} />`;
    if (failed) {
      return html`<${Screen} title="Couldn't load"><${Empty} icon="wifiOff" title="This screen isn't available offline yet"
        text="Connect to the internet once and it will be saved for offline use."
        action=${html`<button class="btn" onClick=${() => location.reload()}>Reload</button>`} /></${Screen}>`;
    }
    if (!promise) promise = loader().then((m) => { Comp = m[name]; }).catch((e) => { failed = e; promise = null; console.error(e); });
    promise && promise.then(() => force((n) => n + 1));
    return html`<${Screen} title=""><div class="mt-16"><${Skeleton} rows=${4} /></div></${Screen}>`;
  };
}

const Home = lazy(() => import('./views/home.js'), 'Home');
const Explore = lazy(() => import('./views/explore.js'), 'Explore');
const Team = lazy(() => import('./views/team.js'), 'Team');
const EventView = lazy(() => import('./views/event.js'), 'EventView');
const Compare = lazy(() => import('./views/compare.js'), 'Compare');
const Predict = lazy(() => import('./views/compare.js'), 'Predict');
const Scout = lazy(() => import('./views/scout.js'), 'Scout');
const ScoutForm = lazy(() => import('./views/scout.js'), 'ScoutForm');
const Practice = lazy(() => import('./views/practice.js'), 'Practice');
const Tools = lazy(() => import('./views/tools.js'), 'Tools');
const Tool = lazy(() => import('./views/tools.js'), 'Tool');
const QA = lazy(() => import('./views/qa.js'), 'QA');
const QADetail = lazy(() => import('./views/qa.js'), 'QADetail');
const Me = lazy(() => import('./views/me.js'), 'Me');
const Import = lazy(() => import('./views/me.js'), 'Import');
const Report = lazy(() => import('./views/report.js'), 'Report');

const ROUTES = [
  ['/', Home],
  ['/explore', Explore],
  ['/team/:num', Team],
  ['/event/:id', EventView],
  ['/event/:id/report', Report],
  ['/compare', Compare],
  ['/predict', Predict],
  ['/scout', Scout],
  ['/scout/new', ScoutForm],
  ['/scout/edit/:id', ScoutForm],
  ['/practice', Practice],
  ['/tools', Tools],
  ['/tools/:tool', Tool],
  ['/qa', QA],
  ['/qa/:kind/:id', QADetail],
  ['/me', Me],
  ['/me/:section', Me],
  ['/import', Import]
];

const NAV = [
  { id: 'home', path: '/', label: 'Home', icon: 'home' },
  { id: 'explore', path: '/explore', label: 'Explore', icon: 'compass' },
  { id: 'scout', path: '/scout', label: 'Scout', icon: 'clipboard' },
  { id: 'tools', path: '/tools', label: 'Tools', icon: 'wrench' },
  { id: 'qa', path: '/qa', label: 'Rules', icon: 'book' }
];

function section(path) {
  if (path === '/') return 'home';
  const p = path.split('/')[1];
  if (['explore', 'team', 'event', 'compare'].includes(p)) return 'explore';
  if (['scout', 'practice'].includes(p)) return 'scout';
  if (['tools', 'predict'].includes(p)) return 'tools';
  if (p === 'qa') return 'qa';
  if (p === 'me' || p === 'import') return 'me';
  return '';
}

function TabBar({ active }) {
  return html`<nav class="tabbar" aria-label="Main">
    ${NAV.map((n) => html`<a class=${cx('tab', active === n.id && 'active')} href=${'#' + n.path} aria-current=${active === n.id ? 'page' : undefined}>
      <${Icon} name=${n.icon} /><span>${n.label}</span></a>`)}
  </nav>`;
}

function Sidebar({ active }) {
  const [q, setQ] = useState('');
  const profile = useStore((s) => s.settings.profile);
  const sync = useStore((s) => s.syncStatus);
  return html`<aside class="sidebar">
    <a class="sidebar-logo logo-swap" href="#/" aria-label="Override Scout home">
      <img class="logo-dark" src="assets/logo-full-dark.png" alt="Override 1940D" />
      <img class="logo-light" src="assets/logo-full-light.png" alt="Override 1940D" />
    </a>
    <form class="sidebar-search search" onSubmit=${(e) => { e.preventDefault(); navigate('/explore?q=' + encodeURIComponent(q)); setQ(''); }}>
      <${Icon} name="search" />
      <input class="input" placeholder="Search teams & events" value=${q} onInput=${(e) => setQ(e.target.value)} />
    </form>
    ${NAV.map((n) => html`<a class=${cx('side-link', active === n.id && 'active')} href=${'#' + n.path}><${Icon} name=${n.icon} />${n.id === 'qa' ? 'Rules & Q&A' : n.label}</a>`)}
    <div class="sidebar-foot">
      <a class=${cx('side-link', active === 'me' && 'active')} href="#/me/friends"><${Icon} name="users" />Friends & sharing
        ${sync === 'ok' && html`<span class="dot" style="background:var(--win);margin-left:auto"></span>`}</a>
      <a class="side-link" href="#/me"><${Icon} name="settings" />Settings</a>
      <div class="faint tiny" style="padding:10px 12px 0">${profile && profile.name ? `Signed in as ${profile.name}` : 'Override Scout · 1940D'}</div>
    </div>
  </aside>`;
}

function OfflineBar() {
  const online = useStore((s) => s.online);
  if (online) return null;
  return html`<div style="position:fixed;z-index:45;left:50%;transform:translateX(-50%);top:calc(var(--topbar-h) + var(--sat) + 8px)" class="badge badge-tie">
    <${Icon} name="wifiOff" size="13" /> Offline — showing saved data</div>`;
}

function App() {
  const route = useRoute();
  let View = null, params = {};
  for (const [pattern, comp] of ROUTES) {
    const p = matchRoute(pattern, route.path);
    if (p) { View = comp; params = p; break; }
  }
  const active = section(route.path);
  // Screens keyed by path keep state across ?tab= changes; forms and imports restart when their query changes.
  const viewKey = route.path.startsWith('/scout/new') || route.path === '/import' ? route.raw : route.path;
  useEffect(() => {
    const bar = () => document.querySelector('.topbar');
    const on = () => { const b = bar(); if (b) b.classList.toggle('scrolled', window.scrollY > 4); };
    window.addEventListener('scroll', on, { passive: true });
    on();
    return () => window.removeEventListener('scroll', on);
  }, [route.path]);

  return html`<div class="app">
    <${Sidebar} active=${active} />
    <main class="main" id="main">
      ${View ? html`<${View} key=${viewKey} params=${params} query=${route.query} route=${route} />`
        : html`<${Screen} title="Not found" backTo="/"><${Empty} icon="compass" title="That page doesn't exist"
            action=${html`<a class="btn" href="#/">Go home</a>`} /></${Screen}>`}
    </main>
    <${TabBar} active=${active} />
    <${OfflineBar} />
    <${SheetHost} />
    <${Toasts} />
  </div>`;
}

// ---------- Boot ----------
applyTheme();

// Route internal links through the router (keeps history depth + scroll memory right)
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest && e.target.closest('a[href^="#/"]');
  if (!a || a.target) return;
  e.preventDefault();
  const to = a.getAttribute('href').slice(1);
  if ('#' + to === location.hash) return;
  navigate(to);
});

render(html`<${App} />`, document.getElementById('app'));
loadDocs().then(() => startSync());

// Service worker: offline support + "update ready" prompt (skipped on localhost while developing)
const isDev = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) && !location.search.includes('sw=1');
if ('serviceWorker' in navigator && !isDev) {
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const prompt = (worker) => toast('A new version is ready', {
      icon: 'sparkles', action: 'Update', duration: 30000, onAction: () => worker.postMessage('skipWaiting')
    });
    // An update downloaded during an earlier visit: apply it now, while the app is just opening
    // (nothing typed yet), so phones never get stuck on an old version.
    if (reg.waiting && navigator.serviceWorker.controller) reg.waiting.postMessage('skipWaiting');
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w && w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) prompt(w);
      });
    });
    setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
  }).catch((e) => console.warn('SW registration failed', e));
}

// Ask the browser to keep our data (scouting notes) from being evicted
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
