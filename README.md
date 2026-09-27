# One Shot

A first-person 3D stickman shooter that runs in the browser. Everything you see is drawn as
white, unlit surfaces with thin black ink edges, and there's a second, Neobrutalist look you
can switch to live. You start on a roof and have to get out: down the stair hut, through the
kitchen and the canteen, across a fenced yard past the water tower, and out through the
North Gate.

- **three.js r186 is vendored** in `vendor/three/`. It's bundled with esbuild into one classic
  script, `dist/game.js`, which is committed. `index.html` loads it with a plain `<script>` tag.
- **No external art or audio.** Every model is built from boxes, cylinders and cones when the
  page loads. Every sound is synthesized with the Web Audio API and pre-rendered to buffers.

## Launch

**Offline, no install:** double-click `index.html`. It runs from `file://` with no server
and no network. Tested in Chromium; see *Testing* for what wasn't tested.

**With the tiny server** (no dependencies):

```sh
node server.js          # http://localhost:8080   (or: node server.js 3000)
```

**Rebuild after editing `src/`:**

```sh
npm install             # dev tools only: esbuild (three is already vendored)
npm run build           # -> dist/game.js
npm run watch           # rebuild on save
npm start               # build + serve
```

Open `index.html?test=1` to expose a debug API on `window.__oneshot`, or
`index.html?autopilot=1&god=1` to watch the test bot play the whole route.

## Controls

| Key | Action |
| --- | --- |
| W A S D | Move |
| Mouse | Look (pointer lock) |
| Left click | Fire |
| Right click (hold) | Steady aim |
| Space | Jump |
| Shift | Sprint |
| C / Ctrl | Crouch |
| F | Open / close doors, swap guns, take ammo |
| R | Reload |
| V | Toggle visual style (works mid-fight) |
| Esc | Pause |

## Respawn (added after the brief)

Dying no longer throws you back to the roof. Each area you reach becomes your checkpoint:
roof, stair room, kitchen, canteen, yard, and past the water tower. A "Checkpoint" toast
shows when that happens. The death card tells you where you'll come back.

**Respawn** (the black double-bordered button) puts you back at the last checkpoint:
- with full health;
- holding the gun you had there, with a full magazine and never empty;
- with every enemy you killed still dead;
- with the survivors back at their posts at full health, so you don't reappear in a
  crossfire.

**Try again from the roof** restarts the whole run. Deaths are counted, shown on the win
card, and cost 250 points each.

## Footage: reproduced vs. inferred

**No gameplay footage was attached to this request or the repository, so nothing here was
measured from footage.** I couldn't do the frame-by-frame study, measure fire rates from
gunshot peaks in the audio, or compare areas side by side with the footage. Everything comes
from the written brief. Where the brief was specific, I built exactly what it said. Where it
was silent, I made my own call, and those calls are listed below so you can check them
against the real thing.

### Built as the brief specified

- Classic look: unlit white surfaces, ~1.2 px screen-space fat ink lines on every
  primitive, and fog that fades distant lines.
- Window glass with 3–4 short diagonal hatch strokes.
- Solid black stickmen with a big round head (r = 0.165 m), thick limbs, and one white eye
  with a pupil.
- Dark red blood. Black ink splat decals with droplets, plus flying debris, on bullet hits.
- Map order, north = −Z:
  1. A roof with a 1.05 m parapet you can't jump, AC units, vents, and a stair hut whose door
     opens onto walkable roof.
  2. A straight 20-step stair (0.25 m rise, 0.4 m run) with rails on both sides. It leads
     down into a room with a window on the far wall, two lockers on the right, and a side
     door on the left.
  3. A kitchen with a serving counter and trays, and an enemy behind the counter.
  4. A canteen with 12 tables in rows, chairs, windows, EXIT signs over two exit doors, and
     vending machines.
  5. A fenced yard. The chain-link has diamond lattice lines and stops movement but not
     bullets. It also has gable-roofed barracks, 7-sided cone pines, lamp posts, overhead
     cables, a lattice water tower on a concrete pad, a guard tower with a sniper, and jersey
     barriers and crates.
  6. The North Gate beyond the water tower. Walking through it wins.
- Weapons:
  - A boxy Uzi-style SMG (big rear block, grip with magazine, twin sight posts), full auto,
    one shot every **0.09 s**.
  - A pump shotgun that fires **8 pellets**; its ribbed pump animates after every shot.
  - An AK-style rifle, full auto, one shot every **0.125 s**, with a fork front sight and a
    curved magazine.
  - A semi-auto pistol.
- Enemy bullets are slower, fatter teardrops you can see and dodge, with a whiz on near
  misses.
- 15 enemies. Their states: idle/patrol → awareness builds while they can see you → combat
  (face you, aim, burst fire, strafe) → chase your last known position with waypoint A*,
  opening doors themselves → search. They hear gunfire, which is muffled by walls, and they
  alert nearby allies.
- When hit, an enemy throws both arms up and sprays blood, which splatters the wall behind.
  On death: a verlet ragdoll, a growing blood pool, and the gun drops as a pickup
  ("[F] Swap Rifle", or "[F] Take Ammo" if it's the gun you hold). Headshots do 2.5×.
- Doors swing away from the user and stop bullets. The prompt is a small pill:
  "[F] Open" / "[F] Close".
- No health bar. Health regenerates and the screen edges darken as you take damage. A hit
  shows "HIT AHEAD / LEFT / RIGHT / BEHIND" in small monospace capitals with a rule above,
  and that edge of the screen flashes. There's a tiny dot crosshair and an optional ammo
  readout.
- Death: the gun drops away, the camera falls and rolls toward the sky, and the screen fades
  light grey → grey → charcoal. Then a card: handwritten "No way through.", a black
  double-bordered button, and links for Mission, Controls and Settings. (The button now says
  **Respawn**, and "Try again" moved to the second button. See *Respawn* below.)
- Win card: "Way through." with time, kills, headshots, accuracy, score and best score.
- Two styles, switchable live. Materials are shared per role and recoloured in place. The
  choice is saved in localStorage. In Classic, each role's emissive is set to its own colour.
  Neobrutalist has pink walls, a cyan roof, mint floors, orange tables, blue chairs and violet
  steel, plus 3 px outlines, 2-step toon shading, and hard sun shadows (the roof doesn't cast
  any). It also has a gradient sky with outlined clouds, white-rimmed stickmen with yellow
  eyes, yellow player tracers, magenta enemy tracers, a yellow-orange starburst muzzle flash,
  and a UI with 3 px borders and hard offset shadows.
- A main menu over a slow orbit of the live scene, with 6 sections. Visual Style previews are
  rendered from the game itself. The pause menu has Resume, Visual Style, Settings, Controls,
  Mission (with minimap), Restart and Main menu. V toggles the style.
- Every settings item listed in the brief is there.

### Inferred / my own decisions (not in the brief — check these against the footage)

- **Layout beyond the stated measurements:**
  - Building footprint 36 × 36 m, roof at y = 5, interior ceiling at 4.6 m.
  - Room sizes: stair room 9 × 12 m, kitchen 10 × 12 m, canteen 36 × 16 m.
  - Yard 74 × 68 m, with two inner fence runs.
  - Every prop position, and the route order within each area.
- **Enemy placement and roster:** 2 on the roof, 1 in the stair room, 1 kitchen, 3 canteen,
  8 in the yard (including the sniper). Their weapons, patrol routes and facings are mine too.
- **Numbers:**
  - Magazine sizes: SMG 32, shotgun 6, rifle 30, pistol 12.
  - Damage: SMG 24, pellet 17, rifle 42, pistol 40; enemies have 100 HP.
  - Recoil and spread.
  - Enemy bullet speeds of 30–46 m/s.
  - Awareness rates, hearing radii, wall attenuation (×0.4 per wall), regen (after 3.6 s, at
    24 HP/s).
  - Difficulty scaling and the score formula.
  - Player dimensions: radius 0.32 m, height 1.75 m, jump apex ≈ 0.85 m.
- **Colours** for roles the brief didn't name: doors yellow, lockers teal, tank yellow,
  crates orange, and so on.
- **Visual details:**
  - The exact eye placement.
  - Hand-drawn stick arms on the view-model.
  - Splat shapes, and tracer length and width.
  - How the gun sits in the view.
- **All sound design.** Each sound is a synthesized recipe: gunshots are crack + body + thump
  + tail, plus separate recipes for the pump rack, mag clicks, door creak, whiz and the rest.
  I couldn't listen to any of them. The recipes render without errors, but the sound hasn't
  been judged by ear.
- **Heads are spheres**, the one primitive outside "boxes, cylinders and cones", because the
  brief also asks for a *round* head.
- **The handwriting** is a small single-stroke glyph set I drew (`src/hand.js`), so it looks
  hand-inked on every OS instead of depending on an installed font.
- **Menu and HUD layout, copy and typography.**

## How it's built

```
src/
  main.js        renderer, loop, menu/pause/pointer-lock flow, style previews, test API
  game.js        game state: firing, enemy projectiles, interaction, death/win, camera
  world.js       the whole map (metres, north = -Z), doors, nav points, enemy spawns
  builder.js     boxes/cylinders/cones -> one merged mesh per role + one fat-line batch
  materials.js   role materials + palettes, in-place recolouring, line shader patch
  collision.js   AABB grid, DDA raycasts, ground/ceiling queries
  player.js      first-person body physics
  doors.js       hinged doors (swing away, OBB collision, stop bullets, floor validation)
  nav.js         waypoint graph, auto-connection, A*
  enemies.js     AI, procedural pose + IK, ragdoll, pickups, instanced rendering
  effects.js     decals, blood, particles, tracers, teardrop bullets, flashes (instanced)
  viewmodel.js   the gun in your hands: recoil, pump, reload, steady aim, muzzle flash
  gunmodels.js   SMG / shotgun / AK / pistol from primitives (view-model + enemy guns)
  audio.js       Web Audio recipes rendered offline into buffers
  ui.js, hand.js HUD, menus, cards, settings, minimap, hand-drawn text
  input.js       keyboard, mouse, pointer lock + fallback
  autopilot.js   test bot that plays the route through the real input path
```

### The known pitfalls, and where each is handled

- **No mantling the parapet mid-jump.** Step-ups onto ledges only happen while grounded
  (`player.js`, `_step`). While airborne, every box above the feet blocks, and the jump apex
  (0.85 m) is below the parapet (1.05 m). Everything on the roof is at least 1.0 m tall, so
  nothing works as a stepping stone.
- **Vertical collision only against crossed surfaces.** Landing uses the highest walkable top
  between last frame's feet and this frame's feet. Ceilings use the lowest bottom between
  the old and new head height. Overlapping a tall collider never teleports you on top.
- **Stair snap.** When you were grounded and didn't jump, the body glues to ground up to
  0.36 m below, so walking down the 0.25 m risers doesn't bounce.
- **Doors open onto walkable floor.** `Door.validate()` sweeps both swing directions and
  checks the floor height and clearance. All 7 doors pass (`tests/world-check.js`).
- **Pointer lock:**
  - It's requested inside the click handlers.
  - If the browser refuses a re-lock right after Esc, the game stays paused and shows
    "Paused — click anywhere to resume".
  - If pointer lock never works (e.g. a sandboxed iframe), the game switches to plain
    mouse-move look and tells you so.
  - Mouse deltas are ignored for 120 ms after the lock engages, to drop the spike some
    browsers emit.
- **Performance:**
  - Static geometry is merged per material role: about 30 meshes for the whole map.
  - All ink edges (~21k segments) are one or two instanced fat-line draws.
  - Enemies, tracers, decals, particles, pools, bullets and flashes are all instanced.
  - Measured: **about 50–60 draw calls in Classic and 100–110 in Neobrutalist.** The
    Neobrutalist number includes the shadow pass.
- **Ink edges vs. thin walls.** Each edge segment knows the normals of the faces it borders.
  The line shader drops a segment when both faces point away from the camera, then pulls it
  0.4 % toward the eye so it wins the depth test on its own surface. Without this, roof seams
  bled through the ceiling below, and a polygon-offset approach let internal box faces peek
  through at seams.

## Testing

What I ran, all from this repo. The test scripts are in `tests/`.

- **Map checks in Node** (`tests/world-check.js`): builds the map without WebGL, then checks:
  - all 7 door swings;
  - that no waypoint sits inside a door's swing, so an open door can never block the path;
  - nav connectivity (0 unreachable nodes);
  - that the A* route from the roof spawn reaches the North Gate.
- **Respawn logic in Node** (`tests/respawn-check.js`), 17 checks:
  - every checkpoint pose is on floor and clear of props;
  - checkpoints only ever move forward;
  - respawn restores health and position, keeps kills dead, resets survivors, never hands
    you an empty gun, and clears enemy bullets.
- **Headless route simulation in Node** (`tests/route-sim.js`): the real simulation, no
  rendering, with the bot fighting through the real input path.
  - At normal difficulty with **no god mode**, the bot usually wins (14 kills, 70–100 s of
    game time). Some runs it dies or runs out of ammo.
  - That's evidence the route is completable and that combat works both ways. It says
    nothing about how the game feels to a human.
- **In a real browser** (`tests/e2e.cjs`, `tests/lock.cjs`): Chromium 141 via Playwright,
  headless, loading `index.html` from `file://`. All checks pass on the final build:
  - It boots to the menu, pre-renders all 32 sounds, and renders both style previews from
    the game.
  - The Visual Style choice persists in localStorage.
  - Play acquires pointer lock inside the click. Losing the lock (Esc) pauses, and Resume
    re-locks.
  - **Forced lock failures** (`tests/lock.cjs`):
    - If lock never works, the game runs with plain mouse-move look, and Esc/Resume still
      work.
    - If a re-lock is refused, the game stays paused and asks for a click, and that click
      re-locks.
  - **Mid-fight style switch:** with 10 enemies in combat or chase, enemy bullets in flight
    and 20+ decals, the full game-state snapshot is **byte-identical** before and after V,
    and after switching back. The snapshot covers player position, health, ammo, every
    enemy, ragdoll points, decals, pools, pickups, doors and bullets. The same material
    objects are reused, and the scene isn't rebuilt.
  - Death: the fade, then the "No way through." card with Respawn, Try again and
    Mission/Controls/Settings. The Mission overlay opens.
  - **Respawn** after dying in the canteen brings you back at the canteen checkpoint with
    full health, the enemy you killed still dead, and pointer lock re-acquired.
  - Try again gives a fresh run (15 enemies, 0 decals, back on the roof).
  - Walking through the North Gate shows the "Way through." card with all six stats.
  - **The autopilot plays the whole route in the browser and wins:**
    roof → stair → kitchen → canteen → yard → North Gate, fighting on the way (god mode on,
    so a clumsy bot still finishes).
  - Draw calls: Classic ~50, Neobrutalist ~100.
  - Zero page errors.
- **Visual review:**
  - Every area in both styles (`tests/shots.cjs`).
  - Weapon close-ups (`tests/showcase.cjs`): each gun at the hip, in steady aim, and on the
    firing frame with its muzzle flash, plus the shotgun mid-pump.
  - Hit reaction (arms up), ragdoll collapse, wall splatter, blood pool, the
    "[F] Swap Rifle" / "[F] Take Ammo" prompts, and enemy bullets in flight.
  - Bugs this review caught and fixed:
    - Oversized view-model.
    - Ink lines bleeding through the roof slab.
    - Lit seams from internal box faces.
    - Tracers under 5 m that never expired.
    - Blood spray too sparse.
    - Enemy bullets too small to see head-on.

**Not tested / limits:**

- **Real-GPU frame rate.** The browser runs used SwiftShader (CPU rendering) at a few fps,
  so performance is known only as draw calls and triangle counts. The full-route browser run
  uses test hooks (`setFF`, `setRenderEvery`) that fast-forward the simulation and skip most
  renders, because a CPU-rendered playthrough takes too long. The game code is otherwise
  identical.
- **Firefox and Safari.**
- **Sound quality by ear.**
- **Game balance with a human.**
- **The footage comparison** (see above). There was no footage to compare against.

Re-run the tests:

```sh
npm install
npx esbuild tests/world-check.js --bundle --platform=node --format=esm --outfile=tests/out/world-check.mjs && node tests/out/world-check.mjs
npx esbuild tests/route-sim.js  --bundle --platform=node --format=esm --outfile=tests/out/route-sim.mjs  && node tests/out/route-sim.mjs
npx esbuild tests/respawn-check.js --bundle --platform=node --format=esm --outfile=tests/out/respawn-check.mjs && node tests/out/respawn-check.mjs
node tests/e2e.cjs && node tests/lock.cjs     # needs Playwright + Chromium
```

## Licence notes

three.js is MIT-licensed (`vendor/three/LICENSE`).
