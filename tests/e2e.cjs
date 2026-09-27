// End-to-end browser test: menus, pointer lock, pause, mid-fight style switch (state must be
// identical), death sequence + card, restart, win card, and the full route by the autopilot.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];
const OUT = path.resolve(__dirname, 'out');
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const only = process.argv.slice(2);
const want = (k) => !only.length || only.includes(k);

(async () => {
  const browser = await chromium.launch({ args: ARGS });
  const VW = process.env.SMALL ? { width: 800, height: 450 } : { width: 1280, height: 720 };
  const page = await browser.newPage({ viewport: VW });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html') + '?test=1');
  await page.waitForTimeout(2500);
  const shot = (n) => page.screenshot({ path: path.join(OUT, n + '.png') });
  const ev = (f, a) => page.evaluate(f, a);

  // ---------------- boot
  const boot = await ev(async () => ({
    state: __oneshot.game.state,
    sounds: await __oneshot.audioReady(),
    previews: !!(__oneshot.ui.previews.classic && __oneshot.ui.previews.neo && __oneshot.ui.previews.classic.length > 5000),
    colliders: __oneshot.game.world.boxes.length,
  }));
  check('boots to main menu from file://', boot.state === 'menu', JSON.stringify(boot));
  check('all sounds pre-rendered into buffers', boot.sounds >= 30, boot.sounds + ' buffers');
  check('style previews rendered from the game', boot.previews);

  if (want('menus')) {
    for (const id of ['style', 'controls', 'settings', 'howto', 'credits']) {
      await page.click(`#menu .nav-btn[data-id="${id}"]`);
      await page.waitForTimeout(250);
      await shot('menu-' + id);
    }
    // style chosen from the menu persists in localStorage
    await page.click('#menu .nav-btn[data-id="style"]');
    await page.click('.style-card:nth-child(2)');
    await page.waitForTimeout(300);
    const stored = await ev(() => localStorage.getItem('oneshot.style'));
    check('Visual Style saves the choice to localStorage', stored === 'neo', 'stored=' + stored);
    await shot('menu-style-neo');
    await page.click('.style-card:nth-child(1)');
    await page.waitForTimeout(200);
  }

  // ---------------- play + pointer lock (requested inside the click handler)
  await page.click('#menu .nav-btn[data-id="play"]');
  await page.waitForTimeout(600);
  let st = await ev(() => ({ state: __oneshot.game.state, locked: __oneshot.input.locked, fallback: __oneshot.input.fallback }));
  check('Play click starts the run with pointer lock (or fallback)', st.state === 'playing' && (st.locked || st.fallback), JSON.stringify(st));

  if (want('pause')) {
    // Esc -> browser drops the lock -> pause menu
    await ev(() => document.exitPointerLock());
    await page.waitForTimeout(400);
    st = await ev(() => ({ state: __oneshot.game.state, pauseVisible: !document.getElementById('pause').classList.contains('hidden') }));
    check('losing pointer lock (Esc) pauses with the pause menu', st.state === 'paused' && st.pauseVisible, JSON.stringify(st));
    await shot('pause-mission');
    for (const id of ['style', 'settings', 'controls']) { await page.click(`#pause .nav-btn[data-id="${id}"]`); await page.waitForTimeout(200); await shot('pause-' + id); }
    await page.click('#pause .nav-btn[data-id="resume"]');
    await page.waitForTimeout(1500);
    st = await ev(() => ({ state: __oneshot.game.state, locked: __oneshot.input.locked, click: !document.getElementById('clickresume').classList.contains('hidden') }));
    check('Resume re-locks, or asks for a click if the browser refuses', st.state === 'playing' || st.click, JSON.stringify(st));
    if (st.click) { await page.mouse.click(640, 360); await page.waitForTimeout(600); st = await ev(() => ({ state: __oneshot.game.state })); check('click-to-resume resumes', st.state === 'playing'); }
  }

  if (want('switch')) {
    // ---------------- mid-fight style switch: state must be identical
    await ev(() => { __oneshot.game.god = true; __oneshot.setStyle('classic'); __oneshot.teleport(-2.75, 0, -13.6, Math.atan2(2.75 - 15.5, -(-18 + 13.6)), 0); });
    // (Playwright's synthetic mouse under pointer lock injects fake movement, so drive the
    // trigger through the input state directly)
    // SwiftShader renders ~3 fps on CPU, so fast-forward the sim to get a few seconds of fight
    await ev(() => { __oneshot.setFF(6); __oneshot.input.mouse.left = true; });
    await page.waitForFunction(() => __oneshot.game.gun.mag <= 8 || __oneshot.game.gun.reloading, null, { timeout: 60000 });
    await ev(() => { __oneshot.input.mouse.left = false; });
    await page.waitForFunction(() => __oneshot.game.enemies.list.some((e) => e.alive && e.state === 'combat') && __oneshot.game.bullets.some((b) => b.alive), null, { timeout: 60000, polling: 50 }).catch(() => {});
    await ev(() => { __oneshot.setFF(1); });
    const before = await ev(() => {
      const G = __oneshot.game;
      G.state = 'paused'; // freeze the simulation for an exact comparison
      return { snap: JSON.stringify(G.snapshot()), mats: Object.values(G.materials.m).map((m) => m.uuid).join(','), lineMats: Object.values(G.materials.lines).map((m) => m.uuid).join(','), children: G.scene.children.length, programs: __oneshot.renderer.info.programs.length, combat: G.enemies.list.filter((e) => e.alive && (e.state === 'combat' || e.state === 'chase')).length, decals: G.fx.decalCount, bullets: G.bullets.filter((b) => b.alive).length, dead: G.enemies.list.filter((e) => !e.alive).length };
    });
    await shot('switch-before-classic');
    await page.keyboard.press('KeyV');
    await page.waitForTimeout(400);
    const after = await ev(() => {
      const G = __oneshot.game;
      return { style: G.style, snap: JSON.stringify(G.snapshot()), mats: Object.values(G.materials.m).map((m) => m.uuid).join(','), lineMats: Object.values(G.materials.lines).map((m) => m.uuid).join(','), children: G.scene.children.length, stored: localStorage.getItem('oneshot.style') };
    });
    await shot('switch-after-neo');
    check('mid-fight: enemies were fighting when the style switched', before.combat > 0 && before.decals > 0, `${before.combat} enemies in combat/chase, ${before.bullets} enemy bullets in flight, ${before.dead} bodies, ${before.decals} decals`);
    check('style switch keeps position/health/ammo/enemies/bodies/decals identical', before.snap === after.snap, before.snap === after.snap ? 'snapshots equal' : 'DIFF');
    check('style switch recolours in place (same material objects, no scene rebuild)', before.mats === after.mats && before.lineMats === after.lineMats && before.children === after.children);
    check('V switched to Neobrutalist and saved it', after.style === 'neo' && after.stored === 'neo');
    fs.writeFileSync(path.join(OUT, 'switch-snapshot.json'), after.snap);
    await page.keyboard.press('KeyV');
    await page.waitForTimeout(300);
    const back = await ev(() => JSON.stringify(__oneshot.game.snapshot()));
    check('switching back also leaves the state untouched', back === before.snap);
    await ev(() => { __oneshot.game.state = 'playing'; });
  }

  if (want('death')) {
    // ---------------- death: gun drops, camera falls and rolls up, light grey -> grey -> charcoal, card
    // die in the canteen after killing someone, so the respawn has something to prove
    await ev(() => {
      const G = __oneshot.game; G.god = true; G.state = 'playing';
      __oneshot.teleport(-5, 0, -16, 0, 0);
      for (let i = 0; i < 5; i++) G.update(1 / 60, {});
      const k = G.enemies.list.find((e) => e.spawn.id === 'C1'); if (k.alive) G.enemies._kill(k, 0, 0, -1, null);
      G.god = false; G._playerHit(1000, G.player.pos.x + 3, G.player.pos.z);
    });
    for (const t of [0.5, 1.7, 2.5, 3.2]) { await page.waitForFunction((t) => __oneshot.game.deathT >= t, t, { timeout: 20000 }); await shot('death-' + t); }
    await page.waitForFunction(() => !document.getElementById('deathcard').classList.contains('hidden'), null, { timeout: 20000 });
    await page.waitForTimeout(300);
    await shot('death-card');
    const d = await ev(() => ({ state: __oneshot.game.state, text: document.querySelector('#deathcard .hand').textContent, btn: document.querySelector('#deathcard .btn-double').textContent, restart: document.querySelector('#deathcard .restart').textContent, at: document.querySelector('#deathcard .respawn-at').textContent, links: [...document.querySelectorAll('#deathcard .links a')].map((a) => a.textContent).join(' ') }));
    check('death card: "No way through." + Respawn + Try again + Mission/Controls/Settings', d.state === 'dead' && d.text === 'No way through.' && d.btn === 'Respawn' && d.restart === 'Try again from the roof' && /Canteen/.test(d.at) && d.links === 'Mission Controls Settings', JSON.stringify(d));
    await page.click('#deathcard .links a:nth-child(1)');
    await page.waitForTimeout(300);
    await shot('death-mission-overlay');
    await page.click('#overlay .back');
    // Respawn at the checkpoint
    await page.click('#deathcard .btn-double');
    await page.waitForTimeout(700);
    const rs = await ev(() => { const G = __oneshot.game; return { state: G.state, hp: G.player.health, x: G.player.pos.x, z: G.player.pos.z, c1: G.enemies.list.find((e) => e.spawn.id === 'C1').alive, deaths: G.stats.deaths, locked: __oneshot.input.locked || __oneshot.input.fallback, card: !document.getElementById('deathcard').classList.contains('hidden') }; });
    check('Respawn: back in the canteen with full health, the kill stays dead, lock re-acquired', rs.state === 'playing' && rs.hp === 100 && Math.abs(rs.x + 5) < 0.3 && Math.abs(rs.z + 13.6) < 0.3 && rs.c1 === false && rs.deaths === 1 && rs.locked && !rs.card, JSON.stringify(rs));
    await shot('respawned');
    // die again and take the full restart instead
    await ev(() => { const G = __oneshot.game; G._playerHit(1000, G.player.pos.x + 3, G.player.pos.z); });
    await page.waitForFunction(() => !document.getElementById('deathcard').classList.contains('hidden'), null, { timeout: 120000 });
    await page.click('#deathcard .restart');
    await page.waitForTimeout(700);
    const r = await ev(() => { const G = __oneshot.game; return { state: G.state, hp: G.player.health, x: G.player.pos.x, z: G.player.pos.z, alive: G.enemies.list.filter((e) => e.alive).length, decals: G.fx.decalCount }; });
    check('Try again restarts a fresh run', r.state === 'playing' && r.hp === 100 && r.alive === 15 && r.decals === 0 && Math.abs(r.x + 16) < 0.5, JSON.stringify(r));
  }

  if (want('win')) {
    // ---------------- win card
    await ev(() => { const G = __oneshot.game; G.god = true; G.enemies.passive = true; __oneshot.teleport(0, 0, -93.5, 0, 0); });
    await page.keyboard.down('KeyW');
    await page.waitForFunction(() => __oneshot.game.state === 'won', null, { timeout: 30000 });
    await page.keyboard.up('KeyW');
    await page.waitForTimeout(500);
    await shot('win-card');
    const w = await ev(() => ({ text: document.querySelector('#wincard .hand').textContent, rows: [...document.querySelectorAll('#wincard .row span')].map((s) => s.textContent) }));
    check('walking through the North Gate wins: "Way through." + stats', w.text === 'Way through.' && ['Time', 'Kills', 'Headshots', 'Deaths', 'Accuracy', 'Score', 'Best score'].every((k) => w.rows.includes(k)), JSON.stringify(w));
    await page.click('#wincard .btn-double');
    await page.waitForTimeout(500);
  }

  if (want('route')) {
    // ---------------- full route by the autopilot (fights on, god mode so a bad bot still finishes)
    await ev(() => { const G = __oneshot.game; __oneshot.start(); G.god = true; __oneshot.setFF(2); __oneshot.setRenderEvery(30); __oneshot.autopilot(true); });
    const areas = [];
    const t0 = Date.now();
    let res = null;
    while (Date.now() - t0 < 900000) {
      await page.waitForTimeout(1500);
      res = await ev(() => { const G = __oneshot.game, p = G.player.pos; return { state: G.state, x: +p.x.toFixed(1), y: +p.y.toFixed(2), z: +p.z.toFixed(1), kills: G.stats.kills, t: +G.stats.time.toFixed(1), calls: __oneshot.calls() }; });
      const area = res.y > 4 ? 'roof' : res.z > -12 && res.x > 0 ? 'stairRoom/stair' : res.z > -12 ? 'kitchen' : res.z > -28 ? 'canteen' : res.z > -96 ? 'yard' : 'gate';
      if (areas[areas.length - 1] !== area) {
        areas.push(area);
        const data = await ev(() => __oneshot.capture());
        fs.writeFileSync(path.join(OUT, `route-${areas.length}-${area.replace('/', '-')}.jpg`), Buffer.from(data.split(',')[1], 'base64'));
      }
      if (res.state !== 'playing') break;
    }
    const bl = await ev(() => { __oneshot.setRenderEvery(1); return __oneshot.bot().log.slice(0, 20).join(' | '); });
    check('autopilot plays the whole route in the browser and wins', res && res.state === 'won', `areas: ${areas.join(' > ')}; ${JSON.stringify(res)}; ${bl}`);
    await page.waitForTimeout(1500);
    await shot('route-end');
  }

  // draw calls in both styles at a busy spot
  const calls = await ev(async () => {
    const G = __oneshot.game; const out = {};
    for (const s of ['classic', 'neo']) { __oneshot.setStyle(s); G.setShot('yard'); G.render(__oneshot.renderer); out[s] = __oneshot.calls(); }
    return out;
  });
  check('draw calls ~100', calls.classic <= 110 && calls.neo <= 140, JSON.stringify(calls));
  check('no page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
  fs.writeFileSync(path.join(OUT, 'e2e-results.json'), JSON.stringify(results, null, 2));
  await browser.close();
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
