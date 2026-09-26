// Keyboard + mouse + pointer lock.
//  * Pointer lock is requested INSIDE click handlers (browsers require a user gesture).
//  * If a re-lock is refused right after Esc (Chrome enforces a cool-down), the game stays
//    paused and asks for a click.
//  * If pointer lock never works (e.g. a sandboxed iframe), we fall back to plain
//    mouse-move look with the cursor visible.
export class Input {
  constructor(el, handlers = {}) {
    this.el = el;
    this.h = handlers;
    this.keys = new Set();
    this.mouse = { left: false, right: false };
    this.dx = 0; this.dy = 0;
    this.edges = new Set();
    this.locked = false;
    this.everLocked = false;
    this.fallback = !('requestPointerLock' in el);
    this.active = false;      // gameplay wants mouse look
    this.lastMove = null;
    this.lockPending = false;

    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === this.el;
      this.lockPending = false;
      if (this.locked) { this.everLocked = true; this.lockT = performance.now(); this.h.onLock && this.h.onLock(); }
      if (was && !this.locked) this.h.onUnlock && this.h.onUnlock();
    });
    document.addEventListener('pointerlockerror', () => this._lockFailed());

    window.addEventListener('keydown', (e) => {
      if (e.repeat) { if (this._gameKey(e.code)) e.preventDefault(); return; }
      this.keys.add(e.code);
      this.edges.add(e.code);
      if (e.code === 'Escape' && (this.fallback || !this.locked)) this.h.onEscape && this.h.onEscape();
      if (this._gameKey(e.code) && this.active) e.preventDefault();
      this.h.onKey && this.h.onKey(e.code);
    });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse.left = this.mouse.right = false; });

    window.addEventListener('mousemove', (e) => {
      if (!this.active) { this.lastMove = null; return; }
      let mx = e.movementX, my = e.movementY;
      if (mx === undefined) {
        mx = this.lastMove ? e.clientX - this.lastMove.x : 0;
        my = this.lastMove ? e.clientY - this.lastMove.y : 0;
        this.lastMove = { x: e.clientX, y: e.clientY };
      }
      if (!this.locked && !this.fallback) return;
      // some browsers emit a jump in the first events right after the lock engages
      if (this.locked && performance.now() - (this.lockT || 0) < 120) return;
      // ignore the occasional giant spike browsers emit around lock changes
      if (Math.abs(mx) > 400 || Math.abs(my) > 400) return;
      this.dx += mx; this.dy += my;
    });
    el.addEventListener('mousedown', (e) => {
      if (!this.active) return;
      if (e.button === 0) { this.mouse.left = true; this.edges.add('Mouse0'); }
      if (e.button === 2) this.mouse.right = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _gameKey(c) { return ['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ControlLeft', 'KeyC', 'ShiftLeft', 'KeyF', 'KeyR', 'KeyV', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(c); }

  // Call from inside a click handler.
  requestLock() {
    if (this.fallback) return Promise.resolve(false);
    this.lockPending = true;
    try {
      const r = this.el.requestPointerLock();
      if (r && typeof r.then === 'function') {
        return r.then(() => true, (err) => { this._lockFailed(err); return false; });
      }
      return new Promise((res) => setTimeout(() => res(this.locked), 250));
    } catch (err) {
      this._lockFailed(err);
      return Promise.resolve(false);
    }
  }

  _lockFailed() {
    if (!this.lockPending && this.locked) return;
    this.lockPending = false;
    if (!this.everLocked) {
      // never worked: plain mouse-move look from now on
      this.fallback = true;
      this.h.onFallback && this.h.onFallback();
    } else {
      // refused a re-lock (too soon after Esc): ask for another click
      this.h.onRelockRefused && this.h.onRelockRefused();
    }
  }

  exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }

  // Snapshot for one frame.
  frame() {
    const k = this.keys, e = this.edges;
    const inp = {
      f: k.has('KeyW') || k.has('ArrowUp'), b: k.has('KeyS') || k.has('ArrowDown'),
      l: k.has('KeyA') || k.has('ArrowLeft'), r: k.has('KeyD') || k.has('ArrowRight'),
      jump: e.has('Space'), sprint: k.has('ShiftLeft') || k.has('ShiftRight'),
      crouch: k.has('KeyC') || k.has('ControlLeft'),
      ads: this.mouse.right, fire: this.mouse.left, reload: e.has('KeyR'), interact: e.has('KeyF'),
      lookDX: this.dx, lookDY: this.dy,
    };
    this.dx = 0; this.dy = 0;
    e.clear();
    return inp;
  }

  clear() { this.keys.clear(); this.edges.clear(); this.dx = this.dy = 0; this.mouse.left = this.mouse.right = false; }
}
