import * as Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { BriefingScene } from './scenes/BriefingScene';
import { EndScene } from './scenes/EndScene';
import { MissionScene } from './scenes/MissionScene';
import { UIScene } from './scenes/UIScene';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#151a20',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 1280,
    height: 720,
  },
  // Right-click cancels targeting, so keep the browser menu out of the way.
  disableContextMenu: true,
  scene: [BootScene, BriefingScene, MissionScene, UIScene, EndScene],
});

// Dev builds only: expose the game for debugging in the browser console.
if (import.meta.env.DEV) (window as unknown as { game: Phaser.Game }).game = game;
