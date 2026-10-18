import { html, useState, useMemo } from '../lib/html.js';
import { Icon } from '../lib/icons.js';
import { cx, fmtDate, norm, sortBy } from '../lib/util.js';
import { useStore } from '../lib/state.js';
import { setQuery, navigate } from '../lib/router.js';
import { useData, qaData, seasonId } from '../lib/data.js';
import { sanitize, plainText } from '../lib/sanitize.js';
import { GAME } from '../lib/game.js';
import { Screen, Seg, SearchBox, Skeleton, Empty, ErrorState, Updated, Switch } from '../components/ui.js';

function useQA(kind) {
  const program = useStore((s) => s.settings.program);
  const sq = useData(`season:${program}`, () => seasonId(), { ttl: 86400 });
  const season = sq.data;
  const q = useData(season ? `qa:${kind}:${season}` : null, async () => {
    const r = await qaData(kind, season);
    // Precompute search text once
    return { ...r, questions: (r.questions || []).map((x) => ({ ...x, _s: norm(`${x.id} ${x.title} ${plainText(x.content, 4000)} ${(x.answers || []).map((a) => plainText(a.content, 4000)).join(' ')} ${(x.tags || []).map((t) => t.name).join(' ')}`) })) };
  }, { ttl: 1800 });
  return { ...q, season };
}

export function QA({ query }) {
  const kind = query.kind === 'judging' ? 'judging' : 'season';
  const [text, setText] = useState(query.q || '');
  const [tag, setTag] = useState(query.tag || '');
  const [manualOnly, setManualOnly] = useState(false);
  const [sort, setSort] = useState('new');
  const q = useQA(kind);
  const qs = (q.data && q.data.questions) || [];

  const tags = useMemo(() => {
    const c = new Map();
    qs.forEach((x) => (x.tags || []).forEach((t) => c.set(t.name, (c.get(t.name) || 0) + 1)));
    return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
  }, [qs]);

  const list = useMemo(() => {
    const t = norm(text);
    const terms = t.split(' ').filter(Boolean);
    let out = qs.filter((x) => (!tag || (x.tags || []).some((y) => y.name === tag)) && (!manualOnly || x.publish_to_game_manual) &&
      (!terms.length || terms.every((w) => x._s.includes(w))));
    out = sort === 'new' ? sortBy(out, (x) => x.created_at || '', -1) : sortBy(out, (x) => x.id, 1);
    return out;
  }, [qs, text, tag, manualOnly, sort]);

  const answered = (x) => (x.answers || []).length > 0;
  return html`<${Screen} title="Rules & Q&A" sub="Official rulings from the VEX Q&A — searchable and saved for offline use">
    <div class="flex flex-wrap" style="gap:10px">
      <${Seg} options=${[{ value: 'season', label: 'Game Q&A' }, { value: 'judging', label: 'Judging Q&A' }]} value=${kind}
        onChange=${(k) => { setTag(''); setQuery({ kind: k === 'judging' ? 'judging' : null }); }} />
      <a class="btn btn-sm" href=${GAME.manualUrl} target="_blank" rel="noopener"><${Icon} name="book" /> Game manual</a>
    </div>
    <div class="mt-12"><${SearchBox} large value=${text} onInput=${(v) => { setText(v); }} placeholder=${kind === 'judging' ? 'Search judging rulings' : 'Search by rule (SG5), keyword or Q&A number'} /></div>
    ${tags.length > 0 && html`<div class="chips chips-scroll mt-12">
      <button class=${cx('chip', !tag && 'on')} onClick=${() => setTag('')}>All</button>
      ${tags.slice(0, 40).map((t) => html`<button class=${cx('chip', tag === t && 'on')} onClick=${() => setTag(tag === t ? '' : t)}>${t}</button>`)}
    </div>`}
    <div class="flex between mt-12 flex-wrap gap-12">
      <label class="flex small muted" style="gap:10px"><${Switch} checked=${manualOnly} onChange=${setManualOnly} label="Only rulings in the game manual" /> In game manual</label>
      <${Seg} options=${[{ value: 'new', label: 'Newest' }, { value: 'num', label: 'Number' }]} value=${sort} onChange=${setSort} />
    </div>
    <div class="mt-16">
      ${q.error && !q.data ? html`<${ErrorState} error=${q.error} onRetry=${q.refresh} />`
        : q.loading && !q.data ? html`<${Skeleton} rows=${6} />`
        : !list.length ? html`<${Empty} icon="book" title=${qs.length ? 'No rulings match' : 'No questions yet'} text=${qs.length ? 'Try fewer words or another rule tag.' : ''} />`
        : html`<p class="small faint mb-8">${list.length} ${list.length === 1 ? 'ruling' : 'rulings'}${q.data && q.data.is_open === false ? ' · Q&A is closed for new questions' : ''}</p>
          <div class="list">${list.slice(0, 200).map((x) => html`<a class="row" href=${`#/qa/${kind}/${x.id}`} style="align-items:flex-start">
            <div class=${cx('avatar', answered(x) && 'brand')} style="font-size:11.5px">${x.id}</div>
            <div class="row-main">
              <div class="row-title" style="white-space:normal">${x.title}</div>
              <div class="row-sub" style="white-space:normal">${plainText(x.summary || ((x.answers || [])[0] || {}).content || x.content, 150)}</div>
              <div class="flex flex-wrap gap-4 mt-4">
                ${(x.tags || []).slice(0, 4).map((t) => html`<span class="badge">${t.name}</span>`)}
                ${x.publish_to_game_manual && html`<span class="badge badge-soft">In manual</span>`}
                ${!answered(x) && html`<span class="badge badge-tie">Awaiting answer</span>`}
                <span class="tiny faint" style="margin-left:4px">${fmtDate(x.created_at)}</span>
              </div>
            </div>
          </a>`)}</div>`}
    </div>
    <div class="mt-16"><${Updated} at=${q.updatedAt} refreshing=${q.refreshing} onRefresh=${q.refresh} /></div>
  </${Screen}>`;
}

export function QADetail({ params }) {
  const kind = params.kind === 'judging' ? 'judging' : 'season';
  const q = useQA(kind);
  const x = q.data && q.data.questions.find((y) => String(y.id) === String(params.id));
  const official = kind === 'judging' ? 'https://events.vex.com/judging/QA' : `https://events.vex.com/V5RC/2026-2027/QA/${params.id}`;
  return html`<${Screen} title=${`Q&A ${params.id}`} backTo=${kind === 'judging' ? '/qa?kind=judging' : '/qa'}>
    ${q.loading && !q.data ? html`<${Skeleton} rows=${3} />` : !x ? html`<${ErrorState} error=${q.error || new Error('Question not found')} onRetry=${q.refresh} />` : html`<article style="max-width:760px">
      <div class="flex flex-wrap gap-4 mb-8">${(x.tags || []).map((t) => html`<a class="badge" href=${`#/qa?tag=${encodeURIComponent(t.name)}${kind === 'judging' ? '&kind=judging' : ''}`}>${t.name}</a>`)}
        ${x.publish_to_game_manual && html`<span class="badge badge-soft">In game manual</span>`}</div>
      <h1 style="font-size:22px;font-weight:850;letter-spacing:-.02em;line-height:1.25">${x.title}</h1>
      <div class="small muted mt-4">Asked by ${x.asked_by || 'a team'} · ${fmtDate(x.created_at)}</div>
      <div class="card card-pad mt-16"><div class="prose" dangerouslySetInnerHTML=${{ __html: sanitize(x.content) }}></div></div>
      ${(x.answers || []).length ? x.answers.map((a) => html`<div class="answer">
          <div class="answer-head"><${Icon} name="check" size="16" /> Official answer · ${fmtDate(a.created_at)}</div>
          <div class="prose" dangerouslySetInnerHTML=${{ __html: sanitize(a.content) }}></div>
        </div>`)
        : html`<div class="notice neutral mt-16"><${Icon} name="clock" /><div>This question hasn't been answered yet.</div></div>`}
      ${x.summary && html`<div class="card card-pad mt-12"><div class="eyebrow mb-8">Game manual summary</div><div class="prose" dangerouslySetInnerHTML=${{ __html: sanitize(x.summary) }}></div></div>`}
      <a class="btn btn-sm mt-16" href=${official} target="_blank" rel="noopener"><${Icon} name="external" /> View on events.vex.com</a>
    </article>`}
  </${Screen}>`;
}
