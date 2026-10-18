// Waymark design tokens (the redesign, design-decisions.md). The CSS twins
// live in design.css as custom properties; these are for code that needs a
// colour or a duration in JS (canvas, inline styles, tests).

/** The muted split-flap palette: brass for "now / your action", moss-teal for good, clay for a warning. */
export const FLAP = {
  tile: '#262a26',
  tile2: '#1d201d',
  ink: '#f0e6c0',
  brass: '#b8984a',
  brass2: '#a0823c',
  teal: '#45796a',
  teal2: '#3a6658',
  clay: '#9c5a40',
  clay2: '#864a34',
  /** The small brass sun / moon beside the AM / PM flap. */
  mark: '#c9a656',
} as const

/** The Waymark palette the app already had (index.css). Bright accents, used sparingly. */
export const WAYMARK = {
  gold: '#E8C860',
  goldDark: '#C8A030',
  teal: '#4ACAAA',
  tealDark: '#1E8A68',
  clay: '#C45A3C',
  forest: '#2D6B4F',
  forestLight: '#4ABA8A',
  deep: '#081A14',
  nearBlack: '#020A08',
  cream: '#F0EDE4',
} as const

/** One colour per session icon (page 27, page 39). */
export const SESSION_COLOURS = {
  strength: '#e4dcc4',
  bag: '#6c6862',
  mt: '#c89848',
  zone2: '#b0604a',
  run: '#c8844e',
  rope: '#8a6a9a',
  foundation: '#6e9858',
  reset: '#6a96b4',
  core: '#4a8c8a',
  mobility: '#a8906a',
  waybook: '#8a5634',
} as const

/** Soreness tile colours (Ledger key): fresh blue, loose green, normal sand, sore orange, cooked red. */
export const SORENESS_COLOURS = ['#6a96b4', '#6e9858', '#c9b27a', '#c8844e', '#b0503a'] as const

/** Four speeds only (motion rules): tap 90, small change 180, move 320, moment 700 ms. */
export const MOTION = {
  tapMs: 90,
  quickMs: 180,
  moveMs: 320,
  momentMs: 700,
  /** A split flap always lands within this. */
  flapMaxMs: 900,
  /** Pop-up flap board stays this long before it lifts away. */
  popHoldMs: 2400,
} as const

/** Readable minimums on an iPhone (px). */
export const TEXT_MIN = { prose: 16, dim: 15, label: 12, flapXs: 14, flapSm: 17, tag: 11 } as const
