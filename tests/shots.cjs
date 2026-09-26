// Screenshot every area in both styles from the player's eyes (gun in hand).
const { chromium } = require('playwright');
const path = require('path');
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];
const only = process.argv[2] ? process.argv[2].split(',') : null;
(async () => {
  const browser = await chromium.launch({ args: ARGS });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const logs = [];
  page.on('console', (m) => { if (m.type() !== 'log') logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html') + '?test=1&god=1');
  await page.waitForTimeout(2500);
  await page.click('.nav-btn[data-id="play"]');
  await page.waitForTimeout(800);
  const st = await page.evaluate(() => ({ state: __oneshot.game.state, locked: __oneshot.input.locked, fallback: __oneshot.input.fallback }));
  console.log('after Play click', JSON.stringify(st));
  const spots = {
    roof: [-16, 5, 4.5, 3.5, 6.2, 0],
    hut: [3.5, 5, 6.5, 3.5, 6.0, 1],
    stair: [3.5, 5, 1.2, 3.5, 1.0, -10],
    stairRoom: [7.6, 0, -2.5, 1, 1.2, -11.5],
    kitchen: [-1.3, 0, -10.4, -7, 1.0, -4],
    canteen: [10, 0, -13.6, -15, 0.8, -24],
    yard: [-3, 0, -31, 0, 6, -76],
    tower: [8, 0, -60, 0, 9, -76],
    gate: [0, 0, -84, 0, 2.5, -100],
  };
  for (const [name, s] of Object.entries(spots)) {
    if (only && !only.includes(name)) continue;
    for (const style of ['classic', 'neo']) {
      await page.evaluate(([s, style]) => {
        const G = __oneshot.game;
        G.enemies.passive = true;
        __oneshot.setStyle(style);
        const [x, y, z, lx, ly, lz] = s;
        const yaw = Math.atan2(-(lx - x), -(lz - z));
        const pitch = Math.atan2(ly - (y + 1.63), Math.hypot(lx - x, lz - z));
        __oneshot.teleport(x, y, z, yaw, pitch);
      }, [s, style]);
      await page.waitForTimeout(700);
      await page.screenshot({ path: `tests/out/area-${name}-${style}.png` });
    }
  }
  const calls = await page.evaluate(() => __oneshot.calls());
  console.log('draw calls last frame', calls);
  console.log(logs.join('\n'));
  await browser.close();
})();
