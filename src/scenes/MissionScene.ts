import * as Phaser from 'phaser';
import { createMission01 } from '../data/mission01';
import { ABILITIES, abilityReady, abilityTargets, useAbility } from '../logic/abilities';
import {
  canAct, canShoot, canToggleHatch, isBeside, moveRange, moveUnit, planMove, setOverwatch, shoot, toggleHatch,
  OVERWATCH_AP, HATCH_AP,
} from '../logic/actions';
import { previewShot, type ShotPreview } from '../logic/combat';
import { projectExposure, type ExposureProjection } from '../logic/contamination';
import { keyPos, neighbors, posKey, samePos, tileAt, unitAt } from '../logic/map';
import { endPlayerTurn } from '../logic/turn';
import type { AbilityId, Fx, MissionState, Pos, Tile, Unit } from '../logic/types';
import { areHostile, getUnit, isActive, isDead, unitsOf } from '../logic/units';
import { COLORS, CSS, EV, FONT, MAP_X, MAP_Y, TILE, type UiAction } from './theme';

export type Mode = { kind: 'move' } | { kind: 'ability'; id: AbilityId } | { kind: 'hatch' };

export interface ActionButton {
  key: UiAction;
  label: string;
  hotkey: string;
  apCost: number;
  enabled: boolean;
  /** Why it is disabled, or what it does. */
  note: string;
  active: boolean;
}

export interface MovePreview {
  steps: number;
  apCost: number;
  exposure: ExposureProjection;
  contaminatedTiles: number;
}

export interface ShotInfo {
  target: Unit;
  preview: ShotPreview;
  canShoot: boolean;
  reason: string;
}

/** Everything the HUD needs to draw itself. */
export interface MissionView {
  state: MissionState;
  selected: Unit | null;
  hover: Pos | null;
  hoverTile: Tile | null;
  hoverUnit: Unit | null;
  hoverExposure: ExposureProjection | null;
  mode: Mode;
  movePreview: MovePreview | null;
  shot: ShotInfo | null;
  buttons: ActionButton[];
  busy: boolean;
  hint: string;
}

const tileCenter = (p: Pos): { x: number; y: number } => ({
  x: MAP_X + p.x * TILE + TILE / 2,
  y: MAP_Y + p.y * TILE + TILE / 2,
});

const TONE_COLOR = { bad: CSS.bad, good: CSS.good, info: CSS.haze } as const;

interface UnitSprite {
  container: Phaser.GameObjects.Container;
  hpBar: Phaser.GameObjects.Graphics;
  badge: Phaser.GameObjects.Text;
}

export class MissionScene extends Phaser.Scene {
  private state!: MissionState;
  private selectedId: string | null = null;
  private hover: Pos | null = null;
  private busy = false;
  private mode: Mode = { kind: 'move' };
  private hint = '';

  private tileGfx!: Phaser.GameObjects.Graphics;
  private contamGfx!: Phaser.GameObjects.Graphics;
  private rangeGfx!: Phaser.GameObjects.Graphics;
  private cursorGfx!: Phaser.GameObjects.Graphics;
  private fxGfx!: Phaser.GameObjects.Graphics;
  private sprites = new Map<string, UnitSprite>();

  constructor() {
    super('MissionScene');
  }

  init(data: { seed?: number }): void {
    this.state = createMission01(data?.seed ?? 131);
    this.selectedId = 'holt';
    this.hover = null;
    this.busy = false;
    this.mode = { kind: 'move' };
    this.hint = '';
    this.sprites = new Map();
  }

  create(): void {
    this.tileGfx = this.add.graphics();
    this.contamGfx = this.add.graphics();
    this.rangeGfx = this.add.graphics();
    this.cursorGfx = this.add.graphics();
    this.createUnitSprites();
    this.fxGfx = this.add.graphics().setDepth(10);

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onPointerMove(p));
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onPointerDown(p));

    const kb = this.input.keyboard;
    if (kb) {
      kb.addCapture('TAB');
      kb.on('keydown-TAB', (e: KeyboardEvent) => this.cycleUnit(e.shiftKey ? -1 : 1));
      kb.on('keydown-ESC', () => this.cancel());
      kb.on('keydown-ENTER', () => this.endTurn());
      kb.on('keydown-O', () => this.uiAction('overwatch'));
      kb.on('keydown-H', () => this.uiAction('hatch'));
      kb.on('keydown-ONE', () => this.uiAction('ability0'));
      kb.on('keydown-TWO', () => this.uiAction('ability1'));
    }

    const onEndTurn = (): void => this.endTurn();
    const onSelect = (id: string): void => this.select(id);
    const onAction = (a: UiAction): void => this.uiAction(a);
    this.game.events.on(EV.endTurn, onEndTurn);
    this.game.events.on(EV.selectUnit, onSelect);
    this.game.events.on(EV.action, onAction);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(EV.endTurn, onEndTurn);
      this.game.events.off(EV.selectUnit, onSelect);
      this.game.events.off(EV.action, onAction);
    });

    this.scene.launch('UIScene');
    this.state.fx = [];
    this.redrawMap();
    this.refresh();
  }

  // ---------- view model ----------

  view(): MissionView {
    const sel = this.selectedUnit();
    const hoverTile = this.hover ? tileAt(this.state, this.hover) ?? null : null;
    const hoverUnit = this.hover ? unitAt(this.state, this.hover) ?? null : null;
    return {
      state: this.state,
      selected: sel,
      hover: this.hover,
      hoverTile,
      hoverUnit,
      hoverExposure: sel && this.hover && hoverTile ? projectExposure(this.state, sel, this.hover) : null,
      mode: this.mode,
      movePreview: this.movePreview(),
      shot: this.shotInfo(),
      buttons: this.buttons(),
      busy: this.busy,
      hint: this.hint,
    };
  }

  private movePreview(): MovePreview | null {
    const sel = this.selectedUnit();
    if (!sel || !this.hover || this.busy || this.mode.kind !== 'move' || unitAt(this.state, this.hover)) return null;
    const plan = planMove(this.state, sel, this.hover);
    if (!plan.ok) return null;
    return {
      steps: plan.path.length,
      apCost: plan.apCost,
      exposure: projectExposure(this.state, sel, this.hover),
      contaminatedTiles: plan.path.filter((p) => (tileAt(this.state, p)?.contamination ?? 0) > 0).length,
    };
  }

  private shotInfo(): ShotInfo | null {
    const sel = this.selectedUnit();
    if (!sel || !this.hover || this.mode.kind !== 'move') return null;
    const target = unitAt(this.state, this.hover);
    if (!target || !isActive(target) || !areHostile(sel, target)) return null;
    const check = canShoot(this.state, sel, target);
    return { target, preview: previewShot(this.state, sel, target), canShoot: check.ok, reason: check.ok ? '' : check.reason };
  }

  private buttons(): ActionButton[] {
    const sel = this.selectedUnit();
    if (!sel || sel.faction !== 'player') return [];
    const can = canAct(this.state, sel);
    const out: ActionButton[] = [];
    out.push({
      key: 'overwatch', label: 'Overwatch', hotkey: 'O', apCost: OVERWATCH_AP,
      enabled: can.ok && sel.ap >= OVERWATCH_AP,
      note: !can.ok ? can.reason : sel.ap < OVERWATCH_AP ? 'Needs 2 AP' : 'Fire at the first enemy that moves in sight',
      active: false,
    });
    const hatches = this.hatchTargets(sel);
    out.push({
      key: 'hatch', label: 'Hatch', hotkey: 'H', apCost: HATCH_AP,
      enabled: can.ok && sel.ap >= HATCH_AP && hatches.length > 0,
      note: !can.ok ? can.reason : hatches.length === 0 ? 'Stand next to a hatch' : 'Open or close an adjacent hatch',
      active: this.mode.kind === 'hatch',
    });
    sel.abilities.forEach((id, i) => {
      const def = ABILITIES[id];
      const ready = abilityReady(this.state, sel, id);
      const targets = ready.ok ? abilityTargets(this.state, sel, id) : [];
      const cd = sel.cooldowns[id] ?? 0;
      out.push({
        key: i === 0 ? 'ability0' : 'ability1',
        label: cd > 0 ? `${def.name} (${cd})` : def.name,
        hotkey: String(i + 1),
        apCost: def.apCost,
        enabled: ready.ok && targets.length > 0,
        note: !ready.ok ? ready.reason : targets.length === 0 ? `${def.description} (no valid target now)` : def.description,
        active: this.mode.kind === 'ability' && this.mode.id === id,
      });
    });
    return out;
  }

  private hatchTargets(u: Unit): Pos[] {
    return neighbors(this.state, u.pos).filter((p) => canToggleHatch(this.state, u, p).ok);
  }

  private modeTargets(): Pos[] {
    const sel = this.selectedUnit();
    if (!sel) return [];
    if (this.mode.kind === 'ability') return abilityTargets(this.state, sel, this.mode.id);
    if (this.mode.kind === 'hatch') return this.hatchTargets(sel);
    return [];
  }

  // ---------- input ----------

  private pointerTile(p: Phaser.Input.Pointer): Pos | null {
    const x = Math.floor((p.worldX - MAP_X) / TILE);
    const y = Math.floor((p.worldY - MAP_Y) / TILE);
    return x >= 0 && y >= 0 && x < this.state.width && y < this.state.height ? { x, y } : null;
  }

  private onPointerMove(p: Phaser.Input.Pointer): void {
    const t = this.pointerTile(p);
    if (t && this.hover && samePos(t, this.hover)) return;
    if (!t && !this.hover) return;
    this.hover = t;
    this.drawOverlay();
    this.emitChanged();
  }

  private onPointerDown(p: Phaser.Input.Pointer): void {
    if (this.busy || this.state.outcome !== 'ongoing' || this.state.phase !== 'player') return;
    const t = this.pointerTile(p);
    if (!t) return;
    if (p.rightButtonDown()) {
      this.cancel();
      return;
    }
    const sel = this.selectedUnit();
    const clicked = unitAt(this.state, t);

    if (this.mode.kind !== 'move' && sel) {
      if (this.modeTargets().some((m) => samePos(m, t))) {
        const result = this.mode.kind === 'hatch'
          ? toggleHatch(this.state, sel.id, t)
          : useAbility(this.state, sel.id, this.mode.id, t);
        this.mode = { kind: 'move' };
        this.afterAction(result.ok ? '' : result.reason);
        return;
      }
      this.mode = { kind: 'move' };
      if (clicked?.faction === 'player') this.select(clicked.id);
      else this.refresh();
      return;
    }

    if (clicked && clicked.faction === 'player') {
      this.select(clicked.id);
      return;
    }
    if (!sel) return;
    if (clicked && areHostile(sel, clicked) && isActive(clicked)) {
      const r = shoot(this.state, sel.id, clicked.id);
      this.afterAction(r.ok ? '' : r.reason);
      return;
    }
    const tile = tileAt(this.state, t);
    if (tile?.type === 'hatch' && tile.hatch !== 'open' && isBeside(sel, t)) {
      const r = toggleHatch(this.state, sel.id, t);
      this.afterAction(r.ok ? '' : r.reason);
      return;
    }
    if (clicked) return;
    const r = moveUnit(this.state, sel.id, t);
    if (r.ok) this.afterAction('');
    else {
      this.hint = r.reason;
      this.emitChanged();
    }
  }

  private uiAction(a: UiAction): void {
    if (this.busy || this.state.phase !== 'player' || this.state.outcome !== 'ongoing') return;
    const sel = this.selectedUnit();
    if (a === 'cancel' || !sel) {
      this.cancel();
      return;
    }
    if (a === 'overwatch') {
      const r = setOverwatch(this.state, sel.id);
      this.afterAction(r.ok ? '' : r.reason);
      return;
    }
    const btn = this.buttons().find((b) => b.key === a);
    if (!btn) return;
    if (!btn.enabled) {
      this.hint = btn.note;
      this.emitChanged();
      return;
    }
    if (btn.active) {
      this.cancel();
      return;
    }
    const abilityId = sel.abilities[a === 'ability0' ? 0 : 1];
    this.mode = a === 'hatch' ? { kind: 'hatch' } : { kind: 'ability', id: abilityId };
    this.hint = '';
    this.refresh();
  }

  private cancel(): void {
    if (this.busy) return;
    if (this.mode.kind !== 'move') this.mode = { kind: 'move' };
    else this.selectedId = null;
    this.hint = '';
    this.refresh();
  }

  private selectedUnit(): Unit | null {
    return this.selectedId ? getUnit(this.state, this.selectedId) ?? null : null;
  }

  private select(id: string | null): void {
    if (this.busy) return;
    this.selectedId = id;
    this.mode = { kind: 'move' };
    this.hint = '';
    this.refresh();
  }

  private cycleUnit(dir: 1 | -1): void {
    const squad = unitsOf(this.state, 'player').filter(isActive);
    if (squad.length === 0) return;
    const i = squad.findIndex((u) => u.id === this.selectedId);
    const next = squad[(i + dir + squad.length) % squad.length];
    this.select(next.id);
  }

  private endTurn(): void {
    if (this.busy || this.state.outcome !== 'ongoing' || this.state.phase !== 'player') return;
    this.mode = { kind: 'move' };
    this.hint = '';
    endPlayerTurn(this.state);
    this.playFx(() => {
      const first = unitsOf(this.state, 'player').find((u) => isActive(u) && u.ap > 0);
      this.selectedId = first?.id ?? null;
    });
  }

  private afterAction(failure: string): void {
    this.hint = failure;
    this.playFx(() => this.autoAdvance());
  }

  /** After a unit spends its last AP, hand selection to the next squad member who can act. */
  private autoAdvance(): void {
    const sel = this.selectedUnit();
    if (sel && sel.ap > 0 && !sel.turnEnded) return;
    const next = unitsOf(this.state, 'player').find((u) => isActive(u) && u.ap > 0 && !u.turnEnded);
    if (next) this.selectedId = next.id;
  }

  // ---------- fx playback ----------

  private playFx(done: () => void): void {
    const queue: Fx[] = this.state.fx.splice(0);
    this.busy = true;
    this.rangeGfx.clear();
    this.cursorGfx.clear();
    this.emitChanged();
    const finish = (): void => {
      this.busy = false;
      this.fxGfx.clear();
      done();
      this.redrawMap();
      this.refresh();
      if (this.state.outcome !== 'ongoing') {
        this.time.delayedCall(700, () => this.scene.launch('EndScene', { state: this.state }));
      }
    };
    const next = (): void => {
      const f = queue.shift();
      if (!f) {
        finish();
        return;
      }
      this.playOne(f, next);
    };
    next();
  }

  private playOne(f: Fx, next: () => void): void {
    switch (f.kind) {
      case 'move': {
        const s = this.sprites.get(f.unitId);
        if (!s || f.path.length === 0) return next();
        this.tweens.chain({
          targets: s.container,
          tweens: f.path.map((p) => ({ ...tileCenter(p), duration: 80, ease: 'Linear' })),
          onComplete: () => next(),
        });
        return;
      }
      case 'shot': {
        const a = tileCenter(f.from);
        const b = tileCenter(f.to);
        const color = f.outcome === 'miss' ? COLORS.haze : f.outcome === 'graze' ? COLORS.orange : COLORS.bad;
        this.fxGfx.clear();
        this.fxGfx.lineStyle(3, color, 1).lineBetween(a.x, a.y, b.x, b.y);
        this.fxGfx.fillStyle(color, 1).fillCircle(b.x, b.y, 5);
        if (f.reaction) this.floatText(f.from, 'OVERWATCH', CSS.orange);
        const label = f.outcome === 'miss' ? 'MISS' : f.outcome === 'graze' ? `GRAZE -${f.damage}` : `-${f.damage}`;
        this.floatText(f.to, label, f.outcome === 'miss' ? CSS.haze : f.outcome === 'graze' ? CSS.orange : CSS.bad);
        this.time.delayedCall(420, () => {
          this.fxGfx.clear();
          next();
        });
        return;
      }
      case 'drop': {
        const s = this.sprites.get(f.unitId);
        if (s) {
          if (f.dead) this.tweens.add({ targets: s.container, alpha: 0, duration: 300 });
          else s.container.setAlpha(0.45);
        }
        return next();
      }
      case 'text':
        this.floatText(f.pos, f.text, TONE_COLOR[f.tone]);
        this.time.delayedCall(160, next);
        return;
      case 'phase': {
        const banner = this.add
          .text(MAP_X + (this.state.width * TILE) / 2, MAP_Y + (this.state.height * TILE) / 2, f.text, {
            fontFamily: FONT, fontSize: '34px', fontStyle: 'bold', color: CSS.haze, backgroundColor: '#151a20cc',
            padding: { x: 18, y: 8 },
          })
          .setOrigin(0.5)
          .setDepth(20);
        this.tweens.add({ targets: banner, alpha: 0, delay: 450, duration: 250, onComplete: () => banner.destroy() });
        this.time.delayedCall(550, next);
        return;
      }
    }
  }

  private floatText(p: Pos, text: string, color: string): void {
    const c = tileCenter(p);
    const t = this.add
      .text(c.x, c.y - 14, text, { fontFamily: FONT, fontSize: '14px', fontStyle: 'bold', color, stroke: '#151a20', strokeThickness: 4 })
      .setOrigin(0.5)
      .setDepth(15);
    this.tweens.add({ targets: t, y: c.y - 40, alpha: 0, delay: 350, duration: 700, onComplete: () => t.destroy() });
  }

  // ---------- rendering ----------

  private refresh(): void {
    this.syncUnitSprites();
    this.drawOverlay();
    this.emitChanged();
  }

  private redrawMap(): void {
    this.drawTiles();
    this.drawContamination();
  }

  private emitChanged(): void {
    this.game.events.emit(EV.changed, this.view());
  }

  private drawTiles(): void {
    const g = this.tileGfx;
    g.clear();
    for (let y = 0; y < this.state.height; y++) {
      for (let x = 0; x < this.state.width; x++) this.drawTile(g, this.state.tiles[y][x], x, y);
    }
  }

  private drawTile(g: Phaser.GameObjects.Graphics, tile: Tile, x: number, y: number): void {
    const px = MAP_X + x * TILE;
    const py = MAP_Y + y * TILE;
    const s = TILE;
    if (tile.type === 'bulkhead') {
      g.fillStyle(COLORS.bulkhead, 1).fillRect(px, py, s, s);
      return;
    }
    g.fillStyle(COLORS.navy, 1).fillRect(px, py, s, s);
    g.lineStyle(1, COLORS.navyDark, 1).strokeRect(px + 0.5, py + 0.5, s - 1, s - 1);

    switch (tile.type) {
      case 'entry':
        g.lineStyle(1, COLORS.haze, 0.45).strokeRect(px + 4.5, py + 4.5, s - 9, s - 9);
        break;
      case 'vent': {
        g.fillStyle(COLORS.navyDark, 1).fillRect(px + 5, py + 5, s - 10, s - 10);
        g.lineStyle(2, COLORS.halfCover, 1);
        for (let i = 0; i < 4; i++) g.lineBetween(px + 8, py + 9 + i * 5, px + s - 8, py + 9 + i * 5);
        // Airflow arrow toward the next vent downstream.
        const idx = this.state.vents.findIndex((v) => v.x === x && v.y === y);
        const down = this.state.vents[idx + this.state.ventDirection];
        if (idx >= 0 && down) {
          const dx = Math.sign(down.x - x);
          const dy = dx !== 0 ? 0 : Math.sign(down.y - y);
          const cx = px + s / 2;
          const cy = py + s / 2;
          g.fillStyle(COLORS.haze, 0.9);
          g.fillTriangle(cx + dx * 13, cy + dy * 13, cx + dx * 6 - dy * 5, cy + dy * 6 - dx * 5, cx + dx * 6 + dy * 5, cy + dy * 6 + dx * 5);
        }
        break;
      }
      case 'decon':
        g.fillStyle(COLORS.haze, 0.9);
        g.fillRect(px + s / 2 - 3, py + 6, 6, s - 12);
        g.fillRect(px + 6, py + s / 2 - 3, s - 12, 6);
        break;
      case 'halfCover':
        g.fillStyle(COLORS.halfCover, 1).fillRect(px + 6, py + 8, s - 12, s - 14);
        g.lineStyle(1, COLORS.navyDark, 1).lineBetween(px + 6, py + 8, px + s - 6, py + s - 6);
        break;
      case 'fullCover':
        g.fillStyle(COLORS.fullCover, 1).fillRect(px + 2, py + 2, s - 4, s - 4);
        g.lineStyle(2, COLORS.navyDark, 1).strokeRect(px + 7, py + 7, s - 14, s - 14);
        break;
      case 'console':
        g.fillStyle(COLORS.orange, 1).fillRect(px + 4, py + 4, s - 8, s - 8);
        g.fillStyle(COLORS.navyDark, 1).fillRect(px + 9, py + 9, s - 18, s - 18);
        break;
      case 'fanPanel':
        g.fillStyle(COLORS.haze, 1).fillRect(px + 5, py + 5, s - 10, s - 10);
        g.lineStyle(2, COLORS.navy, 1).strokeCircle(px + s / 2, py + s / 2, 7);
        g.lineBetween(px + s / 2 - 7, py + s / 2, px + s / 2 + 7, py + s / 2);
        g.lineBetween(px + s / 2, py + s / 2 - 7, px + s / 2, py + s / 2 + 7);
        break;
      case 'hatch':
        this.drawHatch(g, tile, x, y, px, py);
        break;
      default:
        break;
    }
  }

  private drawHatch(g: Phaser.GameObjects.Graphics, tile: Tile, x: number, y: number, px: number, py: number): void {
    const s = TILE;
    const left = tileAt(this.state, { x: x - 1, y });
    const right = tileAt(this.state, { x: x + 1, y });
    // A hatch in a horizontal wall has bulkheads to its left and right.
    const horizontalWall = left?.type === 'bulkhead' && right?.type === 'bulkhead';
    g.fillStyle(COLORS.bulkhead, 1);
    if (horizontalWall) g.fillRect(px, py, 3, s).fillRect(px + s - 3, py, 3, s);
    else g.fillRect(px, py, s, 3).fillRect(px, py + s - 3, s, 3);
    if (tile.hatch === 'open') {
      g.lineStyle(2, COLORS.orange, 1);
      if (horizontalWall) g.lineBetween(px + 4, py + 2, px + 4, py + s - 2).lineBetween(px + s - 4, py + 2, px + s - 4, py + s - 2);
      else g.lineBetween(px + 2, py + 4, px + s - 2, py + 4).lineBetween(px + 2, py + s - 4, px + s - 2, py + s - 4);
      return;
    }
    g.fillStyle(COLORS.orange, 1);
    if (horizontalWall) g.fillRect(px + 2, py + s / 2 - 5, s - 4, 10);
    else g.fillRect(px + s / 2 - 5, py + 2, 10, s - 4);
    if (tile.hatch === 'welded') {
      g.lineStyle(3, COLORS.bulkhead, 1);
      g.lineBetween(px + 7, py + 7, px + s - 7, py + s - 7).lineBetween(px + s - 7, py + 7, px + 7, py + s - 7);
    }
  }

  /** Yellow-green overlay with diagonal hatching; denser lines mean higher levels (colorblind-safe). */
  private drawContamination(): void {
    const g = this.contamGfx;
    g.clear();
    const spacing = [0, 12, 7, 4];
    for (let y = 0; y < this.state.height; y++) {
      for (let x = 0; x < this.state.width; x++) {
        const tile = this.state.tiles[y][x];
        if (tile.contamination === 0 || tile.type === 'bulkhead') continue;
        const px = MAP_X + x * TILE;
        const py = MAP_Y + y * TILE;
        const s = TILE;
        g.fillStyle(COLORS.contamination, 0.08 + 0.07 * tile.contamination).fillRect(px, py, s, s);
        g.lineStyle(1.5, COLORS.contamination, 0.85);
        const step = spacing[tile.contamination];
        for (let c = step; c < s * 2; c += step) {
          const x1 = c <= s ? px + c : px + s;
          const y1 = c <= s ? py : py + c - s;
          const x2 = c <= s ? px : px + c - s;
          const y2 = c <= s ? py + c : py + s;
          g.lineBetween(x1, y1, x2, y2);
        }
      }
    }
  }

  private fillTile(g: Phaser.GameObjects.Graphics, p: Pos, color: number, alpha: number): void {
    g.fillStyle(color, alpha).fillRect(MAP_X + p.x * TILE + 1, MAP_Y + p.y * TILE + 1, TILE - 2, TILE - 2);
  }

  private strokeTile(g: Phaser.GameObjects.Graphics, p: Pos, color: number, width = 2, alpha = 1): void {
    g.lineStyle(width, color, alpha).strokeRect(MAP_X + p.x * TILE + 1, MAP_Y + p.y * TILE + 1, TILE - 2, TILE - 2);
  }

  private drawOverlay(): void {
    const g = this.rangeGfx;
    const c = this.cursorGfx;
    g.clear();
    c.clear();
    if (this.busy) return;
    const sel = this.selectedUnit();
    const playerTurn = this.state.phase === 'player' && this.state.outcome === 'ongoing';

    if (sel) {
      const ring = tileCenter(sel.pos);
      c.lineStyle(3, COLORS.orange, 1).strokeCircle(ring.x, ring.y - 2, TILE / 2 - 2);
    }

    if (sel && playerTurn && this.mode.kind === 'move' && sel.faction === 'player') {
      const range = moveRange(this.state, sel);
      for (const [key, cost] of range.tiles) {
        const oneAp = cost <= range.oneApCost;
        this.fillTile(g, keyPos(key), COLORS.move, oneAp ? 0.38 : 0.14);
      }
      // Enemies this unit can shoot.
      for (const u of this.state.units) {
        if (isActive(u) && areHostile(sel, u) && canShoot(this.state, sel, u).ok) this.strokeTile(g, u.pos, COLORS.bad, 2, 0.9);
      }
      if (this.hover && range.tiles.has(posKey(this.hover))) {
        const plan = planMove(this.state, sel, this.hover);
        if (plan.ok) {
          const pts = [sel.pos, ...plan.path].map(tileCenter);
          g.lineStyle(3, COLORS.haze, 0.9);
          for (let i = 1; i < pts.length; i++) g.lineBetween(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
          for (const p of plan.path) {
            if ((tileAt(this.state, p)?.contamination ?? 0) > 0) {
              const pc = tileCenter(p);
              g.fillStyle(COLORS.contamination, 1).fillCircle(pc.x, pc.y, 4);
            }
          }
          const end = pts[pts.length - 1];
          g.fillStyle(COLORS.haze, 1).fillCircle(end.x, end.y, 5);
        }
      }
      const hu = this.hover ? unitAt(this.state, this.hover) : undefined;
      if (hu && isActive(hu) && areHostile(sel, hu)) {
        const a = tileCenter(sel.pos);
        const b = tileCenter(hu.pos);
        const ok = canShoot(this.state, sel, hu).ok;
        g.lineStyle(2, ok ? COLORS.bad : COLORS.halfCover, 0.9).lineBetween(a.x, a.y, b.x, b.y);
      }
    }

    if (sel && playerTurn && this.mode.kind !== 'move') {
      const targets = this.modeTargets();
      for (const t of targets) {
        this.fillTile(g, t, COLORS.orange, 0.3);
        this.strokeTile(g, t, COLORS.orange, 2, 0.9);
      }
      const hv = this.hover;
      if (this.mode.kind === 'ability' && this.mode.id === 'deconSpray' && hv && targets.some((t) => samePos(t, hv))) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) this.strokeTile(g, { x: hv.x + dx, y: hv.y + dy }, COLORS.haze, 2, 0.9);
        }
      }
    }

    if (this.hover) this.strokeTile(c, this.hover, COLORS.haze, 2, 0.9);
  }

  private createUnitSprites(): void {
    for (const u of this.state.units) {
      const { x, y } = tileCenter(u.pos);
      const container = this.add.container(x, y);
      let body: Phaser.GameObjects.Shape;
      let labelColor: string = CSS.dark;
      if (u.faction === 'player') {
        body = this.add.circle(0, -2, 11, COLORS.haze).setStrokeStyle(2, COLORS.navyDark);
      } else if (u.faction === 'concordat') {
        body = this.add.rectangle(0, -2, 20, 20, COLORS.concordat).setStrokeStyle(2, COLORS.bulkhead);
        labelColor = CSS.haze;
      } else {
        body = this.add.triangle(0, -2, 0, 20, 11, 0, 22, 20, COLORS.unbound).setStrokeStyle(2, COLORS.bulkhead);
        labelColor = CSS.haze;
      }
      const label = this.add
        .text(0, u.faction === 'unbound' ? 1 : -2, this.shortLabel(u), { fontFamily: FONT, fontSize: '11px', fontStyle: 'bold', color: labelColor })
        .setOrigin(0.5);
      const hpBar = this.add.graphics();
      const badge = this.add
        .text(10, -15, '', { fontFamily: FONT, fontSize: '9px', fontStyle: 'bold', color: CSS.orange, stroke: '#151a20', strokeThickness: 3 })
        .setOrigin(0.5);
      container.add([body, label, hpBar, badge]);
      this.sprites.set(u.id, { container, hpBar, badge });
    }
  }

  private shortLabel(u: Unit): string {
    if (u.faction === 'player') return u.name.split(' ').pop()!.charAt(0);
    return (u.faction === 'concordat' ? 'C' : 'U') + u.id.replace(/\D/g, '');
  }

  private syncUnitSprites(): void {
    for (const u of this.state.units) {
      const s = this.sprites.get(u.id);
      if (!s) continue;
      const { x, y } = tileCenter(u.pos);
      s.container.setPosition(x, y);
      s.container.setVisible(!isDead(u));
      const spent = u.faction === 'player' && this.state.phase === 'player' && (u.ap === 0 || u.turnEnded);
      s.container.setAlpha(u.downed ? 0.45 : spent ? 0.7 : 1);
      // HP bar under the unit.
      const w = 22;
      s.hpBar.clear();
      s.hpBar.fillStyle(COLORS.bulkhead, 1).fillRect(-w / 2, 11, w, 4);
      const pct = Math.max(0, u.hp / u.maxHp);
      s.hpBar.fillStyle(pct > 0.5 ? COLORS.good : pct > 0.25 ? COLORS.orange : COLORS.bad, 1).fillRect(-w / 2, 11, w * pct, 4);
      const tags = [u.overwatch ? 'OW' : '', u.infected ? 'INF' : '', u.apPenalty > 0 ? 'STUN' : ''].filter(Boolean);
      s.badge.setText(tags.join(' '));
      s.badge.setColor(u.infected ? CSS.contamination : CSS.orange);
    }
  }
}
