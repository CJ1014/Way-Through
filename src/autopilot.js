// Test bot: plays the route end to end through the SAME input path a human uses
// (mouse deltas for look, WASD, F on doors, fire, reload). Used by the automated browser run
// and the headless route test. Enable in the browser with ?autopilot=1.
import { WEAPONS } from './weapons.js';
import { settings } from './settings.js';
import { wrapAngle, clamp } from './util.js';

export class Autopilot {
  constructor(game, opts = {}) {
    this.G = game;
    this.fight = opts.fight !== false;
    this.path = null;
    this.i = 0;
    this.stuckT = 0;
    this.lastPos = null;
    this.doorCool = 0;
    this.log = [];
    this.target = null;
    this.visitedTags = new Set();
    this.interactPrev = false;
  }

  _plan() {
    const G = this.G, p = G.player.pos;
    const a = G.nav.nearest(p.x, p.y, p.z, G.world);
    const b = G.W.byTag('gateOut');
    this.path = G.nav.path(a, b) || [];
    this.path.push({ x: 0, y: 0, z: -102, tag: 'win' });
    this.i = 0;
  }

  _visibleEnemy() {
    const G = this.G, cam = G.camera.position;
    let best = null, bd = Infinity;
    for (const e of G.enemies.list) {
      if (!e.alive) continue;
      const d = Math.hypot(e.x - cam.x, e.y - cam.y, e.z - cam.z);
      if (d > 40 || (e.spawn.sniper && d > 28)) continue;
      const cy = e.j[7] + 0.25;
      if (!G.lineClear(cam.x, cam.y, cam.z, e.j[6], cy, e.j[8])) continue;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  input(dt) {
    const G = this.G, pl = G.player, g = G.gun;
    const inp = { f: false, b: false, l: false, r: false, jump: false, sprint: false, crouch: false, ads: false, fire: false, reload: false, interact: false, lookDX: 0, lookDY: 0 };
    if (G.state !== 'playing') return inp;
    if (!this.path) this._plan();
    this.doorCool -= dt;
    const sens = 0.0022 * settings.sensitivity * (settings.fov / 78);
    const lookAt = (x, y, z, rate) => {
      const cam = G.camera.position;
      const dx = x - cam.x, dy = y - cam.y, dz = z - cam.z;
      const yaw = Math.atan2(-dx, -dz);
      const pitch = Math.atan2(dy, Math.hypot(dx, dz));
      const dyaw = wrapAngle(yaw - pl.yaw), dp = pitch - pl.pitch;
      const k = Math.min(1, rate * dt);
      inp.lookDX = clamp(-(dyaw * k) / sens, -900, 900);
      inp.lookDY = clamp(-(dp * k) / sens, -900, 900);
      return Math.hypot(dyaw, dp);
    };

    // out of ammo: stop trading shots and run for the gate
    const enemy = this.fight && g.mag + g.reserve > 0 ? this._visibleEnemy() : null;
    if (enemy) {
      const aimHead = Math.hypot(enemy.x - pl.pos.x, enemy.z - pl.pos.z) < 14;
      const err = lookAt(enemy.j[aimHead ? 0 : 6], aimHead ? enemy.j[1] : enemy.j[7] + 0.25, enemy.j[aimHead ? 2 : 8], 14);
      const w = WEAPONS[g.type];
      inp.ads = true;
      if (err < 0.05 && g.mag > 0) inp.fire = w.auto ? true : (Math.floor(G.time * 7) % 2 === 0);
      if (g.mag === 0) inp.reload = true;
      this.target = enemy.spawn.id;
      // strafe a little while shooting
      inp.l = Math.floor(G.time / 1.3) % 2 === 0;
      inp.r = !inp.l;
      return inp;
    }
    this.target = null;
    if (g.mag < WEAPONS[g.type].mag * 0.5 && g.reserve > 0 && !g.reloading) inp.reload = true;

    // low on ammo? walk to the nearest dropped gun and take it (F)
    const W = WEAPONS[g.type];
    if (g.mag + g.reserve < W.mag * 2) {
      let best = null, bd = 14;
      const have = g.mag + g.reserve;
      for (const p of G.enemies.pickups) {
        if (!p.alive || !p.rest || Math.abs(p.y - pl.pos.y) > 1) continue;
        const value = p.mag + p.reserve;
        if (value === 0 || (p.type !== g.type && value <= have + 10)) continue; // only take what helps
        const d = Math.hypot(p.x - pl.pos.x, p.z - pl.pos.z);
        if (d < bd && G.lineClear(pl.pos.x, pl.pos.y + 0.5, pl.pos.z, p.x, p.y + 0.2, p.z)) { bd = d; best = p; }
      }
      if (best) {
        const d = Math.hypot(best.x - pl.pos.x, best.z - pl.pos.z);
        lookAt(best.x, best.y, best.z, 8);
        if (d > 1.0) inp.f = true;
        else if (!this.interactPrev) { inp.interact = true; this.log.push('pickup ' + best.type); }
        this.interactPrev = inp.interact;
        return inp;
      }
    }

    // follow the route
    let node = this.path[this.i];
    if (!node) return inp;
    const d = Math.hypot(node.x - pl.pos.x, node.z - pl.pos.z);
    if (d < 0.6 && Math.abs(node.y - pl.pos.y) < 1.2) {
      if (node.tag) this.visitedTags.add(node.tag);
      this.i++;
      node = this.path[this.i];
      if (!node) return inp;
    }
    // door on this edge?
    const prev = this.path[this.i - 1];
    const edge = prev && node.id !== undefined && prev.id !== undefined ? G.nav.edgeBetween(prev, node) : null;
    if (edge && edge.door && edge.door.openAmount < 0.6) {
      const c = edge.door.centre({});
      const dd = Math.hypot(c.x - pl.pos.x, c.z - pl.pos.z);
      if (dd < 1.5) {
        lookAt(c.x, c.y + 1.1, c.z, 10);
        if (!edge.door.isOpen && this.doorCool <= 0 && !this.interactPrev) { inp.interact = true; this.doorCool = 0.6; this.log.push('open ' + edge.door.name); }
        this.interactPrev = inp.interact;
        return inp;
      }
    }
    this.interactPrev = false;
    lookAt(node.x, pl.eyeY + (node.y - pl.pos.y) * 0.3, node.z, 8);
    if (this.sideT > 0) { this.sideT -= dt; inp.r = true; inp.f = true; return inp; }
    const want = Math.atan2(-(node.x - pl.pos.x), -(node.z - pl.pos.z));
    const off = Math.abs(wrapAngle(want - pl.yaw));
    inp.f = off < 0.6;
    inp.sprint = off < 0.2 && d > 3;
    // stuck?
    const lp = this.lastPos;
    if (lp && Math.hypot(lp.x - pl.pos.x, lp.z - pl.pos.z) < 0.02 && inp.f) this.stuckT += dt; else this.stuckT = 0;
    this.lastPos = { x: pl.pos.x, z: pl.pos.z };
    if (this.stuckT > 1.5) { inp.jump = true; this.stuckT = 0; this.sideT = 0.7; this.log.push('stuck @' + pl.pos.x.toFixed(1) + ',' + pl.pos.z.toFixed(1)); this._plan(); }
    return inp;
  }
}
