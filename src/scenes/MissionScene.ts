import * as Phaser from 'phaser';
import { createMission01 } from '../data/mission01';
import { posKey, samePos, tileAt, unitAt } from '../logic/map';
import { endPlayerTurn, getUnit, isActive, moveRange, moveUnit, planMove, unitsOf } from '../logic/turn';
import type { MissionState, Pos, Tile, Unit } from '../logic/types';
import { COLORS, EV, MAP_X, MAP_Y, TILE } from './theme';

export interface MovePreview {
  steps: number;
  apCost: number;
}

/** Everything the HUD needs to draw itself. */
export interface MissionView {
  state: MissionState;
  selected: Unit | null;
  hover: Pos | null;
  hoverTile: Tile | null;
  preview: MovePreview | null;
  busy: boolean;
}

const tileCenter = (p: Pos): { x: number; y: number } => ({
  x: MAP_X + p.x * TILE + TILE / 2,
  y: MAP_Y + p.y * TILE + TILE / 2,
});

export class MissionScene extends Phaser.Scene {
  private state!: MissionState;
  private selectedId: string | null = null;
  private hover: Pos | null = null;
  private busy = false;

  private tileGfx!: Phaser.GameObjects.Graphics;
  private contamGfx!: Phaser.GameObjects.Graphics;
  private rangeGfx!: Phaser.GameObjects.Graphics;
  private cursorGfx!: Phaser.GameObjects.Graphics;
  private unitSprites = new Map<string, Phaser.GameObjects.Container>();

  constructor() {
    super('MissionScene');
  }

  init(): void {
    this.state = createMission01();
    this.selectedId = 'holt';
    this.hover = null;
    this.busy = false;
    this.unitSprites = new Map();
  }

  create(): void {
    this.tileGfx = this.add.graphics();
    this.contamGfx = this.add.graphics();
    this.rangeGfx = this.add.graphics();
    this.cursorGfx = this.add.graphics();

    this.drawTiles();
    this.drawContamination();
    this.createUnitSprites();

    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onPointerMove(p));
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.onPointerDown(p));

    const kb = this.input.keyboard;
    if (kb) {
      kb.addCapture('TAB');
      kb.on('keydown-TAB', (e: KeyboardEvent) => this.cycleUnit(e.shiftKey ? -1 : 1));
      kb.on('keydown-ESC', () => this.select(null));
      kb.on('keydown-ENTER', () => this.endTurn());
    }

    const onEndTurn = (): void => this.endTurn();
    const onSelect = (id: string): void => this.select(id);
    this.game.events.on(EV.endTurn, onEndTurn);
    this.game.events.on(EV.selectUnit, onSelect);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(EV.endTurn, onEndTurn);
      this.game.events.off(EV.selectUnit, onSelect);
    });

    this.scene.launch('UIScene');
    this.refresh();
  }

  /** Snapshot for the HUD. */
  view(): MissionView {
    const selected = this.selectedId ? getUnit(this.state, this.selectedId) ?? null : null;
    return {
      state: this.state,
      selected,
      hover: this.hover,
      hoverTile: this.hover ? tileAt(this.state, this.hover) ?? null : null,
      preview: this.currentPreview(),
      busy: this.busy,
    };
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
    if (this.busy || this.state.outcome !== 'ongoing') return;
    const t = this.pointerTile(p);
    if (!t) return;
    const clicked = unitAt(this.state, t);
    if (clicked && clicked.faction === 'player') {
      this.select(clicked.id);
      return;
    }
    const sel = this.selectedUnit();
    if (!sel || clicked) return;
    const result = moveUnit(this.state, sel.id, t);
    if (result.ok) this.animateMove(sel, result.path);
  }

  private selectedUnit(): Unit | null {
    return this.selectedId ? getUnit(this.state, this.selectedId) ?? null : null;
  }

  private select(id: string | null): void {
    if (this.busy) return;
    this.selectedId = id;
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
    if (this.busy) return;
    endPlayerTurn(this.state);
    const first = unitsOf(this.state, 'player').find(isActive);
    this.selectedId = first?.id ?? null;
    this.refresh();
  }

  /** After a unit spends its last AP, hand selection to the next squad member who can act. */
  private autoAdvance(): void {
    const sel = this.selectedUnit();
    if (sel && sel.ap > 0) return;
    const next = unitsOf(this.state, 'player').find((u) => isActive(u) && u.ap > 0 && !u.turnEnded);
    if (next) this.selectedId = next.id;
  }

  private animateMove(unit: Unit, path: Pos[]): void {
    const sprite = this.unitSprites.get(unit.id);
    if (!sprite || path.length === 0) {
      this.refresh();
      return;
    }
    this.busy = true;
    this.rangeGfx.clear();
    this.tweens.chain({
      targets: sprite,
      tweens: path.map((p) => ({ ...tileCenter(p), duration: 85, ease: 'Linear' })),
      onComplete: () => {
        this.busy = false;
        this.autoAdvance();
        this.refresh();
      },
    });
    this.emitChanged();
  }

  // ---------- rendering ----------

  private refresh(): void {
    this.syncUnitSprites();
    this.drawContamination();
    this.drawOverlay();
    this.emitChanged();
  }

  private emitChanged(): void {
    this.game.events.emit(EV.changed, this.view());
  }

  private currentPreview(): MovePreview | null {
    const sel = this.selectedUnit();
    if (!sel || !this.hover || this.busy || sel.faction !== 'player') return null;
    if (unitAt(this.state, this.hover)) return null;
    const plan = planMove(this.state, sel, this.hover);
    return plan.ok ? { steps: plan.path.length, apCost: plan.apCost } : null;
  }

  private drawTiles(): void {
    const g = this.tileGfx;
    g.clear();
    for (let y = 0; y < this.state.height; y++) {
      for (let x = 0; x < this.state.width; x++) {
        this.drawTile(g, this.state.tiles[y][x], x, y);
      }
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
    // Floor base with a faint grid seam.
    g.fillStyle(COLORS.navy, 1).fillRect(px, py, s, s);
    g.lineStyle(1, COLORS.navyDark, 1).strokeRect(px + 0.5, py + 0.5, s - 1, s - 1);

    switch (tile.type) {
      case 'entry':
        g.lineStyle(1, COLORS.haze, 0.45).strokeRect(px + 4.5, py + 4.5, s - 9, s - 9);
        break;
      case 'vent':
        g.fillStyle(COLORS.navyDark, 1).fillRect(px + 5, py + 5, s - 10, s - 10);
        g.lineStyle(2, COLORS.halfCover, 1);
        for (let i = 0; i < 4; i++) g.lineBetween(px + 8, py + 9 + i * 5, px + s - 8, py + 9 + i * 5);
        break;
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
    if (horizontalWall) {
      g.fillRect(px, py, 3, s).fillRect(px + s - 3, py, 3, s);
    } else {
      g.fillRect(px, py, s, 3).fillRect(px, py + s - 3, s, 3);
    }
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
      g.lineStyle(2, COLORS.bulkhead, 1);
      g.lineBetween(px + 8, py + 8, px + s - 8, py + s - 8).lineBetween(px + s - 8, py + 8, px + 8, py + s - 8);
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
        g.lineStyle(1.5, COLORS.contamination, 0.8);
        const step = spacing[tile.contamination];
        // Lines along x + y = c, clipped to the tile square.
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

  private drawOverlay(): void {
    const g = this.rangeGfx;
    const c = this.cursorGfx;
    g.clear();
    c.clear();
    const sel = this.selectedUnit();

    if (sel && !this.busy) {
      const ring = tileCenter(sel.pos);
      c.lineStyle(3, COLORS.orange, 1).strokeCircle(ring.x, ring.y, TILE / 2 - 1);
    }

    if (sel && !this.busy && this.state.phase === 'player' && sel.faction === 'player') {
      const range = moveRange(this.state, sel);
      for (const [key, steps] of range.tiles) {
        const [x, y] = key.split(',').map(Number);
        const oneAp = steps <= range.oneApSteps;
        g.fillStyle(oneAp ? COLORS.moveOneAp : COLORS.moveTwoAp, oneAp ? 0.38 : 0.14);
        g.fillRect(MAP_X + x * TILE + 1, MAP_Y + y * TILE + 1, TILE - 2, TILE - 2);
      }
      if (this.hover && range.tiles.has(posKey(this.hover))) {
        const plan = planMove(this.state, sel, this.hover);
        if (plan.ok) {
          const pts = [sel.pos, ...plan.path].map(tileCenter);
          g.lineStyle(3, COLORS.haze, 0.9);
          for (let i = 1; i < pts.length; i++) g.lineBetween(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
          const end = pts[pts.length - 1];
          g.fillStyle(COLORS.haze, 1).fillCircle(end.x, end.y, 5);
        }
      }
    }

    if (this.hover) {
      c.lineStyle(2, COLORS.haze, 0.9).strokeRect(MAP_X + this.hover.x * TILE + 1, MAP_Y + this.hover.y * TILE + 1, TILE - 2, TILE - 2);
    }
  }

  private createUnitSprites(): void {
    for (const u of this.state.units) {
      const { x, y } = tileCenter(u.pos);
      const container = this.add.container(x, y);
      let body: Phaser.GameObjects.Shape;
      let labelColor = '#151a20';
      if (u.faction === 'player') {
        body = this.add.circle(0, 0, 12, COLORS.haze).setStrokeStyle(2, COLORS.navyDark);
      } else if (u.faction === 'concordat') {
        body = this.add.rectangle(0, 0, 22, 22, COLORS.concordat).setStrokeStyle(2, COLORS.bulkhead);
        labelColor = '#E8ECEF';
      } else {
        body = this.add.triangle(0, 0, 0, 22, 12, 0, 24, 22, COLORS.unbound).setStrokeStyle(2, COLORS.bulkhead);
        labelColor = '#E8ECEF';
      }
      const label = this.add
        .text(0, u.faction === 'unbound' ? 3 : 0, this.shortLabel(u), {
          fontFamily: 'Arial, sans-serif',
          fontSize: '12px',
          fontStyle: 'bold',
          color: labelColor,
        })
        .setOrigin(0.5);
      container.add([body, label]);
      this.unitSprites.set(u.id, container);
    }
  }

  private shortLabel(u: Unit): string {
    if (u.faction === 'player') return u.name.split(' ').pop()!.charAt(0);
    return (u.faction === 'concordat' ? 'C' : 'U') + u.id.replace(/\D/g, '');
  }

  private syncUnitSprites(): void {
    for (const u of this.state.units) {
      const sprite = this.unitSprites.get(u.id);
      if (!sprite) continue;
      const { x, y } = tileCenter(u.pos);
      sprite.setPosition(x, y);
      sprite.setVisible(u.hp > 0 || u.downed);
      sprite.setAlpha(isActive(u) ? 1 : 0.45);
    }
  }
}
