import { html, useState } from '../lib/html.js';
import { Icon } from '../lib/icons.js';
import { cx, fmt, fmtDate, fmtTime, sortBy, uid } from '../lib/util.js';
import { useStore, saveDoc, deleteDoc, liveDocs, toast, openSheet, closeSheet } from '../lib/state.js';
import * as db from '../lib/db.js';
import { skillsScore, GAME } from '../lib/game.js';
import { Screen, Section, Seg, Stepper, Field, Empty, Tile, confirmSheet } from '../components/ui.js';
import { Sparkline } from '../components/charts.js';
import { Timer } from './tools.js';
import { BlobImage } from './scout.js';

const MODES = [
  { value: 'driver', label: 'Driver skills' },
  { value: 'auton', label: 'Auton skills' },
  { value: 'match', label: 'Match practice' }
];

export function Practice() {
  const docs = useStore((s) => s.docs);
  const runs = liveDocs(docs, 'practice');
  const [mode, setMode] = useState('driver');
  const [draft, setDraft] = useState(null);
  const series = (m) => sortBy(runs.filter((r) => r.mode === m), (r) => r.createdAt).map((r) => r.score);
  const best = (m) => { const s = series(m); return s.length ? Math.max(...s) : null; };
  const recent = (m) => { const s = series(m).slice(-5); return s.length ? s.reduce((a, b) => a + b, 0) / s.length : null; };

  return html`<${Screen} title="Practice log" sub="Time runs, score them, attach video and watch the trend" backTo="/scout?tab=practice">
    <div class="split">
      <div>
        <div class="card card-pad">
          <${Seg} block options=${MODES} value=${mode} onChange=${setMode} />
          <${Timer} compact key=${mode} onFinish=${() => setDraft({ mode, halves: 0, yellow: 0, midfield: 0, notes: '' })} />
          <button class="btn btn-block" onClick=${() => setDraft({ mode, halves: 0, yellow: 0, midfield: 0, notes: '' })}><${Icon} name="plus" /> Log a run without the timer</button>
        </div>
        ${draft && html`<${RunForm} draft=${draft} setDraft=${setDraft} />`}
      </div>
      <div>
        <div class="tiles" style="grid-template-columns:repeat(2,minmax(0,1fr))">
          <${Tile} label="Best driver" value=${best('driver') ?? '—'} sub=${recent('driver') != null ? `last 5 avg ${fmt(recent('driver'), 1)}` : 'no runs'} accent />
          <${Tile} label="Best auton" value=${best('auton') ?? '—'} sub=${recent('auton') != null ? `last 5 avg ${fmt(recent('auton'), 1)}` : 'no runs'} />
        </div>
        ${series(mode).length > 1 && html`<div class="card card-pad mt-12"><div class="eyebrow">${MODES.find((m) => m.value === mode).label} trend</div><div class="mt-8"><${Sparkline} values=${series(mode)} /></div></div>`}
        <${Section} title="Runs">
          ${runs.length ? html`<div class="list">${runs.map((r) => html`<button class="row" onClick=${() => openSheet(() => html`<${RunDetail} r=${r} />`, { title: MODES.find((m) => m.value === r.mode)?.label || 'Run' })}>
            <div class=${cx('avatar', r.mode === 'auton' ? 'brand' : '')}><${Icon} name=${r.mode === 'auton' ? 'robot' : r.mode === 'match' ? 'swords' : 'gauge'} /></div>
            <div class="row-main"><div class="row-title">${(MODES.find((m) => m.value === r.mode) || {}).label || r.mode}${r.blobId ? html`<${Icon} name="video" size="14" />` : ''}</div>
              <div class="row-sub">${fmtDate(r.createdAt)} ${fmtTime(r.createdAt)}${r.notes ? ' · ' + r.notes : ''} · ${(r.author && r.author.name) || 'Me'}</div></div>
            <div class="row-end"><div class="big">${r.score}</div><div class="small">pts</div></div>
          </button>`)}</div>` : html`<${Empty} icon="timer" title="No practice runs yet" text="Run the timer, then log your score. Your best and average scores show up here." />`}
        </${Section}>
      </div>
    </div>
  </${Screen}>`;
}

function RunForm({ draft, setDraft }) {
  const set = (p) => setDraft({ ...draft, ...p });
  const score = draft.manual != null && draft.manual !== '' ? Number(draft.manual) : skillsScore(draft);
  const attach = async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const id = uid('b_');
    await db.put('blobs', f, id);
    set({ blobId: id, blobType: f.type.startsWith('video/') ? 'video' : 'image' });
  };
  return html`<div class="card card-pad mt-12" style="border-color:var(--brand-line)">
    <div class="flex between"><div class="eyebrow">Log run · ${(MODES.find((m) => m.value === draft.mode) || {}).label}</div>
      <button class="btn-icon" aria-label="Discard" onClick=${() => setDraft(null)}><${Icon} name="x" /></button></div>
    <div class="counter"><span class="counter-label">Red/blue pin halves<small>${GAME.points.allianceHalf} pts</small></span><${Stepper} value=${draft.halves} onChange=${(v) => set({ halves: v, manual: null })} /></div>
    <div class="counter"><span class="counter-label">Owned yellow halves<small>${GAME.points.yellowHalf} pts</small></span><${Stepper} value=${draft.yellow} onChange=${(v) => set({ yellow: v, manual: null })} /></div>
    <div class="counter"><span class="counter-label">Ended in Midfield<small>${GAME.points.midfield} pts</small></span><${Stepper} value=${draft.midfield} max=${1} onChange=${(v) => set({ midfield: v, manual: null })} /></div>
    <div class="grid-2 mt-12">
      <${Field} label="Score"><input class="input" type="number" inputmode="numeric" value=${score} onInput=${(e) => set({ manual: e.target.value })} /></${Field}>
      <${Field} label="Notes"><input class="input" placeholder="What went well / wrong" value=${draft.notes} onInput=${(e) => set({ notes: e.target.value })} /></${Field}>
    </div>
    <div class="flex mt-12 flex-wrap">
      <label class="btn btn-sm"><${Icon} name="video" /> ${draft.blobId ? 'Replace video' : 'Record / attach video'}
        <input type="file" accept="video/*,image/*" capture="environment" hidden onChange=${attach} /></label>
      ${draft.blobId && html`<span class="badge badge-win">Attached</span>`}
      <span class="grow"></span>
      <button class="btn btn-primary" onClick=${async () => {
        await saveDoc({ type: 'practice', mode: draft.mode, score, breakdown: { halves: draft.halves, yellow: draft.yellow, midfield: draft.midfield }, notes: draft.notes, blobId: draft.blobId, blobType: draft.blobType });
        setDraft(null); toast(`Run saved · ${score} pts`);
      }}><${Icon} name="check" /> Save run</button>
    </div>
  </div>`;
}

function RunDetail({ r }) {
  return html`<div>
    <div class="result center"><div class="result-big">${r.score}<small>points</small></div><div class="small muted">${fmtDate(r.createdAt)} ${fmtTime(r.createdAt)} · ${(r.author && r.author.name) || 'Me'}</div></div>
    ${r.breakdown && r.breakdown.halves != null && html`<div class="tiles mt-12">
      <${Tile} label="Pin halves" value=${r.breakdown.halves} /><${Tile} label="Yellow" value=${r.breakdown.yellow} /><${Tile} label="Midfield" value=${r.breakdown.midfield ? 'Yes' : 'No'} />
    </div>`}
    ${r.notes && html`<p class="mt-12">${r.notes}</p>`}
    ${r.blobId && html`<div class="mt-12"><${BlobImage} id=${r.blobId} video=${r.blobType === 'video'} /></div>`}
    <button class="btn btn-danger mt-16" onClick=${() => confirmSheet({ title: 'Delete this run?', text: 'This cannot be undone.', confirm: 'Delete', danger: true, onConfirm: () => deleteDoc(r.id) })}><${Icon} name="trash" /> Delete run</button>
  </div>`;
}
