// Small shared helpers: ids, formatting, searching, match labels.

export const cx = (...a) => a.filter(Boolean).join(' ');
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function uid(prefix = '') {
  const s = (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID().replace(/-/g, '') :
    Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return prefix + s.slice(0, 20);
}

export function debounce(fn, ms = 200) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function groupBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

export function sortBy(arr, fn, dir = 1) {
  return [...arr].sort((a, b) => {
    const x = fn(a), y = fn(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (x < y ? -1 : x > y ? 1 : 0) * dir;
  });
}

// ---------- Numbers ----------
export function fmt(n, digits = 0) {
  if (n == null || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
export function fmtSigned(n, digits = 1) {
  if (n == null || Number.isNaN(n)) return '—';
  const s = fmt(Math.abs(n), digits);
  return (n > 0 ? '+' : n < 0 ? '−' : '') + s;
}
export function pct(n, digits = 0) {
  if (n == null || Number.isNaN(n)) return '—';
  return (n * 100).toFixed(digits) + '%';
}
export function ordinal(n) {
  if (n == null) return '—';
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ---------- Dates ----------
const dOpts = { day: 'numeric', month: 'short' };
export function toDate(v) { if (!v) return null; const d = v instanceof Date ? v : new Date(v); return Number.isNaN(+d) ? null : d; }
export function fmtDate(v, opts) {
  const d = toDate(v); if (!d) return '—';
  return d.toLocaleDateString(undefined, opts || { ...dOpts, year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
}
export function fmtDay(v) {
  const d = toDate(v); if (!d) return '—';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}
export function fmtTime(v) {
  const d = toDate(v); if (!d) return '';
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
export function fmtDateRange(a, b) {
  const s = toDate(a), e = toDate(b);
  if (!s) return '—';
  if (!e || s.toDateString() === e.toDateString()) return fmtDate(s);
  if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) {
    return `${s.getDate()}–${e.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`;
  }
  return `${fmtDate(s)} – ${fmtDate(e)}`;
}
export function relTime(v, now = Date.now()) {
  const d = toDate(v); if (!d) return '';
  const diff = (d - now) / 1000, a = Math.abs(diff);
  const f = (n, u) => `${Math.round(n)} ${u}${Math.round(n) === 1 ? '' : 's'}`;
  let s;
  if (a < 45) return diff >= 0 ? 'now' : 'just now';
  if (a < 3600) s = f(a / 60, 'min');
  else if (a < 86400) s = f(a / 3600, 'hr');
  else if (a < 86400 * 30) s = f(a / 86400, 'day');
  else if (a < 86400 * 365) s = f(a / (86400 * 30), 'month');
  else s = f(a / (86400 * 365), 'year');
  return diff >= 0 ? `in ${s}` : `${s} ago`;
}
export const isoDay = (d = new Date()) => {
  const x = toDate(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

// ---------- Search ----------
export function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').trim();
}
// Score how well `q` matches `text` (0 = no match). Prefix/word matches score higher.
export function matchScore(q, text) {
  if (!q) return 1;
  const t = norm(text);
  if (!t) return 0;
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  if (t.includes(' ' + q)) return 60;
  if (t.includes(q)) return 40;
  const parts = q.split(' ').filter(Boolean);
  if (parts.length > 1 && parts.every((p) => t.includes(p))) return 25;
  return 0;
}

// ---------- VEX specifics ----------
export const ROUNDS = {
  1: { short: 'P', name: 'Practice', order: 0 },
  2: { short: 'Q', name: 'Qualification', order: 1 },
  9: { short: 'R128', name: 'Round of 128', order: 2 },
  8: { short: 'R64', name: 'Round of 64', order: 3 },
  7: { short: 'R32', name: 'Round of 32', order: 4 },
  6: { short: 'R16', name: 'Round of 16', order: 5 },
  3: { short: 'QF', name: 'Quarterfinals', order: 6 },
  4: { short: 'SF', name: 'Semifinals', order: 7 },
  5: { short: 'F', name: 'Finals', order: 8 },
  15: { short: 'T', name: 'Top N', order: 9 },
  16: { short: 'RR', name: 'Round Robin', order: 1 }
};
export const roundOrder = (r) => (ROUNDS[r] ? ROUNDS[r].order : 10);
export const isQual = (m) => m.round === 2;
export const isElim = (m) => m.round !== 1 && m.round !== 2;

export function matchLabel(m) {
  const r = ROUNDS[m.round];
  if (!r) return m.name || `M${m.matchnum}`;
  if (m.round === 1 || m.round === 2 || m.round === 16) return `${r.short}${m.matchnum}`;
  return `${r.short} ${m.instance}-${m.matchnum}`;
}
export function matchSortKey(m) {
  return roundOrder(m.round) * 1e6 + (m.instance || 0) * 1e3 + (m.matchnum || 0);
}

export function eventStatus(e, now = new Date()) {
  if (!e) return 'unknown';
  const s = toDate(e.start), en = toDate(e.end);
  if (e.ongoing) return 'live';
  if (s && s > now) return 'upcoming';
  if (en) {
    const endOfDay = new Date(en); endOfDay.setHours(23, 59, 59, 999);
    if (now <= endOfDay && s && s <= now) return 'live';
    if (endOfDay < now) return 'past';
  }
  return s && s <= now ? 'past' : 'upcoming';
}

export function eventPlace(e) {
  const l = (e && e.location) || {};
  return [l.city, l.region, l.country].filter(Boolean).join(', ');
}

export const PROGRAM_IDS = { V5RC: 1, VIQRC: 41, VEXU: 4, VAIRC: 57 };
export const PROGRAM_NAMES = { V5RC: 'V5 Robotics Competition', VIQRC: 'VEX IQ Robotics Competition', VEXU: 'VEX U', VAIRC: 'VEX AI' };

export function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
  const ta = document.createElement('textarea');
  ta.value = text; document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); } finally { ta.remove(); }
  return Promise.resolve();
}

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
}

export function toCSV(rows) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return rows.map((r) => r.map(esc).join(',')).join('\n');
}

export function youtubeId(url) {
  if (!url) return null;
  const m = String(url).match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([\w-]{11})/);
  return m ? m[1] : null;
}
export function youtubeStart(url) {
  const m = String(url || '').match(/[?&#](?:t|start)=(\d+h)?(\d+m)?(\d+s?)?/);
  if (!m) return 0;
  const h = parseInt(m[1]) || 0, mi = parseInt(m[2]) || 0, s = parseInt(m[3]) || 0;
  return h * 3600 + mi * 60 + s;
}
