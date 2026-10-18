import { html, useState, useEffect, useMemo } from '../lib/html.js';
import { Icon } from '../lib/icons.js';
import { cx, fmt, pct, debounce } from '../lib/util.js';
import { useStore, myTeam } from '../lib/state.js';
import { setQuery, navigate } from '../lib/router.js';
import { useData, findTeam, skillsFor, searchTeams, seasonRatings, teamSeason, seasonId, sideOf, isPlayed } from '../lib/data.js';
import { predictMatch, tsScore, TS } from '../lib/stats.js';
import { Screen, Section, ProbBar, Empty, Skeleton, TeamPill } from '../components/ui.js';
import { teamRecord } from './team.js';

// ---------- Team picker with suggestions ----------
export function TeamPicker({ onPick, placeholder = 'Add team', exclude = [] }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState([]);
  const run = useMemo(() => debounce(async (t) => setList(t.trim() ? await searchTeams(t, { limit: 6 }) : []), 120), []);
  useEffect(() => { run(q); }, [q]);
  const pick = (n) => { onPick(n.toUpperCase()); setQ(''); setList([]); };
  return html`<div style="position:relative">
    <div class="search"><${Icon} name="plus" />
      <input class="input" value=${q} placeholder=${placeholder} autocapitalize="characters" autocomplete="off"
        onInput=${(e) => setQ(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter' && q.trim()) { e.preventDefault(); pick(list[0] ? list[0].number : q.trim()); } }} />
    </div>
    ${list.length > 0 && html`<div class="list" style="position:absolute;z-index:30;left:0;right:0;top:calc(100% + 6px);box-shadow:var(--shadow)">
      ${list.filter((t) => !exclude.includes(t.number)).map((t) => html`<button class="row" style="min-height:48px" onClick=${() => pick(t.number)}>
        <div class="row-main"><div class="row-title">${t.number}<span class="faint" style="font-weight:500">${t.name || ''}</span></div>
        <div class="row-sub">${[t.org, t.region || t.country].filter(Boolean).join(' · ')}</div></div>
        ${t.ts != null && html`<span class="small brand-text strong">${fmt(t.ts, 1)}</span>`}</button>`)}
    </div>`}
  </div>`;
}

// ---------- Compare ----------
export function Compare({ query }) {
  const teams = (query.teams || myTeam()).split(',').map((t) => t.trim().toUpperCase()).filter(Boolean).slice(0, 4);
  const setTeams = (list) => setQuery({ teams: list.join(',') });
  const program = useStore((s) => s.settings.program);
  const q = useData(teams.length ? `compare:${program}:${teams.join(',')}` : null, async () => {
    const season = await seasonId();
    return Promise.all(teams.map(async (n) => {
      const t = await findTeam(n).catch(() => null);
      if (!t) return { number: n, missing: true };
      const [sk, det] = await Promise.all([skillsFor(n).catch(() => ({})), teamSeason(t, season).catch(() => null)]);
      return { ...t, skills: sk.entry || null, rec: det ? teamRecord(det.matches, n) : null, det };
    }));
  }, { ttl: 900 });
  const data = q.data || [];

  const metrics = [
    ['TrueSkill', (t) => t.ts, 1, 1], ['World TS rank', (t) => t.tsRank, 0, -1],
    ['Win rate', (t) => (t.rec && t.rec.played ? t.rec.winRate : null), 'pct', 1],
    ['Record', (t) => (t.rec && t.rec.played ? `${t.rec.w}-${t.rec.l}-${t.rec.t}` : t.w != null ? `${t.w}-${t.l}-${t.t}` : null), 'text', 0],
    ['OPR', (t) => t.opr, 1, 1], ['DPR', (t) => t.dpr, 1, -1], ['CCWM', (t) => t.ccwm, 1, 1],
    ['Avg score', (t) => (t.rec ? t.rec.avg : null), 1, 1], ['High score', (t) => (t.rec ? t.rec.high : null), 0, 1],
    ['Skills total', (t) => (t.skills ? t.skills.scores.score : null), 0, 1], ['Skills auton', (t) => (t.skills ? t.skills.scores.programming : null), 0, 1],
    ['Skills driver', (t) => (t.skills ? t.skills.scores.driver : null), 0, 1], ['Skills rank', (t) => (t.skills ? t.skills.rank : null), 0, -1]
  ];

  // head to head (from the first team's matches)
  const h2h = useMemo(() => {
    const first = data[0];
    if (!first || !first.det || data.length < 2) return [];
    return data.slice(1).map((o) => {
      let vs = { w: 0, l: 0, t: 0 }, with_ = { w: 0, l: 0, t: 0 };
      for (const m of first.det.matches) {
        if (!isPlayed(m) || m.round === 1) continue;
        const a = sideOf(m, first.number), b = sideOf(m, o.number);
        if (!a || !b) continue;
        const own = m[a].score, opp = m[a === 'red' ? 'blue' : 'red'].score;
        const k = own > opp ? 'w' : own < opp ? 'l' : 't';
        if (a === b) with_[k]++; else vs[k]++;
      }
      return { team: o.number, vs, with_ };
    });
  }, [data]);

  return html`<${Screen} title="Compare teams" sub="Up to four teams side by side" backTo="/explore">
    <div class="flex flex-wrap" style="gap:8px">
      ${teams.map((t) => html`<span class="chip" style="height:34px">${t}<button aria-label=${`Remove ${t}`} onClick=${() => setTeams(teams.filter((x) => x !== t))}><${Icon} name="x" size="14" /></button></span>`)}
    </div>
    ${teams.length < 4 && html`<div class="mt-12"><${TeamPicker} exclude=${teams} onPick=${(n) => !teams.includes(n) && setTeams([...teams, n])} placeholder="Add a team to compare" /></div>`}
    ${q.loading && !q.data ? html`<div class="mt-16"><${Skeleton} rows=${6} /></div>` : teams.length === 0 ? html`<${Empty} icon="compare" title="Pick teams to compare" />` : html`
      <div class="table-wrap mt-16"><table class="table">
        <thead><tr><th class="left">Metric</th>${data.map((t) => html`<th><a href=${`#/team/${t.number}`} class=${t.number === myTeam() ? 'brand-text' : ''} style="font-size:13px;color:inherit">${t.number}</a></th>`)}</tr></thead>
        <tbody>
          <tr><td class="left muted">Name</td>${data.map((t) => html`<td class="small" style="white-space:normal;max-width:140px">${t.name || '—'}</td>`)}</tr>
          ${metrics.map(([label, fn, digits, better]) => {
            const vals = data.map(fn);
            const nums = vals.filter((v) => typeof v === 'number');
            const best = better && nums.length > 1 ? (better > 0 ? Math.max(...nums) : Math.min(...nums)) : null;
            return html`<tr><td class="left muted">${label}</td>${vals.map((v) => html`<td class=${cx(best != null && v === best && 'strong brand-text')}>
              ${v == null ? '—' : digits === 'pct' ? pct(v) : digits === 'text' ? v : fmt(v, digits)}</td>`)}</tr>`;
          })}
        </tbody>
      </table></div>
      ${h2h.length > 0 && html`<${Section} title=${`${data[0].number} head-to-head`}>
        <div class="list">${h2h.map((h) => html`<div class="row">
          <div class="row-main"><div class="row-title">vs ${h.team}</div><div class="row-sub">Against: ${h.vs.w}-${h.vs.l}-${h.vs.t} · Together: ${h.with_.w}-${h.with_.l}-${h.with_.t}</div></div>
        </div>`)}</div>
      </${Section}>`}
      ${data.length === 4 && html`<a class="btn mt-16" href=${`#/predict?red=${teams[0]},${teams[1]}&blue=${teams[2]},${teams[3]}`}><${Icon} name="sparkles" /> Predict ${teams[0]} + ${teams[1]} vs ${teams[2]} + ${teams[3]}</a>`}
    `}
  </${Screen}>`;
}

// ---------- Match predictor ----------
export function Predict({ query }) {
  const red = (query.red || '').split(',').map((t) => t.trim().toUpperCase()).filter(Boolean).slice(0, 2);
  const blue = (query.blue || '').split(',').map((t) => t.trim().toUpperCase()).filter(Boolean).slice(0, 2);
  const program = useStore((s) => s.settings.program);
  const rq = useData(`ratings:${program}`, () => seasonRatings(), { ttl: 3600 });
  const set = (r, b) => setQuery({ red: r.join(','), blue: b.join(',') });
  const ratings = rq.data ? rq.data.ratings : new Map();
  const oprs = rq.data ? rq.data.oprs : new Map();
  const ready = red.length > 0 && blue.length > 0;
  const pred = ready ? predictMatch(red, blue, { ratings, oprs }) : null;
  const def = { mu: TS.mu, sigma: TS.sigma };

  const Side = ({ color, list, other }) => html`<div class=${cx('alliance', color)}>
    <div class="alliance-head"><span class="alliance-name">${color} alliance</span>
      ${pred && pred.redScore != null && html`<span class="alliance-score" style="font-size:26px">${fmt(color === 'red' ? pred.redScore : pred.blueScore)}</span>`}</div>
    <div class="alliance-teams">
      ${list.map((t) => {
        const r = ratings.get(t), o = oprs.get(t);
        return html`<div class="alliance-team"><a class="n" href=${`#/team/${t}`}>${t}</a>
          <span class="m">${r ? `TS ${fmt(tsScore(r), 1)}` : 'unrated'}${o ? html`<br />OPR ${fmt(o.opr, 1)}` : ''}</span>
          <button class="btn-icon" style="width:28px;height:28px" aria-label=${`Remove ${t}`} onClick=${() => color === 'red' ? set(list.filter((x) => x !== t), other) : set(other, list.filter((x) => x !== t))}><${Icon} name="x" size="15" /></button></div>`;
      })}
      ${list.length < 2 && html`<${TeamPicker} placeholder="Add team" exclude=${[...red, ...blue]} onPick=${(n) => color === 'red' ? set([...list, n], other) : set(other, [...list, n])} />`}
    </div>
  </div>`;

  return html`<${Screen} title="Match predictor" sub="Win probability from season TrueSkill, expected score from OPR" backTo="/tools">
    <div class="alliances" style="align-items:start">
      <${Side} color="red" list=${red} other=${blue} />
      <${Side} color="blue" list=${blue} other=${red} />
    </div>
    <div class="flex mt-12" style="justify-content:center">
      <button class="btn btn-sm" onClick=${() => set(blue, red)}><${Icon} name="compare" /> Swap sides</button>
      ${red.length + blue.length > 0 && html`<button class="btn btn-sm btn-ghost" onClick=${() => set([], [])}>Clear</button>`}
    </div>
    ${ready ? html`<div class="card card-pad mt-16">
      <div class="flex between mb-8"><div class="eyebrow">Win probability</div><span class="badge">${pred.method === 'none' ? 'Not enough data' : pred.method}</span></div>
      <${ProbBar} pRed=${pred.pRed} />
      <p class="small muted mt-12">${pred.method === 'TrueSkill'
        ? `Based on each team's season TrueSkill (mean ${red.map((t) => fmt((ratings.get(t) || def).mu, 1)).join(' + ')} vs ${blue.map((t) => fmt((ratings.get(t) || def).mu, 1)).join(' + ')}).`
        : pred.method === 'OPR' ? 'Based on season-average OPR.' : 'These teams have no rated matches yet this season.'}</p>
    </div>` : html`<${Empty} icon="sparkles" title="Pick the alliances" text="Add one or two teams to each side to see who's favoured." />`}
    ${!rq.loading && rq.data && !rq.data.available && html`<p class="small faint mt-12">Season TrueSkill ratings appear once the data job has run.</p>`}
  </${Screen}>`;
}
