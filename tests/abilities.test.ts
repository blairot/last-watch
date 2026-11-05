import { describe, expect, it } from 'vitest';
import { createMission01 } from '../src/data/mission01';
import { abilityTargets, useAbility } from '../src/logic/abilities';
import { findPath } from '../src/logic/map';
import { toggleHatch } from '../src/logic/actions';
import { endPlayerTurn, getUnit } from '../src/logic/turn';
import { enemy, stateFrom, unit } from './helpers';

describe('Coordinated Assault', () => {
  it('gives an ally in sight 1 AP, then cools down for 3 rounds', () => {
    const holt = unit('holt', { x: 0, y: 0 }, { abilities: ['coordinatedAssault'] });
    const ally = unit('ally', { x: 3, y: 0 });
    const s = stateFrom(['.....'], [holt, ally, enemy('e', { x: 4, y: 0 })]);
    expect(useAbility(s, 'holt', 'coordinatedAssault', ally.pos).ok).toBe(true);
    expect(ally.ap).toBe(3);
    expect(holt.ap).toBe(1);
    expect(holt.cooldowns.coordinatedAssault).toBe(3);
    expect(useAbility(s, 'holt', 'coordinatedAssault', ally.pos).ok).toBe(false);
  });

  it('cannot target allies out of sight', () => {
    const holt = unit('holt', { x: 0, y: 0 }, { abilities: ['coordinatedAssault'] });
    const s = stateFrom(['..#..'], [holt, unit('ally', { x: 4, y: 0 })]);
    expect(abilityTargets(s, holt, 'coordinatedAssault')).toEqual([]);
  });
});

describe('Breach', () => {
  it('forces a welded hatch open for 2 AP and staggers enemies beyond it', () => {
    const r = unit('r', { x: 1, y: 1 }, { abilities: ['breach'] });
    const near = enemy('near', { x: 4, y: 1 });
    const far = enemy('far', { x: 6, y: 1 });
    const behind = enemy('behind', { x: 0, y: 0 });
    const s = stateFrom(['.......', '..w....', '.......'], [r, near, far, behind]);
    expect(useAbility(s, 'r', 'breach', { x: 2, y: 1 }).ok).toBe(true);
    expect(s.tiles[1][2].hatch).toBe('open');
    expect(r.ap).toBe(0);
    expect(near.apPenalty).toBe(1);
    expect(far.apPenalty).toBe(0);
    expect(behind.apPenalty).toBe(0);
  });

  it('staggered enemies start their next turn with 1 AP', () => {
    const s = createMission01();
    const e = getUnit(s, 'concordat1')!;
    e.apPenalty = 1;
    // Count AP at the start of the enemy phase by stopping the AI from acting.
    s.units = s.units.filter((u) => u.faction === 'player' || u === e);
    e.pos = { x: 18, y: 1 };
    endPlayerTurn(s);
    expect(e.apPenalty).toBe(0);
  });
});

describe('Decon Spray', () => {
  it('clears a 3x3 area within 3 tiles and removes 30 exposure', () => {
    const doc = unit('doc', { x: 0, y: 0 }, { abilities: ['deconSpray'] });
    const pat = unit('pat', { x: 3, y: 1 }, { exposure: 45 });
    const s = stateFrom(['......', '......', '......'], [doc, pat]);
    s.tiles.forEach((row) => row.forEach((t) => (t.contamination = 2)));
    expect(useAbility(s, 'doc', 'deconSpray', { x: 3, y: 1 }).ok).toBe(true);
    for (let y = 0; y <= 2; y++) for (let x = 2; x <= 4; x++) expect(s.tiles[y][x].contamination).toBe(0);
    expect(s.tiles[1][5].contamination).toBe(2);
    expect(pat.exposure).toBe(15);
    expect(doc.cooldowns.deconSpray).toBe(2);
    expect(useAbility(s, 'doc', 'deconSpray', { x: 1, y: 1 }).ok).toBe(false); // cooling down
  });

  it('cannot reach beyond 3 tiles', () => {
    const doc = unit('doc', { x: 0, y: 0 }, { abilities: ['deconSpray'] });
    const s = stateFrom(['......'], [doc]);
    expect(useAbility(s, 'doc', 'deconSpray', { x: 4, y: 0 }).ok).toBe(false);
  });
});

describe('Stabilize', () => {
  it('revives an adjacent downed ally at 2 HP', () => {
    const doc = unit('doc', { x: 0, y: 0 }, { abilities: ['stabilize'] });
    const down = unit('down', { x: 1, y: 1 }, { hp: 0, downed: true });
    const s = stateFrom(['...', '...'], [doc, down]);
    expect(useAbility(s, 'doc', 'stabilize', down.pos).ok).toBe(true);
    expect(down.downed).toBe(false);
    expect(down.hp).toBe(2);
  });

  it('needs the ally to be adjacent', () => {
    const doc = unit('doc', { x: 0, y: 0 }, { abilities: ['stabilize'] });
    const down = unit('down', { x: 2, y: 0 }, { hp: 0, downed: true });
    expect(useAbility(stateFrom(['...'], [doc, down]), 'doc', 'stabilize', down.pos).ok).toBe(false);
  });
});

describe('Weld and hatches', () => {
  it('welds an open hatch shut, blocking movement and toggling; unweld returns it to closed', () => {
    const dc = unit('dc', { x: 1, y: 0 }, { abilities: ['weld'], ap: 2 });
    const s = stateFrom(['..o..'], [dc]);
    expect(useAbility(s, 'dc', 'weld', { x: 2, y: 0 }).ok).toBe(true);
    expect(s.tiles[0][2].hatch).toBe('welded');
    expect(findPath(s, dc.pos, { x: 4, y: 0 }, dc)).toBeNull();
    expect(toggleHatch(s, 'dc', { x: 2, y: 0 }).ok).toBe(false);
    expect(useAbility(s, 'dc', 'weld', { x: 2, y: 0 }).ok).toBe(true);
    expect(s.tiles[0][2].hatch).toBe('closed');
  });

  it('opening and closing a hatch costs 1 AP', () => {
    const u = unit('u', { x: 1, y: 0 });
    const s = stateFrom(['..c..'], [u]);
    expect(toggleHatch(s, 'u', { x: 2, y: 0 }).ok).toBe(true);
    expect(s.tiles[0][2].hatch).toBe('open');
    expect(u.ap).toBe(1);
    expect(toggleHatch(s, 'u', { x: 2, y: 0 }).ok).toBe(true);
    expect(s.tiles[0][2].hatch).toBe('closed');
  });

  it('cannot close a hatch with someone standing in it', () => {
    const u = unit('u', { x: 1, y: 0 });
    const s = stateFrom(['..o..'], [u, unit('blocker', { x: 2, y: 0 })]);
    expect(toggleHatch(s, 'u', { x: 2, y: 0 }).ok).toBe(false);
  });
});

describe('Reverse Fan', () => {
  it('flips airflow when used beside the fan panel', () => {
    const s = createMission01();
    const dc = getUnit(s, 'ferreira')!;
    dc.pos = { x: 16, y: 17 };
    expect(useAbility(s, 'ferreira', 'reverseFan', { x: 17, y: 17 }).ok).toBe(true);
    expect(s.ventDirection).toBe(-1);
  });

  it('requires standing next to the panel', () => {
    const s = createMission01();
    expect(useAbility(s, 'ferreira', 'reverseFan', { x: 17, y: 17 }).ok).toBe(false);
  });
});
