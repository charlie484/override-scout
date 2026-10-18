import { html, useState, useEffect, useMemo } from '../lib/html.js';
import { Icon } from '../lib/icons.js';
import { cx, fmt, fmtDate, norm, sortBy, groupBy, toCSV, uid, youtubeId, youtubeStart } from '../lib/util.js';
import { useStore, saveDoc, deleteDoc, liveDocs, toast, myTeam, openSheet, closeSheet } from '../lib/state.js';
import { navigate, back, setQuery } from '../lib/router.js';
import * as db from '../lib/db.js';
import { MATCH_FORM, PIT_FORM, SCOUT_TAGS, matchScore } from '../lib/game.js';
import { shareFile } from '../lib/share.js';
import { Screen, Section, Tabs, Seg, Stepper, Stars, Switch, Chips, Field, SearchBox, Empty, confirmSheet } from '../components/ui.js';
import { NoteList } from './team.js';
import { TeamPicker } from './compare.js';
import { openShareDocs } from './me.js';

const TABS = [{ id: 'notes', label: 'Notes' }, { id: 'lists', label: 'Pick lists' }, { id: 'practice', label: 'Practice' }, { id: 'checklists', label: 'Checklists' }];

export function Scout({ query }) {
  const tab = query.tab || 'notes';
  return html`<${Screen} title="Scouting" sub="Notes, pick lists, practice runs and checklists — shared with your workspace"
    actions=${html`<a class="btn btn-primary btn-sm" href="#/scout/new?kind=match"><${Icon} name="plus" /> Scout</a>`}>
    <${Tabs} tabs=${TABS} value=${tab} onChange=${(t) => setQuery({ tab: t })} />
    <div class="tab-panel">
      ${tab === 'notes' && html`<${NotesTab} />`}
      ${tab === 'lists' && html`<${ListsTab} />`}
      ${tab === 'practice' && html`<${PracticeLink} />`}
      ${tab === 'checklists' && html`<${ChecklistsTab} />`}
    </div>
  </${Screen}>`;
}

function NotesTab() {
  const docs = useStore((s) => s.docs);
  const [text, setText] = useState('');
  const [kind, setKind] = useState('all');
  const [group, setGroup] = useState('recent');
  const all = liveDocs(docs, 'scout');
  const t = norm(text);
  const notes = all.filter((n) => (kind === 'all' || n.kind === kind) &&
    (!t || norm(`${n.team} ${n.text} ${(n.tags || []).join(' ')} ${n.eventName} ${n.author && n.author.name}`).includes(t)));
  const exportCsv = () => {
    const keys = [...new Set(notes.flatMap((n) => Object.keys(n.fields || {})))];
    const rows = [['Team', 'Type', 'Event', 'Match', 'Rating', 'Tags', 'Notes', 'Scout', 'Date', ...keys],
      ...notes.map((n) => [n.team, n.kind, n.eventName || '', n.matchLabel || '', n.rating || '', (n.tags || []).join('; '), n.text || '',
        (n.author && n.author.name) || '', new Date(n.updatedAt).toISOString(), ...keys.map((k) => { const v = (n.fields || {})[k]; return Array.isArray(v) ? v.join('; ') : v == null ? '' : v; })])];
    shareFile(`scouting-${new Date().toISOString().slice(0, 10)}.csv`, new Blob([toCSV(rows)], { type: 'text/csv' }), 'Scouting notes');
  };
  return html`<div>
    <div class="btn-row mb-12">
      <a class="btn btn-primary" href="#/scout/new?kind=match"><${Icon} name="swords" /> Match</a>
      <a class="btn" href="#/scout/new?kind=pit"><${Icon} name="robot" /> Pit</a>
      <a class="btn" href="#/scout/new?kind=note"><${Icon} name="note" /> Note</a>
      <span class="grow"></span>
      ${all.length > 0 && html`<button class="btn btn-sm btn-ghost" onClick=${() => openShareDocs(notes)}><${Icon} name="share" /> Share</button>
        <button class="btn btn-sm btn-ghost" onClick=${exportCsv}><${Icon} name="download" /> CSV</button>`}
    </div>
    <${SearchBox} value=${text} onInput=${setText} placeholder="Search notes, teams, tags" />
    <div class="flex between flex-wrap mt-12 gap-12">
      <${Seg} options=${[{ value: 'all', label: 'All' }, { value: 'match', label: 'Match' }, { value: 'pit', label: 'Pit' }, { value: 'note', label: 'Notes' }]} value=${kind} onChange=${setKind} />
      <${Seg} options=${[{ value: 'recent', label: 'Recent' }, { value: 'team', label: 'By team' }]} value=${group} onChange=${setGroup} />
    </div>
    <div class="mt-16">
      ${!notes.length ? html`<${Empty} icon="clipboard" title=${all.length ? 'No notes match' : 'No scouting yet'}
          text="Scout matches and pits at your next event. Notes stay on this phone and sync to your workspace when you join one." />`
        : group === 'team' ? [...groupBy(sortBy(notes, (n) => n.team), (n) => n.team).entries()].map(([team, list]) => html`
          <div class="section" style="margin-top:14px"><div class="section-head"><h2><a href=${`#/team/${team}`}>${team}</a></h2><span class="small muted">${list.length} note${list.length > 1 ? 's' : ''}</span></div>
          <${NoteList} notes=${list} /></div>`)
        : html`<${NoteList} notes=${notes} showTeam />`}
    </div>
  </div>`;
}

function ListsTab() {
  const docs = useStore((s) => s.docs);
  const lists = liveDocs(docs, 'picklist');
  if (!lists.length) return html`<${Empty} icon="list" title="No pick lists yet" text="Open an event and use the Pick list tab to rank alliance partners. It saves here automatically." action=${html`<a class="btn" href="#/explore?tab=events">Find an event</a>`} />`;
  return html`<div class="list">${lists.map((p) => html`<a class="row" href=${`#/event/${p.event}?tab=picklist`}>
    <div class="avatar brand"><${Icon} name="list" /></div>
    <div class="row-main"><div class="row-title">${p.eventName || `Event ${p.event}`}</div>
      <div class="row-sub">${(p.order || []).slice(0, 6).join(' · ') || 'Default order'}</div></div>
    <${Icon} name="chevronRight" class="chev" /></a>`)}</div>`;
}

function PracticeLink() {
  const docs = useStore((s) => s.docs);
  const runs = liveDocs(docs, 'practice');
  const best = runs.reduce((m, r) => Math.max(m, r.score || 0), 0);
  return html`<div>
    <div class="tiles">
      <div class="tile accent"><div class="tile-label">Runs logged</div><div class="tile-value">${runs.length}</div></div>
      <div class="tile"><div class="tile-label">Best score</div><div class="tile-value">${runs.length ? best : '—'}</div></div>
      <div class="tile"><div class="tile-label">Last run</div><div class="tile-value" style="font-size:18px">${runs[0] ? fmtDate(runs[0].createdAt) : '—'}</div></div>
    </div>
    <a class="btn btn-primary btn-lg btn-block mt-16" href="#/practice"><${Icon} name="timer" /> Open practice log</a>
    <p class="small muted mt-8 center">Time runs, count points with the Override calculator, attach video and track progress.</p>
  </div>`;
}

function ChecklistsTab() {
  const docs = useStore((s) => s.docs);
  const ready = useStore((s) => s.docsReady);
  const lists = liveDocs(docs, 'checklist');
  const [newItem, setNewItem] = useState({});
  useEffect(() => {
    // Seed the default packing + pre-match lists the first time this tab opens
    let seeded = null;
    try { seeded = localStorage.getItem('os.seededChecklists'); } catch (e) { seeded = '1'; }
    if (ready && !lists.length && !seeded) {
      try { localStorage.setItem('os.seededChecklists', '1'); } catch (e) { /* ignore */ }
      import('../lib/game.js').then(({ DEFAULT_CHECKLISTS }) => DEFAULT_CHECKLISTS.forEach((c) =>
        saveDoc({ type: 'checklist', name: c.name, items: c.items.map((t) => ({ id: uid('i'), text: t, done: false })) })));
    }
  }, [ready]);
  const update = (l, items) => saveDoc({ ...l, items });
  return html`<div>
    ${lists.map((l) => {
      const done = l.items.filter((i) => i.done).length;
      return html`<div class="card mb-12">
        <div class="card-head"><h3>${l.name}</h3>
          <div class="flex" style="gap:2px"><span class="small muted">${done}/${l.items.length}</span>
            <button class="btn-icon" aria-label="Reset" onClick=${() => update(l, l.items.map((i) => ({ ...i, done: false })))}><${Icon} name="reset" size="18" /></button>
            <button class="btn-icon" aria-label="Delete list" onClick=${() => confirmSheet({ title: 'Delete list?', text: `“${l.name}” will be removed for everyone in your workspace.`, confirm: 'Delete', danger: true, onConfirm: () => deleteDoc(l.id) })}><${Icon} name="trash" size="18" /></button>
          </div></div>
        <div class="meter" style="margin:10px 16px 0"><div style=${`width:${l.items.length ? (done / l.items.length) * 100 : 0}%`}></div></div>
        <div class="card-body" style="padding-top:6px">
          ${l.items.map((i) => html`<label class="counter" style="cursor:pointer">
            <span class="counter-label" style=${i.done ? 'text-decoration:line-through;color:var(--text-3)' : ''}>${i.text}</span>
            <span class="flex" style="gap:2px">
              <input type="checkbox" style="width:22px;height:22px;accent-color:var(--brand)" checked=${i.done} onChange=${() => update(l, l.items.map((x) => (x.id === i.id ? { ...x, done: !x.done } : x)))} />
              <button class="btn-icon" style="width:30px;height:30px" aria-label="Remove item" onClick=${(e) => { e.preventDefault(); update(l, l.items.filter((x) => x.id !== i.id)); }}><${Icon} name="x" size="15" /></button>
            </span>
          </label>`)}
          <form class="input-row mt-8" onSubmit=${(e) => { e.preventDefault(); const t = (newItem[l.id] || '').trim(); if (!t) return; update(l, [...l.items, { id: uid('i'), text: t, done: false }]); setNewItem({ ...newItem, [l.id]: '' }); }}>
            <input class="input" placeholder="Add item" value=${newItem[l.id] || ''} onInput=${(e) => setNewItem({ ...newItem, [l.id]: e.target.value })} />
            <button class="btn" type="submit"><${Icon} name="plus" /></button>
          </form>
        </div>
      </div>`;
    })}
    <button class="btn btn-block" onClick=${() => openSheet(NewChecklist, { title: 'New checklist' })}><${Icon} name="plus" /> New checklist</button>
  </div>`;
}

function NewChecklist() {
  const [name, setName] = useState('');
  return html`<form onSubmit=${(e) => { e.preventDefault(); if (!name.trim()) return; saveDoc({ type: 'checklist', name: name.trim(), items: [] }); closeSheet(); }}>
    <${Field} label="Name"><input class="input" value=${name} onInput=${(e) => setName(e.target.value)} placeholder="e.g. Inspection checklist" /></${Field}>
    <button class="btn btn-primary btn-block mt-16" type="submit">Create</button>
  </form>`;
}

// ---------- Scouting form ----------
function FieldInput({ f, value, onChange }) {
  if (f.type === 'counter') return html`<${Stepper} value=${value || 0} onChange=${onChange} />`;
  if (f.type === 'bool') return html`<${Switch} checked=${!!value} onChange=${onChange} label=${f.label} />`;
  if (f.type === 'stars') return html`<${Stars} value=${value || 0} onChange=${onChange} />`;
  if (f.type === 'number') return html`<input class="input" style="width:120px;text-align:right" type="number" inputmode="numeric" placeholder=${f.placeholder || ''} value=${value ?? ''} onInput=${(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />`;
  return null;
}

async function resizeImage(file, max = 1280) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const s = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.82));
  } finally { URL.revokeObjectURL(url); }
}

export function BlobImage({ id, video }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let u = null;
    db.get('blobs', id).then((b) => { if (b) { u = URL.createObjectURL(b); setUrl(u); } });
    return () => u && URL.revokeObjectURL(u);
  }, [id]);
  if (!url) return null;
  return video ? html`<div class="photo"><video src=${url} controls playsinline></video></div>` : html`<div class="photo"><img src=${url} alt="Robot photo" /></div>`;
}

export function VideoEmbed({ url }) {
  const id = youtubeId(url);
  if (!id) return null;
  const start = youtubeStart(url);
  return html`<div class="video-embed"><iframe src=${`https://www.youtube-nocookie.com/embed/${id}?rel=0${start ? '&start=' + start : ''}`}
    title="Match video" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen" allowfullscreen loading="lazy"></iframe></div>`;
}

export function ScoutForm({ params, query }) {
  const docs = useStore((s) => s.docs);
  const existing = params.id ? docs.find((d) => d.id === params.id) : null;
  const [doc, setDoc] = useState(() => existing || {
    type: 'scout', kind: query.kind || 'match', team: (query.team || '').toUpperCase(), event: query.event ? Number(query.event) : null,
    eventName: query.eventName || '', matchLabel: query.match || '', alliance: query.alliance || '', fields: {}, tags: [], rating: 0, text: '', video: ''
  });
  useEffect(() => { if (existing && !doc.id) setDoc(existing); }, [existing]);
  const set = (patch) => setDoc((d) => ({ ...d, ...patch }));
  const setField = (k, v) => setDoc((d) => ({ ...d, fields: { ...d.fields, [k]: v } }));
  const form = doc.kind === 'pit' ? PIT_FORM : doc.kind === 'match' ? MATCH_FORM : [];
  const pts = doc.kind === 'match' ? matchScore({ halves: doc.fields.halves || 0, yellow: doc.fields.yellow || 0, midfield: doc.fields.midfield ? 1 : 0 }) : null;

  const save = async (andNew) => {
    if (!doc.team) { toast('Add a team number first', { icon: 'alert' }); return; }
    await saveDoc({ ...doc, team: doc.team.toUpperCase() });
    toast(existing ? 'Note updated' : 'Scouting saved');
    if (andNew) {
      setDoc({ ...doc, id: undefined, createdAt: undefined, author: undefined, team: '', fields: {}, tags: [], rating: 0, text: '', video: '', blobId: undefined });
      window.scrollTo(0, 0);
    } else back('/scout');
  };
  const addPhoto = async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const blob = f.type.startsWith('image/') ? await resizeImage(f) : f;
    const id = uid('b_');
    await db.put('blobs', blob, id);
    set({ blobId: id, blobType: f.type.startsWith('video/') ? 'video' : 'image' });
  };

  return html`<${Screen} title=${existing ? 'Edit scouting' : doc.kind === 'pit' ? 'Pit scouting' : doc.kind === 'match' ? 'Match scouting' : 'Quick note'} backTo="/scout"
    actions=${existing && html`<button class="btn-icon" aria-label="Delete" onClick=${() => confirmSheet({ title: 'Delete this note?', text: 'It will also be removed from your workspace.', confirm: 'Delete', danger: true, onConfirm: async () => { await deleteDoc(existing.id); back('/scout'); } })}><${Icon} name="trash" /></button>`}>
    <div style="max-width:720px">
      ${!existing && html`<${Seg} block options=${[{ value: 'match', label: 'Match' }, { value: 'pit', label: 'Pit' }, { value: 'note', label: 'Note' }]} value=${doc.kind} onChange=${(k) => set({ kind: k })} />`}

      <div class="card card-pad mt-16">
        ${doc.team ? html`<div class="flex between">
            <div><div class="eyebrow">Team</div><div style="font-size:28px;font-weight:900;letter-spacing:-.03em">${doc.team}</div></div>
            <button class="btn btn-sm" onClick=${() => set({ team: '' })}>Change</button>
          </div>`
          : html`<${Field} label="Team"><${TeamPicker} placeholder="Team number or name" onPick=${(n) => set({ team: n })} /></${Field}>`}
        ${doc.kind === 'match' && html`<div class="grid-2 mt-12">
          <${Field} label="Match"><input class="input" placeholder="e.g. Q14" value=${doc.matchLabel} onInput=${(e) => set({ matchLabel: e.target.value })} /></${Field}>
          <${Field} label="Alliance"><${Seg} block options=${[{ value: 'red', label: 'Red' }, { value: 'blue', label: 'Blue' }]} value=${doc.alliance} onChange=${(a) => set({ alliance: a })} /></${Field}>
        </div>`}
        ${(doc.kind !== 'note' || doc.eventName) && html`<div class="mt-12"><${Field} label="Event"><input class="input" placeholder="Event name (optional)" value=${doc.eventName} onInput=${(e) => set({ eventName: e.target.value })} /></${Field}></div>`}
      </div>

      ${form.map((sec) => html`<div class="card card-pad mt-12">
        <div class="eyebrow mb-8">${sec.section}</div>
        ${sec.fields.map((f) => (f.type === 'choice' || f.type === 'multi')
          ? html`<div class="counter" style="flex-direction:column;align-items:stretch;gap:8px"><span class="counter-label">${f.label}</span>
              <${Chips} options=${f.options} multi=${f.type === 'multi'} value=${doc.fields[f.key] || (f.type === 'multi' ? [] : '')} onChange=${(v) => setField(f.key, v)} /></div>`
          : html`<div class="counter"><span class="counter-label">${f.label}${f.hint && html`<small>${f.hint}</small>`}</span>
              <${FieldInput} f=${f} value=${doc.fields[f.key]} onChange=${(v) => setField(f.key, v)} /></div>`)}
      </div>`)}

      ${pts != null && pts > 0 && html`<div class="notice neutral mt-12"><${Icon} name="target" /><div>This robot contributed about <b>${pts} points</b> (pins + Midfield, excluding the auton bonus).</div></div>`}

      <div class="card card-pad mt-12">
        <div class="counter" style="border:0"><span class="counter-label">Overall rating</span><${Stars} value=${doc.rating} onChange=${(v) => set({ rating: v })} /></div>
        <div class="eyebrow mt-8 mb-8">Tags</div>
        <${Chips} options=${SCOUT_TAGS} value=${doc.tags} onChange=${(v) => set({ tags: v })} />
        <div class="mt-16"><${Field} label="Notes"><textarea class="textarea" placeholder="Strategy, strengths, weaknesses, what to watch for…" value=${doc.text} onInput=${(e) => set({ text: e.target.value })}></textarea></${Field}></div>
        <div class="mt-12"><${Field} label="Video link" hint="YouTube link — add ?t=90 to jump to the match"><input class="input" type="url" inputmode="url" placeholder="https://youtu.be/…" value=${doc.video} onInput=${(e) => set({ video: e.target.value.trim() })} /></${Field}></div>
        ${doc.video && html`<div class="mt-12"><${VideoEmbed} url=${doc.video} /></div>`}
        <div class="mt-12">
          <label class="btn btn-sm"><${Icon} name="camera" /> ${doc.blobId ? 'Replace photo/video' : doc.kind === 'pit' ? 'Photo of robot' : 'Add photo or video'}
            <input type="file" accept="image/*,video/*" capture="environment" hidden onChange=${addPhoto} /></label>
          <span class="tiny faint" style="margin-left:8px">Stays on this device</span>
        </div>
        ${doc.blobId && html`<div class="mt-12"><${BlobImage} id=${doc.blobId} video=${doc.blobType === 'video'} /></div>`}
      </div>

      <div class="btn-row mt-16" style="position:sticky;bottom:calc(var(--tabbar-h) + var(--sab) + 10px);z-index:5">
        <button class="btn btn-primary btn-lg grow" onClick=${() => save(false)}><${Icon} name="check" /> Save</button>
        ${!existing && html`<button class="btn btn-lg" onClick=${() => save(true)}>Save & next</button>`}
      </div>
    </div>
  </${Screen}>`;
}
