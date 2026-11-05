// Turn and round flow. Win and loss checks arrive in session 4.
import { findPath, reachableTiles } from './map';
import { AP_PER_TURN, type Faction, type MissionState, type Pos, type Unit } from './types';

export const isActive = (u: Unit): boolean => u.hp > 0 && !u.downed;

export const unitsOf = (state: MissionState, faction: Faction | 'enemy'): Unit[] =>
  state.units.filter((u) => (faction === 'enemy' ? u.faction !== 'player' : u.faction === faction));

export function getUnit(state: MissionState, id: string): Unit | undefined {
  return state.units.find((u) => u.id === id);
}

/** Move stat after status effects (infection applies -1 in session 3). */
export function effectiveMove(unit: Unit): number {
  return unit.move;
}

/**
 * AP needed to walk `steps` tiles: up to Move tiles costs 1 AP, up to 2x Move costs 2 AP.
 * Returns Infinity when the distance is beyond two moves.
 */
export function apCostForSteps(unit: Unit, steps: number): number {
  if (steps <= 0) return 0;
  const move = effectiveMove(unit);
  if (steps <= move) return 1;
  if (steps <= move * 2) return 2;
  return Infinity;
}

/** Furthest a unit can walk with its remaining AP this turn. */
export function maxMoveSteps(unit: Unit): number {
  if (!isActive(unit) || unit.turnEnded) return 0;
  return effectiveMove(unit) * Math.min(unit.ap, 2);
}

export interface MoveRange {
  /** posKey -> steps */
  tiles: Map<string, number>;
  /** Steps reachable for a single AP. */
  oneApSteps: number;
}

export function moveRange(state: MissionState, unit: Unit): MoveRange {
  return { tiles: reachableTiles(state, unit, maxMoveSteps(unit)), oneApSteps: effectiveMove(unit) };
}

export type MovePlan =
  | { ok: true; path: Pos[]; apCost: number }
  | { ok: false; reason: string };

export function planMove(state: MissionState, unit: Unit, to: Pos): MovePlan {
  if (state.phase !== 'player' && unit.faction === 'player') return { ok: false, reason: 'Not the player phase' };
  if (!isActive(unit)) return { ok: false, reason: `${unit.name} cannot act` };
  if (unit.turnEnded || unit.ap <= 0) return { ok: false, reason: `${unit.name} has no AP left` };
  const result = findPath(state, unit.pos, to, unit);
  if (!result || result.path.length === 0) return { ok: false, reason: 'No path' };
  const apCost = apCostForSteps(unit, result.path.length);
  if (apCost > unit.ap) return { ok: false, reason: 'Out of range' };
  return { ok: true, path: result.path, apCost };
}

/** Moves a unit, spending AP. Returns the plan so the UI can animate the path. */
export function moveUnit(state: MissionState, unitId: string, to: Pos): MovePlan {
  const unit = getUnit(state, unitId);
  if (!unit) return { ok: false, reason: 'Unknown unit' };
  const plan = planMove(state, unit, to);
  if (!plan.ok) return plan;
  unit.pos = { ...to };
  unit.ap -= plan.apCost;
  state.log.push(`${unit.name} moves ${plan.path.length} tiles (${plan.apCost} AP).`);
  return plan;
}

function refreshFaction(state: MissionState, isEnemy: boolean): void {
  for (const u of state.units) {
    if ((u.faction !== 'player') !== isEnemy) continue;
    u.ap = isActive(u) ? AP_PER_TURN : 0;
    u.turnEnded = false;
    for (const key of Object.keys(u.cooldowns) as (keyof Unit['cooldowns'])[]) {
      const left = (u.cooldowns[key] ?? 0) - 1;
      if (left > 0) u.cooldowns[key] = left;
      else delete u.cooldowns[key];
    }
  }
}

export function beginPlayerPhase(state: MissionState): void {
  state.phase = 'player';
  refreshFaction(state, false);
  state.log.push(`— Round ${state.round}: player phase —`);
}

/** Enemy phase. AI arrives in session 2; for now enemies only refresh AP and pass. */
export function runEnemyPhase(state: MissionState): void {
  state.phase = 'enemy';
  refreshFaction(state, true);
  state.log.push('Enemy phase: the enemy holds position.');
  for (const u of unitsOf(state, 'enemy')) u.ap = 0;
}

/** End-of-round step: contamination spread and exposure arrive in session 3. */
export function endRound(state: MissionState): void {
  state.round += 1;
}

/** Player presses End Turn: enemy phase, end of round, then the next player phase. */
export function endPlayerTurn(state: MissionState): void {
  if (state.outcome !== 'ongoing' || state.phase !== 'player') return;
  runEnemyPhase(state);
  endRound(state);
  beginPlayerPhase(state);
}

