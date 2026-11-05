// Mission 01, "Engine Room": a disabled tanker held by enemy forces.
import type { ContaminationLevel, MissionState, Pos, Tile, TileType, Unit } from '../logic/types';
import { AP_PER_TURN } from '../logic/types';

/*
Legend
  #  bulkhead           .  floor             E  entry (deployment)
  o  hatch, open        c  hatch, closed     w  hatch, welded
  h  half cover         F  full cover        v  vent
  +  decon station      K  control console   P  fan control panel

Compartments
  Sickbay (x1-5, y1-5)      ruptured; starts at severe contamination
  Mess (x1-5, y7-11)        decon station
  Boarding (x1-5, y13-18)   squad deploys here
  Passageway (x7-8)         spine corridor
  Engine room (x10-18, y1-11)  objective console, enemy-held
  Aux machinery (x10-18, y13-18)  fan control panel
*/
export const MISSION01_LAYOUT: readonly string[] = [
  '####################', // 0
  '#h...h#..#.........#', // 1
  '#..v..#..#.v.......#', // 2
  '#.....o..#..FF.....#', // 3
  '#h...h#..c..FF.....#', // 4
  '#.....#..#....h....#', // 5
  '###c###.v#......K..#', // 6
  '#.....#..#....h....#', // 7
  '#+..h.#..#..FF..h..#', // 8
  '#.....o..o..FF.....#', // 9
  '#..h.v#..#.......v.#', // 10
  '#.....#..#.h.....h.#', // 11
  '###o###..#####o#####', // 12
  '#.....#..#.........#', // 13
  '#h...v#..#..F...h..#', // 14
  '#..h..o..#..F......#', // 15
  '#.EEE.#..o.........#', // 16
  '#.EEE.#..#.......P.#', // 17
  '#.....#..#h.......h#', // 18
  '####################', // 19
];

const CHAR_TO_TILE: Record<string, Pick<Tile, 'type' | 'hatch'>> = {
  '#': { type: 'bulkhead' },
  '.': { type: 'floor' },
  E: { type: 'entry' },
  o: { type: 'hatch', hatch: 'open' },
  c: { type: 'hatch', hatch: 'closed' },
  w: { type: 'hatch', hatch: 'welded' },
  h: { type: 'halfCover' },
  F: { type: 'fullCover' },
  v: { type: 'vent' },
  '+': { type: 'decon' },
  K: { type: 'console' },
  P: { type: 'fanPanel' },
};

interface Room {
  name: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const ROOMS: readonly Room[] = [
  { name: 'Sickbay', x0: 1, y0: 1, x1: 5, y1: 5 },
  { name: 'Mess', x0: 1, y0: 7, x1: 5, y1: 11 },
  { name: 'Boarding', x0: 1, y0: 13, x1: 5, y1: 18 },
  { name: 'Passageway', x0: 7, y0: 1, x1: 8, y1: 18 },
  { name: 'Engine room', x0: 10, y0: 1, x1: 18, y1: 11 },
  { name: 'Aux machinery', x0: 10, y0: 13, x1: 18, y1: 18 },
];

/**
 * Vent network in network order. With ventDirection = 1, air flows toward higher indices:
 * from the sickbay out into the passageway, mess, and boarding area, toward the squad.
 * Reverse Fan flips it so the sickbay's air flows into the engine room vents instead.
 */
export const MISSION01_VENTS: readonly Pos[] = [
  { x: 17, y: 10 }, // engine room, aft
  { x: 11, y: 2 }, // engine room, forward
  { x: 3, y: 2 }, // sickbay
  { x: 8, y: 6 }, // passageway
  { x: 5, y: 10 }, // mess
  { x: 5, y: 14 }, // boarding
];

const STARTING_CONTAMINATION: { pos: Pos; level: ContaminationLevel }[] = [
  { pos: { x: 8, y: 6 }, level: 2 }, // passageway vent, nearest the sickbay
];

type UnitTemplate = Omit<Unit, 'ap' | 'turnEnded' | 'exposure' | 'downed' | 'cooldowns' | 'hp'>;

const PLAYER_UNITS: UnitTemplate[] = [
  {
    id: 'holt', name: 'LCDR Marcus Holt', faction: 'player', unitClass: 'boardingOfficer',
    pos: { x: 2, y: 16 }, maxHp: 8, move: 5, aim: 75, gear: 'respirator', damage: [3, 4],
    abilities: ['coordinatedAssault'],
  },
  {
    id: 'abernathy', name: 'GySgt Rosa Abernathy', faction: 'player', unitClass: 'marineRifleman',
    pos: { x: 3, y: 16 }, maxHp: 10, move: 5, aim: 80, gear: 'respirator', damage: [3, 5],
    abilities: ['breach'],
  },
  {
    id: 'lindqvist', name: 'HM2 Theo Lindqvist', faction: 'player', unitClass: 'hospitalCorpsman',
    pos: { x: 2, y: 17 }, maxHp: 7, move: 5, aim: 65, gear: 'mopp', damage: [3, 4],
    abilities: ['deconSpray', 'stabilize'],
  },
  {
    id: 'ferreira', name: 'DC1 Ana Ferreira', faction: 'player', unitClass: 'damageControlman',
    pos: { x: 3, y: 17 }, maxHp: 8, move: 5, aim: 65, gear: 'mopp', damage: [3, 4],
    abilities: ['weld', 'reverseFan'],
  },
];

const concordat = (n: number, pos: Pos): UnitTemplate => ({
  id: `concordat${n}`, name: `Concordat Marine ${n}`, faction: 'concordat', unitClass: 'concordatMarine',
  pos, maxHp: 9, move: 5, aim: 70, gear: 'mopp', damage: [3, 4], abilities: [],
});

const unbound = (n: number, pos: Pos): UnitTemplate => ({
  id: `unbound${n}`, name: `Unbound Raider ${n}`, faction: 'unbound', unitClass: 'unboundRaider',
  pos, maxHp: 6, move: 6, aim: 60, gear: 'none', damage: [3, 4], abilities: [],
});

const ENEMY_UNITS: UnitTemplate[] = [
  concordat(1, { x: 15, y: 5 }),
  concordat(2, { x: 17, y: 8 }),
  concordat(3, { x: 14, y: 9 }),
  unbound(1, { x: 11, y: 6 }),
  unbound(2, { x: 11, y: 10 }),
  unbound(3, { x: 15, y: 14 }),
  unbound(4, { x: 12, y: 17 }),
];

function roomAt(x: number, y: number): string | undefined {
  return ROOMS.find((r) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1)?.name;
}

export function buildTiles(layout: readonly string[]): Tile[][] {
  return layout.map((row, y) =>
    [...row].map((ch, x) => {
      const def = CHAR_TO_TILE[ch];
      if (!def) throw new Error(`Unknown map character '${ch}' at ${x},${y}`);
      const tile: Tile = { type: def.type as TileType, contamination: 0, room: roomAt(x, y) };
      if (def.hatch) tile.hatch = def.hatch;
      return tile;
    }),
  );
}

export function createMission01(seed = 131): MissionState {
  const tiles = buildTiles(MISSION01_LAYOUT);

  // Ruptured sickbay: every tile in the compartment starts severe.
  const sickbay = ROOMS.find((r) => r.name === 'Sickbay')!;
  for (let y = sickbay.y0; y <= sickbay.y1; y++) {
    for (let x = sickbay.x0; x <= sickbay.x1; x++) tiles[y][x].contamination = 3;
  }
  for (const { pos, level } of STARTING_CONTAMINATION) tiles[pos.y][pos.x].contamination = level;

  let consolePos: Pos = { x: 0, y: 0 };
  tiles.forEach((row, y) => row.forEach((t, x) => { if (t.type === 'console') consolePos = { x, y }; }));

  const units: Unit[] = [...PLAYER_UNITS, ...ENEMY_UNITS].map((t) => ({
    ...t,
    pos: { ...t.pos },
    damage: [...t.damage] as [number, number],
    abilities: [...t.abilities],
    hp: t.maxHp,
    ap: AP_PER_TURN,
    turnEnded: false,
    exposure: 0,
    downed: false,
    cooldowns: {},
  }));

  return {
    width: tiles[0].length,
    height: tiles.length,
    tiles,
    units,
    round: 1,
    maxRounds: 15,
    phase: 'player',
    vents: MISSION01_VENTS.map((p) => ({ ...p })),
    ventDirection: 1,
    consolePos,
    log: ['USS Halyard boarding party is aboard. Seize the engine room console.', '— Round 1: player phase —'],
    outcome: 'ongoing',
    rngState: seed,
  };
}
