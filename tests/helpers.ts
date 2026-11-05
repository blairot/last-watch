// Small builders for logic tests.
import { buildTiles } from '../src/data/mission01';
import type { MissionState, Pos, Unit } from '../src/logic/types';

/** Minimal state from an ASCII layout (same legend as mission01), with optional units. */
export function stateFrom(layout: string[], units: Unit[] = [], overrides: Partial<MissionState> = {}): MissionState {
  const tiles = buildTiles(layout);
  return {
    width: tiles[0].length, height: tiles.length, tiles, units,
    round: 1, maxRounds: 15, phase: 'player', vents: [], ventDirection: 1,
    consolePos: { x: 0, y: 0 }, log: [], outcome: 'ongoing', outcomeReason: '', rngState: 1, fx: [],
    ...overrides,
  };
}

export function unit(id: string, pos: Pos, overrides: Partial<Unit> = {}): Unit {
  return {
    id, name: id, faction: 'player', unitClass: 'marineRifleman', pos,
    hp: 10, maxHp: 10, move: 5, aim: 80, gear: 'none', damage: [3, 5], abilities: [],
    ap: 2, turnEnded: false, exposure: 0, infected: false, downed: false, overwatch: false, apPenalty: 0,
    cooldowns: {}, ...overrides,
  };
}

export const enemy = (id: string, pos: Pos, overrides: Partial<Unit> = {}): Unit =>
  unit(id, pos, { faction: 'concordat', unitClass: 'concordatMarine', hp: 9, maxHp: 9, aim: 70, damage: [3, 4], ...overrides });

export const raider = (id: string, pos: Pos, overrides: Partial<Unit> = {}): Unit =>
  unit(id, pos, { faction: 'unbound', unitClass: 'unboundRaider', hp: 6, maxHp: 6, move: 6, aim: 60, damage: [3, 4], ...overrides });
