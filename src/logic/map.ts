// Map queries, pathfinding, and line of sight. Movement is 4-directional.
import type { MissionState, Pos, Tile, Unit } from './types';

export const DIRS: readonly Pos[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

export const posKey = (p: Pos): string => `${p.x},${p.y}`;
export const keyPos = (k: string): Pos => {
  const [x, y] = k.split(',').map(Number);
  return { x, y };
};
export const samePos = (a: Pos, b: Pos): boolean => a.x === b.x && a.y === b.y;
export const manhattan = (a: Pos, b: Pos): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
/** Chebyshev distance: "within N tiles" in any direction, diagonals included. */
export const chebyshev = (a: Pos, b: Pos): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
/** Straight-line distance in tiles, rounded to the nearest tile. Used for weapon range. */
export const rangeTiles = (a: Pos, b: Pos): number => Math.round(Math.hypot(a.x - b.x, a.y - b.y));

export function inBounds(state: MissionState, p: Pos): boolean {
  return p.x >= 0 && p.y >= 0 && p.x < state.width && p.y < state.height;
}

export function tileAt(state: MissionState, p: Pos): Tile | undefined {
  return inBounds(state, p) ? state.tiles[p.y][p.x] : undefined;
}

export const isHatchShut = (tile: Tile): boolean => tile.type === 'hatch' && tile.hatch !== 'open';

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

/** Bulkheads and shut hatches block sight. Cover does not (it causes grazes instead). */
export function isOpaque(tile: Tile): boolean {
  return tile.type === 'bulkhead' || isHatchShut(tile);
}

/** Bulkheads and shut hatches block contamination spread. */
export function blocksAir(tile: Tile): boolean {
  return tile.type === 'bulkhead' || isHatchShut(tile);
}

/** Units that are alive or downed occupy their tile. Dead enemies do not. */
export function unitAt(state: MissionState, p: Pos): Unit | undefined {
  return state.units.find((u) => (u.hp > 0 || u.downed) && samePos(u.pos, p));
}

export function neighbors(state: MissionState, p: Pos): Pos[] {
  return DIRS.map((d) => ({ x: p.x + d.x, y: p.y + d.y })).filter((n) => inBounds(state, n));
}

/** All 8 surrounding tiles, in bounds. */
export function neighbors8(state: MissionState, p: Pos): Pos[] {
  const out: Pos[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const n = { x: p.x + dx, y: p.y + dy };
      if (inBounds(state, n)) out.push(n);
    }
  }
  return out;
}

/** Can `mover` step onto p? (Walkable and not occupied by another unit.) */
export function isPassable(state: MissionState, p: Pos, mover?: Unit): boolean {
  const tile = tileAt(state, p);
  if (!tile || !isWalkableTile(tile)) return false;
  const occupant = unitAt(state, p);
  return !occupant || occupant === mover;
}

/** Extra cost for entering a tile, on top of the 1 every step costs. */
export type ExtraCost = (p: Pos) => number;

export interface PathOptions {
  /** Extra cost added for entering a tile (e.g. contamination avoidance). Must be >= 0. */
  extraCost?: ExtraCost;
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
      let p: Pos | undefined = current;
      while (p && posKey(p) !== startKey) {
        path.push(p);
        p = parent.get(posKey(p));
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

/**
 * Dijkstra flood: every tile reachable within maxCost, keyed by posKey, valued by cost.
 * Without extraCost, cost equals the number of steps. Excludes the start tile.
 */
export function reachableTiles(
  state: MissionState,
  unit: Unit,
  maxCost: number,
  extraCost?: ExtraCost,
): Map<string, number> {
  const startKey = posKey(unit.pos);
  const dist = new Map<string, number>([[startKey, 0]]);
  const open: { pos: Pos; cost: number }[] = [{ pos: unit.pos, cost: 0 }];
  const done = new Set<string>();
  while (open.length > 0) {
    let best = 0;
    for (let i = 1; i < open.length; i++) if (open[i].cost < open[best].cost) best = i;
    const { pos, cost } = open.splice(best, 1)[0];
    const k = posKey(pos);
    if (done.has(k)) continue;
    done.add(k);
    for (const n of neighbors(state, pos)) {
      const nk = posKey(n);
      if (done.has(nk) || !isPassable(state, n, unit)) continue;
      const c = cost + 1 + (extraCost ? Math.max(0, extraCost(n)) : 0);
      if (c > maxCost || c >= (dist.get(nk) ?? Infinity)) continue;
      dist.set(nk, c);
      open.push({ pos: n, cost: c });
    }
  }
  dist.delete(startKey);
  return dist;
}

/**
 * Walking distance from every tile to the nearest source, ignoring units.
 * `throughShutHatches` lets the field pass closed (not welded) hatches, for AI that can open them.
 */
export function distanceField(state: MissionState, sources: Pos[], throughShutHatches = false): Map<string, number> {
  const dist = new Map<string, number>();
  let frontier: Pos[] = [];
  for (const s of sources) {
    dist.set(posKey(s), 0);
    frontier.push(s);
  }
  for (let d = 1; frontier.length > 0; d++) {
    const next: Pos[] = [];
    for (const p of frontier) {
      for (const n of neighbors(state, p)) {
        const k = posKey(n);
        if (dist.has(k)) continue;
        const t = tileAt(state, n)!;
        const ok = isWalkableTile(t) || (throughShutHatches && t.type === 'hatch' && t.hatch === 'closed');
        if (!ok) continue;
        dist.set(k, d);
        next.push(n);
      }
    }
    frontier = next;
  }
  return dist;
}

/** Tiles strictly between a and b on a Bresenham line from a to b. */
export function lineBetween(a: Pos, b: Pos): Pos[] {
  const out: Pos[] = [];
  let x = a.x;
  let y = a.y;
  const dx = Math.abs(b.x - a.x);
  const dy = -Math.abs(b.y - a.y);
  const sx = a.x < b.x ? 1 : -1;
  const sy = a.y < b.y ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    if (x === b.x && y === b.y) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
    if (x === b.x && y === b.y) break;
    out.push({ x, y });
  }
  return out;
}

/**
 * Line of sight between two tiles. Symmetric: sight exists if the line is clear in either
 * direction (Bresenham is not symmetric on its own). Units never block sight.
 */
export function hasLineOfSight(state: MissionState, a: Pos, b: Pos): boolean {
  if (samePos(a, b)) return true;
  const clear = (line: Pos[]): boolean => line.every((p) => !isOpaque(tileAt(state, p)!));
  return clear(lineBetween(a, b)) || clear(lineBetween(b, a));
}
