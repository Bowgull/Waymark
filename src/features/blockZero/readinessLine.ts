// The readiness line on Today's hero card (Block Zero Phase C, direction 5):
// one line from GET /api/readiness/today; tap it to see why. (The lantern
// dimming on eased days belongs to the world, step 2.) Pure.

export interface ReadinessItemIn {
  item: string
  today: number | null
  mean7: number | null
  worse: boolean
}

export interface ReadinessIn {
  checkedIn: boolean
  ease: boolean
  readinessEase?: boolean
  flaggedToday?: boolean
  worseItems?: string[]
  reason: string | null
  items?: ReadinessItemIn[]
  load?: { flagged?: boolean; applies?: boolean; reason?: string | null } | null
  blockZero?: boolean
}

export interface ReadinessLineView {
  tone: 'good' | 'bad'
  /** The line itself. */
  text: string
  /** What tapping shows. */
  why: string
}

const WORDS: Record<string, string> = {
  sleepHours: 'sleep',
  sleepQuality: 'sleep quality',
  energy: 'energy',
  soreness: 'soreness',
  stress: 'stress',
  mood: 'mood',
  backToday: 'back',
  alcohol: 'alcohol',
  cannabis: 'herb',
}

function joinWords(words: string[]): string {
  if (words.length <= 1) return words[0] ?? ''
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Null when there is nothing to say yet (no check-in today). */
export function readinessLine(r: ReadinessIn | null | undefined): ReadinessLineView | null {
  if (!r || !r.checkedIn) return null
  const worse = (r.worseItems ?? []).map(i => WORDS[i] ?? i)
  if (r.ease) {
    const what = worse.length > 0 ? `${capital(joinWords(worse))} off trend.` : 'Load is up.'
    return { tone: 'bad', text: `Easing today. ${what}`, why: r.reason ?? 'Off your 7-day trend.' }
  }
  if (worse.length > 0) {
    return { tone: 'good', text: 'Good to go.', why: `${capital(joinWords(worse))} ${worse.length === 1 ? 'is' : 'are'} off your 7-day trend today. One day doesn't change the plan.` }
  }
  const hasBaseline = (r.items ?? []).some(i => i.today != null && i.mean7 != null)
  if (!hasBaseline) return { tone: 'good', text: 'Good to go.', why: 'Not enough check-ins yet for a 7-day average. Keep logging.' }
  return { tone: 'good', text: 'Good to go.', why: 'Everything is near your 7-day average.' }
}
