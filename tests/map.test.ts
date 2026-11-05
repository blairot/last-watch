import { describe, expect, it } from 'vitest';
import { createMission01, MISSION01_LAYOUT } from '../src/data/mission01';
import { findPath, isPassable, manhattan, posKey, reachableTiles } from '../src/logic/map';
import type { Pos } from '../src/logic/types';
import { stateFrom, unit } from './helpers';

function assertContiguous(from: Pos, path: Pos[]): void {
  let prev = from;
  for (const p of path) {
    expect(manhattan(prev, p)).toBe(1);
    prev = p;
  }
}

describe('findPath', () => {
  it('finds a straight path on open floor', () => {
    const s = stateFrom(['.....', '.....', '.....']);
    const r = findPath(s, { x: 0, y: 1 }, { x: 4, y: 1 });
    expect(r?.path).toHaveLength(4);
    expect(r?.path.at(-1)).toEqual({ x: 4, y: 1 });
  });

  it('returns an empty path when start equals goal', () => {
    const s = stateFrom(['...']);
    expect(findPath(s, { x: 1, y: 0 }, { x: 1, y: 0 })).toEqual({ path: [], cost: 0 });
  });

  it('routes around bulkheads with the shortest detour', () => {
    const s = stateFrom([
      '.....',
      '.###.',
      '.....',
    ]);
    const from = { x: 0, y: 1 };
    const r = findPath(s, from, { x: 4, y: 1 })!;
    expect(r.path).toHaveLength(6);
    assertContiguous(from, r.path);
    for (const p of r.path) expect(s.tiles[p.y][p.x].type).not.toBe('bulkhead');
  });

  it('passes through open hatches but not closed or welded ones', () => {
    const open = stateFrom(['..o..']);
    expect(findPath(open, { x: 0, y: 0 }, { x: 4, y: 0 })?.path).toHaveLength(4);
    expect(findPath(stateFrom(['..c..']), { x: 0, y: 0 }, { x: 4, y: 0 })).toBeNull();
    expect(findPath(stateFrom(['..w..']), { x: 0, y: 0 }, { x: 4, y: 0 })).toBeNull();
  });

  it('treats cover, consoles, and fan panels as impassable', () => {
    for (const ch of ['h', 'F', 'K', 'P']) {
      expect(findPath(stateFrom([`..${ch}..`]), { x: 0, y: 0 }, { x: 4, y: 0 })).toBeNull();
    }
  });

  it('cannot end on or walk through another unit, but routes around it', () => {
    const blocker = unit('b', { x: 2, y: 0 });
    const s = stateFrom(['.....', '.....'], [blocker]);
    expect(findPath(s, { x: 0, y: 0 }, { x: 2, y: 0 })).toBeNull();
    const r = findPath(s, { x: 0, y: 0 }, { x: 4, y: 0 })!;
    expect(r.path).toHaveLength(6);
    expect(r.path.some((p) => p.x === 2 && p.y === 0)).toBe(false);
  });

  it('lets the mover path from its own tile', () => {
    const mover = unit('m', { x: 0, y: 0 });
    const s = stateFrom(['...'], [mover]);
    expect(isPassable(s, { x: 0, y: 0 }, mover)).toBe(true);
    expect(findPath(s, { x: 0, y: 0 }, { x: 2, y: 0 }, mover)?.path).toHaveLength(2);
  });

  it('avoids extra-cost tiles when a cheaper route exists', () => {
    const s = stateFrom(['.....', '.....', '.....']);
    const costly = new Set(['1,1', '2,1', '3,1']);
    const r = findPath(s, { x: 0, y: 1 }, { x: 4, y: 1 }, undefined, {
      extraCost: (p) => (costly.has(posKey(p)) ? 10 : 0),
    })!;
    expect(r.path.some((p) => costly.has(posKey(p)))).toBe(false);
    expect(r.cost).toBe(r.path.length);
  });

  it('matches breadth-first distance on the mission map', () => {
    const s = createMission01();
    const holt = s.units.find((u) => u.id === 'holt')!;
    const range = reachableTiles(s, holt, 40);
    for (const target of [{ x: 8, y: 1 }, { x: 15, y: 7 }, { x: 17, y: 16 }, { x: 1, y: 7 }]) {
      const r = findPath(s, holt.pos, target, holt)!;
      expect(r, `path to ${posKey(target)}`).not.toBeNull();
      assertContiguous(holt.pos, r.path);
      expect(r.path.length).toBe(range.get(posKey(target)));
    }
  });
});

describe('reachableTiles', () => {
  it('limits the flood to maxSteps and excludes the start', () => {
    const u = unit('u', { x: 2, y: 2 });
    const s = stateFrom(['.....', '.....', '.....', '.....', '.....'], [u]);
    const r = reachableTiles(s, u, 1);
    expect(r.size).toBe(4);
    expect(r.has('2,2')).toBe(false);
  });

  it('does not cross closed hatches', () => {
    const u = unit('u', { x: 0, y: 0 });
    const s = stateFrom(['.c...'], [u]);
    expect(reachableTiles(s, u, 10).size).toBe(0);
  });
});

describe('mission 01 data', () => {
  it('is a 20 by 20 map with every required tile type', () => {
    expect(MISSION01_LAYOUT).toHaveLength(20);
    for (const row of MISSION01_LAYOUT) expect(row).toHaveLength(20);
    const s = createMission01();
    const types = new Set(s.tiles.flat().map((t) => t.type));
    for (const t of ['floor', 'bulkhead', 'hatch', 'halfCover', 'fullCover', 'vent', 'decon', 'console', 'fanPanel', 'entry']) {
      expect(types.has(t as never), t).toBe(true);
    }
  });

  it('puts every unit on a walkable, unshared tile, with the squad on entry tiles', () => {
    const s = createMission01();
    const seen = new Set<string>();
    for (const u of s.units) {
      const t = s.tiles[u.pos.y][u.pos.x];
      expect(['floor', 'vent', 'decon', 'entry'], u.id).toContain(t.type);
      expect(seen.has(posKey(u.pos)), u.id).toBe(false);
      seen.add(posKey(u.pos));
      if (u.faction === 'player') expect(t.type).toBe('entry');
    }
  });

  it('places vents on vent tiles and starts the sickbay at severe contamination', () => {
    const s = createMission01();
    for (const v of s.vents) expect(s.tiles[v.y][v.x].type).toBe('vent');
    expect(s.tiles[3][3].contamination).toBe(3);
    expect(s.tiles[s.consolePos.y][s.consolePos.x].type).toBe('console');
  });

  it('lets the squad reach a tile next to the console', () => {
    const s = createMission01();
    const holt = s.units.find((u) => u.id === 'holt')!;
    // Ignore enemies for this reachability check.
    s.units = [holt];
    const c = s.consolePos;
    const adjacent = [{ x: c.x - 1, y: c.y }, { x: c.x + 1, y: c.y }, { x: c.x, y: c.y - 1 }, { x: c.x, y: c.y + 1 }];
    expect(adjacent.some((p) => findPath(s, holt.pos, p, holt) !== null)).toBe(true);
  });
});
