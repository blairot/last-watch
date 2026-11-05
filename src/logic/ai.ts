// Enemy decision making: a small utility AI. Each step it scores every option it has
// (shoot, move somewhere, overwatch, open a hatch, or hold) and takes the best one.
// Tune behaviour through the WEIGHTS table below.
import { abilityReady, abilityTargets, useAbility } from './abilities';
import { apCostForSteps, canAct, canShoot, isBeside, moveRange, moveUnit, setOverwatch, shoot, toggleHatch } from './actions';
import { coverFrom, expectedDamage, previewShot, type CoverLevel } from './combat';
import { projectExposure } from './contamination';
import { chebyshev, distanceField, hasLineOfSight, keyPos, neighbors, posKey, tileAt } from './map';
import type { MissionState, Pos, Unit } from './types';
import { areHostile, isActive, unitsOf } from './units';

export interface AiWeights {
  /** Per point of expected damage from the best shot available. */
  shot: number;
  /** Times the probability that the shot kills or downs the target. */
  kill: number;
  /** Per cover point (half 1, full 2) against each squad member that can see the tile. */
  cover: number;
  /** Penalty per squad member that can see the tile and would flank it. */
  exposed: number;
  /** Bonus per squad member this tile flanks. */
  flank: number;
  /** Per tile of walking distance to the nearest squad member. Negative keeps away. */
  approach: number;
  /** Tiles from the console the unit is happy to be. */
  consoleRadius: number;
  /** Penalty per tile beyond consoleRadius. */
  consolePull: number;
  /** Bonus for ending near a same-faction ally (advance in pairs). */
  pair: number;
  pairRange: number;
  /** Per point of exposure the unit would gain ending its turn there (gear already applied). */
  contamination: number;
  /** Value of going on overwatch when the squad is near but not visible. */
  overwatch: number;
  /** Small cost per AP spent moving, so units don't shuffle for nothing. */
  apSpend: number;
}

export const WEIGHTS: Record<'concordat' | 'unbound' | 'unboundRetreat' | 'squadBot', AiWeights> = {
  // Disciplined: hold cover near the console, move in pairs, look for flanks.
  concordat: {
    shot: 3, kill: 4, cover: 2, exposed: 2.5, flank: 2, approach: 0.15,
    consoleRadius: 5, consolePull: 1.2, pair: 2, pairRange: 3,
    contamination: 1.5, overwatch: 1.5, apSpend: 0.3,
  },
  // Aggressive: close the distance and shoot; badly fear contamination (no protective gear).
  unbound: {
    shot: 3.5, kill: 4, cover: 0.8, exposed: 1, flank: 1, approach: 0.4,
    consoleRadius: 99, consolePull: 0, pair: 0, pairRange: 0,
    contamination: 0.6, overwatch: 0, apSpend: 0.2,
  },
  // Hurt or outnumbered raiders fall back and look for cover.
  unboundRetreat: {
    shot: 1.5, kill: 3, cover: 2, exposed: 2.5, flank: 0.5, approach: -0.8,
    consoleRadius: 99, consolePull: 0, pair: 0, pairRange: 0,
    contamination: 0.6, overwatch: 0, apSpend: 0.1,
  },
  // A simple stand-in player used only by the balance simulator: push to the console, use cover,
  // shoot. It never uses abilities or hatches, so it plays worse than a careful human.
  squadBot: {
    shot: 3, kill: 4, cover: 2, exposed: 2.5, flank: 1.5, approach: 0,
    consoleRadius: 1, consolePull: 1.2, pair: 0, pairRange: 0,
    contamination: 0.5, overwatch: 1, apSpend: 0.2,
  },
};

const COVER_POINTS: Record<CoverLevel, number> = { none: 0, half: 1, full: 2 };
const OUTNUMBER_RADIUS = 4;
const UNKNOWN_DISTANCE = 40;

/** Unbound fall back when below half HP or outnumbered within 4 tiles. */
export function isRetreating(state: MissionState, u: Unit): boolean {
  if (u.unitClass !== 'unboundRaider') return false;
  if (u.hp < u.maxHp / 2) return true;
  const near = (list: Unit[]) => list.filter((x) => isActive(x) && chebyshev(x.pos, u.pos) <= OUTNUMBER_RADIUS).length;
  return near(unitsOf(state, 'player')) > near(unitsOf(state, 'enemy'));
}

export function weightsFor(state: MissionState, u: Unit): AiWeights {
  if (u.faction === 'player') return WEIGHTS.squadBot;
  if (u.faction === 'concordat') return WEIGHTS.concordat;
  return isRetreating(state, u) ? WEIGHTS.unboundRetreat : WEIGHTS.unbound;
}

interface Context {
  state: MissionState;
  unit: Unit;
  w: AiWeights;
  threats: Unit[];
  /** Walking distance to the nearest hostile, through closed (not welded) hatches. */
  dist: Map<string, number>;
}

function makeContext(state: MissionState, unit: Unit): Context {
  const threats = state.units.filter((t) => isActive(t) && areHostile(unit, t));
  return {
    state, unit, w: weightsFor(state, unit), threats,
    dist: distanceField(state, threats.map((t) => t.pos), true),
  };
}

/** How good it is for the unit to end up standing at P (not counting shots). */
export function positionValue(ctx: Context, p: Pos): number {
  const { state, unit, w } = ctx;
  let v = 0;
  for (const t of ctx.threats) {
    if (!hasLineOfSight(state, p, t.pos)) continue;
    const myCover = coverFrom(state, p, t.pos);
    v += myCover === 'none' ? -w.exposed : w.cover * COVER_POINTS[myCover];
    if (coverFrom(state, t.pos, p) === 'none') v += w.flank;
  }
  v -= w.approach * (ctx.dist.get(posKey(p)) ?? UNKNOWN_DISTANCE);
  v -= w.consolePull * Math.max(0, chebyshev(p, state.consolePos) - w.consoleRadius);
  if (w.pair > 0) {
    const paired = state.units.some(
      (a) => a !== unit && a.faction === unit.faction && isActive(a) && chebyshev(a.pos, p) <= w.pairRange,
    );
    if (paired) v += w.pair;
  }
  v -= w.contamination * projectExposure(state, unit, p).net;
  return v;
}

interface ShotChoice {
  target: Unit;
  value: number;
}

/** Best shot available from P, scored. */
export function bestShot(ctx: Context, p: Pos): ShotChoice | null {
  const { state, unit, w } = ctx;
  let best: ShotChoice | null = null;
  for (const t of ctx.threats) {
    const pv = previewShot(state, unit, t, p);
    if (!pv.visible) continue;
    const killChance = (pv.hitChance / 100) * (
      (1 - pv.grazeChance / 100) * fractionAtLeast(pv.damage, t.hp) + (pv.grazeChance / 100) * fractionAtLeast(pv.grazeDamage, t.hp)
    );
    const value = w.shot * expectedDamage(pv) + w.kill * killChance;
    if (!best || value > best.value) best = { target: t, value };
  }
  return best;
}

function fractionAtLeast([min, max]: [number, number], hp: number): number {
  const n = max - min + 1;
  let hits = 0;
  for (let d = min; d <= max; d++) if (d >= hp) hits++;
  return hits / n;
}

type Choice =
  | { kind: 'hold'; value: number }
  | { kind: 'shoot'; value: number; target: Unit }
  | { kind: 'move'; value: number; to: Pos }
  | { kind: 'overwatch'; value: number }
  | { kind: 'hatch'; value: number; at: Pos };

/** Every option open to the unit right now, scored. Exposed for tests and tuning. */
export function scoreOptions(state: MissionState, unit: Unit): Choice[] {
  const ctx = makeContext(state, unit);
  const here = positionValue(ctx, unit.pos);
  const choices: Choice[] = [{ kind: 'hold', value: here }];

  const shotHere = bestShot(ctx, unit.pos);
  if (shotHere && canShoot(state, unit, shotHere.target).ok) {
    choices.push({ kind: 'shoot', value: here + shotHere.value, target: shotHere.target });
  }

  const nearestThreat = ctx.dist.get(posKey(unit.pos)) ?? UNKNOWN_DISTANCE;
  if (unit.ap >= 2 && ctx.w.overwatch > 0 && !shotHere && nearestThreat <= 12) {
    choices.push({ kind: 'overwatch', value: here + ctx.w.overwatch });
  }

  for (const [key, cost] of moveRange(state, unit).tiles) {
    const to = keyPos(key);
    const ap = apCostForSteps(unit, cost);
    if (ap > unit.ap) continue;
    const shotThere = unit.ap - ap >= 1 ? bestShot(ctx, to) : null;
    choices.push({ kind: 'move', to, value: positionValue(ctx, to) + (shotThere?.value ?? 0) - ctx.w.apSpend * ap });
  }

  // Open a closed hatch that leads toward the squad.
  if (ctx.w.approach > 0) {
    for (const n of neighbors(state, unit.pos)) {
      const t = tileAt(state, n)!;
      if (t.type !== 'hatch' || t.hatch !== 'closed' || !isBeside(unit, n)) continue;
      const beyond = ctx.dist.get(posKey(n)) ?? UNKNOWN_DISTANCE;
      if (beyond < nearestThreat) choices.push({ kind: 'hatch', at: n, value: here + ctx.w.approach * 3 });
    }
  }
  return choices;
}

/** Plays one enemy unit's whole turn. */
export function takeTurn(state: MissionState, unit: Unit): void {
  if (unit.unitClass === 'unboundRaider' && isRetreating(state, unit) && unitsOf(state, 'player').some(isActive)) {
    state.log.push(`${unit.name} falls back.`);
  }
  for (let guard = 0; guard < 4; guard++) {
    if (!canAct(state, unit).ok) return;
    const choices = scoreOptions(state, unit);
    let best = choices[0];
    for (const c of choices) if (c.value > best.value + 1e-9) best = c;
    switch (best.kind) {
      case 'hold':
        unit.ap = 0;
        return;
      case 'shoot':
        shoot(state, unit.id, best.target.id);
        return;
      case 'overwatch':
        setOverwatch(state, unit.id);
        return;
      case 'move':
        if (!moveUnit(state, unit.id, best.to).ok) return;
        break;
      case 'hatch':
        if (!toggleHatch(state, unit.id, best.at).ok) return;
        break;
    }
  }
}

/** Simulator only: a corpsman bot walks to a downed ally and revives them if it can this turn. */
function botStabilize(state: MissionState, u: Unit): void {
  if (!u.abilities.includes('stabilize') || !unitsOf(state, 'player').some((a) => a.downed)) return;
  const tryUse = (): boolean => {
    const t = abilityTargets(state, u, 'stabilize');
    return t.length > 0 && abilityReady(state, u, 'stabilize').ok && useAbility(state, u.id, 'stabilize', t[0]).ok;
  };
  if (tryUse()) return;
  const downed = unitsOf(state, 'player').filter((a) => a.downed);
  const spots = [...moveRange(state, u).tiles]
    .map(([k, cost]) => ({ p: keyPos(k), cost }))
    .filter(({ p, cost }) => apCostForSteps(u, cost) <= u.ap - 1 && downed.some((d) => chebyshev(d.pos, p) === 1))
    .sort((a, b) => a.cost - b.cost);
  if (spots.length > 0 && moveUnit(state, u.id, spots[0].p).ok) tryUse();
}

/** Simulator only: the squad bot plays the player phase. */
export function runSquadBot(state: MissionState): void {
  for (const u of unitsOf(state, 'player')) {
    if (state.outcome !== 'ongoing') return;
    if (!isActive(u)) continue;
    botStabilize(state, u);
    takeTurn(state, u);
  }
}

/** All enemies act in order: Concordat first (they set up), then Unbound. */
export function runEnemyAi(state: MissionState): void {
  const order = [...unitsOf(state, 'concordat'), ...unitsOf(state, 'unbound')];
  for (const u of order) {
    if (state.outcome !== 'ongoing') return;
    if (isActive(u)) takeTurn(state, u);
  }
}
