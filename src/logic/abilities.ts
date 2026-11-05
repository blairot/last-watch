// Class abilities.
import { canAct } from './actions';
import { addExposure, holdsAir } from './contamination';
import { chebyshev, hasLineOfSight, inBounds, manhattan, samePos, tileAt, unitAt } from './map';
import type { AbilityId, ActionResult, MissionState, Pos, Unit } from './types';
import { getUnit, isActive, isEnemy } from './units';

export interface AbilityDef {
  id: AbilityId;
  name: string;
  apCost: number;
  /** Rounds before it can be used again (0 = no cooldown). */
  cooldown: number;
  description: string;
}

export const ABILITIES: Record<AbilityId, AbilityDef> = {
  coordinatedAssault: {
    id: 'coordinatedAssault', name: 'Coordinated Assault', apCost: 1, cooldown: 3,
    description: 'An ally in line of sight gains 1 AP this turn.',
  },
  breach: {
    id: 'breach', name: 'Breach', apCost: 2, cooldown: 0,
    description: 'Force open an adjacent closed or welded hatch. Enemies within 2 tiles beyond it lose 1 AP next turn.',
  },
  deconSpray: {
    id: 'deconSpray', name: 'Decon Spray', apCost: 1, cooldown: 2,
    description: 'Clear contamination in a 3x3 area within 3 tiles; units there lose 30 exposure.',
  },
  stabilize: {
    id: 'stabilize', name: 'Stabilize', apCost: 1, cooldown: 0,
    description: 'Revive an adjacent downed ally at 2 HP.',
  },
  weld: {
    id: 'weld', name: 'Weld', apCost: 1, cooldown: 0,
    description: 'Weld an adjacent hatch shut (closing it), or unweld it.',
  },
  reverseFan: {
    id: 'reverseFan', name: 'Reverse Fan', apCost: 1, cooldown: 0,
    description: 'At the fan control panel: reverse the vent network airflow.',
  },
};

/** Compartment at the downstream end of the vent network. */
export function airflowTarget(state: MissionState): string {
  const end = state.ventDirection === 1 ? state.vents[state.vents.length - 1] : state.vents[0];
  return (end && tileAt(state, end)?.room?.toLowerCase()) || 'far end of the ducts';
}

export const BREACH_RADIUS = 2;
export const DECON_SPRAY_RANGE = 3;
export const DECON_SPRAY_EXPOSURE = 30;
export const STABILIZE_HP = 2;

const allTiles = (state: MissionState): Pos[] => {
  const out: Pos[] = [];
  for (let y = 0; y < state.height; y++) for (let x = 0; x < state.width; x++) out.push({ x, y });
  return out;
};

/** Tiles this unit could target with the ability right now, ignoring AP and cooldown. */
export function abilityTargets(state: MissionState, unit: Unit, id: AbilityId): Pos[] {
  const tiles = allTiles(state);
  switch (id) {
    case 'coordinatedAssault':
      return state.units
        .filter((a) => a !== unit && a.faction === 'player' && isActive(a) && !a.turnEnded && hasLineOfSight(state, unit.pos, a.pos))
        .map((a) => ({ ...a.pos }));
    case 'breach':
      return tiles.filter((p) => {
        const t = tileAt(state, p)!;
        return t.type === 'hatch' && t.hatch !== 'open' && manhattan(unit.pos, p) === 1;
      });
    case 'deconSpray':
      return tiles.filter((p) => chebyshev(unit.pos, p) <= DECON_SPRAY_RANGE && holdsAir(state, p) && hasLineOfSight(state, unit.pos, p));
    case 'stabilize':
      return state.units
        .filter((a) => a.faction === 'player' && a.downed && chebyshev(unit.pos, a.pos) === 1)
        .map((a) => ({ ...a.pos }));
    case 'weld':
      return tiles.filter((p) => tileAt(state, p)!.type === 'hatch' && manhattan(unit.pos, p) === 1 && !unitAt(state, p));
    case 'reverseFan':
      return tiles.filter((p) => tileAt(state, p)!.type === 'fanPanel' && chebyshev(unit.pos, p) === 1);
  }
}

/** Whether the unit can use the ability at all right now (AP, cooldown, phase), regardless of target. */
export function abilityReady(state: MissionState, unit: Unit, id: AbilityId): ActionResult {
  if (!unit.abilities.includes(id)) return { ok: false, reason: `${unit.name} does not have ${ABILITIES[id].name}` };
  const can = canAct(state, unit);
  if (!can.ok) return can;
  const cd = unit.cooldowns[id] ?? 0;
  if (cd > 0) return { ok: false, reason: `${ABILITIES[id].name} recharges in ${cd} round${cd === 1 ? '' : 's'}` };
  if (unit.ap < ABILITIES[id].apCost) return { ok: false, reason: `Needs ${ABILITIES[id].apCost} AP` };
  return { ok: true };
}

export function canUseAbility(state: MissionState, unit: Unit, id: AbilityId, target: Pos): ActionResult {
  const ready = abilityReady(state, unit, id);
  if (!ready.ok) return ready;
  if (!abilityTargets(state, unit, id).some((p) => samePos(p, target))) return { ok: false, reason: 'Not a valid target' };
  return { ok: true };
}

export function useAbility(state: MissionState, unitId: string, id: AbilityId, target: Pos): ActionResult {
  const unit = getUnit(state, unitId);
  if (!unit) return { ok: false, reason: 'Unknown unit' };
  const can = canUseAbility(state, unit, id, target);
  if (!can.ok) return can;
  const def = ABILITIES[id];
  unit.ap -= def.apCost;
  if (def.cooldown > 0) unit.cooldowns[id] = def.cooldown;
  EFFECTS[id](state, unit, target);
  return { ok: true };
}

const EFFECTS: Record<AbilityId, (state: MissionState, unit: Unit, target: Pos) => void> = {
  coordinatedAssault(state, unit, target) {
    const ally = unitAt(state, target)!;
    ally.ap += 1;
    state.log.push(`${unit.name} coordinates the assault: ${ally.name} gains 1 AP.`);
    state.fx.push({ kind: 'text', pos: { ...target }, text: '+1 AP', tone: 'good' });
  },

  breach(state, unit, target) {
    const tile = tileAt(state, target)!;
    tile.hatch = 'open';
    // "Far side": beyond the hatch, as seen from the breacher.
    const dx = target.x - unit.pos.x;
    const dy = target.y - unit.pos.y;
    const stunned = state.units.filter(
      (e) => isEnemy(e) && isActive(e) && chebyshev(e.pos, target) <= BREACH_RADIUS &&
        (e.pos.x - target.x) * dx + (e.pos.y - target.y) * dy > 0,
    );
    for (const e of stunned) {
      e.apPenalty = 1;
      state.fx.push({ kind: 'text', pos: { ...e.pos }, text: 'STUNNED', tone: 'good' });
    }
    state.log.push(`${unit.name} breaches the hatch!${stunned.length ? ` ${stunned.map((e) => e.name).join(', ')} lose 1 AP next turn.` : ''}`);
    state.fx.push({ kind: 'text', pos: { ...target }, text: 'BREACH', tone: 'info' });
  },

  deconSpray(state, unit, target) {
    let cleared = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const p = { x: target.x + dx, y: target.y + dy };
        if (!inBounds(state, p) || !holdsAir(state, p)) continue;
        const t = tileAt(state, p)!;
        if (t.contamination > 0) cleared++;
        t.contamination = 0;
        const u = unitAt(state, p);
        if (u && u.exposure > 0) {
          addExposure(state, u, -DECON_SPRAY_EXPOSURE);
          state.fx.push({ kind: 'text', pos: { ...p }, text: `-${DECON_SPRAY_EXPOSURE} EXP`, tone: 'good' });
        }
      }
    }
    state.log.push(`${unit.name} sprays decon (${cleared} tiles cleared).`);
  },

  stabilize(state, unit, target) {
    const ally = unitAt(state, target)!;
    ally.downed = false;
    ally.hp = STABILIZE_HP;
    ally.ap = 0;
    ally.turnEnded = true;
    state.log.push(`${unit.name} stabilizes ${ally.name} (${STABILIZE_HP} HP).`);
    state.fx.push({ kind: 'text', pos: { ...target }, text: 'STABILIZED', tone: 'good' });
  },

  weld(state, unit, target) {
    const tile = tileAt(state, target)!;
    const unwelding = tile.hatch === 'welded';
    tile.hatch = unwelding ? 'closed' : 'welded';
    state.log.push(`${unit.name} ${unwelding ? 'cuts the weld on' : 'welds shut'} a hatch.`);
    state.fx.push({ kind: 'text', pos: { ...target }, text: unwelding ? 'UNWELDED' : 'WELDED', tone: 'info' });
  },

  reverseFan(state, unit) {
    state.ventDirection = state.ventDirection === 1 ? -1 : 1;
    state.log.push(`${unit.name} reverses the fans: vent air now flows toward the ${airflowTarget(state)}.`);
    state.fx.push({ kind: 'text', pos: { ...unit.pos }, text: 'FANS REVERSED', tone: 'info' });
  },
};
