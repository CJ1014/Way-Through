// Instanced world effects. Each family is ONE InstancedMesh (one draw call) using a shared
// role material, so a style switch recolours them without touching their state.
import * as THREE from '../vendor/three/three.module.js';
import { Builder, mergeAll } from './builder.js';
import { buildStarburst } from './viewmodel.js';
import { mulberry32 } from './util.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _d = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
const _e = new THREE.Euler();
const _zAxis = new THREE.Vector3(0, 0, 1);

function inst(geo, mat, max, scene, name) {
  const m = new THREE.InstancedMesh(geo, mat, max);
  m.name = name;
  m.count = 0;
  m.frustumCulled = false;
  m.castShadow = false;
  m.receiveShadow = false;
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(m);
  return m;
}

// Ink splat: a disc plus droplets flung around it (flat cylinders, unit radius).
function splatGeometry(seed, lobes, drops) {
  const B = new Builder();
  const r = mulberry32(seed);
  const disc = (x, z, rad) => B.cylM('ink', new THREE.Matrix4().makeTranslation(x, 0, z), rad, rad, 0.002, 14, { edges: false });
  disc(0, 0, 0.62);
  for (let i = 0; i < lobes; i++) {
    const a = (i / lobes) * Math.PI * 2 + r() * 0.6;
    const d = 0.42 + r() * 0.25;
    disc(Math.cos(a) * d, Math.sin(a) * d, 0.2 + r() * 0.2);
  }
  for (let i = 0; i < drops; i++) {
    const a = r() * Math.PI * 2;
    const d = 0.95 + r() * 0.9;
    disc(Math.cos(a) * d, Math.sin(a) * d, 0.05 + r() * 0.09);
    if (r() < 0.5) disc(Math.cos(a) * (d - 0.2), Math.sin(a) * (d - 0.2), 0.035 + r() * 0.04);
  }
  return mergeAll(B);
}

function teardropGeometry() {
  // round-ish head + long tail, both cones, pointing along +Y (travel direction)
  const B = new Builder();
  B.cylM('bulletE', new THREE.Matrix4().makeTranslation(0, 0.3, 0), 0, 1, 0.6, 10, { edges: false });
  B.cylM('bulletE', new THREE.Matrix4().makeTranslation(0, -2.0, 0), 1, 0, 4.0, 10, { edges: false });
  return mergeAll(B);
}

export class Effects {
  constructor(scene, materials, world) {
    this.scene = scene;
    this.mats = materials;
    this.world = world;
    const M = materials.m;
    const splat = splatGeometry(11, 6, 7);
    const bloodSplat = splatGeometry(23, 7, 11);
    const pool = splatGeometry(5, 8, 3);
    this.inkDecals = inst(splat, M.ink, 360, scene, 'fx:inkDecals');
    this.bloodDecals = inst(bloodSplat, M.blood, 260, scene, 'fx:bloodDecals');
    this.pools = inst(pool, M.blood, 24, scene, 'fx:bloodPools');
    const box = new THREE.BoxGeometry(1, 1, 1);
    this.debris = inst(box, M.debris, 400, scene, 'fx:debris');
    this.drops = inst(new THREE.BoxGeometry(1, 1, 1), M.blood, 400, scene, 'fx:blood');
    const tracerGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    this.tracersP = inst(tracerGeo, M.tracerP, 64, scene, 'fx:tracersP');
    this.tracersE = inst(tracerGeo, M.tracerE, 128, scene, 'fx:tracersE');
    this.bulletsE = inst(teardropGeometry(), M.bulletE, 128, scene, 'fx:bulletsE');
    const fb = new Builder();
    buildStarburst(fb, 1);
    // split the starburst by material role into two instanced meshes
    const outer = [], inner = [];
    for (const g of fb.groups.values()) (g.role === 'flashOuter' ? outer : inner).push(...g.list);
    fb.groups.clear();
    const merge = (list) => { const b = new Builder(); b.groups.set('x', { role: 'ink', cast: false, list }); return mergeAll(b); };
    this.flashOuter = inst(merge(outer), M.flashOuter, 24, scene, 'fx:flashOuter');
    this.flashInner = inst(merge(inner), M.flashInner, 24, scene, 'fx:flashInner');

    this.inkN = 0; this.bloodN = 0;
    this.poolList = [];
    this.parts = [];      // debris + blood particles
    this.tracers = [];    // player tracers
    this.flashes = [];
    this.decalCount = 0;
  }

  reset() {
    this.inkN = 0; this.bloodN = 0; this.decalCount = 0;
    this.inkDecals.count = 0; this.bloodDecals.count = 0;
    this.poolList.length = 0; this.pools.count = 0;
    this.parts.length = 0; this.tracers.length = 0; this.flashes.length = 0;
    for (const m of [this.debris, this.drops, this.tracersP, this.tracersE, this.bulletsE, this.flashOuter, this.flashInner]) m.count = 0;
  }

  _decal(mesh, idxName, x, y, z, nx, ny, nz, size, stretch = 1, stretchDir = null) {
    const i = this[idxName] % mesh.instanceMatrix.count;
    this[idxName]++;
    _d.set(nx, ny, nz);
    _q.setFromUnitVectors(_up, _d);
    _q2.setFromAxisAngle(_up, Math.random() * Math.PI * 2);
    if (stretchDir) {
      // orient the long axis along the projected spray direction
      const local = stretchDir.clone().applyQuaternion(_q.clone().invert());
      _q2.setFromAxisAngle(_up, Math.atan2(-local.z, local.x));
    }
    _q.multiply(_q2);
    _p.set(x + nx * 0.006, y + ny * 0.006, z + nz * 0.006);
    _s.set(size * stretch, 1, size / Math.sqrt(stretch));
    _m.compose(_p, _q, _s);
    mesh.setMatrixAt(i, _m);
    mesh.count = Math.min(this[idxName], mesh.instanceMatrix.count);
    mesh.instanceMatrix.needsUpdate = true;
    this.decalCount++;
  }

  // Black ink splat + flying debris at a bullet impact.
  impact(x, y, z, nx, ny, nz, big = 1) {
    if (big > 0) this._decal(this.inkDecals, 'inkN', x, y, z, nx, ny, nz, (0.07 + Math.random() * 0.05) * big);
    const n = 5 + Math.floor(Math.random() * 4);
    for (let k = 0; k < n; k++) {
      const s = 0.015 + Math.random() * 0.03;
      this._part('debris', x + nx * 0.02, y + ny * 0.02, z + nz * 0.02,
        nx * (1.5 + Math.random() * 3) + (Math.random() - 0.5) * 3,
        ny * (1.5 + Math.random() * 3) + Math.random() * 2.5,
        nz * (1.5 + Math.random() * 3) + (Math.random() - 0.5) * 3, s, 0.6 + Math.random() * 0.6, false);
    }
  }

  // Blood on a surface (walls behind a hit, floor under a body).
  bloodSplat(x, y, z, nx, ny, nz, size, dir) {
    this._decal(this.bloodDecals, 'bloodN', x, y, z, nx, ny, nz, size, dir ? 1.6 : 1, dir || null);
  }

  // Red spray out of a wound, along the bullet direction.
  bloodSpray(x, y, z, dx, dy, dz, count = 14, force = 1) {
    for (let k = 0; k < count; k++) {
      // a cone of droplets out of the exit side, plus a few slower ones back toward the shooter
      const back = k % 5 === 0 ? -0.35 : 1;
      const sp = (2 + Math.random() * 4.5) * force * back;
      const s = 0.02 + Math.random() * 0.04;
      this._part('blood', x, y, z,
        dx * sp + (Math.random() - 0.5) * 2.2, dy * sp + Math.random() * 2.4 - 0.4, dz * sp + (Math.random() - 0.5) * 2.2,
        s, 0.9 + Math.random() * 0.7, true);
    }
  }

  bloodPool(x, y, z, maxR) {
    if (this.poolList.length >= this.pools.instanceMatrix.count) this.poolList.shift();
    this.poolList.push({ x, y: y + 0.004 + this.poolList.length * 0.0004, z, r: 0.05, maxR, rot: Math.random() * 6.28 });
  }

  _part(kind, x, y, z, vx, vy, vz, size, life, isBlood) {
    if (this.parts.length > 700) this.parts.shift();
    this.parts.push({ kind, x, y, z, vx, vy, vz, size, life, age: 0, rx: Math.random() * 3, ry: Math.random() * 3, rest: false, isBlood, stuck: false });
  }

  tracer(ax, ay, az, bx, by, bz) {
    if (this.tracers.length > 60) this.tracers.shift();
    const len = Math.hypot(bx - ax, by - ay, bz - az);
    this.tracers.push({ ax, ay, az, bx, by, bz, len, t: 0 });
  }

  enemyFlash(x, y, z) {
    if (this.flashes.length > 20) this.flashes.shift();
    this.flashes.push({ x, y, z, t: 0.055, roll: Math.random() * 6.28, s: 0.8 + Math.random() * 0.5 });
  }

  update(dt, camera, bullets) {
    const world = this.world;
    // particles
    let nd = 0, nb = 0;
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.age += dt;
      if (p.age > p.life + (p.rest ? 2.5 : 0)) { this.parts.splice(i, 1); continue; }
      if (!p.rest) {
        p.vy -= 14 * dt;
        const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt, nz = p.z + p.vz * dt;
        const g = world.groundAt(nx, nz, 0.01, p.y + 0.01);
        if (ny <= g) {
          p.y = g + 0.002; p.x = nx; p.z = nz; p.rest = true;
          if (p.isBlood && Math.random() < 0.45) this.bloodSplat(p.x, g, p.z, 0, 1, 0, 0.04 + Math.random() * 0.05);
        } else {
          const b = world.pointBlocked(nx, ny, nz, 2);
          if (b) {
            if (p.isBlood && !p.stuck) {
              // droplet splashes onto the wall it hit
              const vl = Math.hypot(p.vx, p.vy, p.vz) || 1;
              const h = world.raycast(p.x, p.y, p.z, p.vx / vl, p.vy / vl, p.vz / vl, vl * dt + 0.15, 2);
              if (h && Math.random() < 0.6) this.bloodSplat(h.x, h.y, h.z, h.nx, h.ny, h.nz, 0.03 + Math.random() * 0.04);
              p.stuck = true;
            }
            p.vx *= -0.2; p.vz *= -0.2; p.vy *= 0.3;
          } else { p.x = nx; p.y = ny; p.z = nz; }
          p.rx += dt * 9; p.ry += dt * 7;
        }
      }
      const fade = p.rest ? Math.max(0, 1 - Math.max(0, p.age - p.life) / 2.5) : 1;
      const s = p.size * fade;
      _q.setFromEuler(_e.set(p.rx, p.ry, 0));
      _m.compose(_p.set(p.x, p.y, p.z), _q, _s.set(s, p.rest ? s * 0.3 : s, s));
      if (p.kind === 'blood') { if (nb < 400) this.drops.setMatrixAt(nb++, _m); }
      else if (nd < 400) this.debris.setMatrixAt(nd++, _m);
    }
    this.debris.count = nd; this.drops.count = nb;
    this.debris.instanceMatrix.needsUpdate = true; this.drops.instanceMatrix.needsUpdate = true;

    // blood pools grow under bodies
    for (let i = 0; i < this.poolList.length; i++) {
      const pl = this.poolList[i];
      pl.r += (pl.maxR - pl.r) * (1 - Math.exp(-0.55 * dt));
      _q.setFromAxisAngle(_up, pl.rot);
      _m.compose(_p.set(pl.x, pl.y, pl.z), _q, _s.set(pl.r, 1, pl.r * 0.85));
      this.pools.setMatrixAt(i, _m);
    }
    this.pools.count = this.poolList.length;
    this.pools.instanceMatrix.needsUpdate = true;

    // player tracers: a 4 m streak racing from the muzzle to the hit
    const neo = this.mats.style === 'neo';
    const tw = neo ? 0.02 : 0.009;
    let nt = 0;
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.t += dt;
      // head and tail both race along the path; the tail starts 5 m behind the head, so the
      // streak always finishes even when the target is closer than 5 m
      const head = Math.min(t.len, t.t * 420);
      const tail = Math.max(0, t.t * 420 - 5);
      if (tail >= t.len - 0.01 || t.t > 1) { this.tracers.splice(i, 1); continue; }
      const k0 = tail / t.len, k1 = head / t.len;
      const x0 = t.ax + (t.bx - t.ax) * k0, y0 = t.ay + (t.by - t.ay) * k0, z0 = t.az + (t.bz - t.az) * k0;
      const x1 = t.ax + (t.bx - t.ax) * k1, y1 = t.ay + (t.by - t.ay) * k1, z1 = t.az + (t.bz - t.az) * k1;
      segMatrix(x0, y0, z0, x1, y1, z1, tw, _m);
      this.tracersP.setMatrixAt(nt++, _m);
    }
    this.tracersP.count = nt; this.tracersP.instanceMatrix.needsUpdate = true;

    // enemy bullets: fat teardrops + a short trailing streak
    let nbul = 0, nte = 0;
    // fat enough to see coming head-on and step aside from (head ~0.2 m across, tail ~0.4 m)
    const bs = neo ? 0.105 : 0.1;
    for (const b of bullets) {
      if (!b.alive) continue;
      const sp = Math.hypot(b.vx, b.vy, b.vz);
      const dx = b.vx / sp, dy = b.vy / sp, dz = b.vz / sp;
      _d.set(dx, dy, dz);
      _q.setFromUnitVectors(_up, _d);
      _m.compose(_p.set(b.x, b.y, b.z), _q, _s.set(bs, bs, bs));
      if (nbul < 128) this.bulletsE.setMatrixAt(nbul++, _m);
      const L = Math.min(2.2, b.age * sp);
      if (L > 0.2 && nte < 128) {
        segMatrix(b.x - dx * (L + 0.2), b.y - dy * (L + 0.2), b.z - dz * (L + 0.2), b.x - dx * 0.2, b.y - dy * 0.2, b.z - dz * 0.2, neo ? 0.022 : 0.012, _m);
        this.tracersE.setMatrixAt(nte++, _m);
      }
    }
    this.bulletsE.count = nbul; this.tracersE.count = nte;
    this.bulletsE.instanceMatrix.needsUpdate = true; this.tracersE.instanceMatrix.needsUpdate = true;

    // enemy muzzle flashes: billboards
    let nf = 0;
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.t -= dt;
      if (f.t <= 0) { this.flashes.splice(i, 1); continue; }
      _q.copy(camera.quaternion).multiply(_q2.setFromAxisAngle(_zAxis, f.roll));
      const s = f.s * 1.6;
      _m.compose(_p.set(f.x, f.y, f.z), _q, _s.set(s, s, s));
      this.flashOuter.setMatrixAt(nf, _m); this.flashInner.setMatrixAt(nf, _m); nf++;
    }
    this.flashOuter.count = nf; this.flashInner.count = nf;
    this.flashOuter.instanceMatrix.needsUpdate = true; this.flashInner.instanceMatrix.needsUpdate = true;
  }

  snapshot() {
    return { ink: Math.min(this.inkN, 360), blood: Math.min(this.bloodN, 260), pools: this.poolList.length, pools_r: this.poolList.map((p) => +p.r.toFixed(3)) };
  }
}

// Matrix that stretches a unit cylinder (Y axis, height 1) between two points.
export function segMatrix(x0, y0, z0, x1, y1, z1, r, out) {
  _d.set(x1 - x0, y1 - y0, z1 - z0);
  const len = _d.length();
  if (len < 1e-6) return out.copy(_zero);
  _d.divideScalar(len);
  _q.setFromUnitVectors(_up, _d);
  return out.compose(_p.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), _q, _s.set(r, len, r));
}
