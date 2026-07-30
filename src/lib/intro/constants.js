// ─────────────────────────────────────────────────────────────────────────────
// Tuning knobs for the whole sequence. Timings are matched (roughly) against
// the Capcom vs. SNK "Expressway, Japan" stage-intro recording.
// ─────────────────────────────────────────────────────────────────────────────

export const GAME_W = 640
export const GAME_H = 480

// Sequence phases. The scene reports these to Svelte via the `onphase`
// callback so overlay UI can react declaratively.
export const PHASE = {
  BOOT: 'boot',
  MOSAIC: 'mosaic', // white TV-blob wipe revealing the racer
  RACE: 'race', //     driving down the night expressway
  CRASH: 'crash', //   fireball on the truck
  FLASH: 'flash', //   white-out while the set is swapped
  STAGE: 'stage', //   burning expressway, PRESS START blinking
}

// Timeline, in ms.
export const T = {
  mosaic: 1000,
  crashHold: 1500,
  flashIn: 300,
  flashHold: 700,
  flashOut: 900,
}

// Pseudo-3D road. World units are arbitrary; only the ratios matter.
export const ROAD = {
  segLen: 220, //      world units per segment
  drawDist: 60, //     segments drawn per frame
  width: 1050, //      half-width of the road
  camHeight: 560,
  camDepth: 0.82, //   ≈ 1 / tan(fov / 2)
  swayAmp: 0.55, //    gentle S-curve, as a fraction of road width
  swayFreq: 1 / 9000, // radians per world unit
  lanes: 3,
}

export const RACE = {
  speedStart: 5200, // world units per second
  speedMax: 8400,
  accel: 1400,
  truckLead: 15000, // truck's head start — determines how long the race lasts
  truckSpeed: 4300, // slower than us, so the gap closes
  crashGap: 1600, //  impact when we get this close
  clockStart: 89.2, // TIME starts at 1'29"2, like the recording
}

export const UI = {
  font: '"Courier New", ui-monospace, monospace',
  cjkFont: '"Yu Gothic", "MS Gothic", "Hiragino Kaku Gothic ProN", sans-serif',
}

// Palette — night expressway blues, CvS fire oranges.
export const C = {
  road: 0x2c3444,
  roadAlt: 0x293040,
  rumble: 0xb8c4d8,
  lane: 0xaab6cc,
  rail: 0x66738c,
  railDark: 0x39435a,
  building: 0x0d1230,
  buildingLit: 0xffd23e,
  fire1: 0xff7a00,
  fire2: 0xffc400,
  fire3: 0xfff3c0,
}
