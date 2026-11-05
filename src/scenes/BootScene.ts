import * as Phaser from 'phaser';

/** Asset loading. The demo uses only drawn shapes, so this just hands off to the briefing. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  create(): void {
    this.scene.start('BriefingScene');
  }
}
