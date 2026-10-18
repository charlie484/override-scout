import { html, useState, useEffect, useRef } from '../lib/html.js';
import { Icon } from '../lib/icons.js';
import { cx, fmt, fmtDate, relTime, copyText, uid } from '../lib/util.js';
import {
  useStore, getState, updateSettings, saveDoc, saveDocsFromRemote, deleteDoc, liveDocs, toast, openSheet, closeSheet, workerUrl, loadDocs
} from '../lib/state.js';
import { navigate, back } from '../lib/router.js';
import * as db from '../lib/db.js';
import { testKey, hasLive } from '../lib/api.js';
import { encodePayload, decodePayload, makeLink, qrSvg, startScanner, shareLink, shareFile, appUrl } from '../lib/share.js';
import { canSync, createWorkspace, joinWorkspace, leaveWorkspace, syncNow, SYNC_TYPES } from '../lib/sync.js';
import { Screen, Section, Seg, Field, Switch, Empty, KV, confirmSheet, Spinner } from '../components/ui.js';

const VERSION = '1.0.0';

// ---------- QR helpers ----------
function QR({ text }) {
  const [svg, setSvg] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let alive = true;
    setSvg(null); setErr(null);
    qrSvg(text).then((s) => alive && setSvg(s)).catch((e) => alive && setErr(e));
    return () => { alive = false; };
  }, [text]);
  if (err) return html`<div class="notice neutral"><${Icon} name="info" /><div>Too much data for one QR code — use <b>Share link</b> or <b>Export file</b> instead.</div></div>`;
  return html`<div class="qr-box">${svg ? html`<div style="width:100%;height:100%" dangerouslySetInnerHTML=${{ __html: svg }}></div>` : html`<${Spinner} />`}</div>`;
}

function ScannerSheet() {
  const video = useRef();
  const [err, setErr] = useState(null);
  useEffect(() => {
    let stop = null, alive = true;
    startScanner(video.current, (value) => { closeSheet(); handleScan(value); })
      .then((s) => { if (alive) stop = s; else s(); })
      .catch((e) => setErr(e.message || 'Camera unavailable'));
    return () => { alive = false; stop && stop(); };
  }, []);
  return html`<div>
    ${err ? html`<div class="notice neutral"><${Icon} name="alert" /><div><b>Can't open the camera.</b><div class="small muted mt-4">${err}. You can also open the code with your phone's camera app.</div></div></div>`
      : html`<div class="scanner"><video ref=${video} playsinline muted></video></div>`}
    <p class="center small muted mt-12">Point at a friend's Override Scout QR code</p>
  </div>`;
}
export const openScanner = () => openSheet(ScannerSheet, { title: 'Scan QR code' });

export async function handleScan(text) {
  try {
    if (text.startsWith('OSKEY:')) {
      const p = await decodePayload(text.slice(6));
      return confirmSheet({
        title: 'Use shared API key?', confirm: 'Use key',
        text: `${p.from || 'A teammate'} shared their events.vex.com API key so this phone can load live data.`,
        onConfirm: () => { updateSettings({ apiToken: p.token }); toast('Live data connected'); }
      });
    }
    const i = text.indexOf('#/import?d=');
    if (i >= 0) { navigate('/import?d=' + text.slice(i + 11).split('&')[0]); return; }
    toast('That QR code isn\'t from Override Scout', { icon: 'alert' });
  } catch (e) {
    toast('Could not read that code', { icon: 'alert' });
  }
}

// ---------- Share scouting docs ----------
export function openShareDocs(docs, title = 'Share scouting') {
  const list = docs.filter((d) => !d.deleted).map(({ dirty, blobId, blobType, ...rest }) => rest);
  function Body() {
    const [link, setLink] = useState(null);
    const me = getState().settings.profile;
    useEffect(() => { makeLink('/import', { k: 'docs', from: { name: me.name || 'A teammate', team: me.team }, docs: list }).then(setLink); }, []);
    const json = JSON.stringify({ app: 'override-scout', v: 1, from: me, docs: list }, null, 1);
    return html`<div>
      <p class="muted small">${list.length} item${list.length === 1 ? '' : 's'}. Your teammate opens the link (or scans the code) and taps Import.</p>
      ${link && link.length < 2300 ? html`<div class="mt-12"><${QR} text=${link} /></div>` : link && html`<div class="notice neutral mt-12"><${Icon} name="info" /><div>Too big for a QR code — send the link or file instead.</div></div>`}
      <div class="btn-row mt-16">
        <button class="btn btn-primary" disabled=${!link} onClick=${async () => { const r = await shareLink({ title: 'Override Scout data', text: `${list.length} scouting notes`, url: link }); if (r === 'copied') toast('Link copied'); }}><${Icon} name="share" /> Share link</button>
        <button class="btn" onClick=${() => shareFile(`override-scout-${new Date().toISOString().slice(0, 10)}.json`, new Blob([json], { type: 'application/json' }), 'Override Scout data')}><${Icon} name="download" /> Export file</button>
      </div>
    </div>`;
  }
  openSheet(Body, { title });
}

async function importFile(file) {
  try {
    const data = JSON.parse(await file.text());
    const docs = Array.isArray(data) ? data : data.docs;
    if (!Array.isArray(docs)) throw new Error('Not an Override Scout file');
    const n = await saveDocsFromRemote(docs.filter((d) => d && d.id && d.type));
    toast(n ? `Imported ${n} item${n === 1 ? '' : 's'}` : 'Everything was already up to date');
  } catch (e) {
    toast('Could not import that file', { icon: 'alert' });
  }
}

// ---------- Main "Me" screen ----------
export function Me({ params }) {
  const section = params.section || '';
  useEffect(() => {
    if (section && section !== 'friends') setTimeout(() => document.getElementById('sec-' + section)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }, [section]);
  if (section === 'friends') return html`<${Friends} />`;
  return html`<${Screen} title="Profile & settings" backTo="/">
    <div style="max-width:760px">
      <${Profile} />
      <a class="row card mt-12" href="#/me/friends" style="border-radius:var(--radius)">
        <div class="avatar brand"><${Icon} name="users" /></div>
        <div class="row-main"><div class="row-title">Friends & sharing</div><div class="row-sub">Add friends by QR or email, share scouting, team workspace</div></div>
        <${Icon} name="chevronRight" class="chev" />
      </a>
      <${ApiKey} />
      <${Preferences} />
      <${DataSection} />
      <${About} />
    </div>
  </${Screen}>`;
}

function Profile() {
  const s = useStore((x) => x.settings);
  const p = s.profile || {};
  return html`<div class="card card-pad">
    <div class="flex" style="gap:14px">
      <div class="avatar brand" style="width:54px;height:54px;border-radius:16px;font-size:18px">${(p.name || '?').slice(0, 1).toUpperCase()}</div>
      <div class="grow"><div class="strong" style="font-size:18px">${p.name || 'Your name'}</div><div class="small muted">Scout for ${s.myTeam}</div></div>
    </div>
    <div class="grid-2 mt-16">
      <${Field} label="Your name" hint="Shown on notes you share"><input class="input" value=${p.name || ''} placeholder="e.g. Charlie"
        onChange=${(e) => updateSettings({ profile: { ...p, name: e.target.value.trim() } })} /></${Field}>
      <${Field} label="My team" hint="Your home screen follows this team"><input class="input" value=${s.myTeam} autocapitalize="characters"
        onChange=${(e) => { const t = e.target.value.trim().toUpperCase(); if (t) updateSettings({ myTeam: t, profile: { ...p, team: t } }); }} /></${Field}>
    </div>
  </div>`;
}

function ApiKey() {
  const token = useStore((s) => s.settings.apiToken);
  const worker = useStore((s) => s.settings.workerUrl);
  const [val, setVal] = useState(token);
  const [show, setShow] = useState(false);
  const [status, setStatus] = useState(null);
  const test = async () => {
    setStatus('testing');
    try { await testKey(); setStatus('ok'); toast('API key works'); } catch (e) { setStatus(e.message || 'failed'); }
  };
  const proxy = !!workerUrl();
  return html`<${Section} title="Live VEX data" class="" >
    <div id="sec-api" class="card card-pad">
      ${proxy ? html`<div class="notice"><${Icon} name="shield" /><div><b>Connected through your team server.</b><div class="small muted mt-4">This site's Worker adds the API key for you — nothing to set up on this phone.</div></div></div>` : html`
      <p class="small muted">Live schedules, results, rankings and Q&A come from the official <b>events.vex.com</b> API. It needs a free personal API key:</p>
      <ol class="small muted" style="padding-left:18px;margin:8px 0 14px;line-height:1.7">
        <li>Sign in at <a class="brand-text" href="https://events.vex.com/api/v2" target="_blank" rel="noopener">events.vex.com/api/v2</a> (any VEX Events account works).</li>
        <li>Request API access, then create a token and copy it.</li>
        <li>Paste it below. It's stored only on this device.</li>
      </ol>
      <${Field} label="API key">
        <div class="input-row">
          <input class="input" type=${show ? 'text' : 'password'} autocomplete="off" spellcheck="false" placeholder="Paste your events.vex.com token" value=${val} onInput=${(e) => setVal(e.target.value.trim())} />
          <button class="btn-icon" aria-label=${show ? 'Hide key' : 'Show key'} onClick=${() => setShow(!show)}><${Icon} name="eye" /></button>
        </div>
      </${Field}>
      <div class="btn-row mt-12">
        <button class="btn btn-primary" disabled=${val === token} onClick=${() => { updateSettings({ apiToken: val }); setStatus(null); toast(val ? 'API key saved' : 'API key removed'); }}>Save</button>
        <button class="btn" disabled=${!token} onClick=${test}>${status === 'testing' ? 'Testing…' : 'Test key'}</button>
        ${token && html`<button class="btn btn-ghost" onClick=${shareKey}><${Icon} name="qr" /> Share with teammate</button>`}
      </div>
      ${status && status !== 'testing' && html`<div class=${cx('small mt-8', status === 'ok' ? 'win' : 'loss')}>${status === 'ok' ? '✓ Connected to events.vex.com' : status}</div>`}
      `}
      <p class="tiny faint mt-12">Without a key you still get world skills, TrueSkill rankings and saved season data. Season stats refresh automatically every few hours.</p>
    </div>
  </${Section}>`;
}

function shareKey() {
  function Body() {
    const [text, setText] = useState(null);
    const p = getState().settings.profile;
    useEffect(() => { encodePayload({ k: 'key', token: getState().settings.apiToken, from: p.name || p.team }).then((t) => setText('OSKEY:' + t)); }, []);
    return html`<div>
      <div class="notice"><${Icon} name="alert" /><div><b>Only show this to your teammates.</b><div class="small muted mt-4">Anyone who scans it can use your events.vex.com API key. They scan it from Friends & sharing → Scan.</div></div></div>
      <div class="mt-16">${text ? html`<${QR} text=${text} />` : html`<${Spinner} center />`}</div>
    </div>`;
  }
  openSheet(Body, { title: 'Share API access' });
}

function Preferences() {
  const s = useStore((x) => x.settings);
  return html`<${Section} title="Preferences">
    <div id="sec-prefs" class="card card-pad">
      <div class="counter" style="border:0"><span class="counter-label">Theme</span>
        <${Seg} options=${[{ value: 'system', label: 'Auto' }, { value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]} value=${s.theme} onChange=${(v) => updateSettings({ theme: v })} /></div>
      <div class="counter"><span class="counter-label">Program<small>Used for search and rankings</small></span>
        <${Seg} options=${['V5RC', 'VIQRC', 'VEXU']} value=${s.program} onChange=${(v) => updateSettings({ program: v })} /></div>
      <div class="counter"><span class="counter-label">Timer sounds</span><${Switch} checked=${s.sound} onChange=${(v) => updateSettings({ sound: v })} label="Timer sounds" /></div>
      <div class="counter"><span class="counter-label">Vibration<small>Counters and timer (Android)</small></span><${Switch} checked=${s.haptics} onChange=${(v) => updateSettings({ haptics: v })} label="Vibration" /></div>
      <details class="mt-12">
        <summary class="small muted" style="cursor:pointer">Advanced: team server</summary>
        <div class="mt-12"><${Field} label="Worker URL" hint="Optional Cloudflare Worker for live team sync and a shared API key (see README)">
          <input class="input" type="url" placeholder="https://override-scout.<you>.workers.dev" value=${s.workerUrl}
            onChange=${(e) => updateSettings({ workerUrl: e.target.value.trim().replace(/\/+$/, '') })} /></${Field}></div>
      </details>
    </div>
  </${Section}>`;
}

function DataSection() {
  const docs = useStore((s) => s.docs);
  const [est, setEst] = useState(null);
  useEffect(() => { db.estimate().then(setEst); }, []);
  const counts = {};
  liveDocs(docs).forEach((d) => { counts[d.type] = (counts[d.type] || 0) + 1; });
  return html`<${Section} title="Your data">
    <div id="sec-data" class="card card-pad">
      <${KV} items=${[
        ['Scouting notes', counts.scout || 0], ['Practice runs', counts.practice || 0], ['Pick lists', counts.picklist || 0],
        ['Friends', counts.friend || 0], est && ['Storage used', `${fmt((est.usage || 0) / 1048576, 1)} MB`]
      ]} />
      <div class="btn-row mt-16">
        <button class="btn btn-sm" onClick=${() => openShareDocs(liveDocs(docs).filter((d) => d.type !== 'friend'), 'Back up / share everything')}><${Icon} name="download" /> Export backup</button>
        <label class="btn btn-sm"><${Icon} name="upload" /> Import file<input type="file" accept="application/json,.json" hidden onChange=${(e) => e.target.files[0] && importFile(e.target.files[0])} /></label>
        <button class="btn btn-sm" onClick=${async () => { await db.clear('cache'); toast('Cached VEX data cleared'); }}><${Icon} name="refresh" /> Clear cache</button>
        <button class="btn btn-sm btn-danger" onClick=${() => confirmSheet({
          title: 'Delete all data on this phone?', danger: true, confirm: 'Delete everything',
          text: 'Removes every note, practice run, photo and setting stored on this device. Shared copies on teammates\' phones are not affected.',
          onConfirm: async () => { await Promise.all(['cache', 'docs', 'blobs'].map((s) => db.clear(s))); localStorage.clear(); location.reload(); }
        })}><${Icon} name="trash" /> Delete all</button>
      </div>
    </div>
  </${Section}>`;
}

function About() {
  return html`<${Section} title="About">
    <div class="card card-pad">
      <span class="logo-swap" style="display:block">
        <img class="logo-dark" src="assets/logo-full-dark.png" alt="Override 1940D" style="height:44px;width:auto" />
        <img class="logo-light" src="assets/logo-full-light.png" alt="Override 1940D" style="height:44px;width:auto" />
      </span>
      <p class="small muted mt-12">Override Scout ${VERSION} — built by and for team 1940D Override. Stats and rulings come from the official VEX Events API; TrueSkill, OPR, DPR and CCWM are calculated by this app.</p>
      <p class="tiny faint mt-8">Not affiliated with or endorsed by VEX Robotics or Innovation First.</p>
      <div class="btn-row mt-12">
        <button class="btn btn-sm" onClick=${() => shareLink({ title: 'Override Scout', text: 'VEX scouting app from 1940D Override', url: appUrl('/') })}><${Icon} name="share" /> Share app</button>
        <button class="btn btn-sm" onClick=${() => { navigator.serviceWorker && navigator.serviceWorker.getRegistration().then((r) => r && r.update()); toast('Checking for updates…'); }}><${Icon} name="refresh" /> Check for update</button>
      </div>
    </div>
  </${Section}>`;
}

// ---------- Friends & sharing ----------
function Friends() {
  const s = useStore((x) => x.settings);
  const docs = useStore((x) => x.docs);
  const members = useStore((x) => x.members || []);
  const syncStatus = useStore((x) => x.syncStatus);
  const lastSync = useStore((x) => x.lastSync);
  const friends = liveDocs(docs, 'friend');
  const p = s.profile;
  const [myLink, setMyLink] = useState(null);
  const ws = s.workspace;
  useEffect(() => {
    makeLink('/import', { k: 'friend', id: p.id, name: p.name || 'Teammate', team: p.team || s.myTeam, ws: ws && workerUrl() ? { id: ws.id, key: ws.key, name: ws.name, url: workerUrl() } : undefined }).then(setMyLink);
  }, [p.id, p.name, p.team, ws && ws.id]);
  const shared = (f) => liveDocs(docs, 'scout').filter((d) => d.author && d.author.id === f.fid).length;

  return html`<${Screen} title="Friends & sharing" sub="Scan a QR code or send an email invite to collaborate" backTo="/me">
    <div class="split">
      <div>
        <div class="card card-pad center">
          <div class="eyebrow">My code</div>
          <div class="strong mt-4">${p.name || 'Set your name in Profile'} · ${p.team || s.myTeam}</div>
          <div class="mt-12">${myLink ? html`<${QR} text=${myLink} />` : html`<${Spinner} center />`}</div>
          <p class="small muted mt-12">Friends scan this with their camera or the Scan button to add you${ws ? ' and join your workspace' : ''}.</p>
          <div class="btn-row mt-12" style="justify-content:center">
            <button class="btn btn-primary" onClick=${openScanner}><${Icon} name="scan" /> Scan</button>
            <button class="btn" onClick=${async () => { const r = await shareLink({ title: 'Add me on Override Scout', text: `${p.name || 'Your teammate'} invited you to scout with them`, url: myLink }); if (r === 'copied') toast('Invite link copied'); }}><${Icon} name="share" /> Share invite</button>
          </div>
        </div>
        <${EmailInvite} link=${myLink} />
      </div>

      <div>
        <${Section} title="Friends" class="" right=${html`<span class="small muted">${friends.length}</span>`}>
          ${friends.length ? html`<div class="list">${friends.map((f) => html`<div class="row">
            <div class="avatar">${(f.name || f.email || '?').slice(0, 1).toUpperCase()}</div>
            <div class="row-main"><div class="row-title">${f.name || f.email}${f.pending && html`<span class="badge">Invited</span>`}</div>
              <div class="row-sub">${[f.team, f.email, f.fid ? `${shared(f)} shared notes` : null].filter(Boolean).join(' · ')}</div></div>
            <button class="btn-icon" aria-label="Share my notes" onClick=${() => openShareDocs(liveDocs(docs, 'scout').filter((d) => !d.author || d.author.id === p.id), `Share with ${f.name || f.email}`)}><${Icon} name="share" /></button>
            <button class="btn-icon" aria-label="Remove friend" onClick=${() => confirmSheet({ title: 'Remove friend?', text: `${f.name || f.email} will be removed from your list. Notes they shared stay.`, confirm: 'Remove', danger: true, onConfirm: () => deleteDoc(f.id) })}><${Icon} name="x" /></button>
          </div>`)}</div>` : html`<div class="card card-pad muted small">No friends yet — scan a teammate's code or send an invite.</div>`}
        </${Section}>

        <${Section} title="Team workspace">
          <div class="card card-pad">
            ${!canSync() ? html`
              <p class="small muted">Share scouting instantly with <b>Share</b> buttons (links, QR codes, files) — works with no internet at the venue.</p>
              <p class="small muted mt-8">For automatic live sync between everyone's phones, set up the free team server (Cloudflare Worker) described in the README, then add its URL under Settings → Advanced.</p>
              <button class="btn btn-sm mt-12" onClick=${() => openShareDocs(liveDocs(docs).filter((d) => SYNC_TYPES.includes(d.type)))}><${Icon} name="share" /> Share all scouting</button>`
            : ws ? html`
              <div class="flex between"><div><div class="strong">${ws.name || 'Workspace'}</div>
                <div class="small muted">${syncStatus === 'syncing' ? 'Syncing…' : syncStatus === 'error' ? 'Sync error — will retry' : lastSync ? `Synced ${relTime(lastSync)}` : 'Not synced yet'}</div></div>
                <button class="btn btn-sm" onClick=${() => syncNow()}><${Icon} name="refresh" /> Sync</button></div>
              ${members.length > 0 && html`<div class="list mt-12">${members.map((m) => html`<div class="row" style="min-height:48px">
                <div class="avatar" style="width:34px;height:34px">${(m.name || '?').slice(0, 1).toUpperCase()}</div>
                <div class="row-main"><div class="row-title">${m.name || 'Teammate'}${m.id === p.id ? html`<span class="faint">(you)</span>` : ''}</div><div class="row-sub">${m.team || ''}${m.lastSeen ? ' · active ' + relTime(m.lastSeen) : ''}</div></div>
              </div>`)}</div>`}
              <p class="tiny faint mt-12">Anyone who scans your code joins this workspace and sees all scouting notes, pick lists and practice runs.</p>
              <button class="btn btn-sm btn-danger mt-8" onClick=${() => confirmSheet({ title: 'Leave workspace?', text: 'Your notes stay on this phone but stop syncing.', confirm: 'Leave', danger: true, onConfirm: leaveWorkspace })}>Leave workspace</button>`
            : html`<${CreateWorkspace} />`}
          </div>
        </${Section}>
      </div>
    </div>
  </${Screen}>`;
}

function EmailInvite({ link }) {
  const [email, setEmail] = useState('');
  const p = getState().settings.profile;
  const send = async (e) => {
    e.preventDefault();
    const addr = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(addr)) { toast('Enter a valid email', { icon: 'alert' }); return; }
    await saveDoc({ type: 'friend', email: addr, name: '', pending: true, invitedAt: Date.now() });
    const subject = encodeURIComponent(`${p.name || 'Your teammate'} invited you to Override Scout`);
    const body = encodeURIComponent(`Hi!\n\nI'm using Override Scout to scout VEX matches for ${p.team || ''}. Tap this link to add me as a friend and share scouting notes:\n\n${link}\n\nTip: on your phone, use "Add to Home Screen" so it works like an app.`);
    window.location.href = `mailto:${encodeURIComponent(addr)}?subject=${subject}&body=${body}`;
    setEmail('');
    toast('Opening your email app…', { icon: 'mail' });
  };
  return html`<form class="card card-pad mt-12" onSubmit=${send}>
    <div class="eyebrow mb-8">Invite by email</div>
    <div class="input-row">
      <input class="input" type="email" inputmode="email" autocomplete="email" placeholder="friend@school.edu" value=${email} onInput=${(e) => setEmail(e.target.value)} />
      <button class="btn btn-primary" type="submit" disabled=${!link}><${Icon} name="mail" /> Invite</button>
    </div>
    <p class="tiny faint mt-8">Sends from your own email app with your personal invite link.</p>
  </form>`;
}

function CreateWorkspace() {
  const s = getState().settings;
  const [name, setName] = useState(`${s.myTeam} scouting`);
  const [busy, setBusy] = useState(false);
  return html`<form onSubmit=${async (e) => {
    e.preventDefault(); setBusy(true);
    try { await createWorkspace(name.trim() || `${s.myTeam} scouting`); toast('Workspace created — share your code to invite'); }
    catch (err) { toast(err.message, { icon: 'alert' }); }
    setBusy(false);
  }}>
    <p class="small muted">Create a workspace and everyone who scans your code syncs scouting automatically.</p>
    <div class="input-row mt-12">
      <input class="input" value=${name} onInput=${(e) => setName(e.target.value)} />
      <button class="btn btn-primary" type="submit" disabled=${busy}>${busy ? 'Creating…' : 'Create'}</button>
    </div>
  </form>`;
}

// ---------- Import (opened from shared links / QR codes) ----------
export function Import({ query }) {
  const [payload, setPayload] = useState(null);
  const [err, setErr] = useState(null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!query.d) { setErr('Nothing to import'); return; }
    decodePayload(query.d).then(setPayload).catch(() => setErr('This link is damaged or incomplete.'));
  }, [query.d]);
  const me = getState().settings.profile;

  const accept = async () => {
    if (payload.k === 'friend') {
      if (payload.id === me.id) { toast("That's your own code"); return; }
      const existing = liveDocs(getState().docs, 'friend').find((f) => f.fid === payload.id);
      await saveDoc({ ...(existing || {}), type: 'friend', fid: payload.id, name: payload.name, team: payload.team, pending: false });
      if (payload.ws && payload.ws.url) {
        if (!workerUrl()) updateSettings({ workerUrl: payload.ws.url });
        if (!getState().settings.workspace) await joinWorkspace(payload.ws);
      }
      toast(`${payload.name} added`);
    } else if (payload.k === 'docs') {
      const n = await saveDocsFromRemote(payload.docs || []);
      toast(n ? `Imported ${n} item${n === 1 ? '' : 's'}` : 'Already up to date');
    } else if (payload.k === 'ws') {
      if (payload.url && !workerUrl()) updateSettings({ workerUrl: payload.url });
      await joinWorkspace(payload);
      toast(`Joined ${payload.name || 'workspace'}`);
    }
    setDone(true);
  };

  return html`<${Screen} title="Import" backTo="/">
    <div class="card card-pad" style="max-width:560px;margin:0 auto">
      ${err ? html`<${Empty} icon="alert" title="Can't import" text=${err} />`
        : !payload ? html`<${Spinner} center />`
        : done ? html`<${Empty} icon="check" title="All set" action=${html`<div class="btn-row" style="justify-content:center"><a class="btn btn-primary" href=${payload.k === 'docs' ? '#/scout' : '#/me/friends'}>Open</a><a class="btn" href="#/">Home</a></div>`} />`
        : html`<div class="center">
          <div class="empty-icon" style="background:var(--brand-soft);color:var(--brand-text)"><${Icon} name=${payload.k === 'docs' ? 'download' : 'userPlus'} /></div>
          ${payload.k === 'friend' && html`<h3 style="font-size:19px;font-weight:800">Add ${payload.name} as a friend?</h3>
            <p class="muted small mt-4">${payload.team ? `Team ${payload.team}. ` : ''}${payload.ws ? `You'll also join the “${payload.ws.name}” workspace and sync scouting.` : 'You can share scouting notes with each other.'}</p>`}
          ${payload.k === 'docs' && html`<h3 style="font-size:19px;font-weight:800">Import ${(payload.docs || []).length} item${(payload.docs || []).length === 1 ? '' : 's'}?</h3>
            <p class="muted small mt-4">Shared by ${payload.from ? `${payload.from.name}${payload.from.team ? ' (' + payload.from.team + ')' : ''}` : 'a teammate'}. Newer versions replace older ones.</p>`}
          ${payload.k === 'ws' && html`<h3 style="font-size:19px;font-weight:800">Join “${payload.name || 'workspace'}”?</h3>
            <p class="muted small mt-4">Scouting notes, pick lists and practice runs will sync with everyone in it.</p>`}
          <div class="btn-row mt-16" style="justify-content:center">
            <button class="btn btn-primary btn-lg" onClick=${accept}>${payload.k === 'docs' ? 'Import' : payload.k === 'ws' ? 'Join' : 'Add friend'}</button>
            <a class="btn btn-lg" href="#/">Not now</a>
          </div>
        </div>`}
    </div>
  </${Screen}>`;
}
