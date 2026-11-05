// Turn and round flow, plus the end-of-turn victory and round-limit checks.
import { runEnemyAi } from './ai';
import { applyEndOfTurnExposure, applyInfectionDamage, spreadContamination } from './contamination';
import { AP_PER_TURN, type MissionState, type Unit } from './types';
import { checkConsoleVictory, checkOutcome, isActive, isEnemy } from './units';

export { apCostForSteps, maxMoveCost, moveRange, moveUnit, planMove } from './actions';
export { effectiveMove, getUnit, isActive, unitsOf } from './units';

/** Start of a side's turn: refresh AP (minus any Breach penalty), clear overwatch, tick cooldowns. */
function refreshSide(state: MissionState, enemySide: boolean): void {
  for (const u of state.units) {
    if (isEnemy(u) !== enemySide) continue;
    u.ap = isActive(u) ? Math.max(0, AP_PER_TURN - u.apPenalty) : 0;
    u.apPenalty = 0;
    u.turnEnded = false;
    u.overwatch = false;
    for (const key of Object.keys(u.cooldowns) as (keyof Unit['cooldowns'])[]) {
      const left = (u.cooldowns[key] ?? 0) - 1;
      if (left > 0) u.cooldowns[key] = left;
      else delete u.cooldowns[key];
    }
  }
}

export function beginPlayerPhase(state: MissionState): void {
  state.phase = 'player';
  refreshSide(state, false);
  state.log.push(`— Round ${state.round} of ${state.maxRounds}: player phase —`);
  state.fx.push({ kind: 'phase', text: `ROUND ${state.round}` });
}

/** Enemy phase: AI turns, then enemies take exposure for where they ended. */
export function runEnemyPhase(state: MissionState): void {
  state.phase = 'enemy';
  refreshSide(state, true);
  state.log.push('— Enemy phase —');
  state.fx.push({ kind: 'phase', text: 'ENEMY PHASE' });
  runEnemyAi(state);
  if (state.outcome === 'ongoing') applyEndOfTurnExposure(state, 'enemy');
  checkOutcome(state);
}

/** End of round: infection damage, contamination spread, then the round limit. */
export function endRound(state: MissionState): void {
  applyInfectionDamage(state);
  if (state.outcome !== 'ongoing') return;
  const spread = spreadContamination(state);
  if (spread > 0) state.log.push(`Contamination spreads (${spread} tiles worsen).`);
  if (state.round >= state.maxRounds) {
    state.outcome = 'defeat';
    state.outcomeReason = `Round ${state.maxRounds} ended without control of the console.`;
    state.log.push('MISSION FAILED.');
    return;
  }
  state.round += 1;
}

/** Player presses End Turn: exposure, console check, enemy phase, end of round, next player phase. */
export function endPlayerTurn(state: MissionState): void {
  if (state.outcome !== 'ongoing' || state.phase !== 'player') return;
  applyEndOfTurnExposure(state, 'player');
  checkOutcome(state);
  if (state.outcome !== 'ongoing' || checkConsoleVictory(state)) return;
  runEnemyPhase(state);
  if (state.outcome !== 'ongoing') return;
  endRound(state);
  if (state.outcome !== 'ongoing') return;
  beginPlayerPhase(state);
}
