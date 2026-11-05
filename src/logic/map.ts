// Map queries and pathfinding. Movement is 4-directional; each step costs 1 tile.
import type { MissionState, Pos, Tile, Unit } from './types';

export const DIRS: readonly Pos[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

export const posKey = (p: Pos): string => `${p.x},${p.y}`;
export const samePos = (a: Pos, b: Pos): boolean => a.x === b.x && a.y === b.y;
export const manhattan = (a: Pos, b: Pos): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
/** Chebyshev distance: "within N tiles" in any direction, diagonals included. */
export const chebyshev = (a: Pos, b: Pos): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

export function inBounds(state: MissionState, p: Pos): boolean {
  return p.x >= 0 && p.y >= 0 && p.x < state.width && p.y < state.height;
}

export function tileAt(state: MissionState, p: Pos): Tile | undefined {
  return inBounds(state, p) ? state.tiles[p.y][p.x] : undefined;
}

/** Whether a tile type can be stood on, ignoring units. */
export function isWalkableTile(tile: Tile): boolean {
  switch (tile.type) {
    case 'floor':
    case 'vent':
    case 'decon':
    case 'entry':
      return true;
    case 'hatch':
      return tile.hatch === 'open';
    default:
      return false;
  }
}

/** Living or downed units both occupy their tile. */
export function unitAt(state: MissionState, p: Pos): Unit | undefined {
  return state.units.find((u) => (u.hp > 0 || u.downed) && samePos(u.pos, p));
}

export function neighbors(state: MissionState, p: Pos): Pos[] {
  return DIRS.map((d) => ({ x: p.x + d.x, y: p.y + d.y })).filter((n) => inBounds(state, n));
}

/** Can `mover` step onto p? (Walkable and not occupied by another unit.) */
export function isPassable(state: MissionState, p: Pos, mover?: Unit): boolean {
  const tile = tileAt(state, p);
  if (!tile || !isWalkableTile(tile)) return false;
  const occupant = unitAt(state, p);
  return !occupant || occupant === mover;
}

export interface PathOptions {
  /** Extra cost added for entering a tile (e.g. contamination avoidance for AI). Must be >= 0. */
  extraCost?: (p: Pos) => number;
}

export interface PathResult {
  /** Tiles to walk through, excluding the start, including the goal. */
  path: Pos[];
  /** Total weighted cost (equals path.length when there is no extraCost). */
  cost: number;
}

/** A* on the grid. Returns null when the goal is unreachable. */
export function findPath(
  state: MissionState,
  from: Pos,
  to: Pos,
  mover?: Unit,
  options: PathOptions = {},
): PathResult | null {
  if (samePos(from, to)) return { path: [], cost: 0 };
  if (!isPassable(state, to, mover)) return null;

  const startKey = posKey(from);
  const g = new Map<string, number>([[startKey, 0]]);
  const parent = new Map<string, Pos>();
  // Open list as a simple array: the map is 400 tiles, so a heap is not worth it.
  const open: { pos: Pos; f: number; h: number }[] = [{ pos: from, f: manhattan(from, to), h: manhattan(from, to) }];
  const closed = new Set<string>();

  while (open.length > 0) {
    let best = 0;
    for (let i = 1; i < open.length; i++) {
      const a = open[i];
      const b = open[best];
      if (a.f < b.f || (a.f === b.f && a.h < b.h)) best = i;
    }
    const current = open.splice(best, 1)[0].pos;
    const ck = posKey(current);
    if (closed.has(ck)) continue;
    closed.add(ck);

    if (samePos(current, to)) {
      const path: Pos[] = [];
      let k = ck;
      let p: Pos | undefined = current;
      while (p && k !== startKey) {
        path.push(p);
        p = parent.get(k);
        k = p ? posKey(p) : startKey;
      }
      path.reverse();
      return { path, cost: g.get(ck) ?? path.length };
    }

    for (const n of neighbors(state, current)) {
      const nk = posKey(n);
      if (closed.has(nk) || !isPassable(state, n, mover)) continue;
      const step = 1 + (options.extraCost ? Math.max(0, options.extraCost(n)) : 0);
      const tentative = (g.get(ck) ?? Infinity) + step;
      if (tentative < (g.get(nk) ?? Infinity)) {
        g.set(nk, tentative);
        parent.set(nk, current);
        const h = manhattan(n, to);
        open.push({ pos: n, f: tentative + h, h });
      }
    }
  }
  return null;
}

/** Breadth-first flood: every tile reachable within maxSteps, keyed by posKey, valued by step count. */
export function reachableTiles(state: MissionState, unit: Unit, maxSteps: number): Map<string, number> {
  const dist = new Map<string, number>([[posKey(unit.pos), 0]]);
  let frontier: Pos[] = [unit.pos];
  for (let step = 1; step <= maxSteps && frontier.length > 0; step++) {
    const next: Pos[] = [];
    for (const p of frontier) {
      for (const n of neighbors(state, p)) {
        const k = posKey(n);
        if (dist.has(k) || !isPassable(state, n, unit)) continue;
        dist.set(k, step);
        next.push(n);
      }
    }
    frontier = next;
  }
  dist.delete(posKey(unit.pos));
  return dist;
}
