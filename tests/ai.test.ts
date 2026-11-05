import { describe, expect, it } from 'vitest';
import { createMission01 } from '../src/data/mission01';
import { isRetreating, scoreOptions, takeTurn } from '../src/logic/ai';
import { coverFrom } from '../src/logic/combat';
import { endPlayerTurn } from '../src/logic/turn';
import { isActive } from '../src/logic/units';
import { enemy, raider, stateFrom, unit } from './helpers';

describe('enemy AI', () => {
  it('shoots a visible target rather than holding', () => {
    const p = unit('p', { x: 0, y: 0 }, { hp: 3 });
    const e = enemy('e', { x: 4, y: 0 });
    const s = stateFrom(['.....', '.....'], [p, e], { phase: 'enemy', consolePos: { x: 4, y: 1 } });
    takeTurn(s, e);
    expect(e.turnEnded).toBe(true);
    expect(s.fx.some((f) => f.kind === 'shot' && f.shooterId === 'e')).toBe(true);
  });

  it('Concordat prefers a tile in cover over an exposed one', () => {
    // Squad member to the west; the crate at (3,1) offers half cover to tiles east and south of it.
    const p = unit('p', { x: 0, y: 1 });
    const e = enemy('e', { x: 5, y: 2 }, { aim: 10 });
    const s = stateFrom([
      '.......',
      '...h...',
      '.......',
    ], [p, e], { phase: 'enemy', consolePos: { x: 6, y: 1 } });
    const best = scoreOptions(s, e).filter((c) => c.kind === 'move').sort((a, b) => b.value - a.value)[0];
    expect(best.kind).toBe('move');
    if (best.kind === 'move') expect(coverFrom(s, best.to, p.pos)).not.toBe('none');
  });

  it('Unbound close in on the squad', () => {
    const p = unit('p', { x: 0, y: 0 });
    const r = raider('r', { x: 14, y: 0 });
    const s = stateFrom(['...............', '.#############.'], [p, r], { phase: 'enemy' });
    takeTurn(s, r);
    expect(r.pos.x).toBeLessThan(14);
  });

  it('Unbound retreat when hurt or outnumbered', () => {
    const r = raider('r', { x: 5, y: 0 }, { hp: 2 });
    const s = stateFrom(['............'], [unit('p', { x: 2, y: 0 }), r], { phase: 'enemy' });
    expect(isRetreating(s, r)).toBe(true);
    r.hp = 6;
    s.units.push(unit('p2', { x: 3, y: 0 }));
    expect(isRetreating(s, r)).toBe(true);
    s.units = s.units.filter((u) => u.id !== 'p2');
    expect(isRetreating(s, r)).toBe(false);
  });

  it('Unbound will not stop on a severely contaminated tile', () => {
    const p = unit('p', { x: 0, y: 0 });
    const r = raider('r', { x: 4, y: 2 });
    const s = stateFrom(['.....', '.....', '.....'], [p, r], { phase: 'enemy' });
    s.tiles.forEach((row) => row.forEach((t, x) => { if (x < 4) t.contamination = 3; }));
    takeTurn(s, r);
    expect(s.tiles[r.pos.y][r.pos.x].contamination).toBe(0);
  });

  it('opens a closed hatch that leads toward the squad', () => {
    const p = unit('p', { x: 0, y: 0 });
    const r = raider('r', { x: 3, y: 0 });
    const s = stateFrom(['..c..', '##.##'], [p, r], { phase: 'enemy' });
    s.tiles[1][2].type = 'bulkhead';
    takeTurn(s, r);
    expect(s.tiles[0][2].hatch).toBe('open');
  });

  it('a full enemy phase on the mission map runs without errors and keeps units in bounds', () => {
    const s = createMission01();
    for (let round = 0; round < 6 && s.outcome === 'ongoing'; round++) endPlayerTurn(s);
    for (const u of s.units) {
      expect(u.pos.x).toBeGreaterThanOrEqual(0);
      expect(u.pos.y).toBeGreaterThanOrEqual(0);
      if (isActive(u)) expect(['floor', 'vent', 'decon', 'entry', 'hatch']).toContain(s.tiles[u.pos.y][u.pos.x].type);
    }
  });
});
