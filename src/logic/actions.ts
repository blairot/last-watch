// Unit actions shared by the player and the AI: move, shoot, overwatch, operate hatches.
import { resolveShot, triggerOverwatch } from './combat';
import { findPath, hasLineOfSight, manhattan, reachableTiles, tileAt, unitAt, type ExtraCost } from './map';
import type { ActionResult, MissionState, Pos, Unit } from './types';
import { areHostile, effectiveMove, getUnit, isActive, isEnemy } from './units';

export const SHOOT_AP = 1;
export const OVERWATCH_AP = 2;
export const HATCH_AP = 1;

/** Unbound raiders treat contaminated tiles as costly when moving. */
export const UNBOUND_CONTAMINATION_COST = 2;

/** Per-tile extra movement cost for this unit, or undefined if it walks normally. */
export function moveExtraCost(state: MissionState, unit: Unit): ExtraCost | undefined {
  if (unit.unitClass !== 'unboundRaider') return undefined;
  return (p) => (tileAt(state, p)?.contamination ?? 0) * UNBOUND_CONTAMINATION_COST;
}

/**
 * AP needed to cover `cost` movement: up to Move costs 1 AP, up to 2x Move costs 2 AP.
 * Returns Infinity when beyond two moves.
 */
export function apCostForSteps(unit: Unit, cost: number): number {
  if (cost <= 0) return 0;
  const move = effectiveMove(unit);
  if (cost <= move) return 1;
  if (cost <= move * 2) return 2;
  return Infinity;
}

/** Can this unit act right now (its side's phase, alive, turn not ended, AP left)? */
export function canAct(state: MissionState, unit: Unit): ActionResult {
  if (state.outcome !== 'ongoing') return { ok: false, reason: 'The mission is over' };
  if (isEnemy(unit) !== (state.phase === 'enemy')) return { ok: false, reason: 'Not this unit’s phase' };
  if (!isActive(unit)) return { ok: false, reason: `${unit.name} cannot act` };
  if (unit.turnEnded || unit.ap <= 0) return { ok: false, reason: `${unit.name} has no AP left` };
  return { ok: true };
}

/** Furthest movement cost a unit can cover with its remaining AP this turn. */
export function maxMoveCost(unit: Unit): number {
  if (!isActive(unit) || unit.turnEnded) return 0;
  return effectiveMove(unit) * Math.min(unit.ap, 2);
}

export interface MoveRange {
  /** posKey -> movement cost */
  tiles: Map<string, number>;
  /** Cost reachable for a single AP. */
  oneApCost: number;
}

export function moveRange(state: MissionState, unit: Unit): MoveRange {
  return {
    tiles: reachableTiles(state, unit, maxMoveCost(unit), moveExtraCost(state, unit)),
    oneApCost: effectiveMove(unit),
  };
}

export type MovePlan = { ok: true; path: Pos[]; apCost: number } | { ok: false; reason: string };

export function planMove(state: MissionState, unit: Unit, to: Pos): MovePlan {
  const can = canAct(state, unit);
  if (!can.ok) return can;
  const result = findPath(state, unit.pos, to, unit, { extraCost: moveExtraCost(state, unit) });
  if (!result || result.path.length === 0) return { ok: false, reason: 'No path' };
  const apCost = apCostForSteps(unit, result.cost);
  if (apCost > unit.ap) return { ok: false, reason: 'Out of range' };
  return { ok: true, path: result.path, apCost };
}

/**
 * Moves a unit step by step, spending AP. Hostile overwatch can fire at each step; if the
 * mover is dropped it stops where it fell. The AP is spent either way.
 */
export function moveUnit(state: MissionState, unitId: string, to: Pos): MovePlan {
  const unit = getUnit(state, unitId);
  if (!unit) return { ok: false, reason: 'Unknown unit' };
  const plan = planMove(state, unit, to);
  if (!plan.ok) return plan;
  unit.ap -= plan.apCost;
  let segment: Pos[] = [];
  let walked = 0;
  for (const step of plan.path) {
    unit.pos = { ...step };
    segment.push({ ...step });
    walked++;
    const fxBefore = state.fx.length;
    const dropped = triggerOverwatch(state, unit);
    if (state.fx.length > fxBefore) {
      // Play the walk up to here before the reaction shot.
      state.fx.splice(fxBefore, 0, { kind: 'move', unitId: unit.id, path: segment });
      segment = [];
    }
    if (dropped) break;
  }
  if (segment.length > 0) state.fx.push({ kind: 'move', unitId: unit.id, path: segment });
  state.log.push(`${unit.name} moves ${walked} tiles (${plan.apCost} AP).`);
  return plan;
}

export function canShoot(state: MissionState, shooter: Unit, target: Unit): ActionResult {
  const can = canAct(state, shooter);
  if (!can.ok) return can;
  if (shooter.ap < SHOOT_AP) return { ok: false, reason: 'Not enough AP' };
  if (!isActive(target) || !areHostile(shooter, target)) return { ok: false, reason: 'Not a valid target' };
  if (!hasLineOfSight(state, shooter.pos, target.pos)) return { ok: false, reason: 'No line of sight' };
  return { ok: true };
}

/** Shoot costs 1 AP and ends the unit's turn. */
export function shoot(state: MissionState, shooterId: string, targetId: string): ActionResult {
  const shooter = getUnit(state, shooterId);
  const target = getUnit(state, targetId);
  if (!shooter || !target) return { ok: false, reason: 'Unknown unit' };
  const can = canShoot(state, shooter, target);
  if (!can.ok) return can;
  resolveShot(state, shooter, target);
  shooter.ap = 0;
  shooter.turnEnded = true;
  return { ok: true };
}

/** Overwatch costs 2 AP (a full turn) and lasts until the unit's next turn starts. */
export function setOverwatch(state: MissionState, unitId: string): ActionResult {
  const unit = getUnit(state, unitId);
  if (!unit) return { ok: false, reason: 'Unknown unit' };
  const can = canAct(state, unit);
  if (!can.ok) return can;
  if (unit.ap < OVERWATCH_AP) return { ok: false, reason: 'Overwatch needs 2 AP' };
  unit.overwatch = true;
  unit.ap = 0;
  unit.turnEnded = true;
  state.log.push(`${unit.name} is on overwatch.`);
  state.fx.push({ kind: 'text', pos: { ...unit.pos }, text: 'OVERWATCH', tone: 'info' });
  return { ok: true };
}

/** Whether `unit` stands next to (not diagonal to) the tile. Hatches are used from an adjacent tile. */
export const isBeside = (unit: Unit, p: Pos): boolean => manhattan(unit.pos, p) === 1;

export function canToggleHatch(state: MissionState, unit: Unit, at: Pos): ActionResult {
  const can = canAct(state, unit);
  if (!can.ok) return can;
  const tile = tileAt(state, at);
  if (!tile || tile.type !== 'hatch') return { ok: false, reason: 'Not a hatch' };
  if (!isBeside(unit, at)) return { ok: false, reason: 'Must stand next to the hatch' };
  if (tile.hatch === 'welded') return { ok: false, reason: 'Welded shut: unweld (Damage Controlman) or Breach' };
  if (tile.hatch === 'open' && unitAt(state, at)) return { ok: false, reason: 'Someone is in the hatchway' };
  if (unit.ap < HATCH_AP) return { ok: false, reason: 'Not enough AP' };
  return { ok: true };
}

/** Open a closed hatch or close an open one, for 1 AP. */
export function toggleHatch(state: MissionState, unitId: string, at: Pos): ActionResult {
  const unit = getUnit(state, unitId);
  if (!unit) return { ok: false, reason: 'Unknown unit' };
  const can = canToggleHatch(state, unit, at);
  if (!can.ok) return can;
  const tile = tileAt(state, at)!;
  tile.hatch = tile.hatch === 'open' ? 'closed' : 'open';
  unit.ap -= HATCH_AP;
  state.log.push(`${unit.name} ${tile.hatch === 'open' ? 'opens' : 'closes'} a hatch.`);
  state.fx.push({ kind: 'text', pos: { ...at }, text: tile.hatch === 'open' ? 'OPENED' : 'CLOSED', tone: 'info' });
  return { ok: true };
}
