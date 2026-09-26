// First-person body: a vertical cylinder against the AABB world + door panels.
//
// Pitfalls handled here, from the brief:
//  * step-ups onto ledges only happen while GROUNDED (no mantling the parapet mid-jump);
//  * vertical collisions only resolve against surfaces the body actually CROSSED this step
//    (overlapping a tall collider never teleports you on top of it);
//  * walking down stairs snaps the body to the next tread so it doesn't bounce.
import { F_MOVE, pushCircleOutOfRect } from './collision.js';
import { clamp, damp } from './util.js';

export const P = {
  radius: 0.32,
  standH: 1.75,
  crouchH: 1.15,
  eyeBelowTop: 0.12,
  step: 0.3,        // max ledge you can walk up (stair riser is 0.25)
  snap: 0.36,       // max drop that keeps you glued to the ground (stairs)
  gravity: 16,
  jumpV: 5.2,       // apex ~0.85 m: lower than the 1.05 m parapet
  walk: 4.3,
  sprint: 6.8,
  crouch: 2.1,
  ads: 2.6,
  accelGround: 42,
  accelAir: 7,
};

export class Player {
  constructor() {
    this.pos = { x: 0, y: 0, z: 0 };
    this.vel = { x: 0, y: 0, z: 0 };
    this.reset({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0 });
  }

  reset(s) {
    this.pos.x = s.x; this.pos.y = s.y; this.pos.z = s.z;
    this.vel.x = 0; this.vel.y = 0; this.vel.z = 0;
    this.yaw = s.yaw || 0; this.pitch = s.pitch || 0;
    this.grounded = true;
    this.height = P.standH;
    this.crouching = false;
    this.health = 100;
    this.alive = true;
    this.lastDamage = -99;
    this.time = 0;
    this.stepDist = 0;
    this.bobPhase = 0;
    this.bobAmt = 0;
    this.landKick = 0;
    this.sprinting = false;
    this.speed2D = 0;
    this.events = [];
  }

  get eyeY() { return this.pos.y + this.height - P.eyeBelowTop; }

  forward(out) { out.x = -Math.sin(this.yaw); out.z = -Math.cos(this.yaw); return out; }

  // input: { f, b, l, r, jump, sprint, crouch, ads } ; env: { world, doors }
  update(dt, input, env) {
    this.time += dt;
    this.events.length = 0;
    if (!this.alive) { this._integrateDead(dt, env); return; }
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    let jumpUsed = false;
    for (let i = 0; i < n; i++) {
      this._step(h, input, env, input.jump && !jumpUsed);
      if (input.jump) jumpUsed = true;
    }
    // regen: no health bar, edges of the screen show damage instead
    if (this.time - this.lastDamage > 3.6 && this.health < 100) this.health = Math.min(100, this.health + 24 * dt);
    // view bob
    const moving = this.grounded && this.speed2D > 0.5;
    this.bobAmt = damp(this.bobAmt, moving ? Math.min(1, this.speed2D / P.walk) : 0, 8, dt);
    if (moving) this.bobPhase += dt * this.speed2D * 1.75;
    this.landKick = damp(this.landKick, 0, 9, dt);
  }

  _step(dt, input, env, wantJump) {
    const p = this.pos, v = this.vel, world = env.world;
    // --- crouch (height changes from the top; feet stay put, so no crouch-jump lift)
    const wantCrouch = !!input.crouch;
    if (wantCrouch) this.crouching = true;
    else if (this.crouching) {
      const c = world.ceilingAt(p.x, p.z, P.radius * 0.9, p.y + this.height - 0.02, p.y + P.standH + 0.02);
      if (c === Infinity) this.crouching = false;
    }
    const targetH = this.crouching ? P.crouchH : P.standH;
    this.height = damp(this.height, targetH, 14, dt);
    if (Math.abs(this.height - targetH) < 0.003) this.height = targetH;

    // --- wish velocity
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    let mx = 0, mz = 0;
    const fwd = (input.f ? 1 : 0) - (input.b ? 1 : 0);
    const str = (input.r ? 1 : 0) - (input.l ? 1 : 0);
    mx = fx * fwd + rx * str; mz = fz * fwd + rz * str;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }
    this.sprinting = !!input.sprint && fwd > 0 && !this.crouching && !input.ads && this.grounded;
    let speed = this.crouching ? P.crouch : input.ads ? P.ads : this.sprinting ? P.sprint : P.walk;
    const accel = this.grounded ? P.accelGround : P.accelAir;
    const k = 1 - Math.exp(-accel * dt);
    v.x += (mx * speed - v.x) * k;
    v.z += (mz * speed - v.z) * k;
    this.speed2D = Math.hypot(v.x, v.z);

    // --- jump
    let jumped = false;
    if (wantJump && this.grounded && !this.crouching) {
      v.y = P.jumpV; this.grounded = false; jumped = true;
      this.events.push({ type: 'jump' });
    }

    // --- horizontal move + push-out
    const ox = p.x, oz = p.z;
    p.x += v.x * dt; p.z += v.z * dt;
    this._resolveHorizontal(env);
    // --- step up (grounded only)
    if (this.grounded && !jumped) {
      const g = world.groundAt(p.x, p.z, P.radius * 0.95, p.y + P.step);
      if (g > p.y + 0.001) {
        const c = world.ceilingAt(p.x, p.z, P.radius * 0.9, g + 0.05, g + this.height);
        if (c === Infinity) p.y = g;
        else { p.x = ox; p.z = oz; }
      }
    }
    // effective horizontal velocity after collisions (sliding along walls)
    if (dt > 0) { v.x = (p.x - ox) / dt; v.z = (p.z - oz) / dt; }

    // --- vertical: gravity, landing on surfaces crossed, stair snap, ceilings crossed
    const wasGrounded = this.grounded;
    const fallV = v.y;
    v.y -= P.gravity * dt;
    let ny = p.y + v.y * dt;
    const rr = P.radius * 0.92;
    if (v.y <= 0) {
      const g = world.groundAt(p.x, p.z, rr, p.y + 0.001); // highest surface at/below the feet
      if (g >= ny) {
        ny = g;
        if (!wasGrounded && fallV < -3) this.events.push({ type: 'land', v: -fallV });
        if (!wasGrounded) this.landKick = Math.min(1, -fallV / 9);
        v.y = 0; this.grounded = true;
      } else if (wasGrounded && !jumped && p.y - g <= P.snap) {
        ny = g; v.y = 0; this.grounded = true;       // glued to the next tread down
      } else {
        this.grounded = false;
      }
    } else {
      const head = p.y + this.height;
      const c = env.world.ceilingAt(p.x, p.z, rr, head - 0.001, ny + this.height);
      if (c !== Infinity) { ny = c - this.height; v.y = 0; }
      this.grounded = false;
    }
    p.y = ny;
    if (p.y < -30) this.events.push({ type: 'fellOut' });

    // footsteps
    if (this.grounded) {
      this.stepDist += this.speed2D * dt;
      const stride = this.sprinting ? 2.4 : this.crouching ? 1.6 : 2.0;
      if (this.stepDist > stride) { this.stepDist = 0; this.events.push({ type: 'step', loud: this.sprinting ? 1 : this.crouching ? 0.35 : 0.7 }); }
    }
  }

  _resolveHorizontal(env) {
    const p = this.pos, r = P.radius, world = env.world;
    const feet = p.y, head = p.y + this.height;
    // walkable ledges at or below step height are climbed, not pushed against — but only
    // while grounded. In the air every box above the feet blocks.
    const stepLimit = this.grounded ? feet + P.step : feet + 0.001;
    for (let iter = 0; iter < 4; iter++) {
      let moved = false;
      const list = world.query(p.x - r - 0.05, p.z - r - 0.05, p.x + r + 0.05, p.z + r + 0.05, F_MOVE);
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        if (b.minY >= head - 0.01) continue;
        if (b.maxY <= stepLimit) continue;
        if (pushCircleOutOfRect(p, r, b.minX, b.minZ, b.maxX, b.maxZ)) moved = true;
      }
      for (const d of env.doors) if (d.pushCircle(p, r, feet + 0.05, head)) moved = true;
      if (!moved) break;
    }
  }

  // After death the body just settles to the ground under it.
  _integrateDead(dt, env) {
    const p = this.pos;
    this.vel.y -= P.gravity * dt;
    let ny = p.y + this.vel.y * dt;
    const g = env.world.groundAt(p.x, p.z, 0.2, p.y + 0.001);
    if (g >= ny) { ny = g; this.vel.y = 0; }
    p.y = ny;
  }

  damage(amount, fromX, fromZ) {
    if (!this.alive) return null;
    this.health -= amount;
    this.lastDamage = this.time;
    // direction relative to where we look
    const dx = fromX - this.pos.x, dz = fromZ - this.pos.z;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const f = dx * fx + dz * fz, s = dx * rx + dz * rz;
    let dir;
    if (Math.abs(f) >= Math.abs(s)) dir = f >= 0 ? 'AHEAD' : 'BEHIND';
    else dir = s >= 0 ? 'RIGHT' : 'LEFT';
    if (this.health <= 0) { this.health = 0; this.alive = false; }
    return dir;
  }

  clampPitch() { this.pitch = clamp(this.pitch, -1.52, 1.52); }
}
