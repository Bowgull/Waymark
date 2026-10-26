// Session icon keys and the type -> icon mapping (pure; no image imports, so
// the unit tests can run it under node).

export type SessionIconKey =
  | 'strength' | 'bag' | 'mt' | 'zone2' | 'run' | 'rope'
  | 'foundation' | 'reset' | 'core' | 'mobility' | 'waybook'

/** Display names (the approved names: the daily posture track is Foundation). */
export const SESSION_ICON_NAME: Readonly<Record<SessionIconKey, string>> = {
  strength: 'Strength',
  bag: 'Bag Work',
  mt: 'MT Class',
  zone2: 'Zone 2',
  run: 'Runs',
  rope: 'Skip Rope',
  foundation: 'Foundation',
  reset: 'Reset',
  core: 'Core',
  mobility: 'Mobility',
  waybook: 'Waybook',
}

/**
 * The icon for an app session type. Runs split by category: Zone 2 (and the
 * Zone 2 foundation run) get the heart-rate dial, other runs the shoe. The
 * internal type for Foundation stays `mobility`; Reset is `active_recovery`.
 */
export function sessionIconFor(type: string, runCategory?: string | null): SessionIconKey {
  switch (type) {
    case 'strength': return 'strength'
    case 'bag_work': return 'bag'
    // page 93: Bag Conditioning keeps the bag
    case 'bag_conditioning': return 'bag'
    case 'mt_class': return 'mt'
    case 'foundation_run': return 'zone2'
    case 'running': return runCategory === 'zone2' || runCategory == null ? 'zone2' : 'run'
    case 'skip_rope': return 'rope'
    case 'mobility': return 'foundation'
    case 'active_recovery': return 'reset'
    case 'core': return 'core'
    default: return 'foundation'
  }
}
