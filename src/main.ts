import * as Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { MissionScene } from './scenes/MissionScene';
import { UIScene } from './scenes/UIScene';

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#151a20',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 1280,
    height: 720,
  },
  scene: [BootScene, MissionScene, UIScene],
});
