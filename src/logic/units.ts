// Unit queries and derived stats. Shared by combat, contamination, AI, and turn flow.
import { chebyshev } from './map';
import type { Faction, Gear, MissionState, Unit } from './types';

export const isActive = (u: Unit): boolean => u.hp > 0 && !u.downed;
export const isDead = (u: Unit): boolean => u.hp <= 0 && !u.downed;
export const isEnemy = (u: Unit): boolean => u.faction !== 'player';
export const areHostile = (a: Unit, b: Unit): boolean => (a.faction === 'player') !== (b.faction === 'player');

export const unitsOf = (state: MissionState, faction: Faction | 'enemy'): Unit[] =>
  state.units.filter((u) => (faction === 'enemy' ? isEnemy(u) : u.faction === faction));

export function getUnit(state: MissionState, id: string): Unit | undefined {
  return state.units.find((u) => u.id === id);
}

export const EXPOSURE_AIM_THRESHOLD = 50;
export const INFECTION_THRESHOLD = 100;

/** Gear multiplies exposure gain. */
export const GEAR_MULTIPLIER: Record<Gear, number> = { none: 1, respirator: 0.6, mopp: 0.2 };

/** Aim after exposure effects: -10 at 50+ exposure, -20 once infected. */
export function effectiveAim(u: Unit): number {
  if (u.infected) return u.aim - 20;
  if (u.exposure >= EXPOSURE_AIM_THRESHOLD) return u.aim - 10;
  return u.aim;
}

/** Move after exposure effects: infection costs 1 Move. */
export function effectiveMove(u: Unit): number {
  return u.infected ? Math.max(1, u.move - 1) : u.move;
}

/** Applies damage. Player units go down at 0 HP; enemies die. Returns true if the unit dropped. */
export function applyDamage(state: MissionState, u: Unit, amount: number): boolean {
  if (!isActive(u) || amount <= 0) return false;
  u.hp = Math.max(0, u.hp - amount);
  if (u.hp > 0) return false;
  u.overwatch = false;
  u.ap = 0;
  if (u.faction === 'player') {
    u.downed = true;
    state.log.push(`${u.name} is DOWN.`);
  } else {
    state.log.push(`${u.name} is eliminated.`);
  }
  state.fx.push({ kind: 'text', pos: { ...u.pos }, text: u.faction === 'player' ? 'DOWN' : 'KILLED', tone: u.faction === 'player' ? 'bad' : 'good' });
  checkOutcome(state);
  return true;
}

/** Victory requires a squad member next to the console with no enemy within this many tiles of it. */
export const CONSOLE_CLEAR_RADIUS = 3;

/** True if `u` is next to the console (diagonals count). */
export const isAtConsole = (state: MissionState, u: Unit): boolean => chebyshev(u.pos, state.consolePos) === 1;

/** Victory and defeat conditions that can happen at any moment (eliminations). */
export function checkOutcome(state: MissionState): void {
  if (state.outcome !== 'ongoing') return;
  if (unitsOf(state, 'enemy').every((u) => !isActive(u))) {
    state.outcome = 'victory';
    state.outcomeReason = 'All hostiles eliminated. The engine room is ours.';
  } else if (unitsOf(state, 'player').every((u) => !isActive(u))) {
    state.outcome = 'defeat';
    state.outcomeReason = 'The entire boarding party is down.';
  }
  if (state.outcome !== 'ongoing') state.log.push(state.outcome === 'victory' ? 'MISSION COMPLETE.' : 'MISSION FAILED.');
}

/** End-of-player-turn victory: a squad member holds the console with no enemy within 3 tiles of it. */
export function checkConsoleVictory(state: MissionState): boolean {
  if (state.outcome !== 'ongoing') return false;
  const holder = unitsOf(state, 'player').find((u) => isActive(u) && isAtConsole(state, u));
  if (!holder) return false;
  const contested = unitsOf(state, 'enemy').some((e) => isActive(e) && chebyshev(e.pos, state.consolePos) <= CONSOLE_CLEAR_RADIUS);
  if (contested) return false;
  state.outcome = 'victory';
  state.outcomeReason = `${holder.name} seized the engine room console.`;
  state.log.push('MISSION COMPLETE.');
  return true;
}
