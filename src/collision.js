// Static collision world: axis-aligned boxes bucketed into a uniform XZ grid.
// Flags decide what a box stops: movement, bullets/sight, and whether its top is walkable.
export const F_MOVE = 1;    // blocks players/enemies
export const F_BULLET = 2;  // blocks bullets and line of sight
export const F_WALK = 4;    // top surface can be stood on
export const F_SOLID = F_MOVE | F_BULLET | F_WALK;

export class Box {
  constructor(minX, minY, minZ, maxX, maxY, maxZ, flags = F_SOLID, tag = '') {
    this.minX = Math.min(minX, maxX); this.maxX = Math.max(minX, maxX);
    this.minY = Math.min(minY, maxY); this.maxY = Math.max(minY, maxY);
    this.minZ = Math.min(minZ, maxZ); this.maxZ = Math.max(minZ, maxZ);
    this.flags = flags;
    this.tag = tag;
    this.id = -1;
  }
}

export class CollisionWorld {
  constructor(minX, minZ, maxX, maxZ, cell = 4) {
    this.minX = minX; this.minZ = minZ; this.maxX = maxX; this.maxZ = maxZ;
    this.cell = cell;
    this.boxes = [];
    this.cells = null;
    this.stamp = null;
    this.stampId = 0;
    this._out = [];
  }

  add(b) { b.id = this.boxes.length; this.boxes.push(b); return b; }

  finalize() {
    const c = this.cell;
    this.nx = Math.ceil((this.maxX - this.minX) / c);
    this.nz = Math.ceil((this.maxZ - this.minZ) / c);
    this.cells = new Array(this.nx * this.nz);
    for (let i = 0; i < this.cells.length; i++) this.cells[i] = [];
    for (const b of this.boxes) {
      const x0 = this._cx(b.minX), x1 = this._cx(b.maxX), z0 = this._cz(b.minZ), z1 = this._cz(b.maxZ);
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.cells[z * this.nx + x].push(b);
    }
    this.stamp = new Uint32Array(this.boxes.length);
  }

  _cx(x) { return Math.max(0, Math.min(this.nx - 1, Math.floor((x - this.minX) / this.cell))); }
  _cz(z) { return Math.max(0, Math.min(this.nz - 1, Math.floor((z - this.minZ) / this.cell))); }

  // Unique boxes whose XZ footprint overlaps the rectangle. Returned array is reused.
  query(minX, minZ, maxX, maxZ, mask = 0xff) {
    const out = this._out; out.length = 0;
    const id = ++this.stampId;
    const x0 = this._cx(minX), x1 = this._cx(maxX), z0 = this._cz(minZ), z1 = this._cz(maxZ);
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const list = this.cells[z * this.nx + x];
        for (let i = 0; i < list.length; i++) {
          const b = list[i];
          if (this.stamp[b.id] === id) continue;
          this.stamp[b.id] = id;
          if (!(b.flags & mask)) continue;
          if (b.maxX < minX || b.minX > maxX || b.maxZ < minZ || b.minZ > maxZ) continue;
          out.push(b);
        }
      }
    }
    return out;
  }

  // Highest walkable top <= yMax under a circle of radius r at (x,z). -Infinity when none.
  groundAt(x, z, r, yMax) {
    const list = this.query(x - r, z - r, x + r, z + r, F_WALK);
    let best = -Infinity;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.maxY > yMax || b.maxY <= best) continue;
      if (!circleOverlapsRect(x, z, r, b)) continue;
      best = b.maxY;
    }
    return best;
  }

  // Lowest box bottom >= yMin that the circle overlaps (for ceilings). Infinity when none.
  ceilingAt(x, z, r, yMin, yMax) {
    const list = this.query(x - r, z - r, x + r, z + r, F_MOVE);
    let best = Infinity;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.minY < yMin || b.minY > yMax || b.minY >= best) continue;
      if (!circleOverlapsRect(x, z, r, b)) continue;
      best = b.minY;
    }
    return best;
  }

  // Is the point inside any box with the given mask?
  pointBlocked(x, y, z, mask) {
    const list = this.query(x, z, x, z, mask);
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (y >= b.minY && y <= b.maxY && x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ) return b;
    }
    return null;
  }

  // Ray cast through the grid (2D DDA over XZ cells, slab test per box).
  // d must be normalised. Returns hit object (reused) or null.
  raycast(ox, oy, oz, dx, dy, dz, maxT, mask = F_BULLET) {
    const hit = RAY_HIT;
    const id = ++this.stampId;
    const c = this.cell;
    let best = maxT, bestBox = null, bestAxis = -1;
    const gx = (ox - this.minX) / c, gz = (oz - this.minZ) / c;
    let ix = Math.floor(gx), iz = Math.floor(gz);
    const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
    const adx = Math.abs(dx), adz = Math.abs(dz);
    const tDX = adx > 1e-12 ? c / adx : Infinity;
    const tDZ = adz > 1e-12 ? c / adz : Infinity;
    let tMX = adx > 1e-12 ? (dx > 0 ? ix + 1 - gx : gx - ix) * c / adx : Infinity;
    let tMZ = adz > 1e-12 ? (dz > 0 ? iz + 1 - gz : gz - iz) * c / adz : Infinity;
    const invX = 1 / dx, invY = 1 / dy, invZ = 1 / dz;
    let t = 0, guard = 0;
    while (t <= best && guard++ < 4096) {
      if (ix >= 0 && iz >= 0 && ix < this.nx && iz < this.nz) {
        const list = this.cells[iz * this.nx + ix];
        for (let i = 0; i < list.length; i++) {
          const b = list[i];
          if (this.stamp[b.id] === id) continue;
          this.stamp[b.id] = id;
          if (!(b.flags & mask)) continue;
          // slab test
          let t0 = -Infinity, t1 = Infinity, axis = -1, tt0, tt1;
          if (adx > 1e-12) {
            tt0 = (b.minX - ox) * invX; tt1 = (b.maxX - ox) * invX;
            if (tt0 > tt1) { const s = tt0; tt0 = tt1; tt1 = s; }
            if (tt0 > t0) { t0 = tt0; axis = 0; }
            if (tt1 < t1) t1 = tt1;
          } else if (ox < b.minX || ox > b.maxX) continue;
          if (Math.abs(dy) > 1e-12) {
            tt0 = (b.minY - oy) * invY; tt1 = (b.maxY - oy) * invY;
            if (tt0 > tt1) { const s = tt0; tt0 = tt1; tt1 = s; }
            if (tt0 > t0) { t0 = tt0; axis = 1; }
            if (tt1 < t1) t1 = tt1;
          } else if (oy < b.minY || oy > b.maxY) continue;
          if (adz > 1e-12) {
            tt0 = (b.minZ - oz) * invZ; tt1 = (b.maxZ - oz) * invZ;
            if (tt0 > tt1) { const s = tt0; tt0 = tt1; tt1 = s; }
            if (tt0 > t0) { t0 = tt0; axis = 2; }
            if (tt1 < t1) t1 = tt1;
          } else if (oz < b.minZ || oz > b.maxZ) continue;
          if (t0 > t1 || t1 < 0) continue;
          if (t0 < 1e-4) continue; // origin inside/on the box: ignore (shots leaving a surface)
          if (t0 < best) { best = t0; bestBox = b; bestAxis = axis; }
        }
      }
      if (tMX < tMZ) { t = tMX; tMX += tDX; ix += stepX; if ((ix < 0 && stepX < 0) || (ix >= this.nx && stepX > 0)) break; }
      else { t = tMZ; tMZ += tDZ; iz += stepZ; if ((iz < 0 && stepZ < 0) || (iz >= this.nz && stepZ > 0)) break; }
      if (tMX === Infinity && tMZ === Infinity) break;
    }
    if (!bestBox) return null;
    hit.t = best; hit.box = bestBox;
    hit.x = ox + dx * best; hit.y = oy + dy * best; hit.z = oz + dz * best;
    hit.nx = 0; hit.ny = 0; hit.nz = 0;
    if (bestAxis === 0) hit.nx = dx > 0 ? -1 : 1;
    else if (bestAxis === 1) hit.ny = dy > 0 ? -1 : 1;
    else hit.nz = dz > 0 ? -1 : 1;
    return hit;
  }

  // Count bullet-blocking surfaces between two points (used for sound through walls).
  countBetween(ax, ay, az, bx, by, bz, mask = F_BULLET, maxCount = 4) {
    let dx = bx - ax, dy = by - ay, dz = bz - az;
    let len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-6) return 0;
    dx /= len; dy /= len; dz /= len;
    let n = 0, ox = ax, oy = ay, oz = az, rem = len;
    while (n < maxCount) {
      const h = this.raycast(ox, oy, oz, dx, dy, dz, rem, mask);
      if (!h) break;
      n++;
      // skip through the box we hit
      const b = h.box;
      const exit = rayExitBox(h.x, h.y, h.z, dx, dy, dz, b);
      const step = h.t + exit + 0.01;
      ox += dx * step; oy += dy * step; oz += dz * step; rem -= step;
      if (rem <= 0) break;
    }
    return n;
  }
}

const RAY_HIT = { t: 0, box: null, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0 };

function rayExitBox(ox, oy, oz, dx, dy, dz, b) {
  let t1 = Infinity;
  if (Math.abs(dx) > 1e-12) t1 = Math.min(t1, ((dx > 0 ? b.maxX : b.minX) - ox) / dx);
  if (Math.abs(dy) > 1e-12) t1 = Math.min(t1, ((dy > 0 ? b.maxY : b.minY) - oy) / dy);
  if (Math.abs(dz) > 1e-12) t1 = Math.min(t1, ((dz > 0 ? b.maxZ : b.minZ) - oz) / dz);
  return Math.max(0, t1 === Infinity ? 0 : t1);
}

export function circleOverlapsRect(x, z, r, b) {
  const cx = x < b.minX ? b.minX : x > b.maxX ? b.maxX : x;
  const cz = z < b.minZ ? b.minZ : z > b.maxZ ? b.maxZ : z;
  const dx = x - cx, dz = z - cz;
  return dx * dx + dz * dz < r * r;
}

// Push a circle (pos.x, pos.z, r) out of an axis-aligned rectangle. Returns true if moved.
export function pushCircleOutOfRect(pos, r, minX, minZ, maxX, maxZ) {
  const cx = pos.x < minX ? minX : pos.x > maxX ? maxX : pos.x;
  const cz = pos.z < minZ ? minZ : pos.z > maxZ ? maxZ : pos.z;
  let dx = pos.x - cx, dz = pos.z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return false;
  if (d2 > 1e-12) {
    const d = Math.sqrt(d2);
    const k = (r - d) / d;
    pos.x += dx * k; pos.z += dz * k;
  } else {
    // centre inside the rectangle: leave by the nearest side
    const l = pos.x - minX, rr = maxX - pos.x, n = pos.z - minZ, f = maxZ - pos.z;
    const m = Math.min(l, rr, n, f);
    if (m === l) pos.x = minX - r; else if (m === rr) pos.x = maxX + r;
    else if (m === n) pos.z = minZ - r; else pos.z = maxZ + r;
  }
  return true;
}
