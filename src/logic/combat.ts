// Hit and graze resolution, cover, flanking, and overwatch reactions.
import { DIRS, hasLineOfSight, rangeTiles, tileAt } from './map';
import { Rng } from './rng';
import type { MissionState, Pos, ShotOutcome, Tile, Unit } from './types';
import { applyDamage, areHostile, effectiveAim, isActive } from './units';

export type CoverLevel = 'none' | 'half' | 'full';

/** Chance that a hit on a covered, unflanked target is only a graze. */
export const GRAZE_CHANCE: Record<CoverLevel, number> = { none: 0, half: 40, full: 70 };

export const MIN_HIT = 10;
export const MAX_HIT = 95;
/** Hit chance drops 2% per tile beyond this range. */
export const FALLOFF_START = 6;
export const FALLOFF_PER_TILE = 2;

export function coverOfTile(tile: Tile | undefined): CoverLevel {
  if (!tile) return 'none';
  if (tile.type === 'fullCover') return 'full';
  if (tile.type === 'halfCover' || tile.type === 'console' || tile.type === 'fanPanel') return 'half';
  return 'none';
}

/**
 * The best cover the target has against a shooter at `from`. A cover tile next to the target
 * (4 directions) protects it when the shooter is on that side of the target, which is the
 * case when the cover lies between the two along the line of fire.
 */
export function coverFrom(state: MissionState, target: Pos, from: Pos): CoverLevel {
  const vx = from.x - target.x;
  const vy = from.y - target.y;
  let best: CoverLevel = 'none';
  for (const d of DIRS) {
    if (d.x * vx + d.y * vy <= 0) continue; // cover on the far side or flank does not count
    const c = coverOfTile(tileAt(state, { x: target.x + d.x, y: target.y + d.y }));
    if (c === 'full') return 'full';
    if (c === 'half') best = 'half';
  }
  return best;
}

/** Flanked: no cover tile lies between the target and the shooter. Flanked targets never graze. */
export const isFlanked = (state: MissionState, target: Pos, from: Pos): boolean => coverFrom(state, target, from) === 'none';

export function hitChance(aim: number, distance: number): number {
  const raw = aim - FALLOFF_PER_TILE * Math.max(0, distance - FALLOFF_START);
  return Math.min(MAX_HIT, Math.max(MIN_HIT, raw));
}

/** A graze deals half damage, rounded down, minimum 1. */
export const grazeDamage = (damage: number): number => Math.max(1, Math.floor(damage / 2));

export interface ShotPreview {
  visible: boolean;
  distance: number;
  hitChance: number;
  /** Chance a hit becomes a graze (0 when flanked or uncovered). */
  grazeChance: number;
  cover: CoverLevel;
  flanked: boolean;
  damage: [number, number];
  grazeDamage: [number, number];
}

/** The numbers shown before a shot. resolveShot uses exactly these numbers. */
export function previewShot(state: MissionState, shooter: Unit, target: Unit, from: Pos = shooter.pos): ShotPreview {
  const distance = rangeTiles(from, target.pos);
  const cover = coverFrom(state, target.pos, from);
  return {
    visible: hasLineOfSight(state, from, target.pos),
    distance,
    hitChance: hitChance(effectiveAim(shooter), distance),
    grazeChance: GRAZE_CHANCE[cover],
    cover,
    flanked: cover === 'none',
    damage: [shooter.damage[0], shooter.damage[1]],
    grazeDamage: [grazeDamage(shooter.damage[0]), grazeDamage(shooter.damage[1])],
  };
}

/** Average damage a shot will deal, accounting for hit and graze chances. */
export function expectedDamage(p: ShotPreview): number {
  const full = (p.damage[0] + p.damage[1]) / 2;
  const graze = (p.grazeDamage[0] + p.grazeDamage[1]) / 2;
  const g = p.grazeChance / 100;
  return (p.hitChance / 100) * ((1 - g) * full + g * graze);
}

export interface ShotResult {
  outcome: ShotOutcome;
  damage: number;
}

/** Rolls a shot and applies damage. Does not spend AP; see actions.shoot. */
export function resolveShot(state: MissionState, shooter: Unit, target: Unit, reaction = false): ShotResult {
  const p = previewShot(state, shooter, target);
  const rng = new Rng(state.rngState);
  let outcome: ShotOutcome = 'miss';
  let damage = 0;
  if (rng.chance(p.hitChance)) {
    const rolled = rng.int(p.damage[0], p.damage[1]);
    if (p.grazeChance > 0 && rng.chance(p.grazeChance)) {
      outcome = 'graze';
      damage = grazeDamage(rolled);
    } else {
      outcome = 'hit';
      damage = rolled;
    }
  }
  state.rngState = rng.state;

  const verb = reaction ? 'reacts on overwatch at' : 'fires at';
  const detail =
    outcome === 'miss' ? 'MISS' : outcome === 'graze' ? `GRAZE for ${damage}` : `HIT for ${damage}${p.flanked ? ' (flanked)' : ''}`;
  state.log.push(`${shooter.name} ${verb} ${target.name} (${p.hitChance}%): ${detail}.`);
  state.fx.push({
    kind: 'shot', shooterId: shooter.id, targetId: target.id, from: { ...shooter.pos }, to: { ...target.pos },
    outcome, damage, reaction,
  });
  applyDamage(state, target, damage);
  return { outcome, damage };
}

/**
 * Called after `mover` enters a tile. The first hostile unit on overwatch that can see it fires
 * (then stops overwatching). Returns true if the mover was dropped and must stop moving.
 */
export function triggerOverwatch(state: MissionState, mover: Unit): boolean {
  for (const watcher of state.units) {
    if (!isActive(mover)) break;
    if (!watcher.overwatch || !isActive(watcher) || !areHostile(watcher, mover)) continue;
    if (!hasLineOfSight(state, watcher.pos, mover.pos)) continue;
    watcher.overwatch = false;
    resolveShot(state, watcher, mover, true);
  }
  return !isActive(mover);
}
