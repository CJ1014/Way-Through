// Every surface in the game uses one shared material per ROLE (wall, floor, gun, enemy...).
// Switching visual style recolours these materials in place: nothing is rebuilt, so the
// game state (positions, bodies, decals...) is untouched by a switch.
import * as THREE from '../vendor/three/three.module.js';
import { LineMaterial } from '../vendor/three/addons/lines/LineMaterial.js';

// [Classic, Neobrutalist]
export const PALETTE = {
  wall: ['#ffffff', '#ff7cc6'],
  roof: ['#ffffff', '#2fe0ff'],
  floor: ['#ffffff', '#8cffc9'],
  ground: ['#ffffff', '#b9f27e'],
  path: ['#ffffff', '#fff1a6'],
  table: ['#ffffff', '#ff8a1f'],
  chair: ['#ffffff', '#2f6bff'],
  steel: ['#ffffff', '#9a5cff'],
  door: ['#ffffff', '#ffd83a'],
  machine: ['#ffffff', '#d6caff'],
  locker: ['#ffffff', '#1fd1c1'],
  counter: ['#ffffff', '#ffc93a'],
  tray: ['#ffffff', '#ff5a3a'],
  vending: ['#ffffff', '#ff3d6a'],
  signExit: ['#ffffff', '#23e06a'],
  signGate: ['#ffffff', '#ffe13a'],
  crate: ['#ffffff', '#ffa640'],
  concrete: ['#ffffff', '#e4ddff'],
  foliage: ['#ffffff', '#2fcf68'],
  trunk: ['#ffffff', '#b8743a'],
  tank: ['#ffffff', '#ffe13a'],
  gable: ['#ffffff', '#2fe0ff'],
  bunk: ['#ffffff', '#ffa3dc'],
  lamp: ['#ffffff', '#fff35a'],
  dark: ['#1c1c1c', '#1c1c1c'],
  enemy: ['#0a0a0a', '#0a0a0a'],
  enemyEye: ['#ffffff', '#ffe600'],
  enemyPupil: ['#000000', '#000000'],
  enemyGun: ['#2c2c2c', '#2c2c2c'],
  gunBody: ['#ffffff', '#b58cff'],
  gunDark: ['#262626', '#262626'],
  hands: ['#0a0a0a', '#0a0a0a'],
  cloud: ['#ffffff', '#ffffff'],
};

// Unlit roles (effects). Same in-place recolour rule.
export const FX_PALETTE = {
  blood: ['#5c0606', '#c4002e'],
  ink: ['#0a0a0a', '#0a0a0a'],
  debris: ['#0a0a0a', '#1a1a1a'],
  tracerP: ['#1e1e1e', '#ffe600'],
  tracerE: ['#1e1e1e', '#ff2bd6'],
  bulletE: ['#0a0a0a', '#ff2bd6'],
  flashOuter: ['#0a0a0a', '#ff8a14'],
  flashInner: ['#ffffff', '#ffe600'],
  enemyRim: ['#000000', '#ffffff'],
  glass: ['#ffffff', '#c6f4ff'],
};

// How much of a role's colour is emitted in the Neobrutalist style (the rest comes from the
// sun through the 2-step toon ramp). In Classic every role emits exactly its own colour.
const NEO_EMISSIVE = 0.52;
const NEO_EMISSIVE_OVERRIDE = { lamp: 1.0, enemyEye: 1.0, signExit: 0.8, signGate: 0.8, cloud: 0.9 };
// Roles used only by the view-model scene (drawn without fog).
const NO_FOG_ROLES = new Set(['gunBody', 'gunDark', 'hands', 'cloud']);

export const STYLE_PARAMS = {
  classic: {
    line: 1.2, fine: 0.9, vm: 1.25,
    fog: '#ffffff', fogNear: 22, fogFar: 105,
    bg: '#ffffff', sky: false, glassOpacity: 0,
  },
  neo: {
    line: 3.0, fine: 1.5, vm: 3.0,
    fog: '#ffd6ee', fogNear: 60, fogFar: 200,
    bg: '#5db8ff', sky: true, glassOpacity: 0.28,
    skyTop: '#2f8dff', skyHorizon: '#ffd6ee', skyBottom: '#ffd6ee',
  },
};

function makeToonRamp() {
  // Two texels: back-facing / shadowed = 0, lit = 1 -> hard 2-step toon shading.
  const tex = new THREE.DataTexture(new Uint8Array([0, 255]), 2, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

const RIM_WIDTH_BASE = 0.006;
const RIM_WIDTH_DEPTH = 0.0034; // grows with distance so the rim stays ~2-3 px on screen

export class Materials {
  constructor() {
    this.style = 'classic';
    this.ramp = makeToonRamp();
    this.m = {};
    const tmp = new THREE.Color();
    for (const role of Object.keys(PALETTE)) {
      const mat = new THREE.MeshToonMaterial({
        color: 0x000000,
        emissive: tmp.set(PALETTE[role][0]),
        gradientMap: this.ramp,
      });
      mat.name = role;
      if (NO_FOG_ROLES.has(role)) mat.fog = false;
      this.m[role] = mat;
    }
    for (const role of Object.keys(FX_PALETTE)) {
      const mat = new THREE.MeshBasicMaterial({ color: FX_PALETTE[role][0] });
      mat.name = role;
      this.m[role] = mat;
    }
    // decals sit on surfaces: pull them toward the camera
    for (const r of ['blood', 'ink']) {
      this.m[r].polygonOffset = true;
      this.m[r].polygonOffsetFactor = -2;
      this.m[r].polygonOffsetUnits = -4;
    }
    const glass = this.m.glass;
    glass.transparent = true; glass.opacity = 0; glass.depthWrite = false; glass.side = THREE.DoubleSide;
    glass.visible = false;
    this.m.flashOuter.fog = false; this.m.flashInner.fog = false;
    this.m.flashOuter.side = THREE.DoubleSide; this.m.flashInner.side = THREE.DoubleSide;

    // White rim around enemies (Neobrutalist). Inverted hull pushed out along the normal in
    // view space; the push grows with depth so the rim reads at any distance.
    const rim = this.m.enemyRim;
    rim.side = THREE.BackSide;
    rim.visible = false;
    rim.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        {
          vec3 rn = normal;
          #ifdef USE_INSTANCING
            rn = mat3( instanceMatrix ) * rn;
          #endif
          rn = normalize( normalMatrix * rn );
          mvPosition.xyz += rn * ( ${RIM_WIDTH_BASE.toFixed(4)} + ( -mvPosition.z ) * ${RIM_WIDTH_DEPTH.toFixed(4)} );
          gl_Position = projectionMatrix * mvPosition;
        }`
      );
    };
    rim.customProgramCacheKey = () => 'enemyRim';

    const lineOpts = (w, fog) => ({ color: 0x0a0a0a, linewidth: w, worldUnits: false, fog, alphaToCoverage: false });
    this.lines = {
      ink: new LineMaterial(lineOpts(1.2, true)),   // static + dynamic world edges
      fine: new LineMaterial(lineOpts(0.9, true)),  // chain-link lattice, glass hatching, cables
      vm: new LineMaterial(lineOpts(1.25, false)),  // view-model gun
      cloud: new LineMaterial(lineOpts(3.0, false)),
    };
    for (const k in this.lines) patchLineShader(this.lines[k]);

    this.sky = new THREE.ShaderMaterial({
      uniforms: {
        top: { value: new THREE.Color(STYLE_PARAMS.neo.skyTop) },
        horizon: { value: new THREE.Color(STYLE_PARAMS.neo.skyHorizon) },
        bottom: { value: new THREE.Color(STYLE_PARAMS.neo.skyBottom) },
      },
      vertexShader: `varying vec3 vDir;
        void main() { vDir = normalize( position ); gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; varying vec3 vDir;
        void main() {
          float h = normalize( vDir ).y;
          vec3 c = h > 0.0 ? mix( horizon, top, pow( clamp( h, 0.0, 1.0 ), 0.55 ) ) : bottom;
          gl_FragColor = vec4( c, 1.0 );
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
  }

  get(role) {
    const m = this.m[role];
    if (!m) throw new Error('unknown material role ' + role);
    return m;
  }

  setTexture(role, tex) {
    const m = this.get(role);
    m.map = tex; m.emissiveMap = tex; m.needsUpdate = true;
  }

  setResolution(w, h) {
    for (const k in this.lines) this.lines[k].resolution.set(w, h);
  }

  // Recolour every role in place. `scene` gets fog/background; `extras` toggles style-only decor.
  apply(style, scene) {
    this.style = style === 'neo' ? 'neo' : 'classic';
    const k = this.style === 'neo' ? 1 : 0;
    const p = STYLE_PARAMS[this.style];
    const c = new THREE.Color();
    for (const role of Object.keys(PALETTE)) {
      const mat = this.m[role];
      c.set(PALETTE[role][k]);
      if (k === 0) { mat.color.setRGB(0, 0, 0); mat.emissive.copy(c); }
      else {
        mat.color.copy(c);
        const e = NEO_EMISSIVE_OVERRIDE[role] ?? NEO_EMISSIVE;
        mat.emissive.copy(c).multiplyScalar(e);
      }
    }
    for (const role of Object.keys(FX_PALETTE)) this.m[role].color.set(FX_PALETTE[role][k]);
    this.m.glass.opacity = p.glassOpacity;
    this.m.glass.visible = p.glassOpacity > 0;
    this.m.enemyRim.visible = k === 1;
    this.m.cloud.visible = k === 1;
    this.lines.ink.linewidth = p.line;
    this.lines.fine.linewidth = p.fine;
    this.lines.vm.linewidth = p.vm;
    this.lines.cloud.visible = k === 1;
    if (scene) {
      if (scene.fog) { scene.fog.color.set(p.fog); scene.fog.near = p.fogNear; scene.fog.far = p.fogFar; }
      if (scene.background && scene.background.isColor) scene.background.set(p.bg);
    }
    return p;
  }
}

// Fat-line shader patch:
//  1. hidden-edge culling: each segment knows the normals of the faces it borders; if both
//     face away from the camera it is dropped, so edges behind a thin wall or slab (roof
//     seams seen from the room below) can't bleed through it;
//  2. depth pull: the segment moves 0.4 % toward the eye along its view ray so it wins the
//     depth test against its own surface. (A slope-scaled polygon offset on the surfaces
//     did the same job but let internal box faces peek through at seams.)
function patchLineShader(mat) {
  const vs = mat.vertexShader;
  mat.vertexShader = vs
    .replace('attribute vec3 instanceEnd;', 'attribute vec3 instanceEnd;\n\t\tattribute vec3 instanceNormalA;\n\t\tattribute vec3 instanceNormalB;')
    .replace('vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );', `vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );
			if ( dot( instanceNormalA, instanceNormalA ) > 0.0 ) {
				vec3 mid = ( start.xyz + end.xyz ) * 0.5;
				float eps = -0.002 * length( mid );
				if ( dot( normalMatrix * instanceNormalA, -mid ) < eps && dot( normalMatrix * instanceNormalB, -mid ) < eps ) {
					gl_Position = vec4( 0.0, 0.0, 2.0, 1.0 );
					return;
				}
			}
			// pull the line a hair toward the eye along its own view ray: same place on screen,
			// but it wins the depth test against the surface it lies on
			start.xyz *= 0.996;
			end.xyz *= 0.996;`);
  if (mat.vertexShader === vs) throw new Error('line shader patch failed');
  mat.customProgramCacheKey = () => 'inkline';
}
