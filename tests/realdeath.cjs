const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'] });
  const page = await b.newPage({ viewport: { width: 800, height: 450 } });
  const log = [];
  page.on('pageerror', e => log.push('ERR ' + e.message + '\n' + e.stack));
  page.on('console', m => log.push(m.type() + ' ' + m.text()));
  page.on('crash', () => log.push('PAGE CRASH'));
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html') + '?test=1');
  await page.waitForTimeout(2500);
  await page.click('#menu .nav-btn[data-id="play"]');
  await page.evaluate(() => { __oneshot.setFF(6); __oneshot.teleport(-5, 0, -16, Math.PI, 0); __oneshot.game.player.health = 5; });
  await page.waitForFunction(() => __oneshot.game.state !== 'playing', null, { timeout: 120000 }).catch(() => log.push('never died'));
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(5000);
    const s = await page.evaluate(() => ({ st: __oneshot.game.state, t: +(__oneshot.game.deathT||0).toFixed(1), card: !document.getElementById('deathcard').classList.contains('hidden'), menu: !document.getElementById('menu').classList.contains('hidden'), pause: !document.getElementById('pause').classList.contains('hidden') })).catch(e => ({ err: e.message }));
    console.log(JSON.stringify(s));
    if (s.card || s.err) break;
  }
  console.log(log.join('\n'));
  await b.close();
})();
