// Contamination: exposure, gear, infection, spread through open compartments, and the vent network.
import { blocksAir, neighbors, posKey, samePos, tileAt } from './map';
import type { ContaminationLevel, Gear, MissionState, Pos, Unit } from './types';
import { applyDamage, GEAR_MULTIPLIER, INFECTION_THRESHOLD, isActive, isEnemy } from './units';

/** Exposure gained for ending a turn on each contamination level, before gear. */
export const BASE_EXPOSURE: readonly number[] = [0, 5, 15, 30];
/** A unit ending its turn on a decon station loses this much exposure. */
export const DECON_STATION_REDUCTION = 25;
export const MAX_EXPOSURE = 100;

export function exposureGain(level: ContaminationLevel, gear: Gear): number {
  return Math.round(BASE_EXPOSURE[level] * GEAR_MULTIPLIER[gear]);
}

export interface ExposureProjection {
  gain: number;
  decon: number;
  /** Net change to exposure if the unit ends its turn here. */
  net: number;
  /** True if this would push the unit to infection. */
  infects: boolean;
}

/** What happens to `unit`'s exposure if it ends its turn on `pos`. Used for previews and the AI. */
export function projectExposure(state: MissionState, unit: Unit, pos: Pos): ExposureProjection {
  const tile = tileAt(state, pos);
  if (!tile) return { gain: 0, decon: 0, net: 0, infects: false };
  const gain = exposureGain(tile.contamination, unit.gear);
  const after = Math.min(MAX_EXPOSURE, unit.exposure + gain);
  const decon = tile.type === 'decon' ? Math.min(after, DECON_STATION_REDUCTION) : 0;
  return { gain, decon, net: gain - decon, infects: !unit.infected && after >= INFECTION_THRESHOLD };
}

/** Changes exposure, clamped to 0..100, and infects at 100. */
export function addExposure(state: MissionState, unit: Unit, amount: number): void {
  unit.exposure = Math.max(0, Math.min(MAX_EXPOSURE, unit.exposure + amount));
  if (!unit.infected && unit.exposure >= INFECTION_THRESHOLD) {
    unit.infected = true;
    state.log.push(`${unit.name} is INFECTED (-20 Aim, -1 Move, -1 HP per round).`);
    state.fx.push({ kind: 'text', pos: { ...unit.pos }, text: 'INFECTED', tone: 'bad' });
  }
}

/** Exposure for every active unit of one side ending its turn. */
export function applyEndOfTurnExposure(state: MissionState, side: 'player' | 'enemy'): void {
  for (const u of state.units) {
    if (!isActive(u) || isEnemy(u) !== (side === 'enemy')) continue;
    const p = projectExposure(state, u, u.pos);
    if (p.gain > 0) {
      addExposure(state, u, p.gain);
      state.log.push(`${u.name} +${p.gain} exposure (now ${u.exposure}).`);
      state.fx.push({ kind: 'text', pos: { ...u.pos }, text: `+${p.gain} EXP`, tone: 'bad' });
    }
    if (p.decon > 0 && u.exposure > 0) {
      const before = u.exposure;
      addExposure(state, u, -DECON_STATION_REDUCTION);
      state.log.push(`${u.name} decontaminates: exposure ${before} -> ${u.exposure}.`);
      state.fx.push({ kind: 'text', pos: { ...u.pos }, text: `-${before - u.exposure} EXP`, tone: 'good' });
    }
  }
}

/** Infected units lose 1 HP each round. */
export function applyInfectionDamage(state: MissionState): void {
  for (const u of state.units) {
    if (!isActive(u) || !u.infected) continue;
    state.log.push(`${u.name} suffers from infection (-1 HP).`);
    state.fx.push({ kind: 'text', pos: { ...u.pos }, text: '-1 HP', tone: 'bad' });
    applyDamage(state, u, 1);
  }
}

/** Whether contamination can sit on (and pass through) this tile. */
export function holdsAir(state: MissionState, p: Pos): boolean {
  const t = tileAt(state, p);
  return !!t && !blocksAir(t);
}

/**
 * End-of-round spread, computed from a snapshot so it never cascades within one round:
 * 1. Each tile at level 2 or 3 raises each open neighbour by 1, up to one level below itself.
 *    Bulkheads and closed or welded hatches block this.
 * 2. Each vent at level 2 or 3 raises the next vent downstream by 1 (up to 3).
 * Returns the number of tiles whose level rose.
 */
export function spreadContamination(state: MissionState): number {
  const snap = state.tiles.map((row) => row.map((t) => t.contamination));
  const next = snap.map((row) => [...row]);

  for (let y = 0; y < state.height; y++) {
    for (let x = 0; x < state.width; x++) {
      const src = snap[y][x];
      if (src < 2 || !holdsAir(state, { x, y })) continue;
      for (const n of neighbors(state, { x, y })) {
        if (!holdsAir(state, n)) continue;
        const raised = Math.min(src - 1, snap[n.y][n.x] + 1);
        if (raised > next[n.y][n.x]) next[n.y][n.x] = raised as ContaminationLevel;
      }
    }
  }

  state.vents.forEach((v, i) => {
    if (snap[v.y][v.x] < 2) return;
    const down = state.vents[i + state.ventDirection];
    if (!down) return;
    const raised = Math.min(3, snap[down.y][down.x] + 1);
    if (raised > next[down.y][down.x]) next[down.y][down.x] = raised as ContaminationLevel;
  });

  let changed = 0;
  for (let y = 0; y < state.height; y++) {
    for (let x = 0; x < state.width; x++) {
      if (next[y][x] !== state.tiles[y][x].contamination) {
        state.tiles[y][x].contamination = next[y][x] as ContaminationLevel;
        changed++;
      }
    }
  }
  return changed;
}

/** Index of a vent in the network, or -1. */
export function ventIndex(state: MissionState, p: Pos): number {
  return state.vents.findIndex((v) => samePos(v, p));
}

/** posKey -> level for every contaminated tile. Handy for tests and debugging. */
export function contaminationMap(state: MissionState): Map<string, ContaminationLevel> {
  const m = new Map<string, ContaminationLevel>();
  state.tiles.forEach((row, y) => row.forEach((t, x) => { if (t.contamination > 0) m.set(posKey({ x, y }), t.contamination); }));
  return m;
}
