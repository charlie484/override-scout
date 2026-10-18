import { html } from '../lib/html.js';
import { Icon } from '../lib/icons.js';
import { cx, fmt, matchLabel, fmtTime, fmtDay, ROUNDS } from '../lib/util.js';
import { useStore, closeSheet, myTeam } from '../lib/state.js';
import { navigate } from '../lib/router.js';
import { useData, seasonRatings, isPlayed } from '../lib/data.js';
import { predictMatch, tsScore } from '../lib/stats.js';
import { ProbBar } from '../components/ui.js';

function AllianceCard({ color, a, won, ratings, oprs, me }) {
  return html`<div class=${cx('alliance', color)}>
    <div class="alliance-head">
      <span class="alliance-name">${color}${won ? ' · win' : ''}</span>
      <span class="alliance-score">${a.played ? a.score : ''}</span>
    </div>
    <div class="alliance-teams">
      ${a.teams.map((t) => {
        const r = ratings && ratings.get(t);
        const o = oprs && oprs.get(t);
        return html`<button class="alliance-team" style=${t === me ? 'outline:2px solid var(--brand)' : ''}
          onClick=${() => { closeSheet(); navigate('/team/' + encodeURIComponent(t)); }}>
          <span class="n">${t}${a.sitting.includes(t) ? html`<span class="faint tiny"> sat out</span>` : ''}</span>
          <span class="m">${r ? html`TS ${fmt(tsScore(r), 1)}` : ''}${o && o.opr != null ? html`<br />OPR ${fmt(o.opr, 1)}` : ''}</span>
        </button>`;
      })}
    </div>
  </div>`;
}

/** Match detail, shown in a bottom sheet. Pass `stats` (event OPR map) for better score predictions. */
export function MatchSheet({ m, stats, ratings: ratingsIn }) {
  const program = useStore((s) => s.settings.program);
  const rq = useData(`ratings:${program}`, () => seasonRatings(), { ttl: 3600 });
  const ratings = ratingsIn || (rq.data && rq.data.available ? rq.data.ratings : null);
  const oprs = stats && stats.size ? stats : rq.data ? rq.data.oprs : null;
  const played = isPlayed(m);
  const pred = predictMatch(m.red.teams.filter((t) => !m.red.sitting.includes(t)), m.blue.teams.filter((t) => !m.blue.sitting.includes(t)),
    { ratings, oprs, sigma: stats && stats.sigma });
  const me = myTeam();
  const eventName = m.event && m.event.name;
  const label = matchLabel(m);
  const ytQuery = encodeURIComponent(`${eventName || 'VEX'} ${label.replace(/^Q/, 'Qualification ')}`);
  const myTeams = [...m.red.teams, ...m.blue.teams];

  return html`<div>
    <div class="flex between mb-12">
      <div>
        <div class="eyebrow">${(ROUNDS[m.round] || {}).name || 'Match'}${m.division && m.division.name ? ' · ' + m.division.name : ''}</div>
        <div style="font-size:22px;font-weight:850;letter-spacing:-.02em">${label}${m.field ? html`<span class="faint" style="font-weight:600;font-size:15px"> · ${m.field}</span>` : ''}</div>
      </div>
      <div class="right small muted">${m.scheduled ? html`${fmtDay(m.scheduled)}<br />${fmtTime(m.started || m.scheduled)}` : ''}</div>
    </div>

    <div class="alliances">
      <${AllianceCard} color="red" a=${{ ...m.red, played }} won=${played && m.red.score > m.blue.score} ratings=${ratings} oprs=${oprs} me=${me} />
      <${AllianceCard} color="blue" a=${{ ...m.blue, played }} won=${played && m.blue.score > m.red.score} ratings=${ratings} oprs=${oprs} me=${me} />
    </div>

    ${pred.method !== 'none' && html`<div class="card card-pad mt-12">
      <div class="flex between mb-8"><div class="eyebrow">${played ? 'Pre-match prediction' : 'Prediction'}</div><span class="badge">${pred.method}</span></div>
      <${ProbBar} pRed=${pred.pRed} />
      ${pred.redScore != null && html`<div class="small muted mt-8">Expected score ${fmt(pred.redScore)} – ${fmt(pred.blueScore)} (sum of OPR)</div>`}
      ${played && html`<div class="small mt-4 ${(pred.pRed >= 0.5) === (m.red.score >= m.blue.score) ? 'win' : 'loss'}">
        ${(pred.pRed >= 0.5) === (m.red.score >= m.blue.score) ? 'Prediction was right' : 'Upset!'}</div>`}
    </div>`}

    <div class="eyebrow mt-16 mb-8">Scout this match</div>
    <div class="chips">
      ${myTeams.map((t) => html`<button class="chip" onClick=${() => {
        closeSheet();
        navigate(`/scout/new?team=${encodeURIComponent(t)}&kind=match&event=${m.event ? m.event.id : ''}&match=${encodeURIComponent(label)}&eventName=${encodeURIComponent(eventName || '')}&alliance=${m.red.teams.includes(t) ? 'red' : 'blue'}`);
      }}><${Icon} name="plus" />${t}</button>`)}
    </div>

    <div class="btn-row mt-16">
      <a class="btn btn-sm" target="_blank" rel="noopener" href=${`https://www.youtube.com/results?search_query=${ytQuery}`}><${Icon} name="youtube" /> Find video</a>
      ${m.event && m.event.id && html`<button class="btn btn-sm" onClick=${() => { closeSheet(); navigate('/event/' + m.event.id + '?tab=matches'); }}><${Icon} name="calendar" /> Event</button>`}
      <button class="btn btn-sm" onClick=${() => { closeSheet(); navigate(`/predict?red=${m.red.teams.join(',')}&blue=${m.blue.teams.join(',')}`); }}><${Icon} name="sparkles" /> What-if</button>
    </div>
  </div>`;
}
