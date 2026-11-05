import { describe, expect, it } from 'vitest';
import { moveUnit, setOverwatch, shoot } from '../src/logic/actions';
import {
  coverFrom, expectedDamage, grazeDamage, hitChance, isFlanked, previewShot, resolveShot,
} from '../src/logic/combat';
import { hasLineOfSight, lineBetween } from '../src/logic/map';
import { enemy, stateFrom, unit } from './helpers';

describe('line of sight', () => {
  const open = ['.......', '.......', '.......'];

  it('is clear across open floor and symmetric', () => {
    const s = stateFrom(open);
    expect(hasLineOfSight(s, { x: 0, y: 0 }, { x: 6, y: 2 })).toBe(true);
    expect(hasLineOfSight(s, { x: 6, y: 2 }, { x: 0, y: 0 })).toBe(true);
  });

  it('is blocked by bulkheads and shut hatches but not by cover or units', () => {
    expect(hasLineOfSight(stateFrom(['..#..']), { x: 0, y: 0 }, { x: 4, y: 0 })).toBe(false);
    expect(hasLineOfSight(stateFrom(['..c..']), { x: 0, y: 0 }, { x: 4, y: 0 })).toBe(false);
    expect(hasLineOfSight(stateFrom(['..w..']), { x: 0, y: 0 }, { x: 4, y: 0 })).toBe(false);
    expect(hasLineOfSight(stateFrom(['..o..']), { x: 0, y: 0 }, { x: 4, y: 0 })).toBe(true);
    expect(hasLineOfSight(stateFrom(['..F..']), { x: 0, y: 0 }, { x: 4, y: 0 })).toBe(true);
    expect(hasLineOfSight(stateFrom(['..h..'], [unit('u', { x: 1, y: 0 })]), { x: 0, y: 0 }, { x: 4, y: 0 })).toBe(true);
  });

  it('lineBetween excludes both endpoints', () => {
    expect(lineBetween({ x: 0, y: 0 }, { x: 3, y: 0 })).toEqual([{ x: 1, y: 0 }, { x: 2, y: 0 }]);
    expect(lineBetween({ x: 0, y: 0 }, { x: 1, y: 1 })).toEqual([]);
  });

  it('cannot see around a corner through a bulkhead', () => {
    const s = stateFrom([
      '...',
      '.##',
      '.#.',
    ]);
    expect(hasLineOfSight(s, { x: 0, y: 2 }, { x: 2, y: 2 })).toBe(false);
  });
});

describe('cover and flanking', () => {
  // Target at (2,1) with half cover to its east (3,1) and full cover to its north (2,0).
  const s = stateFrom([
    '..F....',
    '...h...',
    '.......',
  ]);
  const target = { x: 2, y: 1 };

  it('uses cover on the side facing the shooter', () => {
    expect(coverFrom(s, target, { x: 6, y: 1 })).toBe('half');
    expect(coverFrom(s, target, { x: 2, y: -4 })).toBe('full');
  });

  it('takes the best facing cover when the shooter is diagonal', () => {
    // Shooter north-east: both the north (full) and east (half) cover face it.
    expect(coverFrom(s, target, { x: 6, y: -3 })).toBe('full');
  });

  it('is flanked when no cover lies toward the shooter', () => {
    expect(isFlanked(s, target, { x: 0, y: 1 })).toBe(true); // from the west
    expect(isFlanked(s, target, { x: 2, y: 2 })).toBe(true); // from the south
    expect(isFlanked(s, target, { x: 6, y: 1 })).toBe(false);
  });

  it('counts consoles and fan panels as half cover', () => {
    expect(coverFrom(stateFrom(['.K.']), { x: 0, y: 0 }, { x: 2, y: 0 })).toBe('half');
    expect(coverFrom(stateFrom(['.P.']), { x: 0, y: 0 }, { x: 2, y: 0 })).toBe('half');
  });
});

describe('hit chance', () => {
  it('uses Aim up to 6 tiles, then drops 2% per tile', () => {
    expect(hitChance(75, 1)).toBe(75);
    expect(hitChance(75, 6)).toBe(75);
    expect(hitChance(75, 7)).toBe(73);
    expect(hitChance(75, 16)).toBe(55);
  });

  it('is clamped between 10% and 95%', () => {
    expect(hitChance(120, 1)).toBe(95);
    expect(hitChance(20, 30)).toBe(10);
  });

  it('applies exposure and infection aim penalties', () => {
    const s = stateFrom(['.....']);
    const t = enemy('t', { x: 4, y: 0 });
    expect(previewShot(s, unit('a', { x: 0, y: 0 }, { aim: 80, exposure: 50 }), t).hitChance).toBe(70);
    expect(previewShot(s, unit('a', { x: 0, y: 0 }, { aim: 80, exposure: 100, infected: true }), t).hitChance).toBe(60);
  });
});

describe('graze model', () => {
  it('grazes for half damage rounded down, minimum 1', () => {
    expect(grazeDamage(5)).toBe(2);
    expect(grazeDamage(4)).toBe(2);
    expect(grazeDamage(3)).toBe(1);
    expect(grazeDamage(1)).toBe(1);
  });

  it('previews 40% graze for half cover, 70% for full, 0 when flanked', () => {
    const s = stateFrom(['...h.F.', '.......']);
    const shooter = unit('a', { x: 0, y: 0 });
    expect(previewShot(s, shooter, enemy('t', { x: 4, y: 0 }), { x: 6, y: 0 }).grazeChance).toBe(70);
    expect(previewShot(s, shooter, enemy('t', { x: 4, y: 0 })).grazeChance).toBe(40);
    const flanked = previewShot(s, shooter, enemy('t', { x: 4, y: 1 }));
    expect(flanked.flanked).toBe(true);
    expect(flanked.grazeChance).toBe(0);
  });

  it('expected damage blends hit, graze, and miss', () => {
    const s = stateFrom(['..h....']);
    const p = previewShot(s, unit('a', { x: 0, y: 0 }, { aim: 80, damage: [3, 5] }), enemy('t', { x: 1, y: 0 }));
    // Target at (1,0), cover at (2,0) faces away from the shooter: flanked.
    expect(p.flanked).toBe(true);
    expect(expectedDamage(p)).toBeCloseTo(0.8 * 4);
  });

  it('resolved outcomes match the preview over many seeded shots', () => {
    let hits = 0;
    let grazes = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const target = enemy('t', { x: 4, y: 0 }, { hp: 99, maxHp: 99 });
      const shooter = unit('a', { x: 0, y: 0 }, { aim: 70 });
      const s = stateFrom(['...h.'], [shooter, target], { rngState: i * 7919 + 1 });
      // Target at (4,0) has half cover at (3,0) toward the shooter.
      const r = resolveShot(s, shooter, target);
      if (r.outcome !== 'miss') hits++;
      if (r.outcome === 'graze') {
        grazes++;
        expect(r.damage).toBeGreaterThanOrEqual(1);
        expect(r.damage).toBeLessThanOrEqual(2);
      }
      if (r.outcome === 'hit') {
        expect(r.damage).toBeGreaterThanOrEqual(3);
        expect(r.damage).toBeLessThanOrEqual(5);
      }
    }
    expect(hits / n).toBeGreaterThan(0.66);
    expect(hits / n).toBeLessThan(0.74);
    expect(grazes / hits).toBeGreaterThan(0.36);
    expect(grazes / hits).toBeLessThan(0.44);
  });

  it('is deterministic for the same RNG state', () => {
    const run = () => {
      const a = unit('a', { x: 0, y: 0 });
      const t = enemy('t', { x: 3, y: 0 });
      const s = stateFrom(['.....'], [a, t], { rngState: 1234 });
      return resolveShot(s, a, t);
    };
    expect(run()).toEqual(run());
  });
});

describe('shooting and downed units', () => {
  it('costs 1 AP and ends the turn', () => {
    const a = unit('a', { x: 0, y: 0 });
    const t = enemy('t', { x: 3, y: 0 });
    const s = stateFrom(['.....'], [a, t]);
    expect(shoot(s, 'a', 't').ok).toBe(true);
    expect(a.ap).toBe(0);
    expect(a.turnEnded).toBe(true);
    expect(shoot(s, 'a', 't').ok).toBe(false);
  });

  it('needs line of sight and a hostile, active target', () => {
    const a = unit('a', { x: 0, y: 0 });
    const s = stateFrom(['..#..'], [a, enemy('t', { x: 4, y: 0 }), unit('ally', { x: 1, y: 0 })]);
    expect(shoot(s, 'a', 't').ok).toBe(false);
    expect(shoot(s, 'a', 'ally').ok).toBe(false);
  });

  it('downs player units at 0 HP and kills enemies', () => {
    const a = unit('a', { x: 0, y: 0 }, { hp: 1 });
    const b = unit('b', { x: 0, y: 1 });
    const e = enemy('e', { x: 3, y: 0 }, { hp: 1, aim: 95 });
    const e2 = enemy('e2', { x: 3, y: 1 }, { aim: 95 });
    const s = stateFrom(['.....', '.....'], [a, b, e, e2], { phase: 'enemy' });
    // Find a seed that hits.
    for (let seed = 1; a.hp > 0; seed++) {
      s.rngState = seed;
      resolveShot(s, e, a);
    }
    expect(a.downed).toBe(true);
    s.phase = 'player';
    for (let seed = 1; e.hp > 0; seed++) {
      s.rngState = seed;
      resolveShot(s, b, e);
    }
    expect(e.downed).toBe(false);
    expect(e.hp).toBe(0);
  });
});

describe('overwatch', () => {
  it('costs 2 AP and fires at the first hostile that moves in sight', () => {
    const watcher = unit('w', { x: 1, y: 0 }, { aim: 95 });
    const mover = enemy('m', { x: 6, y: 2 });
    const s = stateFrom(['#......', '#......', '#......'], [watcher, mover]);
    expect(setOverwatch(s, 'w').ok).toBe(true);
    expect(watcher.ap).toBe(0);
    s.phase = 'enemy';
    s.fx = [];
    moveUnit(s, 'm', { x: 4, y: 2 });
    expect(watcher.overwatch).toBe(false);
    expect(s.fx.some((f) => f.kind === 'shot' && f.reaction)).toBe(true);
    // The walk is split so the shot plays mid-move.
    expect(s.fx[0].kind).toBe('move');
  });

  it('does not fire at units out of sight', () => {
    const watcher = unit('w', { x: 0, y: 0 });
    const mover = enemy('m', { x: 4, y: 2 });
    const s = stateFrom(['...#.', '...#.', '...#.'], [watcher, mover]);
    setOverwatch(s, 'w');
    s.phase = 'enemy';
    moveUnit(s, 'm', { x: 4, y: 0 });
    expect(watcher.overwatch).toBe(true);
  });

  it('needs a full 2 AP', () => {
    const watcher = unit('w', { x: 0, y: 0 }, { ap: 1 });
    expect(setOverwatch(stateFrom(['...'], [watcher]), 'w').ok).toBe(false);
  });
});
