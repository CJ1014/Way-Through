// Stickman enemies: solid black, big round head, thick limbs, one white eye with a pupil.
// Rendering is fully instanced (limbs, joints, heads, eyes, pupils, rims, guns per type).
//
// AI: idle/patrol --(awareness builds while they can see you)--> combat (face, aim, burst
// fire, strafe) --(lose sight)--> chase last known position with waypoint A* (opening doors)
// --> search the area --> return. They hear gunfire (quieter through walls) and alert allies.
import * as THREE from '../vendor/three/three.module.js';
import { segMatrix } from './effects.js';
import { Builder, mergeAll } from './builder.js';
import { GUN_BUILDERS, GUN_INFO } from './gunmodels.js';
import { WEAPONS, ENEMY_HEALTH, SNIPER, HEADSHOT_MULT } from './weapons.js';
import { F_MOVE, F_BULLET, pushCircleOutOfRect, circleOverlapsRect } from './collision.js';
import { clamp, damp, dampAngle, wrapAngle, rand, raySphere, rayCapsule } from './util.js';
import { walkClear } from './nav.js';

export const J = { HEAD: 0, NECK: 1, PELVIS: 2, LELB: 3, LHAND: 4, RELB: 5, RHAND: 6, LKNEE: 7, LFOOT: 8, RKNEE: 9, RFOOT: 10 };
const NJ = 11;
export const HEAD_R = 0.165;
// [a, b, radius]  (thick limbs)
const BONES = [
  [1, 2, 0.08], [0, 1, 0.042],
  [1, 3, 0.052], [3, 4, 0.047], [1, 5, 0.052], [5, 6, 0.047],
  [2, 7, 0.064], [7, 8, 0.058], [2, 9, 0.064], [9, 10, 0.058],
];
const JOINT_R = [0, 0.07, 0.078, 0.052, 0.054, 0.052, 0.054, 0.064, 0.064, 0.064, 0.064];
const L_UP = 0.3, L_FORE = 0.29, L_THIGH = 0.47, L_SHIN = 0.47;
const RADIUS = 0.3;
const MAX_ENEMIES = 20;
const MAX_PICKUPS = 24;
const GUN_TYPES = ['smg', 'shotgun', 'rifle', 'pistol'];
const PICKUP_NAMES = { smg: 'SMG', shotgun: 'Shotgun', rifle: 'Rifle', pistol: 'Pistol' };

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _pos = { x: 0, z: 0 };
const _eul = new THREE.Euler();

// Two-bone IK: root a, target t, pole direction p -> writes elbow into out (array offset o)
function ik(ax, ay, az, tx, ty, tz, l1, l2, px, py, pz, out, o, outT, oT) {
  let dx = tx - ax, dy = ty - ay, dz = tz - az;
  let d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const maxD = l1 + l2 - 0.001;
  if (d < 1e-4) { dx = 0; dy = -1; dz = 0; d = 1e-4; }
  const nx = dx / d, ny = dy / d, nz = dz / d;
  if (d > maxD) { d = maxD; if (outT) { outT[oT] = ax + nx * d; outT[oT + 1] = ay + ny * d; outT[oT + 2] = az + nz * d; } }
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const pd = px * nx + py * ny + pz * nz;
  let qx = px - nx * pd, qy = py - ny * pd, qz = pz - nz * pd;
  const ql = Math.sqrt(qx * qx + qy * qy + qz * qz) || 1;
  qx /= ql; qy /= ql; qz /= ql;
  out[o] = ax + nx * a + qx * h; out[o + 1] = ay + ny * a + qy * h; out[o + 2] = az + nz * a + qz * h;
}

export class Enemy {
  constructor(spawn, index) {
    this.spawn = spawn;
    this.index = index;
    this.j = new Float32Array(NJ * 3);
    this.rp = new Float32Array(NJ * 3);
    this.rq = new Float32Array(NJ * 3);
    this.reset();
  }

  reset() {
    const s = this.spawn;
    this.x = s.x; this.y = s.y; this.z = s.z;
    this.yaw = s.yaw || 0; this.lookYaw = this.yaw; this.pitch = 0;
    this.vx = 0; this.vz = 0; this.speed = 0;
    this.weapon = s.weapon;
    this.w = WEAPONS[s.weapon];
    this.health = ENEMY_HEALTH;
    this.alive = true;
    this.state = s.patrol ? 'patrol' : 'idle';
    this.awareness = 0;
    this.lastKnown = { x: s.x, y: s.y, z: s.z };
    this.lastSeenT = -99;
    this.canSee = false;
    this.seeT = 0;
    this.perceiveT = Math.random() * 0.1;
    this.path = null; this.pathI = 0; this.pathGoal = null; this.repathT = 0;
    this.patrolI = 0; this.waitT = rand(0.5, 2);
    this.fireT = rand(0.4, 0.8); this.burstLeft = 0; this.reactT = 0;
    this.strafeDir = Math.random() < 0.5 ? -1 : 1; this.strafeT = rand(0.8, 1.8);
    this.searchT = 0; this.searchGoal = null;
    this.flinch = 0; this.flinchT = 0;
    this.walkPhase = Math.random() * 6;
    this.stuckT = 0; this.doorWait = null;
    this.deadT = 0; this.sleeping = false; this.pooled = false;
    this.lookOsc = Math.random() * 6;
    this.alertedBy = null;
    this.hurtDir = 0;
    this.acc = 0;
    this.patrolPts = s.patrol ? s.patrol.map((p) => ({ x: p[0], y: s.y, z: p[1] })) : null;
    this.pose();
  }

  get headX() { return this.j[0]; }
  get headY() { return this.j[1]; }
  get headZ() { return this.j[2]; }

  // ---------------------------------------------------------------- pose (alive)
  pose() {
    const j = this.j;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const x = this.x, y = this.y, z = this.z;
    const combat = this.state === 'combat';
    const lean = combat ? 0.05 : 0.015;
    const bob = Math.abs(Math.sin(this.walkPhase)) * 0.03 * Math.min(1, this.speed / 2);
    // pelvis, neck, head
    j[6] = x; j[7] = y + 0.95 + bob; j[8] = z;
    j[3] = x + fx * lean; j[4] = y + 1.45 + bob; j[5] = z + fz * lean;
    const lx = -Math.sin(this.lookYaw), lz = -Math.cos(this.lookYaw);
    j[0] = j[3] + lx * 0.03; j[1] = j[4] + 0.2; j[2] = j[5] + lz * 0.03;
    // legs: walk cycle
    const k = Math.min(1, this.speed / 2.4);
    const stride = 0.3 * k;
    for (const side of [-1, 1]) {
      const ph = this.walkPhase + (side > 0 ? Math.PI : 0);
      const s = Math.sin(ph), c = Math.cos(ph);
      const hx = j[6] + rx * side * 0.1, hy = j[7] - 0.02, hz = j[8] + rz * side * 0.1;
      const footX = x + rx * side * 0.13 + fx * s * stride;
      const footZ = z + rz * side * 0.13 + fz * s * stride;
      const footY = y + 0.058 + Math.max(0, c) * 0.13 * k;
      const fo = side < 0 ? 8 * 3 : 10 * 3, ko = side < 0 ? 7 * 3 : 9 * 3;
      j[fo] = footX; j[fo + 1] = footY; j[fo + 2] = footZ;
      ik(hx, hy, hz, footX, footY, footZ, L_THIGH, L_SHIN, fx, 0.2, fz, j, ko, j, fo);
    }
    // arms: hold the gun toward the aim direction
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const ax = fx * cp, ay = sp, az = fz * cp;
    const sx = j[3], sy = j[4] - 0.04, sz = j[5];
    let rhx, rhy, rhz, lhx, lhy, lhz;
    const pistol = this.weapon === 'pistol';
    if (combat || this.state === 'chase' || this.state === 'search') {
      rhx = sx + ax * 0.34 + rx * 0.07; rhy = sy - 0.1 + ay * 0.34; rhz = sz + az * 0.34 + rz * 0.07;
      if (pistol) { lhx = rhx - rx * 0.06 - ax * 0.02; lhy = rhy - 0.02; lhz = rhz - rz * 0.06 - az * 0.02; }
      else { lhx = rhx + ax * 0.24 - rx * 0.06; lhy = rhy + ay * 0.24 + 0.01; lhz = rhz + az * 0.24 - rz * 0.06; }
    } else {
      // relaxed: gun held low across the body
      rhx = sx + fx * 0.22 + rx * 0.12; rhy = sy - 0.42; rhz = sz + fz * 0.22 + rz * 0.12;
      lhx = rhx + fx * 0.18 - rx * 0.2; lhy = rhy + 0.14; lhz = rhz + fz * 0.18 - rz * 0.2;
      if (pistol) { lhx = sx - rx * 0.16 + fx * 0.05; lhy = sy - 0.52; lhz = sz - rz * 0.16 + fz * 0.05; }
    }
    // hit reaction: both arms fly up
    const f = this.flinch;
    if (f > 0.001) {
      const ux = sx + rx * 0.2 + fx * 0.02, uy = sy + 0.5, uz = sz + rz * 0.2 + fz * 0.02;
      const vx = sx - rx * 0.2 + fx * 0.02, vz = sz - rz * 0.2 + fz * 0.02;
      rhx += (ux - rhx) * f; rhy += (uy - rhy) * f; rhz += (uz - rhz) * f;
      lhx += (vx - lhx) * f; lhy += (uy - lhy) * f; lhz += (vz - lhz) * f;
    }
    j[18] = rhx; j[19] = rhy; j[20] = rhz;
    j[12] = lhx; j[13] = lhy; j[14] = lhz;
    const out = f > 0.3 ? 0.5 : -0.6; // elbows point out when flailing, down otherwise
    ik(sx, sy, sz, rhx, rhy, rhz, L_UP, L_FORE, rx * 0.8, out, rz * 0.8, j, 15, j, 18);
    ik(sx, sy, sz, lhx, lhy, lhz, L_UP, L_FORE, -rx * 0.8, out, -rz * 0.8, j, 9, j, 12);
    // pull shoulders to the neck point
    void ay;
  }

  aimDir(out) {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  muzzle(out) {
    this.aimDir(_v3);
    const j = this.j;
    const len = this.weapon === 'shotgun' ? 0.66 : this.weapon === 'rifle' ? 0.63 : this.weapon === 'pistol' ? 0.15 : 0.34;
    return out.set(j[18] + _v3.x * len, j[19] + 0.05 + _v3.y * len, j[20] + _v3.z * len);
  }

  // ---------------------------------------------------------------- ragdoll
  startRagdoll(ix, iy, iz, boneHit) {
    const p = this.rp, q = this.rq;
    p.set(this.j);
    // inherit walking velocity + bullet impulse on the struck bone
    const dt = 1 / 60;
    for (let i = 0; i < NJ; i++) {
      q[i * 3] = p[i * 3] - this.vx * dt;
      q[i * 3 + 1] = p[i * 3 + 1];
      q[i * 3 + 2] = p[i * 3 + 2] - this.vz * dt;
    }
    this.impulse(ix, iy, iz, boneHit, 1);
    this.sleeping = false;
    this.deadT = 0;
    this.restLen = BONES.map(([a, b]) => Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]));
    this.spine = Math.hypot(p[0] - p[6], p[1] - p[7], p[2] - p[8]);
  }

  impulse(ix, iy, iz, bone, k) {
    const p = this.rp, q = this.rq, dt = 1 / 60;
    const pts = bone == null ? [1, 2] : bone === -1 ? [0, 1] : [BONES[bone][0], BONES[bone][1]];
    for (const i of pts) {
      q[i * 3] -= ix * dt * k; q[i * 3 + 1] -= iy * dt * k; q[i * 3 + 2] -= iz * dt * k;
    }
    // everything gets a little of it
    for (let i = 0; i < NJ; i++) { q[i * 3] -= ix * dt * 0.3 * k; q[i * 3 + 2] -= iz * dt * 0.3 * k; }
    this.sleeping = false;
    void p;
  }

  // fixed 60 Hz verlet steps so the collapse looks the same at any frame rate
  stepRagdoll(dt, world) {
    if (this.sleeping) return;
    this.deadT += dt;
    this.acc = Math.min(this.acc + dt, 3 / 60);
    while (this.acc >= 1 / 60) { this.acc -= 1 / 60; this._verlet(1 / 60, world); if (this.sleeping) break; }
  }

  _verlet(dt, world) {
    const p = this.rp, q = this.rq;
    const g = -13 * dt * dt;
    let maxMove = 0;
    for (let i = 0; i < NJ * 3; i += 3) {
      const vx = (p[i] - q[i]) * 0.985, vy = (p[i + 1] - q[i + 1]) * 0.985, vz = (p[i + 2] - q[i + 2]) * 0.985;
      q[i] = p[i]; q[i + 1] = p[i + 1]; q[i + 2] = p[i + 2];
      p[i] += vx; p[i + 1] += vy + g; p[i + 2] += vz;
      maxMove = Math.max(maxMove, Math.abs(vx) + Math.abs(vy) + Math.abs(vz));
    }
    for (let it = 0; it < 8; it++) {
      for (let b = 0; b < BONES.length; b++) dist(p, BONES[b][0], BONES[b][1], this.restLen[b], 1);
      dist(p, 0, 2, this.spine, 0.6);
      minDist(p, 7, 9, 0.2); minDist(p, 8, 10, 0.18); minDist(p, 4, 2, 0.22); minDist(p, 6, 2, 0.22);
      minDist(p, 0, 7, 0.55); minDist(p, 0, 9, 0.55); minDist(p, 4, 6, 0.12); minDist(p, 0, 4, 0.18); minDist(p, 0, 6, 0.18);
      for (let i = 0; i < NJ; i++) {
        const o = i * 3;
        const rad = i === 0 ? HEAD_R : JOINT_R[i] * 0.9;
        const gnd = world.groundAt(p[o], p[o + 2], 0.02, p[o + 1] + 0.5);
        if (p[o + 1] - rad < gnd) {
          p[o + 1] = gnd + rad;
          // friction
          q[o] += (p[o] - q[o]) * 0.35; q[o + 2] += (p[o + 2] - q[o + 2]) * 0.35;
        }
        const b = world.pointBlocked(p[o], p[o + 1], p[o + 2], F_MOVE);
        if (b && b.maxY > p[o + 1] + 0.05) pushPointOut(p, o, b);
      }
    }
    if (this.deadT > 0.6 && maxMove < 0.0015) this.calmT = (this.calmT || 0) + dt; else this.calmT = 0;
    if (this.deadT > 6 || this.calmT > 0.5) this.sleeping = true;
  }
}

function dist(p, a, b, len, k) {
  const ao = a * 3, bo = b * 3;
  const dx = p[bo] - p[ao], dy = p[bo + 1] - p[ao + 1], dz = p[bo + 2] - p[ao + 2];
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
  const diff = ((d - len) / d) * 0.5 * k;
  p[ao] += dx * diff; p[ao + 1] += dy * diff; p[ao + 2] += dz * diff;
  p[bo] -= dx * diff; p[bo + 1] -= dy * diff; p[bo + 2] -= dz * diff;
}
function minDist(p, a, b, len) {
  const ao = a * 3, bo = b * 3;
  const dx = p[bo] - p[ao], dy = p[bo + 1] - p[ao + 1], dz = p[bo + 2] - p[ao + 2];
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (d >= len || d < 1e-6) return;
  const diff = ((d - len) / d) * 0.5;
  p[ao] += dx * diff; p[ao + 1] += dy * diff; p[ao + 2] += dz * diff;
  p[bo] -= dx * diff; p[bo + 1] -= dy * diff; p[bo + 2] -= dz * diff;
}
function pushPointOut(p, o, b) {
  const x = p[o], y = p[o + 1], z = p[o + 2];
  const d = [x - b.minX, b.maxX - x, y - b.minY, b.maxY - y, z - b.minZ, b.maxZ - z];
  let mi = 0;
  for (let i = 1; i < 6; i++) if (d[i] < d[mi]) mi = i;
  const e = 0.01;
  if (mi === 0) p[o] = b.minX - e; else if (mi === 1) p[o] = b.maxX + e;
  else if (mi === 2) p[o + 1] = b.minY - e; else if (mi === 3) p[o + 1] = b.maxY + e;
  else if (mi === 4) p[o + 2] = b.minZ - e; else p[o + 2] = b.maxZ + e;
}

// ======================================================================= manager
export class EnemyManager {
  constructor(game, spawns) {
    this.G = game;
    this.list = spawns.map((s, i) => new Enemy(s, i));
    this.pickups = [];
    this._buildMeshes(game.scene, game.materials);
  }

  reset() {
    for (const e of this.list) e.reset();
    this.pickups.length = 0;
  }

  _buildMeshes(scene, materials) {
    const M = materials.m;
    const mk = (geo, mat, n, name, cast = true, shareFrom = null) => {
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.name = name; m.count = 0; m.frustumCulled = false;
      m.castShadow = cast; m.receiveShadow = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (shareFrom) m.instanceMatrix = shareFrom.instanceMatrix;
      scene.add(m);
      return m;
    };
    const limbGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
    const sphere = new THREE.SphereGeometry(1, 12, 9);
    const head = new THREE.SphereGeometry(1, 18, 14);
    const disc = new THREE.CylinderGeometry(1, 1, 1, 16);
    this.mLimbs = mk(limbGeo, M.enemy, MAX_ENEMIES * BONES.length, 'enemy:limbs');
    this.mJoints = mk(sphere, M.enemy, MAX_ENEMIES * NJ, 'enemy:joints');
    this.mHeads = mk(head, M.enemy, MAX_ENEMIES, 'enemy:heads');
    this.mEyes = mk(disc, M.enemyEye, MAX_ENEMIES, 'enemy:eyes', false);
    this.mPupils = mk(disc, M.enemyPupil, MAX_ENEMIES, 'enemy:pupils', false);
    // white rim (Neobrutalist) shares the instance matrices of the body parts
    this.mRimLimbs = mk(limbGeo, M.enemyRim, MAX_ENEMIES * BONES.length, 'enemy:rimLimbs', false, this.mLimbs);
    this.mRimJoints = mk(sphere, M.enemyRim, MAX_ENEMIES * NJ, 'enemy:rimJoints', false, this.mJoints);
    this.mRimHeads = mk(head, M.enemyRim, MAX_ENEMIES, 'enemy:rimHeads', false, this.mHeads);
    this.mGuns = {};
    for (const t of GUN_TYPES) {
      const B = new Builder();
      GUN_BUILDERS[t].main(B);
      for (const fn of Object.values(GUN_BUILDERS[t].parts)) fn(B);
      this.mGuns[t] = mk(mergeAll(B), M.enemyGun, MAX_ENEMIES + MAX_PICKUPS, 'gun:' + t);
    }
  }

  get alive() { return this.list.filter((e) => e.alive).length; }

  // ------------------------------------------------------------------ update
  update(dt) {
    const G = this.G;
    for (const e of this.list) {
      if (e.alive) this._think(e, dt);
      else e.stepRagdoll(dt, G.world);
      if (!e.alive && !e.pooled && e.deadT > 0.35) {
        // blood pool grows under the body once it's down
        e.pooled = true;
        const p = e.rp;
        const gx = (p[3] + p[6]) / 2, gz = (p[5] + p[8]) / 2;
        const gy = G.world.groundAt(gx, gz, 0.05, p[7] + 0.3);
        if (gy > -1e9) G.fx.bloodPool(gx, gy, gz, 0.55 + Math.random() * 0.35);
      }
    }
    this._separate();
    this._updatePickups(dt);
    this._render();
  }

  _separate() {
    const L = this.list, P = this.G.player;
    for (let i = 0; i < L.length; i++) {
      const a = L[i];
      if (!a.alive) continue;
      for (let k = i + 1; k < L.length; k++) {
        const b = L[k];
        if (!b.alive || Math.abs(a.y - b.y) > 1) continue;
        const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
        if (d < 0.62 && d > 1e-4) { const push = (0.62 - d) / 2 / d; a.x -= dx * push; a.z -= dz * push; b.x += dx * push; b.z += dz * push; }
      }
      if (P.alive && Math.abs(a.y - P.pos.y) < 1.2) {
        const dx = a.x - P.pos.x, dz = a.z - P.pos.z, d = Math.hypot(dx, dz);
        if (d < 0.64 && d > 1e-4) { const push = (0.64 - d) / d; a.x += dx * push; a.z += dz * push; }
      }
    }
  }

  // ------------------------------------------------------------------ perception
  _perceive(e) {
    const G = this.G, P = G.player;
    e.canSee = false;
    if (!P.alive || this.passive) return;
    const ex = e.j[0], ey = e.j[1], ez = e.j[2];
    const dx = P.pos.x - e.x, dz = P.pos.z - e.z;
    const dist = Math.hypot(dx, dz, P.pos.y - e.y);
    const range = e.spawn.sniper ? SNIPER.range : 46;
    if (dist > range) return;
    const fx = -Math.sin(e.lookYaw), fz = -Math.cos(e.lookYaw);
    const dl = Math.hypot(dx, dz) || 1;
    const cosA = (dx * fx + dz * fz) / dl;
    const fovCos = e.state === 'combat' ? -0.2 : 0.42; // ~130 deg cone when calm
    if (cosA < fovCos && dist > 2.2) return;
    // line of sight to head or chest
    const targets = [P.eyeY, P.pos.y + P.height * 0.55];
    for (const ty of targets) {
      if (G.lineClear(ex, ey, ez, P.pos.x, ty, P.pos.z)) { e.canSee = true; break; }
    }
    e.seeDist = dist;
    e.seeCos = cosA;
  }

  _enterCombat(e) {
    const P = this.G.player;
    e.lastKnown.x = P.pos.x; e.lastKnown.y = P.pos.y; e.lastKnown.z = P.pos.z;
    if (e.state !== 'combat') {
      e.reactT = rand(0.35, 0.65) * this.G.diff.react * (e.spawn.sniper ? 1.8 : 1);
      e.burstLeft = 0;
      if (e.state !== 'chase') this.G.audio.playAt('alert', e.x, e.y + 1.6, e.z, this.G.listener, { gain: 0.5 });
      e.state = 'combat';
      this._alertNearby(e);
    }
    e.awareness = 1;
    e.lastKnown.x = P.pos.x; e.lastKnown.y = P.pos.y; e.lastKnown.z = P.pos.z;
  }

  _alertNearby(src) {
    for (const o of this.list) {
      if (o === src || !o.alive || o.state === 'combat' || o.spawn.sniper) continue;
      // shouting carries to allies on the same floor, through at most one wall
      if (Math.abs(o.y - src.y) > 2.5) continue;
      const d = Math.hypot(o.x - src.x, o.z - src.z);
      if (d > 20) continue;
      const walls = this.G.world.countBetween(src.j[0], src.j[1], src.j[2], o.j[0], o.j[1], o.j[2], F_BULLET, 3);
      if (walls > 1 || (walls === 1 && d > 10)) continue;
      this._investigate(o, src.lastKnown.x, src.lastKnown.y, src.lastKnown.z, 0.75);
    }
  }

  _investigate(e, x, y, z, aw) {
    e.awareness = Math.max(e.awareness, aw);
    e.lastKnown.x = x; e.lastKnown.y = y; e.lastKnown.z = z;
    if (e.spawn.sniper) { e.state = 'search'; e.searchT = 6; return; }
    if (e.state !== 'combat') { e.state = 'chase'; e.path = null; e.repathT = 0; }
  }

  // Noise event (gunshot, footsteps, doors). Walls between reduce it.
  noise(x, y, z, loud, radius, kind = 'gun') {
    const G = this.G;
    if (this.passive) return;
    for (const e of this.list) {
      if (!e.alive) continue;
      const d = Math.hypot(e.x - x, e.y + 1.5 - y, e.z - z);
      if (d > radius) continue;
      let walls = G.world.countBetween(x, y, z, e.j[0], e.j[1], e.j[2], F_BULLET, 3);
      walls += G.doorsBetween(x, y, z, e.j[0], e.j[1], e.j[2]);
      const eff = loud * (1 - d / radius) * Math.pow(0.4, walls);
      if (eff < 0.12) continue;
      if (e.state === 'combat') continue;
      const err = kind === 'gun' ? Math.min(4, d * 0.08 + walls * 1.5) : 1.5;
      this._investigate(e, x + rand(-err, err), G.player.pos.y, z + rand(-err, err), kind === 'gun' ? 0.7 : 0.5);
      if (kind === 'gun' && eff > 0.55 && d < 14) e.awareness = 0.95;
    }
  }

  // ------------------------------------------------------------------ brain
  _think(e, dt) {
    const G = this.G, P = G.player;
    e.perceiveT -= dt;
    if (e.perceiveT <= 0) { e.perceiveT = 0.1; this._perceive(e); }
    e.flinchT -= dt;
    e.flinch = damp(e.flinch, e.flinchT > 0 ? 1 : 0, e.flinchT > 0 ? 30 : 7, dt);

    // awareness builds while they can see you
    if (e.canSee && e.state !== 'combat') {
      const d = e.seeDist;
      let rate = clamp(1.9 - d / 10, 0.18, 1.9) * G.diff.aware;
      if (P.crouching) rate *= 0.55;
      if (P.sprinting) rate *= 1.3;
      if (G.time - G.lastPlayerShot < 1.2) rate *= 2.2;
      if (e.seeCos < 0.75) rate *= 0.6;
      if (e.state === 'chase' || e.state === 'search' || e.state === 'suspicious') rate *= 2;
      e.awareness += rate * dt;
      if (e.awareness >= 1) this._enterCombat(e);
      else if (e.awareness > 0.35 && (e.state === 'idle' || e.state === 'patrol')) { e.state = 'suspicious'; e.susT = 3; }
    } else if (!e.canSee && (e.state === 'idle' || e.state === 'patrol' || e.state === 'suspicious')) {
      e.awareness = Math.max(0, e.awareness - 0.1 * dt);
    }
    if (e.canSee && e.state === 'combat') {
      e.lastKnown.x = P.pos.x; e.lastKnown.y = P.pos.y; e.lastKnown.z = P.pos.z;
      e.lastSeenT = G.time;
    }

    let moveX = 0, moveZ = 0, speed = 0, faceYaw = null;
    const sniper = !!e.spawn.sniper;
    switch (e.state) {
      case 'idle': {
        e.lookOsc += dt * 0.4;
        faceYaw = e.spawn.yaw + Math.sin(e.lookOsc) * 0.45;
        // wander back to post if pushed away
        const dh = Math.hypot(e.x - e.spawn.x, e.z - e.spawn.z);
        if (dh > 1.2 && !sniper) { const r = this._follow(e, e.spawn, 1.7, dt); moveX = r.x; moveZ = r.z; speed = r.s; faceYaw = null; }
        break;
      }
      case 'patrol': {
        const pts = e.patrolPts;
        const tgt = pts[e.patrolI];
        const tx = tgt.x, tz = tgt.z;
        const d = Math.hypot(tx - e.x, tz - e.z);
        if (d < 0.5) {
          e.waitT -= dt;
          e.lookOsc += dt * 0.8;
          faceYaw = e.yaw + Math.sin(e.lookOsc) * 0.02;
          if (e.waitT <= 0) { e.patrolI = (e.patrolI + 1) % pts.length; e.waitT = rand(1.2, 3.2); e.path = null; }
        } else {
          const r = this._follow(e, tgt, 1.7, dt); moveX = r.x; moveZ = r.z; speed = r.s;
        }
        break;
      }
      case 'suspicious': {
        // turn toward the thing they half-saw
        faceYaw = Math.atan2(-(P.pos.x - e.x), -(P.pos.z - e.z));
        e.susT -= dt;
        if (e.susT <= 0 && e.awareness < 0.35) e.state = e.spawn.patrol ? 'patrol' : 'idle';
        break;
      }
      case 'combat': {
        const dx = P.pos.x - e.x, dz = P.pos.z - e.z;
        const d = Math.hypot(dx, dz);
        faceYaw = Math.atan2(-dx, -dz);
        if (!e.canSee && G.time - e.lastSeenT > (sniper ? 3 : 1.1)) {
          if (sniper) { e.state = 'search'; e.searchT = 8; }
          else { e.state = 'chase'; e.path = null; e.repathT = 0; }
          break;
        }
        // aim pitch at the chest
        const ty = P.pos.y + P.height * 0.55 - (e.y + 1.35);
        e.pitch = damp(e.pitch, Math.atan2(ty, Math.max(0.5, d)), 10, dt);
        // strafe / range keeping
        if (!sniper) {
          e.strafeT -= dt;
          if (e.strafeT <= 0) { e.strafeDir = Math.random() < 0.3 ? 0 : (Math.random() < 0.5 ? -1 : 1); e.strafeT = rand(0.9, 2.2); }
          const ux = dx / (d || 1), uz = dz / (d || 1);
          let mx = -uz * e.strafeDir, mz = ux * e.strafeDir;
          const want = e.w.enemy.range * 0.55;
          if (d < 3.5) { mx -= ux; mz -= uz; } else if (d > want + 6) { mx += ux * 0.8; mz += uz * 0.8; }
          const ml = Math.hypot(mx, mz);
          if (ml > 0.01) {
            mx /= ml; mz /= ml;
            if (!this._clearAhead(e, mx, mz, 0.9)) { e.strafeDir = -e.strafeDir; e.strafeT = rand(0.8, 1.5); mx = 0; mz = 0; }
          }
          moveX = mx; moveZ = mz; speed = e.strafeDir === 0 && d < want + 6 && d > 3.5 ? 0 : 2.3;
        }
        this._shoot(e, dt, d);
        break;
      }
      case 'chase': {
        const tgt = e.lastKnown;
        const d = Math.hypot(tgt.x - e.x, tgt.z - e.z);
        if (e.canSee && e.awareness >= 1) { this._enterCombat(e); break; }
        if (d < 1.3 || (e.path && e.pathI >= e.path.length && d < 3)) { e.state = 'search'; e.searchT = rand(7, 10); e.searchGoal = null; break; }
        const r = this._follow(e, tgt, e.awareness >= 1 ? 4.2 : 3.0, dt);
        moveX = r.x; moveZ = r.z; speed = r.s;
        if (r.fail) { e.state = 'search'; e.searchT = 6; }
        break;
      }
      case 'search': {
        e.searchT -= dt;
        e.lookOsc += dt * 1.6;
        if (sniper) {
          faceYaw = e.spawn.yaw + Math.sin(e.lookOsc * 0.5) * 1.2;
          if (e.canSee && e.awareness >= 0.6) this._enterCombat(e);
          if (e.searchT <= 0) { e.state = 'idle'; e.awareness = 0.3; }
          break;
        }
        if (e.canSee && e.awareness >= 1) { this._enterCombat(e); break; }
        if (!e.searchGoal || Math.hypot(e.searchGoal.x - e.x, e.searchGoal.z - e.z) < 0.8) {
          e.searchGoal = this._pickSearchNode(e);
          e.path = null;
          e.pauseT = rand(0.6, 1.6);
        }
        if (e.pauseT > 0) { e.pauseT -= dt; faceYaw = e.yaw + Math.sin(e.lookOsc) * 0.05; }
        else if (e.searchGoal) {
          const r = this._follow(e, e.searchGoal, 2.2, dt); moveX = r.x; moveZ = r.z; speed = r.s;
          if (r.fail) e.searchGoal = null;
        }
        if (e.searchT <= 0) { e.state = 'return'; e.path = null; e.awareness = 0.3; }
        break;
      }
      case 'return': {
        if (e.canSee && e.awareness >= 1) { this._enterCombat(e); break; }
        const d = Math.hypot(e.spawn.x - e.x, e.spawn.z - e.z);
        if (d < 0.8) { e.state = e.spawn.patrol ? 'patrol' : 'idle'; e.patrolI = 0; break; }
        const r = this._follow(e, e.spawn, 1.8, dt); moveX = r.x; moveZ = r.z; speed = r.s;
        if (r.fail) e.state = 'idle';
        break;
      }
    }

    // facing
    if (faceYaw === null && speed > 0.1 && (moveX || moveZ) && e.state !== 'combat') faceYaw = Math.atan2(-moveX, -moveZ);
    if (faceYaw !== null) e.yaw = dampAngle(e.yaw, faceYaw, e.state === 'combat' ? 9 : 5, dt);
    const lookTarget = e.state === 'search' ? e.yaw + Math.sin(e.lookOsc) * 0.7 : e.yaw;
    e.lookYaw = dampAngle(e.lookYaw, lookTarget, 6, dt);
    if (e.state !== 'combat') e.pitch = damp(e.pitch, 0, 4, dt);

    // move with collisions
    const flinchSlow = e.flinchT > 0 ? 0.3 : 1;
    const tvx = moveX * speed * flinchSlow, tvz = moveZ * speed * flinchSlow;
    e.vx = damp(e.vx, tvx, 10, dt); e.vz = damp(e.vz, tvz, 10, dt);
    const ox = e.x, oz = e.z;
    e.x += e.vx * dt; e.z += e.vz * dt;
    this._collide(e);
    const moved = Math.hypot(e.x - ox, e.z - oz);
    e.speed = moved / Math.max(dt, 1e-4);
    e.walkPhase += moved * 4.4;
    if (speed > 0.5 && moved < speed * dt * 0.25) e.stuckT += dt; else e.stuckT = Math.max(0, e.stuckT - dt);
    if (e.stuckT > 1.2) { e.stuckT = 0; e.path = null; this._tryOpenDoorAhead(e); }
    e.pose();
  }

  _clearAhead(e, mx, mz, dist) {
    const W = this.G.world;
    const nx = e.x + mx * dist, nz = e.z + mz * dist;
    const g = W.groundAt(nx, nz, 0.2, e.y + 0.35);
    if (!(g > e.y - 0.35)) return false;
    const list = W.query(nx - RADIUS, nz - RADIUS, nx + RADIUS, nz + RADIUS, F_MOVE);
    for (const b of list) {
      if (b.maxY <= e.y + 0.32 || b.minY > e.y + 1.8) continue;
      if (circleOverlapsRect(nx, nz, RADIUS, b)) return false;
    }
    for (const d of this.G.doors) {
      _pos.x = nx; _pos.z = nz;
      if (d.pushCircle(_pos, RADIUS, e.y, e.y + 1.8)) return false;
    }
    return true;
  }

  _collide(e) {
    const W = this.G.world;
    const feet = e.y;
    for (let it = 0; it < 3; it++) {
      let moved = false;
      const list = W.query(e.x - RADIUS - 0.05, e.z - RADIUS - 0.05, e.x + RADIUS + 0.05, e.z + RADIUS + 0.05, F_MOVE);
      for (const b of list) {
        if (b.maxY <= feet + 0.32 || b.minY >= feet + 1.8) continue;
        if (pushCircleOutOfRect(e, RADIUS, b.minX, b.minZ, b.maxX, b.maxZ)) moved = true;
      }
      for (const d of this.G.doors) if (d.pushCircle(e, RADIUS, feet + 0.05, feet + 1.8)) moved = true;
      if (!moved) break;
    }
    const g = W.groundAt(e.x, e.z, RADIUS * 0.8, e.y + 0.32);
    if (g > -1e9 && g > e.y - 1.2) e.y = g;
  }

  // Path following with A* over the waypoint graph. Opens doors on the way.
  _follow(e, target, speed, dt) {
    const G = this.G;
    const res = { x: 0, z: 0, s: 0, fail: false };
    // direct if clear and close in height
    const direct = Math.abs(target.y - e.y) < 0.4 && Math.hypot(target.x - e.x, target.z - e.z) < 14 &&
      walkClear(G.world, e, target, 0.28) && !G.doorBetweenXZ(e, target);
    let tx, tz;
    if (direct) { tx = target.x; tz = target.z; e.path = null; }
    else {
      e.repathT -= dt;
      if (!e.path || e.repathT <= 0 || e.pathGoal !== target || (e.path && e.pathI >= e.path.length)) {
        const a = G.nav.nearest(e.x, e.y, e.z, G.world);
        const b = G.nav.nearest(target.x, target.y, target.z, G.world);
        e.path = G.nav.path(a, b);
        e.pathI = 0; e.pathGoal = target; e.repathT = 2.5;
        if (!e.path) { res.fail = true; return res; }
      }
      // skip nodes we're already at
      while (e.pathI < e.path.length && Math.hypot(e.path[e.pathI].x - e.x, e.path[e.pathI].z - e.z) < 0.55) e.pathI++;
      if (e.pathI >= e.path.length) { tx = target.x; tz = target.z; }
      else {
        const n = e.path[e.pathI];
        // door on the edge we're walking? open it first
        const prev = e.pathI > 0 ? e.path[e.pathI - 1] : null;
        const edge = prev ? G.nav.edgeBetween(prev, n) : null;
        const door = edge && edge.door;
        if (door && door.openAmount < 0.55) {
          const c = door.centre(_v);
          const dd = Math.hypot(c.x - e.x, c.z - e.z);
          if (dd < 1.6) {
            if (!door.isOpen) { door.open(e.x, e.z); G.onDoorNoise(door); }
            e.yaw = dampAngle(e.yaw, Math.atan2(-(c.x - e.x), -(c.z - e.z)), 6, dt);
            return res; // wait for the swing
          }
        }
        tx = n.x; tz = n.z;
      }
    }
    const dx = tx - e.x, dz = tz - e.z, d = Math.hypot(dx, dz);
    if (d < 0.05) return res;
    res.x = dx / d; res.z = dz / d; res.s = Math.min(speed, d * 4);
    return res;
  }

  _tryOpenDoorAhead(e) {
    for (const d of this.G.doors) {
      if (d.isOpen) continue;
      const c = d.centre(_v);
      if (Math.abs(c.y - e.y) < 0.5 && Math.hypot(c.x - e.x, c.z - e.z) < 1.5) { d.open(e.x, e.z); this.G.onDoorNoise(d); return; }
    }
  }

  _pickSearchNode(e) {
    const G = this.G;
    const lk = e.lastKnown;
    const cands = G.nav.nodes.filter((n) => Math.abs(n.y - e.y) < 0.5 && Math.hypot(n.x - lk.x, n.z - lk.z) < 12);
    if (!cands.length) return null;
    return cands[Math.floor(Math.random() * cands.length)];
  }

  _shoot(e, dt, dist) {
    const G = this.G, P = G.player;
    if (e.reactT > 0) { e.reactT -= dt; return; }
    const sniper = !!e.spawn.sniper;
    const W = e.w.enemy;
    const range = sniper ? SNIPER.range : W.range;
    e.fireT -= dt;
    if (e.fireT > 0) return;
    if (!e.canSee || dist > range) { e.fireT = 0.25; return; }
    // must be facing roughly toward the player
    const want = Math.atan2(-(P.pos.x - e.x), -(P.pos.z - e.z));
    if (Math.abs(wrapAngle(want - e.yaw)) > 0.25) { e.fireT = 0.05; return; }
    if (e.flinchT > 0) { e.fireT = 0.15; return; }
    if (e.burstLeft <= 0) e.burstLeft = sniper ? 1 : Math.round(rand(W.burst[0], W.burst[1]));
    const m = e.muzzle(_v);
    const aimY = P.pos.y + P.height * (0.45 + Math.random() * 0.35);
    const moveK = 1 + Math.min(1.2, P.speed2D / 5);
    const spread = (sniper ? SNIPER.spread : W.spread) * G.diff.acc * moveK * (e.awareness > 1.2 ? 0.8 : 1);
    const dmg = (sniper ? SNIPER.damage : W.damage) * G.diff.dmg;
    const speed = sniper ? SNIPER.speed : W.speed;
    const pellets = W.pellets || 1;
    const bx = P.pos.x - m.x, by = aimY - m.y, bz = P.pos.z - m.z;
    const bl = Math.hypot(bx, by, bz);
    for (let i = 0; i < pellets; i++) {
      let dx = bx / bl + (Math.random() - 0.5) * 2 * spread, dy = by / bl + (Math.random() - 0.5) * 2 * spread * 0.7, dz = bz / bl + (Math.random() - 0.5) * 2 * spread;
      const l = Math.hypot(dx, dy, dz);
      dx /= l; dy /= l; dz /= l;
      G.spawnEnemyBullet(m.x, m.y, m.z, dx * speed, dy * speed, dz * speed, dmg, e);
    }
    G.fx.enemyFlash(m.x, m.y, m.z);
    G.audio.playAt(sniper ? 'sniper' : e.w.sound, m.x, m.y, m.z, G.listener, {
      gain: 0.75, walls: G.world.countBetween(m.x, m.y, m.z, G.listener.x, G.listener.y, G.listener.z, F_BULLET, 3), ref: 8,
    });
    e.burstLeft--;
    e.fireT = e.burstLeft > 0 ? (W.interval * 1.15) : (sniper ? SNIPER.interval : rand(0.75, 1.6) * G.diff.react);
    e.awareness += 0.05;
    // the enemy's own gunfire alerts the others nearby
    if (Math.random() < 0.25) this._alertNearby(e);
  }

  // ------------------------------------------------------------------ damage
  // Ray test against every body (alive and ragdolled). Returns closest hit or null.
  raycast(ox, oy, oz, dx, dy, dz, maxT) {
    let best = null, bt = maxT;
    for (const e of this.list) {
      const j = e.alive ? e.j : e.rp;
      // bounding sphere
      const cx = j[6], cy = j[7], cz = j[8];
      if (raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, 1.35) < 0) continue;
      const th = raySphere(ox, oy, oz, dx, dy, dz, j[0], j[1], j[2], HEAD_R + 0.012);
      if (th >= 0 && th < bt) { bt = th; best = { e, t: th, head: true, bone: -1 }; }
      for (let b = 0; b < BONES.length; b++) {
        const [a, c, r] = BONES[b];
        const t = rayCapsule(ox, oy, oz, dx, dy, dz, bt, j[a * 3], j[a * 3 + 1], j[a * 3 + 2], j[c * 3], j[c * 3 + 1], j[c * 3 + 2], r + 0.018);
        if (t >= 0 && t < bt) { bt = t; best = { e, t, head: b === 1, bone: b }; }
      }
    }
    return best;
  }

  // Apply a player bullet hit. Returns { killed, headshot }.
  hit(h, dmg, dx, dy, dz, hx, hy, hz) {
    const G = this.G, e = h.e;
    // blood spray + splatter on whatever is behind
    G.fx.bloodSpray(hx, hy, hz, dx, dy, dz, h.head ? 34 : 22, h.head ? 1.3 : 1);
    const wall = G.raycastWorld(hx + dx * 0.25, hy + dy * 0.25, hz + dz * 0.25, dx, dy, dz, 3.5);
    if (wall && wall.static) G.fx.bloodSplat(wall.x, wall.y, wall.z, wall.nx, wall.ny, wall.nz, 0.16 + Math.random() * 0.2, _v2.set(dx, dy, dz));
    // blood on the floor under the hit
    const gy = G.world.groundAt(hx, hz, 0.05, hy);
    if (gy > -1e9 && Math.random() < 0.7) G.fx.bloodSplat(hx + dx * 0.4, gy, hz + dz * 0.4, 0, 1, 0, 0.08 + Math.random() * 0.1);
    if (!e.alive) {
      e.impulse(dx * 5, dy * 5, dz * 5, h.bone, 1);
      return { killed: false, headshot: false, corpse: true };
    }
    const amount = dmg * (h.head ? HEADSHOT_MULT : 1);
    e.health -= amount;
    e.flinchT = 0.28; // arms fly up
    const P = G.player;
    e.lastKnown.x = P.pos.x; e.lastKnown.y = P.pos.y; e.lastKnown.z = P.pos.z;
    if (e.health <= 0) {
      this._kill(e, dx, dy, dz, h);
      return { killed: true, headshot: h.head };
    }
    if (e.state !== 'combat') { this._enterCombat(e); e.reactT *= 0.5; }
    e.awareness = 1.5;
    return { killed: false, headshot: h.head };
  }

  _kill(e, dx, dy, dz, h) {
    const G = this.G;
    e.alive = false;
    e.state = 'dead';
    e.startRagdoll(dx * 6, dy * 6 + 1.0, dz * 6, h ? h.bone : null);
    e.pooled = false;
    // the dropped gun becomes a pickup
    const w = WEAPONS[e.weapon];
    const mag = Math.max(1, Math.round(w.mag * rand(0.45, 1)));
    const reserve = Math.round(w.mag * rand(0.6, 1.4) * G.diff.reserve);
    this.pickups.push({
      type: e.weapon, x: e.j[18], y: e.j[19], z: e.j[20], vx: dx * 1.5 + e.vx, vy: 1.5, vz: dz * 1.5 + e.vz,
      yaw: e.yaw + rand(-0.6, 0.6), spin: rand(-4, 4), roll: 0, rest: false, mag, reserve, alive: true,
    });
    G.audio.playAt('bodyFall', e.x, e.y + 0.5, e.z, G.listener, { gain: 0.9 });
    // nearby allies hear the fight
    this._alertNearby(e);
  }

  dropPickup(type, x, y, z, yaw, mag, reserve) {
    if (this.pickups.length >= MAX_PICKUPS) this.pickups.shift();
    this.pickups.push({ type, x, y, z, vx: -Math.sin(yaw) * 1.2, vy: 1.2, vz: -Math.cos(yaw) * 1.2, yaw: yaw + 1.2, spin: 3, roll: 0, rest: false, mag, reserve, alive: true });
  }

  _updatePickups(dt) {
    const W = this.G.world;
    for (const p of this.pickups) {
      if (!p.alive || p.rest) continue;
      p.vy -= 13 * dt;
      p.x += p.vx * dt; p.z += p.vz * dt;
      const ny = p.y + p.vy * dt;
      const b = W.pointBlocked(p.x, p.y + 0.05, p.z, F_MOVE);
      if (b && b.maxY > p.y + 0.1) { p.x -= p.vx * dt * 2; p.z -= p.vz * dt * 2; p.vx *= -0.3; p.vz *= -0.3; }
      const g = W.groundAt(p.x, p.z, 0.05, p.y + 0.02);
      p.yaw += p.spin * dt;
      p.roll = Math.min(Math.PI / 2, p.roll + dt * 6);
      if (ny <= g + 0.035) { p.y = g + 0.035; p.rest = true; p.roll = Math.PI / 2; }
      else p.y = ny;
    }
  }

  // Closest pickup the player is looking at / standing by.
  pickupFor(px, py, pz, fx, fz) {
    let best = null, bs = -Infinity;
    for (const p of this.pickups) {
      if (!p.alive) continue;
      const dx = p.x - px, dz = p.z - pz, dy = p.y - py;
      const d = Math.hypot(dx, dz);
      if (d > 1.9 || Math.abs(dy) > 1.3) continue;
      const facing = d > 0.01 ? (dx * fx + dz * fz) / d : 1;
      if (facing < 0.35 && d > 0.9) continue;
      const score = facing * 2 - d;
      if (score > bs) { bs = score; best = p; }
    }
    return best;
  }

  pickupName(type) { return PICKUP_NAMES[type]; }

  // ------------------------------------------------------------------ render
  _render() {
    let nl = 0, nj = 0, nh = 0, ne = 0;
    const gunCount = {};
    for (const t of GUN_TYPES) gunCount[t] = 0;
    for (const e of this.list) {
      const j = e.alive ? e.j : e.rp;
      for (let b = 0; b < BONES.length; b++) {
        const [a, c, r] = BONES[b];
        segMatrix(j[a * 3], j[a * 3 + 1], j[a * 3 + 2], j[c * 3], j[c * 3 + 1], j[c * 3 + 2], r, _m);
        this.mLimbs.setMatrixAt(nl++, _m);
      }
      for (let i = 1; i < NJ; i++) {
        const r = JOINT_R[i];
        _m.makeScale(r, r, r).setPosition(j[i * 3], j[i * 3 + 1], j[i * 3 + 2]);
        this.mJoints.setMatrixAt(nj++, _m);
      }
      _m.makeScale(HEAD_R, HEAD_R, HEAD_R).setPosition(j[0], j[1], j[2]);
      this.mHeads.setMatrixAt(nh++, _m);
      // one eye: forward and a little to the right/up of the face
      let ex, ey, ez;
      if (e.alive) {
        const fx = -Math.sin(e.lookYaw), fz = -Math.cos(e.lookYaw), rx = Math.cos(e.lookYaw), rz = -Math.sin(e.lookYaw);
        ex = fx * 0.93 + rx * 0.3; ey = 0.2 + Math.sin(e.pitch) * 0.4; ez = fz * 0.93 + rz * 0.3;
      } else {
        // dead: eye faces away from the neck
        ex = j[0] - j[3]; ey = j[1] - j[4]; ez = j[2] - j[5];
        const l = Math.hypot(ex, ey, ez) || 1;
        // rotate a bit toward the side
        ex /= l; ey /= l; ez /= l;
      }
      _v.set(ex, ey, ez).normalize();
      _q.setFromUnitVectors(_up, _v);
      _m.compose(_v2.set(j[0] + _v.x * (HEAD_R - 0.004), j[1] + _v.y * (HEAD_R - 0.004), j[2] + _v.z * (HEAD_R - 0.004)), _q, _s.set(0.064, 0.012, 0.064));
      this.mEyes.setMatrixAt(ne, _m);
      const po = HEAD_R + 0.004;
      _m.compose(_v2.set(j[0] + _v.x * po, j[1] + _v.y * po, j[2] + _v.z * po), _q, _s.set(e.alive ? 0.029 : 0.012, 0.012, e.alive ? 0.029 : 0.04));
      this.mPupils.setMatrixAt(ne, _m);
      ne++;
      if (e.alive) {
        this.aimDir(e, _v);
        gunMatrix(j[18], j[19], j[20], _v, _m);
        this.mGuns[e.weapon].setMatrixAt(gunCount[e.weapon]++, _m);
      }
    }
    for (const p of this.pickups) {
      if (!p.alive) continue;
      _q.setFromEuler(_eul.set(0, p.yaw, p.roll, 'YXZ'));
      _m.compose(_v2.set(p.x, p.y, p.z), _q, _s.set(1, 1, 1));
      const mesh = this.mGuns[p.type];
      if (gunCount[p.type] < mesh.instanceMatrix.count) mesh.setMatrixAt(gunCount[p.type]++, _m);
    }
    const setCount = (m, n) => { m.count = n; m.instanceMatrix.needsUpdate = true; };
    setCount(this.mLimbs, nl); setCount(this.mJoints, nj); setCount(this.mHeads, nh);
    setCount(this.mEyes, ne); setCount(this.mPupils, ne);
    this.mRimLimbs.count = nl; this.mRimJoints.count = nj; this.mRimHeads.count = nh;
    for (const t of GUN_TYPES) setCount(this.mGuns[t], gunCount[t]);
  }

  aimDir(e, out) { return e.aimDir(out); }

  snapshot() {
    return this.list.map((e) => ({
      id: e.spawn.id, alive: e.alive, state: e.state, hp: +e.health.toFixed(2),
      x: +e.x.toFixed(4), y: +e.y.toFixed(4), z: +e.z.toFixed(4), yaw: +e.yaw.toFixed(4),
      aw: +e.awareness.toFixed(3), sleeping: e.sleeping,
      body: e.alive ? null : Array.from(e.rp).map((v) => +v.toFixed(3)),
    }));
  }
}

const _gx = new THREE.Vector3(), _gy = new THREE.Vector3(), _gz = new THREE.Vector3();
function gunMatrix(x, y, z, aim, out) {
  _gz.copy(aim).multiplyScalar(-1);
  _gx.crossVectors(_up, _gz);
  if (_gx.lengthSq() < 1e-6) _gx.set(1, 0, 0);
  _gx.normalize();
  _gy.crossVectors(_gz, _gx);
  out.makeBasis(_gx, _gy, _gz);
  out.setPosition(x, y, z);
  return out;
}

export { GUN_TYPES, GUN_INFO };
