// All sound is synthesized with Web Audio graphs rendered ONCE at load through an
// OfflineAudioContext into AudioBuffers. Playing a sound is then just starting a buffer source,
// so a gunshot starts on the same frame as its muzzle flash (no decoding, no scheduling lag).
import { settings } from './settings.js';

const SR = 44100;

function makeNoise(len, seed = 1) {
  const buf = new AudioBuffer({ length: len, sampleRate: SR, numberOfChannels: 1 });
  const d = buf.getChannelData(0);
  let s = seed >>> 0;
  for (let i = 0; i < len; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    d[i] = (s / 4294967296) * 2 - 1;
  }
  return buf;
}

// Tiny graph helpers on an offline context -------------------------------------------------
function gainEnv(c, t0, attack, peak, decay, hold = 0) {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, 0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + Math.max(0.0005, attack));
  if (hold > 0) g.gain.setValueAtTime(peak, t0 + attack + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + hold + decay);
  return g;
}
function noiseSrc(c, noise, t0, dur, rate = 1) {
  const s = c.createBufferSource();
  s.buffer = noise; s.playbackRate.value = rate;
  s.start(t0, Math.random() * 0.5, dur + 0.05);
  return s;
}
function filt(c, type, freq, q = 0.7) {
  const f = c.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  return f;
}
function chain(...nodes) { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); return nodes[nodes.length - 1]; }

function noiseHit(c, noise, out, t0, { type = 'lowpass', freq = 2000, q = 0.7, attack = 0.001, peak = 1, decay = 0.1, hold = 0, rate = 1, freq2 = null, type2 = null, q2 = 0.7 }) {
  const src = noiseSrc(c, noise, t0, attack + hold + decay, rate);
  const f = filt(c, type, freq, q);
  const nodes = [src, f];
  if (type2) nodes.push(filt(c, type2, freq2, q2));
  const g = gainEnv(c, t0, attack, peak, decay, hold);
  nodes.push(g, out);
  chain(...nodes);
  return f;
}
function toneHit(c, out, t0, { type = 'sine', f0 = 200, f1 = 60, sweep = 0.08, attack = 0.001, peak = 1, decay = 0.1, hold = 0 }) {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + sweep);
  const g = gainEnv(c, t0, attack, peak, decay, hold);
  chain(o, g, out);
  o.start(t0); o.stop(t0 + attack + hold + decay + 0.05);
  return o;
}

// Gunshot recipe: crack + body + low thump + room/outdoor tail.
function gunshot(p) {
  return (c, noise, out) => {
    noiseHit(c, noise, out, 0, { type: 'highpass', freq: 2400, peak: p.crack, decay: p.crackDecay });
    noiseHit(c, noise, out, 0.0005, { type: 'lowpass', freq: p.bodyLP, q: 0.9, peak: p.body, decay: p.bodyDecay, type2: 'highpass', freq2: 180 });
    toneHit(c, out, 0, { f0: p.thump0, f1: p.thump1, sweep: p.thumpDecay * 0.8, peak: p.thump, decay: p.thumpDecay });
    noiseHit(c, noise, out, 0.012, { type: 'lowpass', freq: p.tailLP, attack: 0.02, peak: p.tail, decay: p.tailDecay, type2: 'highpass', freq2: 90 });
    if (p.mech) noiseHit(c, noise, out, p.mech, { type: 'bandpass', freq: 3200, q: 4, peak: 0.12, decay: 0.02 });
  };
}

function click(c, noise, out, t0, freq = 2600, peak = 0.7, tone = 1200) {
  noiseHit(c, noise, out, t0, { type: 'bandpass', freq, q: 3, peak, decay: 0.018 });
  toneHit(c, out, t0, { type: 'square', f0: tone, f1: tone * 0.7, sweep: 0.012, peak: peak * 0.18, decay: 0.014 });
}

const RECIPES = {
  smg: [0.42, gunshot({ crack: 0.9, crackDecay: 0.022, bodyLP: 2900, body: 0.95, bodyDecay: 0.075, thump0: 160, thump1: 52, thump: 0.8, thumpDecay: 0.06, tailLP: 900, tail: 0.18, tailDecay: 0.3, mech: 0.03 })],
  rifle: [0.7, gunshot({ crack: 1.0, crackDecay: 0.03, bodyLP: 2300, body: 1.0, bodyDecay: 0.12, thump0: 130, thump1: 42, thump: 0.95, thumpDecay: 0.1, tailLP: 800, tail: 0.25, tailDecay: 0.5, mech: 0.05 })],
  shotgun: [1.0, gunshot({ crack: 0.85, crackDecay: 0.04, bodyLP: 1500, body: 1.0, bodyDecay: 0.22, thump0: 95, thump1: 34, thump: 1.0, thumpDecay: 0.18, tailLP: 650, tail: 0.32, tailDecay: 0.75 })],
  pistol: [0.45, gunshot({ crack: 1.0, crackDecay: 0.02, bodyLP: 3300, body: 0.85, bodyDecay: 0.06, thump0: 190, thump1: 70, thump: 0.6, thumpDecay: 0.05, tailLP: 1000, tail: 0.16, tailDecay: 0.32, mech: 0.035 })],
  sniper: [1.1, gunshot({ crack: 1.0, crackDecay: 0.035, bodyLP: 2000, body: 1.0, bodyDecay: 0.16, thump0: 110, thump1: 38, thump: 1.0, thumpDecay: 0.12, tailLP: 700, tail: 0.34, tailDecay: 0.85 })],
  pump: [0.5, (c, n, o) => {
    click(c, n, o, 0.0, 1800, 0.8, 700);
    noiseHit(c, n, o, 0.02, { type: 'bandpass', freq: 1300, q: 1.5, attack: 0.02, peak: 0.25, decay: 0.08 });
    click(c, n, o, 0.19, 2400, 0.9, 900);
    noiseHit(c, n, o, 0.2, { type: 'bandpass', freq: 1000, q: 1.2, attack: 0.01, peak: 0.2, decay: 0.08 });
  }],
  magOut: [0.2, (c, n, o) => { click(c, n, o, 0, 1500, 0.6, 500); noiseHit(c, n, o, 0.01, { type: 'bandpass', freq: 800, q: 1, peak: 0.25, decay: 0.08 }); }],
  magIn: [0.25, (c, n, o) => { click(c, n, o, 0, 2000, 0.9, 600); click(c, n, o, 0.05, 3000, 0.5, 1500); }],
  bolt: [0.35, (c, n, o) => { click(c, n, o, 0, 2200, 0.8, 800); click(c, n, o, 0.13, 2800, 0.9, 1000); }],
  shellIn: [0.18, (c, n, o) => { click(c, n, o, 0, 1700, 0.75, 450); noiseHit(c, n, o, 0.005, { type: 'lowpass', freq: 700, peak: 0.3, decay: 0.05 }); }],
  slideRack: [0.3, (c, n, o) => { click(c, n, o, 0, 2600, 0.8, 900); click(c, n, o, 0.1, 3200, 0.9, 1300); }],
  empty: [0.1, (c, n, o) => { click(c, n, o, 0, 3500, 0.7, 1600); }],
  whiz: [0.4, (c, n, o) => {
    const src = noiseSrc(c, n, 0, 0.4);
    const f = filt(c, 'bandpass', 3600, 6);
    f.frequency.setValueAtTime(4200, 0); f.frequency.exponentialRampToValueAtTime(700, 0.34);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, 0); g.gain.exponentialRampToValueAtTime(0.9, 0.11); g.gain.exponentialRampToValueAtTime(0.0001, 0.36);
    chain(src, f, g, o);
    const osc = c.createOscillator(); osc.type = 'sine';
    osc.frequency.setValueAtTime(2100, 0); osc.frequency.exponentialRampToValueAtTime(900, 0.3);
    const g2 = c.createGain();
    g2.gain.setValueAtTime(0.0001, 0); g2.gain.exponentialRampToValueAtTime(0.12, 0.1); g2.gain.exponentialRampToValueAtTime(0.0001, 0.32);
    chain(osc, g2, o); osc.start(0); osc.stop(0.38);
  }],
  impact: [0.2, (c, n, o) => {
    noiseHit(c, n, o, 0, { type: 'lowpass', freq: 2000, peak: 0.9, decay: 0.05 });
    noiseHit(c, n, o, 0, { type: 'highpass', freq: 4000, peak: 0.5, decay: 0.015 });
    toneHit(c, o, 0, { f0: 320, f1: 120, sweep: 0.03, peak: 0.35, decay: 0.04 });
    noiseHit(c, n, o, 0.02, { type: 'bandpass', freq: 5000, q: 2, peak: 0.12, decay: 0.08 }); // grit
  }],
  impactMetal: [0.35, (c, n, o) => {
    noiseHit(c, n, o, 0, { type: 'highpass', freq: 3000, peak: 0.7, decay: 0.02 });
    toneHit(c, o, 0, { f0: 1900, f1: 1850, peak: 0.25, decay: 0.25 });
    toneHit(c, o, 0, { f0: 2870, f1: 2800, peak: 0.12, decay: 0.18 });
  }],
  flesh: [0.25, (c, n, o) => {
    noiseHit(c, n, o, 0, { type: 'lowpass', freq: 650, q: 1.2, peak: 1, decay: 0.1 });
    toneHit(c, o, 0, { f0: 110, f1: 55, sweep: 0.06, peak: 0.7, decay: 0.09 });
    noiseHit(c, n, o, 0.015, { type: 'bandpass', freq: 1400, q: 2, peak: 0.2, decay: 0.07 });
  }],
  headshot: [0.3, (c, n, o) => {
    noiseHit(c, n, o, 0, { type: 'lowpass', freq: 900, peak: 0.9, decay: 0.08 });
    toneHit(c, o, 0, { type: 'triangle', f0: 2500, f1: 2300, sweep: 0.02, peak: 0.45, decay: 0.11 });
    toneHit(c, o, 0.0, { f0: 140, f1: 50, sweep: 0.05, peak: 0.7, decay: 0.08 });
  }],
  hurt: [0.45, (c, n, o) => {
    toneHit(c, o, 0, { f0: 90, f1: 38, sweep: 0.15, peak: 1, decay: 0.3 });
    noiseHit(c, n, o, 0, { type: 'lowpass', freq: 400, peak: 0.7, decay: 0.2 });
  }],
  step: [0.12, (c, n, o) => {
    noiseHit(c, n, o, 0, { type: 'lowpass', freq: 800, peak: 0.6, decay: 0.05, type2: 'highpass', freq2: 120 });
    noiseHit(c, n, o, 0.004, { type: 'bandpass', freq: 3000, q: 2, peak: 0.12, decay: 0.02 });
  }],
  land: [0.3, (c, n, o) => {
    noiseHit(c, n, o, 0, { type: 'lowpass', freq: 500, peak: 0.9, decay: 0.12 });
    toneHit(c, o, 0, { f0: 80, f1: 45, sweep: 0.08, peak: 0.6, decay: 0.12 });
  }],
  jump: [0.15, (c, n, o) => { noiseHit(c, n, o, 0, { type: 'bandpass', freq: 900, q: 0.8, attack: 0.02, peak: 0.25, decay: 0.08 }); }],
  doorOpen: [0.75, (c, n, o) => {
    click(c, n, o, 0, 2200, 0.6, 700);
    const osc = c.createOscillator(); osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, 0.06);
    const lfo = c.createOscillator(); lfo.frequency.value = 23;
    const lg = c.createGain(); lg.gain.value = 26;
    lfo.connect(lg); lg.connect(osc.frequency);
    osc.frequency.linearRampToValueAtTime(230, 0.55);
    const f = filt(c, 'bandpass', 1100, 3);
    const g = gainEnv(c, 0.06, 0.08, 0.2, 0.45, 0.1);
    chain(osc, f, g, o);
    osc.start(0.06); osc.stop(0.72); lfo.start(0.06); lfo.stop(0.72);
    noiseHit(c, n, o, 0.05, { type: 'bandpass', freq: 600, q: 0.8, attack: 0.1, peak: 0.12, decay: 0.4 });
  }],
  doorClose: [0.45, (c, n, o) => {
    noiseHit(c, n, o, 0, { type: 'bandpass', freq: 700, q: 0.7, attack: 0.06, peak: 0.12, decay: 0.2 });
  }],
  doorLatch: [0.3, (c, n, o) => {
    noiseHit(c, n, o, 0, { type: 'lowpass', freq: 500, peak: 1, decay: 0.12 });
    toneHit(c, o, 0, { f0: 95, f1: 50, sweep: 0.06, peak: 0.6, decay: 0.12 });
    click(c, n, o, 0.02, 2600, 0.6, 900);
  }],
  pickup: [0.45, (c, n, o) => {
    click(c, n, o, 0, 2400, 0.7, 800); click(c, n, o, 0.08, 3000, 0.6, 1100); click(c, n, o, 0.16, 2000, 0.8, 700);
    toneHit(c, o, 0.16, { f0: 1250, f1: 1240, peak: 0.08, decay: 0.2 });
  }],
  bodyFall: [0.5, (c, n, o) => {
    noiseHit(c, n, o, 0, { type: 'lowpass', freq: 380, peak: 1, decay: 0.2 });
    toneHit(c, o, 0, { f0: 70, f1: 38, sweep: 0.12, peak: 0.8, decay: 0.2 });
    noiseHit(c, n, o, 0.18, { type: 'lowpass', freq: 300, peak: 0.5, decay: 0.12 });
  }],
  alert: [0.3, (c, n, o) => {
    toneHit(c, o, 0, { type: 'triangle', f0: 660, f1: 660, peak: 0.25, decay: 0.07, hold: 0.03 });
    toneHit(c, o, 0.09, { type: 'triangle', f0: 990, f1: 990, peak: 0.25, decay: 0.12, hold: 0.03 });
  }],
  uiClick: [0.1, (c, n, o) => { toneHit(c, o, 0, { type: 'square', f0: 900, f1: 600, sweep: 0.03, peak: 0.18, decay: 0.05 }); }],
  uiHover: [0.06, (c, n, o) => { toneHit(c, o, 0, { type: 'sine', f0: 1500, f1: 1400, peak: 0.08, decay: 0.03 }); }],
  styleSwap: [0.35, (c, n, o) => {
    toneHit(c, o, 0, { type: 'square', f0: 440, f1: 440, peak: 0.12, decay: 0.07 });
    toneHit(c, o, 0.08, { type: 'square', f0: 660, f1: 660, peak: 0.12, decay: 0.2 });
  }],
  win: [2.2, (c, n, o) => {
    const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5];
    notes.forEach((f, i) => toneHit(c, o, i * 0.14, { type: 'triangle', f0: f, f1: f, peak: 0.28, decay: i === notes.length - 1 ? 1.3 : 0.25, hold: 0.04 }));
    toneHit(c, o, 0.7, { type: 'sine', f0: 261.6, f1: 261.6, peak: 0.2, decay: 1.4, hold: 0.1 });
  }],
  death: [3.2, (c, n, o) => {
    toneHit(c, o, 0, { type: 'sawtooth', f0: 110, f1: 46, sweep: 2.2, attack: 0.05, peak: 0.2, decay: 2.8 });
    toneHit(c, o, 0, { type: 'sine', f0: 55, f1: 40, sweep: 2.0, attack: 0.05, peak: 0.5, decay: 2.8 });
    noiseHit(c, n, o, 0, { type: 'lowpass', freq: 300, attack: 0.3, peak: 0.25, decay: 2.5 });
  }],
};

export class Audio {
  constructor() {
    this.ok = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext) && typeof OfflineAudioContext !== 'undefined';
    this.buffers = {};
    this.ready = Promise.resolve();
    this.voices = 0;
    if (!this.ok) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    this.master = this.ctx.createGain();
    this.sfx = this.ctx.createGain();
    this.ui = this.ctx.createGain();
    this.sfx.connect(this.master); this.ui.connect(this.master);
    // gentle limiter so SMG bursts + enemies don't clip
    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -10; this.comp.knee.value = 8; this.comp.ratio.value = 6;
    this.comp.attack.value = 0.002; this.comp.release.value = 0.15;
    this.master.connect(this.comp); this.comp.connect(this.ctx.destination);
    this.applyVolumes();
    this.ready = this._renderAll();
  }

  async _renderAll() {
    const noise = makeNoise(SR * 2, 7);
    const t0 = performance.now();
    await Promise.all(Object.entries(RECIPES).map(async ([name, [dur, fn]]) => {
      try {
        const c = new OfflineAudioContext(1, Math.ceil(dur * SR), SR);
        const out = c.createGain();
        out.connect(c.destination);
        fn(c, noise, out);
        const buf = await c.startRendering();
        normalize(buf, name === 'uiHover' || name === 'uiClick' ? 0.5 : 0.92);
        this.buffers[name] = buf;
      } catch (e) {
        console.warn('sound render failed', name, e);
      }
    }));
    this.renderMs = performance.now() - t0;
  }

  applyVolumes() {
    if (!this.ok) return;
    this.master.gain.value = settings.masterVolume;
    this.sfx.gain.value = settings.sfxVolume;
    this.ui.gain.value = settings.uiVolume;
  }

  resume() { if (this.ok && this.ctx.state !== 'running') this.ctx.resume().catch(() => {}); }

  play(name, o = {}) {
    if (!this.ok) return;
    const buf = this.buffers[name];
    if (!buf || this.voices > 48) return;
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = (o.rate || 1) * (o.jitter ? 1 + (Math.random() - 0.5) * o.jitter : 1);
    let node = src;
    if (o.lowpass) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lowpass; node.connect(f); node = f; }
    const g = c.createGain();
    g.gain.value = o.gain ?? 1;
    node.connect(g); node = g;
    if (o.pan) { const p = c.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, o.pan)); node.connect(p); node = p; }
    node.connect(o.bus === 'ui' ? this.ui : this.sfx);
    this.voices++;
    src.onended = () => { this.voices--; };
    src.start(o.delay ? c.currentTime + o.delay : 0);
  }

  // Positional: distance falloff, stereo pan from the listener's yaw, walls muffle and quieten.
  playAt(name, x, y, z, L, o = {}) {
    if (!this.ok) return;
    const dx = x - L.x, dy = y - L.y, dz = z - L.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const ref = o.ref || 6;
    let gain = (o.gain ?? 1) * Math.min(1, ref / Math.max(ref, d)) ** 1.1;
    const walls = o.walls || 0;
    let lowpass = d > 40 ? 5000 - Math.min(3500, (d - 40) * 60) : 0;
    if (walls > 0) { gain *= Math.pow(0.45, walls); lowpass = Math.min(lowpass || 20000, 1400 / walls); }
    if (gain < 0.004) return;
    const rx = Math.cos(L.yaw), rz = -Math.sin(L.yaw);
    const pan = d > 0.01 ? ((dx * rx + dz * rz) / d) * 0.85 : 0;
    this.play(name, { gain, pan, lowpass: lowpass || 0, rate: o.rate, jitter: o.jitter ?? 0.06 });
  }
}

function normalize(buf, peak) {
  const d = buf.getChannelData(0);
  let m = 0;
  for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > m) m = a; }
  if (m < 1e-6) return;
  const k = peak / m;
  for (let i = 0; i < d.length; i++) d[i] *= k;
  // 3 ms fade out at the very end to avoid a click
  const f = Math.min(d.length, 132);
  for (let i = 0; i < f; i++) d[d.length - 1 - i] *= i / f;
}
