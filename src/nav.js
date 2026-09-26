// Waypoint navigation graph with A*. Edges are auto-connected when a body-width corridor is
// clear of movement blockers; edges that pass through a doorway remember the door so AI
// can open it on the way.
import { F_MOVE } from './collision.js';

export class NavGraph {
  constructor() { this.nodes = []; }

  add(x, y, z, tag = '') {
    const n = { id: this.nodes.length, x, y, z, tag, edges: [] };
    this.nodes.push(n);
    return n;
  }

  linked(a, b) { return a.edges.some((e) => e.to === b); }

  link(a, b, door = null) {
    if (a === b || this.linked(a, b)) return;
    const cost = Math.hypot(a.x - b.x, (a.y - b.y) * 2, a.z - b.z);
    a.edges.push({ to: b, cost, door });
    b.edges.push({ to: a, cost, door });
  }

  // Snap node heights to the floor under them.
  snap(world) {
    for (const n of this.nodes) {
      const g = world.groundAt(n.x, n.z, 0.2, n.y + 0.4);
      if (g > -1e9) n.y = g;
    }
  }

  autoConnect(world, doors, maxDist = 11) {
    const N = this.nodes;
    for (let i = 0; i < N.length; i++) {
      for (let j = i + 1; j < N.length; j++) {
        const a = N[i], b = N[j];
        if (Math.abs(a.y - b.y) > 0.3) continue;
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        if (d > maxDist || d < 0.05) continue;
        if (!walkClear(world, a, b)) continue;
        this.link(a, b, doorCrossing(doors, a, b));
      }
    }
  }

  nearest(x, y, z, world, requireClear = true) {
    let best = null, bd = Infinity;
    for (const n of this.nodes) {
      const dy = Math.abs(n.y - y);
      if (dy > 1.2) continue;
      const d = Math.hypot(n.x - x, n.z - z) + dy * 3;
      if (d >= bd) continue;
      if (requireClear && d > 0.6 && !walkClear(world, { x, y, z }, n)) continue;
      bd = d; best = n;
    }
    if (!best && requireClear) return this.nearest(x, y, z, world, false);
    return best;
  }

  // A* from node to node; returns array of nodes (including both ends) or null.
  path(start, goal) {
    if (!start || !goal) return null;
    if (start === goal) return [start];
    const N = this.nodes.length;
    const g = new Float64Array(N).fill(Infinity);
    const f = new Float64Array(N).fill(Infinity);
    const from = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const open = [start.id];
    g[start.id] = 0;
    f[start.id] = h(start, goal);
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
      const cur = open[bi];
      open[bi] = open[open.length - 1]; open.pop();
      if (cur === goal.id) break;
      closed[cur] = 1;
      for (const e of this.nodes[cur].edges) {
        const nid = e.to.id;
        if (closed[nid]) continue;
        const ng = g[cur] + e.cost;
        if (ng < g[nid]) {
          if (g[nid] === Infinity) open.push(nid);
          g[nid] = ng; f[nid] = ng + h(e.to, goal); from[nid] = cur;
        }
      }
    }
    if (from[goal.id] === -1) return null;
    const out = [];
    for (let c = goal.id; c !== -1; c = from[c]) out.push(this.nodes[c]);
    return out.reverse();
  }

  edgeBetween(a, b) { return a.edges.find((e) => e.to === b) || null; }

  // connected component size from a node (for tests)
  reachable(start) {
    const seen = new Set([start.id]);
    const st = [start];
    while (st.length) { const n = st.pop(); for (const e of n.edges) if (!seen.has(e.to.id)) { seen.add(e.to.id); st.push(e.to); } }
    return seen;
  }
}

function h(a, b) { return Math.hypot(a.x - b.x, (a.y - b.y) * 2, a.z - b.z); }

// Is a body-wide corridor between a and b free of movement blockers (ignoring doors)?
export function walkClear(world, a, b, r = 0.3) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-4) return true;
  const ux = dx / len, uz = dz / len;
  const px = -uz * r, pz = ux * r;
  const y = Math.max(a.y, b.y);
  for (const hgt of [0.45, 1.5]) {
    for (const off of [-1, 0, 1]) {
      const ox = a.x + px * off, oz = a.z + pz * off;
      if (world.raycast(ox, y + hgt, oz, ux, 0, uz, len, F_MOVE)) return false;
    }
  }
  // no holes along the way
  const steps = Math.ceil(len / 1.5);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = a.x + dx * t, z = a.z + dz * t, yy = a.y + (b.y - a.y) * t;
    const g = world.groundAt(x, z, 0.1, yy + 0.4);
    if (!(g > yy - 0.4)) return false;
  }
  return true;
}

export function doorCrossing(doors, a, b) {
  for (const d of doors) {
    if (Math.abs(d.y - Math.min(a.y, b.y)) > 1.0) continue;
    const ex = d.hx + d.dx * d.w, ez = d.hz + d.dz * d.w;
    if (segmentsIntersect(a.x, a.z, b.x, b.z, d.hx, d.hz, ex, ez)) return d;
  }
  return null;
}

function segmentsIntersect(ax, az, bx, bz, cx, cz, dx, dz) {
  const d1 = cross(cx, cz, dx, dz, ax, az), d2 = cross(cx, cz, dx, dz, bx, bz);
  const d3 = cross(ax, az, bx, bz, cx, cz), d4 = cross(ax, az, bx, bz, dx, dz);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}
function cross(ax, az, bx, bz, px, pz) { return (bx - ax) * (pz - az) - (bz - az) * (px - ax); }
