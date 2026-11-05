import * as Phaser from 'phaser';

/** Asset loading. The demo currently uses only drawn shapes, so this just hands off. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  create(): void {
    this.scene.start('MissionScene');
  }
}
