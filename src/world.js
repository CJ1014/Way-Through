// The map. Metres, north = -Z, ground floor y = 0, roof walking surface y = 5.
// Route: 1 roof -> hut door -> 2 twenty-step stair -> stair room -> side door ->
//        3 kitchen -> 4 canteen -> exit doors -> 5 fenced yard -> water tower -> 6 North Gate.
import * as THREE from '../vendor/three/three.module.js';
import { Builder } from './builder.js';
import { CollisionWorld, F_MOVE, circleOverlapsRect } from './collision.js';
import { Door } from './doors.js';
import { NavGraph } from './nav.js';
import { mulberry32 } from './util.js';

export const ROOF_Y = 5.0;
export const CEIL_Y = 4.6;
export const PARAPET_TOP = 6.05; // 1.05 m above the roof
const T_EXT = 0.3;
const T_INT = 0.2;

// Stair: 20 risers of 0.25 m, 0.4 m run, heading north from z = 0 (top) to z = -7.6.
export const STAIR = { x0: 2.6, x1: 4.4, zTop: 0, rise: 0.25, run: 0.4, risers: 20 };

export const WIN_ZONE = { minX: -8, maxX: 8, maxZ: -99.2 };

export function buildWorld(materials, scene) {
  const B = new Builder();
  const rng = mulberry32(1337);
  const doorDefs = [];
  const navPts = [];
  const signs = [];

  // ---------------------------------------------------------------- helpers
  // Wall running along an axis ('x': along X at z=c, 'z': along Z at x=c) with openings
  // [{a, b, bottom, top, kind:'door'|'window'}] measured along the wall.
  function wall(axis, a0, a1, c, t, y0, y1, openings = [], o = {}) {
    const role = o.role || 'wall';
    const col = o.col || 'solid';
    const tag = o.tag || 'wall';
    const c0 = c - t / 2, c1 = c + t / 2;
    const piece = (u0, v0, u1, v1) => {
      if (u1 - u0 < 1e-4 || v1 - v0 < 1e-4) return;
      // overlap neighbouring pieces a hair so their coplanar faces leave no T-junction cracks
      u0 = Math.max(a0, u0 - 0.006); u1 = Math.min(a1, u1 + 0.006);
      if (axis === 'x') B.box(role, u0, v0, c0, u1, v1, c1, { edges: false, col, tag, cast: o.cast });
      else B.box(role, c0, v0, u0, c1, v1, u1, { edges: false, col, tag, cast: o.cast });
    };
    const P = (u, v, w) => (axis === 'x' ? new THREE.Vector3(u, v, w) : new THREE.Vector3(w, v, u));
    const NA = (u, v, w) => (axis === 'x' ? [u, v, w] : [w, v, u]); // (along, y, across) -> world
    const ops = openings.slice().sort((p, q) => p.a - q.a);
    let cur = a0;
    for (const op of ops) {
      piece(cur, y0, op.a, y1);
      piece(op.a, y0, op.b, op.bottom);
      piece(op.a, op.top, op.b, y1);
      cur = op.b;
    }
    piece(cur, y0, a1, y1);
    // ink: outline of the whole slab of wall + every opening on both faces
    const L = B.ink;
    for (const [w, ws] of [[c0, -1], [c1, 1]]) {
      const fN = NA(0, 0, ws);
      B.seg(P(a0, y0, w), P(a1, y0, w), L, fN, [0, -1, 0]); B.seg(P(a0, y1, w), P(a1, y1, w), L, fN, [0, 1, 0]);
      B.seg(P(a0, y0, w), P(a0, y1, w), L, fN, NA(-1, 0, 0)); B.seg(P(a1, y0, w), P(a1, y1, w), L, fN, NA(1, 0, 0));
    }
    for (const [u, us] of [[a0, -1], [a1, 1]]) for (const [v, vs] of [[y0, -1], [y1, 1]]) B.seg(P(u, v, c0), P(u, v, c1), L, NA(us, 0, 0), [0, vs, 0]);
    for (const op of ops) {
      for (const [w, ws] of [[c0, -1], [c1, 1]]) {
        const fN = NA(0, 0, ws);
        B.seg(P(op.a, op.bottom, w), P(op.b, op.bottom, w), L, fN, [0, 1, 0]);
        B.seg(P(op.a, op.top, w), P(op.b, op.top, w), L, fN, [0, -1, 0]);
        B.seg(P(op.a, op.bottom, w), P(op.a, op.top, w), L, fN, NA(1, 0, 0));
        B.seg(P(op.b, op.bottom, w), P(op.b, op.top, w), L, fN, NA(-1, 0, 0));
      }
      for (const [u, us] of [[op.a, 1], [op.b, -1]]) for (const [v, vs] of [[op.bottom, 1], [op.top, -1]]) B.seg(P(u, v, c0), P(u, v, c1), L, NA(us, 0, 0), [0, vs, 0]);
      if (op.kind === 'window') windowIn(axis, op, c, t, P);
      if (op.kind === 'door') {
        // doorway blocks nothing (the Door does); register the door
        if (op.door) doorDefs.push(op.door);
      }
    }
  }

  function windowIn(axis, op, c, t, P) {
    const W = op.b - op.a, H = op.top - op.bottom, f = 0.05, d = Math.min(0.1, t * 0.6);
    const fr = (u0, v0, u1, v1) => {
      if (axis === 'x') B.box('steel', u0, v0, c - d / 2, u1, v1, c + d / 2, { col: 'none', cast: false });
      else B.box('steel', c - d / 2, v0, u0, c + d / 2, v1, u1, { col: 'none', cast: false });
    };
    fr(op.a, op.bottom, op.b, op.bottom + f);
    fr(op.a, op.top - f, op.b, op.top);
    fr(op.a, op.bottom, op.a + f, op.top);
    fr(op.b - f, op.bottom, op.b, op.top);
    if (W > 2.2) fr((op.a + op.b) / 2 - f / 2, op.bottom, (op.a + op.b) / 2 + f / 2, op.top);
    // pane: invisible in Classic, tinted in Neo; blocks movement, lets bullets & sight through
    if (axis === 'x') B.box('glass', op.a, op.bottom, c - 0.01, op.b, op.top, c + 0.01, { col: 'moveOnly', edges: false, cast: false, tag: 'glass' });
    else B.box('glass', c - 0.01, op.bottom, op.a, c + 0.01, op.top, op.b, { col: 'moveOnly', edges: false, cast: false, tag: 'glass' });
    // 3-4 short diagonal hatch strokes (the classic "this is glass" mark)
    const panes = W > 2.2 ? [[op.a, (op.a + op.b) / 2], [(op.a + op.b) / 2, op.b]] : [[op.a, op.b]];
    for (const [pa, pb] of panes) {
      const w = pb - pa, m = Math.min(w, H);
      const lens = [0.34, 0.28, 0.2, 0.1];
      for (let i = 0; i < lens.length; i++) {
        const len = lens[i] * m * 1.15;
        const su = pa + w * (0.5 + i * 0.085), sv = op.top - H * 0.14 - i * 0.012;
        const k = len * 0.7071;
        B.seg(P(su, sv, c), P(su - k, sv - k, c), B.fine);
      }
    }
  }

  const doorway = (a, width, bottom, top, def) => ({ a, b: a + width, bottom, top, kind: 'door', door: def });
  const win = (a, b, bottom, top) => ({ a, b, bottom, top, kind: 'window' });

  function nav(x, z, y = 0, tag = '') { navPts.push({ x, y, z, tag }); }

  // --------------------------------------------------------------- 0. ground
  const GY = 0;
  B.box('ground', -90, -0.5, -150, 80, GY, -28, { edges: false });
  B.box('ground', -90, -0.5, 8, 80, GY, 45, { edges: false });
  B.box('ground', -90, -0.5, -28, -24, GY, 8, { edges: false });
  B.box('ground', 12, -0.5, -28, 80, GY, 8, { edges: false });

  // --------------------------------------------------------------- building shell
  // footprint x [-24, 12], z [-28, 8]
  B.box('floor', -24, -0.3, -28, 12, 0, 8, { edges: false });
  // roof slab with the stair opening x [2.4, 4.6], z [-4.4, 0]; the roof never casts shadows
  const RO = { edges: false, cast: false, tag: 'roof' };
  B.box('roof', -23.7, CEIL_Y, -27.7, 2.4, ROOF_Y, 7.7, RO);
  B.box('roof', 4.6, CEIL_Y, -27.7, 11.7, ROOF_Y, 7.7, RO);
  B.box('roof', 2.39, CEIL_Y, 0, 4.61, ROOF_Y, 7.7, RO);
  B.box('roof', 2.39, CEIL_Y, -27.7, 4.61, ROOF_Y, -4.4, RO);
  B.rect(-23.7, -27.7, 11.7, 7.7, ROOF_Y);       // roof meets parapet
  B.rect(-23.7, -27.7, 11.7, 7.7, CEIL_Y, B.ink, -1); // ceiling meets outer walls (inside)
  B.rect(2.4, -4.4, 4.6, 0, ROOF_Y); B.rect(2.4, -4.4, 4.6, 0, CEIL_Y, B.ink, -1);
  for (const [x, z] of [[2.4, -4.4], [4.6, -4.4], [2.4, 0], [4.6, 0]]) B.segXYZ(x, CEIL_Y, z, x, ROOF_Y, z);
  // roof panel seams (fine ink)
  const UP = [0, 1, 0];
  for (let x = -20; x <= 8; x += 4) B.segXYZ(x, ROOF_Y + 0.004, -27.7, x, ROOF_Y + 0.004, 7.7, B.fine, UP);
  for (let z = -24; z <= 4; z += 4) B.segXYZ(-23.7, ROOF_Y + 0.004, z, 11.7, ROOF_Y + 0.004, z, B.fine, UP);
  // parapet coping
  const cop = { col: 'solid', cast: true, tag: 'parapet' };
  B.box('concrete', -24.05, PARAPET_TOP, -28.05, 12.05, PARAPET_TOP + 0.08, -27.62, cop);
  B.box('concrete', -24.05, PARAPET_TOP, 7.62, 12.05, PARAPET_TOP + 0.08, 8.05, cop);
  B.box('concrete', -24.05, PARAPET_TOP, -27.62, -23.62, PARAPET_TOP + 0.08, 7.62, cop);
  B.box('concrete', 11.62, PARAPET_TOP, -27.62, 12.05, PARAPET_TOP + 0.08, 7.62, cop);

  // exterior walls (ground to parapet top)
  const exitDoor1 = { name: 'exitWest', x: -14.6, z: -27.85, y: 0, width: 1.2, height: 2.3, dirX: 1, dirZ: 0 };
  const exitDoor2 = { name: 'exitEast', x: 1.4, z: -27.85, y: 0, width: 1.2, height: 2.3, dirX: 1, dirZ: 0 };
  wall('x', -24, 12, -27.85, T_EXT, 0, PARAPET_TOP, [
    win(-22.5, -19.5, 1.0, 2.7), doorway(-14.62, 1.24, 0, 2.32, exitDoor1),
    win(-11, -8, 1.0, 2.7), win(-5.5, -2.5, 1.0, 2.7), doorway(1.38, 1.24, 0, 2.32, exitDoor2),
    win(5, 8, 1.0, 2.7), win(9, 11, 1.0, 2.7),
  ], { tag: 'extwall' });
  wall('x', -24, 12, 7.85, T_EXT, 0, PARAPET_TOP, [], { tag: 'extwall' });
  wall('z', -27.7, 7.7, -23.85, T_EXT, 0, PARAPET_TOP, [win(-25.5, -22.5, 1.0, 2.7), win(-18.5, -15.5, 1.0, 2.7)], { tag: 'extwall' });
  wall('z', -27.7, 7.7, 11.85, T_EXT, 0, PARAPET_TOP, [win(-25.5, -22.5, 1.0, 2.7), win(-18.5, -15.5, 1.0, 2.7)], { tag: 'extwall' });

  // interior walls (floor to ceiling)
  const kitchenNorthDoor = { name: 'kitchenNorth', x: -5.55, z: -12, y: 0, width: 1.1, height: 2.2, dirX: 1, dirZ: 0 };
  const sideDoor = { name: 'sideDoor', x: -0.0, z: -10.55, y: 0, width: 1.1, height: 2.2, dirX: 0, dirZ: 1 };
  wall('x', -23.7, 11.7, -12, T_INT, 0, CEIL_Y, [
    doorway(-5.57, 1.14, 0, 2.22, kitchenNorthDoor), win(3.2, 5.8, 1.1, 2.5),
  ]);
  wall('x', -10.1, 9.1, 0.1, T_INT, 0, CEIL_Y); // kitchen + stair room south wall
  wall('z', -11.9, 0.0, 0, T_INT, 0, CEIL_Y, [doorway(-10.57, 1.14, 0, 2.22, sideDoor)]);
  wall('z', -11.9, 0.2, -10, T_INT, 0, CEIL_Y);
  wall('z', -11.9, 0.2, 9, T_INT, 0, CEIL_Y);
  // ceiling lamps (flat boxes)
  const ceilLamp = (x, z, sx = 1.2, sz = 0.3) => B.box('lamp', x - sx / 2, CEIL_Y - 0.06, z - sz / 2, x + sx / 2, CEIL_Y, z + sz / 2, { col: 'none', cast: false });

  // --------------------------------------------------------------- 1. roof
  // stair hut on the roof over the opening; its door opens onto walkable roof / landing
  const hutDoor = { name: 'hutDoor', x: 3.0, z: 2.1, y: ROOF_Y, width: 1.0, height: 2.1, dirX: 1, dirZ: 0 };
  const HT = ROOF_Y + 2.6;
  wall('z', -4.6, 2.2, 2.3, T_INT, ROOF_Y, HT);
  wall('z', -4.6, 2.2, 4.7, T_INT, ROOF_Y, HT);
  wall('x', 2.4, 4.6, -4.5, T_INT, ROOF_Y, HT);
  wall('x', 2.4, 4.6, 2.1, T_INT, ROOF_Y, HT, [doorway(2.98, 1.04, ROOF_Y, ROOF_Y + 2.12, hutDoor)]);
  B.box('roof', 2.05, HT, -4.75, 4.95, HT + 0.18, 2.35, { cast: false, tag: 'hutroof' });
  B.box('lamp', 3.2, HT - 0.05, 0.6, 3.8, HT, 1.4, { col: 'none', cast: false });
  // hut sign stencil "EXIT" style lines above door: small vent
  B.box('machine', 3.2, ROOF_Y + 2.25, 2.2, 3.8, ROOF_Y + 2.45, 2.28, { col: 'none' });

  // AC units (1.3 m tall: taller than a jump, so nothing on the roof is a step toward the parapet)
  function acUnit(x, z, sx, sz, rot = 0) {
    const h = 1.3, y = ROOF_Y;
    B.box('machine', x - sx / 2, y, z - sz / 2, x + sx / 2, y + h, z + sz / 2, { tag: 'ac' });
    B.box('machine', x - sx / 2 + 0.1, y + h, z - sz / 2 + 0.1, x + sx / 2 - 0.1, y + h + 0.06, z + sz / 2 - 0.1, { col: 'none' });
    // fan on top
    const fx = x + (sx > sz ? sx * 0.22 : 0), fz = z + (sz >= sx ? sz * 0.22 : 0);
    B.cyl('dark', fx, y + h + 0.06, fz, Math.min(sx, sz) * 0.33, 0.05, 16, { col: 'none', verticals: false });
    B.cyl('machine', fx, y + h + 0.06, fz, Math.min(sx, sz) * 0.37, 0.12, 16, { col: 'none', verticals: false, open: true });
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI;
      const r = Math.min(sx, sz) * 0.3;
      B.segXYZ(fx - Math.cos(a) * r, y + h + 0.13, fz - Math.sin(a) * r, fx + Math.cos(a) * r, y + h + 0.13, fz + Math.sin(a) * r, B.fine, [0, 1, 0]);
    }
    // grille lines on the long faces
    const n = Math.floor((sx > sz ? sx : sz) / 0.12);
    for (let i = 1; i < n; i++) {
      const u = -0.5 + i / n;
      if (sx > sz) {
        const gx = x + u * (sx - 0.3);
        for (const s of [-1, 1]) B.segXYZ(gx, y + 0.25, z + s * (sz / 2 + 0.003), gx, y + h - 0.25, z + s * (sz / 2 + 0.003), B.fine, [0, 0, s]);
      } else {
        const gz = z + u * (sz - 0.3);
        for (const s of [-1, 1]) B.segXYZ(x + s * (sx / 2 + 0.003), y + 0.25, gz, x + s * (sx / 2 + 0.003), y + h - 0.25, gz, B.fine, [s, 0, 0]);
      }
    }
    void rot;
  }
  acUnit(-8, 1.5, 2.4, 1.6);
  acUnit(-2, -9, 1.6, 2.4);
  acUnit(7.5, -9.5, 2.4, 1.6);
  acUnit(-16, -10, 2.4, 1.6);
  acUnit(-8, -20, 1.6, 2.4);
  acUnit(5, -20.5, 2.4, 1.6);

  // mushroom vents (>= 1.0 m tall)
  function vent(x, z) {
    B.cyl('machine', x, ROOF_Y, z, 0.28, 1.05, 10, { col: 'solid', tag: 'vent' });
    B.cyl('dark', x, ROOF_Y + 1.05, z, 0.2, 0.12, 10, { col: 'none', verticals: false });
    B.cone('machine', x, ROOF_Y + 1.17, z, 0.5, 0.35, 10, { col: 'none' });
  }
  vent(-12, 5); vent(0, 4.5); vent(-20, -4); vent(-14, -24); vent(8, 3.5); vent(-2, -24);
  // antenna mast with guy wires
  B.cyl('steel', -20, ROOF_Y, 4.5, 0.06, 4.2, 6, { col: 'solid', tag: 'mast' });
  B.cyl('steel', -20, ROOF_Y + 3.2, 4.5, 0.02, 0.9, 4, { col: 'none', rTop: 0.02 });
  for (const [dx, dz] of [[1.8, 0], [-1.2, 1.4], [-1.2, -1.6]]) B.segXYZ(-20, ROOF_Y + 3.6, 4.5, -20 + dx, ROOF_Y, 4.5 + dz, B.fine);
  B.box('dark', -20.4, ROOF_Y + 3.6, 4.45, -19.6, ROOF_Y + 3.65, 4.55, { col: 'none' });
  // roof pipe run on low stands, kept far from any parapet (>5 m) so it's not a vaulting step
  B.cylBetween('steel', new THREE.Vector3(-14, ROOF_Y + 0.35, -3), new THREE.Vector3(-4, ROOF_Y + 0.35, -3), 0.12, 10, { col: 'none' });
  B.box(null, -14, ROOF_Y, -3.13, -4, ROOF_Y + 0.47, -2.87, { col: 'solid', edges: false, tag: 'pipe' });
  for (const px of [-13, -9, -5]) B.box('steel', px - 0.08, ROOF_Y, -3.15, px + 0.08, ROOF_Y + 0.23, -2.85, { col: 'none' });
  // skylight box (tall, blocks)
  B.box('machine', -14.5, ROOF_Y, -17.5, -11.5, ROOF_Y + 1.1, -15.5, { tag: 'skylight' });
  B.box('glass', -14.3, ROOF_Y + 1.1, -17.3, -11.7, ROOF_Y + 1.12, -15.7, { col: 'none', edges: false, cast: false });
  for (let i = 0; i < 3; i++) B.segXYZ(-13.6 + i * 0.35, ROOF_Y + 1.121, -16.2, -13.2 + i * 0.35, ROOF_Y + 1.121, -16.9, B.fine);

  nav(-16, 4.5, ROOF_Y, 'roof'); nav(-8, 4.5, ROOF_Y); nav(-2, 4.2, ROOF_Y); nav(3.5, 4.8, ROOF_Y);
  nav(9, 4.5, ROOF_Y); nav(3.5, 3.6, ROOF_Y, 'hutFront'); nav(9, -3, ROOF_Y); nav(9, -12.5, ROOF_Y);
  nav(9.5, -18, ROOF_Y); nav(9, -24.5, ROOF_Y); nav(2, -24.5, ROOF_Y); nav(-5, -24.5, ROOF_Y);
  nav(-11, -24.5, ROOF_Y); nav(-20, -24.5, ROOF_Y); nav(-20, -16, ROOF_Y); nav(-20, -7, ROOF_Y);
  nav(-20, 1, ROOF_Y); nav(-12, -6, ROOF_Y); nav(-5, -5.5, ROOF_Y); nav(-12, -13.5, ROOF_Y);
  nav(-4.5, -14, ROOF_Y); nav(1, -2, ROOF_Y); nav(6.5, -3, ROOF_Y); nav(1, -14, ROOF_Y); nav(6, -15, ROOF_Y);
  nav(1, 3, ROOF_Y); nav(10.3, -8, ROOF_Y); nav(6.2, 3.4, ROOF_Y); // connectors around the hut

  // --------------------------------------------------------------- 2. stair + stair room
  // landing inside the hut is the roof slab (z 0..2) at y = 5
  {
    const { x0, x1, rise, run } = STAIR;
    let prev = null;
    for (let k = 1; k < STAIR.risers; k++) {
      const top = ROOF_Y - rise * k;
      const zA = -run * k, zB = -run * (k - 1);
      B.box('floor', x0, 0, zA, x1, top, zB + (k > 1 ? 0.008 : 0), { edges: false, tag: 'stair' });
      // tread meets the riser above / nosing
      B.segXYZ(x0, top, zB, x1, top, zB, B.ink, [0, 1, 0], [0, 0, -1]);
      B.segXYZ(x0, top, zA, x1, top, zA, B.ink, [0, 1, 0], [0, 0, -1]);
      // side sawtooth profile
      for (const [x, sx] of [[x0, -1], [x1, 1]]) {
        B.segXYZ(x, top, zB, x, top, zA, B.ink, [sx, 0, 0], [0, 1, 0]);          // tread
        B.segXYZ(x, top, zA, x, top - rise, zA, B.ink, [sx, 0, 0], [0, 0, -1]);  // riser
      }
      prev = top;
    }
    void prev;
    // top riser from landing (y 5) down to first tread
    for (const [x, sx] of [[x0, -1], [x1, 1]]) {
      B.segXYZ(x, ROOF_Y, 0, x, ROOF_Y - rise, 0, B.ink, [sx, 0, 0], [0, 0, -1]);
      B.segXYZ(x, 0, 0, x, 0, -run * (STAIR.risers - 1), B.ink, [sx, 0, 0], [0, 1, 0]);
    }
    B.segXYZ(x0, ROOF_Y, 0, x1, ROOF_Y, 0, B.ink, [0, 1, 0], [0, 0, -1]);
    // rails both sides: posts every 4 steps + sloped handrail, collider per tread (movement only)
    for (const [xr, xa, xb] of [[x0 + 0.06, x0, x0 + 0.12], [x1 - 0.06, x1 - 0.12, x1]]) {
      for (let k = 1; k < STAIR.risers; k++) {
        const top = ROOF_Y - rise * k;
        B.collider(xa, 0, -run * k, xb, top + 1.0, -run * (k - 1), 'moveOnly', 'rail');
        if (k % 4 === 1 || k === STAIR.risers - 1) {
          const z = -run * (k - 0.5);
          B.cyl('steel', xr, top, z, 0.025, 0.95, 6, { col: 'none' });
        }
      }
      const zS = -run * 0.5, zE = -run * (STAIR.risers - 1.5);
      const yS = ROOF_Y - rise + 0.95, yE = ROOF_Y - rise * (STAIR.risers - 1) + 0.95;
      B.cylBetween('steel', new THREE.Vector3(xr, yS, zS), new THREE.Vector3(xr, yE, zE), 0.035, 6, { col: 'none' });
      B.cylBetween('steel', new THREE.Vector3(xr, yS - 0.45, zS), new THREE.Vector3(xr, yE - 0.45, zE), 0.018, 5, { col: 'none' });
    }
  }
  nav(3.5, 0.75, ROOF_Y, 'landing');
  nav(3.5, -3.8, 2.5, 'stairMid');
  nav(3.5, -8.4, 0, 'stairBottom');

  // stair room: x [0.1, 8.9], z [-11.9, 0]; window on the far (north) wall, lockers right, door left
  function locker(x0, z0, z1) {
    const x1 = 8.9, h = 1.95;
    B.box('locker', x0, 0, z0, x1, h, z1, { tag: 'locker' });
    const fx = x0 - 0.003;
    const zm = (z0 + z1) / 2, FN = [-1, 0, 0];
    B.segXYZ(fx, 0.08, zm, fx, h - 0.06, zm, B.fine, FN);
    for (const zz of [z0 + 0.06, z1 - 0.06]) B.segXYZ(fx, 0.08, zz, fx, h - 0.06, zz, B.fine, FN);
    for (const zc of [(z0 + zm) / 2, (zm + z1) / 2]) {
      for (let i = 0; i < 4; i++) B.segXYZ(fx, h - 0.25 - i * 0.06, zc - 0.1, fx, h - 0.25 - i * 0.06, zc + 0.1, B.fine, FN);
      B.box('steel', x0 - 0.04, 1.0, zc + 0.09, x0, 1.14, zc + 0.12, { col: 'none' });
    }
  }
  locker(8.4, -9.3, -8.5);
  locker(8.4, -10.2, -9.35);
  B.box('chair', 7.3, 0.42, -10.3, 7.8, 0.47, -8.3, { col: 'move', tag: 'bench' });
  for (const z of [-10.1, -8.5]) B.box('steel', 7.45, 0, z - 0.04, 7.65, 0.42, z + 0.04, { col: 'none' });
  B.collider(7.3, 0, -10.3, 7.8, 0.47, -8.3, 'move', 'bench');
  // crates under the stair side + extinguisher
  B.box('crate', 0.4, 0, -7.2, 1.3, 0.9, -6.3, { tag: 'crate' });
  B.box('crate', 0.45, 0.9, -7.1, 1.15, 1.5, -6.45, { tag: 'crate' });
  B.cyl('vending', 0.28, 0.35, -5.2, 0.09, 0.5, 10, { col: 'none' });
  B.cyl('dark', 0.28, 0.85, -5.2, 0.03, 0.1, 6, { col: 'none' });
  ceilLamp(6.5, -4); ceilLamp(6.5, -9); ceilLamp(1.5, -9.5);
  nav(3.5, -10.6); nav(6.2, -6.5); nav(1.6, -10.0, 0, 'sideDoorE'); nav(1.3, -4.5); nav(1.95, -6.75); nav(1.9, -8.8); nav(6.5, -2); nav(5.6, -10.9);

  // --------------------------------------------------------------- 3. kitchen: x [-9.9, -0.1], z [-11.9, 0]
  // serving counter across the room; enemy stands behind it (south side)
  B.box('counter', -9.9, 0, -6.9, -2.4, 0.9, -6.1, { tag: 'counter' });
  B.box('steel', -9.9, 0.9, -7.0, -2.3, 0.96, -6.0, { tag: 'counter' });
  for (let i = 0; i < 6; i++) {
    const tx = -9.2 + i * 1.18;
    B.box('tray', tx - 0.23, 0.96, -6.72, tx + 0.23, 0.99, -6.38, { col: 'none' });
    B.cyl('machine', tx - 0.08, 0.99, -6.55, 0.07, 0.06, 10, { col: 'none', verticals: false });
    B.cyl('machine', tx + 0.11, 0.99, -6.5, 0.04, 0.1, 8, { col: 'none', verticals: false });
  }
  // sneeze guard: glass on steel posts (bullets pass)
  for (const px of [-9.6, -6.1, -2.6]) B.cyl('steel', px, 0.96, -6.5, 0.02, 0.7, 6, { col: 'none' });
  B.box('glass', -9.6, 1.25, -6.52, -2.6, 1.66, -6.48, { col: 'none', edges: false, cast: false });
  B.segXYZ(-9.6, 1.66, -6.5, -2.6, 1.66, -6.5); B.segXYZ(-9.6, 1.25, -6.5, -2.6, 1.25, -6.5);
  for (const gx of [-8.5, -4.6]) for (let i = 0; i < 3; i++) B.segXYZ(gx + i * 0.12, 1.6, -6.5, gx + i * 0.12 - 0.2, 1.4, -6.5, B.fine);
  // stove + hood, fridge, prep table, shelves
  B.box('machine', -9.5, 0, -0.9, -6.5, 0.9, -0.1, { tag: 'stove' });
  for (const [bx, bz] of [[-9.0, -0.55], [-8.2, -0.55], [-7.4, -0.55], [-6.8, -0.55]]) B.cyl('dark', bx, 0.9, bz, 0.16, 0.02, 12, { col: 'none', verticals: false });
  B.cyl('steel', -8.6, 0.92, -0.5, 0.2, 0.3, 12, { col: 'none', verticals: 3 });
  B.cyl('steel', -7.2, 0.92, -0.5, 0.16, 0.22, 12, { col: 'none', verticals: 3 });
  B.box('machine', -9.6, 2.1, -1.1, -6.4, 2.6, -0.1, { col: 'solid', tag: 'hood' });
  B.box('steel', -4.5, 0, -0.85, -3.3, 2.0, -0.1, { tag: 'fridge' });
  B.segXYZ(-4.5 - 0.002, 1.2, -0.85 - 0.003, -3.3, 1.2, -0.853, B.fine, [0, 0, -1]);
  B.box('dark', -3.55, 1.3, -0.9, -3.45, 1.7, -0.86, { col: 'none' });
  B.box('steel', -8.5, 0.86, -3.6, -5.5, 0.92, -2.9, { col: 'none' });
  B.collider(-8.5, 0, -3.6, -5.5, 0.92, -2.9, 'solid', 'prep');
  for (const [lx, lz] of [[-8.4, -3.5], [-5.6, -3.5], [-8.4, -3.0], [-5.6, -3.0]]) B.box('steel', lx - 0.03, 0, lz - 0.03, lx + 0.03, 0.86, lz + 0.03, { col: 'none' });
  B.box('steel', -8.4, 0.25, -3.5, -5.6, 0.28, -3.0, { col: 'none' });
  for (const [px, pz] of [[-7.8, -3.25], [-6.4, -3.25]]) B.cyl('machine', px, 0.92, pz, 0.14, 0.18, 10, { col: 'none', verticals: 2 });
  // shelves on the west wall (north part)
  B.box('steel', -9.9, 0, -11.6, -9.4, 2.0, -8.2, { col: 'solid', tag: 'shelf', edges: true });
  for (let i = 1; i < 4; i++) B.segXYZ(-9.397, i * 0.5, -11.6, -9.397, i * 0.5, -8.2, B.ink, [1, 0, 0]);
  for (let i = 0; i < 5; i++) B.box('crate', -9.85, 0.5 + (i % 3) * 0.5, -11.4 + i * 0.62, -9.45, 0.5 + (i % 3) * 0.5 + 0.32, -11.0 + i * 0.62, { col: 'none' });
  B.cyl('steel', -1.0, 0, -11.2, 0.3, 0.8, 10, { tag: 'bin', col: 'solid' });
  // kitchen tiles
  for (let x = -9.3; x < -0.1; x += 0.6) B.segXYZ(x, 0.004, -11.9, x, 0.004, 0, B.fine, [0, 1, 0]);
  for (let z = -11.3; z < 0; z += 0.6) B.segXYZ(-9.9, 0.004, z, -0.1, 0.004, z, B.fine, [0, 1, 0]);
  ceilLamp(-5, -9.5); ceilLamp(-5, -3.5); ceilLamp(-8, -3.5);
  nav(-1.6, -10.0, 0, 'sideDoorW'); nav(-1.3, -8.2); nav(-1.3, -4.6); nav(-1.4, -1.6); nav(-5, -9.4);
  nav(-5, -10.4, 0, 'kitchenNorthS'); nav(-8, -9.6); nav(-4, -4.8); nav(-7.2, -4.8); nav(-4, -1.9);

  // --------------------------------------------------------------- 4. canteen: x [-23.7, 11.7], z [-27.7, -12.1]
  const tableXs = [-19, -12.5, -6, 0.5];
  const tableZs = [-16, -20, -24];
  for (const cz of tableZs) {
    for (const cx of tableXs) {
      B.box('table', cx - 1, 0.72, cz - 0.45, cx + 1, 0.77, cz + 0.45, { col: 'none' });
      for (const [lx, lz] of [[-0.9, -0.36], [0.9, -0.36], [-0.9, 0.36], [0.9, 0.36]]) {
        B.box('steel', cx + lx - 0.03, 0, cz + lz - 0.03, cx + lx + 0.03, 0.72, cz + lz + 0.03, { col: 'none' });
      }
      B.collider(cx - 1, 0, cz - 0.45, cx + 1, 0.77, cz + 0.45, 'solid', 'table');
      // a tray or two on some tables
      if (rng() < 0.6) {
        const tx = cx + (rng() - 0.5) * 1.2;
        B.box('tray', tx - 0.22, 0.77, cz - 0.16, tx + 0.22, 0.8, cz + 0.16, { col: 'none', cast: false });
        B.cyl('machine', tx + 0.08, 0.8, cz, 0.06, 0.09, 8, { col: 'none', verticals: false });
      }
      for (const sx of [-0.5, 0.5]) {
        for (const sz of [-1, 1]) {
          const jx = (rng() - 0.5) * 0.12, jz = (rng() - 0.5) * 0.1, jr = (rng() - 0.5) * 0.25;
          chair(cx + sx + jx, cz + sz * 0.78 + jz, sz, jr);
        }
      }
    }
  }
  function chair(x, z, face, jr) {
    // face = +1: chair sits on the +z side facing -z (toward the table)
    const rot = (face > 0 ? 0 : Math.PI) + jr;
    const m = new THREE.Matrix4();
    const place = (lx, ly, lz, sx, sy, sz) => {
      m.makeRotationY(rot).setPosition(x, 0, z);
      const off = new THREE.Vector3(lx, ly, lz).applyMatrix4(new THREE.Matrix4().makeRotationY(rot));
      m.setPosition(x + off.x, ly, z + off.z);
      B.boxM('chair', m, sx, sy, sz, {});
    };
    place(0, 0.465, 0, 0.42, 0.05, 0.42);
    place(0, 0.7, 0.19, 0.42, 0.42, 0.04);
    for (const [lx, lz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) place(lx, 0.22, lz, 0.035, 0.44, 0.035);
    B.collider(x - 0.26, 0, z - 0.26, x + 0.26, 0.92, z + 0.26, 'move', 'chair');
  }
  // EXIT signs over the two exit doors
  for (const ex of [-14, 2]) {
    B.box('signExit', ex - 0.45, 2.48, -27.7, ex + 0.45, 2.8, -27.6, { col: 'none', tag: 'exitSign' });
    signs.push({ x: ex, y: 2.64, z: -27.6, text: 'EXIT' });
  }
  // vending machines on the south wall, canteen side
  function vending(x0) {
    const x1 = x0 + 1.0, z0 = -12.95, z1 = -12.1, h = 1.9;
    B.box('vending', x0, 0, z0, x1, h, z1, { tag: 'vending' });
    const fz = z0 - 0.004;
    B.box('dark', x0 + 0.08, 0.75, z0 - 0.01, x0 + 0.68, 1.78, z0, { col: 'none', cast: false });
    for (let r = 0; r < 4; r++) {
      const y = 0.85 + r * 0.24;
      B.segXYZ(x0 + 0.08, y - 0.03, fz - 0.008, x0 + 0.68, y - 0.03, fz - 0.008, B.fine, [0, 0, -1]);
      for (let c2 = 0; c2 < 4; c2++) {
        const cx = x0 + 0.16 + c2 * 0.15;
        const role = ['tray', 'chair', 'foliage', 'tank'][(r + c2) % 4];
        B.cyl(role, cx, y, fz - 0.05, 0.035, 0.13, 6, { col: 'none', verticals: false });
      }
    }
    B.box('steel', x0 + 0.74, 1.1, z0 - 0.02, x0 + 0.92, 1.5, z0, { col: 'none' });
    B.box('dark', x0 + 0.12, 0.2, z0 - 0.02, x0 + 0.64, 0.45, z0, { col: 'none' });
    B.segXYZ(x0, h - 0.1, fz, x1, h - 0.1, fz, B.ink, [0, 0, -1]);
  }
  vending(6.3); vending(7.5); vending(8.7);
  // bins near exits, wall clock, ceiling lamps
  for (const bx of [-16, -12, 4.2]) B.cyl('steel', bx, 0, -27.1, 0.28, 0.8, 10, { tag: 'bin', col: 'solid' });
  {
    const m = new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(-12, 3.0, -12.14);
    B.cylM('machine', m, 0.36, 0.36, 0.05, 20, { verticals: false });
    B.segXYZ(-12, 3.0, -12.17, -12, 3.24, -12.17, B.ink, [0, 0, -1]); B.segXYZ(-12, 3.0, -12.17, -11.84, 2.92, -12.17, B.ink, [0, 0, -1]);
  }
  for (const lz of [-15, -19.5, -24]) for (const lx of [-18, -9, 0, 8]) ceilLamp(lx, lz, 1.6, 0.35);
  // canteen floor tiles (large)
  for (let x = -22.5; x < 11.7; x += 1.2) B.segXYZ(x, 0.004, -27.7, x, 0.004, -12.1, B.fine, [0, 1, 0]);
  for (let z = -26.5; z < -12.1; z += 1.2) B.segXYZ(-23.7, 0.004, z, 11.7, 0.004, z, B.fine, [0, 1, 0]);

  nav(-5, -13.6, 0, 'kitchenNorthN');
  for (const z of [-13.6, -18, -22, -26.4]) for (const x of [-22, -15.75, -9.25, -2.75, 3.75, 9.5]) nav(x, z);
  nav(-14, -26.2, 0, 'exitWestIn'); nav(2, -26.2, 0, 'exitEastIn');

  // --------------------------------------------------------------- 5. fenced yard (z < -28)
  function fence(x0, z0, x1, z1, o = {}) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const ux = (x1 - x0) / len, uz = (z1 - z0) / len;
    const H = 2.4, n = Math.max(1, Math.round(len / 3));
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * len;
      B.cyl('steel', x0 + ux * t, 0, z0 + uz * t, 0.045, H, 6, { col: 'none' });
    }
    B.cylBetween('steel', new THREE.Vector3(x0, H - 0.05, z0), new THREE.Vector3(x1, H - 0.05, z1), 0.025, 5, { col: 'none', verticals: false });
    B.segXYZ(x0, 0.08, z0, x1, 0.08, z1, B.fine);
    // diamond chain-link lattice
    const s = o.mesh || 0.36, v0 = 0.08, v1 = H - 0.06, hh = v1 - v0;
    const P = (u, v) => [x0 + ux * u, v, z0 + uz * u];
    for (let c = -hh; c < len; c += s) {
      // u = c + (v - v0)
      let ua = c, ub = c + hh, va = v0, vb = v1;
      if (ua < 0) { va = v0 - ua; ua = 0; }
      if (ub > len) { vb = v1 - (ub - len); ub = len; }
      if (ub - ua > 0.01) { const a = P(ua, va), b = P(ub, vb); B.segXYZ(a[0], a[1], a[2], b[0], b[1], b[2], B.fine); }
    }
    for (let c = 0; c < len + hh; c += s) {
      // u = c - (v - v0)
      let ua = c, ub = c - hh, va = v0, vb = v1;
      if (ua > len) { va = v0 + (ua - len); ua = len; }
      if (ub < 0) { vb = v1 + ub; ub = 0; }
      if (ua - ub > 0.01) { const a = P(ua, va), b = P(ub, vb); B.segXYZ(a[0], a[1], a[2], b[0], b[1], b[2], B.fine); }
    }
    // blocks movement only: bullets and sight pass through chain-link
    const th = 0.06;
    B.collider(Math.min(x0, x1) - th, 0, Math.min(z0, z1) - th, Math.max(x0, x1) + th, H + 0.1, Math.max(z0, z1) + th, 'moveOnly', 'fence');
  }
  fence(-40, -28, -40, -96);
  fence(34, -28, 34, -96);
  fence(-40, -96, -3.9, -96);
  fence(3.9, -96, 34, -96);
  fence(-40, -28, -24, -28);
  fence(12, -28, 34, -28);
  fence(-40, -60, -14, -60);
  fence(14, -70, 34, -70);
  // outer run beyond the gate (keeps the finish lane tidy)
  fence(-8, -96, -8, -118); fence(8, -96, 8, -118);

  // paths
  const PATH_H = 0.03;
  B.box('path', -16, 0, -31.2, 4, PATH_H, -28.02, { tag: 'path', edges: true });
  B.box('path', -1.6, 0, -71.4, 1.6, PATH_H, -31.2, { tag: 'path' });
  B.box('path', -1.6, 0, -125, 1.6, PATH_H, -80.6, { tag: 'path' });

  // water tower (the landmark) on a concrete pad
  {
    const cx = 0, cz = -76;
    B.box('concrete', cx - 4.5, 0, cz - 4.5, cx + 4.5, 0.25, cz + 4.5, { tag: 'pad' });
    const legs = [];
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const a = new THREE.Vector3(cx + sx * 2.7, 0.25, cz + sz * 2.7);
      const b = new THREE.Vector3(cx + sx * 2.2, 12, cz + sz * 2.2);
      legs.push([a, b]);
      B.cylBetween('steel', a, b, 0.17, 8, { col: 'none' });
      B.box('concrete', a.x - 0.35, 0.25, a.z - 0.35, a.x + 0.35, 0.55, a.z + 0.35, { tag: 'footing' });
      for (let i = 0; i < 3; i++) {
        const p = a.clone().lerp(b, (i + 0.5) / 3);
        B.collider(p.x - 0.22, 0.25 + i * 3.9, p.z - 0.22, p.x + 0.22, 0.25 + (i + 1) * 3.9, p.z + 0.22, 'solid', 'towerleg');
      }
    }
    const lv = [0.25, 4.1, 8.05, 12];
    const at = (leg, y) => leg[0].clone().lerp(leg[1], (y - 0.25) / 11.75);
    for (let i = 0; i < 4; i++) {
      const L0 = legs[i], L1 = legs[(i + 1) % 4];
      for (let k = 1; k < lv.length; k++) B.cylBetween('steel', at(L0, lv[k]), at(L1, lv[k]), 0.06, 5, { col: 'none' });
      for (let k = 0; k < lv.length - 1; k++) {
        B.cylBetween('steel', at(L0, lv[k] + 0.3), at(L1, lv[k + 1]), 0.04, 5, { col: 'none' });
        B.cylBetween('steel', at(L1, lv[k] + 0.3), at(L0, lv[k + 1]), 0.04, 5, { col: 'none' });
      }
    }
    // balcony + rail
    B.box('steel', cx - 3.6, 11.85, cz - 3.6, cx + 3.6, 12.0, cz + 3.6, { col: 'bullet' });
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      B.cyl('steel', cx + Math.sin(a) * 3.5, 12, cz + Math.cos(a) * 3.5, 0.025, 1.0, 4, { col: 'none', verticals: false });
    }
    B.cyl('steel', cx, 12.95, cz, 3.5, 0.06, 16, { col: 'none', verticals: false, open: true });
    // tank + cone roof
    B.cyl('tank', cx, 12, cz, 3.0, 4.6, 20, { col: 'bullet', verticals: 2, tag: 'tank' });
    B.cyl('tank', cx, 13.4, cz, 3.03, 0.08, 20, { col: 'none', verticals: false });
    B.cyl('tank', cx, 15.2, cz, 3.03, 0.08, 20, { col: 'none', verticals: false });
    B.cone('tank', cx, 16.6, cz, 3.3, 1.5, 20, { col: 'bullet', verticals: 2 });
    B.cyl('steel', cx, 18.05, cz, 0.12, 0.5, 8, { col: 'none' });
    // ladder (south face): rails + rungs as ink
    for (const lx of [-0.28, 0.28]) B.cylBetween('steel', new THREE.Vector3(cx + lx, 0.25, cz + 2.95), new THREE.Vector3(cx + lx, 12, cz + 2.95), 0.025, 4, { col: 'none' });
    for (let y = 0.6; y < 12; y += 0.35) B.segXYZ(cx - 0.28, y, cz + 2.95, cx + 0.28, y, cz + 2.95);
    // outflow pipe
    B.cylBetween('steel', new THREE.Vector3(cx, 0.25, cz), new THREE.Vector3(cx, 12, cz), 0.22, 10, { col: 'solid', verticals: 2 });
  }

  // guard tower (sniper) north of the west inner fence
  {
    const cx = -30, cz = -72, P = 6.0;
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      B.box('steel', cx + sx * 1.55 - 0.13, 0, cz + sz * 1.55 - 0.13, cx + sx * 1.55 + 0.13, P, cz + sz * 1.55 + 0.13, { tag: 'gtleg' });
      B.cyl('steel', cx + sx * 1.8, P + 1.0, cz + sz * 1.8, 0.05, 1.8, 6, { col: 'none' });
    }
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => [cx + sx * 1.55, cz + sz * 1.55]);
    for (let i = 0; i < 4; i++) {
      const [ax, az] = corners[i], [bx, bz] = corners[(i + 1) % 4];
      B.cylBetween('steel', new THREE.Vector3(ax, 0.3, az), new THREE.Vector3(bx, P - 0.2, bz), 0.035, 4, { col: 'none' });
      B.cylBetween('steel', new THREE.Vector3(bx, 0.3, bz), new THREE.Vector3(ax, P - 0.2, az), 0.035, 4, { col: 'none' });
      B.cylBetween('steel', new THREE.Vector3(ax, 3.0, az), new THREE.Vector3(bx, 3.0, bz), 0.04, 4, { col: 'none' });
    }
    B.box('crate', cx - 1.9, P, cz - 1.9, cx + 1.9, P + 0.2, cz + 1.9, { tag: 'gtfloor' });
    const R = P + 0.2, RH = 1.0;
    B.box('wall', cx - 1.9, R, cz - 1.9, cx + 1.9, R + RH, cz - 1.8, { tag: 'gtwall' });
    B.box('wall', cx - 1.9, R, cz + 1.8, cx + 1.9, R + RH, cz + 1.9, { tag: 'gtwall' });
    B.box('wall', cx - 1.9, R, cz - 1.8, cx - 1.8, R + RH, cz + 1.8, { tag: 'gtwall' });
    B.box('wall', cx + 1.8, R, cz - 1.8, cx + 1.9, R + RH, cz + 1.8, { tag: 'gtwall' });
    B.box('gable', cx - 2.1, R + 2.5, cz - 2.1, cx + 2.1, R + 2.6, cz + 2.1, { col: 'bullet' });
    B.cone('gable', cx, R + 2.6, cz, 3.0, 1.2, 4, { col: 'none', rotY: Math.PI / 4 });
    for (const lx of [-0.25, 0.25]) B.cylBetween('steel', new THREE.Vector3(cx + 1.95, 0, cz + lx), new THREE.Vector3(cx + 1.95, R + RH, cz + lx), 0.025, 4, { col: 'none' });
    for (let y = 0.35; y < R; y += 0.35) B.segXYZ(cx + 1.95, y, cz - 0.25, cx + 1.95, y, cz + 0.25);
    // searchlight
    B.cyl('lamp', cx + 1.2, R + RH, cz + 1.2, 0.18, 0.3, 10, { col: 'none' });
  }

  // gable-roofed barracks (enterable)
  function barracks(x0, z0, x1, z1, axis, door, wins) {
    const H = 3.0, FL = 0.15;
    B.box('floor', x0, 0, z0, x1, FL, z1, { tag: 'bfloor', edges: false });
    const opsN = [], opsS = [], opsW = [], opsE = [];
    const all = { n: opsN, s: opsS, w: opsW, e: opsE };
    for (const w of wins) all[w.side].push(win(w.a, w.b, 1.0, 2.2));
    const d = door;
    all[d.side].push(doorway(d.a, 1.04, FL, FL + 2.12, d.def));
    wall('x', x0, x1, z0 + 0.1, T_INT, 0, H, opsN, { tag: 'bwall' });
    wall('x', x0, x1, z1 - 0.1, T_INT, 0, H, opsS, { tag: 'bwall' });
    wall('z', z0 + 0.2, z1 - 0.2, x0 + 0.1, T_INT, 0, H, opsW, { tag: 'bwall' });
    wall('z', z0 + 0.2, z1 - 0.2, x1 - 0.1, T_INT, 0, H, opsE, { tag: 'bwall' });
    // triangular-prism roof (a 3-sided cylinder), scaled to a shallow gable
    const RH = 1.7, over = 0.35;
    const m = new THREE.Matrix4();
    const rot = new THREE.Matrix4();
    let width, length, cxm = (x0 + x1) / 2, czm = (z0 + z1) / 2;
    if (axis === 'x') {
      width = z1 - z0 + over * 2; length = x1 - x0 + over * 2;
      rot.makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0));
    } else {
      width = x1 - x0 + over * 2; length = z1 - z0 + over * 2;
      rot.makeBasis(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0));
    }
    const sx = (width / 2) / 0.8660254, sz = RH / 1.5;
    m.makeTranslation(cxm, H + RH / 3, czm).multiply(rot).multiply(new THREE.Matrix4().makeScale(sx, 1, sz));
    B.cylM('gable', m, 1, 1, length, 3, { col: 'none' });
    B.collider(x0 - over, H, z0 - over, x1 + over, H + RH, z1 + over, 'bullet', 'broof');
    // roofing lines along the slopes
    const nLines = 6;
    for (let i = 1; i < nLines; i++) {
      const f = i / nLines;
      if (axis === 'x') {
        for (const s of [-1, 1]) {
          const z = czm + s * (width / 2) * (1 - f), y = H + RH * f;
          B.segXYZ(x0 - over, y + 0.005, z, x1 + over, y + 0.005, z, B.fine, [0, width / 2, s * RH]);
        }
      } else {
        for (const s of [-1, 1]) {
          const x = cxm + s * (width / 2) * (1 - f), y = H + RH * f;
          B.segXYZ(x, y + 0.005, z0 - over, x, y + 0.005, z1 + over, B.fine, [s * RH, width / 2, 0]);
        }
      }
    }
  }
  const barracksADoor = { name: 'barracksA', x: -23.5, z: -41.1, y: 0.15, width: 1.0, height: 2.1, dirX: 1, dirZ: 0 };
  barracks(-30, -48, -16, -41, 'x', { side: 's', a: -23.52, def: barracksADoor },
    [{ side: 's', a: -28.6, b: -26.6 }, { side: 's', a: -20.2, b: -18.2 }, { side: 'n', a: -28, b: -26 }, { side: 'n', a: -20, b: -18 }]);
  B.box('concrete', -24.3, 0, -40.9, -21.9, 0.15, -39.6, { tag: 'stoop' });
  // bunks inside A
  function bunk(x, z, alongX) {
    const L = 1.95, W = 0.85;
    const [sx, sz] = alongX ? [L, W] : [W, L];
    for (const y of [0.42, 1.32]) B.box('bunk', x - sx / 2, y, z - sz / 2, x + sx / 2, y + 0.16, z + sz / 2, { col: 'none' });
    for (const [px, pz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) B.cyl('steel', x + px * (sx / 2 - 0.03), 0.15, z + pz * (sz / 2 - 0.03), 0.025, 1.65, 5, { col: 'none' });
    B.collider(x - sx / 2, 0.15, z - sz / 2, x + sx / 2, 1.8, z + sz / 2, 'solid', 'bunk');
  }
  bunk(-28.3, -47.3, true); bunk(-25.6, -47.3, true); bunk(-20.4, -47.3, true); bunk(-17.7, -47.3, true);
  B.box('table', -24.4, 0.87, -45.2, -22.6, 0.92, -44.3, { col: 'none' });
  B.collider(-24.4, 0.15, -45.2, -22.6, 0.92, -44.3, 'solid', 'table');
  for (const [lx, lz] of [[-24.3, -45.1], [-22.7, -45.1], [-24.3, -44.4], [-22.7, -44.4]]) B.box('steel', lx - 0.03, 0.15, lz - 0.03, lx + 0.03, 0.87, lz + 0.03, { col: 'none' });
  B.box('locker', -29.8, 0.15, -44.5, -29.3, 2.0, -42.2, { tag: 'locker' });
  for (let z = -44.1; z < -42.2; z += 0.6) B.segXYZ(-29.297, 0.25, z, -29.297, 1.9, z, B.fine, [1, 0, 0]);

  const barracksBDoor = { name: 'barracksB', x: 16.1, z: -55.52, y: 0.15, width: 1.0, height: 2.1, dirX: 0, dirZ: 1 };
  barracks(16, -62, 23, -48, 'z', { side: 'w', a: -55.54, def: barracksBDoor },
    [{ side: 'w', a: -60.5, b: -58.5 }, { side: 'w', a: -52, b: -50 }, { side: 'e', a: -60, b: -58 }, { side: 'e', a: -52, b: -50 }]);
  B.box('concrete', 14.7, 0, -56.3, 15.9, 0.15, -53.7, { tag: 'stoop' });
  bunk(21.9, -60.2, false); bunk(21.9, -57.5, false); bunk(21.9, -51.8, false); bunk(21.9, -49.9 + 0.1, false);
  B.box('crate', 17.2, 0.15, -61.6, 18.3, 1.05, -60.6, { tag: 'crate' });

  // pines: stacked 7-sided cones on a trunk
  function pine(x, z, s = 1) {
    B.cyl('trunk', x, 0, z, 0.16 * s, 1.3 * s, 7, { col: 'none' });
    B.collider(x - 0.22 * s, 0, z - 0.22 * s, x + 0.22 * s, 2.4 * s, z + 0.22 * s, 'solid', 'trunk');
    B.cone('foliage', x, 0.9 * s, z, 1.75 * s, 2.5 * s, 7, { col: 'none' });
    B.cone('foliage', x, 2.1 * s, z, 1.38 * s, 2.2 * s, 7, { col: 'none', rotY: 0.45 });
    B.cone('foliage', x, 3.2 * s, z, 1.0 * s, 1.9 * s, 7, { col: 'none', rotY: 0.9 });
    B.collider(x - 0.9 * s, 1.2 * s, z - 0.9 * s, x + 0.9 * s, 4.5 * s, z + 0.9 * s, 'bullet', 'foliage');
  }
  const pines = [
    [-37, -34, 1.1], [-36.5, -50, 1.25], [-36, -66, 1.0], [-35, -82, 1.3], [-37, -92, 1.0],
    [31, -33, 1.2], [30.5, -45, 1.0], [31, -78, 1.35], [29.5, -91, 1.1], [-13.5, -47, 0.95],
    [26.5, -57, 1.2], [-10.5, -93, 1.1], [11.5, -93, 1.15], [-22, -64, 1.0], [24, -84, 1.05],
    [-46, -40, 1.4], [-49, -70, 1.6], [42, -50, 1.5], [41, -86, 1.4], [-20, -106, 1.5],
    [18, -104, 1.6], [-12, -112, 1.3], [12, -114, 1.4], [-30, -20, 1.4], [20, -12, 1.3],
    [-32, 2, 1.5], [21, 6, 1.4], [-44, -10, 1.6], [30, -2, 1.5], [0, 20, 1.6], [-16, 18, 1.3],
    [-55, -95, 1.7], [55, -30, 1.8], [-3, -140, 1.8], [24, -130, 1.7],
  ];
  for (const [x, z, s] of pines) pine(x, z, s);

  // lamp posts with overhead cables
  const lampTops = [];
  function lampPost(x, z, dir) {
    const H = 6.2;
    B.cyl('steel', x, 0, z, 0.08, H, 8, { col: 'none', rTop: 0.06 });
    B.collider(x - 0.12, 0, z - 0.12, x + 0.12, H, z + 0.12, 'solid', 'lamppost');
    B.box('concrete', x - 0.25, 0, z - 0.25, x + 0.25, 0.3, z + 0.25, { col: 'none' });
    const ax = x + dir * 1.3;
    B.box('steel', Math.min(x, ax) - 0.04, H - 0.12, z - 0.04, Math.max(x, ax) + 0.04, H - 0.04, z + 0.04, { col: 'none' });
    B.box('lamp', ax - 0.28, H - 0.3, z - 0.16, ax + 0.28, H - 0.1, z + 0.16, { col: 'none' });
    B.cyl('lamp', ax, H - 0.38, z, 0.1, 0.08, 8, { col: 'none', verticals: false });
    B.cyl('steel', x, H, z, 0.03, 0.4, 4, { col: 'none', verticals: false });
    lampTops.push(new THREE.Vector3(x, H + 0.35, z));
  }
  lampPost(-7, -32, 1); lampPost(-7, -50, 1); lampPost(-7, -66, 1); lampPost(-7, -87, 1);
  lampPost(7, -38, -1); lampPost(7, -56, -1); lampPost(7, -86, -1);
  const [L1, L2, L3, L4, R1, R2, R3] = lampTops;
  B.cable(L1, L2, 0.7); B.cable(L2, L3, 0.6); B.cable(L3, L4, 0.9);
  B.cable(R1, R2, 0.7); B.cable(R2, R3, 1.1); B.cable(L1, R1, 0.5);
  B.cable(new THREE.Vector3(-7, PARAPET_TOP, -28), L1, 0.3);
  B.cable(new THREE.Vector3(7, PARAPET_TOP, -28), R1, 0.6);
  B.cable(L3, new THREE.Vector3(-30, 8.9, -72), 1.4);
  B.cable(R2, new THREE.Vector3(16, 4.3, -55), 0.5);
  B.cable(new THREE.Vector3(-16, 4.2, -44.5), L2, 0.8);

  // jersey barriers
  function jersey(x, z, alongZ = false) {
    const L = 2.0;
    const parts = [[0, 0.3, 0.62], [0.3, 0.75, 0.38], [0.75, 0.97, 0.22]];
    for (const [y0, y1, w] of parts) {
      if (alongZ) B.box('concrete', x - w / 2, y0, z - L / 2, x + w / 2, y1, z + L / 2, { col: 'none' });
      else B.box('concrete', x - L / 2, y0, z - w / 2, x + L / 2, y1, z + w / 2, { col: 'none' });
    }
    if (alongZ) B.collider(x - 0.31, 0, z - L / 2, x + 0.31, 0.97, z + L / 2, 'solid', 'barrier');
    else B.collider(x - L / 2, 0, z - 0.31, x + L / 2, 0.97, z + 0.31, 'solid', 'barrier');
  }
  jersey(-3.5, -38.5); jersey(4.5, -44); jersey(-10, -53); jersey(-3, -58.5); jersey(9, -63);
  jersey(-8, -71, true); jersey(5.5, -88.5); jersey(-4.5, -91.5); jersey(-20, -35); jersey(18, -40);
  jersey(-16, -76, true); jersey(20, -76);

  // crates (1.2 m: taller than a jump, can't be used to climb a fence)
  function crate(x, z, y = 0, s = 1.2) {
    B.box('crate', x - s / 2, y, z - s / 2, x + s / 2, y + s, z + s / 2, { tag: 'crate' });
    const e = 0.004, i = 0.1;
    for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const fx = x + nx * (s / 2 + e), fz = z + nz * (s / 2 + e);
      const tx = nz !== 0 ? 1 : 0, tz = nx !== 0 ? 1 : 0;
      const a = s / 2 - i;
      const p = (u, v) => [fx + tx * u, y + s / 2 + v, fz + tz * u];
      const q = [p(-a, -a), p(a, -a), p(a, a), p(-a, a)];
      const FN = [nx, 0, nz];
      for (let k = 0; k < 4; k++) { const A = q[k], Bq = q[(k + 1) % 4]; B.segXYZ(A[0], A[1], A[2], Bq[0], Bq[1], Bq[2], B.fine, FN); }
      B.segXYZ(q[0][0], q[0][1], q[0][2], q[2][0], q[2][1], q[2][2], B.fine, FN);
    }
  }
  crate(10.5, -46.5); crate(11.8, -46.3); crate(11.1, -46.4, 1.2, 1.1);
  crate(-12, -64); crate(-12.2, -65.3); crate(13, -78); crate(-15, -85); crate(-16.3, -85.2);
  crate(14.5, -90); crate(-9, -31.5, 0, 1.0); crate(8.5, -31.2, 0, 1.0); crate(-26, -54); crate(25, -66);
  crate(3.5, -66.5); crate(-2.5, -84.5, 0, 1.0);

  // --------------------------------------------------------------- 6. North Gate
  {
    const gz = -96;
    for (const s of [-1, 1]) {
      B.box('concrete', s * 3.4 - 0.45, 0, gz - 0.45, s * 3.4 + 0.45, 3.5, gz + 0.45, { tag: 'gatepost' });
      B.box('concrete', s * 3.4 - 0.55, 3.5, gz - 0.55, s * 3.4 + 0.55, 3.62, gz + 0.55, { col: 'none' });
    }
    B.box('steel', -3.9, 3.62, gz - 0.2, 3.9, 3.95, gz + 0.2, { col: 'bullet' });
    B.box('signGate', -2.3, 3.97, gz - 0.06, 2.3, 4.72, gz + 0.06, { col: 'none', tag: 'gateSign' });
    signs.push({ x: 0, y: 4.35, z: gz, text: 'NORTH GATE' });
    for (const x of [-1.9, 1.9]) B.cyl('steel', x, 3.95, gz, 0.04, 0.05, 4, { col: 'none' });
    // gate leaves swung fully open outward (north)
    for (const s of [-1, 1]) {
      const hx = s * 2.95, L = 2.8, H = 2.2;
      const z0 = gz - 0.1, z1 = gz - 0.1 - L;
      B.cylBetween('steel', new THREE.Vector3(hx, 0.1, z0), new THREE.Vector3(hx, 0.1, z1), 0.035, 5, { col: 'none' });
      B.cylBetween('steel', new THREE.Vector3(hx, H, z0), new THREE.Vector3(hx, H, z1), 0.035, 5, { col: 'none' });
      B.cylBetween('steel', new THREE.Vector3(hx, 0.1, z0), new THREE.Vector3(hx, H, z0), 0.04, 5, { col: 'none' });
      B.cylBetween('steel', new THREE.Vector3(hx, 0.1, z1), new THREE.Vector3(hx, H, z1), 0.04, 5, { col: 'none' });
      for (let c = -H; c < L; c += 0.36) {
        let ua = c, ub = c + H - 0.1, va = 0.1, vb = H;
        if (ua < 0) { va = 0.1 - ua; ua = 0; }
        if (ub > L) { vb = H - (ub - L); ub = L; }
        if (ub > ua) B.segXYZ(hx, va, z0 - ua, hx, vb, z0 - ub, B.fine);
      }
      for (let c = 0; c < L + H; c += 0.36) {
        let ua = c, ub = c - (H - 0.1), va = 0.1, vb = H;
        if (ua > L) { va = 0.1 + (ua - L); ua = L; }
        if (ub < 0) { vb = H + ub; ub = 0; }
        if (ua > ub) B.segXYZ(hx, va, z0 - ua, hx, vb, z0 - ub, B.fine);
      }
      B.collider(hx - 0.06, 0, z1, hx + 0.06, H, z0, 'moveOnly', 'gateLeaf');
    }
    // a guard booth by the gate
    B.box('wall', 5.2, 0, -94.5, 7.4, 2.5, -92.5, { tag: 'booth' });
    B.box('gable', 5.0, 2.5, -94.7, 7.6, 2.65, -92.3, { col: 'none' });
    B.box('dark', 5.5, 1.2, -92.49, 7.1, 2.0, -92.47, { col: 'none' });
  }

  // yard nav grid
  for (const z of [-33, -38, -44, -52, -57, -64, -69, -75, -83, -89, -93]) {
    for (const x of [-35, -27, -20, -12, -4, 3, 10, 18, 27]) nav(x, z, 0, 'yard');
  }
  nav(-14, -29.8, 0, 'exitWestOut'); nav(2, -29.8, 0, 'exitEastOut');
  nav(-23, -39.0, 0, 'barracksAOut'); nav(-23, -42.7, 0.15, 'barracksAIn'); nav(-26.5, -44.6, 0.15); nav(-19.5, -44.6, 0.15);
  nav(14.2, -55, 0, 'barracksBOut'); nav(17.7, -55, 0.15, 'barracksBIn'); nav(19.6, -51.5, 0.15); nav(19.6, -58.8, 0.15);
  nav(0, -84, 0, 'towerNorth'); nav(-6, -78, 0); nav(6, -78, 0); nav(0, -69.5, 0, 'towerSouth');
  nav(0, -98.5, 0, 'gateOut'); nav(0, -94, 0, 'gateIn');

  // --------------------------------------------------------------- clouds (Neobrutalist sky only)
  {
    const cloudRng = mulberry32(99);
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2 + cloudRng() * 0.3;
      const dist = 170 + cloudRng() * 110;
      const cx = Math.sin(ang) * dist, cz = -40 + Math.cos(ang) * dist, cy = 48 + cloudRng() * 38;
      const face = new THREE.Vector3(-Math.sin(ang), 0, -Math.cos(ang)); // toward the map
      const side = new THREE.Vector3(face.z, 0, -face.x);
      const n = 3 + Math.floor(cloudRng() * 3);
      for (let k = 0; k < n; k++) {
        const r = 7 + cloudRng() * 7;
        const off = (k - (n - 1) / 2) * 9 + (cloudRng() - 0.5) * 3;
        const up = k === Math.floor(n / 2) ? 5 : (cloudRng() * 3);
        const p = new THREE.Vector3(cx, cy + up, cz).addScaledVector(side, off).addScaledVector(face, k % 2 ? 1.2 : 0);
        const m = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), face)).setPosition(p);
        B.cylM('cloud', m, r, r, 1.0, 20, { col: 'none', verticals: false, lines: B.cloudLines, cast: false });
      }
    }
  }

  // --------------------------------------------------------------- build scene objects
  const built = B.build(materials, scene);
  const world = new CollisionWorld(-100, -160, 95, 55, 4);
  for (const b of B.colliders) world.add(b);
  world.finalize();

  const doors = doorDefs.map((d) => {
    const door = new Door(d, materials);
    if (door.group) scene.add(door.group);
    return door;
  });

  // nav points: nudge any that sit inside a prop, drop the ones that can't be freed
  const clearAt = (x, y, z, r = 0.4) => {
    const list = world.query(x - r, z - r, x + r, z + r, F_MOVE).slice();
    for (const b of list) {
      if (b.maxY <= y + 0.35 || b.minY >= y + 1.8) continue;
      if (circleOverlapsRect(x, z, r, b)) return false;
    }
    return true;
  };
  const navGraph = new NavGraph();
  for (const p of navPts) {
    let { x, z } = p;
    if (!clearAt(x, p.y, z)) {
      let found = false;
      for (const rad of [0.3, 0.6, 1.0, 1.5]) {
        for (let k = 0; k < 8 && !found; k++) {
          const a = (k / 8) * Math.PI * 2;
          const nx = p.x + Math.cos(a) * rad, nz = p.z + Math.sin(a) * rad;
          if (clearAt(nx, p.y, nz)) { x = nx; z = nz; found = true; }
        }
        if (found) break;
      }
      if (!found) continue;
    }
    navGraph.add(x, p.y, z, p.tag);
  }
  navGraph.snap(world);
  navGraph.autoConnect(world, doors, 11);
  // the stair isn't auto-connectable (height change): chain it by hand
  const byTag = (t) => navGraph.nodes.find((n) => n.tag === t);
  navGraph.link(byTag('landing'), byTag('stairMid'));
  navGraph.link(byTag('stairMid'), byTag('stairBottom'));

  if (typeof document !== 'undefined') {
    materials.setTexture('signExit', signTexture('EXIT', 256, 96, 88));
    materials.setTexture('signGate', signTexture('NORTH GATE', 512, 84, 56));
  }

  return {
    world, doors, nav: navGraph, built, signs, byTag,
    stats: B.stats,
    playerStart: { x: -16, y: ROOF_Y, z: 4.5, yaw: -Math.PI / 2 + 0.22, pitch: -0.03 },
    spawns: ENEMY_SPAWNS,
    shots: CAMERA_SHOTS,
    route: ROUTE,
  };
}

// About 15 enemies placed along the route.
export const ENEMY_SPAWNS = [
  // roof
  { id: 'R1', x: 6.8, y: ROOF_Y, z: -12.6, yaw: -0.6, weapon: 'pistol', area: 'roof' },
  { id: 'R2', x: -19, y: ROOF_Y, z: -24.5, yaw: -1.57, weapon: 'smg', area: 'roof', patrol: [[-19, -24.5], [8.5, -24.5], [9, -14]] },
  // stair room: faces the window, back to the stair
  { id: 'S1', x: 5.6, y: 0, z: -10.9, yaw: 0.35, weapon: 'smg', area: 'stairRoom' },
  // kitchen: behind the serving counter, facing the side door area
  { id: 'K1', x: -6.2, y: 0, z: -4.8, yaw: 0.0, weapon: 'shotgun', area: 'kitchen' },
  // canteen
  { id: 'C1', x: -15.5, y: 0, z: -18, yaw: -1.2, weapon: 'rifle', area: 'canteen' },
  { id: 'C2', x: -20, y: 0, z: -26.4, yaw: -1.57, weapon: 'smg', area: 'canteen', patrol: [[-20, -26.4], [9, -26.4], [9, -18]] },
  { id: 'C3', x: 7.0, y: 0, z: -15.2, yaw: 1.2, weapon: 'pistol', area: 'canteen' },
  // yard
  { id: 'Y1', x: -10, y: 0, z: -35.5, yaw: 0, weapon: 'smg', area: 'yard', patrol: [[-10, -35.5], [6, -35.5]] },
  { id: 'Y2', x: -21.2, y: 0, z: -38.8, yaw: -2.2, weapon: 'rifle', area: 'yard' },
  { id: 'Y3', x: -25, y: 0.15, z: -44.6, yaw: 1.2, weapon: 'shotgun', area: 'barracks' },
  { id: 'Y4', x: 10.6, y: 0, z: -47.8, yaw: -2.9, weapon: 'rifle', area: 'yard' },
  { id: 'Y5', x: 13, y: 0, z: -50, yaw: 3.14, weapon: 'smg', area: 'yard', patrol: [[13, -50], [13, -66], [4, -66]] },
  { id: 'Y6', x: 3.4, y: 0.25, z: -71.9, yaw: 3.0, weapon: 'smg', area: 'tower' },
  { id: 'Y7', x: -30, y: 6.2, z: -72, yaw: -2.2, weapon: 'rifle', area: 'guardTower', sniper: true },
  { id: 'Y8', x: -8, y: 0, z: -91, yaw: 3.14, weapon: 'shotgun', area: 'gate', patrol: [[-8, -91], [8, -91]] },
];

// Respawn checkpoints, in route order. Reaching an area makes it your checkpoint (only ever
// moving forward); dying lets you respawn at the latest one.
export const CHECKPOINTS = [
  { id: 'roof', label: 'Roof', at: () => true, pose: { x: -16, y: ROOF_Y, z: 4.5, yaw: -Math.PI / 2 + 0.22, pitch: 0 } },
  { id: 'stairRoom', label: 'Stair room', at: (p) => p.y < 0.5 && p.x > 0.1 && p.x < 8.9 && p.z < 0 && p.z > -11.9, pose: { x: 3.5, y: 0, z: -9.2, yaw: Math.PI / 2, pitch: 0 } },
  { id: 'kitchen', label: 'Kitchen', at: (p) => p.y < 0.5 && p.x > -9.9 && p.x < -0.1 && p.z < 0 && p.z > -11.9, pose: { x: -1.6, y: 0, z: -8.5, yaw: 0.77, pitch: 0 } },
  { id: 'canteen', label: 'Canteen', at: (p) => p.y < 0.5 && p.x > -23.7 && p.x < 11.7 && p.z < -12.1 && p.z > -27.7, pose: { x: -5, y: 0, z: -13.6, yaw: 0, pitch: 0 } },
  { id: 'yard', label: 'Yard', at: (p) => p.z < -28.5 && p.z > -66, pose: { x: 2, y: 0.03, z: -30.8, yaw: 0, pitch: 0 } },
  { id: 'tower', label: 'Water tower', at: (p) => p.z <= -66 && p.z > -96, pose: { x: 0, y: 0.03, z: -68.2, yaw: 0, pitch: 0 } },
];

// Named viewpoints (used for the menu previews and the automated screenshot pass).
export const CAMERA_SHOTS = {
  roof: { pos: [-16, 6.65, 4.5], look: [3.5, 6.2, 0] },
  hut: { pos: [3.5, 6.65, 7], look: [3.5, 6.2, 0] },
  stair: { pos: [3.5, 6.6, 1.3], look: [3.5, 1.2, -10] },
  stairRoom: { pos: [7.8, 1.65, -3], look: [1, 1.2, -11.5] },
  kitchen: { pos: [-1.3, 1.65, -10.6], look: [-7, 1.0, -4] },
  canteen: { pos: [10.5, 1.9, -13.4], look: [-15, 0.8, -24] },
  yard: { pos: [-3, 1.7, -30.5], look: [0, 6, -76] },
  tower: { pos: [9, 1.7, -60], look: [0, 10, -76] },
  gate: { pos: [0, 1.7, -84], look: [0, 2.5, -100] },
  orbitCentre: { pos: [-6, 0, -40], look: [0, 0, 0] },
  preview: { pos: [9.5, 2.1, -13.2], look: [-10, 1.0, -22] },
};

// Route markers for the Mission minimap (numbered like the brief).
export const ROUTE = [
  { n: 1, label: 'Roof', x: -6, z: 0 },
  { n: 2, label: 'Stair', x: 3.5, z: -5 },
  { n: 3, label: 'Kitchen', x: -5, z: -7 },
  { n: 4, label: 'Canteen', x: -6, z: -20 },
  { n: 5, label: 'Yard', x: 0, z: -55 },
  { n: 6, label: 'North Gate', x: 0, z: -96 },
];

function signTexture(text, w, h, px) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#000'; g.lineWidth = 6; g.strokeRect(5, 5, w - 10, h - 10);
  g.fillStyle = '#000';
  g.font = `900 ${px}px Arial Black, Arial, Helvetica, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 3);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}
