// Palette and layout shared by the scenes.
export const COLORS = {
  navy: 0x3b4654,
  navyDark: 0x232a33,
  bulkhead: 0x161b21,
  haze: 0xe8ecef,
  orange: 0xf28c28,
  contamination: 0xb5c93a,
  halfCover: 0x6f7d8c,
  fullCover: 0x97a3b0,
  concordat: 0xc8423a,
  unbound: 0xa05ac8,
  move: 0x4f9fd6,
  good: 0x6fcf7f,
  bad: 0xe05a4f,
} as const;

export const CSS = {
  haze: '#E8ECEF',
  orange: '#F28C28',
  dim: '#9aa6b2',
  contamination: '#B5C93A',
  bad: '#ff7b6e',
  good: '#7fe08f',
  dark: '#151a20',
} as const;

export const FONT = 'Arial, Helvetica, sans-serif';

export const TILE = 32;
export const MAP_X = 24;
export const MAP_Y = 44;

/** Event names on game.events, used to talk between MissionScene and UIScene. */
export const EV = {
  changed: 'mission-changed',
  endTurn: 'ui-end-turn',
  selectUnit: 'ui-select-unit',
  action: 'ui-action',
} as const;

/** Buttons the HUD can press. */
export type UiAction = 'overwatch' | 'hatch' | 'ability0' | 'ability1' | 'cancel';
