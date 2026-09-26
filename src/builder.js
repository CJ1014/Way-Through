// Builds the static world from boxes, cylinders and cones. Each primitive:
//  - is transformed and queued under its material role (merged into ONE mesh per role),
//  - contributes its ink edges to a single fat-line batch (one draw call for all edges),
//  - optionally registers an AABB collider.
import * as THREE from '../vendor/three/three.module.js';
import { mergeGeometries } from '../vendor/three/addons/utils/BufferGeometryUtils.js';
import { LineSegmentsGeometry } from '../vendor/three/addons/lines/LineSegmentsGeometry.js';
import { LineSegments2 } from '../vendor/three/addons/lines/LineSegments2.js';
import { Box, F_MOVE, F_BULLET, F_WALK, F_SOLID } from './collision.js';

const COL = {
  solid: F_SOLID,
  move: F_MOVE | F_WALK,       // blocks movement, bullets pass (fences, window panes)
  moveOnly: F_MOVE,            // blocks movement, not walkable, bullets pass
  bullet: F_BULLET,            // stops bullets/sight but not movement
  walk: F_WALK | F_MOVE,
  none: 0,
};

const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _nm = new THREE.Matrix3();
const _na = new THREE.Vector3();
const _nb = new THREE.Vector3();
const AXES = { 1: [1, 0, 0], 2: [0, 1, 0], 4: [0, 0, 1] };

// A line list: flat xyz,xyz positions plus, per segment, the normals of the (up to two)
// faces it borders. The line shader drops a segment when both faces point away from the
// camera, so edges on the far side of a wall or slab never bleed through it.
export function lineList() { const a = []; a.n = []; return a; }

export class Builder {
  constructor() {
    this.groups = new Map();
    this.ink = lineList();
    this.fine = lineList();
    this.cloudLines = lineList();
    this.colliders = [];
  }

  _geo(role, geo, cast) {
    const key = role + (cast ? '' : '|noshadow');
    let g = this.groups.get(key);
    if (!g) { g = { role, cast, list: [] }; this.groups.set(key, g); }
    g.list.push(geo);
  }

  _lines(o) { return o.lines || (o.fineEdges ? this.fine : this.ink); }

  // na / nb: face normals ({x,y,z} or [x,y,z]); omit both for lines that are always drawn.
  seg(a, b, arr = this.ink, na = null, nb = null) {
    arr.push(a.x, a.y, a.z, b.x, b.y, b.z);
    pushN(arr, na, nb);
  }
  segXYZ(x0, y0, z0, x1, y1, z1, arr = this.ink, na = null, nb = null) {
    arr.push(x0, y0, z0, x1, y1, z1);
    pushN(arr, na, nb);
  }

  collider(x0, y0, z0, x1, y1, z1, col = 'solid', tag = '') {
    const flags = typeof col === 'number' ? col : COL[col];
    if (!flags) return null;
    const b = new Box(x0, y0, z0, x1, y1, z1, flags, tag);
    this.colliders.push(b);
    return b;
  }

  // Box of size (sx,sy,sz) centred at the origin, then transformed by matrix m.
  boxM(role, m, sx, sy, sz, o = {}) {
    const g = new THREE.BoxGeometry(sx, sy, sz);
    g.applyMatrix4(m);
    if (role) this._geo(role, g, o.cast !== false);
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const c = [];
    for (let i = 0; i < 8; i++) {
      c.push(new THREE.Vector3(i & 1 ? hx : -hx, i & 2 ? hy : -hy, i & 4 ? hz : -hz).applyMatrix4(m));
    }
    if (o.edges !== false) {
      const L = this._lines(o);
      const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
      const skip = o.skipEdges; // optional predicate on edge index
      _nm.getNormalMatrix(m);
      for (let i = 0; i < 12; i++) {
        if (skip && skip(i)) continue;
        const [ia, ib] = E[i];
        const along = ia ^ ib;
        const fn = [];
        for (const k of [1, 2, 4]) {
          if (k === along) continue;
          const sg = ia & k ? 1 : -1, ax = AXES[k];
          fn.push(new THREE.Vector3(ax[0] * sg, ax[1] * sg, ax[2] * sg).applyMatrix3(_nm).normalize());
        }
        this.seg(c[ia], c[ib], L, fn[0], fn[1]);
      }
    }
    if (o.col && o.col !== 'none') {
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (const p of c) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); z0 = Math.min(z0, p.z); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); z1 = Math.max(z1, p.z); }
      this.collider(x0, y0, z0, x1, y1, z1, o.col, o.tag);
    }
    return c;
  }

  // Axis-aligned box from min/max corners. Collides as solid unless o.col says otherwise.
  box(role, x0, y0, z0, x1, y1, z1, o = {}) {
    const sx = Math.abs(x1 - x0), sy = Math.abs(y1 - y0), sz = Math.abs(z1 - z0);
    _m.makeTranslation((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    if (!('col' in o)) o = Object.assign({ col: 'solid' }, o);
    return this.boxM(role, _m, sx, sy, sz, o);
  }

  // Box centred at (cx,cy,cz), rotated about Y. Collider (if any) is the rotated AABB.
  obox(role, cx, cy, cz, sx, sy, sz, rotY = 0, o = {}) {
    _q.setFromAxisAngle(_up, rotY);
    _m.compose(_v.set(cx, cy, cz), _q, _s.set(1, 1, 1));
    return this.boxM(role, _m, sx, sy, sz, o);
  }

  // Cylinder along local Y (height h, centred), transformed by m.
  cylM(role, m, rTop, rBot, h, seg = 8, o = {}) {
    const g = new THREE.CylinderGeometry(rTop, rBot, h, seg, 1, !!o.open);
    g.applyMatrix4(m);
    if (role) this._geo(role, g, o.cast !== false);
    if (o.edges !== false) {
      const L = this._lines(o);
      const top = [], bot = [];
      for (let i = 0; i < seg; i++) {
        const th = (i / seg) * Math.PI * 2;
        top.push(new THREE.Vector3(rTop * Math.sin(th), h / 2, rTop * Math.cos(th)).applyMatrix4(m));
        bot.push(new THREE.Vector3(rBot * Math.sin(th), -h / 2, rBot * Math.cos(th)).applyMatrix4(m));
      }
      _nm.getNormalMatrix(m);
      const slope = (rBot - rTop) / h;
      const sideN = (th) => new THREE.Vector3(Math.sin(th), slope, Math.cos(th)).applyMatrix3(_nm).normalize();
      const capT = new THREE.Vector3(0, 1, 0).applyMatrix3(_nm).normalize();
      const capB = new THREE.Vector3(0, -1, 0).applyMatrix3(_nm).normalize();
      const rings = o.rings !== false;
      const dth = (Math.PI * 2) / seg;
      for (let i = 0; i < seg; i++) {
        const j = (i + 1) % seg;
        const sn = sideN((i + 0.5) * dth);
        if (rings && rTop > 1e-4) this.seg(top[i], top[j], L, sn, o.open ? sn : capT);
        if (rings && rBot > 1e-4) this.seg(bot[i], bot[j], L, sn, o.open ? sn : capB);
      }
      const every = o.verticals === false ? 0 : (o.verticals || 1);
      if (every) {
        for (let i = 0; i < seg; i += every) this.seg(top[i], bot[i], L, sideN((i - 0.5) * dth), sideN((i + 0.5) * dth));
      }
    }
    if (o.col && o.col !== 'none') {
      const r = Math.max(rTop, rBot);
      _v.setFromMatrixPosition(m);
      // collider is the AABB of the transformed cylinder's bounding box
      g.computeBoundingBox();
      const bb = g.boundingBox;
      const shrink = o.colShrink ?? 0;
      this.collider(bb.min.x + shrink, bb.min.y, bb.min.z + shrink, bb.max.x - shrink, bb.max.y, bb.max.z - shrink, o.col, o.tag);
      void r;
    }
  }

  // Vertical cylinder standing on y0.
  cyl(role, x, y0, z, r, h, seg = 8, o = {}) {
    _m.makeTranslation(x, y0 + h / 2, z);
    if (o.rotY) _m.multiply(_m2.makeRotationY(o.rotY));
    this.cylM(role, _m, o.rTop ?? r, r, h, seg, o);
  }

  // Cylinder between two points.
  cylBetween(role, a, b, r, seg = 6, o = {}) {
    _v.subVectors(b, a);
    const len = _v.length();
    if (len < 1e-6) return;
    _q.setFromUnitVectors(_up, _v2.copy(_v).divideScalar(len));
    _m.compose(_v.addVectors(a, b).multiplyScalar(0.5), _q, _s.set(1, 1, 1));
    if (o.spin) _m.multiply(_m2.makeRotationY(o.spin));
    this.cylM(role, _m, r, r, len, seg, o);
  }

  cone(role, x, y0, z, r, h, seg = 8, o = {}) {
    _m.makeTranslation(x, y0 + h / 2, z);
    if (o.rotY) _m.multiply(_m2.makeRotationY(o.rotY));
    this.cylM(role, _m, 0, r, h, seg, o);
  }

  // Rectangle outline in the XZ plane at height y. ny: the horizontal face's normal y (+1 a
  // floor/roof seen from above, -1 a ceiling); inward: whether the walls face inward.
  rect(x0, z0, x1, z1, y, arr = this.ink, ny = 1, inward = true) {
    const s = inward ? 1 : -1, f = [0, ny, 0];
    this.segXYZ(x0, y, z0, x1, y, z0, arr, f, [0, 0, s]); this.segXYZ(x1, y, z0, x1, y, z1, arr, f, [-s, 0, 0]);
    this.segXYZ(x1, y, z1, x0, y, z1, arr, f, [0, 0, -s]); this.segXYZ(x0, y, z1, x0, y, z0, arr, f, [s, 0, 0]);
  }

  // Sagging cable between two points (catenary-ish parabola).
  cable(a, b, sag = 0.6, n = 14) {
    let px = a.x, py = a.y, pz = a.z;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      const y = a.y + (b.y - a.y) * t - sag * 4 * t * (1 - t);
      this.segXYZ(px, py, pz, x, y, z, this.fine);
      px = x; py = y; pz = z;
    }
  }

  // Merge everything into scene objects. Returns { meshes, lines }.
  build(materials, scene) {
    const meshes = [];
    for (const g of this.groups.values()) {
      const geo = mergeGeometries(g.list, false);
      for (const part of g.list) part.dispose();
      if (!geo) continue;
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, materials.get(g.role));
      mesh.name = 'static:' + g.role + (g.cast ? '' : ':noshadow');
      mesh.castShadow = g.cast;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      scene.add(mesh);
      meshes.push(mesh);
    }
    const lines = [];
    const mk = (arr, mat, name) => {
      if (!arr.length) return null;
      const geo = lineGeometry(arr);
      const ls = new LineSegments2(geo, mat);
      ls.name = name;
      ls.frustumCulled = false;
      ls.matrixAutoUpdate = false;
      ls.updateMatrix();
      scene.add(ls);
      lines.push(ls);
      return ls;
    };
    mk(this.ink, materials.lines.ink, 'lines:ink');
    mk(this.fine, materials.lines.fine, 'lines:fine');
    mk(this.cloudLines, materials.lines.cloud, 'lines:cloud');
    this.stats = { meshes: meshes.length, inkSegments: this.ink.length / 6, fineSegments: this.fine.length / 6, colliders: this.colliders.length };
    this.groups.clear();
    this.ink = lineList(); this.fine = lineList(); this.cloudLines = lineList();
    return { meshes, lines };
  }
}

// Helper for building small dynamic objects (doors, guns): same primitives, but the result is
// a Group with one merged mesh per role plus one line object, in local coordinates.
export function buildLocalObject(builder, materials, lineMat) {
  const group = new THREE.Group();
  for (const g of builder.groups.values()) {
    const geo = mergeGeometries(g.list, false);
    for (const part of g.list) part.dispose();
    const mesh = new THREE.Mesh(geo, materials.get(g.role));
    mesh.castShadow = g.cast;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  const arr = builder.ink.concat(builder.fine);
  arr.n = builder.ink.n.concat(builder.fine.n);
  if (arr.length) {
    const geo = lineGeometry(arr);
    const ls = new LineSegments2(geo, lineMat || materials.lines.ink);
    ls.frustumCulled = false;
    group.add(ls);
  }
  builder.groups.clear();
  builder.ink = lineList(); builder.fine = lineList();
  return group;
}

// Merge all queued geometry regardless of role into one BufferGeometry (for instanced props,
// e.g. enemy guns which use a single dark material).
export function mergeAll(builder) {
  const all = [];
  for (const g of builder.groups.values()) all.push(...g.list);
  const geo = mergeGeometries(all, false);
  for (const p of all) p.dispose();
  builder.groups.clear();
  builder.ink = lineList(); builder.fine = lineList();
  return geo;
}

function pushN(arr, na, nb) {
  const n = arr.n;
  if (!n) return;
  if (!na) { n.push(0, 0, 0, 0, 0, 0); return; }
  if (!nb) nb = na;
  const ax = na.x ?? na[0], ay = na.y ?? na[1], az = na.z ?? na[2];
  const bx = nb.x ?? nb[0], by = nb.y ?? nb[1], bz = nb.z ?? nb[2];
  n.push(ax, ay, az, bx, by, bz);
}

// Fat-line geometry with per-segment face normals (instanceNormalA/B).
export function lineGeometry(arr) {
  const geo = new LineSegmentsGeometry();
  geo.setPositions(new Float32Array(arr));
  const count = arr.length / 6;
  const na = new Float32Array(count * 3), nb = new Float32Array(count * 3);
  const src = arr.n || [];
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 3; k++) {
      na[i * 3 + k] = src[i * 6 + k] || 0;
      nb[i * 3 + k] = src[i * 6 + 3 + k] || 0;
    }
  }
  geo.setAttribute('instanceNormalA', new THREE.InstancedBufferAttribute(na, 3));
  geo.setAttribute('instanceNormalB', new THREE.InstancedBufferAttribute(nb, 3));
  return geo;
}
