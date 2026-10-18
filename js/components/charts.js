// Lightweight SVG charts in the brand style.
import { html } from '../lib/html.js';
import { fmt } from '../lib/util.js';

export function Sparkline({ values, height = 56 }) {
  const v = (values || []).filter((x) => x != null && !Number.isNaN(x));
  if (v.length < 2) return null;
  const W = 300, H = height, pad = 4;
  const lo = Math.min(...v), hi = Math.max(...v);
  const span = hi - lo || 1;
  const x = (i) => pad + (i * (W - pad * 2)) / (v.length - 1);
  const y = (val) => H - pad - ((val - lo) / span) * (H - pad * 2);
  const line = v.map((val, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(val).toFixed(1)}`).join(' ');
  const area = `${line} L${x(v.length - 1).toFixed(1)} ${H} L${x(0).toFixed(1)} ${H} Z`;
  return html`<svg class="spark" viewBox=${`0 0 ${W} ${H}`} preserveAspectRatio="none" style=${`height:${H}px`} aria-hidden="true">
    <path class="area" d=${area} />
    <path class="line" d=${line} vector-effect="non-scaling-stroke" />
  </svg>`;
}

/** Vertical bars of match margins: wins rise in green, losses drop in red. */
export function MarginBars({ margins, height = 64 }) {
  const m = (margins || []).slice(-30);
  if (!m.length) return null;
  const W = Math.max(120, m.length * 12), H = height, mid = H / 2;
  const maxAbs = Math.max(10, ...m.map((x) => Math.abs(x)));
  const bw = W / m.length;
  return html`<svg viewBox=${`0 0 ${W} ${H}`} preserveAspectRatio="none" style=${`width:100%;height:${H}px;display:block`} role="img" aria-label="Recent match margins">
    <line x1="0" x2=${W} y1=${mid} y2=${mid} stroke="var(--line-strong)" stroke-width="1" vector-effect="non-scaling-stroke" />
    ${m.map((val, i) => {
      const h = Math.max(2, (Math.abs(val) / maxAbs) * (mid - 3));
      const col = val > 0 ? 'var(--win)' : val < 0 ? 'var(--loss)' : 'var(--tie)';
      return html`<rect x=${i * bw + bw * 0.18} width=${bw * 0.64} y=${val >= 0 ? mid - h : mid} height=${h} rx="1.5" fill=${col} />`;
    })}
  </svg>`;
}

export function BarList({ items, max, digits = 0 }) {
  const top = max || Math.max(1, ...items.map((i) => i.value || 0));
  return html`<div>${items.map((i) => html`<div class="bar-row">
    <span class="bl">${i.label}</span>
    <div class="bar-track"><div class="bar-fill" style=${`width:${Math.max(0, Math.min(100, ((i.value || 0) / top) * 100))}%;${i.color ? 'background:' + i.color : ''}`}></div></div>
    <span class="bv">${fmt(i.value, digits)}</span>
  </div>`)}</div>`;
}

/** Circular gauge for percentages (0..1). */
export function Ring({ value, size = 64, label }) {
  const r = (size - 8) / 2, c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value || 0));
  return html`<svg width=${size} height=${size} viewBox=${`0 0 ${size} ${size}`} role="img" aria-label=${label || `${Math.round(v * 100)}%`}>
    <circle cx=${size / 2} cy=${size / 2} r=${r} fill="none" stroke="var(--surface-3)" stroke-width="6" />
    <circle cx=${size / 2} cy=${size / 2} r=${r} fill="none" stroke="var(--brand)" stroke-width="6" stroke-linecap="round"
      stroke-dasharray=${`${c * v} ${c}`} transform=${`rotate(-90 ${size / 2} ${size / 2})`} />
    <text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" font-size=${size * 0.24} font-weight="800" fill="var(--text)">${Math.round(v * 100)}%</text>
  </svg>`;
}
