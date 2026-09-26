// DOM layer: HUD overlays, main menu, pause menu, death + win cards, settings.
import { settings, saveSettings, resetSettings, loadBest } from './settings.js';
import { WEAPONS } from './weapons.js';
import { ROUTE } from './world.js';
import { F_MOVE } from './collision.js';
import { handwritten } from './hand.js';

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
};

const pct = (v) => Math.round(v * 100) + '%';
// hand-drawn title: SVG strokes + the same words as (visually hidden) text
const handEl = (text, px, cls = '') => h('div', { class: 'hand ' + cls }, handwritten(text, px), h('span', { class: 'sr' }, text));
export const SETTINGS_SCHEMA = [
  { key: 'sensitivity', label: 'Mouse sensitivity', type: 'range', min: 0.2, max: 3, step: 0.05, fmt: (v) => v.toFixed(2) + '×' },
  { key: 'invertY', label: 'Invert Y', type: 'toggle' },
  { key: 'fov', label: 'Field of view', type: 'range', min: 60, max: 100, step: 1, fmt: (v) => v + '°' },
  { key: 'masterVolume', label: 'Master volume', type: 'range', min: 0, max: 1, step: 0.05, fmt: pct },
  { key: 'sfxVolume', label: 'Effects volume', type: 'range', min: 0, max: 1, step: 0.05, fmt: pct },
  { key: 'uiVolume', label: 'Interface volume', type: 'range', min: 0, max: 1, step: 0.05, fmt: pct },
  { key: 'difficulty', label: 'Difficulty', type: 'choice', options: [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']] },
  { key: 'screenShake', label: 'Screen shake', type: 'range', min: 0, max: 1.5, step: 0.05, fmt: pct },
  { key: 'viewBob', label: 'View bob', type: 'toggle' },
  { key: 'quality', label: 'Quality', type: 'choice', options: [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']] },
  { key: 'ammoReadout', label: 'Ammo readout', type: 'toggle' },
  { key: 'fpsCounter', label: 'FPS counter', type: 'toggle' },
];

const CONTROLS = [
  ['W A S D', 'Move'], ['Mouse', 'Look'], ['Left click', 'Fire'], ['Right click (hold)', 'Steady aim'],
  ['Space', 'Jump'], ['Shift', 'Sprint'], ['C / Ctrl', 'Crouch'], ['F', 'Open / close doors, swap guns, take ammo'],
  ['R', 'Reload'], ['V', 'Toggle visual style'], ['Esc', 'Pause'],
];

export class UI {
  constructor(game, hooks) {
    this.G = game;
    this.hooks = hooks; // { play, resume, restart, mainMenu, setStyle, settingsChanged, uiSound }
    this.root = document.getElementById('app');
    this._buildHud();
    this._buildMenus();
    this.fpsAcc = 0; this.fpsN = 0; this.fpsShown = 0;
    this.hitT = 0; this.toastT = 0; this.killT = 0;
    this.previews = { classic: null, neo: null };
    this.applySettingsVisibility();
  }

  // ================================================================== HUD
  _buildHud() {
    const hud = this.hud = h('div', { id: 'hud', class: 'hidden' });
    this.vignette = h('div', { id: 'vignette' });
    this.edges = {};
    for (const s of ['top', 'left', 'right', 'bottom']) this.edges[s] = h('div', { class: 'edge edge-' + s });
    this.crosshair = h('div', { id: 'crosshair' });
    this.killMark = h('div', { id: 'killmark' });
    this.hitLabel = h('div', { id: 'hitlabel' }, h('div', { class: 'rule' }), h('span', {}, 'HIT'));
    this.promptEl = h('div', { id: 'prompt', class: 'pill hidden' }, '');
    this.ammoEl = h('div', { id: 'ammo' }, h('span', { class: 'mag' }, '32'), h('span', { class: 'res' }, ' / 96'), h('div', { class: 'wname' }, 'SMG'));
    this.fpsEl = h('div', { id: 'fps', class: 'hidden' }, '');
    this.toastEl = h('div', { id: 'toast', class: 'pill hidden' }, '');
    this.fade = h('div', { id: 'fade' });
    hud.append(this.vignette, ...Object.values(this.edges), this.crosshair, this.killMark, this.hitLabel, this.promptEl, this.ammoEl, this.toastEl, this.fade);
    this.root.append(hud, this.fpsEl);
    this.clickResume = h('div', { id: 'clickresume', class: 'hidden' },
      h('div', { class: 'card small' }, handEl('Paused', 34), h('p', {}, 'Click anywhere to resume.')));
    this.clickResume.addEventListener('click', () => this.hooks.resume(true));
    this.root.append(this.clickResume);
  }

  showHud(v) { this.hud.classList.toggle('hidden', !v); }

  prompt(text) {
    if (text === this._lastPrompt) return;
    this._lastPrompt = text;
    this.promptEl.textContent = text || '';
    this.promptEl.classList.toggle('hidden', !text);
  }

  ammo(mag, res, name) {
    this.ammoEl.children[0].textContent = mag;
    this.ammoEl.children[1].textContent = ' / ' + res;
    this.ammoEl.children[2].textContent = name;
    this.ammoEl.classList.toggle('low', mag <= Math.ceil((WEAPONS[this.G.gun?.type]?.mag || 30) * 0.2));
  }

  hit(dir) {
    const side = { AHEAD: 'top', LEFT: 'left', RIGHT: 'right', BEHIND: 'bottom' }[dir];
    this.hitLabel.querySelector('span').textContent = 'HIT ' + dir;
    this.hitLabel.classList.remove('show'); void this.hitLabel.offsetWidth; this.hitLabel.classList.add('show');
    const e = this.edges[side];
    e.classList.remove('flash'); void e.offsetWidth; e.classList.add('flash');
  }

  kill(headshot) {
    this.killMark.classList.toggle('head', !!headshot);
    this.killMark.classList.remove('show'); void this.killMark.offsetWidth; this.killMark.classList.add('show');
  }

  toast(msg) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.remove('hidden');
    this.toastT = 1.8;
  }

  styleChanged(style) {
    document.body.dataset.style = style;
    if (this.styleCards) for (const [k, el] of Object.entries(this.styleCards)) el.classList.toggle('selected', k === style);
  }

  // Death: gun drops, camera falls; screen fades light grey -> grey -> charcoal.
  death(t) {
    const stops = [[0, [255, 255, 255], 0], [1.3, [215, 215, 215], 0.0], [2.0, [200, 200, 200], 0.55], [2.7, [128, 128, 128], 0.8], [3.4, [40, 40, 40], 0.97]];
    let a = stops[0], b = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i++) if (t >= stops[i][0] && t <= stops[i + 1][0]) { a = stops[i]; b = stops[i + 1]; break; }
    if (t > stops[stops.length - 1][0]) a = b;
    const k = a === b ? 1 : (t - a[0]) / (b[0] - a[0]);
    const c = a[1].map((v, i) => Math.round(v + (b[1][i] - v) * k));
    const al = a[2] + (b[2] - a[2]) * k;
    this.fade.style.background = `rgb(${c[0]},${c[1]},${c[2]})`;
    this.fade.style.opacity = al.toFixed(3);
    this.crosshair.style.opacity = Math.max(0, 1 - t * 2).toFixed(2);
  }

  hideCards() {
    this.deathCard?.classList.add('hidden');
    this.winCard?.classList.add('hidden');
    this.fade.style.opacity = '0';
    this.crosshair.style.opacity = '1';
    this.clickResume.classList.add('hidden');
    this.overlayHost?.classList.add('hidden');
  }

  showDeathCard() {
    this.deathCard.classList.remove('hidden');
    this.hooks.releaseMouse();
  }

  showWin(r) {
    const fmtT = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}.${String(Math.floor((s % 1) * 10))}`;
    this.winStats.innerHTML = '';
    const rows = [
      ['Time', fmtT(r.time)], ['Kills', `${r.kills} / ${r.total}`], ['Headshots', String(r.headshots)],
      ['Accuracy', Math.round(r.accuracy * 100) + '%'], ['Score', String(r.score)], ['Best score', String(r.best) + (r.newBest ? '  — new best' : '')],
    ];
    for (const [k, v] of rows) this.winStats.append(h('div', { class: 'row' + (k === 'Score' ? ' score' : '') }, h('span', {}, k), h('b', {}, v)));
    this.winCard.classList.remove('hidden');
    this.fade.style.background = 'rgb(255,255,255)';
    this.fade.style.opacity = '0.6';
    this.hooks.releaseMouse();
  }

  frame(dt, renderer) {
    const G = this.G, pl = G.player;
    // screen edges darken as you take damage (no health bar)
    const dmg = pl.alive ? 1 - pl.health / 100 : 1;
    this.vignette.style.opacity = Math.min(1, dmg * 1.15).toFixed(3);
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) this.toastEl.classList.add('hidden'); }
    this.fpsAcc += dt; this.fpsN++;
    if (this.fpsAcc > 0.5) {
      this.fpsShown = this.fpsN / this.fpsAcc;
      const calls = renderer ? renderer.info.render.calls : 0;
      const tris = renderer ? renderer.info.render.triangles : 0;
      this.fpsEl.textContent = `${this.fpsShown.toFixed(0)} FPS · ${calls} draws · ${(tris / 1000).toFixed(0)}k tris`;
      this.lastCalls = calls;
      this.fpsAcc = 0; this.fpsN = 0;
    }
  }

  applySettingsVisibility() {
    this.ammoEl.classList.toggle('hidden', !settings.ammoReadout);
    this.fpsEl.classList.toggle('hidden', !settings.fpsCounter);
  }

  // ================================================================== menus
  _buildMenus() {
    // ---- main menu
    const nav = [
      ['play', 'Play'], ['style', 'Visual Style'], ['controls', 'Controls'],
      ['settings', 'Settings'], ['howto', 'How to Play'], ['credits', 'Credits'],
    ];
    this.mainPanel = h('div', { class: 'panel' });
    this.mainNav = h('nav', { class: 'nav' }, nav.map(([id, label]) => h('button', {
      class: 'nav-btn' + (id === 'play' ? ' primary' : ''), 'data-id': id,
      onmouseenter: () => this.hooks.uiSound('uiHover'),
      onclick: (e) => {
        this.hooks.uiSound('uiClick');
        if (id === 'play') { this.hooks.play(e); return; }
        this.showSection(id, this.mainPanel, this.mainNav);
      },
    }, label)));
    this.menu = h('div', { id: 'menu' },
      h('div', { class: 'menu-col' },
        h('div', { class: 'title' }, handEl('One Shot', 50, 'logo'), h('div', { class: 'sub' }, 'roof · stair · kitchen · canteen · yard · north gate')),
        this.mainNav,
        h('div', { class: 'foot' }, 'Best score: ', h('b', { class: 'best' }, String(loadBest())))),
      this.mainPanel);
    this.root.append(this.menu);
    this.showSection('howto', this.mainPanel, this.mainNav, true);

    // ---- pause menu
    const pnav = [['resume', 'Resume'], ['style', 'Visual Style'], ['settings', 'Settings'], ['controls', 'Controls'], ['mission', 'Mission'], ['restart', 'Restart'], ['main', 'Main menu']];
    this.pausePanel = h('div', { class: 'panel' });
    this.pauseNav = h('nav', { class: 'nav' }, pnav.map(([id, label]) => h('button', {
      class: 'nav-btn' + (id === 'resume' ? ' primary' : ''), 'data-id': id,
      onmouseenter: () => this.hooks.uiSound('uiHover'),
      onclick: (e) => {
        this.hooks.uiSound('uiClick');
        if (id === 'resume') return this.hooks.resume(false, e);
        if (id === 'restart') return this.hooks.restart(e);
        if (id === 'main') return this.hooks.mainMenu();
        this.showSection(id, this.pausePanel, this.pauseNav);
      },
    }, label)));
    this.pause = h('div', { id: 'pause', class: 'hidden' },
      h('div', { class: 'menu-col' }, h('div', { class: 'title' }, handEl('Paused', 36, 'logo small')), this.pauseNav),
      this.pausePanel);
    this.root.append(this.pause);

    // ---- death card
    this.deathCard = h('div', { id: 'deathcard', class: 'cardwrap hidden' },
      h('div', { class: 'card' },
        handEl('No way through.', 46, 'big'),
        h('button', { class: 'btn-double', onclick: (e) => { this.hooks.uiSound('uiClick'); this.hooks.restart(e); } }, 'Try again'),
        h('div', { class: 'links' },
          h('a', { href: '#', onclick: (e) => { e.preventDefault(); this.openOverlay('mission'); } }, 'Mission'),
          h('a', { href: '#', onclick: (e) => { e.preventDefault(); this.openOverlay('controls'); } }, 'Controls'),
          h('a', { href: '#', onclick: (e) => { e.preventDefault(); this.openOverlay('settings'); } }, 'Settings'))));
    this.root.append(this.deathCard);

    // ---- win card
    this.winStats = h('div', { class: 'stats' });
    this.winCard = h('div', { id: 'wincard', class: 'cardwrap hidden' },
      h('div', { class: 'card' },
        handEl('Way through.', 46, 'big'),
        this.winStats,
        h('div', { class: 'row-btns' },
          h('button', { class: 'btn-double', onclick: (e) => { this.hooks.uiSound('uiClick'); this.hooks.restart(e); } }, 'Play again'),
          h('button', { class: 'btn-plain', onclick: () => { this.hooks.uiSound('uiClick'); this.hooks.mainMenu(); } }, 'Main menu'))));
    this.root.append(this.winCard);

    // ---- overlay used by the death card links
    this.overlayPanel = h('div', { class: 'panel' });
    this.overlayHost = h('div', { id: 'overlay', class: 'cardwrap hidden' },
      h('div', { class: 'overlay-inner' }, this.overlayPanel,
        h('button', { class: 'btn-plain back', onclick: () => this.overlayHost.classList.add('hidden') }, 'Back')));
    this.root.append(this.overlayHost);
  }

  openOverlay(id) {
    this.showSection(id, this.overlayPanel, null);
    this.overlayHost.classList.remove('hidden');
  }

  showMain(v) {
    this.menu.classList.toggle('hidden', !v);
    if (v) this.menu.querySelector('.best').textContent = String(loadBest());
  }

  showPause(v) {
    this.pause.classList.toggle('hidden', !v);
    if (v) this.showSection('mission', this.pausePanel, this.pauseNav);
  }

  showSection(id, panel, nav, silent) {
    if (nav) for (const b of nav.children) b.classList.toggle('active', b.dataset.id === id);
    panel.innerHTML = '';
    panel.dataset.section = id;
    const sec = this['_sec_' + id];
    if (sec) panel.append(...[].concat(sec.call(this)));
    void silent;
  }

  _sec_style() {
    this.styleCards = {};
    const card = (id, name, desc) => {
      const img = h('img', { alt: name + ' preview', src: this.previews[id] || '' });
      const el = h('button', {
        class: 'style-card' + (this.G.style === id ? ' selected' : ''),
        onclick: () => { this.hooks.uiSound('uiClick'); this.hooks.setStyle(id); },
      }, h('div', { class: 'img' }, img), h('div', { class: 'name' }, name), h('div', { class: 'desc' }, desc));
      this.styleCards[id] = el;
      this['_img_' + id] = img;
      return el;
    };
    return [
      h('h2', {}, 'Visual Style'),
      h('p', { class: 'muted' }, 'Switch any time with V — even mid-fight. Nothing in the game changes but the colours.'),
      h('div', { class: 'style-grid' },
        card('classic', 'Classic', 'White ink drawing, 1.2 px lines, black stickmen.'),
        card('neo', 'Neobrutalist', 'Saturated roles, 3 px outlines, toon light, hard shadows.')),
    ];
  }

  setPreviews(p) {
    this.previews = p;
    if (this._img_classic) this._img_classic.src = p.classic;
    if (this._img_neo) this._img_neo.src = p.neo;
  }

  _sec_controls() {
    return [h('h2', {}, 'Controls'), h('div', { class: 'keys' }, CONTROLS.map(([k, v]) => h('div', { class: 'krow' }, h('kbd', {}, k), h('span', {}, v))))];
  }

  _sec_settings() {
    const rows = SETTINGS_SCHEMA.map((s) => {
      const val = h('span', { class: 'val' });
      let ctl;
      if (s.type === 'range') {
        ctl = h('input', { type: 'range', min: s.min, max: s.max, step: s.step, value: settings[s.key] });
        val.textContent = s.fmt(settings[s.key]);
        ctl.addEventListener('input', () => { settings[s.key] = Number(ctl.value); val.textContent = s.fmt(settings[s.key]); this._changed(s.key); });
      } else if (s.type === 'toggle') {
        ctl = h('button', { class: 'toggle' + (settings[s.key] ? ' on' : ''), role: 'switch', 'aria-checked': String(settings[s.key]) }, settings[s.key] ? 'On' : 'Off');
        ctl.addEventListener('click', () => {
          settings[s.key] = !settings[s.key];
          ctl.classList.toggle('on', settings[s.key]); ctl.textContent = settings[s.key] ? 'On' : 'Off';
          ctl.setAttribute('aria-checked', String(settings[s.key]));
          this.hooks.uiSound('uiClick'); this._changed(s.key);
        });
      } else {
        ctl = h('div', { class: 'seg' }, s.options.map(([v, l]) => {
          const b = h('button', { class: settings[s.key] === v ? 'on' : '' }, l);
          b.addEventListener('click', () => {
            settings[s.key] = v;
            for (const c of ctl.children) c.classList.toggle('on', c === b);
            this.hooks.uiSound('uiClick'); this._changed(s.key);
          });
          return b;
        }));
      }
      return h('div', { class: 'srow' }, h('label', {}, s.label), h('div', { class: 'sctl' }, ctl, val));
    });
    return [h('h2', {}, 'Settings'), h('div', { class: 'settings' }, rows),
      h('button', { class: 'btn-plain', onclick: () => { resetSettings(); this._changed('*'); this.showSection('settings', this._panelOf('settings'), this._navOf('settings')); } }, 'Reset to defaults')];
  }

  _panelOf() { return [this.mainPanel, this.pausePanel, this.overlayPanel].find((p) => p.dataset.section === 'settings'); }
  _navOf() { const p = this._panelOf(); return p === this.mainPanel ? this.mainNav : p === this.pausePanel ? this.pauseNav : null; }

  _changed(key) {
    saveSettings();
    this.applySettingsVisibility();
    this.hooks.settingsChanged(key);
  }

  _sec_howto() {
    return [h('h2', {}, 'How to Play'),
      h('p', {}, 'You start on a roof. Get down through the stair hut, push through the kitchen and the canteen, cross the fenced yard past the water tower, and walk out through the North Gate.'),
      h('ul', { class: 'bul' },
        h('li', {}, 'Stickmen notice you gradually while they can see you. Crouch and stay out of sight to get close.'),
        h('li', {}, 'They hear gunfire — walls muffle it — and call their friends.'),
        h('li', {}, 'Their bullets are slow, fat teardrops. Watch them and step aside.'),
        h('li', {}, 'Headshots do 2.5× damage.'),
        h('li', {}, 'Dropped guns are pickups: F swaps, or takes the ammo if it’s the gun you hold.'),
        h('li', {}, 'No health bar: the screen edges darken as you get hurt, and you heal when you stay out of fire.'),
        h('li', {}, 'Doors swing away from you and stop bullets. Fences stop you, not bullets.')),
      h('button', { class: 'btn-double', onclick: (e) => this.hooks.play(e) }, 'Play')];
  }

  _sec_credits() {
    return [h('h2', {}, 'Credits'),
      h('p', {}, 'One Shot — a browser recreation of an ink-drawn stickman shooter.'),
      h('p', {}, 'Every model is built from boxes, cylinders and cones when the page loads. Every sound is synthesized with the Web Audio API and pre-rendered into buffers. No external art or audio.'),
      h('p', {}, 'Rendering: three.js r186 (MIT licence), vendored and bundled with esbuild.'),
      h('p', { class: 'muted' }, 'Brief: CJ. Code: Claude.')];
  }

  _sec_mission() {
    const G = this.G;
    const alive = G.enemies.list.filter((e) => e.alive).length;
    const canvas = h('canvas', { class: 'minimap', width: 520, height: 560 });
    this.drawMinimap(canvas);
    return [h('h2', {}, 'Mission'),
      h('p', {}, 'Find a way through: roof, stair, kitchen, canteen, yard — then out of the North Gate beyond the water tower.'),
      h('div', { class: 'mission' }, canvas,
        h('ol', { class: 'route' }, ROUTE.map((r) => h('li', { class: this._area() === r.label ? 'here' : '' }, r.label))),
      ),
      h('p', { class: 'muted' }, `${alive} of ${G.enemies.list.length} stickmen still standing.`)];
  }

  _area() {
    const p = this.G.player.pos;
    if (p.y > 4.2 && p.z > -4.4) return p.x > 2.2 && p.x < 4.8 && p.z < 2.2 ? 'Stair' : 'Roof';
    if (p.y > 4.2) return 'Roof';
    if (p.z > -12 && p.x > 2.4 && p.x < 4.6 && p.z > -8) return 'Stair';
    if (p.z > -12 && p.x > 0) return 'Stair';
    if (p.z > -12) return 'Kitchen';
    if (p.z > -28 && p.x > -24 && p.x < 12) return 'Canteen';
    if (p.z < -95) return 'North Gate';
    return 'Yard';
  }

  drawMinimap(canvas) {
    const G = this.G, g = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const minX = -44, maxX = 38, minZ = -102, maxZ = 12;
    const sc = Math.min(W / (maxX - minX), H / (maxZ - minZ));
    const X = (x) => (x - minX) * sc, Y = (z) => (z - minZ) * sc;
    const neo = G.style === 'neo';
    g.fillStyle = neo ? '#fff6d6' : '#ffffff'; g.fillRect(0, 0, W, H);
    // building footprint + roof
    g.fillStyle = neo ? '#bff6ff' : '#f2f2f2';
    g.fillRect(X(-24), Y(-28), 36 * sc, 36 * sc);
    for (const b of G.world.boxes) {
      if (!(b.flags & F_MOVE)) continue;
      if (b.minY > 3.5 || b.maxY < 0.9) continue;
      const w = (b.maxX - b.minX) * sc, hh = (b.maxZ - b.minZ) * sc;
      if (b.tag === 'fence' || b.tag === 'gateLeaf') { g.fillStyle = neo ? '#9a5cff' : '#9a9a9a'; g.fillRect(X(b.minX), Y(b.minZ), Math.max(1, w), Math.max(1, hh)); continue; }
      if (b.tag === 'glass') { g.fillStyle = neo ? '#2fe0ff' : '#bbbbbb'; g.fillRect(X(b.minX), Y(b.minZ), Math.max(1.5, w), Math.max(1.5, hh)); continue; }
      g.fillStyle = b.tag === 'wall' || b.tag === 'extwall' || b.tag === 'bwall' ? '#111' : (neo ? '#ff7cc6' : '#8a8a8a');
      g.fillRect(X(b.minX), Y(b.minZ), Math.max(1, w), Math.max(1, hh));
    }
    // doors
    g.strokeStyle = neo ? '#ffb000' : '#111'; g.lineWidth = 2;
    for (const d of G.doors) {
      g.beginPath(); g.moveTo(X(d.hx), Y(d.hz));
      g.lineTo(X(d.hx + Math.cos(d.rot) * d.w), Y(d.hz - Math.sin(d.rot) * d.w)); g.stroke();
    }
    // water tower landmark
    g.strokeStyle = '#111'; g.lineWidth = 1.5; g.beginPath(); g.arc(X(0), Y(-76), 3 * sc, 0, Math.PI * 2); g.stroke();
    // route
    g.setLineDash([4, 4]); g.strokeStyle = neo ? '#ff2bd6' : '#111'; g.lineWidth = 1.5; g.beginPath();
    ROUTE.forEach((r, i) => (i ? g.lineTo(X(r.x), Y(r.z)) : g.moveTo(X(r.x), Y(r.z)))); g.stroke(); g.setLineDash([]);
    g.font = 'bold 12px ui-monospace, Menlo, Consolas, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const r of ROUTE) {
      g.fillStyle = neo ? '#ffe14d' : '#fff'; g.strokeStyle = '#111'; g.lineWidth = 2;
      g.beginPath(); g.arc(X(r.x), Y(r.z), 9, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillStyle = '#111'; g.fillText(String(r.n), X(r.x), Y(r.z) + 0.5);
    }
    // enemies still standing (dots) and the player
    for (const e of G.enemies.list) if (!e.alive) { g.fillStyle = neo ? '#c4002e' : '#5c0606'; g.fillRect(X(e.rp[6]) - 2, Y(e.rp[8]) - 2, 4, 4); }
    const p = G.player.pos;
    g.save(); g.translate(X(p.x), Y(p.z)); g.rotate(-G.player.yaw);
    g.fillStyle = neo ? '#ffe600' : '#fff'; g.strokeStyle = '#111'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, -9); g.lineTo(6, 6); g.lineTo(0, 3); g.lineTo(-6, 6); g.closePath(); g.fill(); g.stroke();
    g.restore();
    g.fillStyle = '#111'; g.font = '11px ui-monospace, Menlo, Consolas, monospace'; g.textAlign = 'left';
    g.fillText('N ↑', 8, 12);
  }
}
