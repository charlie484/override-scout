// Shared UI building blocks.
import { html, useState, useEffect, useRef } from '../lib/html.js';
import { Icon } from '../lib/icons.js';
import { cx, fmt, pct, matchLabel, fmtTime, fmtDay } from '../lib/util.js';
import { useStore, closeSheet, toggleFav, setState, getState } from '../lib/state.js';
import { back, navigate } from '../lib/router.js';
import { isPlayed, inMatch } from '../lib/data.js';

// ---------- Screen: fixed mobile top bar + page container ----------
export function Screen({ title, sub, backTo, actions, brand, head = true, children, class: cls }) {
  return html`
    <header class="topbar">
      ${backTo !== undefined && html`<button class="btn-icon" onClick=${() => back(backTo || '/')} aria-label="Back"><${Icon} name="chevronLeft" /></button>`}
      ${brand
        ? html`<a class="topbar-brand logo-swap" href="#/" aria-label="Override Scout home">
            <img class="logo-dark" src="assets/logo-full-dark.png" alt="Override 1940D" width="91" height="28" />
            <img class="logo-light" src="assets/logo-full-light.png" alt="Override 1940D" width="91" height="28" />
          </a>`
        : html`<div class="topbar-title">${title}</div>`}
      <div class="topbar-spacer"></div>
      ${actions}
    </header>
    <div class=${cx('page', cls)}>
      ${head && (title || sub) && html`
        <div class="page-head hide-mobile">
          <div><h1>${title}</h1>${sub && html`<p>${sub}</p>`}</div>
          ${actions && html`<div class="btn-row">${actions}</div>`}
        </div>`}
      ${head && sub && html`<p class="muted small hide-desktop mb-12">${sub}</p>`}
      ${children}
    </div>`;
}

export function Section({ title, link, onLink, children, right, class: cls }) {
  return html`<section class=${cx('section', cls)}>
    ${(title || right) && html`<div class="section-head"><h2>${title}</h2>
      ${right || (link && html`<a class="link" href=${link.startsWith('#') ? link : '#' + link} onClick=${onLink}>See all</a>`)}</div>`}
    ${children}
  </section>`;
}

// ---------- Tabs & segmented controls ----------
export function Tabs({ tabs, value, onChange }) {
  return html`<nav class="tabs" role="tablist">
    ${tabs.map((t) => html`<button role="tab" aria-selected=${value === t.id} class=${cx(value === t.id && 'on')}
      onClick=${() => onChange(t.id)}>${t.label}${t.count != null && html`<span class="faint"> ${t.count}</span>`}</button>`)}
  </nav>`;
}

export function Seg({ options, value, onChange, block, class: cls }) {
  return html`<div class=${cx('seg', block && 'seg-block', cls)} role="radiogroup">
    ${options.map((o) => {
      const v = typeof o === 'object' ? o.value : o;
      const l = typeof o === 'object' ? o.label : o;
      return html`<button role="radio" aria-checked=${v === value} class=${cx(v === value && 'on')} onClick=${() => onChange(v)}>${l}</button>`;
    })}
  </div>`;
}

export function Chips({ options, value = [], onChange, multi = true, scroll }) {
  const sel = Array.isArray(value) ? value : [value];
  return html`<div class=${cx('chips', scroll && 'chips-scroll')}>
    ${options.map((o) => {
      const v = typeof o === 'object' ? o.value : o;
      const l = typeof o === 'object' ? o.label : o;
      const on = sel.includes(v);
      return html`<button type="button" class=${cx('chip', on && 'on')} aria-pressed=${on}
        onClick=${() => onChange(multi ? (on ? sel.filter((x) => x !== v) : [...sel, v]) : (on ? '' : v))}>${l}</button>`;
    })}
  </div>`;
}

// ---------- Stats ----------
export function Tile({ label, value, sub, accent, onClick }) {
  const T = onClick ? 'button' : 'div';
  return html`<${T} class=${cx('tile', accent && 'accent')} onClick=${onClick} style=${onClick ? 'text-align:left' : ''}>
    <div class="tile-label">${label}</div>
    <div class="tile-value">${value}</div>
    ${sub != null && sub !== '' && html`<div class="tile-sub">${sub}</div>`}
  </${T}>`;
}

export function TeamPill({ n, me, fav, sit, link = true }) {
  const mine = me === true || (typeof me === 'string' && me === n);
  const cls = cx('tpill', mine && 'me', fav && 'fav', sit && 'sit');
  if (!link) return html`<span class=${cls}>${n}</span>`;
  return html`<a class=${cls} href=${'#/team/' + encodeURIComponent(n)}
    onClick=${(e) => { e.stopPropagation(); e.preventDefault(); navigate('/team/' + encodeURIComponent(n)); }}>${n}</a>`;
}

export function ResultBadge({ r }) {
  if (!r) return null;
  return html`<span class=${cx('badge', r === 'W' ? 'badge-win' : r === 'L' ? 'badge-loss' : 'badge-tie')}>${r}</span>`;
}

export function LevelBadge({ level }) {
  if (!level || level === 'Other') return null;
  const hot = ['World', 'Signature', 'National', 'Regional', 'State'].includes(level);
  return html`<span class=${cx('badge', hot ? 'badge-soft' : '')}>${level === 'World' ? 'Worlds' : level}</span>`;
}

// ---------- Matches ----------
export function MatchRow({ m, me, favs = [], pred, onClick, showDate }) {
  const played = isPlayed(m);
  const mine = me && inMatch(m, me);
  const redWon = played && m.red.score > m.blue.score;
  const blueWon = played && m.blue.score > m.red.score;
  const pills = (s) => m[s].teams.map((t) => html`<${TeamPill} n=${t} me=${t === me} fav=${favs.includes(t)} sit=${m[s].sitting.includes(t)} />`);
  return html`<button class=${cx('match', mine && 'mine')} onClick=${onClick}>
    <div>
      <div class="match-label">${matchLabel(m)}</div>
      <div class="match-time">${showDate && m.scheduled ? fmtDay(m.scheduled) : played ? (m.field || '') : fmtTime(m.scheduled)}</div>
    </div>
    <div class="match-teams red">${pills('red')}</div>
    ${played
      ? html`<div class="match-score">
          <span class=${cx('s red', redWon && 'won')}><span>${m.red.score}</span></span>
          <span class=${cx('s blue', blueWon && 'won')}><span>${m.blue.score}</span></span>
        </div>`
      : html`<div class="match-pending">${pred && pred.method !== 'none'
          ? html`<div class="match-pred"><span class="red-text">${Math.round(pred.pRed * 100)}</span> · <span class="blue-text">${Math.round((1 - pred.pRed) * 100)}</span></div>`
          : html`<span class="faint">vs</span>`}</div>`}
    <div class="match-teams blue">${pills('blue')}</div>
  </button>`;
}

export function ProbBar({ pRed, labels = true }) {
  const r = Math.round(pRed * 100);
  return html`<div>
    <div class="prob"><div class="r" style=${`width:${r}%`}></div><div class="b" style=${`width:${100 - r}%`}></div></div>
    ${labels && html`<div class="prob-labels"><span class="r">${r}% red</span><span class="b">${100 - r}% blue</span></div>`}
  </div>`;
}

// ---------- Feedback ----------
export function Empty({ icon = 'search', title, text, action }) {
  return html`<div class="empty">
    <div class="empty-icon"><${Icon} name=${icon} /></div>
    ${title && html`<h3>${title}</h3>`}
    ${text && html`<p>${text}</p>`}
    ${action}
  </div>`;
}

export function Skeleton({ rows = 5 }) {
  return html`<div class="list">${Array.from({ length: rows }, (_, i) => html`<div class="skel-row" key=${i}>
    <div class="skel" style="width:42px;height:42px;border-radius:12px"></div>
    <div style="flex:1"><div class="skel" style="height:13px;width:45%"></div><div class="skel" style="height:11px;width:70%;margin-top:8px"></div></div>
  </div>`)}</div>`;
}

export function Spinner({ center }) {
  return center ? html`<div style="display:grid;place-items:center;padding:30px"><div class="spinner"></div></div>` : html`<div class="spinner"></div>`;
}

export function NoKeyCard({ compact }) {
  return html`<div class="notice">
    <${Icon} name="key" />
    <div class="grow">
      <b>Connect live VEX data</b>
      <div class="muted small mt-4">${compact ? 'Add an events.vex.com API key to load this.' :
        'Live schedules, results and rankings come from events.vex.com. Add your free API key once and everything here fills in.'}</div>
      <a class="btn btn-primary btn-sm mt-8" href="#/me/api">Add API key</a>
    </div>
  </div>`;
}

export function ErrorState({ error, onRetry }) {
  if (!error) return null;
  if (error.noAuth) return html`<${NoKeyCard} />`;
  const offline = !navigator.onLine;
  return html`<${Empty} icon=${offline ? 'wifiOff' : 'alert'} title=${offline ? "You're offline" : 'Something went wrong'}
    text=${offline ? 'Connect to the internet to load this. Anything you opened before is still available.' : error.message}
    action=${onRetry && html`<button class="btn" onClick=${onRetry}><${Icon} name="refresh" /> Try again</button>`} />`;
}

export function Updated({ at, refreshing, onRefresh, live }) {
  if (!at && !refreshing) return null;
  const mins = at ? Math.round((Date.now() - at) / 60000) : 0;
  return html`<div class="flex small faint" style="gap:6px">
    ${live && html`<span class="badge badge-live">Live</span>`}
    <span>${refreshing ? 'Updating…' : mins < 1 ? 'Updated just now' : `Updated ${mins} min ago`}</span>
    ${onRefresh && html`<button class="btn-icon" style="width:30px;height:30px" onClick=${onRefresh} aria-label="Refresh"><${Icon} name="refresh" size="16" /></button>`}
  </div>`;
}

// ---------- Inputs ----------
export function Field({ label, hint, children }) {
  return html`<label class="field"><span class="label">${label}</span>${children}${hint && html`<span class="hint">${hint}</span>`}</label>`;
}

export function SearchBox({ value, onInput, placeholder = 'Search', autofocus, large, onEnter }) {
  const ref = useRef();
  useEffect(() => { if (autofocus && ref.current) setTimeout(() => ref.current && ref.current.focus(), 60); }, []);
  return html`<div class=${cx('search', large && 'search-lg')}>
    <${Icon} name="search" />
    <input ref=${ref} class="input" type="search" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false"
      placeholder=${placeholder} value=${value} onInput=${(e) => onInput(e.target.value)}
      onKeyDown=${(e) => e.key === 'Enter' && onEnter && onEnter(e.target.value)} />
    ${value && html`<button class="btn-icon clear" aria-label="Clear" onClick=${() => { onInput(''); ref.current && ref.current.focus(); }}><${Icon} name="x" size="18" /></button>`}
  </div>`;
}

export function Switch({ checked, onChange, label }) {
  return html`<label class="switch"><input type="checkbox" checked=${checked} aria-label=${label} onChange=${(e) => onChange(e.target.checked)} /><span></span></label>`;
}

export function Stepper({ value = 0, onChange, min = 0, max = 999 }) {
  const haptic = () => { if (getState().settings.haptics && navigator.vibrate) navigator.vibrate(8); };
  return html`<div class="stepper">
    <button type="button" aria-label="Decrease" onClick=${() => { haptic(); onChange(Math.max(min, (value || 0) - 1)); }}><${Icon} name="minus" /></button>
    <div class="val">${value || 0}</div>
    <button type="button" aria-label="Increase" onClick=${() => { haptic(); onChange(Math.min(max, (value || 0) + 1)); }}><${Icon} name="plus" /></button>
  </div>`;
}

export function Stars({ value = 0, onChange, small }) {
  if (small) {
    return html`<span class="stars small" aria-label=${`${value} of 5`}>${[1, 2, 3, 4, 5].map((i) => html`<span class=${cx(i <= Math.round(value) && 'on')}><${Icon} name="starFill" /></span>`)}</span>`;
  }
  return html`<div class="stars" role="radiogroup">
    ${[1, 2, 3, 4, 5].map((i) => html`<button type="button" class=${cx(i <= value && 'on')} aria-label=${`${i} star`}
      onClick=${() => onChange(i === value ? 0 : i)}><${Icon} name="starFill" /></button>`)}
  </div>`;
}

export function FavButton({ kind, id, hero }) {
  const on = useStore((s) => (s.favs[kind] || []).includes(String(id)));
  return html`<button class=${cx('btn-icon', on && 'on')} aria-label=${on ? 'Remove from favourites' : 'Add to favourites'} aria-pressed=${on}
    onClick=${(e) => { e.stopPropagation(); toggleFav(kind, id); }}>
    <${Icon} name=${on ? 'starFill' : 'star'} />
  </button>`;
}

// ---------- Hosts ----------
export function SheetHost() {
  const sheet = useStore((s) => s.sheet);
  useEffect(() => {
    if (!sheet) return;
    const onKey = (e) => e.key === 'Escape' && closeSheet();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [sheet]);
  if (!sheet) return null;
  const Body = sheet.render;
  return html`<div class="sheet-wrap">
    <div class="sheet-backdrop" onClick=${closeSheet}></div>
    <div class=${cx('sheet', sheet.wide && 'wide')} role="dialog" aria-modal="true" aria-label=${sheet.title}>
      <div class="sheet-grip"></div>
      <div class="sheet-head"><h3>${sheet.title}</h3><button class="btn-icon" onClick=${closeSheet} aria-label="Close"><${Icon} name="x" /></button></div>
      <div class="sheet-body"><${Body} /></div>
    </div>
  </div>`;
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return html`<div class="toasts" aria-live="polite">
    ${toasts.map((t) => html`<div class="toast" key=${t.id}><${Icon} name=${t.icon} /><span>${t.message}</span>
      ${t.action && html`<button onClick=${() => { setState((s) => ({ toasts: s.toasts.filter((x) => x.id !== t.id) })); t.onAction && t.onAction(); }}>${t.action}</button>`}</div>`)}
  </div>`;
}

// Confirm inside the app (native confirm() is unreliable in installed web apps)
export function confirmSheet({ title, text, confirm = 'Confirm', danger, onConfirm }) {
  import('../lib/state.js').then(({ openSheet }) => openSheet(() => html`<div>
    <p class="muted">${text}</p>
    <div class="btn-row mt-16">
      <button class=${cx('btn', danger ? 'btn-danger' : 'btn-primary')} onClick=${() => { closeSheet(); onConfirm(); }}>${confirm}</button>
      <button class="btn btn-ghost" onClick=${closeSheet}>Cancel</button>
    </div>
  </div>`, { title }));
}

export function KV({ items }) {
  return html`<dl class="kv">${items.filter(Boolean).map(([k, v]) => html`<dt>${k}</dt><dd>${v == null || v === '' ? '—' : v}</dd>`)}</dl>`;
}

export function useMedia(q) {
  const [m, setM] = useState(() => matchMedia(q).matches);
  useEffect(() => {
    const mq = matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener ? mq.addEventListener('change', on) : mq.addListener(on);
    return () => (mq.removeEventListener ? mq.removeEventListener('change', on) : mq.removeListener(on));
  }, [q]);
  return m;
}

export { fmt, pct, navigate };
