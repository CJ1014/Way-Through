// Game state + simulation. Rendering-agnostic enough to run headless in Node for tests
// (renderer, view-model, audio and HUD are optional).
import * as THREE from '../vendor/three/three.module.js';
import { Materials } from './materials.js';
import { buildWorld, WIN_ZONE, CAMERA_SHOTS } from './world.js';
import { Player, P } from './player.js';
import { EnemyManager } from './enemies.js';
import { Effects } from './effects.js';
import { WEAPONS, DIFFICULTY } from './weapons.js';
import { F_BULLET } from './collision.js';
import { _doorHit } from './doors.js';
import { settings, loadStyle, saveStyle, loadBest, saveBest } from './settings.js';
import { clamp, damp, segSegDist2, rand } from './util.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const NOOP_HUD = new Proxy({}, { get: () => () => {} });
const NOOP_AUDIO = { play() {}, playAt() {}, resume() {}, applyVolumes() {}, ready: Promise.resolve() };

export class Game {
  constructor({ vm = null, audio = null, hud = null, headless = false } = {}) {
    this.headless = headless;
    this.vm = vm;
    this.audio = audio || NOOP_AUDIO;
    this.hud = hud || NOOP_HUD;
    this.materials = vm ? vm.materials : new Materials();
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#ffffff');
    this.scene.fog = new THREE.Fog('#ffffff', 22, 105);
    this.camera = new THREE.PerspectiveCamera(settings.fov, 16 / 9, 0.05, 700);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    this.W = buildWorld(this.materials, this.scene);
    this.world = this.W.world;
    this.doors = this.W.doors;
    this.nav = this.W.nav;
    for (const d of this.doors) d.onSound = (name, door) => this._doorSound(name, door);

    this.player = new Player();
    this.fx = new Effects(this.scene, this.materials, this.world);
    this.enemies = new EnemyManager(this, this.W.spawns);
    this.bullets = [];
    this.listener = { x: 0, y: 0, z: 0, yaw: 0 };

    this._lights();
    this._sky();

    this.state = 'menu';
    this.time = 0;
    this.style = loadStyle();
    this.applyStyle(this.style, false);
    this.newRun();
    this.state = 'menu';
    this.orbitA = 0.6;
    this.god = false;
  }

  get diff() { return DIFFICULTY[settings.difficulty] || DIFFICULTY.normal; }

  _lights() {
    this.hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 0.35);
    this.scene.add(this.hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.65);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const c = sun.shadow.camera;
    c.left = -48; c.right = 48; c.top = 48; c.bottom = -48; c.near = 1; c.far = 220;
    sun.shadow.bias = -0.0009;
    sun.shadow.normalBias = 0.07;
    this.sunOffset = new THREE.Vector3(38, 80, 22);
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;
  }

  _sky() {
    const g = new THREE.SphereGeometry(450, 32, 16);
    this.sky = new THREE.Mesh(g, this.materials.sky);
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.sky.name = 'sky';
    this.scene.add(this.sky);
  }

  // Recolour in place. Nothing in the simulation is touched.
  applyStyle(style, save = true) {
    this.style = style === 'neo' ? 'neo' : 'classic';
    const p = this.materials.apply(this.style, this.scene);
    this.sky.visible = !!p.sky;
    this.shadowsLive = this.style === 'neo';
    if (save) saveStyle(this.style);
    if (typeof document !== 'undefined') document.body.dataset.style = this.style;
    this.hud.styleChanged(this.style);
  }

  toggleStyle() {
    this.applyStyle(this.style === 'neo' ? 'classic' : 'neo');
    this.audio.play('styleSwap', { bus: 'ui', gain: 0.6 });
    this.hud.toast(this.style === 'neo' ? 'Style: Neobrutalist' : 'Style: Classic');
  }

  // ------------------------------------------------------------------ run lifecycle
  newRun() {
    const s = this.W.playerStart;
    this.player.reset(s);
    for (const d of this.doors) d.reset();
    this.enemies.reset();
    this.fx.reset();
    this.bullets.length = 0;
    this.gun = { type: 'smg', mag: WEAPONS.smg.mag, reserve: WEAPONS.smg.reserve, cd: 0, reloading: false, reloadT: 0, reloadDur: 0, pumpT: -1, bloom: 0, triggerHeld: false, reloadEvents: [] };
    this.stats = { time: 0, kills: 0, headshots: 0, shots: 0, hits: 0 };
    this.time = 0;
    this.lastPlayerShot = -99;
    this.recoilP = 0; this.recoilY = 0; this.shake = 0; this.deathT = 0; this.hitFlash = 0;
    this.adsT = 0;
    this.sprintBlockT = 0;
    this.fireHeldPrev = false;
    if (this.vm) { this.vm.resetAnim(); this.vm.setGun('smg', true); }
    this.hud.ammo(this.gun.mag, this.gun.reserve, WEAPONS.smg.name);
    this.hud.prompt(null);
    this.hud.hideCards();
    this.state = 'playing';
    this.won = false;
    this._updateCamera(0);
  }

  // ------------------------------------------------------------------ queries used by AI
  // Static world + doors. Returns { t, x,y,z, nx,ny,nz, static, door } or null.
  raycastWorld(ox, oy, oz, dx, dy, dz, maxT) {
    const h = this.world.raycast(ox, oy, oz, dx, dy, dz, maxT, F_BULLET);
    let best = null;
    let bt = maxT;
    if (h) { bt = h.t; best = { t: h.t, x: h.x, y: h.y, z: h.z, nx: h.nx, ny: h.ny, nz: h.nz, static: true, door: null, box: h.box }; }
    for (const d of this.doors) {
      const t = d.raycast(ox, oy, oz, dx, dy, dz, bt);
      if (t >= 0 && t < bt) {
        bt = t;
        best = { t, x: ox + dx * t, y: oy + dy * t, z: oz + dz * t, nx: _doorHit.nx, ny: _doorHit.ny, nz: _doorHit.nz, static: false, door: d, box: null };
      }
    }
    return best;
  }

  lineClear(ax, ay, az, bx, by, bz) {
    let dx = bx - ax, dy = by - ay, dz = bz - az;
    const l = Math.hypot(dx, dy, dz);
    if (l < 1e-4) return true;
    dx /= l; dy /= l; dz /= l;
    return !this.raycastWorld(ax, ay, az, dx, dy, dz, l - 0.05);
  }

  doorsBetween(ax, ay, az, bx, by, bz) {
    let dx = bx - ax, dy = by - ay, dz = bz - az;
    const l = Math.hypot(dx, dy, dz);
    if (l < 1e-4) return 0;
    dx /= l; dy /= l; dz /= l;
    let n = 0;
    for (const d of this.doors) if (d.raycast(ax, ay, az, dx, dy, dz, l) >= 0) n++;
    return n;
  }

  doorBetweenXZ(a, b) {
    let dx = b.x - a.x, dz = b.z - a.z;
    const l = Math.hypot(dx, dz);
    if (l < 1e-4) return false;
    dx /= l; dz /= l;
    const y = Math.min(a.y, b.y) + 1.0;
    for (const d of this.doors) {
      if (d.openAmount > 0.6) continue;
      if (d.raycast(a.x, y, a.z, dx, 0, dz, l) >= 0) return true;
    }
    return false;
  }

  onDoorNoise(door) {
    const c = door.centre(_v3);
    this.enemies.noise(c.x, c.y + 1, c.z, 0.35, 9, 'door');
  }

  _doorSound(name, door) {
    const c = door.centre(_v3);
    this.audio.playAt(name, c.x, c.y + 1.1, c.z, this.listener, { gain: name === 'doorLatch' ? 0.7 : 0.8 });
  }

  spawnEnemyBullet(x, y, z, vx, vy, vz, dmg, owner) {
    if (this.bullets.length > 120) this.bullets.shift();
    this.bullets.push({ x, y, z, vx, vy, vz, dmg, owner, age: 0, alive: true, whiz: false, ox: owner.x, oz: owner.z });
  }

  // ------------------------------------------------------------------ main step
  // input: { f,b,l,r, jump, sprint, crouch, ads, fire, reload, interact, lookDX, lookDY }
  update(dt, input) {
    dt = Math.min(dt, 0.05);
    if (this.state === 'menu') { this._orbit(dt); this._tick(dt, false); return; }
    if (this.state === 'paused') return;
    this.time += dt;
    const pl = this.player;

    if (this.state === 'playing') {
      this.stats.time += dt;
      // look
      const sens = 0.0022 * settings.sensitivity * (input.ads ? 0.72 : 1) * (settings.fov / 78);
      pl.yaw -= (input.lookDX || 0) * sens;
      pl.pitch -= (input.lookDY || 0) * sens * (settings.invertY ? -1 : 1);
      pl.clampPitch();
      if (input.fire) this.sprintBlockT = 0.35;
      this.sprintBlockT -= dt;
      const moveInput = Object.assign({}, input, { sprint: input.sprint && this.sprintBlockT <= 0 && !this.gun.reloading });
      pl.update(dt, moveInput, this);
      for (const ev of pl.events) this._playerEvent(ev);
      this._weapon(dt, input);
      this._interact(input);
      if (this._inWinZone()) this._win();
    } else if (this.state === 'dead') {
      pl.update(dt, {}, this);
      this.deathT += dt;
      this.hud.death(this.deathT);
      if (this.deathT > 3.9 && !this.deathCard) { this.deathCard = true; this.hud.showDeathCard(); }
    }
    this._tick(dt, true);
    this._updateCamera(dt, input);
  }

  // things that run in every state (menu orbit included): AI, doors, bullets, effects
  _tick(dt, live) {
    this.enemies.passive = this.state !== 'playing';
    for (const d of this.doors) d.update(dt);
    if (live || this.state === 'menu') this.enemies.update(dt);
    this._bullets(dt);
    this.fx.update(dt, this.camera, this.bullets);
    this.hitFlash = Math.max(0, this.hitFlash - dt);
  }

  _inWinZone() {
    const p = this.player.pos;
    return p.z < WIN_ZONE.maxZ && p.x > WIN_ZONE.minX && p.x < WIN_ZONE.maxX && p.y < 1;
  }

  _playerEvent(ev) {
    const p = this.player.pos;
    if (ev.type === 'step') {
      this.audio.play('step', { gain: 0.16 + ev.loud * 0.14, jitter: 0.2 });
      if (ev.loud >= 0.9) this.enemies.noise(p.x, p.y + 0.2, p.z, 0.5, 8, 'step');
      else if (ev.loud >= 0.6) this.enemies.noise(p.x, p.y + 0.2, p.z, 0.3, 4.5, 'step');
    } else if (ev.type === 'land') {
      this.audio.play('land', { gain: clamp(ev.v / 10, 0.2, 0.8) });
    } else if (ev.type === 'jump') {
      this.audio.play('jump', { gain: 0.3 });
    } else if (ev.type === 'fellOut') {
      const s = this.W.playerStart;
      this.player.pos.x = s.x; this.player.pos.y = s.y; this.player.pos.z = s.z;
    }
  }

  // ------------------------------------------------------------------ weapons
  _weapon(dt, input) {
    const g = this.gun, w = WEAPONS[g.type];
    g.cd -= dt;
    g.bloom = damp(g.bloom, 0, 5, dt);
    this.adsT = damp(this.adsT, input.ads && !this.player.sprinting ? 1 : 0, 14, dt);
    // pump after a shotgun shot
    if (g.pumpT >= 0) {
      const prev = g.pumpT;
      g.pumpT += dt;
      if (prev < w.pumpDelay && g.pumpT >= w.pumpDelay) this.audio.play('pump', { gain: 0.7 });
      if (g.pumpT > w.pumpDelay + w.pumpTime) g.pumpT = -1;
    }
    // reload timeline
    if (g.reloading) {
      g.reloadT += dt;
      for (const ev of g.reloadEvents) if (!ev.done && g.reloadT >= ev.t) { ev.done = true; this.audio.play(ev.s, { gain: 0.6 }); if (ev.shell) this._shellIn(); }
      if (!w.pump && g.reloadT >= g.reloadDur) {
        const need = w.mag - g.mag, take = Math.min(need, g.reserve);
        g.mag += take; g.reserve -= take; g.reloading = false;
        this.hud.ammo(g.mag, g.reserve, w.name);
      }
      if (w.pump && (g.reloadT >= g.reloadDur || g.mag >= w.mag || g.reserve <= 0)) g.reloading = false;
    }
    if (input.reload) this.reload();

    const pressed = input.fire && !this.fireHeldPrev;
    this.fireHeldPrev = !!input.fire;
    const wants = w.auto ? input.fire : pressed;
    if (wants && g.cd <= 0) {
      if (g.reloading && w.pump && g.mag > 0) g.reloading = false; // fire interrupts shell loading
      if (g.reloading) return;
      if (g.pumpT >= 0 && g.pumpT < w.pumpDelay + w.pumpTime * 0.85) return;
      if (g.mag <= 0) {
        if (pressed) this.audio.play('empty', { gain: 0.7 });
        g.cd = 0.25;
        if (g.reserve > 0) this.reload();
        return;
      }
      this._fire(w);
      g.cd = w.interval;
      if (w.pump) g.pumpT = 0;
    }
  }

  reload() {
    const g = this.gun, w = WEAPONS[g.type];
    if (g.reloading || g.mag >= w.mag || g.reserve <= 0 || this.state !== 'playing') return;
    g.reloading = true; g.reloadT = 0;
    if (w.pump) {
      const shells = Math.min(w.mag - g.mag, g.reserve);
      g.reloadDur = 0.25 + shells * w.reloadShell;
      g.reloadEvents = [];
      for (let i = 0; i < shells; i++) g.reloadEvents.push({ t: 0.25 + (i + 0.8) * w.reloadShell, s: 'shellIn', shell: true });
    } else {
      g.reloadDur = w.reload;
      const D = w.reload;
      g.reloadEvents = [{ t: D * 0.18, s: 'magOut' }, { t: D * 0.62, s: 'magIn' }, { t: D * 0.86, s: g.type === 'pistol' ? 'slideRack' : 'bolt' }];
    }
    if (this.vm) this.vm.startReload();
  }

  _shellIn() {
    const g = this.gun;
    if (g.reserve <= 0) return;
    g.mag++; g.reserve--;
    if (this.vm) this.vm.shellIn();
    this.hud.ammo(g.mag, g.reserve, WEAPONS[g.type].name);
  }

  _fire(w) {
    const g = this.gun, pl = this.player, cam = this.camera;
    g.mag--;
    this.stats.shots++;
    this.lastPlayerShot = this.time;
    // sound + flash in the same frame
    this.audio.play(w.sound, { gain: 0.9, jitter: 0.04 });
    if (this.vm) this.vm.fire(w.kick, this.adsT > 0.5);
    this.shake = Math.min(1, this.shake + w.kick * 4);
    // spread
    const moving = pl.speed2D / P.walk;
    let spread = (this.adsT > 0.5 ? w.adsSpread : w.spread) + w.moveSpread * clamp(moving, 0, 1.4) + g.bloom;
    if (!pl.grounded) spread *= 2;
    if (pl.crouching) spread *= 0.75;
    g.bloom = Math.min(0.03, g.bloom + (w.auto ? 0.0035 : 0.004));
    // eye + forward from the current camera
    cam.updateMatrixWorld();
    const ox = cam.position.x, oy = cam.position.y, oz = cam.position.z;
    const fwd = _v.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const right = _v2.set(1, 0, 0).applyQuaternion(cam.quaternion);
    const up = _v3.set(0, 1, 0).applyQuaternion(cam.quaternion);
    const muzzle = this._muzzleWorld();
    let anyHit = false;
    for (let i = 0; i < w.pellets; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
      let dx = fwd.x + (right.x * Math.cos(a) + up.x * Math.sin(a)) * r;
      let dy = fwd.y + (right.y * Math.cos(a) + up.y * Math.sin(a)) * r;
      let dz = fwd.z + (right.z * Math.cos(a) + up.z * Math.sin(a)) * r;
      const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
      const hw = this.raycastWorld(ox, oy, oz, dx, dy, dz, w.range);
      const maxT = hw ? hw.t : w.range;
      const he = this.enemies.raycast(ox, oy, oz, dx, dy, dz, maxT);
      let ex, ey, ez;
      if (he) {
        ex = ox + dx * he.t; ey = oy + dy * he.t; ez = oz + dz * he.t;
        let dmg = w.damage;
        if (w.falloff) dmg *= clamp(1 - (he.t - w.falloff[0]) / (w.falloff[1] - w.falloff[0]), 0.25, 1);
        const res = this.enemies.hit(he, dmg, dx, dy, dz, ex, ey, ez);
        if (!res.corpse) { anyHit = true; }
        if (res.killed) { this.stats.kills++; if (res.headshot) this.stats.headshots++; this.hud.kill(res.headshot); }
        if (i === 0 || w.pellets === 1) this.audio.play(he.head && !res.corpse ? 'headshot' : 'flesh', { gain: 0.55, jitter: 0.1 });
      } else if (hw) {
        ex = hw.x; ey = hw.y; ez = hw.z;
        if (hw.static) this.fx.impact(hw.x, hw.y, hw.z, hw.nx, hw.ny, hw.nz, w.pellets > 1 ? 0.8 : 1);
        else this.fx.impact(hw.x, hw.y, hw.z, hw.nx, hw.ny, hw.nz, 0); // door: debris only (decal scaled to 0)
        if (i < 2) {
          const metal = hw.box && (hw.box.tag === 'towerleg' || hw.box.tag === 'tank' || hw.box.tag === 'vending' || hw.box.tag === 'locker');
          this.audio.playAt(metal ? 'impactMetal' : 'impact', hw.x, hw.y, hw.z, this.listener, { gain: 0.45, ref: 4 });
        }
      } else {
        ex = ox + dx * 80; ey = oy + dy * 80; ez = oz + dz * 80;
      }
      this.fx.tracer(muzzle.x, muzzle.y, muzzle.z, ex, ey, ez);
    }
    if (anyHit) this.stats.hits++;
    // recoil: part permanent climb, part visual kick that recovers
    const ads = this.adsT > 0.5 ? 0.6 : 1;
    pl.pitch += w.recoil * 0.45 * ads;
    this.recoilP += w.recoil * 0.9 * ads;
    this.recoilY += (Math.random() - 0.5) * 2 * w.recoilYaw * ads;
    pl.clampPitch();
    // everyone nearby hears it; walls muffle
    const loud = { smg: 1.0, rifle: 1.15, shotgun: 1.1, pistol: 0.85 }[w.id];
    this.enemies.noise(ox, oy, oz, loud, 55 * loud, 'gun');
    this.hud.ammo(g.mag, g.reserve, w.name);
  }

  _muzzleWorld() {
    const cam = this.camera;
    const out = new THREE.Vector3();
    if (this.vm) {
      const ndc = this.vm.muzzleNDC(new THREE.Vector3());
      out.set(ndc.x, ndc.y, 0.5).unproject(cam).sub(cam.position).normalize();
      return out.multiplyScalar(0.55).add(cam.position);
    }
    out.set(0.12, -0.12, -0.5).applyQuaternion(cam.quaternion).add(cam.position);
    return out;
  }

  // ------------------------------------------------------------------ interaction
  _interactTarget() {
    const pl = this.player, cam = this.camera;
    const fwd = _v.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const fx = -Math.sin(pl.yaw), fz = -Math.cos(pl.yaw);
    const pk = this.enemies.pickupFor(pl.pos.x, pl.pos.y, pl.pos.z, fx, fz);
    // doors: look at the panel, or stand in the doorway facing it
    let door = null, dd = Infinity;
    for (const d of this.doors) {
      const t = d.raycast(cam.position.x, cam.position.y, cam.position.z, fwd.x, fwd.y, fwd.z, 2.4);
      if (t >= 0 && t < dd) { dd = t; door = d; }
    }
    if (!door) {
      for (const d of this.doors) {
        const c = d.centre(_v2);
        const dx = c.x - pl.pos.x, dz = c.z - pl.pos.z, dist = Math.hypot(dx, dz);
        if (Math.abs(c.y - pl.pos.y) > 0.6 || dist > 1.7) continue;
        if ((dx * fx + dz * fz) / (dist || 1) < 0.35) continue;
        if (dist < dd) { dd = dist; door = d; }
      }
    }
    if (pk && (!door || Math.hypot(pk.x - pl.pos.x, pk.z - pl.pos.z) < dd + 0.3)) return { pickup: pk };
    if (door) return { door };
    return null;
  }

  _interact(input) {
    const t = this._interactTarget();
    let text = null;
    if (t && t.pickup) text = t.pickup.type === this.gun.type ? '[F] Take Ammo' : '[F] Swap ' + this.enemies.pickupName(t.pickup.type);
    else if (t && t.door) text = t.door.isOpen ? '[F] Close' : '[F] Open';
    this.hud.prompt(text);
    if (!input.interact || !t) return;
    const pl = this.player;
    if (t.door) {
      t.door.toggle(pl.pos.x, pl.pos.z);
      if (t.door.isOpen) this.onDoorNoise(t.door);
      return;
    }
    const p = t.pickup, g = this.gun;
    if (p.type === g.type) {
      g.reserve += p.mag + p.reserve;
      p.alive = false;
      this.audio.play('pickup', { gain: 0.7 });
      this.hud.toast(`+${p.mag + p.reserve} ${WEAPONS[g.type].name} ammo`);
    } else {
      // swap: drop what we hold where the pickup was
      this.enemies.dropPickup(g.type, pl.pos.x - Math.sin(pl.yaw) * 0.4, pl.eyeY - 0.5, pl.pos.z - Math.cos(pl.yaw) * 0.4, pl.yaw, g.mag, g.reserve);
      g.type = p.type; g.mag = p.mag; g.reserve = p.reserve;
      g.reloading = false; g.pumpT = -1; g.cd = 0.35;
      p.alive = false;
      if (this.vm) this.vm.setGun(g.type, true);
      this.audio.play('pickup', { gain: 0.8 });
    }
    this.hud.ammo(g.mag, g.reserve, WEAPONS[g.type].name);
  }

  // ------------------------------------------------------------------ enemy bullets
  _bullets(dt) {
    const pl = this.player;
    const px = pl.pos.x, pz = pl.pos.z;
    const feet = pl.pos.y + 0.25, head = pl.pos.y + pl.height - 0.2, hy = pl.eyeY;
    for (const b of this.bullets) {
      if (!b.alive) continue;
      b.age += dt;
      if (b.age > 3.5) { b.alive = false; continue; }
      const sp = Math.hypot(b.vx, b.vy, b.vz);
      const step = sp * dt;
      const dx = b.vx / sp, dy = b.vy / sp, dz = b.vz / sp;
      const ex = b.x + b.vx * dt, ey = b.y + b.vy * dt, ez = b.z + b.vz * dt;
      const hw = this.raycastWorld(b.x, b.y, b.z, dx, dy, dz, step);
      const segEnd = hw ? hw.t / step : 1;
      if (pl.alive && this.state === 'playing') {
        const sx = b.x + (ex - b.x) * segEnd, sy = b.y + (ey - b.y) * segEnd, sz = b.z + (ez - b.z) * segEnd;
        const d2 = segSegDist2(b.x, b.y, b.z, sx, sy, sz, px, feet, pz, px, head, pz);
        if (d2 < 0.35 * 0.35) {
          b.alive = false;
          this._playerHit(b.dmg, b.ox, b.oz);
          continue;
        }
        // near miss: whiz when it passes close by the head
        if (!b.whiz) {
          const dh2 = segSegDist2(b.x, b.y, b.z, sx, sy, sz, px, hy, pz, px, hy, pz);
          const s = segSegDist2.s;
          if (dh2 < 2.0 * 2.0 && s > 0 && s < 1) {
            b.whiz = true;
            this.audio.playAt('whiz', b.x + dx * step * s, hy, b.z + dz * step * s, this.listener, { gain: 0.9, ref: 3 });
          }
        }
      }
      if (hw) {
        b.alive = false;
        if (hw.static) this.fx.impact(hw.x, hw.y, hw.z, hw.nx, hw.ny, hw.nz, 0.8);
        this.audio.playAt('impact', hw.x, hw.y, hw.z, this.listener, { gain: 0.35, ref: 3 });
        continue;
      }
      b.x = ex; b.y = ey; b.z = ez;
    }
    if (this.bullets.length > 60) this.bullets = this.bullets.filter((b) => b.alive);
  }

  _playerHit(dmg, fromX, fromZ) {
    const pl = this.player;
    if (this.god) dmg = 0;
    const dir = pl.damage(dmg, fromX, fromZ);
    if (!dir) return;
    this.hitFlash = 0.35;
    this.shake = Math.min(1, this.shake + 0.35);
    this.audio.play('hurt', { gain: 0.8 });
    this.hud.hit(dir);
    if (!pl.alive) this._die();
  }

  _die() {
    this.state = 'dead';
    this.deathT = 0;
    this.deathCard = false;
    this.deathStart = { y: this.camera.position.y, pitch: this.player.pitch, roll: 0 };
    this.audio.play('death', { gain: 0.8 });
    this.hud.prompt(null);
  }

  _win() {
    this.state = 'won';
    this.won = true;
    const s = this.stats;
    const acc = s.shots ? s.hits / s.shots : 0;
    const score = Math.round(1000 + s.kills * 100 + s.headshots * 75 + acc * 600 + Math.max(0, 600 - s.time) * 3);
    const prev = loadBest();
    const best = Math.max(prev, score);
    if (score > prev) saveBest(score);
    this.result = { time: s.time, kills: s.kills, headshots: s.headshots, accuracy: acc, score, best, newBest: score > prev, total: this.enemies.list.length };
    this.audio.play('win', { gain: 0.8, bus: 'ui' });
    this.hud.prompt(null);
    this.hud.showWin(this.result);
  }

  // ------------------------------------------------------------------ camera
  _updateCamera(dt, input = {}) {
    const cam = this.camera, pl = this.player;
    this.recoilP = damp(this.recoilP, 0, 11, dt);
    this.recoilY = damp(this.recoilY, 0, 11, dt);
    this.shake = damp(this.shake, 0, 7, dt);
    const shake = this.shake * settings.screenShake;
    const sx = (Math.random() - 0.5) * shake * 0.02, sy = (Math.random() - 0.5) * shake * 0.02;
    const bob = settings.viewBob ? pl.bobAmt : 0;
    let y = pl.eyeY + Math.sin(pl.bobPhase * 2) * 0.04 * bob - pl.landKick * 0.08;
    let pitch = pl.pitch + this.recoilP + sy;
    let yaw = pl.yaw + this.recoilY + sx;
    let roll = Math.sin(pl.bobPhase) * 0.004 * bob;
    if (this.state === 'dead') {
      // fall to the ground, roll, and turn up toward the sky
      const t = this.deathT;
      const k = clamp(t / 0.9, 0, 1), kk = k * k * (3 - 2 * k);
      const ground = this.world.groundAt(pl.pos.x, pl.pos.z, 0.2, pl.pos.y + 0.5);
      y = this.deathStart.y + ((ground + 0.22) - this.deathStart.y) * kk + (k >= 1 ? Math.sin(Math.min(1, (t - 0.9) / 0.25) * Math.PI) * 0.03 : 0);
      const up = clamp((t - 0.35) / 1.8, 0, 1), uu = up * up * (3 - 2 * up);
      pitch = this.deathStart.pitch + (1.25 - this.deathStart.pitch) * uu;
      roll = 0.55 * kk + 0.25 * uu;
    }
    cam.position.set(pl.pos.x, y, pl.pos.z);
    _e.set(pitch, yaw, roll, 'YXZ');
    cam.quaternion.setFromEuler(_e);
    const fov = settings.fov * (1 - 0.17 * this.adsT);
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    this._afterCamera();
    void input;
  }

  _afterCamera() {
    const cam = this.camera;
    cam.updateMatrixWorld();
    this.listener.x = cam.position.x; this.listener.y = cam.position.y; this.listener.z = cam.position.z;
    this.listener.yaw = this.state === 'menu' ? this.orbitA : this.player.yaw;
    this.sky.position.copy(cam.position);
    // sun shadow box follows the camera, snapped to shadow texels to avoid shimmering
    const s = this.sun;
    const tex = (s.shadow.camera.right - s.shadow.camera.left) / s.shadow.mapSize.x;
    const tx = Math.round(cam.position.x / tex) * tex, tz = Math.round(cam.position.z / tex) * tex;
    s.target.position.set(tx, 0, tz);
    s.position.set(tx + this.sunOffset.x, this.sunOffset.y, tz + this.sunOffset.z);
    s.target.updateMatrixWorld();
  }

  _orbit(dt) {
    this.orbitA += dt * 0.045;
    const c = CAMERA_SHOTS.orbitCentre.pos;
    const cam = this.camera;
    const R = 58;
    cam.position.set(c[0] + Math.sin(this.orbitA) * R, 30, c[2] + Math.cos(this.orbitA) * R);
    cam.lookAt(c[0], 3, c[2]);
    if (Math.abs(cam.fov - 55) > 0.01) { cam.fov = 55; cam.updateProjectionMatrix(); }
    this._afterCamera();
  }

  setShot(name) {
    const s = CAMERA_SHOTS[name];
    const cam = this.camera;
    cam.position.set(...s.pos);
    cam.lookAt(...s.look);
    this._afterCamera();
  }

  // ------------------------------------------------------------------ rendering
  render(renderer) {
    renderer.shadowMap.autoUpdate = this.shadowsLive;
    renderer.info.reset();
    renderer.clear();
    renderer.render(this.scene, this.camera);
    if (this.vm && (this.state === 'playing' || this.state === 'dead' || this.state === 'paused')) {
      renderer.clearDepth();
      renderer.render(this.vm.scene, this.vm.camera);
    }
  }

  updateViewModel(dt, input) {
    if (!this.vm) return;
    const pl = this.player, g = this.gun, w = WEAPONS[g.type];
    this.vm.update(dt, {
      ads: this.adsT > 0.5 && this.state === 'playing',
      sprint: pl.sprinting && this.state === 'playing',
      bobPhase: pl.bobPhase, bobAmt: pl.bobAmt, viewBob: settings.viewBob,
      lookDX: input.lookDX || 0, lookDY: input.lookDY || 0,
      landKick: pl.landKick, alive: pl.alive, crouch: pl.crouching,
      reloading: g.reloading, reloadP: g.reloadDur ? g.reloadT / g.reloadDur : 0,
      pumpP: g.pumpT >= 0 ? (g.pumpT - (w.pumpDelay || 0)) / (w.pumpTime || 1) : -1,
    });
  }

  // ------------------------------------------------------------------ test hooks
  snapshot() {
    const pl = this.player, g = this.gun;
    return {
      state: this.state,
      player: { x: +pl.pos.x.toFixed(5), y: +pl.pos.y.toFixed(5), z: +pl.pos.z.toFixed(5), yaw: +pl.yaw.toFixed(5), pitch: +pl.pitch.toFixed(5), health: +pl.health.toFixed(3), alive: pl.alive },
      gun: { type: g.type, mag: g.mag, reserve: g.reserve, reloading: g.reloading },
      stats: Object.assign({}, this.stats, { time: +this.stats.time.toFixed(3) }),
      enemies: this.enemies.snapshot(),
      pickups: this.enemies.pickups.filter((p) => p.alive).map((p) => ({ type: p.type, x: +p.x.toFixed(3), z: +p.z.toFixed(3), mag: p.mag })),
      doors: this.doors.map((d) => +d.angle.toFixed(4)),
      fx: this.fx.snapshot(),
      bullets: this.bullets.filter((b) => b.alive).length,
    };
  }
}
