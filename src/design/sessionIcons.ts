// The approved session icon set (page 27, 39, 35): modelled 3D objects in
// the painted (toon) look, rendered once from the mockups' icon3d.js and
// shipped as images. See README.md for why images, and how to re-render.

import type { SessionIconKey } from './sessionIconKeys'

import bag from './assets/session-bag.png'
import core from './assets/session-core.png'
import foundation from './assets/session-foundation.png'
import mobility from './assets/session-mobility.png'
import mt from './assets/session-mt.png'
import reset from './assets/session-reset.png'
import rope from './assets/session-rope.png'
import run from './assets/session-run.png'
import strength from './assets/session-strength.png'
import waybook from './assets/session-waybook.png'
import zone2 from './assets/session-zone2.png'

export const SESSION_ICON_SRC: Readonly<Record<SessionIconKey, string>> = {
  strength, bag, mt, zone2, run, rope, foundation, reset, core, mobility, waybook,
}

export { SESSION_ICON_NAME, sessionIconFor, type SessionIconKey } from './sessionIconKeys'
