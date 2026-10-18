import { html, useState, useMemo, useEffect } from '../lib/html.js';
import { Icon } from '../lib/icons.js';
import { cx, fmt, pct, ordinal, fmtDateRange, eventStatus, eventPlace, sortBy, groupBy, matchSortKey, matchLabel, ROUNDS, isQual, norm, toCSV } from '../lib/util.js';
import { useStore, myTeam, openSheet, saveDoc, liveDocs, toast, isFav } from '../lib/state.js';
import { setQuery, navigate } from '../lib/router.js';
import { useData, eventData, seasonRatings, isPlayed, sideOf } from '../lib/data.js';
import { eventStats, predictMatch, rateMatches, tsScore } from '../lib/stats.js';
import { shareFile } from '../lib/share.js';
import {
  Screen, Section, Tabs, Seg, Tile, MatchRow, Empty, Skeleton, ErrorState, FavButton, LevelBadge, Updated, SearchBox, TeamPill, Stars, KV
} from '../components/ui.js';
import { MatchSheet } from './match.js';

const TABS = [
  { id: 'matches', label: 'Matches' }, { id: 'rankings', label: 'Rankings' }, { id: 'teams', label: 'Teams' },
  { id: 'stats', label: 'Stats' }, { id: 'predict', label: 'Predict' }, { id: 'picklist', label: 'Pick list' },
  { id: 'skills', label: 'Skills' }, { id: 'awards', label: 'Awards' }, { id: 'info', label: 'Info' }
];

export function EventView({ params, query }) {
  const id = Number(params.id);
  const tab = query.tab || 'matches';
  const program = useStore((s) => s.settings.program);
  const favs = useStore((s) => s.favs.teams);
  const [live, setLive] = useState(false);
  // Polls every 30 s while the event is running
  const q = useData(`event:${id}`, () => eventData(id), { ttl: live ? 25 : 60, poll: live ? 30 : 0 });
  const data = q.data;
  useEffect(() => { setLive(!!(data && data.live)); }, [data]);
  const rq = useData(`ratings:${program}`, () => seasonRatings(), { ttl: 3600 });

  const me = myTeam();
  const divs = data ? data.divisions : [];
  const myDiv = divs.find((d) => d.matches.some((m) => sideOf(m, me)));
  const [divId, setDivId] = useState(null);
  const div = divs.find((d) => d.id === divId) || myDiv || divs[0];
  const stats = useMemo(() => (div ? eventStats(div.matches) : null), [div]);
  const ratings = useMemo(() => {
    if (rq.data && rq.data.available) return rq.data.ratings;
    return div ? rateMatches(div.matches) : null; // fall back to ratings from this event alone
  }, [rq.data, div]);

  if (q.loading && !data) {
    return html`<${Screen} title="Event" backTo="/explore?tab=events"><div class="skel" style="height:150px;border-radius:20px"></div><div class="mt-16"><${Skeleton} rows=${6} /></div></${Screen}>`;
  }
  if (!data) return html`<${Screen} title="Event" backTo="/explore?tab=events"><${ErrorState} error=${q.error || new Error('Event not found')} onRetry=${q.refresh} /></${Screen}>`;

  const e = data.event;
  const st = eventStatus(e);
  return html`<${Screen} title=${e.name} backTo="/explore?tab=events" head=${false}
    actions=${html`<${FavButton} kind="events" id=${id} />`}>
    <div class="hero" style="padding-bottom:16px">
      <div class="hero-top">
        <div class="grow">
          <div class="flex gap-4 mb-8">${st === 'live' ? html`<span class="badge badge-live">Live</span>` : st === 'upcoming' ? html`<span class="badge">Upcoming</span>` : html`<span class="badge">Completed</span>`}<${LevelBadge} level=${e.level} /></div>
          <div style="font-size:22px;font-weight:850;letter-spacing:-.02em;line-height:1.2">${e.name}</div>
          <div class="hero-meta mt-4">${fmtDateRange(e.start, e.end)} · ${eventPlace(e)}</div>
        </div>
        <div class="hero-actions hide-mobile"><${FavButton} kind="events" id=${id} /></div>
      </div>
      <div class="hero-stats" style="grid-template-columns:repeat(3,minmax(0,1fr))">
        <div class="hero-stat"><div class="l">Teams</div><div class="v">${data.teams.length || '—'}</div></div>
        <div class="hero-stat"><div class="l">Matches</div><div class="v">${div ? div.matches.filter(isPlayed).length : 0}<span style="font-size:13px;color:#8E8E96">/${div ? div.matches.length : 0}</span></div></div>
        <div class="hero-stat hl"><div class="l">${me} rank</div><div class="v">${(() => { const r = div && div.rankings.find((x) => x.team && x.team.name === me); return r ? ordinal(r.rank) : '—'; })()}</div></div>
      </div>
    </div>
    ${divs.length > 1 && html`<div class="mt-12"><${Seg} options=${divs.map((d) => ({ value: d.id, label: d.name }))} value=${div && div.id} onChange=${setDivId} /></div>`}
    <div class="mt-12"></div>
    <${Tabs} tabs=${TABS} value=${tab} onChange=${(t) => setQuery({ tab: t })} />
    <div class="tab-panel">
      ${tab === 'matches' && html`<${MatchesTab} div=${div} stats=${stats} ratings=${ratings} favs=${favs} event=${e} />`}
      ${tab === 'rankings' && html`<${RankingsTab} div=${div} stats=${stats} />`}
      ${tab === 'teams' && html`<${TeamsTab} data=${data} stats=${stats} ratings=${ratings} />`}
      ${tab === 'stats' && html`<${StatsTab} div=${div} stats=${stats} ratings=${ratings} event=${e} />`}
      ${tab === 'predict' && html`<${PredictTab} div=${div} stats=${stats} ratings=${ratings} />`}
      ${tab === 'picklist' && html`<${PickList} event=${e} div=${div} stats=${stats} ratings=${ratings} teams=${data.teams} />`}
      ${tab === 'skills' && html`<${SkillsTab} skills=${data.skills} />`}
      ${tab === 'awards' && html`<${AwardsTab} awards=${data.awards} />`}
      ${tab === 'info' && html`<${InfoTab} e=${e} data=${data} />`}
    </div>
    <div class="mt-16 flex between flex-wrap gap-12">
      <${Updated} at=${q.updatedAt} refreshing=${q.refreshing} live=${st === 'live'} onRefresh=${q.refresh} />
      <a class="btn btn-sm" href=${`#/event/${id}/report`}><${Icon} name="fileText" /> Event report</a>
    </div>
  </${Screen}>`;
}

// ---------- Matches ----------
function MatchesTab({ div, stats, ratings, favs, event }) {
  const me = myTeam();
  const [filter, setFilter] = useState('all');
  if (!div || !div.matches.length) return html`<${Empty} icon="calendar" title="No matches yet" text="The schedule appears once the event publishes it." />`;
  let ms = sortBy(div.matches, matchSortKey);
  if (filter === 'mine') ms = ms.filter((m) => sideOf(m, me));
  if (filter === 'favs') ms = ms.filter((m) => [...m.red.teams, ...m.blue.teams].some((t) => favs.includes(t) || t === me));
  if (filter === 'upcoming') ms = ms.filter((m) => !isPlayed(m));
  const groups = groupBy(ms, (m) => (ROUNDS[m.round] || {}).name || 'Matches');
  const open = (m) => openSheet(() => html`<${MatchSheet} m=${{ ...m, event: { id: event.id, name: event.name } }} stats=${stats} ratings=${ratings} />`, { title: event.name });
  return html`<div>
    <${Seg} options=${[{ value: 'all', label: 'All' }, { value: 'mine', label: me }, { value: 'favs', label: 'Starred' }, { value: 'upcoming', label: 'Upcoming' }]} value=${filter} onChange=${setFilter} />
    ${!ms.length && html`<${Empty} icon="swords" title="No matches for this filter" />`}
    ${[...groups.entries()].map(([name, list]) => html`<div class="section" style="margin-top:16px">
      <div class="section-head"><h2>${name}</h2><span class="small muted">${list.filter(isPlayed).length}/${list.length} played</span></div>
      <div class="list">${list.map((m) => {
        const pred = !isPlayed(m) ? predictMatch(m.red.teams, m.blue.teams, { ratings, oprs: stats, sigma: stats && stats.sigma }) : null;
        return html`<${MatchRow} m=${m} me=${me} favs=${favs} pred=${pred} onClick=${() => open(m)} />`;
      })}</div>
    </div>`)}
  </div>`;
}

// ---------- Rankings ----------
function RankingsTab({ div, stats }) {
  const me = myTeam();
  if (!div || !div.rankings.length) return html`<${Empty} icon="trophy" title="No rankings yet" text="Rankings appear after the first qualification matches." />`;
  const rows = sortBy(div.rankings, (r) => r.rank);
  return html`<div class="table-wrap"><table class="table">
    <thead><tr><th>#</th><th class="left">Team</th><th>W-L-T</th><th>WP</th><th>AP</th><th>SP</th><th>Avg</th><th>OPR</th></tr></thead>
    <tbody>${rows.map((r) => {
      const t = r.team && r.team.name;
      const s = stats && stats.get(t);
      return html`<tr class=${cx('clickable', t === me && 'me')} onClick=${() => navigate('/team/' + t)}>
        <td class="strong">${r.rank}</td><td class="left team">${t}</td>
        <td>${r.wins}-${r.losses}-${r.ties}</td><td class="strong">${r.wp}</td><td>${r.ap}</td><td>${r.sp}</td>
        <td>${r.average_points != null ? fmt(r.average_points, 1) : '—'}</td><td class="muted">${s ? fmt(s.opr, 1) : '—'}</td>
      </tr>`;
    })}</tbody></table></div>
    <p class="tiny faint mt-8">WP win points · AP autonomous points · SP strength of schedule.</p>`;
}

// ---------- Teams ----------
function TeamsTab({ data, stats, ratings }) {
  const [text, setText] = useState('');
  const me = myTeam();
  const t = norm(text);
  const list = sortBy(data.teams.filter((x) => !t || norm(`${x.number} ${x.team_name} ${x.organization} ${x.location && x.location.city}`).includes(t)),
    (x) => { const r = ratings && ratings.get(x.number); return r ? -tsScore(r) : 0; });
  if (!data.teams.length) return html`<${Empty} icon="users" title="Team list not available" />`;
  return html`<div>
    <${SearchBox} value=${text} onInput=${setText} placeholder="Filter teams" />
    <div class="list mt-12">${list.map((x) => {
      const r = ratings && ratings.get(x.number);
      const s = stats && stats.get(x.number);
      return html`<a class="row" href=${`#/team/${x.number}`}>
        <div class=${cx('avatar', x.number === me && 'brand')}>${String(x.number).replace(/[A-Z]+$/i, '')}</div>
        <div class="row-main"><div class="row-title">${x.number}<span class="faint" style="font-weight:500">${x.team_name || ''}</span>${isFav('teams', x.number) ? html`<${Icon} name="starFill" size="14" style="color:var(--brand)" />` : ''}</div>
          <div class="row-sub">${[x.organization, x.location && (x.location.city || x.location.region)].filter(Boolean).join(' · ')}</div></div>
        <div class="row-end"><div class="big brand-text">${r ? fmt(tsScore(r), 1) : '—'}</div><div class="small">${s ? `OPR ${fmt(s.opr, 1)}` : 'TrueSkill'}</div></div>
      </a>`;
    })}</div>
  </div>`;
}

// ---------- Stats (OPR / DPR / CCWM) ----------
function StatsTab({ div, stats, ratings, event }) {
  const [sort, setSort] = useState({ k: 'opr', d: -1 });
  const me = myTeam();
  if (!stats || !stats.size) return html`<${Empty} icon="chart" title="Stats need played matches" text="OPR, DPR and CCWM are calculated from qualification results once a few matches are scored." />`;
  const rows = [...stats.values()].map((s) => ({ ...s, ts: ratings && ratings.get(s.team) ? tsScore(ratings.get(s.team)) : null }));
  const sorted = sortBy(rows, (r) => r[sort.k], sort.d);
  const H = (k, label) => html`<th class=${cx('sortable', sort.k === k && 'sorted')} onClick=${() => setSort({ k, d: sort.k === k ? -sort.d : -1 })}>${label}${sort.k === k ? (sort.d < 0 ? ' ↓' : ' ↑') : ''}</th>`;
  const exportCsv = () => {
    const csv = toCSV([['Team', 'OPR', 'DPR', 'CCWM', 'TrueSkill', 'W', 'L', 'T', 'Avg', 'High'],
      ...sorted.map((r) => [r.team, r.opr.toFixed(2), r.dpr.toFixed(2), r.ccwm.toFixed(2), r.ts != null ? r.ts.toFixed(2) : '', r.wins, r.losses, r.ties, r.avg.toFixed(1), r.high])]);
    shareFile(`${event.sku || 'event'}-stats.csv`, new Blob([csv], { type: 'text/csv' }), 'Event stats');
  };
  return html`<div>
    <div class="table-wrap"><table class="table">
      <thead><tr><th class="left">Team</th>${H('opr', 'OPR')}${H('dpr', 'DPR')}${H('ccwm', 'CCWM')}${H('ts', 'TS')}${H('wins', 'W-L-T')}${H('avg', 'Avg')}${H('high', 'High')}</tr></thead>
      <tbody>${sorted.map((r) => html`<tr class=${cx('clickable', r.team === me && 'me')} onClick=${() => navigate('/team/' + r.team)}>
        <td class="left team">${r.team}</td><td class="strong">${fmt(r.opr, 1)}</td><td>${fmt(r.dpr, 1)}</td>
        <td class=${r.ccwm >= 0 ? 'win' : 'loss'}>${fmt(r.ccwm, 1)}</td><td class="brand-text">${r.ts != null ? fmt(r.ts, 1) : '—'}</td>
        <td>${r.wins}-${r.losses}-${r.ties}</td><td>${fmt(r.avg, 1)}</td><td>${r.high}</td>
      </tr>`)}</tbody></table></div>
    <div class="flex between mt-12 flex-wrap gap-12">
      <p class="tiny faint" style="max-width:520px">OPR = points a team adds to its alliance; DPR = points it allows; CCWM = OPR − DPR (contribution to winning margin). Least-squares over qualification matches.</p>
      <button class="btn btn-sm" onClick=${exportCsv}><${Icon} name="download" /> Export CSV</button>
    </div>
  </div>`;
}

// ---------- Predictions ----------
function PredictTab({ div, stats, ratings }) {
  const me = myTeam();
  if (!div) return null;
  const quals = div.matches.filter(isQual);
  const remaining = quals.filter((m) => !isPlayed(m));
  // projected record = current wins + expected wins in remaining quals
  const proj = new Map();
  const bump = (t, k, v) => { if (!proj.has(t)) proj.set(t, { team: t, w: 0, l: 0, t: 0, exp: 0, left: 0 }); proj.get(t)[k] += v; };
  for (const m of quals) {
    if (isPlayed(m)) {
      const rw = m.red.score > m.blue.score, bw = m.blue.score > m.red.score;
      m.red.teams.forEach((t) => bump(t, rw ? 'w' : bw ? 'l' : 't', 1));
      m.blue.teams.forEach((t) => bump(t, bw ? 'w' : rw ? 'l' : 't', 1));
    } else {
      const p = predictMatch(m.red.teams, m.blue.teams, { ratings, oprs: stats, sigma: stats && stats.sigma });
      m.red.teams.forEach((t) => { bump(t, 'exp', p.pRed); bump(t, 'left', 1); });
      m.blue.teams.forEach((t) => { bump(t, 'exp', 1 - p.pRed); bump(t, 'left', 1); });
    }
  }
  const table = sortBy([...proj.values()], (r) => r.w + r.t * 0.5 + r.exp, -1);
  // accuracy of the model on already-played matches
  let right = 0, total = 0;
  for (const m of quals.filter(isPlayed)) {
    if (m.red.score === m.blue.score) continue;
    const p = predictMatch(m.red.teams, m.blue.teams, { ratings, oprs: stats, sigma: stats && stats.sigma });
    if (p.method === 'none') continue;
    total++; if ((p.pRed >= 0.5) === (m.red.score > m.blue.score)) right++;
  }
  return html`<div>
    <div class="tiles">
      <${Tile} label="Matches left" value=${remaining.length} sub=${`of ${quals.length} quals`} />
      <${Tile} label="Model accuracy" value=${total ? pct(right / total) : '—'} sub=${total ? `${right}/${total} played` : 'no results yet'} accent />
      <${Tile} label="Your projection" value=${(() => { const r = proj.get(me); return r ? fmt(r.w + r.exp, 1) : '—'; })()} sub=${(() => { const r = proj.get(me); return r ? `wins of ${r.w + r.l + r.t + r.left}` : ''; })()} />
    </div>
    <${Section} title="Projected qualification record">
      <div class="table-wrap"><table class="table">
        <thead><tr><th>#</th><th class="left">Team</th><th>Now</th><th>Left</th><th>Proj. wins</th></tr></thead>
        <tbody>${table.map((r, i) => html`<tr class=${cx('clickable', r.team === me && 'me')} onClick=${() => navigate('/team/' + r.team)}>
          <td class="muted">${i + 1}</td><td class="left team">${r.team}</td><td>${r.w}-${r.l}-${r.t}</td><td>${r.left}</td>
          <td class="strong brand-text">${fmt(r.w + r.t * 0.5 + r.exp, 1)}</td></tr>`)}</tbody>
      </table></div>
      <p class="tiny faint mt-8">Expected wins use ${ratings && ratings.size ? 'season TrueSkill ratings' : 'event results'} for each remaining match. Official ranks also use WP, AP and SP.</p>
    </${Section}>
  </div>`;
}

// ---------- Pick list / alliance selection ----------
function PickList({ event, div, stats, ratings, teams }) {
  const docs = useStore((s) => s.docs);
  const me = myTeam();
  const existing = liveDocs(docs, 'picklist').find((p) => p.event === event.id);
  const notes = liveDocs(docs, 'scout');
  const [metric, setMetric] = useState('ts');
  const rows = useMemo(() => {
    const base = (teams.length ? teams.map((t) => t.number) : div ? [...new Set(div.matches.flatMap((m) => [...m.red.teams, ...m.blue.teams]))] : []);
    return base.filter((t) => t !== me).map((t) => {
      const s = stats && stats.get(t);
      const r = ratings && ratings.get(t);
      const ns = notes.filter((n) => n.team === t && n.rating);
      const rank = div && div.rankings.find((x) => x.team && x.team.name === t);
      return { team: t, ts: r ? tsScore(r) : null, opr: s ? s.opr : null, ccwm: s ? s.ccwm : null, scout: ns.length ? ns.reduce((a, n) => a + n.rating, 0) / ns.length : null, rank: rank ? rank.rank : null };
    });
  }, [teams, div, stats, ratings, notes, me]);
  const order = existing ? existing.order : [];
  const state = existing ? existing.state || {} : {};
  const ranked = order.length ? [...order.filter((t) => rows.find((r) => r.team === t)), ...rows.filter((r) => !order.includes(r.team)).map((r) => r.team)]
    : sortBy(rows, (r) => (metric === 'rank' ? r.rank : r[metric]), metric === 'rank' ? 1 : -1).map((r) => r.team);
  const save = (patch) => saveDoc({ ...(existing || { type: 'picklist', event: event.id, eventName: event.name }), order: ranked, state, ...patch });
  const move = (i, dir) => {
    const next = [...ranked]; const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    save({ order: next });
  };
  const mark = (t, v) => save({ state: { ...state, [t]: state[t] === v ? undefined : v } });
  const byTeam = new Map(rows.map((r) => [r.team, r]));

  return html`<div>
    <div class="flex between flex-wrap gap-12">
      <div class="flex gap-4 flex-wrap"><span class="small muted">Sort by</span>
        <${Seg} options=${[{ value: 'ts', label: 'TrueSkill' }, { value: 'opr', label: 'OPR' }, { value: 'ccwm', label: 'CCWM' }, { value: 'scout', label: 'Scouting' }, { value: 'rank', label: 'Rank' }]}
          value=${order.length ? '' : metric} onChange=${(m) => { setMetric(m); if (existing) save({ order: [] }); }} />
      </div>
      ${order.length > 0 && html`<span class="badge badge-soft">Custom order</span>`}
    </div>
    <p class="small muted mt-8">Reorder with the arrows, then tap <b>✓</b> when a team is picked or <b>✕</b> if they decline. Shared with your workspace.</p>
    <div class="list mt-12">${ranked.map((t, i) => {
      const r = byTeam.get(t) || { team: t };
      const s = state[t];
      return html`<div class="row" style=${s ? 'opacity:.45' : ''}>
        <div class="row-rank">${i + 1}</div>
        <div class="row-main">
          <div class="row-title"><a href=${`#/team/${t}`}>${t}</a>${s === 'picked' ? html`<span class="badge badge-win">Picked</span>` : s === 'declined' ? html`<span class="badge badge-loss">Declined</span>` : ''}</div>
          <div class="row-sub tnum">TS ${r.ts != null ? fmt(r.ts, 1) : '—'} · OPR ${r.opr != null ? fmt(r.opr, 1) : '—'} · CCWM ${r.ccwm != null ? fmt(r.ccwm, 1) : '—'}${r.rank ? ` · ${ordinal(r.rank)}` : ''}${r.scout ? ` · ★${r.scout.toFixed(1)}` : ''}</div>
        </div>
        <div class="flex" style="gap:2px">
          <button class="btn-icon" aria-label="Move up" onClick=${() => move(i, -1)}><${Icon} name="chevronUp" /></button>
          <button class="btn-icon" aria-label="Move down" onClick=${() => move(i, 1)}><${Icon} name="chevronDown" /></button>
          <button class=${cx('btn-icon', s === 'picked' && 'on')} aria-label="Picked" onClick=${() => mark(t, 'picked')}><${Icon} name="check" /></button>
          <button class=${cx('btn-icon', s === 'declined' && 'on')} aria-label="Declined" onClick=${() => mark(t, 'declined')}><${Icon} name="x" /></button>
        </div>
      </div>`;
    })}</div>
  </div>`;
}

// ---------- Skills / awards / info ----------
function SkillsTab({ skills }) {
  const me = myTeam();
  if (!skills || !skills.length) return html`<${Empty} icon="target" title="No skills runs yet" />`;
  const by = groupBy(skills, (s) => s.team && s.team.name);
  const rows = sortBy([...by.entries()].map(([t, rs]) => {
    const d = rs.find((r) => r.type === 'driver'), p = rs.find((r) => r.type === 'programming');
    return { team: t, driver: d ? d.score : 0, prog: p ? p.score : 0, total: (d ? d.score : 0) + (p ? p.score : 0), rank: (d || p || {}).rank };
  }), (r) => r.rank || 999);
  return html`<div class="table-wrap"><table class="table">
    <thead><tr><th>#</th><th class="left">Team</th><th>Total</th><th>Auton</th><th>Driver</th></tr></thead>
    <tbody>${rows.map((r) => html`<tr class=${cx('clickable', r.team === me && 'me')} onClick=${() => navigate('/team/' + r.team)}>
      <td class="strong">${r.rank || '—'}</td><td class="left team">${r.team}</td><td class="strong brand-text">${r.total}</td><td>${r.prog}</td><td>${r.driver}</td></tr>`)}</tbody>
  </table></div>`;
}

function AwardsTab({ awards }) {
  if (!awards || !awards.length) return html`<${Empty} icon="trophy" title="No awards announced yet" />`;
  return html`<div class="list">${sortBy(awards, (a) => a.order).map((a) => html`<div class="row">
    <div class="avatar brand"><${Icon} name="trophy" /></div>
    <div class="row-main"><div class="row-title" style="white-space:normal">${a.title}</div>
      <div class="flex flex-wrap gap-4 mt-4">${(a.teamWinners || []).map((w) => html`<${TeamPill} n=${w.team.name} me=${w.team.name === myTeam()} />`)}
        ${(a.individualWinners || []).map((n) => html`<span class="chip">${n}</span>`)}</div>
      ${a.qualifications && a.qualifications.length > 0 && html`<div class="tiny faint mt-4">Qualifies for ${a.qualifications.join(', ')}</div>`}
    </div></div>`)}</div>`;
}

function InfoTab({ e, data }) {
  const l = e.location || {};
  const addr = [l.venue, l.address_1, l.city, l.region, l.postcode, l.country].filter(Boolean).join(', ');
  const maps = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`;
  const yt = `https://www.youtube.com/results?search_query=${encodeURIComponent(e.name + ' VEX livestream')}`;
  return html`<div class="grid-2" style="align-items:start">
    <div class="card card-pad"><${KV} items=${[
      ['Dates', fmtDateRange(e.start, e.end)], ['Level', e.level], ['Type', e.event_type], ['SKU', e.sku],
      ['Divisions', (e.divisions || []).map((d) => d.name).join(', ')], ['Venue', l.venue], ['Address', addr]
    ]} /></div>
    <div class="grid">
      <a class="row card" href=${maps} target="_blank" rel="noopener"><div class="avatar"><${Icon} name="mapPin" /></div><div class="row-main"><div class="row-title">Directions</div><div class="row-sub">${l.venue || addr}</div></div><${Icon} name="external" class="chev" /></a>
      <a class="row card" href=${yt} target="_blank" rel="noopener"><div class="avatar"><${Icon} name="youtube" /></div><div class="row-main"><div class="row-title">Watch</div><div class="row-sub">Find the livestream or match videos</div></div><${Icon} name="external" class="chev" /></a>
      <a class="row card" href=${`https://events.vex.com/robot-competitions/vex-robotics-competition/${e.sku}.html`} target="_blank" rel="noopener"><div class="avatar"><${Icon} name="globe" /></div><div class="row-main"><div class="row-title">Official event page</div><div class="row-sub">events.vex.com</div></div><${Icon} name="external" class="chev" /></a>
    </div>
  </div>`;
}
