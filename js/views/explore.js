import { html, useState, useMemo, useEffect } from '../lib/html.js';
import { Icon } from '../lib/icons.js';
import { cx, fmt, norm, sortBy, eventStatus, eventPlace, debounce, toDate } from '../lib/util.js';
import { useStore, myTeam, toast } from '../lib/state.js';
import { setQuery, navigate } from '../lib/router.js';
import { useData, searchTeams, teamIndex, seasonEvents, skillsStandings } from '../lib/data.js';
import { hasLive } from '../lib/api.js';
import { Screen, Tabs, Seg, SearchBox, Skeleton, Empty, ErrorState, NoKeyCard, Chips } from '../components/ui.js';
import { EventRow } from './team.js';

const TABS = [
  { id: 'teams', label: 'Teams' }, { id: 'events', label: 'Events' },
  { id: 'trueskill', label: 'TrueSkill' }, { id: 'skills', label: 'Skills' }
];

export function Explore({ query }) {
  const tab = query.tab || 'teams';
  return html`<${Screen} title="Explore" sub="Teams, events and world rankings for V5RC Override">
    <${Tabs} tabs=${TABS} value=${tab} onChange=${(t) => setQuery({ tab: t })} />
    <div class="tab-panel">
      ${tab === 'teams' && html`<${TeamsTab} q0=${query.q || ''} />`}
      ${tab === 'events' && html`<${EventsTab} />`}
      ${tab === 'trueskill' && html`<${TrueSkillTab} />`}
      ${tab === 'skills' && html`<${SkillsTab} />`}
    </div>
  </${Screen}>`;
}

export function TeamRow({ t, right, rank }) {
  return html`<a class="row" href=${`#/team/${encodeURIComponent(t.number)}`}>
    ${rank != null && html`<div class=${cx('row-rank', rank <= 3 && 'top')}>${rank}</div>`}
    <div class=${cx('avatar', t.number === myTeam() && 'brand')}>${String(t.number).replace(/[A-Z]+$/i, '').slice(0, 5)}</div>
    <div class="row-main">
      <div class="row-title">${t.number}<span class="faint" style="font-weight:500">${t.name || ''}</span></div>
      <div class="row-sub">${[t.org, [t.city, t.region || t.country].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}</div>
    </div>
    ${right !== undefined ? right : html`<div class="row-end"><div class="big brand-text">${t.ts != null ? fmt(t.ts, 1) : '—'}</div><div class="small">${t.tsRank ? `#${fmt(t.tsRank)}` : 'TrueSkill'}</div></div>`}
  </a>`;
}

// ---------- Teams ----------
function TeamsTab({ q0 }) {
  const [q, setQ] = useState(q0);
  const [res, setRes] = useState({ q: '', list: [], loading: false });
  const program = useStore((s) => s.settings.program);
  const favs = useStore((s) => s.favs.teams);
  const run = useMemo(() => debounce(async (text) => {
    if (!text.trim()) { setRes({ q: '', list: [], loading: false }); return; }
    setRes((r) => ({ ...r, loading: true }));
    const list = await searchTeams(text, { limit: 60 });
    setRes({ q: text, list, loading: false });
  }, 140), [program]);
  useEffect(() => { run(q); }, [q, run]);

  const idxQ = useData(`top-local:${program}:${myTeam()}`, async () => {
    const idx = await teamIndex();
    if (!idx) return null;
    const me = idx.byNumber.get(myTeam());
    const country = me ? me.country : null;
    const local = idx.list.filter((t) => t.ts != null && (!country || t.country === country));
    return { country, top: sortBy(local, (t) => t.ts, -1).slice(0, 10), favs: favs.map((f) => idx.byNumber.get(f)).filter(Boolean) };
  }, { ttl: 600 });

  return html`<div>
    <${SearchBox} large value=${q} onInput=${(v) => { setQ(v); setQuery({ q: v || null }); }} placeholder="Team number, name, school or city" autofocus=${!q0} />
    <div class="mt-16">
      ${q.trim() ? (res.loading && !res.list.length ? html`<${Skeleton} rows=${5} />`
        : res.list.length ? html`<div class="list">${res.list.map((t) => html`<${TeamRow} t=${t} />`)}</div>`
        : html`<${Empty} icon="search" title=${`No teams match “${q}”`}
            text=${idxQ.data ? 'Try a team number like 1940D, or part of a team or school name.' : hasLive() ? 'Try the full team number (e.g. 1940D).' : 'Team search uses the season data file. Add an API key to look up any team number.'} />`)
      : html`<div>
        ${idxQ.data && idxQ.data.favs.length > 0 && html`<div class="section-head"><h2>Favourites</h2></div><div class="list mb-16">${idxQ.data.favs.map((t) => html`<${TeamRow} t=${t} />`)}</div>`}
        ${idxQ.data && idxQ.data.top.length > 0 && html`<div class="section-head"><h2>Top TrueSkill${idxQ.data.country ? ' · ' + idxQ.data.country : ''}</h2><a class="link" href="#/explore?tab=trueskill">Rankings</a></div>
          <div class="list">${idxQ.data.top.map((t, i) => html`<${TeamRow} t=${t} rank=${i + 1} />`)}</div>`}
        ${!idxQ.loading && !idxQ.data && html`<div>
          <${Empty} icon="search" title="Search any VEX team" text="Type a team number like 1940D. Name and school search turns on once the season data file is published." />
          ${!hasLive() && html`<${NoKeyCard} />`}
        </div>`}
      </div>`}
    </div>
  </div>`;
}

// ---------- Events ----------
function EventsTab() {
  const program = useStore((s) => s.settings.program);
  const [when, setWhen] = useState('upcoming');
  const [text, setText] = useState('');
  const [level, setLevel] = useState('');
  const [country, setCountry] = useState(null);
  const [near, setNear] = useState(null);
  const q = useData(`events:${program}`, () => seasonEvents(), { ttl: 1800 });
  const idxQ = useData(`mycountry:${program}:${myTeam()}`, async () => { const idx = await teamIndex(); const me = idx && idx.byNumber.get(myTeam()); return me ? me.country : null; }, { ttl: 86400 });
  const ctry = country === null ? (idxQ.data || '') : country;
  const list = (q.data && q.data.list) || [];
  const countries = useMemo(() => [...new Set(list.map((e) => e.location && e.location.country).filter(Boolean))].sort(), [list]);

  const filtered = useMemo(() => {
    const t = norm(text);
    let out = list.filter((e) => {
      const st = eventStatus(e);
      if (when === 'upcoming' && st !== 'upcoming') return false;
      if (when === 'live' && st !== 'live') return false;
      if (when === 'past' && st !== 'past') return false;
      if (level && e.level !== level) return false;
      if (ctry && (!e.location || e.location.country !== ctry)) return false;
      if (t && !norm(`${e.name} ${eventPlace(e)} ${e.sku}`).includes(t)) return false;
      return true;
    });
    if (near) {
      const dist = (e) => {
        const c = e.location && e.location.coordinates;
        if (!c || c.lat == null) return 1e9;
        const R = 6371, toR = Math.PI / 180;
        const dLat = (c.lat - near.lat) * toR, dLon = (c.lon - near.lon) * toR;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(near.lat * toR) * Math.cos(c.lat * toR) * Math.sin(dLon / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(a));
      };
      out = out.map((e) => ({ ...e, _km: dist(e) })).sort((a, b) => a._km - b._km);
    } else {
      out = sortBy(out, (e) => e.start, when === 'past' ? -1 : 1);
    }
    return out;
  }, [list, when, level, ctry, text, near]);

  const locate = () => {
    if (near) { setNear(null); return; }
    if (!navigator.geolocation) { toast('Location is not available on this device', { icon: 'alert' }); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => setNear({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => toast('Allow location access to sort events by distance', { icon: 'mapPin' }), { timeout: 10000 });
  };

  if (q.error && !q.data) return html`<${ErrorState} error=${q.error} onRetry=${q.refresh} />`;
  return html`<div>
    <div class="flex flex-wrap" style="gap:10px">
      <${Seg} options=${[{ value: 'live', label: 'Live' }, { value: 'upcoming', label: 'Upcoming' }, { value: 'past', label: 'Past' }]} value=${when} onChange=${setWhen} />
      <select class="select" style="width:auto;min-height:38px;padding-top:6px;padding-bottom:6px" value=${ctry} onChange=${(e) => setCountry(e.target.value)}>
        <option value="">All countries</option>
        ${countries.map((c) => html`<option value=${c}>${c}</option>`)}
      </select>
      <button class=${cx('btn btn-sm', near && 'btn-primary')} onClick=${locate}><${Icon} name="mapPin" /> Near me</button>
    </div>
    <div class="mt-12"><${SearchBox} value=${text} onInput=${setText} placeholder="Search events or cities" /></div>
    <div class="mt-12"><${Chips} multi=${false} scroll value=${level} onChange=${setLevel}
      options=${[{ value: 'Signature', label: 'Signature' }, { value: 'World', label: 'Worlds' }, { value: 'National', label: 'National' }, { value: 'Regional', label: 'Regional' }, { value: 'State', label: 'State' }, { value: 'Other', label: 'Local' }]} /></div>
    <div class="mt-16">
      ${q.loading && !q.data ? html`<${Skeleton} rows=${6} />` : filtered.length
        ? html`<div class="list">${filtered.slice(0, 120).map((e) => html`<${EventRow} e=${e}
            extra=${e._km != null && e._km < 1e8 ? html`<span class="badge">${fmt(e._km)} km</span>` : null} />`)}</div>
          ${filtered.length > 120 && html`<p class="center small faint mt-12">Showing 120 of ${filtered.length} — narrow it down with search.</p>`}`
        : html`<${Empty} icon="calendar" title="No events found" text="Try another filter or country." />`}
    </div>
  </div>`;
}

// ---------- TrueSkill rankings ----------
function TrueSkillTab() {
  const program = useStore((s) => s.settings.program);
  const [country, setCountry] = useState(null);
  const [grade, setGrade] = useState('');
  const [text, setText] = useState('');
  const [limit, setLimit] = useState(100);
  const q = useData(`tsindex:${program}`, async () => {
    const idx = await teamIndex();
    if (!idx) return null;
    const me = idx.byNumber.get(myTeam());
    return { list: sortBy(idx.list.filter((t) => t.ts != null), (t) => t.ts, -1), myCountry: me ? me.country : '', generated: idx.generated };
  }, { ttl: 600 });
  const data = q.data;
  const ctry = country === null ? (data ? data.myCountry : '') : country;
  const countries = useMemo(() => (data ? [...new Set(data.list.map((t) => t.country).filter(Boolean))].sort() : []), [data]);
  const rows = useMemo(() => {
    if (!data) return [];
    const t = norm(text);
    return data.list.filter((r) => (!ctry || r.country === ctry) && (!grade || r.grade === grade) && (!t || r._s.includes(t)));
  }, [data, ctry, grade, text]);

  if (q.loading && !data) return html`<${Skeleton} rows=${8} />`;
  if (!data) return html`<${Empty} icon="chart" title="TrueSkill rankings aren't published yet"
    text="They're calculated from every V5RC match this season by the scheduled data job (see the README). Once it runs, world, country and grade rankings appear here." />`;
  return html`<div>
    <div class="flex flex-wrap" style="gap:10px">
      <select class="select" style="width:auto;min-height:38px;padding-top:6px;padding-bottom:6px" value=${ctry} onChange=${(e) => setCountry(e.target.value)}>
        <option value="">World</option>${countries.map((c) => html`<option value=${c}>${c}</option>`)}
      </select>
      <${Seg} options=${[{ value: '', label: 'All' }, { value: 'High School', label: 'HS' }, { value: 'Middle School', label: 'MS' }]} value=${grade} onChange=${setGrade} />
    </div>
    <div class="mt-12"><${SearchBox} value=${text} onInput=${setText} placeholder="Filter teams" /></div>
    <div class="table-wrap mt-12"><table class="table">
      <thead><tr><th>#</th><th class="left">Team</th><th>TrueSkill</th><th>W-L-T</th><th>OPR</th><th>CCWM</th><th>World</th></tr></thead>
      <tbody>${rows.slice(0, limit).map((r, i) => html`<tr class=${cx('clickable', r.number === myTeam() && 'me')} onClick=${() => navigate('/team/' + r.number)}>
        <td class="muted">${i + 1}</td>
        <td class="left team">${r.number}<small>${r.name}</small></td>
        <td class="strong brand-text">${fmt(r.ts, 1)}</td>
        <td>${r.w}-${r.l}-${r.t}</td>
        <td>${fmt(r.opr, 1)}</td><td>${fmt(r.ccwm, 1)}</td>
        <td class="muted">${fmt(r.tsRank)}</td>
      </tr>`)}</tbody>
    </table></div>
    ${rows.length > limit && html`<div class="center mt-12"><button class="btn" onClick=${() => setLimit(limit + 200)}>Show more (${fmt(rows.length - limit)} left)</button></div>`}
    <p class="tiny faint mt-12">TrueSkill shown as μ − 3σ (a conservative skill estimate) from every V5RC match this season. OPR/DPR/CCWM are season averages of per-event values.</p>
  </div>`;
}

// ---------- World skills ----------
function SkillsTab() {
  const program = useStore((s) => s.settings.program);
  const [grade, setGrade] = useState('High School');
  const [country, setCountry] = useState(null);
  const [text, setText] = useState('');
  const [limit, setLimit] = useState(100);
  const myQ = useData(`mycountry:${program}:${myTeam()}`, async () => { const idx = await teamIndex(); const me = idx && idx.byNumber.get(myTeam()); return me ? me.country : null; }, { ttl: 86400 });
  const q = useData(`ws:${program}:${grade}`, () => skillsStandings(grade), { ttl: 900 });
  const list = q.data || [];
  const ctry = country === null ? (myQ.data || '') : country;
  const countries = useMemo(() => [...new Set(list.map((e) => e.team.country).filter(Boolean))].sort(), [list]);
  const rows = useMemo(() => {
    const t = norm(text);
    return list.filter((e) => (!ctry || e.team.country === ctry) &&
      (!t || norm(`${e.team.team} ${e.team.teamName} ${e.team.organization} ${e.team.city} ${e.team.region}`).includes(t)));
  }, [list, ctry, text]);

  return html`<div>
    <div class="flex flex-wrap" style="gap:10px">
      <${Seg} options=${[{ value: 'High School', label: 'High School' }, { value: 'Middle School', label: 'Middle School' }]} value=${grade} onChange=${(g) => { setGrade(g); setLimit(100); }} />
      <select class="select" style="width:auto;min-height:38px;padding-top:6px;padding-bottom:6px" value=${ctry} onChange=${(e) => setCountry(e.target.value)}>
        <option value="">World</option>${countries.map((c) => html`<option value=${c}>${c}</option>`)}
      </select>
    </div>
    <div class="mt-12"><${SearchBox} value=${text} onInput=${setText} placeholder="Filter teams" /></div>
    ${q.error && !q.data ? html`<div class="mt-12"><${ErrorState} error=${q.error} onRetry=${q.refresh} /></div>`
      : q.loading && !q.data ? html`<div class="mt-12"><${Skeleton} rows=${8} /></div>`
      : html`<div class="table-wrap mt-12"><table class="table">
        <thead><tr><th>#</th><th class="left">Team</th><th>Total</th><th>Auton</th><th>Driver</th><th>World</th></tr></thead>
        <tbody>${rows.slice(0, limit).map((e, i) => html`<tr class=${cx('clickable', e.team.team === myTeam() && 'me')} onClick=${() => navigate('/team/' + e.team.team)}>
          <td class="muted">${i + 1}</td>
          <td class="left team">${e.team.team}<small>${e.team.teamName}</small></td>
          <td class="strong brand-text">${e.scores.score}</td>
          <td>${e.scores.programming}</td><td>${e.scores.driver}</td>
          <td class="muted">${e.rank}</td>
        </tr>`)}</tbody>
      </table></div>
      ${rows.length > limit && html`<div class="center mt-12"><button class="btn" onClick=${() => setLimit(limit + 200)}>Show more</button></div>`}
      <p class="tiny faint mt-12">Official Robot Skills standings from events.vex.com (best combined driver + auton run).</p>`}
  </div>`;
}
