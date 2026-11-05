import { describe, expect, it } from 'vitest';
import { createMission01 } from '../src/data/mission01';
import { moveRange, planMove, toggleHatch } from '../src/logic/actions';
import {
  applyEndOfTurnExposure, applyInfectionDamage, exposureGain, projectExposure, spreadContamination,
} from '../src/logic/contamination';
import type { ContaminationLevel, MissionState } from '../src/logic/types';
import { effectiveMove } from '../src/logic/units';
import { raider, stateFrom, unit } from './helpers';

const levels = (s: MissionState): number[][] => s.tiles.map((r) => r.map((t) => t.contamination));
const setLevel = (s: MissionState, x: number, y: number, l: ContaminationLevel) => { s.tiles[y][x].contamination = l; };

describe('exposure', () => {
  it('gains 5/15/30 per level, multiplied by gear', () => {
    expect([0, 1, 2, 3].map((l) => exposureGain(l as ContaminationLevel, 'none'))).toEqual([0, 5, 15, 30]);
    expect([1, 2, 3].map((l) => exposureGain(l as ContaminationLevel, 'respirator'))).toEqual([3, 9, 18]);
    expect([1, 2, 3].map((l) => exposureGain(l as ContaminationLevel, 'mopp'))).toEqual([1, 3, 6]);
  });

  it('applies to units ending their turn on contaminated tiles, by side', () => {
    const p = unit('p', { x: 0, y: 0 }, { gear: 'respirator' });
    const e = raider('e', { x: 1, y: 0 });
    const s = stateFrom(['...'], [p, e]);
    setLevel(s, 0, 0, 3);
    setLevel(s, 1, 0, 2);
    applyEndOfTurnExposure(s, 'player');
    expect(p.exposure).toBe(18);
    expect(e.exposure).toBe(0);
    applyEndOfTurnExposure(s, 'enemy');
    expect(e.exposure).toBe(15);
  });

  it('infects at 100: -20 Aim, -1 Move, -1 HP per round, and it sticks', () => {
    const u = unit('u', { x: 0, y: 0 }, { exposure: 90 });
    const s = stateFrom(['...'], [u, unit('other', { x: 2, y: 0 })]);
    setLevel(s, 0, 0, 3);
    applyEndOfTurnExposure(s, 'player');
    expect(u.exposure).toBe(100);
    expect(u.infected).toBe(true);
    expect(effectiveMove(u)).toBe(4);
    applyInfectionDamage(s);
    expect(u.hp).toBe(9);
  });

  it('decon station removes 25 exposure at end of turn', () => {
    const u = unit('u', { x: 0, y: 0 }, { exposure: 40 });
    const s = stateFrom(['+..'], [u]);
    expect(projectExposure(s, u, u.pos).net).toBe(-25);
    applyEndOfTurnExposure(s, 'player');
    expect(u.exposure).toBe(15);
  });
});

describe('spread', () => {
  it('raises open neighbours by 1, to one below the source, without cascading', () => {
    const s = stateFrom(['.....']);
    setLevel(s, 0, 0, 3);
    spreadContamination(s);
    expect(levels(s)[0]).toEqual([3, 1, 0, 0, 0]);
    spreadContamination(s);
    expect(levels(s)[0]).toEqual([3, 2, 0, 0, 0]);
    spreadContamination(s);
    expect(levels(s)[0]).toEqual([3, 2, 1, 0, 0]);
    for (let i = 0; i < 5; i++) spreadContamination(s);
    expect(levels(s)[0]).toEqual([3, 2, 1, 0, 0]);
  });

  it('level 1 tiles do not spread', () => {
    const s = stateFrom(['...']);
    setLevel(s, 0, 0, 1);
    spreadContamination(s);
    expect(levels(s)[0]).toEqual([1, 0, 0]);
  });

  it('passes open hatches but not closed or welded ones, or bulkheads', () => {
    for (const [mid, expected] of [['o', 1], ['c', 0], ['w', 0], ['#', 0]] as const) {
      const s = stateFrom([`3${mid}.`.replace('3', '.')]);
      setLevel(s, 0, 0, 3);
      for (let i = 0; i < 3; i++) spreadContamination(s);
      // Through an open hatch: hatch 1 then 2, then the far tile reaches 1. Shut hatches stop it all.
      expect(s.tiles[0][2].contamination, mid).toBe(expected);
    }
  });

  it('closing a hatch stops spread that was flowing through it', () => {
    const u = unit('u', { x: 2, y: 1 });
    const s = stateFrom(['..o..', '.....'], [u]);
    setLevel(s, 0, 0, 3);
    setLevel(s, 1, 0, 2);
    expect(toggleHatch(s, 'u', { x: 2, y: 0 }).ok).toBe(true);
    for (let i = 0; i < 5; i++) spreadContamination(s);
    expect(s.tiles[0][3].contamination).toBe(0);
  });
});

describe('vents', () => {
  const ventState = () => {
    const s = stateFrom(['v.v.v.v'], [], {
      vents: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 4, y: 0 }, { x: 6, y: 0 }],
    });
    return s;
  };

  it('a vent at 2+ raises the next vent downstream by 1 each round', () => {
    const s = ventState();
    setLevel(s, 0, 0, 3);
    spreadContamination(s);
    expect(s.tiles[0][2].contamination).toBe(1);
    spreadContamination(s);
    expect(s.tiles[0][2].contamination).toBe(2);
    expect(s.tiles[0][4].contamination).toBe(0); // vent 2 was only 1 at the snapshot
    spreadContamination(s);
    expect(s.tiles[0][4].contamination).toBe(1);
  });

  it('Reverse Fan direction sends air the other way', () => {
    const s = ventState();
    s.ventDirection = -1;
    setLevel(s, 6, 0, 3);
    spreadContamination(s);
    expect(s.tiles[0][4].contamination).toBe(1);
    expect(s.tiles[0][0].contamination).toBe(0);
  });

  it('vents can reach level 3 even though floor spread cannot', () => {
    const s = ventState();
    setLevel(s, 0, 0, 3);
    for (let i = 0; i < 3; i++) spreadContamination(s);
    expect(s.tiles[0][2].contamination).toBe(3);
  });
});

describe('mission 01 contamination', () => {
  it('the ruptured sickbay leaks into the passageway through its open hatch', () => {
    const s = createMission01();
    spreadContamination(s);
    expect(s.tiles[3][6].contamination).toBeGreaterThan(0); // the hatch itself
  });

  it('with the fans reversed, the engine room vents fill over a few rounds', () => {
    const s = createMission01();
    s.ventDirection = -1;
    for (let i = 0; i < 6; i++) spreadContamination(s);
    expect(s.tiles[2][11].contamination).toBe(3); // first engine vent
    expect(s.tiles[4][17].contamination).toBeGreaterThan(0); // the vent beside the console
  });
});

describe('Unbound avoid contamination when moving', () => {
  it('pays extra movement for contaminated tiles and paths around them', () => {
    const r = raider('r', { x: 0, y: 1 });
    const s = stateFrom(['.....', '.....', '.....'], [r], { phase: 'enemy' });
    setLevel(s, 1, 1, 2);
    setLevel(s, 2, 1, 2);
    setLevel(s, 3, 1, 2);
    const plan = planMove(s, r, { x: 4, y: 1 });
    expect(plan.ok).toBe(true);
    if (plan.ok) expect(plan.path.some((p) => p.y === 1 && p.x > 0 && p.x < 4)).toBe(false);
    // A player unit walks straight through.
    const p = unit('p', { x: 0, y: 1 });
    const s2 = stateFrom(['.....', '.....', '.....'], [p]);
    for (const x of [1, 2, 3]) setLevel(s2, x, 1, 2);
    expect(moveRange(s2, p).tiles.get('4,1')).toBe(4);
    // Straight through costs 1+4 per level-2 tile (10); around the top row costs 8.
    expect(moveRange(s, r).tiles.get('2,1')).toBe(8);
  });
});
