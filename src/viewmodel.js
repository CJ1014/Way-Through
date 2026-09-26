// The player's gun, drawn in its own scene/camera after the world (depth cleared), so it never
// clips into walls. Animated parts: SMG/AK/pistol magazine (reload), shotgun ribbed pump
// (after every shot), pistol slide. The muzzle flash lives here too, so it appears on the
// very frame the shot fires (the pre-rendered gunshot buffer starts in that same frame).
import * as THREE from '../vendor/three/three.module.js';
import { Builder, buildLocalObject } from './builder.js';
import { GUN_BUILDERS, GUN_INFO } from './gunmodels.js';
import { clamp, damp, lerp, smooth, TAU } from './util.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const HIP = {
  smg: [0.15, -0.2, -0.5],
  shotgun: [0.135, -0.19, -0.46],
  rifle: [0.135, -0.19, -0.47],
  pistol: [0.125, -0.165, -0.44],
};
// hip pose turns the gun a little so you see its top and left flank, not just the back
const HIP_ROT = [0.035, 0.1, 0.02];
const ADS_DIST = { smg: 0.38, shotgun: 0.32, rifle: 0.26, pistol: 0.44 };
const GRIP = { smg: V(0, -0.062, 0.004), shotgun: V(0, -0.025, 0.1), rifle: V(0, -0.052, 0.097), pistol: V(0, -0.05, 0.02) };

function cone(B, role, a, b, r, seg = 6) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.clone().divideScalar(len));
  const m = new THREE.Matrix4().compose(a.clone().addScaledVector(d, 0.5), q, V(1, 1, 1));
  B.cylM(role, m, 0, r, len, seg, { edges: false, cast: false });
}

export function buildStarburst(B, scale = 1) {
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU;
    const L = (i % 2 ? 0.095 : 0.16) * scale;
    cone(B, 'flashOuter', V(0, 0, 0), V(Math.cos(a) * L, Math.sin(a) * L, 0), 0.022 * scale, 5);
  }
  for (let i = 0; i < 10; i++) {
    const a = ((i + 0.5) / 10) * TAU;
    const L = 0.07 * scale;
    cone(B, 'flashInner', V(0, 0, 0.004 * scale), V(Math.cos(a) * L, Math.sin(a) * L, 0.004 * scale), 0.016 * scale, 5);
  }
  const m = new THREE.Matrix4().makeRotationX(Math.PI / 2).setPosition(0, 0, 0.006 * scale);
  B.cylM('flashInner', m, 0.036 * scale, 0.036 * scale, 0.004 * scale, 12, { edges: false, cast: false });
  cone(B, 'flashOuter', V(0, 0, 0), V(0, 0, -0.17 * scale), 0.03 * scale, 6);
}

export class ViewModel {
  constructor(materials) {
    this.materials = materials;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
    this.scene.add(this.camera);
    // lights only matter in the Neobrutalist style (Classic materials are pure emissive)
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xffffff, 0.35));
    const key = new THREE.DirectionalLight(0xffffff, 1.7);
    key.position.set(0.5, 1, 0.35);
    this.scene.add(key);
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.guns = {};
    for (const type of Object.keys(GUN_BUILDERS)) this.guns[type] = this._buildGun(type);
    const fb = new Builder();
    buildStarburst(fb, 1);
    this.flash = buildLocalObject(fb, materials, materials.lines.vm);
    this.flash.visible = false;
    this.current = null;
    this.t = 0;
    this.resetAnim();
  }

  resetAnim() {
    this.adsT = 0; this.sprintT = 0; this.recoilZ = 0; this.recoilRot = 0; this.recoilRoll = 0;
    this.raiseT = 1; this.reloadT = -1; this.pumpT = -1; this.slideT = -1; this.flashT = 0;
    this.swayX = 0; this.swayY = 0; this.drop = 0; this.shellBump = 0;
  }

  _buildGun(type) {
    const mats = this.materials;
    const g = new THREE.Group();
    g.visible = false;
    const B = new Builder();
    GUN_BUILDERS[type].main(B);
    // right hand + forearm (black stick arm)
    const gp = GRIP[type];
    B.box('hands', gp.x - 0.029, gp.y - 0.045, gp.z - 0.032, gp.x + 0.029, gp.y + 0.035, gp.z + 0.036, { col: 'none' });
    B.cylBetween('hands', gp.clone().add(V(0.01, -0.02, 0.03)), V(0.17, -0.42, 0.34), 0.036, 8, { col: 'none', verticals: false });
    const info = GUN_INFO[type];
    const leftOnPump = type === 'shotgun';
    const addLeft = (b) => {
      const lh = info.leftHand;
      b.box('hands', lh.x - 0.03, lh.y - 0.04, lh.z - 0.04, lh.x + 0.03, lh.y + 0.03, lh.z + 0.04, { col: 'none' });
      b.cylBetween('hands', lh.clone().add(V(-0.01, -0.02, 0.02)), V(-0.26, -0.44, lh.z + 0.38), 0.034, 8, { col: 'none', verticals: false });
    };
    if (!leftOnPump) addLeft(B);
    g.add(buildLocalObject(B, mats, mats.lines.vm));
    const parts = {};
    for (const [name, fn] of Object.entries(GUN_BUILDERS[type].parts)) {
      const pb = new Builder();
      fn(pb);
      if (leftOnPump && name === 'pump') addLeft(pb);
      const holder = new THREE.Group();
      holder.add(buildLocalObject(pb, mats, mats.lines.vm));
      g.add(holder);
      parts[name] = holder;
    }
    const muzzle = new THREE.Object3D();
    muzzle.position.copy(info.muzzle);
    g.add(muzzle);
    g.traverse((o) => { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; });
    this.root.add(g);
    return { group: g, parts, muzzle, info };
  }

  setGun(type, raise = true) {
    if (this.current) this.guns[this.current].group.visible = false;
    this.current = type;
    const g = this.guns[type];
    g.group.visible = true;
    g.muzzle.add(this.flash);
    this.reloadT = -1; this.pumpT = -1; this.slideT = -1;
    for (const p of Object.values(g.parts)) p.position.set(0, 0, 0);
    this.raiseT = raise ? 0 : 1;
  }

  fire(kick, ads) {
    this.recoilZ += kick * (ads ? 0.55 : 1);
    this.recoilRot += kick * (ads ? 0.7 : 1.4);
    this.recoilRoll += (Math.random() - 0.5) * kick * 0.8;
    if (this.current === 'pistol') this.slideT = 0;
    this.flashT = 0.05;
    this.flash.visible = true;
    this.flash.rotation.z = Math.random() * TAU;
    const s = (ads ? 0.7 : 1) * (0.85 + Math.random() * 0.35);
    this.flash.scale.set(s, s, s);
  }

  startPump() { this.pumpT = 0; }
  startReload() { this.reloadT = 0; }
  shellIn() { this.shellBump = 1; }

  // st: { ads, sprint, bobPhase, bobAmt, viewBob, lookDX, lookDY, landKick, alive,
  //       reloading, reloadP, pumpP, crouch }
  update(dt, st) {
    this.t += dt;
    const type = this.current;
    if (!type) return;
    const gun = this.guns[type];
    const hip = HIP[type], rs = gun.info.rearSight;
    const adsPos = [-rs.x, -rs.y, -ADS_DIST[type] - rs.z];
    this.adsT = damp(this.adsT, st.ads ? 1 : 0, 15, dt);
    this.sprintT = damp(this.sprintT, st.sprint ? 1 : 0, 9, dt);
    const a = smooth(clamp(this.adsT, 0, 1)), s = this.sprintT;
    let x = lerp(hip[0], adsPos[0], a), y = lerp(hip[1], adsPos[1], a), z = lerp(hip[2], adsPos[2], a);
    let rx = HIP_ROT[0] * (1 - a), ry = HIP_ROT[1] * (1 - a), rz = HIP_ROT[2] * (1 - a);

    const bobK = (st.viewBob ? 1 : 0.3) * st.bobAmt * (1 - a * 0.85);
    x += Math.sin(st.bobPhase) * 0.012 * bobK;
    y -= Math.abs(Math.cos(st.bobPhase)) * 0.013 * bobK;
    rz += Math.sin(st.bobPhase) * 0.02 * bobK;
    y += Math.sin(this.t * 1.7) * 0.0018 * (1 - a);

    this.swayX = damp(this.swayX, clamp(-st.lookDX * 0.0009, -0.06, 0.06), 9, dt);
    this.swayY = damp(this.swayY, clamp(-st.lookDY * 0.0009, -0.06, 0.06), 9, dt);
    ry += this.swayX * (1 - a * 0.7); rx += this.swayY * (1 - a * 0.7);
    x += this.swayX * 0.12 * (1 - a);

    x += 0.03 * s; y -= 0.06 * s; z += 0.02 * s; ry += 0.6 * s; rx -= 0.28 * s; rz += 0.22 * s;

    this.recoilZ = damp(this.recoilZ, 0, 16, dt);
    this.recoilRot = damp(this.recoilRot, 0, 13, dt);
    this.recoilRoll = damp(this.recoilRoll, 0, 12, dt);
    z += this.recoilZ; rx += this.recoilRot; rz += this.recoilRoll;
    y += this.recoilRot * 0.05;

    // reload: dip and tilt, magazine drops out and comes back
    if (st.reloading) {
      const k = Math.sin(Math.PI * clamp(st.reloadP, 0, 1));
      y -= 0.07 * k; rx -= 0.32 * k; rz += 0.35 * k; x -= 0.02 * k;
      if (gun.parts.mag) {
        const p = st.reloadP;
        let off = 0;
        if (p < 0.35) off = smooth(clamp((p - 0.1) / 0.25, 0, 1));
        else if (p < 0.55) off = 1;
        else off = 1 - smooth(clamp((p - 0.55) / 0.25, 0, 1));
        gun.parts.mag.position.set(0, -0.22 * off, 0.03 * off);
        gun.parts.mag.visible = off < 0.97;
      }
    } else if (gun.parts.mag) { gun.parts.mag.position.set(0, 0, 0); gun.parts.mag.visible = true; }
    this.shellBump = damp(this.shellBump, 0, 12, dt);
    rx -= this.shellBump * 0.06;

    // shotgun pump: back, then forward
    if (gun.parts.pump) {
      let off = 0;
      if (st.pumpP >= 0 && st.pumpP <= 1) {
        const p = st.pumpP;
        off = p < 0.45 ? smooth(p / 0.45) : 1 - smooth((p - 0.45) / 0.55);
        rx += off * 0.05;
      }
      gun.parts.pump.position.set(0, 0, 0.1 * off);
    }
    if (gun.parts.slide) {
      if (this.slideT >= 0) {
        this.slideT += dt;
        const p = this.slideT / 0.09;
        const off = p < 0.3 ? p / 0.3 : Math.max(0, 1 - (p - 0.3) / 0.7);
        gun.parts.slide.position.set(0, 0, 0.035 * off);
        if (p >= 1) this.slideT = -1;
      } else gun.parts.slide.position.set(0, 0, 0);
    }

    // raise after a swap
    if (this.raiseT < 1) this.raiseT = Math.min(1, this.raiseT + dt / 0.35);
    const lower = 1 - smooth(this.raiseT);
    y -= 0.28 * lower; rx -= 0.6 * lower;

    y -= st.landKick * 0.035;
    if (st.crouch) { y += 0.004; rz -= 0.03 * (1 - a); }

    // death: the gun drops away
    if (!st.alive) {
      this.drop += dt;
      const d = this.drop;
      y -= 1.4 * d * d + 0.1 * d; rx -= d * 2.2; rz += d * 1.4; x += d * 0.12;
    }

    this.root.position.set(x, y, z);
    this.root.rotation.set(rx, ry, rz);

    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.flash.visible = false; }
  }

  // Where the muzzle is on screen (NDC), used to start world-space tracers at the gun.
  muzzleNDC(out) {
    const gun = this.guns[this.current];
    this.root.updateMatrixWorld(true);
    gun.muzzle.getWorldPosition(out);
    out.project(this.camera);
    return out;
  }

  setAspect(aspect) { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }
}
