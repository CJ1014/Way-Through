// Pointer-lock failure paths, forced:
//  1. lock NEVER works (like a sandboxed iframe)  -> plain mouse-move look
//  2. re-lock REFUSED right after Esc            -> stay paused, "click to resume"
const { chromium } = require('playwright');
const path = require('path');
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const url = 'file://' + path.resolve(__dirname, '..', 'index.html') + '?test=1&god=1';
let fails = 0;
const check = (n, ok, d = '') => { if (!ok) fails++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); };
(async () => {
  const browser = await chromium.launch({ args: ARGS });

  // 1. never works
  let page = await browser.newPage({ viewport: { width: 800, height: 450 } });
  await page.addInitScript(() => {
    Element.prototype.requestPointerLock = function () {
      setTimeout(() => document.dispatchEvent(new Event('pointerlockerror')), 0);
      return Promise.reject(new DOMException('Pointer lock blocked (sandbox)', 'SecurityError'));
    };
  });
  await page.goto(url);
  await page.waitForTimeout(2500);
  await page.click('#menu .nav-btn[data-id="play"]');
  await page.waitForTimeout(800);
  let st = await page.evaluate(() => ({ state: __oneshot.game.state, fallback: __oneshot.input.fallback, toast: document.getElementById('toast').textContent, yaw: __oneshot.game.player.yaw }));
  check('lock never works -> game still starts in fallback look mode', st.state === 'playing' && st.fallback, JSON.stringify(st));
  await page.mouse.move(400, 225);
  for (let i = 1; i <= 8; i++) { await page.mouse.move(400 + i * 25, 225); await page.waitForTimeout(60); }
  await page.waitForTimeout(500);
  const yaw2 = await page.evaluate(() => __oneshot.game.player.yaw);
  check('plain mouse-move turns the view without pointer lock', Math.abs(yaw2 - st.yaw) > 0.05, `yaw ${st.yaw.toFixed(3)} -> ${yaw2.toFixed(3)}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  st = await page.evaluate(() => ({ state: __oneshot.game.state }));
  check('Esc pauses in fallback mode', st.state === 'paused');
  await page.click('#pause .nav-btn[data-id="resume"]');
  await page.waitForTimeout(400);
  st = await page.evaluate(() => ({ state: __oneshot.game.state }));
  check('Resume works in fallback mode', st.state === 'playing');
  await page.close();

  // 2. first lock works, the re-lock after Esc is refused once
  page = await browser.newPage({ viewport: { width: 800, height: 450 } });
  await page.addInitScript(() => {
    const orig = Element.prototype.requestPointerLock;
    let n = 0;
    Element.prototype.requestPointerLock = function (...a) {
      n++;
      if (n === 2) {
        setTimeout(() => document.dispatchEvent(new Event('pointerlockerror')), 0);
        return Promise.reject(new DOMException('The user has exited the lock before this request was completed.', 'SecurityError'));
      }
      return orig.apply(this, a);
    };
  });
  await page.goto(url);
  await page.waitForTimeout(2500);
  await page.click('#menu .nav-btn[data-id="play"]');
  await page.waitForTimeout(600);
  st = await page.evaluate(() => ({ state: __oneshot.game.state, locked: __oneshot.input.locked }));
  check('first lock granted', st.state === 'playing' && st.locked, JSON.stringify(st));
  await page.evaluate(() => document.exitPointerLock());
  await page.waitForTimeout(400);
  await page.click('#pause .nav-btn[data-id="resume"]');
  await page.waitForTimeout(600);
  st = await page.evaluate(() => ({ state: __oneshot.game.state, click: !document.getElementById('clickresume').classList.contains('hidden'), fallback: __oneshot.input.fallback }));
  check('refused re-lock -> stays paused and asks for a click', st.state === 'paused' && st.click && !st.fallback, JSON.stringify(st));
  await page.screenshot({ path: path.resolve(__dirname, 'out', 'lock-click-to-resume.png') });
  await page.mouse.click(400, 225);
  await page.waitForTimeout(700);
  st = await page.evaluate(() => ({ state: __oneshot.game.state, locked: __oneshot.input.locked }));
  check('the click re-locks and resumes', st.state === 'playing' && st.locked, JSON.stringify(st));
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
