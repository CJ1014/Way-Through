// Entry point: renderer, main loop, menu/pause/pointer-lock flow, style previews, test API.
import * as THREE from '../vendor/three/three.module.js';
import { Materials } from './materials.js';
import { ViewModel } from './viewmodel.js';
import { Audio } from './audio.js';
import { Game } from './game.js';
import { UI } from './ui.js';
import { Input } from './input.js';
import { settings } from './settings.js';
import { Autopilot } from './autopilot.js';
import { CAMERA_SHOTS } from './world.js';
import { WEAPONS } from './weapons.js';

const params = new URLSearchParams(location.search);
const app = document.getElementById('app');

function fatal(msg) {
  app.innerHTML = `<div class="cardwrap"><div class="card"><div class="hand big">No way through.</div><p>${msg}</p></div></div>`;
}

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: params.has('test') });
} catch (e) {
  fatal('WebGL could not start in this browser (' + (e && e.message) + ').');
  throw e;
}
renderer.autoClear = false;
renderer.info.autoReset = false;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.BasicShadowMap; // hard sun shadows
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0xffffff, 1);
renderer.domElement.id = 'gl';
app.prepend(renderer.domElement);

const materials = new Materials();
const vm = new ViewModel(materials);
const audio = new Audio();

// HUD proxy: the Game talks to the UI through this until the UI exists.
let ui = null;
const hud = new Proxy({}, { get: (_, k) => (...a) => (ui && typeof ui[k] === 'function' ? ui[k](...a) : undefined) });
const game = new Game({ vm, audio, hud });
let bot = params.has('autopilot') ? new Autopilot(game) : null;
if (params.has('god')) game.god = true;

// ------------------------------------------------------------------ flow
let resumeWanted = false;

function pauseGame() {
  if (game.state !== 'playing') return;
  game.state = 'paused';
  input.clear();
  input.active = false;
  ui.showPause(true);
}

function doResume() {
  resumeWanted = false;
  if (game.state !== 'paused') return;
  game.state = 'playing';
  ui.showPause(false);
  ui.clickResume.classList.add('hidden');
  input.clear();
  input.active = true;
}

function resume() {
  if (game.state !== 'paused') return;
  audio.resume();
  if (input.fallback || bot) { doResume(); return; }
  resumeWanted = true;
  input.requestLock().then((ok) => {
    if (ok || input.locked) doResume();
    else if (input.fallback) doResume();
    else showClickToResume();
  });
}

function showClickToResume() {
  // browser refused the re-lock (too soon after Esc): stay paused, ask for a click
  if (game.state !== 'paused') return;
  ui.showPause(false);
  ui.clickResume.classList.remove('hidden');
}

function startRun() {
  audio.resume();
  if (!input.fallback && !bot) input.requestLock(); // inside the click handler
  game.newRun();
  ui.hideCards();
  ui.showMain(false);
  ui.showPause(false);
  ui.showHud(true);
  input.clear();
  input.active = true;
}

function respawnRun() {
  audio.resume();
  if (!input.fallback && !bot) input.requestLock(); // inside the click handler
  game.respawn();
  ui.hideCards();
  ui.showHud(true);
  input.clear();
  input.active = true;
}

function mainMenu() {
  game.state = 'menu';
  input.active = false;
  input.exitLock();
  ui.showPause(false);
  ui.hideCards();
  ui.showHud(false);
  ui.showMain(true);
}

const input = new Input(renderer.domElement, {
  onUnlock: () => { if (game.state === 'playing' && !bot) pauseGame(); },
  onLock: () => { if (resumeWanted) doResume(); },
  onEscape: () => {
    if (game.state === 'playing') pauseGame();
    else if (game.state === 'paused' && ui.pause.classList.contains('hidden') === false) resume();
  },
  onRelockRefused: () => { if (game.state === 'paused' || resumeWanted) showClickToResume(); },
  onFallback: () => {
    ui.toast('Pointer lock unavailable — using plain mouse look');
    if (resumeWanted) doResume();
  },
  onKey: (code) => {
    if (code === 'KeyV' && game.state !== 'menu') game.toggleStyle();
  },
});

ui = new UI(game, {
  play: () => startRun(),
  resume: () => resume(),
  restart: () => startRun(),
  respawn: () => respawnRun(),
  mainMenu,
  setStyle: (s) => game.applyStyle(s),
  settingsChanged: (k) => { audio.applyVolumes(); if (k === 'quality' || k === '*') resize(); },
  uiSound: (n) => audio.play(n, { bus: 'ui', gain: n === 'uiHover' ? 0.45 : 0.8 }),
  releaseMouse: () => { input.active = false; input.exitLock(); },
});
ui.styleChanged(game.style);
ui.showMain(true);
ui.showHud(false);

// ------------------------------------------------------------------ sizing / quality
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  const q = settings.quality;
  const pr = q === 'low' ? 0.7 : q === 'medium' ? 1 : Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h);
  game.camera.aspect = w / h;
  game.camera.updateProjectionMatrix();
  vm.setAspect(w / h);
  materials.setResolution(w, h);
  const size = q === 'low' ? 1024 : 2048;
  if (game.sun.shadow.mapSize.x !== size) {
    game.sun.shadow.mapSize.set(size, size);
    if (game.sun.shadow.map) { game.sun.shadow.map.dispose(); game.sun.shadow.map = null; }
  }
}
window.addEventListener('resize', resize);
resize();

// ------------------------------------------------------------------ style previews
// Rendered from the game itself: the canteen, in both styles, with the gun in hand.
function renderPreviews() {
  const W = 640, H = 360;
  const rt = new THREE.WebGLRenderTarget(W, H, { samples: 4 });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const out = {};
  const keepStyle = game.style;
  const keepState = game.state;
  const cam = game.camera;
  const saved = { pos: cam.position.clone(), q: cam.quaternion.clone(), fov: cam.fov, aspect: cam.aspect };
  cam.fov = 62; cam.aspect = W / H; cam.updateProjectionMatrix();
  vm.setAspect(W / H);
  vm.update(0.016, { ads: false, sprint: false, bobPhase: 0, bobAmt: 0, viewBob: false, lookDX: 0, lookDY: 0, landKick: 0, alive: true, crouch: false, reloading: false, reloadP: 0, pumpP: -1 });
  materials.setResolution(W, H);
  const pix = new Uint8Array(W * H * 4);
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const c2 = canvas.getContext('2d');
  for (const style of ['classic', 'neo']) {
    materials.apply(style, game.scene);
    game.sky.visible = style === 'neo';
    game.setShot('preview');
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = style === 'neo';
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(game.scene, cam);
    renderer.clearDepth();
    renderer.render(vm.scene, vm.camera);
    renderer.readRenderTargetPixels(rt, 0, 0, W, H, pix);
    const img = c2.createImageData(W, H);
    for (let y = 0; y < H; y++) img.data.set(pix.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
    c2.putImageData(img, 0, 0);
    out[style] = canvas.toDataURL('image/jpeg', 0.88);
  }
  renderer.setRenderTarget(null);
  rt.dispose();
  game.applyStyle(keepStyle, false);
  game.state = keepState;
  cam.position.copy(saved.pos); cam.quaternion.copy(saved.q); cam.fov = saved.fov; cam.aspect = saved.aspect; cam.updateProjectionMatrix();
  vm.setAspect(saved.aspect);
  resize();
  ui.setPreviews(out);
  return out;
}

// ------------------------------------------------------------------ loop
let last = performance.now();
let ff = Number(params.get('ff') || 1);
let renderEvery = 1;
let frames = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  let inp = input.frame();
  if (bot && game.state === 'playing') inp = bot.input(Math.min(dt, 0.05));
  const steps = game.state === 'playing' ? ff : 1;
  for (let i = 0; i < steps; i++) game.update(dt, i === 0 ? inp : Object.assign({}, inp, { lookDX: 0, lookDY: 0, jump: false, interact: false, reload: false }));
  game.updateViewModel(dt, inp);
  // renderEvery > 1 is a test hook: CPU-only browsers (SwiftShader) render so slowly that a
  // full-route run would take an hour; the simulation still runs every frame.
  if (frames % renderEvery === 0) game.render(renderer);
  ui.frame(dt, renderer);
  frames++;
  if (frames === 3) {
    try { renderPreviews(); } catch (e) { console.warn('preview render failed', e); }
  }
}
requestAnimationFrame(frame);

// ------------------------------------------------------------------ test / debug API
window.__oneshot = {
  THREE, game, renderer, ui, input, materials, audio, vm, WEAPONS,
  snapshot: () => game.snapshot(),
  setStyle: (s) => game.applyStyle(s),
  toggleStyle: () => game.toggleStyle(),
  start: () => startRun(),
  respawn: () => respawnRun(),
  pause: () => pauseGame(),
  resume: () => doResume(),
  mainMenu,
  teleport: (x, y, z, yaw = game.player.yaw, pitch = 0) => { const p = game.player; p.pos.x = x; p.pos.y = y; p.pos.z = z; p.yaw = yaw; p.pitch = pitch; p.vel.x = p.vel.y = p.vel.z = 0; },
  autopilot: (on = true, opts = {}) => { bot = on ? new Autopilot(game, opts) : null; return !!bot; },
  bot: () => bot,
  setFF: (n) => { ff = n; },
  setRenderEvery: (n) => { renderEvery = Math.max(1, n | 0); },
  renderNow: () => game.render(renderer),
  capture: () => { game.updateViewModel(0.016, {}); game.render(renderer); return renderer.domElement.toDataURL('image/jpeg', 0.85); },
  previews: () => renderPreviews(),
  calls: () => renderer.info.render.calls,
  shot: (name) => { game.setShot(name); game.render(renderer); return renderer.domElement.toDataURL('image/png'); },
  audioReady: () => audio.ready.then(() => Object.keys(audio.buffers).length),
};
