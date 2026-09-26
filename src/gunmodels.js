// Gun geometry from boxes and cylinders. Local space: barrel along -Z, up +Y, origin at the
// firing hand. The same builders feed the player's view-model (with ink edges, split into
// animated parts) and the enemies' instanced guns (merged, one dark material).
import * as THREE from '../vendor/three/three.module.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const NO = { col: 'none' };

function bx(B, role, x0, y0, z0, x1, y1, z1) { B.box(role, x0, y0, z0, x1, y1, z1, NO); }
function cylZ(B, role, x, y, z0, z1, r, seg = 10, o = {}) { B.cylBetween(role, V(x, y, z0), V(x, y, z1), r, seg, Object.assign({ col: 'none', verticals: false }, o)); }
// rotated box around X (for grips/magazines that rake)
function rbx(B, role, cx, cy, cz, sx, sy, sz, rx) {
  const m = new THREE.Matrix4().makeRotationX(rx).setPosition(cx, cy, cz);
  B.boxM(role, m, sx, sy, sz, NO);
}

export const GUN_INFO = {
  smg: {
    muzzle: V(0, 0.062, -0.33), leftHand: V(0, -0.1, -0.03), rearSight: V(0, 0.132, 0.09), frontSight: V(0, 0.132, -0.2),
  },
  shotgun: {
    muzzle: V(0, 0.058, -0.66), leftHand: V(0, 0.0, -0.3), rearSight: V(0, 0.083, 0.06), frontSight: V(0, 0.083, -0.62),
  },
  rifle: {
    muzzle: V(0, 0.046, -0.63), leftHand: V(0, 0.0, -0.25), rearSight: V(0, 0.105, -0.07), frontSight: V(0, 0.105, -0.5),
  },
  pistol: {
    muzzle: V(0, 0.042, -0.14), leftHand: V(-0.02, -0.06, 0.02), rearSight: V(0, 0.07, 0.035), frontSight: V(0, 0.07, -0.12),
  },
};

// Each gun returns { main(B), parts: { name: fn(B) } } with positions in gun-local space.
export const GUN_BUILDERS = {
  // Boxy Uzi-style SMG: big rear block, grip with magazine through it, twin sight posts.
  smg: {
    main(B) {
      bx(B, 'gunBody', -0.034, 0.0, -0.22, 0.034, 0.105, 0.03);     // receiver
      bx(B, 'gunBody', -0.043, -0.012, 0.03, 0.043, 0.118, 0.155);  // big rear block
      bx(B, 'gunBody', -0.02, 0.03, 0.155, 0.02, 0.08, 0.168);      // stock hinge block
      cylZ(B, 'gunDark', 0, 0.062, -0.22, -0.33, 0.013, 10);         // barrel
      cylZ(B, 'gunDark', 0, 0.062, -0.305, -0.33, 0.017, 10);        // barrel nut
      rbx(B, 'gunDark', 0, -0.065, -0.0, 0.044, 0.13, 0.05, 0.1);    // grip
      bx(B, 'gunBody', -0.009, -0.035, -0.075, 0.009, -0.028, -0.02); // trigger guard bottom
      bx(B, 'gunBody', -0.009, -0.035, -0.075, 0.009, 0.0, -0.068);
      bx(B, 'gunDark', -0.004, -0.028, -0.05, 0.004, 0.0, -0.044);   // trigger
      // twin sight posts (rear ears + front ears)
      for (const x of [-0.016, 0.016]) {
        bx(B, 'gunBody', x - 0.005, 0.105, 0.08, x + 0.005, 0.14, 0.1);
        bx(B, 'gunBody', x - 0.005, 0.105, -0.21, x + 0.005, 0.14, -0.19);
      }
      bx(B, 'gunDark', -0.0025, 0.105, -0.203, 0.0025, 0.132, -0.197);
      bx(B, 'gunDark', -0.008, 0.105, -0.05, 0.008, 0.125, -0.02);   // cocking knob
      bx(B, 'gunBody', -0.036, 0.03, -0.16, -0.034, 0.075, -0.06);   // side plate detail
    },
    parts: {
      mag(B) { rbx(B, 'gunDark', 0, -0.17, 0.012, 0.034, 0.11, 0.04, 0.1); bx(B, 'gunBody', -0.02, -0.232, -0.01, 0.02, -0.222, 0.038); },
    },
  },

  // Pump shotgun with a ribbed pump that slides after every shot.
  shotgun: {
    main(B) {
      bx(B, 'gunBody', -0.03, 0.0, -0.11, 0.03, 0.075, 0.12);        // receiver
      cylZ(B, 'gunDark', 0, 0.058, -0.11, -0.66, 0.015, 10);          // barrel
      cylZ(B, 'gunBody', 0, 0.024, -0.11, -0.57, 0.013, 10);          // tube magazine
      cylZ(B, 'gunDark', 0, 0.024, -0.565, -0.58, 0.016, 10);         // mag cap
      bx(B, 'gunDark', -0.012, 0.024, -0.61, 0.012, 0.058, -0.6);     // barrel band
      bx(B, 'gunDark', -0.003, 0.073, -0.625, 0.003, 0.083, -0.615);  // front bead
      bx(B, 'gunDark', -0.006, 0.075, 0.04, 0.006, 0.083, 0.07);      // rear notch
      // stock (two raked boxes) + butt pad
      rbx(B, 'gunBody', 0, 0.02, 0.24, 0.05, 0.075, 0.26, -0.14);
      rbx(B, 'gunBody', 0, -0.025, 0.33, 0.052, 0.1, 0.1, -0.14);
      rbx(B, 'gunDark', 0, -0.02, 0.385, 0.054, 0.12, 0.02, -0.14);
      // grip wrist + trigger guard
      rbx(B, 'gunDark', 0, -0.03, 0.1, 0.04, 0.08, 0.05, 0.4);
      bx(B, 'gunBody', -0.008, -0.04, -0.03, 0.008, -0.033, 0.05);
      bx(B, 'gunDark', -0.003, -0.033, 0.01, 0.003, 0.0, 0.016);
      bx(B, 'gunDark', -0.031, 0.03, -0.06, -0.029, 0.05, 0.02);      // ejection port
    },
    parts: {
      pump(B) {
        bx(B, 'gunDark', -0.025, -0.002, -0.37, 0.025, 0.05, -0.2);
        for (let i = 0; i < 6; i++) {
          const z = -0.35 + i * 0.027;
          B.cylBetween('gunBody', V(0, 0.024, z), V(0, 0.024, z - 0.008), 0.03, 10, { col: 'none', verticals: false });
        }
      },
    },
  },

  // AK-style rifle: fork front sight, curved magazine.
  rifle: {
    main(B) {
      bx(B, 'gunBody', -0.028, 0.0, -0.12, 0.028, 0.072, 0.2);      // receiver
      bx(B, 'gunBody', -0.024, 0.072, -0.1, 0.024, 0.085, 0.19);    // dust cover
      bx(B, 'gunDark', -0.031, 0.005, -0.37, 0.031, 0.066, -0.12);  // handguard
      for (let i = 0; i < 4; i++) bx(B, 'gunBody', -0.032, 0.02, -0.33 + i * 0.05, 0.032, 0.05, -0.31 + i * 0.05);
      cylZ(B, 'gunBody', 0, 0.082, -0.37, -0.12, 0.012, 8);          // gas tube
      cylZ(B, 'gunDark', 0, 0.046, -0.37, -0.6, 0.011, 8);           // barrel
      cylZ(B, 'gunDark', 0, 0.046, -0.58, -0.63, 0.015, 8);          // muzzle brake
      // fork front sight
      bx(B, 'gunBody', -0.014, 0.035, -0.52, 0.014, 0.07, -0.49);
      for (const x of [-0.012, 0.012]) bx(B, 'gunBody', x - 0.003, 0.07, -0.515, x + 0.003, 0.108, -0.495);
      bx(B, 'gunDark', -0.002, 0.07, -0.508, 0.002, 0.1, -0.502);
      // rear sight block
      bx(B, 'gunBody', -0.02, 0.072, -0.1, 0.02, 0.095, -0.05);
      bx(B, 'gunDark', -0.005, 0.095, -0.08, 0.005, 0.105, -0.06);
      // pistol grip + guard
      rbx(B, 'gunDark', 0, -0.055, 0.1, 0.036, 0.11, 0.045, -0.35);
      bx(B, 'gunBody', -0.007, -0.035, 0.0, 0.007, -0.029, 0.08);
      bx(B, 'gunDark', -0.003, -0.029, 0.04, 0.003, 0.0, 0.046);
      // stock
      rbx(B, 'gunBody', 0, 0.02, 0.33, 0.042, 0.07, 0.27, 0.08);
      rbx(B, 'gunDark', 0, 0.005, 0.47, 0.046, 0.11, 0.02, 0.08);
      bx(B, 'gunDark', 0.028, 0.03, -0.02, 0.031, 0.045, 0.1);        // charging handle rail
      bx(B, 'gunBody', 0.028, 0.025, 0.02, 0.05, 0.05, 0.035);        // charging handle
    },
    parts: {
      // curved magazine: chained raked boxes
      mag(B) {
        let y = -0.005, z = -0.055, a = -0.12;
        for (let i = 0; i < 5; i++) {
          const L = 0.045;
          const cy = y - Math.cos(a) * L / 2, cz = z - Math.sin(a) * L / 2;
          rbx(B, 'gunDark', 0, cy, cz, 0.03, L + 0.004, 0.055, a);
          y -= Math.cos(a) * L; z -= Math.sin(a) * L;
          a -= 0.17;
        }
      },
    },
  },

  pistol: {
    main(B) {
      bx(B, 'gunBody', -0.014, 0.0, -0.12, 0.014, 0.024, 0.045);     // frame
      rbx(B, 'gunDark', 0, -0.052, 0.022, 0.03, 0.11, 0.045, -0.22); // grip
      bx(B, 'gunBody', -0.006, -0.028, -0.055, 0.006, -0.022, 0.0);   // guard
      bx(B, 'gunBody', -0.006, -0.028, -0.055, 0.006, 0.0, -0.05);
      bx(B, 'gunDark', -0.003, -0.022, -0.03, 0.003, 0.0, -0.025);
    },
    parts: {
      slide(B) {
        bx(B, 'gunBody', -0.016, 0.022, -0.13, 0.016, 0.058, 0.052);
        for (let i = 0; i < 5; i++) bx(B, 'gunDark', 0.016, 0.028, 0.012 + i * 0.008, 0.0165, 0.052, 0.015 + i * 0.008);
        bx(B, 'gunDark', -0.003, 0.058, -0.125, 0.003, 0.07, -0.115);  // front post
        for (const x of [-0.008, 0.008]) bx(B, 'gunDark', x - 0.003, 0.058, 0.03, x + 0.003, 0.07, 0.04); // rear notch
        cylZ(B, 'gunDark', 0, 0.042, -0.13, -0.14, 0.006, 8);
        bx(B, 'gunDark', 0.0165, 0.03, -0.06, 0.0172, 0.048, -0.02);   // ejection port
      },
      mag(B) { bx(B, 'gunDark', -0.012, -0.12, 0.025, 0.012, -0.105, 0.05); },
    },
  },
};
