import { html, useMemo } from '../lib/html.js';
import { Icon } from '../lib/icons.js';
import { fmt, ordinal, fmtDate, fmtDateRange, eventPlace, sortBy, groupBy, matchSortKey, matchLabel, toCSV } from '../lib/util.js';
import { useStore, myTeam, liveDocs } from '../lib/state.js';
import { useData, eventData, seasonRatings, isPlayed, sideOf, resultFor } from '../lib/data.js';
import { eventStats, tsScore } from '../lib/stats.js';
import { shareFile } from '../lib/share.js';
import { Screen, Skeleton, ErrorState, Tile, ResultBadge, Stars } from '../components/ui.js';

export function Report({ params }) {
  const id = Number(params.id);
  const program = useStore((s) => s.settings.program);
  const docs = useStore((s) => s.docs);
  const q = useData(`event:${id}`, () => eventData(id), { ttl: 120 });
  const rq = useData(`ratings:${program}`, () => seasonRatings(), { ttl: 3600 });
  const me = myTeam();
  const d = q.data;
  const div = d && (d.divisions.find((x) => x.matches.some((m) => sideOf(m, me))) || d.divisions[0]);
  const stats = useMemo(() => (div ? eventStats(div.matches) : new Map()), [div]);

  if (q.loading && !d) return html`<${Screen} title="Event report" backTo=${`/event/${id}`}><${Skeleton} rows=${6} /></${Screen}>`;
  if (!d) return html`<${Screen} title="Event report" backTo=${`/event/${id}`}><${ErrorState} error=${q.error} onRetry=${q.refresh} /></${Screen}>`;

  const e = d.event;
  const ratings = rq.data && rq.data.available ? rq.data.ratings : null;
  const myRank = div && div.rankings.find((r) => r.team && r.team.name === me);
  const myMatches = div ? sortBy(div.matches.filter((m) => sideOf(m, me)), matchSortKey) : [];
  const teamsHere = new Set(d.teams.map((t) => t.number));
  const notes = liveDocs(docs, 'scout').filter((n) => teamsHere.has(n.team) || n.event === id);
  const noteGroups = [...groupBy(notes, (n) => n.team).entries()];
  const topStats = sortBy([...stats.values()], (s) => s.ccwm, -1).slice(0, 12);
  const rankings = div ? sortBy(div.rankings, (r) => r.rank).slice(0, 16) : [];
  const skills = (() => {
    const by = groupBy(d.skills || [], (s) => s.team && s.team.name);
    return sortBy([...by.entries()].map(([t, rs]) => {
      const dr = rs.find((r) => r.type === 'driver'), pr = rs.find((r) => r.type === 'programming');
      return { team: t, d: dr ? dr.score : 0, p: pr ? pr.score : 0, rank: (dr || pr || {}).rank };
    }), (r) => r.rank || 999).slice(0, 10);
  })();

  const exportCsv = () => {
    const rows = [['Team', 'Rank', 'W-L-T', 'OPR', 'DPR', 'CCWM', 'TrueSkill', 'Notes', 'Avg rating']];
    for (const s of sortBy([...stats.values()], (x) => x.opr, -1)) {
      const r = div.rankings.find((x) => x.team && x.team.name === s.team);
      const ns = notes.filter((n) => n.team === s.team);
      const rated = ns.filter((n) => n.rating);
      rows.push([s.team, r ? r.rank : '', `${s.wins}-${s.losses}-${s.ties}`, s.opr.toFixed(2), s.dpr.toFixed(2), s.ccwm.toFixed(2),
        ratings && ratings.get(s.team) ? tsScore(ratings.get(s.team)).toFixed(2) : '', ns.length, rated.length ? (rated.reduce((a, n) => a + n.rating, 0) / rated.length).toFixed(1) : '']);
    }
    shareFile(`${e.sku}-report.csv`, new Blob([toCSV(rows)], { type: 'text/csv' }), `${e.name} report`);
  };

  return html`<${Screen} title="Event report" backTo=${`/event/${id}`} head=${false}
    actions=${html`<button class="btn-icon" aria-label="Print or save PDF" onClick=${() => window.print()}><${Icon} name="printer" /></button>`}>
    <div class="flex between flex-wrap gap-12 no-print mb-16">
      <div class="btn-row">
        <button class="btn btn-primary" onClick=${() => window.print()}><${Icon} name="printer" /> Print / PDF</button>
        <button class="btn" onClick=${exportCsv}><${Icon} name="download" /> CSV</button>
      </div>
    </div>

    <div class="hero">
      <div class="hero-top"><div class="grow">
        <div class="eyebrow" style="color:#8E8E96">Event report · ${fmtDate(new Date())}</div>
        <div style="font-size:24px;font-weight:900;letter-spacing:-.02em;margin-top:4px">${e.name}</div>
        <div class="hero-meta">${fmtDateRange(e.start, e.end)} · ${eventPlace(e)}${div && d.divisions.length > 1 ? ' · ' + div.name : ''}</div>
      </div><img src="assets/mark-dark.png" alt="" style="width:46px;height:auto;opacity:.9" /></div>
      <div class="hero-stats">
        <div class="hero-stat"><div class="l">Teams</div><div class="v">${d.teams.length}</div></div>
        <div class="hero-stat"><div class="l">Matches</div><div class="v">${div ? div.matches.filter(isPlayed).length : 0}</div></div>
        <div class="hero-stat hl"><div class="l">${me} rank</div><div class="v">${myRank ? ordinal(myRank.rank) : '—'}</div></div>
        <div class="hero-stat"><div class="l">Record</div><div class="v">${myRank ? `${myRank.wins}-${myRank.losses}-${myRank.ties}` : '—'}</div></div>
        <div class="hero-stat"><div class="l">OPR</div><div class="v">${stats.get(me) ? fmt(stats.get(me).opr, 1) : '—'}</div></div>
        <div class="hero-stat"><div class="l">CCWM</div><div class="v">${stats.get(me) ? fmt(stats.get(me).ccwm, 1) : '—'}</div></div>
      </div>
    </div>

    ${myMatches.length > 0 && html`<h2 class="section-head mt-24"><span style="font-size:16px;font-weight:750">${me} matches</span></h2>
      <div class="table-wrap"><table class="table"><thead><tr><th class="left">Match</th><th class="left">Partner</th><th class="left">Opponents</th><th>Score</th><th>Result</th></tr></thead>
        <tbody>${myMatches.map((m) => { const s = sideOf(m, me), o = s === 'red' ? 'blue' : 'red'; return html`<tr>
          <td class="left strong">${matchLabel(m)}</td><td class="left">${m[s].teams.filter((t) => t !== me).join(', ')}</td><td class="left">${m[o].teams.join(', ')}</td>
          <td>${isPlayed(m) ? `${m[s].score}–${m[o].score}` : '—'}</td><td>${isPlayed(m) ? html`<${ResultBadge} r=${resultFor(m, me)} />` : 'upcoming'}</td></tr>`; })}</tbody></table></div>`}

    <div class="grid-2 mt-24" style="align-items:start">
      <div>
        <div class="section-head"><h2>Top teams by CCWM</h2></div>
        <div class="table-wrap"><table class="table"><thead><tr><th class="left">Team</th><th>OPR</th><th>DPR</th><th>CCWM</th><th>TS</th></tr></thead>
          <tbody>${topStats.map((s) => html`<tr class=${s.team === me ? 'me' : ''}><td class="left team">${s.team}</td><td>${fmt(s.opr, 1)}</td><td>${fmt(s.dpr, 1)}</td><td class="strong">${fmt(s.ccwm, 1)}</td>
            <td>${ratings && ratings.get(s.team) ? fmt(tsScore(ratings.get(s.team)), 1) : '—'}</td></tr>`)}</tbody></table></div>
      </div>
      <div>
        <div class="section-head"><h2>Rankings</h2></div>
        ${rankings.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>#</th><th class="left">Team</th><th>W-L-T</th><th>WP</th><th>AP</th><th>SP</th></tr></thead>
          <tbody>${rankings.map((r) => html`<tr class=${r.team.name === me ? 'me' : ''}><td class="strong">${r.rank}</td><td class="left team">${r.team.name}</td><td>${r.wins}-${r.losses}-${r.ties}</td><td>${r.wp}</td><td>${r.ap}</td><td>${r.sp}</td></tr>`)}</tbody></table></div>`
          : html`<div class="card card-pad small muted">No rankings yet.</div>`}
      </div>
    </div>

    <div class="grid-2 mt-24" style="align-items:start">
      <div>
        <div class="section-head"><h2>Skills</h2></div>
        ${skills.length ? html`<div class="table-wrap"><table class="table"><thead><tr><th>#</th><th class="left">Team</th><th>Total</th><th>Auton</th><th>Driver</th></tr></thead>
          <tbody>${skills.map((s) => html`<tr class=${s.team === me ? 'me' : ''}><td>${s.rank || '—'}</td><td class="left team">${s.team}</td><td class="strong">${s.d + s.p}</td><td>${s.p}</td><td>${s.d}</td></tr>`)}</tbody></table></div>`
          : html`<div class="card card-pad small muted">No skills runs yet.</div>`}
      </div>
      <div>
        <div class="section-head"><h2>Awards</h2></div>
        ${(d.awards || []).length ? html`<div class="list">${sortBy(d.awards, (a) => a.order).map((a) => html`<div class="row" style="min-height:48px"><div class="row-main">
          <div class="row-title" style="white-space:normal">${a.title}</div><div class="row-sub">${(a.teamWinners || []).map((w) => w.team.name).concat(a.individualWinners || []).join(', ') || 'TBA'}</div></div></div>`)}</div>`
          : html`<div class="card card-pad small muted">Awards not announced yet.</div>`}
      </div>
    </div>

    <div class="section-head mt-24"><h2>Scouting notes (${notes.length})</h2></div>
    ${noteGroups.length ? html`<div class="list">${noteGroups.map(([team, ns]) => {
      const rated = ns.filter((n) => n.rating);
      const tags = [...new Set(ns.flatMap((n) => n.tags || []))].slice(0, 5);
      const latest = ns.find((n) => n.text);
      return html`<div class="row" style="align-items:flex-start">
        <div class="avatar">${team.replace(/[A-Z]+$/, '')}</div>
        <div class="row-main"><div class="row-title">${team}${rated.length ? html`<${Stars} small value=${rated.reduce((a, n) => a + n.rating, 0) / rated.length} />` : ''}<span class="faint small" style="font-weight:500">${ns.length} note${ns.length > 1 ? 's' : ''}</span></div>
          ${tags.length > 0 && html`<div class="row-sub">${tags.join(' · ')}</div>`}
          ${latest && html`<div class="small mt-4" style="white-space:normal">“${latest.text}”</div>`}</div>
      </div>`;
    })}</div>` : html`<div class="card card-pad small muted">No scouting notes for teams at this event yet.</div>`}

    <p class="tiny faint center mt-24">Generated by Override Scout · team 1940D Override · data from events.vex.com</p>
  </${Screen}>`;
}
