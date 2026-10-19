// The readiness line (Block Zero Phase C, direction 5): one line from
// GET /api/readiness/today; tap it to see why. On Today it sits on the Morning
// Report row (page 56 item 14): LOGGED, then "Good to go." or "Easing today.
// Sleep off trend."; a tap shows the why. The lantern dims on eased days (the
// world). Pure.

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
  /** Its first sentence (bold on the Coach board). */
  lead: string
  /** The rest of the line, or '' when the lead is all of it. */
  rest: string
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

function view(tone: 'good' | 'bad', text: string, why: string): ReadinessLineView {
  const cut = text.indexOf('. ')
  const lead = cut < 0 ? text : text.slice(0, cut + 1)
  const rest = cut < 0 ? '' : text.slice(cut + 2)
  return { tone, text, lead, rest, why }
}

/** Null when there is nothing to say yet (no check-in today). */
export function readinessLine(r: ReadinessIn | null | undefined): ReadinessLineView | null {
  if (!r || !r.checkedIn) return null
  const worse = (r.worseItems ?? []).map(i => WORDS[i] ?? i)
  if (r.ease) {
    const what = worse.length > 0 ? `${capital(joinWords(worse))} off trend.` : 'Load is up.'
    return view('bad', `Easing today. ${what}`, r.reason ?? 'Off your 7-day trend.')
  }
  if (worse.length > 0) {
    return view('good', 'Good to go.', `${capital(joinWords(worse))} ${worse.length === 1 ? 'is' : 'are'} off your 7-day trend today. One day doesn't change the plan.`)
  }
  const hasBaseline = (r.items ?? []).some(i => i.today != null && i.mean7 != null)
  if (!hasBaseline) return view('good', 'Good to go.', 'Not enough check-ins yet for a 7-day average. Keep logging.')
  return view('good', 'Good to go.', 'Everything is near your 7-day average.')
}
