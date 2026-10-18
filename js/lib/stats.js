// Analytics: OPR / DPR / CCWM, TrueSkill, match predictions.
import { isQual } from './util.js';

// ---------- Normal distribution ----------
function erfc(x) {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
    t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}
export const cdf = (x) => 0.5 * erfc(-x / Math.SQRT2);
export const pdf = (x) => Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
function ppf(p) { // inverse CDF by bisection (only used for constants)
  let lo = -10, hi = 10;
  for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (cdf(mid) < p) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

// ---------- TrueSkill (same parameters as the data builder in scripts/build_data.py) ----------
export const TS = { mu: 25, sigma: 25 / 3, beta: 25 / 6, tau: 25 / 300, drawProbability: 0.02 };
export const tsScore = (r) => (r ? r.mu - 3 * r.sigma : null); // conservative skill estimate shown in the UI

function vWin(t, e) { const x = t - e; const d = cdf(x); return d < 1e-300 ? -x : pdf(x) / d; }
function wWin(t, e) { const v = vWin(t, e); return v * (v + t - e); }
function vDraw(t, e) {
  const a = e - t, b = -e - t; const d = cdf(a) - cdf(b);
  return d < 1e-300 ? (t < 0 ? -t - e : -t + e) : (pdf(b) - pdf(a)) / d;
}
function wDraw(t, e) {
  const a = e - t, b = -e - t; const d = cdf(a) - cdf(b);
  if (d < 1e-300) return 1;
  const v = vDraw(t, e);
  return v * v + (a * pdf(a) - b * pdf(b)) / d;
}

/** Update ratings in place. red/blue: arrays of {mu, sigma}. outcome: 1 red win, -1 blue win, 0 tie. */
export function tsRate(red, blue, outcome) {
  const players = [...red, ...blue];
  players.forEach((p) => { p.s2 = p.sigma * p.sigma + TS.tau * TS.tau; });
  const n = players.length;
  const c2 = players.reduce((s, p) => s + p.s2, 0) + n * TS.beta * TS.beta;
  const c = Math.sqrt(c2);
  const eps = ppf((TS.drawProbability + 1) / 2) * Math.sqrt(n) * TS.beta / c;
  const [win, lose] = outcome < 0 ? [blue, red] : [red, blue];
  const muW = win.reduce((s, p) => s + p.mu, 0), muL = lose.reduce((s, p) => s + p.mu, 0);
  const t = (muW - muL) / c;
  const v = outcome === 0 ? vDraw(t, eps) : vWin(t, eps);
  const w = outcome === 0 ? wDraw(t, eps) : wWin(t, eps);
  for (const p of win) { p.mu += (p.s2 / c) * v; p.sigma = Math.sqrt(p.s2 * Math.max(1e-4, 1 - (p.s2 / c2) * w)); delete p.s2; }
  for (const p of lose) { p.mu -= (p.s2 / c) * v; p.sigma = Math.sqrt(p.s2 * Math.max(1e-4, 1 - (p.s2 / c2) * w)); delete p.s2; }
}

/** Probability that the red alliance beats the blue alliance. */
export function winProbability(red, blue) {
  const all = [...red, ...blue];
  if (!all.length) return 0.5;
  const dm = red.reduce((s, r) => s + r.mu, 0) - blue.reduce((s, r) => s + r.mu, 0);
  const s2 = all.reduce((s, r) => s + r.sigma * r.sigma, 0);
  return cdf(dm / Math.sqrt(all.length * TS.beta * TS.beta + s2));
}

/** Rate a list of normalized matches chronologically, starting from `initial` ratings (Map team -> {mu, sigma}). */
export function rateMatches(matches, initial = new Map()) {
  const ratings = new Map();
  const get = (t) => {
    if (!ratings.has(t)) { const i = initial.get(t); ratings.set(t, i ? { mu: i.mu, sigma: i.sigma } : { mu: TS.mu, sigma: TS.sigma }); }
    return ratings.get(t);
  };
  const sorted = [...matches].filter((m) => m.scored && m.round !== 1)
    .sort((a, b) => (a.started || a.scheduled || '').localeCompare(b.started || b.scheduled || '') || a.matchnum - b.matchnum);
  for (const m of sorted) {
    const r = m.red.teams.filter((t) => !m.red.sitting.includes(t)).map(get);
    const b = m.blue.teams.filter((t) => !m.blue.sitting.includes(t)).map(get);
    if (!r.length || !b.length) continue;
    tsRate(r, b, Math.sign(m.red.score - m.blue.score));
  }
  return ratings;
}

// ---------- OPR / DPR / CCWM ----------
function cholSolve(A, bs) {
  const n = A.length;
  const L = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) L[i][i] = Math.sqrt(Math.max(s, 1e-9));
      else L[i][j] = s / L[j][j];
    }
  }
  return bs.map((b) => {
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= L[i][k] * y[k]; y[i] = s / L[i][i]; }
    const x = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k]; x[i] = s / L[i][i]; }
    return x;
  });
}

/**
 * Per-team stats from an event's qualification matches.
 * Returns Map team -> { opr, dpr, ccwm, played, wins, losses, ties, avg, high, avgMargin }.
 */
export function eventStats(matches) {
  const quals = matches.filter((m) => isQual(m) && m.scored);
  const teams = new Map();
  const rec = (t) => {
    if (!teams.has(t)) teams.set(t, { team: t, played: 0, wins: 0, losses: 0, ties: 0, pts: 0, high: 0, margin: 0 });
    return teams.get(t);
  };
  for (const m of quals) {
    for (const [own, opp] of [[m.red, m.blue], [m.blue, m.red]]) {
      for (const t of own.teams) {
        if (own.sitting.includes(t)) continue;
        const r = rec(t);
        r.played++; r.pts += own.score; r.high = Math.max(r.high, own.score); r.margin += own.score - opp.score;
        if (own.score > opp.score) r.wins++; else if (own.score < opp.score) r.losses++; else r.ties++;
      }
    }
  }
  const list = [...teams.keys()];
  const idx = new Map(list.map((t, i) => [t, i]));
  const n = list.length;
  const out = new Map();
  if (!n) return out;
  const A = Array.from({ length: n }, () => new Float64Array(n));
  const bS = new Float64Array(n), bO = new Float64Array(n), bM = new Float64Array(n);
  for (const m of quals) {
    for (const [own, opp] of [[m.red, m.blue], [m.blue, m.red]]) {
      const ids = own.teams.filter((t) => !own.sitting.includes(t)).map((t) => idx.get(t));
      for (const i of ids) {
        for (const j of ids) A[i][j] += 1;
        bS[i] += own.score; bO[i] += opp.score; bM[i] += own.score - opp.score;
      }
    }
  }
  const lambda = 0.05;
  for (let i = 0; i < n; i++) A[i][i] += lambda;
  const [opr, dpr, ccwm] = cholSolve(A, [bS, bO, bM]);
  // residual spread of the OPR model, used to turn score gaps into win probabilities
  let se = 0, cnt = 0;
  for (const m of quals) {
    for (const own of [m.red, m.blue]) {
      const pred = own.teams.filter((t) => !own.sitting.includes(t)).reduce((s, t) => s + opr[idx.get(t)], 0);
      se += (own.score - pred) ** 2; cnt++;
    }
  }
  const sigma = cnt > n ? Math.sqrt(se / Math.max(1, cnt - n)) : null;
  for (const t of list) {
    const r = teams.get(t), i = idx.get(t);
    out.set(t, {
      team: t, opr: opr[i], dpr: dpr[i], ccwm: ccwm[i],
      played: r.played, wins: r.wins, losses: r.losses, ties: r.ties,
      avg: r.played ? r.pts / r.played : 0, high: r.high, avgMargin: r.played ? r.margin / r.played : 0
    });
  }
  out.sigma = sigma;
  return out;
}

/**
 * Predict a match. ratings: Map team -> {mu, sigma} (TrueSkill), oprs: Map team -> {opr} (optional).
 * Returns { pRed, redScore, blueScore, method }.
 */
export function predictMatch(redTeams, blueTeams, { ratings, oprs, sigma } = {}) {
  const def = { mu: TS.mu, sigma: TS.sigma };
  let pRed = null, method = null;
  const known = (ts) => ratings && ts.filter((t) => ratings.has(t)).length;
  if (ratings && known(redTeams) + known(blueTeams) >= Math.ceil((redTeams.length + blueTeams.length) / 2)) {
    pRed = winProbability(redTeams.map((t) => ratings.get(t) || def), blueTeams.map((t) => ratings.get(t) || def));
    method = 'TrueSkill';
  }
  let redScore = null, blueScore = null;
  if (oprs && oprs.size) {
    const o = (t) => (oprs.get(t) ? oprs.get(t).opr : null);
    const rs = redTeams.map(o), bs = blueTeams.map(o);
    if (rs.every((x) => x != null) && bs.every((x) => x != null)) {
      redScore = Math.max(0, rs.reduce((a, b) => a + b, 0));
      blueScore = Math.max(0, bs.reduce((a, b) => a + b, 0));
      if (pRed == null) {
        const s = (sigma || Math.max(8, (redScore + blueScore) * 0.22)) * Math.SQRT2;
        pRed = cdf((redScore - blueScore) / s);
        method = 'OPR';
      }
    }
  }
  return { pRed: pRed == null ? 0.5 : pRed, redScore, blueScore, method: method || 'none' };
}

export function mean(a) { const v = a.filter((x) => x != null && !Number.isNaN(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; }
