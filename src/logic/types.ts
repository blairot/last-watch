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
  /** 0 to 100. At 100 the unit becomes infected. */
  exposure: number;
  /** Sticky: once infected, decon lowers exposure but does not cure the infection. */
  infected: boolean;
  /** Player units at 0 HP are downed (revivable). Enemy units at 0 HP are dead (hp 0, downed false). */
  downed: boolean;
  /** Fires at the first opposing unit that moves in its line of sight. Cleared at the start of its next turn. */
  overwatch: boolean;
  /** AP lost at the start of the unit's next turn (from Breach). */
  apPenalty: number;
  /** Rounds remaining before each ability can be used again. */
  cooldowns: Partial<Record<AbilityId, number>>;
}

export type ShotOutcome = 'miss' | 'graze' | 'hit';

/** Presentation events produced by the logic, played back in order by the scene, then cleared. */
export type Fx =
  | { kind: 'move'; unitId: string; path: Pos[] }
  | {
      kind: 'shot';
      shooterId: string;
      targetId: string;
      from: Pos;
      to: Pos;
      outcome: ShotOutcome;
      damage: number;
      reaction: boolean;
    }
  | { kind: 'text'; pos: Pos; text: string; tone: 'bad' | 'good' | 'info' }
  | { kind: 'phase'; text: string };

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
  /** Why the mission ended, for the end screen. */
  outcomeReason: string;
  /** Seeded RNG state, so a mission can be saved and replayed. */
  rngState: number;
  /** Pending presentation events (see Fx). The scene drains this. */
  fx: Fx[];
}

export type Action =
  | { kind: 'move'; unitId: string; to: Pos }
  | { kind: 'shoot'; unitId: string; targetId: string }
  | { kind: 'overwatch'; unitId: string }
  | { kind: 'hatch'; unitId: string; at: Pos }
  | { kind: 'ability'; unitId: string; ability: AbilityId; target: Pos }
  | { kind: 'endTurn' };

/** Result of any player or AI action. */
export type ActionResult = { ok: true } | { ok: false; reason: string };

export const AP_PER_TURN = 2;
