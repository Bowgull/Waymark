// Morning check-in as swipe cards (Block Zero Phase C, direction 1; Morning
// Report "both" in design-decisions.md): one question per card, big tiles,
// a tap answers and moves on. Shows on the first open of the day (skippable)
// and from the morning alarm's I'M UP. Pure: no React, no fetch.
//
// Scales match POST /api/daily-logs (schemas.ts): 1-5 for the detailed items
// (stress and soreness: higher is worse; back today: 1 is worst), sleep in
// hours, alcohol on its 0-10 scale, herb in grams.

export type CheckInKey =
  | 'sleepHours'
  | 'sleepQuality'
  | 'energy'
  | 'soreness'
  | 'stress'
  | 'mood'
  | 'backToday'
  | 'alcoholScale'
  | 'weedGrams'

export interface CheckInOption {
  value: number
  label: string
  sub?: string
}

export interface CheckInQuestion {
  key: CheckInKey
  title: string
  sub?: string
  options: CheckInOption[]
  columns: number
}

const FIVE = (subs: [string, string, string, string, string]): CheckInOption[] =>
  subs.map((sub, i) => ({ value: i + 1, label: String(i + 1), sub }))

export const CHECK_IN_QUESTIONS: readonly CheckInQuestion[] = [
  {
    key: 'sleepHours',
    title: 'Sleep',
    sub: 'Hours last night',
    options: [
      { value: 4, label: '4', sub: 'or less' },
      { value: 5, label: '5' },
      { value: 6, label: '6' },
      { value: 7, label: '7' },
      { value: 8, label: '8' },
      { value: 9, label: '9+', sub: 'or more' },
    ],
    columns: 3,
  },
  { key: 'sleepQuality', title: 'Sleep quality', options: FIVE(['poor', 'light', 'ok', 'good', 'deep']), columns: 5 },
  { key: 'energy', title: 'Energy', options: FIVE(['empty', 'low', 'ok', 'good', 'full']), columns: 5 },
  // The app's soreness gauge words (Fresh .. Cooked), 1-5.
  { key: 'soreness', title: 'Soreness', options: FIVE(['fresh', 'loose', 'normal', 'sore', 'cooked']), columns: 5 },
  { key: 'stress', title: 'Stress', options: FIVE(['calm', 'low', 'some', 'high', 'maxed']), columns: 5 },
  { key: 'mood', title: 'Mood', options: FIVE(['low', 'flat', 'ok', 'good', 'great']), columns: 5 },
  { key: 'backToday', title: 'Back today', sub: 'How it feels right now', options: FIVE(['bad', 'sore', 'stiff', 'good', 'fine']), columns: 5 },
  {
    key: 'alcoholScale',
    title: 'Alcohol',
    sub: 'Last night',
    options: [
      { value: 0, label: '0', sub: 'none' },
      { value: 1, label: '1' },
      { value: 2, label: '2' },
      { value: 3, label: '3+' },
    ],
    columns: 4,
  },
  {
    key: 'weedGrams',
    title: 'Herb',
    sub: 'Grams, last 24 h',
    options: [
      { value: 0, label: '0', sub: 'none' },
      { value: 0.5, label: '0.5' },
      { value: 1, label: '1' },
      { value: 2, label: '2' },
      { value: 3, label: '3+' },
    ],
    columns: 5,
  },
]

/** Back today at or below this asks what bothers it (back notes). */
export const BACK_NOTES_AT = 2

export type CheckInAnswers = Partial<Record<CheckInKey, number>>

export interface CheckInState {
  /** Card index; CHECK_IN_QUESTIONS.length = the back-notes card or done. */
  index: number
  answers: CheckInAnswers
  backNotes: string
  /** On the back-notes card (only when back today is low). */
  askingBackNotes: boolean
  done: boolean
}

export type CheckInAction =
  | { type: 'answer'; key: CheckInKey; value: number }
  | { type: 'pass' }
  | { type: 'back' }
  | { type: 'backNotes'; text: string }
  | { type: 'finishNotes' }
  | { type: 'jump'; index: number }

export function initialCheckIn(existing?: CheckInAnswers | null, startAt = 0): CheckInState {
  return { index: Math.max(0, Math.min(startAt, CHECK_IN_QUESTIONS.length - 1)), answers: { ...(existing ?? {}) }, backNotes: '', askingBackNotes: false, done: false }
}

function advance(state: CheckInState): CheckInState {
  const next = state.index + 1
  if (next < CHECK_IN_QUESTIONS.length) return { ...state, index: next, askingBackNotes: false }
  return { ...state, index: CHECK_IN_QUESTIONS.length, askingBackNotes: false, done: true }
}

export function checkInReducer(state: CheckInState, action: CheckInAction): CheckInState {
  if (state.done && action.type !== 'back' && action.type !== 'jump') return state
  switch (action.type) {
    case 'answer': {
      const answered = { ...state, answers: { ...state.answers, [action.key]: action.value } }
      // A bad back asks what bothers it before moving on.
      if (action.key === 'backToday' && action.value <= BACK_NOTES_AT) return { ...answered, askingBackNotes: true }
      return advance(answered)
    }
    case 'pass':
      return advance(state)
    case 'backNotes':
      return { ...state, backNotes: action.text.slice(0, 500) }
    case 'finishNotes':
      return advance(state)
    case 'back':
      if (state.askingBackNotes) return { ...state, askingBackNotes: false }
      if (state.index <= 0) return state
      return { ...state, index: state.index - 1, askingBackNotes: false, done: false }
    case 'jump':
      return { ...state, index: Math.max(0, Math.min(action.index, CHECK_IN_QUESTIONS.length - 1)), askingBackNotes: false, done: false }
  }
}

/** The POST /api/daily-logs body: only what was answered (untouched stays empty). */
export function checkInPayload(state: Pick<CheckInState, 'answers' | 'backNotes'>, date: string): Record<string, unknown> {
  const body: Record<string, unknown> = { date }
  for (const q of CHECK_IN_QUESTIONS) {
    const v = state.answers[q.key]
    if (v != null) body[q.key] = v
  }
  const notes = state.backNotes.trim()
  if (notes && state.answers.backToday != null && state.answers.backToday <= BACK_NOTES_AT) body.backNotes = notes
  return body
}

export function answeredCount(answers: CheckInAnswers): number {
  return CHECK_IN_QUESTIONS.filter(q => answers[q.key] != null).length
}

/** A saved daily log back into answers (for editing from the collapsed card). */
export function answersFromLog(log: Partial<Record<CheckInKey, number | null | undefined>> | null | undefined): CheckInAnswers {
  const out: CheckInAnswers = {}
  if (!log) return out
  for (const q of CHECK_IN_QUESTIONS) {
    const v = log[q.key]
    if (typeof v === 'number') out[q.key] = v
  }
  return out
}

/** The label a saved value shows (sleep 9 -> "9+", soreness 4 -> "sore"). */
export function answerLabel(key: CheckInKey, value: number): string {
  const q = CHECK_IN_QUESTIONS.find(x => x.key === key)
  const opt = q?.options.find(o => o.value === value)
  if (!opt) return String(value)
  if (key === 'sleepHours') return `${opt.label} h`
  return opt.sub && /^[1-5]$/.test(opt.label) ? opt.sub : opt.label
}

// ─── When the cards open ──────────────────────────────────────

export const CHECK_IN_SKIP_KEY = 'waymark_checkin_skipped'
export const CHECK_IN_REQUEST_KEY = 'waymark_checkin_requested'

/**
 * Open the cards on the first open of the day: no check-in saved today and
 * not skipped today. The morning alarm (I'M UP) always opens them.
 */
export function shouldOpenCheckIn(input: { today: string; hasLogToday: boolean; skippedOn: string | null; requested: boolean }): boolean {
  if (input.requested) return true
  if (input.hasLogToday) return false
  return input.skippedOn !== input.today
}

const NOTE_DAY3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** The note board's day (page 46): "Sun 18" for 2026-10-18. */
export function noteDayLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return ''
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return `${NOTE_DAY3[d.getUTCDay()]} ${d.getUTCDate()}`
}
