# Last Watch: Project Guide for Claude Code

## What this is

Last Watch is a turn-based tactical RPG about the crew of USS Halyard (DDG-131), a fictional US Navy destroyer carrying the only viable path to a vaccine after a global pandemic. The current goal is a **micro-demo**: one boarding mission that showcases the game's signature mechanic, spreading contamination that players can contain or turn against the enemy.

The full design lives in the Last Watch Game Design Document. This file covers only what is needed to build the micro-demo.

## Hard rules

- **Original content only.** The game is an homage to a naval pandemic thriller. Never use character names, ship names, dialogue, or plot events from any existing TV series, film, or book. Use only the names defined in this file.
- **Keep game logic independent of Phaser.** Rules live in plain TypeScript under `src/logic/` with no Phaser imports, so they can be unit tested and reused.
- **Deterministic randomness.** All rolls go through a seeded RNG in `src/logic/rng.ts`. Never call `Math.random()` in game logic.
- **Small, playable steps.** After every task, the game must build and run. Do not leave the project broken between sessions.
- **End every session by updating `NOTES.md`** with what was done, what is next, and any known bugs. The developer works a few hours per week, so this file is how context survives between sessions.

## Tech stack

- **Phaser 4** (latest 4.x from npm) with **TypeScript** in strict mode
- **Vite** for dev server and builds
- **Vitest** for unit tests of `src/logic/`
- **GitHub Pages** deployment through a GitHub Actions workflow
- Phaser 4 ships AI agent skill files in its repository's `skills/` folder. Before writing rendering, input, or camera code, check whether those files are available in `node_modules/phaser` or the Phaser GitHub repository and consult the relevant one. Do not rely on Phaser 3 APIs from memory; several changed in version 4 (for example, tint fill modes).

## Folder structure

```
src/
  main.ts              Phaser game config and boot
  scenes/
    BootScene.ts       Asset loading
    MissionScene.ts    Map, units, input, and rendering
    UIScene.ts         HUD overlay: turn info, previews, combat log
  logic/
    types.ts           Shared types: Tile, Unit, MissionState, Action
    rng.ts             Seeded RNG (mulberry32 or similar)
    map.ts             Map data, pathfinding (A* on the grid), line of sight
    combat.ts          Hit and graze resolution, damage, flanking
    contamination.ts   Exposure, spread, decontamination
    abilities.ts       Class abilities
    ai.ts              Enemy decision making
    turn.ts            Turn and round flow, win and loss checks
  data/
    mission01.ts       The demo map and starting units
tests/
  *.test.ts            Vitest tests for src/logic
NOTES.md               Session log
```

## Micro-demo specification

### Mission: "Engine Room"

The squad boards a disabled tanker held by enemy forces and must seize the engine room control console. The map is a 20 by 20 tile ship interior with several compartments joined by hatches and a ventilation network.

- **Victory:** a player unit ends a turn adjacent to the control console with no enemy within 3 tiles of it, or all enemies are eliminated.
- **Defeat:** all player units are downed, or round 15 ends without victory.

### Tiles

| Tile | Behavior |
| --- | --- |
| Floor | Walkable |
| Bulkhead | Blocks movement and line of sight |
| Hatch (open) | Walkable; contamination passes through |
| Hatch (closed) | Blocks movement, line of sight, and contamination; opening costs 1 AP |
| Hatch (welded) | As closed, but only the Damage Controlman can unweld it, or a Breach can force it |
| Half cover | Crates, consoles; grants half cover to adjacent units |
| Full cover | Machinery; grants full cover to adjacent units |
| Vent | Part of the ventilation network; see contamination rules |
| Decon station | A unit ending its turn here loses 25 exposure |
| Console | The objective |
| Entry | Player deployment tiles |

### Turn structure

- Rounds alternate: player phase, then enemy phase. At the end of each round, contamination spreads.
- Each unit has **2 action points (AP)** per turn.
- Move: up to the unit's Move stat in tiles for 1 AP; a second move uses the second AP.
- Shoot, use an ability, or interact (open a hatch, use a console) costs 1 AP unless noted. Shooting ends the unit's turn.
- Overwatch costs 2 AP: the unit fires at the first enemy that moves within its line of sight during the enemy phase.

### Hit resolution (graze model)

1. Base hit chance = shooter Aim, minus 2% per tile beyond 6 tiles of range, clamped between 10% and 95%.
2. Roll to hit. On a miss, no damage.
3. On a hit, if the target is in cover from the shooter's position and is not flanked, roll for graze: **40%** for half cover, **70%** for full cover.
4. A graze deals half damage, rounded down, minimum 1. A full hit deals the weapon's damage.
5. A target is **flanked** when no cover tile lies between it and the shooter along the line of fire. Flanked targets never graze.
6. Before any shot, the UI shows hit chance, graze chance, and the damage range.

### Units

| Name | Class | HP | Move | Aim | Gear | Ability |
| --- | --- | --- | --- | --- | --- | --- |
| LCDR Marcus Holt | Boarding Officer | 8 | 5 | 75 | Respirator | Coordinated Assault |
| GySgt Rosa Abernathy | Marine Rifleman | 10 | 5 | 80 | Respirator | Breach |
| HM2 Theo Lindqvist | Hospital Corpsman | 7 | 5 | 65 | MOPP suit | Decon Spray, Stabilize |
| DC1 Ana Ferreira | Damage Controlman | 8 | 5 | 65 | MOPP suit | Weld, Reverse Fan |

Weapon damage: rifles deal 3 to 4. The Rifleman's carbine deals 3 to 5.

### Abilities

- **Coordinated Assault (Boarding Officer, 1 AP, cooldown 3 rounds):** an ally in line of sight gains 1 AP this turn.
- **Breach (Rifleman, 2 AP):** force open an adjacent closed or welded hatch. Enemies within 2 tiles on the far side lose 1 AP on their next turn.
- **Decon Spray (Corpsman, 1 AP, cooldown 2 rounds):** sets contamination to 0 in a 3 by 3 area within 3 tiles and reduces each unit's exposure in that area by 30.
- **Stabilize (Corpsman, 1 AP):** revive an adjacent downed ally at 2 HP.
- **Weld (Damage Controlman, 1 AP):** weld or unweld an adjacent hatch. Welding closes it if open.
- **Reverse Fan (Damage Controlman, 1 AP, at a fan control panel):** reverses the airflow direction of the vent network.

### Enemies

| Faction | Count | HP | Move | Aim | Gear | Behavior |
| --- | --- | --- | --- | --- | --- | --- |
| Concordat marines | 3 | 9 | 5 | 70 | MOPP suit | Hold cover, advance in pairs, seek flanking positions |
| Unbound raiders | 4 | 6 | 6 | 60 | None | Aggressive; avoid contaminated tiles; retreat when below half HP or outnumbered within 4 tiles |

Enemy AI scores candidate actions with a simple utility function: value of shot (hit chance times damage), cover gained, flank opportunities, distance to the console, and contamination risk weighted by the unit's gear. Keep it readable and tunable in `ai.ts`.

### Contamination (signature mechanic)

- Each tile has a **contamination level from 0 to 3**: none, low, moderate, severe.
- The demo map starts with severe contamination in one compartment (a ruptured sickbay) and moderate contamination in the vent ducts nearest it.
- **Exposure:** a unit ending its turn on a contaminated tile gains exposure: 5, 15, or 30 for levels 1, 2, or 3. Gear multiplies the gain: none x1.0, respirator x0.6, MOPP suit x0.2.
- **Effects of exposure:** at 50 or more, the unit suffers minus 10 Aim. At 100, the unit is **infected**: minus 20 Aim, minus 1 Move, and loses 1 HP per round.
- **Spread:** at the end of each round, for each tile at level 2 or 3, raise each adjacent floor tile connected through an open path (including open hatches) by 1 level, to a maximum of one level below the source. Closed and welded hatches block spread. Spread is calculated from a snapshot so it does not cascade within one round.
- **Ventilation:** vents form one network with a direction of airflow. At the end of each round, each vent at level 2 or 3 raises the next vent downstream by 1 level. Reverse Fan flips the direction.
- **Shared hazard:** enemies gain exposure by the same rules. Unbound raiders treat contaminated tiles as high cost when moving.
- **Intended play:** the player can seal hatches, reverse the fans, and flood the enemy-held engine room, while the Corpsman manages the squad's own exposure.

### Interface

- Grid with clear tile art; contamination drawn as a yellow-green overlay with a diagonal hatch pattern whose density reflects the level, so it remains readable for colorblind players.
- Hovering a tile shows its contamination level and the projected exposure gain for the selected unit.
- Movement range highlight that also previews total exposure along the hovered path.
- Shot preview: hit chance, graze chance, damage range, and whether the target is flanked.
- HUD: round counter (out of 15), active unit panel with HP, AP, exposure bar, and ability buttons.
- A scrolling combat log.
- Keyboard: Tab cycles units, Escape cancels, Enter ends the turn.

### Visual style

- 2D top-down, flat style. Use simple colored shapes or Kenney's free asset packs (kenney.nl) as placeholders.
- Palette: navy gray `#3B4654`, haze white `#E8ECEF`, signal orange `#F28C28`, contamination yellow-green `#B5C93A`.
- Target resolution 1280 by 720, scaling to fit the browser window.

## Definition of done for the micro-demo

- The mission is playable start to finish in a desktop browser, with both victory and defeat reachable.
- Contamination spreads, hatches and vents control it, and enemies are affected by it.
- Hit and exposure previews match actual outcomes.
- `npm run build` and `npm test` pass with no TypeScript errors.
- The game is deployed to GitHub Pages and the URL is recorded in `NOTES.md`.
