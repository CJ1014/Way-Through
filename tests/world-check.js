// Node-side structural checks for the map (no WebGL needed).
import * as THREE from '../vendor/three/three.module.js';
import { Materials } from '../src/materials.js';
import { buildWorld } from '../src/world.js';

const mats = new Materials();
const scene = new THREE.Scene();
const t0 = Date.now();
const W = buildWorld(mats, scene);
console.log('build ms', Date.now() - t0, W.stats);
let fail = 0;
for (const d of W.doors) {
  const p = d.validate(W.world);
  if (p.length) { fail++; console.log('DOOR PROBLEMS', d.name, p.slice(0, 6)); } else console.log('door ok', d.name);
}
const nodes = W.nav.nodes;
console.log('nav nodes', nodes.length, 'edges', nodes.reduce((a, n) => a + n.edges.length, 0) / 2);
const start = W.nav.nearest(W.playerStart.x, W.playerStart.y, W.playerStart.z, W.world);
const gate = W.byTag('gateOut');
const path = W.nav.path(start, gate);
console.log('route path', path ? path.length + ' nodes: ' + path.map((n) => n.tag || `${n.x.toFixed(0)},${n.z.toFixed(0)}`).join(' > ') : 'NONE');
if (!path) fail++;
const reach = W.nav.reachable(start);
const unreached = nodes.filter((n) => !reach.has(n.id));
console.log('unreachable nodes', unreached.length, unreached.map((n) => `${n.tag || ''}(${n.x.toFixed(1)},${n.y.toFixed(2)},${n.z.toFixed(1)})`).join(' '));
for (const s of W.spawns) {
  const n = W.nav.nearest(s.x, s.y, s.z, W.world);
  const g = W.world.groundAt(s.x, s.z, 0.3, s.y + 0.4);
  if (Math.abs(g - s.y) > 0.05) { console.log('SPAWN GROUND MISMATCH', s.id, g, s.y); fail++; }
  if (!n || !reach.has(n.id)) console.log('spawn not on graph', s.id);
}
// every nav node must sit outside the swing of every door (an open panel must never block
// the waypoint in front of it, whichever way the door was opened)
for (const n of nodes) {
  for (const d of W.doors) {
    if (Math.abs(n.y - d.y) > 0.5) continue;
    const dx = n.x - d.hx, dz = n.z - d.hz;
    if (Math.hypot(dx, dz) < d.w + 0.33) { console.log('NODE IN DOOR SWING', n.tag || '', n.x.toFixed(2), n.z.toFixed(2), d.name); fail++; }
  }
}
console.log(fail ? 'FAIL ' + fail : 'ALL OK');
process.exit(fail ? 1 : 0);
