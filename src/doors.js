// Hinged doors. They swing AWAY from whoever opens them, block movement, stop bullets,
// and can be opened by enemies. Collision is an oriented box around the panel.
import * as THREE from '../vendor/three/three.module.js';
import { Builder, buildLocalObject } from './builder.js';
import { F_MOVE, pushCircleOutOfRect } from './collision.js';

export const DOOR_OPEN_ANGLE = 1.55; // ~89 degrees
const SWING_SPEED = 3.4; // rad/s

let doorIds = 0;

export class Door {
  // def: { x, z (hinge), y (base), width, height, dirX, dirZ (hinge -> free end when closed), name }
  constructor(def, materials) {
    this.id = doorIds++;
    this.name = def.name || 'door' + this.id;
    this.hx = def.x; this.hz = def.z; this.y = def.y;
    this.w = def.width; this.h = def.height; this.t = def.thick || 0.07;
    const len = Math.hypot(def.dirX, def.dirZ);
    this.dx = def.dirX / len; this.dz = def.dirZ / len;
    // n = normal of the closed door; positive swing angle moves the free end toward -n
    this.nx = -this.dz; this.nz = this.dx;
    this.baseRot = Math.atan2(-this.dz, this.dx);
    this.angle = 0;
    this.target = 0;
    this.lastMove = 0;
    this.onSound = null;

    if (materials) {
      const b = new Builder();
      const w = this.w, h = this.h, t = this.t;
      b.box('door', 0.015, 0, -t / 2, w - 0.015, h, t / 2, { col: 'none' });
      // inset panel lines on both faces (ink detail)
      for (const s of [-1, 1]) {
        const z = s * (t / 2 + 0.002);
        const x0 = 0.14, x1 = w - 0.14, y0 = 0.18, y1 = h - 0.2, ym = h * 0.52, FN = [0, 0, s];
        b.segXYZ(x0, y0, z, x1, y0, z, b.fine, FN); b.segXYZ(x1, y0, z, x1, y1, z, b.fine, FN);
        b.segXYZ(x1, y1, z, x0, y1, z, b.fine, FN); b.segXYZ(x0, y1, z, x0, y0, z, b.fine, FN);
        b.segXYZ(x0, ym, z, x1, ym, z, b.fine, FN);
        // handle
        b.box('steel', w - 0.16, 0.98, s * (t / 2) - 0.025, w - 0.06, 1.03, s * (t / 2) + 0.025, { col: 'none' });
      }
      this.group = buildLocalObject(b, materials, materials.lines.ink);
      this.group.name = 'door:' + this.name;
      this.group.position.set(this.hx, this.y, this.hz);
      this._applyRot();
    }
  }

  get rot() { return this.baseRot + this.angle; }
  get isOpen() { return Math.abs(this.target) > 0.01; }
  get openAmount() { return Math.abs(this.angle) / DOOR_OPEN_ANGLE; }

  _applyRot() { if (this.group) this.group.rotation.y = this.rot; }

  // Which side of the closed door plane a point is on (+1 / -1).
  side(px, pz) {
    const s = (px - this.hx) * this.nx + (pz - this.hz) * this.nz;
    return s >= 0 ? 1 : -1;
  }

  open(fromX, fromZ) {
    const s = this.side(fromX, fromZ);
    this.target = s * DOOR_OPEN_ANGLE; // swings to the far side of the opener
    if (this.onSound) this.onSound('doorOpen', this);
  }

  close() {
    this.target = 0;
    if (this.onSound) this.onSound('doorClose', this);
  }

  toggle(fromX, fromZ) {
    if (this.isOpen) this.close(); else this.open(fromX, fromZ);
  }

  reset() { this.angle = 0; this.target = 0; this._applyRot(); }

  update(dt) {
    const d = this.target - this.angle;
    if (Math.abs(d) < 1e-4) { if (this.angle !== this.target) { this.angle = this.target; this._applyRot(); } return; }
    const step = Math.sign(d) * Math.min(Math.abs(d), SWING_SPEED * dt * (0.35 + 0.65 * Math.min(1, Math.abs(d) * 2)));
    this.angle += step;
    if (this.target === 0 && Math.abs(this.angle) < 0.02) {
      this.angle = 0;
      if (this.onSound) this.onSound('doorLatch', this);
    }
    this._applyRot();
  }

  // world -> door local (x along panel from hinge, z across)
  toLocal(px, pz, out) {
    const c = Math.cos(this.rot), s = Math.sin(this.rot);
    const wx = px - this.hx, wz = pz - this.hz;
    out.x = c * wx - s * wz;
    out.z = s * wx + c * wz;
    return out;
  }
  toWorld(lx, lz, out) {
    const c = Math.cos(this.rot), s = Math.sin(this.rot);
    out.x = this.hx + lx * c + lz * s;
    out.z = this.hz - lx * s + lz * c;
    return out;
  }

  // Push a vertical cylinder out of the panel. pos has x,z; y range [y0,y1].
  pushCircle(pos, r, y0, y1) {
    if (y1 < this.y || y0 > this.y + this.h) return false;
    const l = this.toLocal(pos.x, pos.z, _loc);
    const hit = pushCircleOutOfRect(l, r, 0, -this.t / 2, this.w, this.t / 2);
    if (hit) this.toWorld(l.x, l.z, pos);
    return hit;
  }

  // Ray vs panel (oriented box). Returns t or -1 and writes the world normal to _doorHit.
  raycast(ox, oy, oz, dx, dy, dz, maxT) {
    const c = Math.cos(this.rot), s = Math.sin(this.rot);
    const wx = ox - this.hx, wz = oz - this.hz;
    const lox = c * wx - s * wz, loz = s * wx + c * wz;
    const ldx = c * dx - s * dz, ldz = s * dx + c * dz;
    let t0 = -Infinity, t1 = Infinity, axis = -1;
    const slab = (o, d, mn, mx, ax) => {
      if (Math.abs(d) < 1e-12) return o >= mn && o <= mx;
      let a = (mn - o) / d, b = (mx - o) / d;
      if (a > b) { const tmp = a; a = b; b = tmp; }
      if (a > t0) { t0 = a; axis = ax; }
      if (b < t1) t1 = b;
      return t0 <= t1;
    };
    if (!slab(lox, ldx, 0, this.w, 0)) return -1;
    if (!slab(oy, dy, this.y, this.y + this.h, 1)) return -1;
    if (!slab(loz, ldz, -this.t / 2, this.t / 2, 2)) return -1;
    if (t1 < 0 || t0 > maxT || t0 < 0) return -1;
    // normal
    let lnx = 0, lnz = 0, ny = 0;
    if (axis === 0) lnx = ldx > 0 ? -1 : 1;
    else if (axis === 1) ny = dy > 0 ? -1 : 1;
    else lnz = ldz > 0 ? -1 : 1;
    _doorHit.nx = lnx * c + lnz * s; _doorHit.ny = ny; _doorHit.nz = -lnx * s + lnz * c;
    return t0;
  }

  // centre of the doorway (closed panel centre)
  centre(out) {
    out.x = this.hx + this.dx * this.w / 2; out.z = this.hz + this.dz * this.w / 2; out.y = this.y;
    return out;
  }

  // Validation: the swept panel must land over walkable floor at the door's base height and
  // not intersect static geometry, for both swing directions.
  validate(world) {
    const problems = [];
    for (const s of [1, -1]) {
      for (const frac of [0.35, 0.7, 1.0]) {
        const ang = this.baseRot + s * DOOR_OPEN_ANGLE * frac;
        const c = Math.cos(ang), sn = Math.sin(ang);
        for (const f of [0.3, 0.55, 0.8, 0.97]) {
          const lx = this.w * f;
          const px = this.hx + lx * c, pz = this.hz - lx * sn;
          if (frac === 1.0) {
            const g = world.groundAt(px, pz, 0.05, this.y + 0.3);
            if (!(Math.abs(g - this.y) < 0.07)) problems.push(`${this.name}: swing ${s > 0 ? '+' : '-'} lands over y=${g.toFixed(2)} (door base ${this.y}) at ${px.toFixed(2)},${pz.toFixed(2)}`);
          }
          for (const hy of [0.4, 1.2, 1.9]) {
            const b = world.pointBlocked(px, this.y + hy, pz, F_MOVE);
            if (b && b.tag !== 'doorway') problems.push(`${this.name}: swing ${s > 0 ? '+' : '-'} hits ${b.tag || 'box'} at ${px.toFixed(2)},${(this.y + hy).toFixed(2)},${pz.toFixed(2)}`);
          }
        }
      }
    }
    return problems;
  }
}

const _loc = { x: 0, z: 0 };
export const _doorHit = { nx: 0, ny: 0, nz: 0 };
