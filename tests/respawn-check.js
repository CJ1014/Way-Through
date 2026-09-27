// Checkpoint + respawn logic, headless.
import { Game } from '../src/game.js';
import { CHECKPOINTS } from '../src/world.js';
import { F_MOVE, circleOverlapsRect } from '../src/collision.js';
let fail = 0;
const check = (n, ok, d = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
const G = new Game({ headless: true });
G.newRun();
// every checkpoint pose stands on floor at its height, clear of props, and satisfies its own area test
for (const cp of CHECKPOINTS) {
  const p = cp.pose;
  const g = G.world.groundAt(p.x, p.z, 0.3, p.y + 0.3);
  const blocked = G.world.query(p.x - 0.4, p.z - 0.4, p.x + 0.4, p.z + 0.4, F_MOVE).filter((b) => b.maxY > p.y + 0.31 && b.minY < p.y + 1.8 && circleOverlapsRect(p.x, p.z, 0.36, b));
  check(`checkpoint ${cp.id} pose is on floor and clear`, Math.abs(g - p.y) < 0.05 && blocked.length === 0 && cp.at(p), `ground ${g}, blockers ${blocked.map((b) => b.tag).join(',')}`);
}
check('run starts at the roof checkpoint', G.checkpoint.cp.id === 'roof');
const step = (n = 5) => { for (let i = 0; i < n; i++) G.update(1 / 60, {}); };
const tp = (x, y, z) => { const p = G.player.pos; p.x = x; p.y = y; p.z = z; };
G.god = true;
tp(-3, 0, -9.5); step(); check('entering the kitchen sets the kitchen checkpoint', G.checkpoint.cp.id === 'kitchen');
tp(-5, 0, -16); step(); check('entering the canteen sets the canteen checkpoint', G.checkpoint.cp.id === 'canteen');
tp(3.5, 0, -9); step(); check('walking back does not move the checkpoint backwards', G.checkpoint.cp.id === 'canteen');
tp(-5, 0, -16); step();
const K1 = G.enemies.list.find((e) => e.spawn.id === 'K1');
const C2 = G.enemies.list.find((e) => e.spawn.id === 'C2');
G.enemies._kill(K1, 0, 0, -1, null);
C2.x += 3; C2.state = 'combat'; C2.health = 40;
G.gun.mag = 0; G.gun.reserve = 0;
G.god = false;
G._playerHit(1000, G.player.pos.x + 2, G.player.pos.z);
check('player dies', G.state === 'dead' && G.stats.deaths === 1);
for (let i = 0; i < 120; i++) G.update(1 / 30, {});
G.respawn();
const p = G.player.pos, cp = CHECKPOINTS.find((c) => c.id === 'canteen').pose;
check('respawn: playing again at the canteen checkpoint with full health', G.state === 'playing' && G.player.alive && G.player.health === 100 && Math.hypot(p.x - cp.x, p.z - cp.z) < 0.01, JSON.stringify({ x: p.x, z: p.z, hp: G.player.health }));
check('respawn: killed enemies stay dead', !K1.alive);
check('respawn: survivors reset to their posts at full health', C2.alive && C2.health === 100 && C2.state === 'patrol' && Math.hypot(C2.x - C2.spawn.x, C2.z - C2.spawn.z) < 0.01);
check('respawn: never respawn with an empty gun', G.gun.mag > 0 && G.gun.reserve > 0, `${G.gun.mag}/${G.gun.reserve}`);
check('respawn: enemy bullets cleared', G.bullets.length === 0);
step(30);
check('respawn: simulation keeps running normally', G.state === 'playing' && G.player.alive);
process.exit(fail ? 1 : 0);
