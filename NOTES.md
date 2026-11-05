# Last Watch: session notes

Newest session first. Put playtest notes for the next session at the very top, under "Playtest notes".

## Playtest notes

(empty: add anything that feels off here between sessions)

---

## Status (end of 2026-11-05)

Sessions 1 to 4 are done except deployment. The mission plays start to finish in a desktop browser: briefing, then the map, then a victory or defeat screen. `npm run build` and `npm test` (82 tests) pass.

**Deployed URL:** not yet. No GitHub repo has been created or pushed; see the steps below.

### What the developer needs to do
1. Create a GitHub repository (suggested: `blairot/last-watch`). It must be **public** for free GitHub Pages; Pages on a private repo needs a paid plan.
2. Push this local repo (branch `main`) to it.
3. In the repository: Settings → Pages → Build and deployment → Source: **GitHub Actions**.
4. The workflow `.github/workflows/deploy.yml` runs the tests, builds, and deploys on every push to `main` (or run it by hand from the Actions tab). The URL will be `https://blairot.github.io/last-watch/`. Record it here.
5. Play it, and put notes under "Playtest notes" above.

## Sessions 2 to 4: Combat, contamination, mission flow (2026-11-05, one long run)

### Done
- **Combat** (`src/logic/combat.ts`, `actions.ts`):
  - Line of sight is a symmetric Bresenham check: bulkheads and shut hatches block it, cover and units don't.
  - Cover faces the shooter: a cover tile next to the target counts if the shooter is on that side. Consoles and fan panels are half cover. Flanked means no cover faces the shooter.
  - Hit chance is Aim −2% per tile beyond 6 (Euclidean distance, rounded), clamped to 10 to 95.
  - Graze model: 40% for half cover, 70% for full. A graze does half damage, minimum 1.
  - Shooting costs 1 AP and ends the turn.
  - Overwatch costs 2 AP and fires at the first hostile that moves in sight. It's checked each step, so a move can be cut short. It clears at the start of the unit's next turn.
  - Player units at 0 HP are downed; enemies die.
- **Enemy AI** (`src/logic/ai.ts`): a utility AI that scores every option (shoot, each reachable tile, overwatch, open a closed hatch, hold) and takes the best, repeating while it has AP. All weights are in the `WEIGHTS` table.
  - Concordat hold cover within 5 tiles of the console, favour tiles near another Concordat, look for flanks, and use overwatch.
  - Unbound close in and shoot. They fall back below half HP or when outnumbered within 4 tiles. Contaminated tiles cost them +2 movement per level, and they strongly avoid ending a turn on one.
  - Enemies can open closed hatches but not welded ones.
- **Contamination** (`src/logic/contamination.ts`):
  - Exposure: 5/15/30 per level, times gear (none ×1, respirator ×0.6, MOPP ×0.2), applied when a side's turn ends. A decon station removes 25.
  - At 50+ exposure: −10 Aim. At 100: infected (permanent): −20 Aim, −1 Move, −1 HP per round.
  - Spread runs from a snapshot at every round end. Tiles at level 2+ raise open neighbours by 1, up to one below the source. Vents at 2+ raise the next vent downstream by 1, up to 3.
- **Hatches**: any unit can open or close an adjacent hatch for 1 AP (H key, or click a shut hatch next to you). Welded hatches can only be unwelded (Weld) or Breached.
- **Abilities** (`src/logic/abilities.ts`): all six from CLAUDE.md. Use hotkeys 1 and 2 or the HUD buttons; valid targets highlight orange.
- **Turn flow** (`turn.ts`):
  1. Player End Turn: player exposure, then the console victory check.
  2. Enemy phase: AI, then enemy exposure.
  3. End of round: infection damage, then spread.
  4. Round 15 ending without victory is a defeat.
- **UI**:
  - Briefing screen, and an end screen with Play Again.
  - Animated moves and shots, floating damage and status text, phase banners.
  - Unit badges: OW (overwatch), INF (infected), STUN (breached).
  - HUD: roster, HP/AP/exposure bars (the exposure bar marks 50), action buttons with cooldowns, an INFO panel, and the log.
  - Shot preview: hit %, graze %, cover, flanked, and damage ranges.
  - Move preview: AP cost, the end-of-turn exposure at the destination, and contaminated tiles crossed (yellow dots on the path).
  - Tile hover: contamination level and the exposure the selected unit would take there.
  - Vents show airflow arrows.
- **Keyboard**: Tab / Shift+Tab cycles units, Esc (or right-click) cancels, Enter ends the turn, O overwatch, H hatch, 1 and 2 for abilities.
- **Map changes for balance**:
  - Crates added at (3,13), (5,16), (7,14), and (8,11).
  - Raiders 3 and 4 start deeper in Aux Machinery.
  - Engine room vents are now (11,2), (17,4) beside the console, (17,10), and (12,10).
  - Both vents next to the sickbay in the duct chain start at moderate.
- **Tests**: 82 Vitest tests across map, turn, combat, contamination, abilities, and AI. The graze test checks 4,000 seeded shots against the previewed hit and graze rates.
- **Balance simulator**: `npm run sim` plays 200 games with a crude squad bot (moves, shoots, overwatches, Stabilize; no other abilities, hatches, or fans) against the real AI.
  - Current result: about 35% bot wins, average win in round 9.8, average loss in round 9.9.
  - A careful human using abilities, hatches, and the flood should win more often and take longer, which matches the 10 to 12 round target. This still needs a real playtest.
- **Debug handle (dev only)**: in `npm run dev`, `window.game` exposes the Phaser game (e.g. `game.scene.getScene('MissionScene').state`). It is not in production builds.
- **GitHub Actions**: `.github/workflows/deploy.yml` (test, build, deploy to Pages). The local branch was renamed `master` → `main` to match.

### Design decisions (change freely)
- "Within 3 tiles of the console" and "adjacent to the console" use Chebyshev distance (diagonals count).
- Exposure applies only where a unit ends its turn, as the spec says. The path preview only flags contaminated tiles crossed.
- Infection is permanent: decon lowers exposure but doesn't cure it. Exposure caps at 100.
- Reverse Fan has no cooldown. Coordinated Assault can't target a unit whose turn has ended.
- Breach's "far side" means enemies beyond the hatch, as seen from the breacher, within 2 tiles (Chebyshev).
- The AI is deterministic; the only randomness is the seeded dice.

### Known issues and ideas
- Flooding the engine room works, but in the simulator it only adds a couple of % win rate, because most fighting happens in the Passageway. If playtests agree, options are faster vent flow, a higher Concordat contamination weight (`WEIGHTS.concordat.contamination`), or keeping the Concordat closer to the console.
- Raiders reach the squad in round 1 and often get flank shots in the Boarding room. That's intended ("aggressive"), but worth a playtest.
- The enemy turn plays its animations one after another (a few seconds). There's no fast-forward yet.
- The bundle is about 1.4 MB, almost all Phaser, so Vite's chunk-size warning limit is raised to 2000 kB.
- Hot reload restarts the mission (state lives in the scene).
- Unit art is placeholder shapes: circles = squad, red squares = Concordat, purple triangles = Unbound.
- The workflow pins actions/checkout@v4, setup-node@v4, configure-pages@v5, upload-pages-artifact@v3, and deploy-pages@v4. Bump them if GitHub flags them as deprecated.

### Suggested next steps
1. Deploy (steps above) and playtest. Tune with `npm run sim` and the `WEIGHTS` table.
2. A fast-forward or skip for the enemy phase, and a tooltip on the map itself.
3. Save and replay using the seeded RNG state.
4. Real art: Kenney sprite packs (a download, so ask first) or custom.

---

## Session 1: Foundation (2026-11-05)

### Done
- Scaffolded Vite 8.3.6 + TypeScript 5.9 (strict) + Phaser 4.2.1 + Vitest 4.1.12 (patched with `npm audit fix` after setup; `npm audit` is clean). `npm run dev` binds to 127.0.0.1:5173. Vite `base: './'` so the build works from a GitHub Pages subpath.
- Phaser 4 ships agent skill files in `node_modules/phaser/skills/` (for example `v3-to-v4-migration`, `graphics-and-shapes`, `input-keyboard-mouse-touch`, `scenes`, `tweens`). Read these before writing Phaser code.
- Logic with no Phaser imports: types, seeded RNG (mulberry32), A* pathfinding, AP-based movement, and the round structure.
- `src/data/mission01.ts`: the 20x20 "Engine Room" map as an ASCII layout with a legend. Six compartments (Sickbay, Mess, Boarding, Passageway, Engine room, Aux machinery), hatches, a vent network, decon in the Mess, the console at (16,6), the fan panel at (17,17), and 6 entry tiles.

### Design decisions (change freely)
- Movement is 4-directional (no diagonals). Contamination adjacency is 4-directional to match.
- Units cannot pass through other units, including allies. Downed units still occupy their tile.
- Cover tiles, consoles, and the fan panel are impassable.
- Vent tiles are walkable floor grates. `ventDirection = 1` flows from the sickbay toward the squad side, so Reverse Fan sends sickbay air into the engine room.
- Movement range: strong blue = 1 AP, faint blue = 2 AP (yellow was avoided so it is never confused with contamination).
- A selected unit that runs out of AP hands selection to the next squad member with AP.
