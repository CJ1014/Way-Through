// Persistent user settings + visual style + best score, all in localStorage (guarded:
// file:// origins, private windows and sandboxed iframes can throw on access).
import { safeStorageGet, safeStorageSet } from './util.js';

const SETTINGS_KEY = 'oneshot.settings.v1';
const STYLE_KEY = 'oneshot.style';
const BEST_KEY = 'oneshot.best.v1';

export const DEFAULT_SETTINGS = {
  sensitivity: 1.0,     // multiplier
  invertY: false,
  fov: 78,              // degrees, vertical-ish (three.js uses vertical FOV)
  masterVolume: 0.8,
  sfxVolume: 1.0,
  uiVolume: 0.7,
  difficulty: 'normal', // easy | normal | hard
  screenShake: 1.0,     // 0..1.5
  viewBob: true,
  quality: 'high',      // low | medium | high
  ammoReadout: true,
  fpsCounter: false,
};

function parse(json) {
  try { const v = JSON.parse(json); return v && typeof v === 'object' ? v : {}; } catch (e) { return {}; }
}

export const settings = Object.assign({}, DEFAULT_SETTINGS);
const stored = parse(safeStorageGet(SETTINGS_KEY));
for (const k of Object.keys(DEFAULT_SETTINGS)) {
  if (k in stored && typeof stored[k] === typeof DEFAULT_SETTINGS[k]) settings[k] = stored[k];
}

export function saveSettings() { safeStorageSet(SETTINGS_KEY, JSON.stringify(settings)); }
export function resetSettings() { Object.assign(settings, DEFAULT_SETTINGS); saveSettings(); }

export function loadStyle() {
  const s = safeStorageGet(STYLE_KEY);
  return s === 'neo' ? 'neo' : 'classic';
}
export function saveStyle(style) { safeStorageSet(STYLE_KEY, style); }

export function loadBest() {
  const v = Number(safeStorageGet(BEST_KEY));
  return Number.isFinite(v) ? v : 0;
}
export function saveBest(v) { safeStorageSet(BEST_KEY, String(Math.round(v))); }
