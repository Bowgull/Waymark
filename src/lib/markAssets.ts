// Session marks and accents, now the approved painted icon set (page 27; Library
// categories page 39) and their colours. Kept as the old API so every screen
// that used the PNG marks shows the new icons.
import onePaceSvg from '@/assets/brand/OnePace.svg'
import crestSmall from '@/design/assets/crest-small.png'
import { SESSION_COLOURS } from '@/design/tokens'
import { SESSION_ICON_NAME, SESSION_ICON_SRC, sessionIconFor, type SessionIconKey } from '@/design/sessionIcons'

export interface MarkAsset {
  png: string
  label: string
  key: SessionIconKey
}

function mark(key: SessionIconKey): MarkAsset {
  return { png: SESSION_ICON_SRC[key], label: SESSION_ICON_NAME[key], key }
}

/** The painted icon and name for a session type (runs: Zone 2 dial vs the shoe by run category). */
export function getMarkAsset(sessionType: string, runCategory?: string | null): MarkAsset {
  return mark(sessionIconFor(sessionType, runCategory))
}

export function getSessionLabel(sessionType: string, runCategory?: string | null): string {
  return getMarkAsset(sessionType, runCategory).label
}

/** The session's own colour (page 27): ring timers, progress bars, accents. */
export function getSessionAccent(sessionType: string, runCategory?: string | null): string {
  return SESSION_COLOURS[sessionIconFor(sessionType, runCategory)]
}

/** Library categories (page 39): Core is the kettlebell (slate teal), Mobility the foam roller (sand). */
const CATEGORY_KEY: Record<string, SessionIconKey> = {
  strength: 'strength',
  core: 'core',
  posture: 'foundation',
  mobility: 'mobility',
}

export function getCategoryMark(category: string): MarkAsset {
  return mark(CATEGORY_KEY[category] ?? 'foundation')
}

/** The crest (small, crisp) replaces the old logo everywhere; the Waybook is the leather journal. */
const logoPng = crestSmall
const waybookPng = SESSION_ICON_SRC.waybook
export { logoPng, waybookPng, onePaceSvg }
