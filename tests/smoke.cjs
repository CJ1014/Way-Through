const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message + '\n' + e.stack));
  const url = 'file://' + path.resolve(__dirname, '..', 'index.html') + '?test=1';
  await page.goto(url);
  await page.waitForTimeout(4000);
  console.log(logs.join('\n') || '(no console output)');
  const info = await page.evaluate(() => window.__oneshot ? { calls: window.__oneshot.calls(), state: window.__oneshot.game.state, style: window.__oneshot.game.style } : null);
  console.log('info', JSON.stringify(info));
  await page.screenshot({ path: 'tests/out/menu.png' });
  await browser.close();
})();
