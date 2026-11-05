import * as Phaser from 'phaser';
import { airflowTarget, ABILITIES } from '../logic/abilities';
import { INFECTION_THRESHOLD, EXPOSURE_AIM_THRESHOLD, effectiveAim, effectiveMove, isActive, unitsOf } from '../logic/units';
import type { Tile, Unit } from '../logic/types';
import type { ActionButton, MissionScene, MissionView } from './MissionScene';
import { COLORS, CSS, EV, FONT, type UiAction } from './theme';

const PANEL_X = 700;
const PANEL_W = 556;
const INNER_X = PANEL_X + 20;
const INNER_W = PANEL_W - 40;

const CLASS_LABEL: Record<Unit['unitClass'], string> = {
  boardingOfficer: 'Boarding Officer',
  marineRifleman: 'Marine Rifleman',
  hospitalCorpsman: 'Hospital Corpsman',
  damageControlman: 'Damage Controlman',
  concordatMarine: 'Concordat marine',
  unboundRaider: 'Unbound raider',
};

const GEAR_LABEL: Record<Unit['gear'], string> = { none: 'No protection (x1.0)', respirator: 'Respirator (x0.6)', mopp: 'MOPP suit (x0.2)' };
const CONTAM_LABEL = ['none', 'LOW', 'MODERATE', 'SEVERE'];

function tileLabel(t: Tile): string {
  switch (t.type) {
    case 'hatch': return `Hatch (${t.hatch})`;
    case 'halfCover': return 'Half cover';
    case 'fullCover': return 'Full cover';
    case 'decon': return 'Decon station (-25 exposure at end of turn)';
    case 'console': return 'Engine control console (objective)';
    case 'fanPanel': return 'Fan control panel';
    case 'entry': return 'Entry point';
    default: return t.type.charAt(0).toUpperCase() + t.type.slice(1);
  }
}

const label = (scene: Phaser.Scene, x: number, y: number, text: string): Phaser.GameObjects.Text =>
  scene.add.text(x, y, text, { fontFamily: FONT, fontSize: '12px', fontStyle: 'bold', color: CSS.dim });

interface ButtonView {
  key: UiAction;
  rect: Phaser.GameObjects.Rectangle;
  text: Phaser.GameObjects.Text;
}

/** HUD overlay: round, squad roster, selected unit, actions, context info, combat log. */
export class UIScene extends Phaser.Scene {
  private roundText!: Phaser.GameObjects.Text;
  private nameText!: Phaser.GameObjects.Text;
  private subText!: Phaser.GameObjects.Text;
  private statText!: Phaser.GameObjects.Text;
  private statsLine!: Phaser.GameObjects.Text;
  private barGfx!: Phaser.GameObjects.Graphics;
  private infoText!: Phaser.GameObjects.Text;
  private logText!: Phaser.GameObjects.Text;
  private rosterTexts: Phaser.GameObjects.Text[] = [];
  private buttons: ButtonView[] = [];
  private endTurnBtn!: Phaser.GameObjects.Rectangle;
  private endTurnText!: Phaser.GameObjects.Text;

  constructor() {
    super('UIScene');
  }

  create(): void {
    this.rosterTexts = [];
    this.buttons = [];
    const bg = this.add.graphics();
    bg.fillStyle(COLORS.navyDark, 1).fillRoundedRect(PANEL_X, 24, PANEL_W, 672, 6);

    this.add.text(INNER_X, 34, 'LAST WATCH', { fontFamily: FONT, fontSize: '22px', fontStyle: 'bold', color: CSS.orange });
    this.add.text(INNER_X + 150, 40, 'Mission 01: Engine Room', { fontFamily: FONT, fontSize: '15px', color: CSS.dim });
    this.add.text(24, 14, 'Objective: hold a tile next to the console with no enemy within 3 tiles, or eliminate all hostiles.', {
      fontFamily: FONT, fontSize: '13px', color: CSS.dim,
    });
    this.roundText = this.add.text(INNER_X, 68, '', { fontFamily: FONT, fontSize: '18px', color: CSS.haze });

    // End turn.
    const bx = PANEL_X + PANEL_W - 100;
    this.endTurnBtn = this.add.rectangle(bx, 80, 160, 38, COLORS.orange).setInteractive({ useHandCursor: true });
    this.endTurnText = this.add.text(bx, 80, 'END TURN  ⏎', { fontFamily: FONT, fontSize: '15px', fontStyle: 'bold', color: CSS.dark }).setOrigin(0.5);
    this.endTurnBtn.on('pointerdown', () => this.game.events.emit(EV.endTurn));

    // Squad roster.
    label(this, INNER_X, 106, 'SQUAD  (click or Tab)');
    for (let i = 0; i < 4; i++) {
      const t = this.add
        .text(INNER_X, 124 + i * 21, '', { fontFamily: FONT, fontSize: '14px', color: CSS.haze })
        .setInteractive({ useHandCursor: true });
      t.on('pointerdown', () => {
        const id = t.getData('unitId') as string | undefined;
        if (id) this.game.events.emit(EV.selectUnit, id);
      });
      this.rosterTexts.push(t);
    }

    // Selected unit.
    label(this, INNER_X, 214, 'SELECTED');
    this.nameText = this.add.text(INNER_X, 230, '', { fontFamily: FONT, fontSize: '17px', fontStyle: 'bold', color: CSS.haze });
    this.subText = this.add.text(INNER_X, 252, '', { fontFamily: FONT, fontSize: '13px', color: CSS.dim });
    this.barGfx = this.add.graphics();
    this.statText = this.add.text(INNER_X, 274, '', { fontFamily: FONT, fontSize: '13px', color: CSS.haze, lineSpacing: 7 });
    this.statsLine = this.add.text(INNER_X + 250, 274, '', { fontFamily: FONT, fontSize: '13px', color: CSS.haze, lineSpacing: 7 });
    this.add.text(INNER_X + 312, 274, 'AP', { fontFamily: FONT, fontSize: '13px', color: CSS.haze });

    // Action buttons.
    const bw = (INNER_W - 18) / 4;
    for (let i = 0; i < 4; i++) {
      const x = INNER_X + i * (bw + 6) + bw / 2;
      const rect = this.add.rectangle(x, 340, bw, 38, COLORS.navy).setStrokeStyle(1, COLORS.halfCover).setInteractive({ useHandCursor: true });
      const text = this.add.text(x, 340, '', { fontFamily: FONT, fontSize: '12px', fontStyle: 'bold', color: CSS.haze, align: 'center' }).setOrigin(0.5);
      const view: ButtonView = { key: 'overwatch', rect, text };
      rect.on('pointerdown', () => this.game.events.emit(EV.action, view.key));
      this.buttons.push(view);
    }

    label(this, INNER_X, 368, 'INFO');
    this.infoText = this.add.text(INNER_X, 386, '', {
      fontFamily: FONT, fontSize: '14px', color: CSS.haze, lineSpacing: 3, wordWrap: { width: INNER_W },
    });

    label(this, INNER_X, 548, 'LOG');
    this.logText = this.add.text(INNER_X, 566, '', {
      fontFamily: FONT, fontSize: '13px', color: CSS.haze, lineSpacing: 2, wordWrap: { width: INNER_W },
    });

    this.add.text(24, 692, 'Click: move / shoot / open hatch    Tab: next unit    O: overwatch    H: hatch    1-2: abilities    Esc: cancel    Enter: end turn', {
      fontFamily: FONT, fontSize: '12px', color: CSS.dim,
    }).setOrigin(0, 0.5);

    const onChanged = (view: MissionView): void => this.renderView(view);
    this.game.events.on(EV.changed, onChanged);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.game.events.off(EV.changed, onChanged));

    const mission = this.scene.get('MissionScene') as MissionScene;
    this.renderView(mission.view());
  }

  private renderView(view: MissionView): void {
    const { state, selected } = view;
    const roundsLeft = state.maxRounds - state.round;
    this.roundText.setText(
      `Round ${state.round} / ${state.maxRounds}   ${state.phase === 'player' ? 'Player phase' : 'Enemy phase'}` +
        (roundsLeft <= 3 && state.outcome === 'ongoing' ? `   ⚠ ${roundsLeft} left` : ''),
    );
    const canEnd = state.phase === 'player' && !view.busy && state.outcome === 'ongoing';
    this.endTurnBtn.setFillStyle(canEnd ? COLORS.orange : COLORS.halfCover);
    this.endTurnText.setText(view.busy ? 'RESOLVING…' : 'END TURN  ⏎');

    unitsOf(state, 'player').forEach((u, i) => {
      const t = this.rosterTexts[i];
      if (!t) return;
      const tags = [u.overwatch ? 'OW' : '', u.infected ? 'INFECTED' : ''].filter(Boolean).join(' ');
      const status = u.downed ? 'DOWNED' : `HP ${u.hp}/${u.maxHp}   AP ${u.ap}   EXP ${u.exposure}`;
      t.setText(`${selected?.id === u.id ? '▶ ' : '   '}${u.name}   ${status}${tags ? '   ' + tags : ''}`);
      t.setColor(u.downed ? CSS.bad : !isActive(u) || u.ap === 0 || u.turnEnded ? CSS.dim : CSS.haze);
      t.setData('unitId', u.id);
    });

    this.renderSelected(selected);
    this.renderButtons(view.buttons, view.busy);
    this.infoText.setText(this.infoLines(view));
    this.logText.setText(state.log.slice(-7));
  }

  private renderSelected(u: Unit | null): void {
    const g = this.barGfx;
    g.clear();
    if (!u) {
      this.nameText.setText('No unit selected');
      this.subText.setText('Click a squad member or press Tab.');
      this.statText.setText('');
      this.statsLine.setText('');
      return;
    }
    this.nameText.setText(u.name);
    this.subText.setText(`${CLASS_LABEL[u.unitClass]}   ·   ${GEAR_LABEL[u.gear]}`);
    this.statText.setText(['HP', 'EXP']);
    const barX = INNER_X + 40;
    const barW = 200;
    // HP bar.
    g.fillStyle(COLORS.bulkhead, 1).fillRect(barX, 276, barW, 12);
    g.fillStyle(COLORS.good, 1).fillRect(barX, 276, (barW * u.hp) / u.maxHp, 12);
    // Exposure bar with the 50 (aim penalty) mark.
    g.fillStyle(COLORS.bulkhead, 1).fillRect(barX, 298, barW, 12);
    g.fillStyle(u.infected ? COLORS.bad : COLORS.contamination, 1).fillRect(barX, 298, (barW * Math.min(u.exposure, INFECTION_THRESHOLD)) / INFECTION_THRESHOLD, 12);
    g.lineStyle(2, COLORS.haze, 0.8).lineBetween(barX + (barW * EXPOSURE_AIM_THRESHOLD) / 100, 296, barX + (barW * EXPOSURE_AIM_THRESHOLD) / 100, 312);
    // AP pips.
    for (let i = 0; i < Math.max(2, u.ap); i++) {
      g.fillStyle(i < u.ap ? COLORS.orange : COLORS.bulkhead, 1).fillCircle(INNER_X + 340 + i * 18, 282, 6);
    }
    const aim = effectiveAim(u);
    const move = effectiveMove(u);
    const aimNote = aim < u.aim ? ` (${aim - u.aim})` : '';
    const moveNote = move < u.move ? ' (-1)' : '';
    this.statsLine.setText([
      `${u.hp}/${u.maxHp}`,
      `${u.exposure}/100${u.infected ? ' INF' : ''}   Aim ${aim}${aimNote}   Move ${move}${moveNote}   Dmg ${u.damage[0]}-${u.damage[1]}`,
    ]);
  }

  private renderButtons(list: ActionButton[], busy: boolean): void {
    this.buttons.forEach((b, i) => {
      const data = list[i];
      b.rect.setVisible(!!data);
      b.text.setVisible(!!data);
      if (!data) return;
      b.key = data.key;
      b.text.setText(`${data.label} [${data.hotkey}]\n${data.apCost} AP`);
      const enabled = data.enabled && !busy;
      b.rect.setFillStyle(data.active ? COLORS.orange : enabled ? COLORS.navy : COLORS.bulkhead);
      b.text.setColor(data.active ? CSS.dark : enabled ? CSS.haze : CSS.dim);
    });
  }

  private infoLines(view: MissionView): string[] {
    const { state, selected } = view;
    const lines: string[] = [];
    if (view.busy) return [state.phase === 'enemy' ? 'Enemy phase: watch the board…' : 'Resolving…'];
    if (state.outcome !== 'ongoing') return [state.outcome === 'victory' ? 'MISSION COMPLETE' : 'MISSION FAILED', state.outcomeReason];
    if (view.hint) lines.push(`⚠ ${view.hint}`, '');

    if (view.mode.kind === 'ability') {
      const def = ABILITIES[view.mode.id];
      lines.push(`${def.name} (${def.apCost} AP${def.cooldown ? `, cooldown ${def.cooldown}` : ''})`, def.description, 'Click a highlighted tile. Esc or right-click cancels.');
      return lines;
    }
    if (view.mode.kind === 'hatch') {
      lines.push('Open or close a hatch (1 AP).', 'Shut hatches block movement, sight, and contamination.', 'Click a highlighted hatch. Esc cancels.');
      return lines;
    }

    if (view.shot) {
      const { target, preview: p } = view.shot;
      lines.push(`TARGET: ${target.name}   HP ${target.hp}/${target.maxHp}`);
      lines.push(`Hit chance ${p.hitChance}%   (range ${p.distance})`);
      lines.push(p.flanked ? 'FLANKED: no cover between you, it cannot graze' : `In ${p.cover} cover: ${p.grazeChance}% of hits graze`);
      lines.push(`Damage ${p.damage[0]}-${p.damage[1]} on a hit, ${p.grazeDamage[0]}-${p.grazeDamage[1]} on a graze`);
      lines.push(view.shot.canShoot ? 'Click to fire (1 AP, ends this unit’s turn).' : `Cannot fire: ${view.shot.reason}`);
      return lines;
    }

    if (view.movePreview && selected) {
      const m = view.movePreview;
      lines.push(`Move ${m.steps} tiles for ${m.apCost} AP.`);
      const e = m.exposure;
      if (e.net > 0) lines.push(`Ending the turn here: +${e.gain} exposure (${selected.exposure} → ${Math.min(100, selected.exposure + e.net)})${e.infects ? '  ⚠ INFECTION' : ''}`);
      else if (e.decon > 0) lines.push(`Ending the turn here: decon −${e.decon} exposure.`);
      else lines.push('Ending the turn here: no exposure.');
      if (m.contaminatedTiles > 0) lines.push(`Path crosses ${m.contaminatedTiles} contaminated tile(s): only where you end the turn counts.`);
      lines.push('');
    }

    const t = view.hoverTile;
    if (t && view.hover) {
      lines.push(`${tileLabel(t)}   (${view.hover.x}, ${view.hover.y})${t.room ? `   ${t.room}` : ''}`);
      if (t.type !== 'bulkhead') lines.push(`Contamination: ${CONTAM_LABEL[t.contamination]}`);
      if (selected && view.hoverExposure && t.type !== 'bulkhead' && !view.movePreview) {
        const e = view.hoverExposure;
        if (e.gain > 0) lines.push(`${selected.name.split(' ').pop()} would gain +${e.gain} exposure ending a turn here.`);
      }
      if (state.vents.some((v) => v.x === view.hover!.x && v.y === view.hover!.y)) {
        lines.push(`Vent: airflow runs toward the ${airflowTarget(state)}.`);
      }
      const u = view.hoverUnit;
      if (u) {
        lines.push(`${u.name} (${CLASS_LABEL[u.unitClass]})  HP ${u.hp}/${u.maxHp}  EXP ${u.exposure}${u.infected ? ' INFECTED' : ''}${u.downed ? '  DOWNED' : ''}`);
      }
    } else if (lines.length === 0) {
      lines.push('Hover a tile for details. Red outlines mark enemies you can shoot.');
      lines.push('Blue: move for 1 AP. Faint blue: 2 AP. Yellow-green hatching: contamination.');
    }
    return lines;
  }
}
