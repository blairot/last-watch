import { describe, expect, it } from 'vitest';
import { createMission01 } from '../src/data/mission01';
import { Rng } from '../src/logic/rng';
import { apCostForSteps, endPlayerTurn, getUnit, maxMoveCost, moveRange, moveUnit, planMove } from '../src/logic/turn';

const fresh = () => {
  const s = createMission01();
  // Holt starts at (2,16) in the boarding compartment.
  return { s, holt: getUnit(s, 'holt')! };
};

describe('apCostForSteps', () => {
  it('charges 1 AP up to Move tiles and 2 AP up to twice Move', () => {
    const { holt } = fresh();
    expect(apCostForSteps(holt, 0)).toBe(0);
    expect(apCostForSteps(holt, 1)).toBe(1);
    expect(apCostForSteps(holt, 5)).toBe(1);
    expect(apCostForSteps(holt, 6)).toBe(2);
    expect(apCostForSteps(holt, 10)).toBe(2);
    expect(apCostForSteps(holt, 11)).toBe(Infinity);
  });
});

describe('moveUnit', () => {
  it('spends 1 AP for a short move and updates position', () => {
    const { s, holt } = fresh();
    const r = moveUnit(s, 'holt', { x: 4, y: 14 });
    expect(r.ok).toBe(true);
    expect(holt.pos).toEqual({ x: 4, y: 14 });
    expect(holt.ap).toBe(1);
  });

  it('spends 2 AP for a long move', () => {
    const { s, holt } = fresh();
    // (2,16) -> (7,13): around the crate, out via the boarding hatch at (6,15), 10 steps.
    const r = moveUnit(s, 'holt', { x: 7, y: 13 });
    expect(r.ok && r.apCost).toBe(2);
    expect(holt.ap).toBe(0);
  });

  it('allows a second 1 AP move, then refuses a third', () => {
    const { s, holt } = fresh();
    expect(moveUnit(s, 'holt', { x: 4, y: 14 }).ok).toBe(true);
    expect(moveUnit(s, 'holt', { x: 7, y: 15 }).ok).toBe(true);
    expect(holt.ap).toBe(0);
    const third = moveUnit(s, 'holt', { x: 7, y: 13 });
    expect(third.ok).toBe(false);
    expect(holt.pos).toEqual({ x: 7, y: 15 });
  });

  it('refuses a 2 AP move when only 1 AP remains', () => {
    const { s, holt } = fresh();
    holt.ap = 1;
    const plan = planMove(s, holt, { x: 7, y: 13 });
    expect(plan.ok).toBe(false);
    expect(holt.ap).toBe(1);
  });

  it('refuses unreachable tiles, occupied tiles, and moves after the turn ended', () => {
    const { s, holt } = fresh();
    expect(moveUnit(s, 'holt', { x: 0, y: 0 }).ok).toBe(false); // bulkhead
    expect(moveUnit(s, 'holt', { x: 3, y: 16 }).ok).toBe(false); // Abernathy is there
    holt.turnEnded = true;
    expect(moveUnit(s, 'holt', { x: 4, y: 14 }).ok).toBe(false);
    expect(holt.ap).toBe(2);
  });

  it('does not let downed units move', () => {
    const { s, holt } = fresh();
    holt.downed = true;
    holt.hp = 0;
    expect(moveUnit(s, 'holt', { x: 4, y: 14 }).ok).toBe(false);
  });
});

describe('moveRange', () => {
  it('covers 2x Move with 2 AP and Move with 1 AP', () => {
    const { s, holt } = fresh();
    expect(maxMoveCost(holt)).toBe(10);
    const full = moveRange(s, holt);
    expect(Math.max(...full.tiles.values())).toBeLessThanOrEqual(10);
    holt.ap = 1;
    const half = moveRange(s, holt);
    expect(Math.max(...half.tiles.values())).toBeLessThanOrEqual(5);
    expect(half.tiles.size).toBeLessThan(full.tiles.size);
  });
});

describe('round structure', () => {
  it('runs the enemy phase, advances the round, and refreshes player AP', () => {
    const { s, holt } = fresh();
    moveUnit(s, 'holt', { x: 7, y: 13 });
    expect(holt.ap).toBe(0);
    endPlayerTurn(s);
    expect(s.round).toBe(2);
    expect(s.phase).toBe('player');
    expect(holt.ap).toBe(2);
    expect(s.log.some((l) => l.includes('Enemy phase'))).toBe(true);
  });

  it('ticks ability cooldowns down at the start of the owner turn', () => {
    const { s, holt } = fresh();
    holt.cooldowns.coordinatedAssault = 2;
    endPlayerTurn(s);
    expect(holt.cooldowns.coordinatedAssault).toBe(1);
    endPlayerTurn(s);
    expect(holt.cooldowns.coordinatedAssault).toBeUndefined();
  });
});

describe('Rng', () => {
  it('is deterministic for a given seed and stays in range', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) {
      const v = a.int(3, 5);
      expect(v).toBe(b.int(3, 5));
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(5);
    }
    expect(new Rng(1).next()).not.toBe(new Rng(2).next());
  });
});
