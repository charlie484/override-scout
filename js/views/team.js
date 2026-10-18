import { html, useState, useMemo, useEffect } from '../lib/html.js';
import { Icon } from '../lib/icons.js';
import { cx, fmt, pct, fmtDate, fmtDateRange, eventStatus, eventPlace, sortBy, groupBy, ordinal, matchSortKey, toDate } from '../lib/util.js';
import { useStore, myTeam, openSheet, closeSheet, saveDoc, liveDocs, toast, getState } from '../lib/state.js';
import { setQuery, navigate } from '../lib/router.js';
import { useData, findTeam, teamSeason, seasonId, skillsFor, isPlayed, resultFor, sideOf, seasonRatings } from '../lib/data.js';
import { hasLive } from '../lib/api.js';
import { tsScore } from '../lib/stats.js';
import {
  Screen, Section, Tabs, Tile, MatchRow, Empty, Skeleton, ErrorState, FavButton, LevelBadge, ResultBadge, Stars, Field, Updated, KV, NoKeyCard
} from '../components/ui.js';
import { MarginBars, Sparkline } from '../components/charts.js';
import { MatchSheet } from './match.js';

// ---------- Season summary from a team's matches ----------
export function teamRecord(matches, number) {
  let w = 0, l = 0, t = 0, pts = 0, high = 0, margin = 0, n = 0;
  const margins = [];
  const sorted = [...matches].filter((m) => m.round !== 1 && isPlayed(m))
    .sort((a, b) => String(a.started || a.scheduled || '').localeCompare(String(b.started || b.scheduled || '')) || matchSortKey(a) - matchSortKey(b));
  for (const m of sorted) {
    const s = sideOf(m, number);
    if (!s || m[s].sitting.includes(number)) continue;
    const own = m[s].score, opp = m[s === 'red' ? 'blue' : 'red'].score;
    n++; pts += own; high = Math.max(high, own); margin += own - opp; margins.push(own - opp);
    if (own > opp) w++; else if (own < opp) l++; else t++;
  }
  return { w, l, t, played: n, avg: n ? pts / n : null, high: n ? high : null, avgMargin: n ? margin / n : null, margins, winRate: n ? (w + t * 0.5) / n : null };
}

export function TeamHero({ team, row, rec, skills, compact, actions = true }) {
  const me = myTeam() === team.number;
  const ts = row && row.ts != null ? row.ts : null;
  const sk = skills && skills.entry;
  const place = [team.city, team.region, team.country].filter(Boolean).join(', ');
  return html`<div class="hero">
    <div class="hero-top">
      <div class="grow">
        <div class="hero-num">${team.number}</div>
        <div class="hero-name">${team.name || '—'}${team.robot ? html`<span class="faint" style="font-weight:500"> · ${team.robot}</span>` : ''}</div>
        <div class="hero-meta">${[team.org, place].filter(Boolean).join(' · ')}</div>
      </div>
      ${actions && html`<div class="hero-actions">
        <${FavButton} kind="teams" id=${team.number} />
        <button class="btn-icon" aria-label="Compare" onClick=${() => navigate(`/compare?teams=${encodeURIComponent(team.number + (me ? '' : ',' + myTeam()))}`)}><${Icon} name="compare" /></button>
      </div>`}
    </div>
    <div class="hero-chips">
      ${me && html`<span class="chip brand"><${Icon} name="zap" /> My team</span>`}
      ${team.grade && html`<span class="chip">${team.grade}</span>`}
      ${team.program && html`<span class="chip">${team.program}</span>`}
      ${team.registered === false && html`<span class="chip">Not registered</span>`}
    </div>
    ${!compact && html`<div class="hero-stats">
      <div class="hero-stat hl"><div class="l">TrueSkill</div><div class="v">${ts != null ? fmt(ts, 1) : '—'}</div><div class="s">${row && row.tsRank ? `#${fmt(row.tsRank)} world` : 'Not rated yet'}</div></div>
      <div class="hero-stat"><div class="l">Record</div><div class="v">${rec && rec.played ? `${rec.w}-${rec.l}-${rec.t}` : row && row.w != null ? `${row.w}-${row.l}-${row.t}` : '—'}</div><div class="s">${rec && rec.played ? pct(rec.winRate) + ' win' : ''}</div></div>
      <div class="hero-stat"><div class="l">Skills</div><div class="v">${sk ? sk.scores.score : '—'}</div><div class="s">${sk ? `#${sk.rank} ${skills.grade === 'Middle School' ? 'MS' : skills.grade === 'High School' ? 'HS' : ''}` : skills ? 'No runs yet' : 'Loading…'}</div></div>
      <div class="hero-stat"><div class="l">OPR</div><div class="v">${row && row.opr != null ? fmt(row.opr, 1) : '—'}</div><div class="s">${row && row.dpr != null ? `DPR ${fmt(row.dpr, 1)}` : ''}</div></div>
      <div class="hero-stat"><div class="l">CCWM</div><div class="v">${row && row.ccwm != null ? fmt(row.ccwm, 1) : '—'}</div><div class="s">${rec && rec.avgMargin != null ? `margin ${rec.avgMargin > 0 ? '+' : ''}${fmt(rec.avgMargin, 1)}` : ''}</div></div>
      <div class="hero-stat"><div class="l">Avg score</div><div class="v">${rec && rec.avg != null ? fmt(rec.avg, 1) : '—'}</div><div class="s">${rec && rec.high != null ? `high ${rec.high}` : ''}</div></div>
    </div>`}
  </div>`;
}

const TABS = [
  { id: 'overview', label: 'Overview' }, { id: 'events', label: 'Events' }, { id: 'matches', label: 'Matches' },
  { id: 'skills', label: 'Skills' }, { id: 'awards', label: 'Awards' }, { id: 'notes', label: 'Scouting' }
];

export function Team({ params, query }) {
  const number = decodeURIComponent(params.num).toUpperCase();
  const tab = query.tab || 'overview';
  const program = useStore((s) => s.settings.program);
  const favs = useStore((s) => s.favs.teams);
  const docs = useStore((s) => s.docs);

  const teamQ = useData(`team:${program}:${number}`, () => findTeam(number), { ttl: 3600 });
  const team = teamQ.data;
  const seasonQ = useData(`season:${program}`, () => seasonId(), { ttl: 86400 });
  const season = query.season ? Number(query.season) : seasonQ.data;
  const detailQ = useData(team && season ? `tseason:${number}:${season}:${team.id || ''}` : null,
    () => teamSeason(team, season), { ttl: 600 });
  const skillsQ = useData(`tskills:${program}:${number}`, () => skillsFor(number), { ttl: 1800 });
  const d = detailQ.data;
  const rec = useMemo(() => (d ? teamRecord(d.matches, number) : null), [d, number]);

  if (teamQ.loading && !team) {
    return html`<${Screen} title=${number} backTo="/explore"><div class="skel" style="height:220px;border-radius:20px"></div><div class="mt-16"><${Skeleton} rows=${4} /></div></${Screen}>`;
  }
  if (!team) {
    return html`<${Screen} title=${number} backTo="/explore">
      ${teamQ.error ? html`<${ErrorState} error=${teamQ.error} onRetry=${teamQ.refresh} />`
        : html`<${Empty} icon="search" title=${`Team ${number} not found`} text=${hasLive() ? 'Check the number and program (V5RC, VIQRC, VEX U) in Settings.' : 'This team isn\'t in the saved season data yet.'} />`}
      ${!hasLive() && html`<div class="mt-16"><${NoKeyCard} /></div>`}
    </${Screen}>`;
  }

  const notes = liveDocs(docs, 'scout').filter((n) => n.team === number);
  return html`<${Screen} title=${number} backTo="/explore" head=${false}
    actions=${html`<${FavButton} kind="teams" id=${number} />`}>
    <${TeamHero} team=${team} row=${team} rec=${rec} skills=${skillsQ.data} />
    <div class="mt-12"></div>
    <${Tabs} tabs=${TABS.map((t) => (t.id === 'notes' && notes.length ? { ...t, count: notes.length } : t))} value=${tab} onChange=${(t) => setQuery({ tab: t })} />
    <div class="tab-panel">
      ${detailQ.error && !d ? html`<${ErrorState} error=${detailQ.error} onRetry=${detailQ.refresh} />` : null}
      ${tab === 'overview' && html`<${Overview} team=${team} d=${d} rec=${rec} skills=${skillsQ.data} notes=${notes} loading=${detailQ.loading} favs=${favs} />`}
      ${tab === 'events' && html`<${EventsTab} d=${d} number=${number} loading=${detailQ.loading} />`}
      ${tab === 'matches' && html`<${MatchesTab} d=${d} number=${number} loading=${detailQ.loading} favs=${favs} />`}
      ${tab === 'skills' && html`<${SkillsTab} d=${d} skills=${skillsQ.data} number=${number} loading=${detailQ.loading} />`}
      ${tab === 'awards' && html`<${AwardsTab} d=${d} loading=${detailQ.loading} />`}
      ${tab === 'notes' && html`<${NotesTab} team=${team} notes=${notes} />`}
    </div>
    <div class="mt-16"><${Updated} at=${detailQ.updatedAt} refreshing=${detailQ.refreshing} onRefresh=${() => { teamQ.refresh(); detailQ.refresh(); skillsQ.refresh(); }} /></div>
  </${Screen}>`;
}

// ---------- Overview ----------
function Overview({ team, d, rec, skills, notes, loading, favs }) {
  const docs = useStore((s) => s.docs);
  const social = liveDocs(docs, 'social').find((s) => s.team === team.number);
  const now = new Date();
  const upcoming = d ? sortBy(d.events.filter((e) => eventStatus(e) !== 'past'), (e) => e.start) : [];
  const recent = d ? sortBy(d.matches.filter((m) => isPlayed(m) && m.round !== 1), (m) => m.started || m.scheduled || '', -1).slice(0, 5) : [];
  const ratingAvg = (k) => {
    const v = notes.map((n) => n.fields && n.fields[k]).filter((x) => x > 0);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const tagCounts = {};
  notes.forEach((n) => (n.tags || []).forEach((t) => { tagCounts[t] = (tagCounts[t] || 0) + 1; }));
  const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const sk = skills && skills.entry;

  return html`<div class="split">
    <div>
      ${rec && rec.margins.length > 1 && html`<div class="card card-pad">
        <div class="flex between"><div class="eyebrow">Form · match margins</div>
          <div class="flex gap-4">${recent.slice(0, 5).reverse().map((m) => html`<${ResultBadge} r=${resultFor(m, team.number)} />`)}</div></div>
        <div class="mt-12"><${MarginBars} margins=${rec.margins} /></div>
      </div>`}

      ${d && d.history && d.history.length > 1 && html`<div class="card card-pad mt-12">
        <div class="eyebrow">TrueSkill this season</div>
        <div class="mt-8"><${Sparkline} values=${d.history.map((h) => h[1])} /></div>
      </div>`}

      <${Section} title="Upcoming events">
        ${loading && !d ? html`<${Skeleton} rows=${1} />` : upcoming.length ? html`<div class="list">${upcoming.slice(0, 4).map((e) => html`<${EventRow} e=${e} />`)}</div>`
          : html`<div class="card card-pad muted small">No upcoming events registered this season.</div>`}
      </${Section}>

      <${Section} title="Recent matches" right=${recent.length ? html`<a class="link small brand-text" href=${`#/team/${team.number}?tab=matches`}>All matches</a>` : null}>
        ${loading && !d ? html`<${Skeleton} rows=${3} />` : recent.length
          ? html`<div class="list">${recent.map((m) => html`<${MatchRow} m=${m} me=${myTeam()} favs=${favs} showDate onClick=${() => openSheet(() => html`<${MatchSheet} m=${m} />`, { title: (m.event && m.event.name) || 'Match' })} />`)}</div>`
          : html`<div class="card card-pad muted small">No matches played yet this season.</div>`}
      </${Section}>
    </div>

    <div>
      <${Section} title="Skills">
        <div class="tiles" style="grid-template-columns:repeat(3,minmax(0,1fr))">
          <${Tile} label="Total" value=${sk ? sk.scores.score : '—'} sub=${sk ? `#${sk.rank} of ${fmt(skills.total)}` : 'no runs'} accent=${!!sk} />
          <${Tile} label="Auton" value=${sk ? sk.scores.programming : '—'} sub=${sk && sk.scores.progStopTime ? `stop ${sk.scores.progStopTime}s` : ''} />
          <${Tile} label="Driver" value=${sk ? sk.scores.driver : '—'} sub=${sk && sk.scores.driverStopTime ? `stop ${sk.scores.driverStopTime}s` : ''} />
        </div>
      </${Section}>

      <${Section} title="Scouting summary" right=${html`<a class="link small brand-text" href=${`#/scout/new?team=${team.number}`}>Add note</a>`}>
        ${notes.length ? html`<div class="card card-pad">
          <${KV} items=${[
            ['Notes', notes.length],
            ratingAvg('driving') && ['Driving', html`<${Stars} small value=${ratingAvg('driving')} />`],
            ratingAvg('speed') && ['Speed', html`<${Stars} small value=${ratingAvg('speed')} />`],
            ratingAvg('impression') && ['Impression', html`<${Stars} small value=${ratingAvg('impression')} />`],
            notes.some((n) => n.rating) && ['Overall', html`<${Stars} small value=${notes.filter((n) => n.rating).reduce((a, n) => a + n.rating, 0) / notes.filter((n) => n.rating).length} />`]
          ]} />
          ${topTags.length > 0 && html`<div class="chips mt-12">${topTags.map(([t, c]) => html`<span class="chip">${t}<span class="faint">${c}</span></span>`)}</div>`}
        </div>` : html`<div class="card card-pad muted small">No scouting notes yet. Scout this team during a match or in the pits.</div>`}
      </${Section}>

      <${Section} title="Links" right=${html`<button class="link small brand-text" onClick=${() => editSocial(team.number, social)}>Edit</button>`}>
        <${SocialLinks} social=${social} number=${team.number} />
      </${Section}>

      <div class="btn-row mt-16">
        <a class="btn btn-sm" href=${`https://events.vex.com/teams/${team.program || 'V5RC'}/${team.number}`} target="_blank" rel="noopener"><${Icon} name="external" /> events.vex.com</a>
        <a class="btn btn-sm" href=${`https://www.youtube.com/results?search_query=${encodeURIComponent('VEX ' + team.number)}`} target="_blank" rel="noopener"><${Icon} name="youtube" /> Videos</a>
        <a class="btn btn-sm" href=${`#/predict?red=${team.number}`}><${Icon} name="sparkles" /> Predict</a>
      </div>
    </div>
  </div>`;
}

export function EventRow({ e, extra }) {
  const st = eventStatus(e);
  return html`<a class="row" href=${`#/event/${e.id}`}>
    <div class="avatar" style=${st === 'live' ? 'background:var(--loss-soft);color:var(--loss)' : ''}>
      <div style="text-align:center;line-height:1.05">
        <div style="font-size:10px;font-weight:700;text-transform:uppercase;opacity:.75">${toDate(e.start) ? toDate(e.start).toLocaleDateString(undefined, { month: 'short' }) : ''}</div>
        <div style="font-size:16px">${toDate(e.start) ? toDate(e.start).getDate() : '?'}</div>
      </div>
    </div>
    <div class="row-main">
      <div class="row-title">${e.name}</div>
      <div class="row-sub">${[fmtDateRange(e.start, e.end), eventPlace(e)].filter(Boolean).join(' · ')}</div>
    </div>
    <div class="row-end flex gap-4">${st === 'live' && html`<span class="badge badge-live">Live</span>`}<${LevelBadge} level=${e.level} />${extra}</div>
    <${Icon} name="chevronRight" class="chev" />
  </a>`;
}

function SocialLinks({ social, number }) {
  const l = (social && social.links) || {};
  const items = [
    ['instagram', 'Instagram', l.instagram && (l.instagram.startsWith('http') ? l.instagram : `https://instagram.com/${l.instagram.replace(/^@/, '')}`)],
    ['youtube', 'YouTube', l.youtube && (l.youtube.startsWith('http') ? l.youtube : `https://youtube.com/@${l.youtube.replace(/^@/, '')}`)],
    ['tiktok', 'TikTok', l.tiktok && (l.tiktok.startsWith('http') ? l.tiktok : `https://tiktok.com/@${l.tiktok.replace(/^@/, '')}`)],
    ['globe', 'Website', l.website && (l.website.startsWith('http') ? l.website : `https://${l.website}`)]
  ].filter((x) => x[2]);
  if (!items.length) return html`<div class="card card-pad muted small">No links yet. Add this team's Instagram, YouTube or website so your whole team can find them.</div>`;
  return html`<div class="list">${items.map(([icon, label, url]) => html`<a class="row" href=${url} target="_blank" rel="noopener">
    <div class="avatar"><${Icon} name=${icon} /></div><div class="row-main"><div class="row-title">${label}</div><div class="row-sub">${url.replace(/^https?:\/\//, '')}</div></div>
    <${Icon} name="external" class="chev" /></a>`)}</div>`;
}

function editSocial(number, existing) {
  function Form() {
    const [links, setLinks] = useState({ ...((existing && existing.links) || {}) });
    const set = (k) => (e) => setLinks({ ...links, [k]: e.target.value.trim() });
    return html`<form onSubmit=${async (e) => {
      e.preventDefault();
      await saveDoc({ ...(existing || {}), type: 'social', team: number, links });
      closeSheet(); toast('Links saved');
    }}>
      <p class="muted small mb-12">Shared with your workspace so everyone sees the same profile links.</p>
      <${Field} label="Instagram"><input class="input" placeholder="@handle" value=${links.instagram || ''} onInput=${set('instagram')} /></${Field}>
      <${Field} label="YouTube"><input class="input" placeholder="@channel or URL" value=${links.youtube || ''} onInput=${set('youtube')} /></${Field}>
      <${Field} label="TikTok"><input class="input" placeholder="@handle" value=${links.tiktok || ''} onInput=${set('tiktok')} /></${Field}>
      <${Field} label="Website"><input class="input" placeholder="example.com" value=${links.website || ''} onInput=${set('website')} /></${Field}>
      <button class="btn btn-primary btn-block mt-16" type="submit">Save links</button>
    </form>`;
  }
  openSheet(Form, { title: `${number} links` });
}

// ---------- Events tab ----------
function EventsTab({ d, number, loading }) {
  if (loading && !d) return html`<${Skeleton} rows=${4} />`;
  if (!d || !d.events.length) return html`<${Empty} icon="calendar" title="No events this season" />`;
  const rankBy = new Map((d.rankings || []).map((r) => [r.event && r.event.id, r]));
  const awardsBy = groupBy(d.awards || [], (a) => a.event && a.event.id);
  const events = sortBy(d.events, (e) => e.start, -1);
  return html`<div class="list">${events.map((e) => {
    const r = rankBy.get(e.id);
    const aw = awardsBy.get(e.id) || [];
    const evMatches = d.matches.filter((m) => m.event && m.event.id === e.id);
    const rec = teamRecord(evMatches, number);
    return html`<a class="row" href=${`#/event/${e.id}`}>
      <div class="avatar ${r && r.rank <= 3 ? 'brand' : ''}">${r ? ordinal(r.rank) : '—'}</div>
      <div class="row-main">
        <div class="row-title">${e.name}</div>
        <div class="row-sub">${fmtDateRange(e.start, e.end)} · ${eventPlace(e)}</div>
        ${aw.length > 0 && html`<div class="flex flex-wrap gap-4 mt-4">${aw.map((a) => html`<span class="badge badge-soft"><${Icon} name="award" size="12" />${a.title.replace(/\s*\(.*\)$/, '')}</span>`)}</div>`}
      </div>
      <div class="row-end"><div class="big">${rec.played ? `${rec.w}-${rec.l}-${rec.t}` : r ? `${r.wins}-${r.losses}-${r.ties}` : '—'}</div>
        <div class="small">${r && r.wp != null ? `${r.wp} WP · ${r.ap} AP` : eventStatus(e) === 'upcoming' ? 'upcoming' : ''}</div></div>
    </a>`;
  })}</div>`;
}

// ---------- Matches tab ----------
function MatchesTab({ d, number, loading, favs }) {
  if (loading && !d) return html`<${Skeleton} rows=${6} />`;
  if (!d || !d.matches.length) return html`<${Empty} icon="swords" title="No matches yet" text="Matches appear here once this team plays." />`;
  const byEvent = groupBy(d.matches.filter((m) => m.round !== 1), (m) => m.event && m.event.id);
  const events = sortBy(d.events.filter((e) => byEvent.has(e.id)), (e) => e.start, -1);
  const extra = [...byEvent.keys()].filter((id) => !events.find((e) => e.id === id));
  return html`<div>${[...events, ...extra.map((id) => ({ id, name: (byEvent.get(id)[0].event || {}).name || 'Event' }))].map((e) => {
    const ms = sortBy(byEvent.get(e.id), matchSortKey);
    const rec = teamRecord(ms, number);
    return html`<div class="section" style="margin-top:18px">
      <div class="section-head"><h2 class="ellipsis"><a href=${`#/event/${e.id}`}>${e.name}</a></h2><span class="small muted nowrap">${rec.w}-${rec.l}-${rec.t}</span></div>
      <div class="list">${ms.map((m) => html`<${MatchRow} m=${m} me=${number} favs=${favs}
        onClick=${() => openSheet(() => html`<${MatchSheet} m=${m} />`, { title: e.name })} />`)}</div>
    </div>`;
  })}</div>`;
}

// ---------- Skills tab ----------
function SkillsTab({ d, skills, number, loading }) {
  const sk = skills && skills.entry;
  const runs = (d && d.skills) || [];
  const byEvent = groupBy(runs, (r) => r.event && r.event.id);
  const evName = (id) => { const e = d && d.events.find((x) => x.id === id); return e ? e.name : (runs.find((r) => r.event && r.event.id === id) || {}).event?.name || 'Event'; };
  return html`<div>
    <div class="tiles tiles-4">
      <${Tile} label="World rank" value=${sk ? `#${sk.rank}` : '—'} sub=${sk ? `${skills.grade}` : ''} accent=${!!sk} />
      <${Tile} label="Best total" value=${sk ? sk.scores.score : '—'} sub=${sk && sk.event ? fmtDate(sk.event.startDate) : ''} />
      <${Tile} label="Best auton" value=${sk ? sk.scores.maxProgramming : '—'} />
      <${Tile} label="Best driver" value=${sk ? sk.scores.maxDriver : '—'} />
    </div>
    <${Section} title="Runs by event">
      ${loading && !d ? html`<${Skeleton} rows=${3} />` : byEvent.size ? html`<div class="table-wrap"><table class="table">
        <thead><tr><th>Event</th><th>Driver</th><th>Auton</th><th>Total</th><th>Rank</th></tr></thead>
        <tbody>${[...byEvent.entries()].map(([id, rs]) => {
          const dr = rs.find((r) => r.type === 'driver'), pr = rs.find((r) => r.type === 'programming');
          const tot = (dr ? dr.score : 0) + (pr ? pr.score : 0);
          return html`<tr class="clickable" onClick=${() => navigate('/event/' + id + '?tab=skills')}>
            <td class="left ellipsis" style="max-width:220px">${evName(id)}</td>
            <td>${dr ? dr.score : '—'}<span class="faint tiny">${dr && dr.attempts ? ` ×${dr.attempts}` : ''}</span></td>
            <td>${pr ? pr.score : '—'}<span class="faint tiny">${pr && pr.attempts ? ` ×${pr.attempts}` : ''}</span></td>
            <td class="strong">${tot}</td><td>${(dr || pr || {}).rank || '—'}</td></tr>`;
        })}</tbody></table></div>`
        : html`<div class="card card-pad muted small">${hasLive() || d ? 'No skills runs recorded at events this season.' : 'Add an API key to see skills runs per event.'}</div>`}
    </${Section}>
  </div>`;
}

// ---------- Awards tab ----------
function AwardsTab({ d, loading }) {
  if (loading && !d) return html`<${Skeleton} rows=${3} />`;
  const awards = (d && d.awards) || [];
  if (!awards.length) return html`<${Empty} icon="trophy" title="No awards yet this season" />`;
  return html`<div class="list">${awards.map((a) => html`<a class="row" href=${a.event ? `#/event/${a.event.id}?tab=awards` : '#/'}>
    <div class="avatar brand"><${Icon} name="trophy" /></div>
    <div class="row-main"><div class="row-title">${a.title}</div><div class="row-sub">${a.event ? a.event.name : ''}</div>
      ${a.qualifications && a.qualifications.length > 0 && html`<div class="tiny faint">Qualifies for ${a.qualifications.join(', ')}</div>`}</div>
    <${Icon} name="chevronRight" class="chev" /></a>`)}</div>`;
}

// ---------- Scouting notes ----------
function NotesTab({ team, notes }) {
  return html`<div>
    <div class="btn-row mb-16">
      <a class="btn btn-primary" href=${`#/scout/new?team=${team.number}&kind=match`}><${Icon} name="plus" /> Match note</a>
      <a class="btn" href=${`#/scout/new?team=${team.number}&kind=pit`}><${Icon} name="robot" /> Pit scout</a>
      <a class="btn" href=${`#/scout/new?team=${team.number}&kind=note`}><${Icon} name="note" /> Quick note</a>
    </div>
    ${notes.length ? html`<${NoteList} notes=${notes} /> ` : html`<${Empty} icon="clipboard" title="No scouting yet" text="Notes you and your workspace add for this team show up here." />`}
  </div>`;
}

export function NoteList({ notes, showTeam }) {
  return html`<div class="list">${notes.map((n) => html`<a class="row" href=${`#/scout/edit/${n.id}`}>
    <div class="avatar ${n.kind === 'pit' ? 'brand' : ''}"><${Icon} name=${n.kind === 'pit' ? 'robot' : n.kind === 'match' ? 'swords' : 'note'} /></div>
    <div class="row-main">
      <div class="row-title">${showTeam ? html`<span>${n.team}</span>` : ''}${n.kind === 'pit' ? 'Pit scouting' : n.kind === 'match' ? (n.matchLabel ? `Match ${n.matchLabel}` : 'Match note') : 'Note'}
        ${n.rating ? html`<${Stars} small value=${n.rating} />` : ''}</div>
      <div class="row-sub">${n.text || (n.tags || []).join(', ') || (n.eventName || '')}</div>
      <div class="tiny faint">${(n.author && n.author.name) || 'Me'} · ${fmtDate(n.updatedAt)}</div>
    </div>
    <${Icon} name="chevronRight" class="chev" />
  </a>`)}</div>`;
}
