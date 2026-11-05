// Shared types for Last Watch game logic. No Phaser imports in src/logic.

export interface Pos {
  x: number;
  y: number;
}

export type TileType =
  | 'floor'
  | 'bulkhead'
  | 'hatch'
  | 'halfCover'
  | 'fullCover'
  | 'vent'
  | 'decon'
  | 'console'
  | 'fanPanel'
  | 'entry';

export type HatchState = 'open' | 'closed' | 'welded';

/** 0 none, 1 low, 2 moderate, 3 severe. */
export type ContaminationLevel = 0 | 1 | 2 | 3;

export interface Tile {
  type: TileType;
  /** Only set when type === 'hatch'. */
  hatch?: HatchState;
  contamination: ContaminationLevel;
  /** Compartment label, used for UI and AI context. */
  room?: string;
}

export type Faction = 'player' | 'concordat' | 'unbound';

export type UnitClass =
  | 'boardingOfficer'
  | 'marineRifleman'
  | 'hospitalCorpsman'
  | 'damageControlman'
  | 'concordatMarine'
  | 'unboundRaider';

export type Gear = 'none' | 'respirator' | 'mopp';

export type AbilityId =
  | 'coordinatedAssault'
  | 'breach'
  | 'deconSpray'
  | 'stabilize'
  | 'weld'
  | 'reverseFan';

export interface Unit {
  id: string;
  name: string;
  faction: Faction;
  unitClass: UnitClass;
  pos: Pos;
  hp: number;
  maxHp: number;
  /** Tiles per move action. */
  move: number;
  aim: number;
  gear: Gear;
  damage: [min: number, max: number];
  abilities: AbilityId[];
  /** Action points remaining this turn. */
  ap: number;
  /** Set when the unit shoots (shooting ends its turn) or otherwise finishes. */
  turnEnded: boolean;
  exposure: number;
  downed: boolean;
  /** Rounds remaining before each ability can be used again. */
  cooldowns: Partial<Record<AbilityId, number>>;
}

export type Phase = 'player' | 'enemy';

export type Outcome = 'ongoing' | 'victory' | 'defeat';

export interface MissionState {
  width: number;
  height: number;
  /** Row-major: tiles[y][x]. */
  tiles: Tile[][];
  units: Unit[];
  round: number;
  maxRounds: number;
  phase: Phase;
  /** Vent network, in network order. Airflow runs toward higher indices when ventDirection is 1. */
  vents: Pos[];
  ventDirection: 1 | -1;
  consolePos: Pos;
  log: string[];
  outcome: Outcome;
  /** Seeded RNG state, so a mission can be saved and replayed. */
  rngState: number;
}

export type Action =
  | { kind: 'move'; unitId: string; to: Pos }
  | { kind: 'endTurn' };

export const AP_PER_TURN = 2;
