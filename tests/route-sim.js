// Headless route run: the autopilot plays the real simulation from the roof to the North Gate.
import { Game } from '../src/game.js';
import { Autopilot } from '../src/autopilot.js';
import { settings } from '../src/settings.js';

const god = process.argv.includes('--god');
const fight = !process.argv.includes('--nofight');
settings.difficulty = process.argv.includes('--hard') ? 'hard' : 'normal';
const G = new Game({ headless: true });
G.newRun();
G.god = god;
const bot = new Autopilot(G, { fight });
const dt = 1 / 60;
let t = 0, lastArea = '', maxT = 600;
const areaOf = (p) => p.y > 4 ? 'roof' : p.y > 0.3 && p.z > -9 ? 'stair' : p.z > -12 && p.x > 0 ? 'stairRoom' : p.z > -12 ? 'kitchen' : p.z > -28 ? 'canteen' : p.z > -96 ? 'yard' : 'gate';
let minY = 99, maxYOnRoof = 0;
while (t < maxT && G.state === 'playing') {
  const inp = bot.input(dt);
  G.update(dt, inp);
  t += dt;
  const p = G.player.pos;
  const a = areaOf(p);
  if (a !== lastArea) { console.log(`t=${t.toFixed(1)} area ${a} pos ${p.x.toFixed(1)},${p.y.toFixed(2)},${p.z.toFixed(1)} hp ${G.player.health.toFixed(0)} kills ${G.stats.kills}`); lastArea = a; }
  if (p.y > 4) maxYOnRoof = Math.max(maxYOnRoof, p.y);
  minY = Math.min(minY, p.y);
}
console.log('END state', G.state, 't', t.toFixed(1), 'kills', G.stats.kills, 'shots', G.stats.shots, 'hits', G.stats.hits, 'hp', G.player.health.toFixed(0), 'gun', G.gun.type, G.gun.mag, G.gun.reserve);
console.log('bot log', bot.log.slice(0, 30).join(' | '));
console.log('enemy states', G.enemies.list.map((e) => `${e.spawn.id}:${e.alive ? e.state : 'dead'}`).join(' '));
console.log('maxY on roof', maxYOnRoof.toFixed(3), 'minY', minY.toFixed(3));
if (G.result) console.log('result', JSON.stringify(G.result));
process.exit(G.state === 'won' ? 0 : 1);
