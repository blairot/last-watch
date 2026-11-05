import * as Phaser from 'phaser';
import type { MissionState } from '../logic/types';
import { isActive, unitsOf } from '../logic/units';
import { COLORS, CSS, FONT } from './theme';

/** Victory or defeat overlay, launched on top of the mission. */
export class EndScene extends Phaser.Scene {
  constructor() {
    super('EndScene');
  }

  create(data: { state: MissionState }): void {
    const s = data.state;
    const won = s.outcome === 'victory';
    this.add.rectangle(640, 360, 1280, 720, 0x0b0e12, 0.72).setInteractive();
    const g = this.add.graphics();
    g.fillStyle(COLORS.navyDark, 1).fillRoundedRect(340, 170, 600, 380, 8);
    g.fillStyle(won ? COLORS.good : COLORS.bad, 1).fillRect(340, 170, 600, 8);

    this.add.text(640, 222, won ? 'MISSION COMPLETE' : 'MISSION FAILED', {
      fontFamily: FONT, fontSize: '38px', fontStyle: 'bold', color: won ? CSS.good : CSS.bad,
    }).setOrigin(0.5);
    this.add.text(640, 272, s.outcomeReason, { fontFamily: FONT, fontSize: '17px', color: CSS.haze, align: 'center', wordWrap: { width: 540 } }).setOrigin(0.5);

    const squad = unitsOf(s, 'player');
    const enemies = unitsOf(s, 'enemy');
    const lines = [
      `Rounds used: ${s.round} of ${s.maxRounds}`,
      `Squad standing: ${squad.filter(isActive).length} of ${squad.length}   (infected: ${squad.filter((u) => u.infected).length})`,
      `Hostiles eliminated: ${enemies.filter((u) => !isActive(u)).length} of ${enemies.length}`,
      ...squad.map((u) => `${u.name}: ${u.downed ? 'DOWN' : `${u.hp}/${u.maxHp} HP`}, exposure ${u.exposure}`),
    ];
    this.add.text(400, 312, lines, { fontFamily: FONT, fontSize: '15px', color: CSS.haze, lineSpacing: 4 });

    const btn = this.add.rectangle(640, 512, 240, 46, COLORS.orange).setInteractive({ useHandCursor: true });
    this.add.text(640, 512, 'PLAY AGAIN  ⏎', { fontFamily: FONT, fontSize: '18px', fontStyle: 'bold', color: CSS.dark }).setOrigin(0.5);
    const restart = (): void => {
      this.scene.stop('UIScene');
      this.scene.stop('MissionScene');
      this.scene.start('BriefingScene');
    };
    btn.on('pointerdown', restart);
    this.input.keyboard?.once('keydown-ENTER', restart);
  }
}
