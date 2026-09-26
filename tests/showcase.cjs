// Visual proof for the weapons + hit/death pipeline (frames grabbed straight from the canvas).
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const OUT = path.resolve(__dirname, 'out');
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('file://' + path.resolve(__dirname, '..', 'index.html') + '?test=1&god=1');
  await page.waitForTimeout(2500);
  await page.evaluate(() => { __oneshot.start(); __oneshot.setRenderEvery(1000000); });
  await page.waitForTimeout(300);
  const save = (name, data) => fs.writeFileSync(path.join(OUT, name + '.jpg'), Buffer.from(data.split(',')[1], 'base64'));
  const grab = async (name, fn, arg) => save(name, await page.evaluate(fn, arg));

  // ---- gun gallery
  for (const style of ['classic', 'neo']) {
    for (const type of ['smg', 'shotgun', 'rifle', 'pistol']) {
      const setup = ([type, style]) => {
        const G = __oneshot.game; G.enemies.passive = true; __oneshot.setStyle(style);
        __oneshot.teleport(-3, 0, -31, Math.PI, 0.02);
        G.gun.type = type; G.gun.mag = 20; G.gun.pumpT = -1; G.gun.reloading = false;
        G.vm.setGun(type, false); G.vm.resetAnim(); G.vm.raiseT = 1; G.adsT = 0;
        G._updateCamera(0);
      };
      await page.evaluate(setup, [type, style]);
      save(`gun-${type}-hip-${style}`, await page.evaluate(() => __oneshot.capture()));
      if (style === 'classic') {
        // steady aim
        save(`gun-${type}-ads`, await page.evaluate(() => { const G = __oneshot.game; for (let i = 0; i < 30; i++) { G.adsT = 1; G.vm.update(0.03, { ads: true, bobAmt: 0, bobPhase: 0, lookDX: 0, lookDY: 0, landKick: 0, alive: true, reloadP: 0, pumpP: -1 }); } G._updateCamera(0); G.render(__oneshot.renderer); return __oneshot.renderer.domElement.toDataURL('image/jpeg', 0.85); }));
      }
      // firing frame: sound + flash + recoil are triggered in the same call as this render
      await page.evaluate(setup, [type, style]);
      save(`gun-${type}-fire-${style}`, await page.evaluate(() => { const G = __oneshot.game; G._fire(__oneshot.WEAPONS[G.gun.type]); G._updateCamera(0.016); return __oneshot.capture(); }));
      if (type === 'shotgun') {
        save(`gun-shotgun-pump-${style}`, await page.evaluate(() => { const G = __oneshot.game, w = __oneshot.WEAPONS.shotgun; G.gun.pumpT = w.pumpDelay + w.pumpTime * 0.42; G.vm.flash.visible = false; return __oneshot.capture(); }));
      }
    }
  }

  // ---- hit reaction, ragdoll, blood pool, dropped gun prompt
  const r = await page.evaluate(() => {
    const G = __oneshot.game;
    __oneshot.setStyle('classic');
    G.enemies.passive = true;
    const e = G.enemies.list.find((q) => q.spawn.id === 'C1');
    __oneshot.teleport(-10, 0, -22, 0, 0);
    e.x = -10; e.y = 0; e.z = -26.5; e.yaw = 0; e.state = 'idle'; e.pose();
    G.gun.type = 'smg'; G.vm.setGun('smg', false); G.vm.raiseT = 1;
    // aim at the chest
    const p = G.player; const cy = e.j[7] + 0.28;
    p.yaw = Math.atan2(-(e.x - p.pos.x), -(e.z - p.pos.z)); p.pitch = Math.atan2(cy - p.eyeY, Math.hypot(e.x - p.pos.x, e.z - p.pos.z));
    G._updateCamera(0);
    G._fire({ ...__oneshot.WEAPONS.rifle, spread: 0, adsSpread: 0, moveSpread: 0, pellets: 1, damage: 30 });
    for (let i = 0; i < 3; i++) G.update(0.04, {});
    return { hp: e.health, flinch: e.flinch.toFixed(2), state: e.state };
  });
  console.log('after first hit', JSON.stringify(r));
  save('hit-reaction', await page.evaluate(() => __oneshot.capture()));
  const k = await page.evaluate(() => {
    const G = __oneshot.game;
    const e = G.enemies.list.find((q) => q.spawn.id === 'C1');
    G.enemies.passive = true;
    const p = G.player; const cy = e.j[7] + 0.28;
    p.yaw = Math.atan2(-(e.x - p.pos.x), -(e.z - p.pos.z)); p.pitch = Math.atan2(cy - p.eyeY, Math.hypot(e.x - p.pos.x, e.z - p.pos.z));
    G._updateCamera(0);
    for (let n = 0; n < 4 && e.alive; n++) G._fire({ ...__oneshot.WEAPONS.rifle, spread: 0, adsSpread: 0, moveSpread: 0, pellets: 1, damage: 30 });
    G.update(0.03, {});
    return { alive: e.alive };
  });
  console.log('killed', JSON.stringify(k));
  save('ragdoll-0.1s', await page.evaluate(() => __oneshot.capture()));
  save('ragdoll-0.5s', await page.evaluate(() => { const G = __oneshot.game; for (let i = 0; i < 10; i++) G.update(0.04, {}); return __oneshot.capture(); }));
  save('ragdoll-3s', await page.evaluate(() => { const G = __oneshot.game; for (let i = 0; i < 60; i++) G.update(0.04, {}); return __oneshot.capture(); }));
  // walk up to the dropped rifle
  const pr = await page.evaluate(() => {
    const G = __oneshot.game;
    const pk = G.enemies.pickups.find((p) => p.alive && p.type === 'rifle');
    const p = G.player;
    __oneshot.teleport(pk.x, 0, pk.z + 1.3, 0, -0.6);
    G.update(0.03, {});
    return { prompt: document.getElementById('prompt').textContent, visible: !document.getElementById('prompt').classList.contains('hidden'), pool: G.fx.poolList.map((q) => q.r.toFixed(2)) };
  });
  console.log('pickup prompt', JSON.stringify(pr));
  await page.evaluate(() => __oneshot.renderNow());
  await page.screenshot({ path: path.join(OUT, 'pickup-prompt.png') });
  // same gun -> take ammo
  const pr2 = await page.evaluate(() => { const G = __oneshot.game; G.gun.type = 'rifle'; G.vm.setGun('rifle', false); G.update(0.03, {}); return document.getElementById('prompt').textContent; });
  console.log('same-gun prompt', pr2);

  // ---- enemy teardrop bullets + magenta tracers (Neo)
  await page.evaluate(() => {
    const G = __oneshot.game; __oneshot.setStyle('neo'); G.enemies.passive = false; G.gun.type = 'smg'; G.vm.setGun('smg', false);
    const e = G.enemies.list.find((q) => q.spawn.id === 'C3');
    __oneshot.teleport(-2.75, 0, -18, -Math.PI / 2, 0.05);
    e.x = 6; e.z = -18; e.state = 'combat'; e.awareness = 1; e.reactT = 0; e.fireT = 0; e.yaw = Math.PI / 2;
  });
  const b = await page.evaluate(() => {
    const G = __oneshot.game;
    G.bullets.length = 0;
    const near = () => G.bullets.filter((x) => x.alive && Math.hypot(x.x - G.player.pos.x, x.z - G.player.pos.z) < 6).length;
    for (let i = 0; i < 400 && near() < 1; i++) G.update(0.01, {});
    return G.bullets.filter((x) => x.alive).length;
  });
  console.log('enemy bullets in flight', b);
  save('enemy-bullets-neo', await page.evaluate(() => __oneshot.capture()));
  await page.evaluate(() => __oneshot.setStyle('classic'));
  save('enemy-bullets-classic', await page.evaluate(() => __oneshot.capture()));
  await browser.close();
  console.log(errs.join('\n') || 'no page errors');
})();
