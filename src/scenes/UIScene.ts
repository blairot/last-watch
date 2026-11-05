import * as Phaser from 'phaser';
import { isActive, unitsOf } from '../logic/turn';
import type { Tile, Unit } from '../logic/types';
import type { MissionScene, MissionView } from './MissionScene';
import { COLORS, CSS, EV } from './theme';

const PANEL_X = 700;
const PANEL_W = 556;
const FONT = 'Arial, sans-serif';

const CLASS_LABEL: Record<Unit['unitClass'], string> = {
  boardingOfficer: 'Boarding Officer',
  marineRifleman: 'Marine Rifleman',
  hospitalCorpsman: 'Hospital Corpsman',
  damageControlman: 'Damage Controlman',
  concordatMarine: 'Concordat marine',
  unboundRaider: 'Unbound raider',
};

const GEAR_LABEL: Record<Unit['gear'], string> = { none: 'No protection', respirator: 'Respirator', mopp: 'MOPP suit' };
const CONTAM_LABEL = ['none', 'low', 'moderate', 'severe'];

function tileLabel(t: Tile): string {
  switch (t.type) {
    case 'hatch': return `Hatch (${t.hatch})`;
    case 'halfCover': return 'Half cover';
    case 'fullCover': return 'Full cover';
    case 'decon': return 'Decon station';
    case 'console': return 'Control console (objective)';
    case 'fanPanel': return 'Fan control panel';
    case 'entry': return 'Entry point';
    default: return t.type.charAt(0).toUpperCase() + t.type.slice(1);
  }
}

/** HUD overlay: round info, selected unit, hover info, squad roster, combat log. */
export class UIScene extends Phaser.Scene {
  private roundText!: Phaser.GameObjects.Text;
  private unitText!: Phaser.GameObjects.Text;
  private hoverText!: Phaser.GameObjects.Text;
  private logText!: Phaser.GameObjects.Text;
  private rosterTexts: Phaser.GameObjects.Text[] = [];
  private endTurnBtn!: Phaser.GameObjects.Rectangle;

  constructor() {
    super('UIScene');
  }

  create(): void {
    this.rosterTexts = [];
    const bg = this.add.graphics();
    bg.fillStyle(COLORS.navyDark, 1).fillRoundedRect(PANEL_X, 24, PANEL_W, 672, 6);

    this.add.text(PANEL_X + 20, 36, 'LAST WATCH', { fontFamily: FONT, fontSize: '22px', fontStyle: 'bold', color: CSS.orange });
    this.add.text(PANEL_X + 170, 42, 'Mission 01: Engine Room', { fontFamily: FONT, fontSize: '15px', color: CSS.dim });
    this.add.text(24, 12, 'Seize the engine room console. Tab: next unit   Esc: deselect   Enter: end turn', {
      fontFamily: FONT, fontSize: '14px', color: CSS.dim,
    });

    this.roundText = this.add.text(PANEL_X + 20, 74, '', { fontFamily: FONT, fontSize: '18px', color: CSS.haze });

    // Squad roster (clickable).
    this.add.text(PANEL_X + 20, 112, 'SQUAD', { fontFamily: FONT, fontSize: '12px', fontStyle: 'bold', color: CSS.dim });
    for (let i = 0; i < 4; i++) {
      const t = this.add
        .text(PANEL_X + 20, 130 + i * 22, '', { fontFamily: FONT, fontSize: '15px', color: CSS.haze })
        .setInteractive({ useHandCursor: true });
      t.on('pointerdown', () => {
        const id = t.getData('unitId') as string | undefined;
        if (id) this.game.events.emit(EV.selectUnit, id);
      });
      this.rosterTexts.push(t);
    }

    this.add.text(PANEL_X + 20, 228, 'SELECTED', { fontFamily: FONT, fontSize: '12px', fontStyle: 'bold', color: CSS.dim });
    this.unitText = this.add.text(PANEL_X + 20, 246, '', { fontFamily: FONT, fontSize: '15px', color: CSS.haze, lineSpacing: 4 });

    this.add.text(PANEL_X + 300, 228, 'TILE', { fontFamily: FONT, fontSize: '12px', fontStyle: 'bold', color: CSS.dim });
    this.hoverText = this.add.text(PANEL_X + 300, 246, '', {
      fontFamily: FONT, fontSize: '15px', color: CSS.haze, lineSpacing: 4, wordWrap: { width: 236 },
    });

    this.add.text(PANEL_X + 20, 440, 'LOG', { fontFamily: FONT, fontSize: '12px', fontStyle: 'bold', color: CSS.dim });
    this.logText = this.add.text(PANEL_X + 20, 458, '', {
      fontFamily: FONT, fontSize: '14px', color: CSS.haze, lineSpacing: 3, wordWrap: { width: PANEL_W - 40 },
    });

    // End turn button.
    const bx = PANEL_X + PANEL_W - 110;
    const by = 84;
    this.endTurnBtn = this.add
      .rectangle(bx, by, 160, 40, COLORS.orange)
      .setInteractive({ useHandCursor: true });
    this.add.text(bx, by, 'END TURN', { fontFamily: FONT, fontSize: '16px', fontStyle: 'bold', color: '#151a20' }).setOrigin(0.5);
    this.endTurnBtn.on('pointerdown', () => this.game.events.emit(EV.endTurn));
    this.endTurnBtn.on('pointerover', () => this.endTurnBtn.setFillStyle(0xffa04a));
    this.endTurnBtn.on('pointerout', () => this.endTurnBtn.setFillStyle(COLORS.orange));

    const onChanged = (view: MissionView): void => this.render(view);
    this.game.events.on(EV.changed, onChanged);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.game.events.off(EV.changed, onChanged));

    const mission = this.scene.get('MissionScene') as MissionScene;
    this.render(mission.view());
  }

  private render(view: MissionView): void {
    const { state, selected } = view;
    this.roundText.setText(`Round ${state.round} / ${state.maxRounds}    ${state.phase === 'player' ? 'Player phase' : 'Enemy phase'}`);

    const squad = unitsOf(state, 'player');
    squad.forEach((u, i) => {
      const t = this.rosterTexts[i];
      if (!t) return;
      const status = u.downed ? 'DOWNED' : `HP ${u.hp}/${u.maxHp}   AP ${u.ap}`;
      t.setText(`${selected?.id === u.id ? '▶ ' : '   '}${u.name}   ${status}`);
      t.setColor(!isActive(u) ? CSS.dim : u.ap === 0 ? CSS.dim : CSS.haze);
      t.setData('unitId', u.id);
    });

    if (selected) {
      const lines = [
        selected.name,
        CLASS_LABEL[selected.unitClass],
        `HP ${selected.hp}/${selected.maxHp}    AP ${selected.ap}`,
        `Move ${selected.move}    Aim ${selected.aim}`,
        `Damage ${selected.damage[0]}-${selected.damage[1]}`,
        `${GEAR_LABEL[selected.gear]}    Exposure ${selected.exposure}`,
      ];
      if (view.preview) lines.push('', `Move here: ${view.preview.steps} tiles, ${view.preview.apCost} AP`);
      this.unitText.setText(lines);
    } else {
      this.unitText.setText('No unit selected.\nClick a squad member or press Tab.');
    }

    const t = view.hoverTile;
    if (t && view.hover) {
      const occupant = state.units.find((u) => (u.hp > 0 || u.downed) && u.pos.x === view.hover!.x && u.pos.y === view.hover!.y);
      const lines = [
        `${tileLabel(t)}  (${view.hover.x}, ${view.hover.y})`,
        t.room ? t.room : '',
        `Contamination: ${CONTAM_LABEL[t.contamination]}`,
      ].filter(Boolean);
      if (state.vents.some((v) => v.x === view.hover!.x && v.y === view.hover!.y)) {
        lines.push(`Airflow: ${state.ventDirection === 1 ? 'sickbay → squad side' : 'sickbay → engine room'}`);
      }
      if (occupant) lines.push('', `${occupant.name}`, `HP ${occupant.hp}/${occupant.maxHp}`);
      this.hoverText.setText(lines);
    } else {
      this.hoverText.setText('Hover a tile for details.');
    }

    this.logText.setText(state.log.slice(-10));
  }
}
