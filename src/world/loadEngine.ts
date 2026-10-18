// The world engine chunk (three.js + the glyph engine), loaded once, on demand.
let engineLoad: Promise<typeof import('./engine')> | null = null

export function loadWorldEngine(): Promise<typeof import('./engine')> {
  engineLoad ??= import('./engine')
  return engineLoad
}
