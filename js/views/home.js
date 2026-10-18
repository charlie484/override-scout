import { html, useMemo } from '../lib/html.js';
import { Icon } from '../lib/icons.js';
import { cx, fmt, pct, ordinal, relTime, fmtTime, fmtDateRange, eventStatus, eventPlace, sortBy, matchLabel, matchSortKey, toDate } from '../lib/util.js';
import { useStore, openSheet, liveDocs } from '../lib/state.js';
import { useData, findTeam, teamSeason, seasonId, skillsFor, eventData, isPlayed, sideOf, resultFor, seasonRatings, manifest, teamIndex } from '../lib/data.js';
import { hasLive } from '../lib/api.js';
import { predictMatch, eventStats, tsScore } from '../lib/stats.js';
import { Screen, Section, TeamPill, ProbBar, Skeleton, NoKeyCard, ResultBadge, Empty } from '../components/ui.js';
import { TeamHero, teamRecord, EventRow, NoteList } from './team.js';
import { MatchSheet } from './match.js';

const QUICK = [
  { href: '#/explore', icon: 'search', label: 'Search' },
  { href: '#/scout/new?kind=match', icon: 'clipboard', label: 'Scout' },
  { href: '#/tools/timer', icon: 'timer', label: 'Timer' },
  { href: '#/predict', icon: 'sparkles', label: 'Predict' },
  { href: '#/tools/score', icon: 'target', label: 'Score' },
  { href: '#/qa', icon: 'book', label: 'Q&A' }
];

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Late night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export function Home() {
  const settings = useStore((s) => s.settings);
  const favs = useStore((s) => s.favs);
  const docs = useStore((s) => s.docs);
  const num = (settings.myTeam || '').toUpperCase();
  const program = settings.program;

  const teamQ = useData(num ? `team:${program}:${num}` : null, () => findTeam(num), { ttl: 3600 });
  const team = teamQ.data;
  const seasonQ = useData(`season:${program}`, () => seasonId(), { ttl: 86400 });
  const detailQ = useData(team && seasonQ.data ? `tseason:${num}:${seasonQ.data}:${team.id || ''}` : null,
    () => teamSeason(team, seasonQ.data), { ttl: 300 });
  const skillsQ = useData(num ? `tskills:${program}:${num}` : null, () => skillsFor(num), { ttl: 1800 });
  const d = detailQ.data;
  const rec = useMemo(() => (d ? teamRecord(d.matches, num) : null), [d, num]);

  const events = d ? d.events : [];
  const liveEvent = events.find((e) => eventStatus(e) === 'live');
  const nextEvent = sortBy(events.filter((e) => eventStatus(e) === 'upcoming'), (e) => e.start)[0];
  const notes = liveDocs(docs, 'scout').slice(0, 3);

  return html`<${Screen} brand head=${false}
    actions=${html`<a class="btn-icon" href="#/explore" aria-label="Search"><${Icon} name="search" /></a>
      <a class="btn-icon" href="#/me" aria-label="Profile & settings"><${Icon} name="user" /></a>`}>
    <div class="flex between" style="margin:2px 2px 14px">
      <div>
        <div class="eyebrow">${greeting()}${settings.profile && settings.profile.name ? `, ${settings.profile.name}` : ''}</div>
        <h1 style="font-size:26px;font-weight:850;letter-spacing:-.025em;margin-top:2px">V5RC Override</h1>
      </div>
      <a class="btn btn-sm hide-mobile" href="#/scout/new?kind=match"><${Icon} name="plus" /> Scout a match</a>
    </div>

    ${num && (team ? html`<a href=${`#/team/${num}`} style="display:block"><${TeamHero} team=${team} row=${team} rec=${rec} skills=${skillsQ.data} actions=${false} /></a>`
      : teamQ.loading ? html`<div class="skel" style="height:208px;border-radius:20px"></div>`
      : html`<div class="card card-pad"><div class="strong">Team ${num}</div><div class="muted small mt-4">Season data for your team isn't available yet.</div></div>`)}

    <nav class="quick mt-16" style="display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px">
      ${QUICK.map((q) => html`<a href=${q.href} class="tool-card" style="min-height:0;padding:12px 4px;align-items:center;gap:7px;text-align:center">
        <div class="ic" style="width:36px;height:36px"><${Icon} name=${q.icon} /></div><span class="small strong" style="font-size:12px">${q.label}</span></a>`)}
    </nav>

    ${liveEvent && html`<${EventDay} event=${liveEvent} num=${num} />`}
    ${!liveEvent && nextEvent && html`<${Section} title="Next event"><${NextEvent} e=${nextEvent} /></${Section}>`}

    ${!hasLive() && html`<div class="mt-16"><${NoKeyCard} /></div>`}

    <div class="grid-2 section" style="align-items:start">
      <${FavTeams} list=${favs.teams} />
      <div>
        <div class="section-head"><h2>Recent scouting</h2><a class="link" href="#/scout">Open</a></div>
        ${notes.length ? html`<${NoteList} notes=${notes} showTeam />`
          : html`<div class="card card-pad"><div class="muted small">No notes yet. Tap <b>Scout</b> during a match to log what you see — notes sync with your workspace.</div></div>`}
      </div>
    </div>

    ${favs.events.length > 0 && html`<${FavEvents} ids=${favs.events} />`}
    <${DataFooter} />
  </${Screen}>`;
}

function NextEvent({ e }) {
  const days = Math.ceil((toDate(e.start) - new Date()) / 86400000);
  return html`<a class="card card-pad" href=${`#/event/${e.id}`} style="display:flex;gap:14px;align-items:center">
    <div class="avatar brand" style="width:56px;height:56px;border-radius:16px;flex-direction:column;display:flex;justify-content:center">
      <div style="font-size:22px;font-weight:900;line-height:1">${Math.max(0, days)}</div><div style="font-size:10px;font-weight:700">${days === 1 ? 'DAY' : 'DAYS'}</div>
    </div>
    <div class="grow"><div class="strong ellipsis">${e.name}</div><div class="small muted ellipsis">${fmtDateRange(e.start, e.end)} · ${eventPlace(e)}</div></div>
    <${Icon} name="chevronRight" class="chev" style="color:var(--text-3);width:18px" />
  </a>`;
}

// ---------- Event Day: live match tracking for my team ----------
function EventDay({ event, num }) {
  const program = useStore((s) => s.settings.program);
  const q = useData(`event:${event.id}`, () => eventData(event.id), { ttl: 30, poll: 30 });
  const rq = useData(`ratings:${program}`, () => seasonRatings(), { ttl: 3600 });
  const ev = q.data;
  const div = ev && ev.divisions.find((dv) => dv.matches.some((m) => sideOf(m, num))) || (ev && ev.divisions[0]);
  const stats = useMemo(() => (div ? eventStats(div.matches) : null), [div]);
  const mine = div ? sortBy(div.matches.filter((m) => sideOf(m, num)), matchSortKey) : [];
  const next = mine.find((m) => !isPlayed(m));
  const last = [...mine].reverse().find((m) => isPlayed(m));
  const rank = div && div.rankings.find((r) => r.team && r.team.name === num);
  const ratings = rq.data && rq.data.available ? rq.data.ratings : null;
  const pred = next ? predictMatch(next.red.teams, next.blue.teams, { ratings, oprs: stats, sigma: stats && stats.sigma }) : null;
  const mySide = next && sideOf(next, num);
  const winP = pred ? (mySide === 'red' ? pred.pRed : 1 - pred.pRed) : null;

  return html`<${Section} title=${html`<span class="flex"><span class="badge badge-live">Live</span> Event day</span>`}
    right=${html`<a class="link small brand-text" href=${`#/event/${event.id}`}>Open event</a>`}>
    <div class="card" style="border-color:var(--brand-line)">
      <div class="card-pad" style="padding-bottom:12px">
        <div class="strong ellipsis">${event.name}</div>
        <div class="small muted">${div && ev.divisions.length > 1 ? div.name + ' · ' : ''}${rank ? `Ranked ${ordinal(rank.rank)} of ${div.rankings.length} · ${rank.wins}-${rank.losses}-${rank.ties} · ${rank.wp} WP` : eventPlace(event)}</div>
      </div>
      ${!ev && q.loading && html`<div class="card-pad"><div class="skel" style="height:90px"></div></div>`}
      ${!ev && q.error && html`<div class="card-pad"><${NoKeyCard} compact /></div>`}
      ${ev && next && html`<button class="w-full" style="display:block;text-align:left;padding:14px 16px;border-top:1px solid var(--line)"
          onClick=${() => openSheet(() => html`<${MatchSheet} m=${next} stats=${stats} ratings=${ratings} />`, { title: 'Next match' })}>
        <div class="flex between">
          <div><div class="eyebrow">Next match</div><div style="font-size:24px;font-weight:900;letter-spacing:-.02em">${matchLabel(next)}</div></div>
          <div class="right"><div class="strong">${next.scheduled ? fmtTime(next.scheduled) : 'TBD'}</div><div class="small muted">${next.scheduled ? relTime(next.scheduled) : ''}${next.field ? ' · ' + next.field : ''}</div></div>
        </div>
        <div class="grid mt-12" style="grid-template-columns:auto 1fr;gap:8px 12px;align-items:center">
          <span class="small faint">With</span>
          <div class="flex flex-wrap gap-4">${next[mySide].teams.map((t) => html`<${TeamPill} n=${t} me=${t === num} />`)}</div>
          <span class="small faint">Against</span>
          <div class="flex flex-wrap gap-4">${next[mySide === 'red' ? 'blue' : 'red'].teams.map((t) => html`<${TeamPill} n=${t} />`)}</div>
        </div>
        ${winP != null && pred.method !== 'none' && html`<div class="mt-12">
          <div class="flex between small"><span class="muted">Win chance</span><span class="strong ${winP >= 0.5 ? 'win' : 'loss'}">${pct(winP)}</span></div>
          <div class="meter"><div style=${`width:${winP * 100}%;background:${winP >= 0.5 ? 'var(--win)' : 'var(--loss)'}`}></div></div>
        </div>`}
        <div class="mt-8 tiny faint">${mySide === 'red' ? 'Red alliance' : 'Blue alliance'} · tap for scouting & details</div>
      </button>`}
      ${ev && !next && mine.length > 0 && html`<div class="card-pad small muted" style="border-top:1px solid var(--line)">All scheduled matches played${rank ? '' : ''}. Check the event for alliance selection and eliminations.</div>`}
      ${ev && !mine.length && html`<div class="card-pad small muted" style="border-top:1px solid var(--line)">Match schedule not published yet.</div>`}
      ${last && html`<div class="flex" style="padding:12px 16px;border-top:1px solid var(--line)">
        <span class="small faint">Last</span><span class="strong">${matchLabel(last)}</span><${ResultBadge} r=${resultFor(last, num)} />
        <span class="grow"></span><span class="strong tnum"><span class="red-text">${last.red.score}</span> – <span class="blue-text">${last.blue.score}</span></span>
      </div>`}
    </div>
  </${Section}>`;
}

function FavTeams({ list }) {
  const program = useStore((s) => s.settings.program);
  const idxQ = useData(`favteams:${program}:${list.join(',')}`, async () => {
    const idx = await teamIndex();
    return idx ? list.map((n) => idx.byNumber.get(n) || { number: n }) : list.map((n) => ({ number: n }));
  }, { ttl: 60 });
  const rows = (idxQ.data || []).filter((r) => list.includes(r.number));
  return html`<div>
    <div class="section-head"><h2>Favourite teams</h2><a class="link" href="#/explore">Find teams</a></div>
    ${!list.length ? html`<div class="card card-pad"><div class="muted small">Star teams to keep them here — alliance partners, rivals, teams to watch.</div></div>`
      : html`<div class="list">${(rows.length ? rows : list.map((n) => ({ number: n }))).slice(0, 8).map((t) => html`<a class="row" href=${`#/team/${t.number}`}>
        <div class="avatar">${t.number.replace(/[A-Z]+$/, '')}</div>
        <div class="row-main"><div class="row-title">${t.number} <span class="faint" style="font-weight:500">${t.name || ''}</span></div>
          <div class="row-sub">${[t.org, t.region || t.country].filter(Boolean).join(' · ') || ' '}</div></div>
        <div class="row-end"><div class="big brand-text">${t.ts != null ? fmt(t.ts, 1) : '—'}</div><div class="small">TrueSkill</div></div>
      </a>`)}</div>`}
  </div>`;
}

function FavEvents({ ids }) {
  const q = useData(`favevents:${ids.join(',')}`, async () => {
    const out = [];
    for (const id of ids.slice(0, 6)) {
      try { const e = await eventData(id); out.push(e.event); } catch (e) { out.push({ id, name: `Event ${id}` }); }
    }
    return out;
  }, { ttl: 1800 });
  return html`<${Section} title="Favourite events">
    ${q.data ? html`<div class="list">${q.data.map((e) => html`<${EventRow} e=${e} />`)}</div>` : html`<${Skeleton} rows=${2} />`}
  </${Section}>`;
}

function DataFooter() {
  const q = useData('manifest', () => manifest(), { ttl: 600 });
  const m = q.data;
  return html`<p class="center tiny faint mt-24">
    ${m && m.generated ? `Season stats updated ${relTime(m.generated)} · ` : ''}Data from events.vex.com · Not affiliated with VEX Robotics
  </p>`;
}
