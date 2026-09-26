// Small math helpers shared by every module.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);
// Frame-rate independent exponential approach.
export const damp = (a, b, rate, dt) => b + (a - b) * Math.exp(-rate * dt);
export const TAU = Math.PI * 2;

export function wrapAngle(a) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

export function dampAngle(a, b, rate, dt) {
  return a + wrapAngle(b - a) * (1 - Math.exp(-rate * dt));
}

// Deterministic PRNG so the map decoration is identical on every load.
export function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randSign = () => (Math.random() < 0.5 ? -1 : 1);

export function dist2D(ax, az, bx, bz) {
  const dx = ax - bx, dz = az - bz;
  return Math.sqrt(dx * dx + dz * dz);
}

// Closest distance between segment p0->p1 and segment q0->q1 (3D), returns squared distance.
// Used for bullet vs capsule tests.
export function segSegDist2(p0x, p0y, p0z, p1x, p1y, p1z, q0x, q0y, q0z, q1x, q1y, q1z) {
  const ux = p1x - p0x, uy = p1y - p0y, uz = p1z - p0z;
  const vx = q1x - q0x, vy = q1y - q0y, vz = q1z - q0z;
  const wx = p0x - q0x, wy = p0y - q0y, wz = p0z - q0z;
  const a = ux * ux + uy * uy + uz * uz;
  const b = ux * vx + uy * vy + uz * vz;
  const c = vx * vx + vy * vy + vz * vz;
  const d = ux * wx + uy * wy + uz * wz;
  const e = vx * wx + vy * wy + vz * wz;
  const D = a * c - b * b;
  let sN, sD = D, tN, tD = D;
  if (D < 1e-9) { sN = 0; sD = 1; tN = e; tD = c; }
  else {
    sN = b * e - c * d; tN = a * e - b * d;
    if (sN < 0) { sN = 0; tN = e; tD = c; }
    else if (sN > sD) { sN = sD; tN = e + b; tD = c; }
  }
  if (tN < 0) {
    tN = 0;
    if (-d < 0) sN = 0; else if (-d > a) sN = sD; else { sN = -d; sD = a; }
  } else if (tN > tD) {
    tN = tD;
    if (-d + b < 0) sN = 0; else if (-d + b > a) sN = sD; else { sN = -d + b; sD = a; }
  }
  const sc = Math.abs(sN) < 1e-9 ? 0 : sN / sD;
  const tc = Math.abs(tN) < 1e-9 ? 0 : tN / tD;
  const dx = wx + sc * ux - tc * vx, dy = wy + sc * uy - tc * vy, dz = wz + sc * uz - tc * vz;
  segSegDist2.s = sc; segSegDist2.t = tc;
  return dx * dx + dy * dy + dz * dz;
}
segSegDist2.s = 0; segSegDist2.t = 0;

// Ray (origin o, unit dir d) vs sphere; returns t or -1.
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = ox - cx, ly = oy - cy, lz = oz - cz;
  const b = lx * dx + ly * dy + lz * dz;
  const c = lx * lx + ly * ly + lz * lz - r * r;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc);
  let t = -b - s;
  if (t < 0) t = -b + s;
  return t < 0 ? -1 : t;
}

// Ray vs capsule (segment a-b, radius r): returns t or -1. Approximate but robust:
// finds closest approach between the ray segment and the capsule axis.
export function rayCapsule(ox, oy, oz, dx, dy, dz, maxT, ax, ay, az, bx, by, bz, r) {
  const d2 = segSegDist2(ox, oy, oz, ox + dx * maxT, oy + dy * maxT, oz + dz * maxT, ax, ay, az, bx, by, bz);
  if (d2 > r * r) return -1;
  // step back from the closest point to the entry point on the surface
  const tc = segSegDist2.s * maxT;
  const back = Math.sqrt(Math.max(0, r * r - d2));
  return Math.max(0, tc - back);
}

export function safeStorageGet(key) {
  try { return window.localStorage.getItem(key); } catch (e) { return null; }
}
export function safeStorageSet(key, value) {
  try { window.localStorage.setItem(key, value); return true; } catch (e) { return false; }
}
