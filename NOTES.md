# Last Watch: session notes

Newest session first. Put playtest notes for the next session at the very top, under "Playtest notes".

## Playtest notes

(empty: add anything that feels off here between sessions)

---

## Session 1: Foundation (2026-11-05)

### Done
- Scaffolded Vite 8.1.5 + TypeScript 5.9 (strict) + Phaser 4.2.1 + Vitest 4.1. `npm run dev` binds to 127.0.0.1:5173. Vite `base: './'` so the build works from a GitHub Pages subpath.
- Phaser 4 ships agent skill files in `node_modules/phaser/skills/` (for example `v3-to-v4-migration`, `graphics-and-shapes`, `input-keyboard-mouse-touch`, `scenes`, `tweens`). Read these before writing Phaser code.
- Logic, with no Phaser imports:
  - `src/logic/types.ts`: Tile, Unit, MissionState, Action, and related types.
  - `src/logic/rng.ts`: `Rng` (mulberry32). `MissionState.rngState` holds the seed. Nothing rolls dice yet.
  - `src/logic/map.ts`: 4-directional movement, `findPath` (A*, with an optional `extraCost` hook for AI contamination avoidance), `reachableTiles` (BFS), walkability, `unitAt`.
  - `src/logic/turn.ts`: AP costs (up to Move tiles = 1 AP, up to 2x Move = 2 AP), `planMove` / `moveUnit`, and the round flow `endPlayerTurn` → `runEnemyPhase` (stub) → `endRound` (stub; increments the round) → `beginPlayerPhase` (refreshes AP and ticks cooldowns).
- `src/data/mission01.ts`: the 20x20 "Engine Room" map as an ASCII layout with a legend. Six compartments (Sickbay, Mess, Boarding, Passageway, Engine room, Aux machinery), 9 hatches (1 closed), a 6-vent network, decon in the Mess, the console at (16,6), the fan panel at (17,17), and 6 entry tiles. Sickbay starts severe, and the passageway vent starts moderate. Squad of 4, plus 3 Concordat and 4 Unbound placed (they do nothing yet).
- Scenes: `BootScene` → `MissionScene` (map, units, selection, movement range, path preview, animated moves) + `UIScene` (round/phase, squad roster you can click, selected unit, tile hover info, log, END TURN button).
- Keyboard: Tab / Shift+Tab cycles units, Esc deselects, Enter ends the turn.
- The contamination overlay already draws (yellow-green plus diagonal hatching, denser at higher levels), but nothing spreads yet.
- Tests: `tests/map.test.ts` and `tests/turn.test.ts`, 26 tests (pathfinding, hatches and cover blocking, unit blocking, A* vs BFS agreement, AP spending, round flow, cooldowns, RNG determinism, map integrity).

### Design decisions made this session (change freely)
- Movement is 4-directional (no diagonals). Contamination adjacency will also be 4-directional to match.
- Units cannot pass through other units, including allies. Downed units still occupy their tile.
- Cover tiles, consoles, and the fan panel are impassable. "Adjacent to the console" therefore means one of its 4 floor neighbours.
- Vent tiles are walkable floor grates. Vent order is engine aft → engine fwd → sickbay → passageway → mess → boarding. `ventDirection = 1` flows toward the squad side, so Reverse Fan sends sickbay air into the engine room.
- Movement range: strong blue = 1 AP, faint blue = 2 AP (yellow was avoided so it is never confused with contamination).
- A selected unit that runs out of AP hands selection to the next squad member with AP.

### Next (session 2: combat and enemies)
- `src/logic/combat.ts`: line of sight (Bresenham, blocked by bulkheads, closed hatches, and full cover?), cover detection, flanking, and the graze model, each with tests.
- Shooting (ends the turn), overwatch, downed state, and the shot preview UI.
- Concordat and Unbound AI in `src/logic/ai.ts`, plugged into `runEnemyPhase`.
- Combat log entries (the log panel already exists).

### Known issues
- `npm audit` reports advisories in vite 8.1.5 and vitest 4.1.10 (dev-server / test-runner only; nothing ships in the build). Fixed versions need a small download: run `npm audit fix` once approved.
- The bundle is 1.4 MB (Phaser itself), so Vite's chunk-size warning limit is raised to 2000 kB.
- Hot reload restarts the mission (state lives in the scene).
