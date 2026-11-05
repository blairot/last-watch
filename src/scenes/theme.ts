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
  moveOneAp: 0x4f9fd6,
  // Two-AP range uses the same blue at lower strength so it never reads as contamination.
  moveTwoAp: 0x4f9fd6,
} as const;

export const CSS = {
  haze: '#E8ECEF',
  orange: '#F28C28',
  dim: '#9aa6b2',
  contamination: '#B5C93A',
} as const;

export const TILE = 32;
export const MAP_X = 24;
export const MAP_Y = 40;

/** Event names on game.events, used to talk between MissionScene and UIScene. */
export const EV = {
  changed: 'mission-changed',
  endTurn: 'ui-end-turn',
  selectUnit: 'ui-select-unit',
} as const;
