import * as Phaser from 'phaser';
import { COLORS, CSS, FONT } from './theme';

const BRIEF = [
  'USS Halyard (DDG-131) has the only viable path to a vaccine. To keep moving, she needs fuel,',
  'and the disabled tanker off her bow has it. Enemy boarders got there first.',
  '',
  'Seize the tanker’s engine room control console before round 15 ends.',
  '',
  'Victory: end a turn with a squad member next to the console and no enemy within 3 tiles of it,',
  'or eliminate every hostile.   Defeat: the whole squad is down, or round 15 ends.',
  '',
  'Concordat marines (red squares) wear MOPP suits and hold cover around the console.',
  'Unbound raiders (purple triangles) have no protection, fight aggressively, and fear contamination.',
  '',
  'The sickbay ruptured. Contamination spreads every round through open hatches and the vent ducts.',
  'Seal hatches, reach the fan control panel in Aux Machinery, and reverse the fans to flood the',
  'engine room. Keep your own exposure down with the Corpsman and the decon station.',
];

const SQUAD = [
  'LCDR Marcus Holt, Boarding Officer: Coordinated Assault gives an ally +1 AP',
  'GySgt Rosa Abernathy, Marine Rifleman: Breach forces any hatch and staggers enemies behind it',
  'HM2 Theo Lindqvist, Hospital Corpsman: Decon Spray, Stabilize downed allies',
  'DC1 Ana Ferreira, Damage Controlman: Weld hatches, Reverse Fan at the fan panel',
];

/** Short mission briefing before the map. */
export class BriefingScene extends Phaser.Scene {
  constructor() {
    super('BriefingScene');
  }

  create(): void {
    const g = this.add.graphics();
    g.fillStyle(COLORS.navyDark, 1).fillRoundedRect(90, 40, 1100, 640, 8);
    g.fillStyle(COLORS.orange, 1).fillRect(90, 40, 8, 640);

    this.add.text(130, 66, 'LAST WATCH', { fontFamily: FONT, fontSize: '40px', fontStyle: 'bold', color: CSS.orange });
    this.add.text(132, 116, 'Mission 01: Engine Room  ·  Boarding operation', { fontFamily: FONT, fontSize: '18px', color: CSS.dim });
    this.add.text(130, 156, BRIEF, { fontFamily: FONT, fontSize: '16px', color: CSS.haze, lineSpacing: 4 });
    this.add.text(130, 508, 'BOARDING PARTY', { fontFamily: FONT, fontSize: '13px', fontStyle: 'bold', color: CSS.dim });
    this.add.text(130, 528, SQUAD, { fontFamily: FONT, fontSize: '15px', color: CSS.haze, lineSpacing: 4 });

    const btn = this.add.rectangle(1040, 640, 220, 48, COLORS.orange).setInteractive({ useHandCursor: true });
    this.add.text(1040, 640, 'BEGIN  ⏎', { fontFamily: FONT, fontSize: '20px', fontStyle: 'bold', color: CSS.dark }).setOrigin(0.5);
    const start = (): void => {
      this.scene.start('MissionScene');
    };
    btn.on('pointerdown', start);
    this.input.keyboard?.once('keydown-ENTER', start);
    this.input.keyboard?.once('keydown-SPACE', start);
  }
}
