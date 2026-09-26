// Weapon stats. Fire intervals are from the brief (SMG 0.09 s, AK 0.125 s).
export const WEAPONS = {
  smg: {
    id: 'smg', name: 'SMG', auto: true, interval: 0.09, damage: 24, pellets: 1,
    spread: 0.021, adsSpread: 0.009, moveSpread: 0.02, mag: 32, reserve: 96, reload: 1.5,
    recoil: 0.0105, recoilYaw: 0.006, kick: 0.035, sound: 'smg', range: 160, falloff: null,
    enemy: { damage: 9, burst: [4, 7], interval: 0.11, spread: 0.055, range: 38, speed: 34 },
  },
  shotgun: {
    id: 'shotgun', name: 'Shotgun', auto: false, interval: 0.8, damage: 17, pellets: 8,
    spread: 0.062, adsSpread: 0.05, moveSpread: 0.01, mag: 6, reserve: 18, reloadShell: 0.45,
    recoil: 0.05, recoilYaw: 0.01, kick: 0.1, sound: 'shotgun', range: 60, falloff: [9, 32],
    pump: true, pumpDelay: 0.16, pumpTime: 0.42,
    enemy: { damage: 7, pellets: 6, burst: [1, 1], interval: 1.0, spread: 0.07, range: 20, speed: 30 },
  },
  rifle: {
    id: 'rifle', name: 'Rifle', auto: true, interval: 0.125, damage: 42, pellets: 1,
    spread: 0.015, adsSpread: 0.0035, moveSpread: 0.022, mag: 30, reserve: 90, reload: 2.0,
    recoil: 0.0155, recoilYaw: 0.007, kick: 0.05, sound: 'rifle', range: 220, falloff: null,
    enemy: { damage: 13, burst: [3, 4], interval: 0.14, spread: 0.035, range: 55, speed: 38 },
  },
  pistol: {
    id: 'pistol', name: 'Pistol', auto: false, interval: 0.13, damage: 40, pellets: 1,
    spread: 0.012, adsSpread: 0.005, moveSpread: 0.012, mag: 12, reserve: 48, reload: 1.3,
    recoil: 0.022, recoilYaw: 0.006, kick: 0.05, sound: 'pistol', range: 140, falloff: null,
    enemy: { damage: 11, burst: [2, 3], interval: 0.38, spread: 0.04, range: 34, speed: 32 },
  },
};

export const HEADSHOT_MULT = 2.5;
export const ENEMY_HEALTH = 100;

export const SNIPER = { damage: 32, interval: 2.1, spread: 0.012, range: 70, speed: 46 };

export const DIFFICULTY = {
  easy: { dmg: 0.6, acc: 1.5, aware: 0.65, react: 1.4, reserve: 1.5 },
  normal: { dmg: 1.0, acc: 1.0, aware: 1.0, react: 1.0, reserve: 1.0 },
  hard: { dmg: 1.45, acc: 0.72, aware: 1.35, react: 0.7, reserve: 0.75 },
};
