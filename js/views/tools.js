import { html, useState, useEffect, useRef, useMemo } from '../lib/html.js';
import { Icon } from '../lib/icons.js';
import { cx, fmt } from '../lib/util.js';
import { useStore, getState, saveDoc, toast } from '../lib/state.js';
import { navigate } from '../lib/router.js';
import { TIMERS, GAME, matchScore, skillsScore } from '../lib/game.js';
import { Screen, Section, Seg, Stepper, Field, Switch, Empty } from '../components/ui.js';

const TOOLS = [
  { id: 'timer', name: 'Match timer', desc: 'V5RC & VIQRC timing with sounds', icon: 'timer' },
  { id: 'score', name: 'Score calculator', desc: 'Override match & skills scoring', icon: 'target' },
  { id: 'gear', name: 'Gear ratio', desc: 'Multi-stage ratio, speed, torque', icon: 'gears' },
  { id: 'drive', name: 'Drive speed', desc: 'Top speed from motor, gearing, wheels', icon: 'gauge' },
  { id: 'intake', name: 'Intake grip', desc: 'Roller surface speed & compression', icon: 'intake' },
  { id: 'arm', name: 'Arm output', desc: 'Torque, lift capacity, tip speed', icon: 'arm' },
  { id: 'predict', name: 'Match predictor', desc: 'Any 2v2 win probability', icon: 'sparkles', href: '#/predict' },
  { id: 'practice', name: 'Practice log', desc: 'Time and record practice runs', icon: 'video', href: '#/practice' }
];

// V5 Smart Motor (11 W): free speed / stall torque per cartridge. 5.5 W motor: 200 rpm, ~0.5 N·m stall.
export const MOTORS = [
  { id: 'red', label: '11W · 100 rpm', rpm: 100, torque: 2.1 },
  { id: 'green', label: '11W · 200 rpm', rpm: 200, torque: 1.05 },
  { id: 'blue', label: '11W · 600 rpm', rpm: 600, torque: 0.35 },
  { id: 'half', label: '5.5W · 200 rpm', rpm: 200, torque: 0.5 }
];
const motorById = (id) => MOTORS.find((m) => m.id === id) || MOTORS[2];

export function Tools() {
  return html`<${Screen} title="Robot tools" sub="Calculators and timers for the pits and the practice field">
    <div class="tool-grid">
      ${TOOLS.map((t) => html`<a class="tool-card" href=${t.href || `#/tools/${t.id}`}>
        <div class="ic"><${Icon} name=${t.icon} /></div>
        <div><h3>${t.name}</h3><p>${t.desc}</p></div>
      </a>`)}
    </div>
    <${Section} title="Game manual">
      <div class="list">
        <a class="row" href=${GAME.manualUrl} target="_blank" rel="noopener"><div class="avatar brand"><${Icon} name="book" /></div>
          <div class="row-main"><div class="row-title">V5RC Override game manual</div><div class="row-sub">manuals.vex.com · official rules</div></div><${Icon} name="external" class="chev" /></a>
        <a class="row" href="#/qa"><div class="avatar"><${Icon} name="info" /></div>
          <div class="row-main"><div class="row-title">Official Q&A</div><div class="row-sub">Search rulings by rule or keyword</div></div><${Icon} name="chevronRight" class="chev" /></a>
      </div>
    </${Section}>
  </${Screen}>`;
}

export function Tool({ params }) {
  const t = TOOLS.find((x) => x.id === params.tool);
  if (!t) return html`<${Screen} title="Tool" backTo="/tools"><${Empty} title="Unknown tool" /></${Screen}>`;
  const C = { timer: Timer, score: ScoreCalc, gear: GearCalc, drive: DriveCalc, intake: IntakeCalc, arm: ArmCalc }[t.id];
  return html`<${Screen} title=${t.name} sub=${t.desc} backTo="/tools"><div style="max-width:760px"><${C} /></div></${Screen}>`;
}

function Num({ label, value, onChange, step = 1, min = 0, suffix, hint }) {
  return html`<${Field} label=${label} hint=${hint}>
    <div class="input-row"><input class="input" type="number" inputmode="decimal" step=${step} min=${min} value=${value}
      onInput=${(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />${suffix && html`<span class="small muted nowrap">${suffix}</span>`}</div>
  </${Field}>`;
}

function MotorSelect({ value, onChange }) {
  return html`<${Field} label="Motor">
    <select class="select" value=${value} onChange=${(e) => onChange(e.target.value)}>
      ${MOTORS.map((m) => html`<option value=${m.id}>${m.label}</option>`)}
    </select></${Field}>`;
}

// ---------- Gear ratio ----------
function GearCalc() {
  const [motor, setMotor] = useState('blue');
  const [stages, setStages] = useState([{ a: 36, b: 48 }]);
  const m = motorById(motor);
  const ratio = stages.reduce((r, s) => r * ((s.b || 1) / (s.a || 1)), 1); // driven / driving
  const outRpm = m.rpm / ratio;
  const torque = m.torque * ratio;
  const upd = (i, k, v) => setStages(stages.map((s, j) => (j === i ? { ...s, [k]: v } : s)));
  return html`<div class="grid">
    <div class="card card-pad">
      <${MotorSelect} value=${motor} onChange=${setMotor} />
      <div class="eyebrow mt-16 mb-8">Gear stages (driving → driven)</div>
      ${stages.map((s, i) => html`<div class="input-row mb-8">
        <span class="small muted" style="width:56px">Stage ${i + 1}</span>
        <input class="input" type="number" inputmode="numeric" value=${s.a} aria-label="Driving teeth" onInput=${(e) => upd(i, 'a', Number(e.target.value))} />
        <${Icon} name="chevronRight" size="18" />
        <input class="input" type="number" inputmode="numeric" value=${s.b} aria-label="Driven teeth" onInput=${(e) => upd(i, 'b', Number(e.target.value))} />
        ${stages.length > 1 && html`<button class="btn-icon" aria-label="Remove stage" onClick=${() => setStages(stages.filter((_, j) => j !== i))}><${Icon} name="x" /></button>`}
      </div>`)}
      <button class="btn btn-sm" onClick=${() => setStages([...stages, { a: 12, b: 36 }])}><${Icon} name="plus" /> Add stage</button>
    </div>
    <div class="tiles">
      <div class="tile accent"><div class="tile-label">Ratio</div><div class="tile-value">${ratio >= 1 ? `${fmt(ratio, 3)}:1` : `1:${fmt(1 / ratio, 3)}`}</div><div class="tile-sub">${ratio > 1 ? 'torque (reduction)' : ratio < 1 ? 'speed (overdrive)' : 'direct'}</div></div>
      <div class="tile"><div class="tile-label">Output speed</div><div class="tile-value">${fmt(outRpm, 0)}</div><div class="tile-sub">rpm</div></div>
      <div class="tile"><div class="tile-label">Stall torque</div><div class="tile-value">${fmt(torque, 2)}</div><div class="tile-sub">N·m per motor</div></div>
    </div>
    <p class="tiny faint">Ideal values (no friction). Real mechanisms usually lose 10–20% per stage.</p>
  </div>`;
}

// ---------- Drive speed ----------
const WHEELS = [{ v: 2.75, l: '2.75"' }, { v: 3.25, l: '3.25"' }, { v: 4, l: '4"' }, { v: 4.125, l: '4" omni (4.125)' }];
function DriveCalc() {
  const [motor, setMotor] = useState('blue');
  const [a, setA] = useState(36);
  const [b, setB] = useState(48);
  const [wheel, setWheel] = useState(3.25);
  const [eff, setEff] = useState(85);
  const m = motorById(motor);
  const wheelRpm = m.rpm * (a / b);
  const inPerSec = (wheelRpm / 60) * Math.PI * wheel;
  const real = inPerSec * (eff / 100);
  const ftps = real / 12, mps = real * 0.0254;
  const across = real > 0 ? 144 / real : 0; // 12 ft field
  return html`<div class="grid">
    <div class="card card-pad">
      <${MotorSelect} value=${motor} onChange=${setMotor} />
      <div class="grid-2 mt-12">
        <${Num} label="Motor gear (driving)" value=${a} onChange=${setA} />
        <${Num} label="Wheel gear (driven)" value=${b} onChange=${setB} />
      </div>
      <div class="mt-12"><${Field} label="Wheel size"><${Seg} block options=${WHEELS.map((w) => ({ value: w.v, label: w.l.replace(' (4.125)', '') }))} value=${wheel} onChange=${setWheel} /></${Field}></div>
      <div class="mt-12"><${Num} label="Efficiency" value=${eff} onChange=${setEff} suffix="%" hint="Friction, weight and voltage sag — 80–90% is typical" /></div>
    </div>
    <div class="result">
      <div class="eyebrow">Top speed</div>
      <div class="result-big">${fmt(ftps, 2)}<small>ft/s</small></div>
      <div class="muted small">${fmt(mps, 2)} m/s · ${fmt(real, 1)} in/s · wheel ${fmt(wheelRpm, 0)} rpm</div>
    </div>
    <div class="tiles">
      <div class="tile"><div class="tile-label">Cross the field</div><div class="tile-value">${fmt(across, 2)}s</div><div class="tile-sub">12 ft at top speed</div></div>
      <div class="tile"><div class="tile-label">Theoretical</div><div class="tile-value">${fmt(inPerSec / 12, 2)}</div><div class="tile-sub">ft/s, 100% efficient</div></div>
      <div class="tile"><div class="tile-label">Effective rpm</div><div class="tile-value">${fmt(wheelRpm, 0)}</div><div class="tile-sub">at the wheel</div></div>
    </div>
  </div>`;
}

// ---------- Intake grip ----------
function IntakeCalc() {
  const [motor, setMotor] = useState('blue');
  const [ratio, setRatio] = useState(1);
  const [roller, setRoller] = useState(2.75);
  const [gap, setGap] = useState(2.5);
  const [obj, setObj] = useState(3);
  const [drive, setDrive] = useState(5);
  const m = motorById(motor);
  const rpm = m.rpm / (ratio || 1);
  const surface = (rpm / 60) * Math.PI * roller / 12; // ft/s
  const squeeze = obj > 0 ? Math.max(0, obj - gap) : 0;
  const comp = obj > 0 ? (squeeze / obj) * 100 : 0;
  const verdict = comp < 5 ? ['Loose', 'Objects may slip — close the gap or use flex wheels.', 'loss']
    : comp <= 20 ? ['Good grip', 'Firm hold without stalling the intake.', 'win']
    : comp <= 30 ? ['Tight', 'Strong grip, but watch for motor strain.', 'brand-text']
    : ['Too tight', 'Likely to stall or jam — open the gap.', 'loss'];
  return html`<div class="grid">
    <div class="card card-pad">
      <${MotorSelect} value=${motor} onChange=${setMotor} />
      <div class="grid-2 mt-12">
        <${Num} label="Reduction (motor : roller)" value=${ratio} step="0.1" onChange=${setRatio} suffix=":1" />
        <${Num} label="Roller / flex wheel diameter" value=${roller} step="0.25" onChange=${setRoller} suffix="in" />
        <${Num} label="Gap between rollers" value=${gap} step="0.1" onChange=${setGap} suffix="in" />
        <${Num} label="Game object size" value=${obj} step="0.1" onChange=${setObj} suffix="in" />
      </div>
      <div class="mt-12"><${Num} label="Robot drive speed" value=${drive} step="0.5" onChange=${setDrive} suffix="ft/s" hint="Surface speed should beat drive speed to intake on the move" /></div>
    </div>
    <div class="tiles">
      <div class="tile accent"><div class="tile-label">Compression</div><div class="tile-value">${fmt(comp, 0)}%</div><div class="tile-sub">${fmt(squeeze, 2)} in squeeze</div></div>
      <div class="tile"><div class="tile-label">Surface speed</div><div class="tile-value">${fmt(surface, 1)}</div><div class="tile-sub">ft/s at ${fmt(rpm, 0)} rpm</div></div>
      <div class="tile"><div class="tile-label">vs drive</div><div class="tile-value ${surface >= drive ? 'win' : 'loss'}">${drive ? fmt(surface / drive, 1) + '×' : '—'}</div><div class="tile-sub">${surface >= drive ? 'pulls in while driving' : 'slower than drive'}</div></div>
    </div>
    <div class="notice neutral"><${Icon} name="info" /><div><b class=${verdict[2]}>${verdict[0]}</b> — ${verdict[1]}</div></div>
  </div>`;
}

// ---------- Rotating arm ----------
function ArmCalc() {
  const [motor, setMotor] = useState('red');
  const [count, setCount] = useState(1);
  const [ratio, setRatio] = useState(5);
  const [len, setLen] = useState(12);
  const [arm, setArm] = useState(0.3);
  const [load, setLoad] = useState(0.5);
  const [eff, setEff] = useState(80);
  const m = motorById(motor);
  const g = 9.81, L = len * 0.0254;
  const outTorque = m.torque * count * ratio * (eff / 100); // N·m at stall
  const need = (load * L + arm * L / 2) * g; // horizontal worst case
  const maxLoad = Math.max(0, (outTorque / g - arm * L / 2) / L);
  const outRpm = m.rpm / ratio;
  const tipSpeed = (outRpm / 60) * 2 * Math.PI * L; // m/s
  const t90 = outRpm > 0 ? 15 / outRpm : 0; // seconds per 90° at free speed
  const margin = need > 0 ? outTorque / need : 0;
  return html`<div class="grid">
    <div class="card card-pad">
      <div class="grid-2">
        <${MotorSelect} value=${motor} onChange=${setMotor} />
        <${Field} label="Motors on the arm"><${Stepper} value=${count} min=${1} max=${8} onChange=${setCount} /></${Field}>
        <${Num} label="Gear reduction" value=${ratio} step="0.5" onChange=${setRatio} suffix=":1" />
        <${Num} label="Arm length (pivot → load)" value=${len} step="0.5" onChange=${setLen} suffix="in" />
        <${Num} label="Arm mass" value=${arm} step="0.05" onChange=${setArm} suffix="kg" />
        <${Num} label="Load at the tip" value=${load} step="0.05" onChange=${setLoad} suffix="kg" />
      </div>
      <div class="mt-12"><${Num} label="Efficiency" value=${eff} onChange=${setEff} suffix="%" /></div>
    </div>
    <div class="result">
      <div class="eyebrow">Holding margin (arm horizontal)</div>
      <div class="result-big ${margin >= 2 ? 'win' : margin >= 1.2 ? 'brand-text' : 'loss'}">${fmt(margin, 1)}×<small>${margin >= 2 ? 'comfortable' : margin >= 1.2 ? 'tight' : margin >= 1 ? 'barely holds' : 'will not lift'}</small></div>
      <div class="muted small">Needs ${fmt(need, 2)} N·m · available ${fmt(outTorque, 2)} N·m at stall. Aim for 2× so motors don't overheat.</div>
    </div>
    <div class="tiles">
      <div class="tile accent"><div class="tile-label">Max tip load</div><div class="tile-value">${fmt(maxLoad, 2)}</div><div class="tile-sub">kg at stall</div></div>
      <div class="tile"><div class="tile-label">Arm speed</div><div class="tile-value">${fmt(outRpm, 1)}</div><div class="tile-sub">rpm · ${fmt(t90, 2)} s per 90°</div></div>
      <div class="tile"><div class="tile-label">Tip speed</div><div class="tile-value">${fmt(tipSpeed, 2)}</div><div class="tile-sub">m/s (no load)</div></div>
    </div>
  </div>`;
}

// ---------- Override score calculator ----------
function AllianceCounters({ color, s, set, skills }) {
  const p = GAME.points;
  return html`<div class=${cx('alliance', color)}>
    <div class="alliance-head"><span class="alliance-name">${skills ? 'Skills run' : color}</span>
      <span class="alliance-score">${skills ? skillsScore(s) : matchScore(s, s.bonus)}</span></div>
    <div class="mt-8">
      <div class="counter"><span class="counter-label">${skills ? 'Red/blue pin halves' : 'Alliance pin halves'}<small>${p.allianceHalf} pts each</small></span><${Stepper} value=${s.halves} onChange=${(v) => set({ ...s, halves: v })} /></div>
      <div class="counter"><span class="counter-label">Owned yellow halves<small>${p.yellowHalf} pts each</small></span><${Stepper} value=${s.yellow} onChange=${(v) => set({ ...s, yellow: v })} /></div>
      <div class="counter"><span class="counter-label">Robots in Midfield<small>${p.midfield} pts each</small></span><${Stepper} value=${s.midfield} max=${skills ? 1 : 2} onChange=${(v) => set({ ...s, midfield: v })} /></div>
    </div>
  </div>`;
}

export function ScoreCalc({ onSave }) {
  const [mode, setMode] = useState('match');
  const empty = { halves: 0, yellow: 0, midfield: 0 };
  const [red, setRed] = useState(empty);
  const [blue, setBlue] = useState(empty);
  const [sk, setSk] = useState(empty);
  const [bonus, setBonus] = useState('none');
  const rb = bonus === 'red' ? 'win' : bonus === 'tie' ? 'tie' : 'none';
  const bb = bonus === 'blue' ? 'win' : bonus === 'tie' ? 'tie' : 'none';
  const rs = matchScore(red, rb), bs = matchScore(blue, bb);
  return html`<div>
    <${Seg} block options=${[{ value: 'match', label: 'Head-to-head' }, { value: 'skills', label: 'Robot skills' }]} value=${mode} onChange=${setMode} />
    ${mode === 'match' ? html`<div class="mt-16">
      <div class="alliances" style="grid-template-columns:1fr">
        <${AllianceCounters} color="red" s=${{ ...red, bonus: rb }} set=${(v) => setRed({ halves: v.halves, yellow: v.yellow, midfield: v.midfield })} />
        <${AllianceCounters} color="blue" s=${{ ...blue, bonus: bb }} set=${(v) => setBlue({ halves: v.halves, yellow: v.yellow, midfield: v.midfield })} />
      </div>
      <div class="card card-pad mt-12">
        <div class="eyebrow mb-8">Autonomous bonus (${GAME.points.autoBonus} pts, ${GAME.points.autoTie} each on a tie)</div>
        <${Seg} block options=${[{ value: 'red', label: 'Red' }, { value: 'tie', label: 'Tie' }, { value: 'blue', label: 'Blue' }, { value: 'none', label: 'None' }]} value=${bonus} onChange=${setBonus} />
      </div>
      <div class="result mt-12 center">
        <div class="eyebrow">Final score</div>
        <div class="result-big"><span class="red-text">${rs}</span> <span class="faint">–</span> <span class="blue-text">${bs}</span></div>
        <div class="small muted">${rs === bs ? 'Tie' : rs > bs ? `Red wins by ${rs - bs}` : `Blue wins by ${bs - rs}`}</div>
      </div>
    </div>` : html`<div class="mt-16">
      <${AllianceCounters} color="red" skills s=${sk} set=${setSk} />
      <p class="tiny faint mt-8">Skills: red halves only count in red quadrants or the Midfield, blue halves in blue quadrants or the Midfield; yellow halves count when Owned.</p>
    </div>`}
    <div class="btn-row mt-16">
      <button class="btn" onClick=${() => { setRed(empty); setBlue(empty); setSk(empty); setBonus('none'); }}><${Icon} name="reset" /> Reset</button>
      <button class="btn btn-primary" onClick=${async () => {
        const score = mode === 'match' ? rs : skillsScore(sk);
        await saveDoc({ type: 'practice', mode: mode === 'match' ? 'match' : 'skills', score, breakdown: mode === 'match' ? { red, blue, bonus } : sk, notes: '' });
        toast('Saved to practice log', { action: 'Open', onAction: () => navigate('/practice') });
      }}><${Icon} name="check" /> Log as practice run</button>
    </div>
    <p class="tiny faint mt-12">Scoring per the V5RC Override game manual: alliance-coloured pin half ${GAME.points.allianceHalf}, owned yellow pin half ${GAME.points.yellowHalf}, robot in Midfield ${GAME.points.midfield}, auton bonus ${GAME.points.autoBonus}.</p>
  </div>`;
}

// ---------- Match timer ----------
let audioCtx = null;
function beep(freq = 880, ms = 160, vol = 0.25) {
  if (!getState().settings.sound) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = 'square'; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + ms / 1000);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + ms / 1000 + 0.02);
  } catch (e) { /* audio blocked */ }
}
const buzz = (p) => { if (getState().settings.haptics && navigator.vibrate) navigator.vibrate(p); };

export function Timer({ compact, onFinish }) {
  const [preset, setPreset] = useState(TIMERS[0].id);
  const t = TIMERS.find((x) => x.id === preset);
  const [phase, setPhase] = useState(0);
  const [left, setLeft] = useState(t.phases[0].secs * 1000);
  const [state, setState] = useState('idle'); // idle | running | paused | hold | done
  const end = useRef(0);
  const lastWhole = useRef(null);
  const wake = useRef(null);
  const sound = useStore((s) => s.settings.sound);

  useEffect(() => { reset(); }, [preset]);
  useEffect(() => {
    if (state !== 'running') return;
    let raf;
    const loop = () => {
      const ms = Math.max(0, end.current - performance.now());
      setLeft(ms);
      const whole = Math.ceil(ms / 1000);
      if (whole !== lastWhole.current) {
        lastWhole.current = whole;
        const p = t.phases[phase];
        if (whole <= 3 && whole > 0) { beep(660, 110); }
        if (p.secs > 30 && whole === 30) { beep(990, 220); buzz(80); }
      }
      if (ms <= 0) {
        if (phase < t.phases.length - 1) {
          beep(440, 500); buzz([200, 100, 200]);
          const next = phase + 1;
          setPhase(next);
          setLeft(t.phases[next].secs * 1000);
          if (t.holdBetween) { setState('hold'); return; }
          end.current = performance.now() + t.phases[next].secs * 1000;
        } else {
          beep(330, 900, 0.3); buzz([400, 120, 400]);
          setState('done');
          onFinish && onFinish();
          releaseWake();
          return;
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [state, phase, preset]);
  useEffect(() => () => releaseWake(), []);

  async function holdWake() { try { if ('wakeLock' in navigator) wake.current = await navigator.wakeLock.request('screen'); } catch (e) { /* not allowed */ } }
  function releaseWake() { try { wake.current && wake.current.release(); } catch (e) { /* ignore */ } wake.current = null; }
  function start() {
    if (state === 'idle' || state === 'hold') beep(880, 260);
    end.current = performance.now() + left;
    lastWhole.current = null;
    setState('running');
    holdWake();
  }
  function pause() { setState('paused'); }
  function reset() { setPhase(0); setLeft(t.phases[0].secs * 1000); setState('idle'); releaseWake(); }

  const p = t.phases[phase];
  const secs = Math.ceil(left / 1000);
  const mm = Math.floor(secs / 60), ss = String(secs % 60).padStart(2, '0');
  const progress = 1 - left / (p.secs * 1000);
  return html`<div>
    ${!compact && html`<div class="chips chips-scroll">${TIMERS.map((x) => html`<button class=${cx('chip', x.id === preset && 'on')} onClick=${() => setPreset(x.id)}>${x.name}</button>`)}</div>`}
    <div class="timer">
      <div class=${cx('timer-phase', p.kind === 'auto' && 'auto')}>${state === 'done' ? 'Match over' : state === 'hold' ? `Next: ${p.name}` : p.name}</div>
      <div class=${cx('timer-digits', state === 'done' ? 'end' : secs <= 10 && state !== 'idle' ? 'warn' : '')}>${mm}:${ss}</div>
      <div class="timer-track"><div style=${`width:${Math.min(100, progress * 100)}%`}></div></div>
      <div class="btn-row" style="justify-content:center">
        ${state === 'running'
          ? html`<button class="btn btn-lg" style="min-width:150px" onClick=${pause}><${Icon} name="pause" /> Pause</button>`
          : state === 'done' ? null
          : html`<button class="btn btn-primary btn-lg" style="min-width:150px" onClick=${start}><${Icon} name="play" /> ${state === 'paused' ? 'Resume' : state === 'hold' ? 'Start driver' : 'Start'}</button>`}
        <button class="btn btn-lg" onClick=${reset}><${Icon} name="reset" /> Reset</button>
        <button class="btn-icon" style="width:50px;height:50px" aria-label=${sound ? 'Mute' : 'Unmute'} onClick=${() => import('../lib/state.js').then(({ updateSettings }) => updateSettings({ sound: !sound }))}>
          <${Icon} name=${sound ? 'volume' : 'volumeOff'} /></button>
      </div>
    </div>
    ${!compact && html`<p class="center small faint">${t.desc}${t.holdBetween ? ' · pauses after auton like a real field' : ''} · screen stays awake while running</p>`}
  </div>`;
}
