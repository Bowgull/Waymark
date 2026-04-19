export function getSessionIntent(sessionType: string): string {
  switch (sessionType) {
    case 'strength':
      return 'Build the frame. Compound lifts, clean reps.'
    case 'foundation_run':
      return 'Aerobic base. Conversational pace, nasal breathing.'
    case 'running':
      return 'Interval work. Push the edges of the pace.'
    case 'mt_class':
      return 'Live skill. Pads, drills, sparring if it happens.'
    case 'bag_work':
      return 'Solo rounds. Combos and timing on the bag.'
    case 'mobility':
      return 'Undo the desk. Breathing, upper release, lower mobility.'
    case 'active_recovery':
      return 'Keep blood moving. Nothing heavy.'
    case 'skip_rope':
      return 'Footwork. Light conditioning.'
    default:
      return 'Show up and put in the work.'
  }
}

type ZoneBand = { label: string; low: number; high: number }

// Zone % ranges off max HR. Standard 5-zone model.
const ZONE_2: ZoneBand = { label: 'Zone 2', low: 0.6, high: 0.7 }
const ZONE_2_TO_4: ZoneBand = { label: 'Zone 2 to 4', low: 0.6, high: 0.9 }

function pickZone(sessionType: string, runCategory: string | null): ZoneBand | null {
  if (sessionType === 'foundation_run') return ZONE_2
  if (sessionType === 'running') {
    if (runCategory === 'zone2') return ZONE_2
    if (runCategory === 'progression') return ZONE_2_TO_4
  }
  return null
}

// Target HR line for a running session. Returns null when session has no
// defined zone, or when user's max_hr hasn't been observed / set yet.
// Copy matches voice canon: "Zone 2. 114 to 133 bpm."
export function getSessionTargetHr(
  sessionType: string,
  runCategory: string | null,
  maxHr: number | null,
): string | null {
  if (maxHr == null || maxHr <= 0) return null
  const zone = pickZone(sessionType, runCategory)
  if (!zone) return null
  const low = Math.round(maxHr * zone.low)
  const high = Math.round(maxHr * zone.high)
  return `${zone.label}. ${low} to ${high} bpm.`
}
