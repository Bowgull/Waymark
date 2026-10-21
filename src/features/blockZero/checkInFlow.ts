// Morning check-in as swipe cards (Block Zero Phase C, direction 1; Morning
// Report "both" in design-decisions.md): one question per card, big tiles,
// a tap answers and moves on. Re-opens on every app open and every return of
// Today to the foreground until all nine are answered (approved 2026-10-19:
// no "skip today"), resuming at the first unanswered card; each answer is
// saved as it is given. Also from the morning alarm's I'M UP. Pure: no React,
// no fetch.
//
// Scales match POST /api/daily-logs (schemas.ts): 1-5 for the detailed items
// (stress and soreness: higher is worse; back today: 1 is worst), sleep in
// hours, alcohol on its 0-10 scale, herb on its 0-9 scale (0 none, 9 most;
// page 51's herb card).

export type BaseCheckInKey =
  | 'sleepHours'
  | 'sleepQuality'
  | 'energy'
  | 'soreness'
  | 'stress'
  | 'mood'
  | 'backToday'
  | 'alcoholScale'
  | 'herbScale'

/** "<Place> today" while a place is on watch (page 57 item 6, kept on page 58): `region:knee`. */
export type RegionCheckInKey = `region:${string}`
export type CheckInKey = BaseCheckInKey | RegionCheckInKey

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

export const CHECK_IN_QUESTIONS: readonly (CheckInQuestion & { key: BaseCheckInKey })[] = [
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
    // Page 51: 0 (none) and 1-9 (9 = most), ten tiles in two rows of five.
    key: 'herbScale',
    title: 'Herb',
    sub: 'Last 24 h · 0 none, 9 most',
    options: Array.from({ length: 10 }, (_, i) => (i === 0 ? { value: 0, label: '0', sub: 'none' } : i === 9 ? { value: 9, label: '9', sub: 'most' } : { value: i, label: String(i) })),
    columns: 5,
  },
]

/** Back today at or below this asks what bothers it (back notes). */
export const BACK_NOTES_AT = 2

const REGION_FIVE = FIVE(['bad', 'sore', 'stiff', 'good', 'fine'])

/**
 * The day's cards: the nine, with a "<Place> today" card after Back today for
 * each place on watch or flagged (page 57's card: the same five tiles as Back
 * today), so the coach sees the trend between the raven's visits.
 */
export function checkInQuestions(regions: ReadonlyArray<{ region: string; label: string }> = []): CheckInQuestion[] {
  const out: CheckInQuestion[] = []
  for (const q of CHECK_IN_QUESTIONS) {
    out.push(q)
    if (q.key !== 'backToday') continue
    for (const r of regions) out.push({ key: `region:${r.region}`, title: r.label, sub: 'How it feels right now', options: REGION_FIVE, columns: 5 })
  }
  return out
}

export type CheckInAnswers = Partial<Record<CheckInKey, number>>

export interface CheckInState {
  /** Card index; total = the back-notes card or done. */
  index: number
  /** How many cards today (nine, plus a card per place on watch). */
  total: number
  answers: CheckInAnswers
  backNotes: string
  /** On the back-notes card (only when back today is low). */
  askingBackNotes: boolean
  done: boolean
  /** Cards passed today without an answer: they count as answered for re-opening the deck, not for LOGGED. */
  passed: CheckInKey[]
}

export type CheckInAction =
  | { type: 'answer'; key: CheckInKey; value: number }
  | { type: 'pass' }
  | { type: 'back' }
  | { type: 'backNotes'; text: string }
  | { type: 'finishNotes' }
  | { type: 'jump'; index: number }

export function initialCheckIn(existing?: CheckInAnswers | null, startAt = 0, questions: ReadonlyArray<CheckInQuestion> = CHECK_IN_QUESTIONS, passed: ReadonlyArray<CheckInKey> = []): CheckInState {
  const total = questions.length
  const answers = { ...(existing ?? {}) }
  return { index: Math.max(0, Math.min(startAt, total - 1)), total, answers, backNotes: '', askingBackNotes: false, done: false, passed: passed.filter(k => answers[k] == null) }
}

function advance(state: CheckInState): CheckInState {
  const next = state.index + 1
  if (next < state.total) return { ...state, index: next, askingBackNotes: false }
  return { ...state, index: state.total, askingBackNotes: false, done: true }
}

export function checkInReducer(state: CheckInState, action: CheckInAction, questions: ReadonlyArray<CheckInQuestion> = CHECK_IN_QUESTIONS): CheckInState {
  if (state.done && action.type !== 'back' && action.type !== 'jump') return state
  switch (action.type) {
    case 'answer': {
      const answered = { ...state, answers: { ...state.answers, [action.key]: action.value }, passed: (state.passed ?? []).filter(k => k !== action.key) }
      // A bad back asks what bothers it before moving on.
      if (action.key === 'backToday' && action.value <= BACK_NOTES_AT) return { ...answered, askingBackNotes: true }
      return advance(answered)
    }
    case 'pass': {
      // A passed card is kept, so the deck stops coming back for it (it can still be answered from CHECK IN).
      const key = questions[state.index]?.key
      const passed = state.passed ?? []
      if (!key || state.answers[key] != null || passed.includes(key)) return advance(state)
      return advance({ ...state, passed: [...passed, key] })
    }
    case 'backNotes':
      return { ...state, backNotes: action.text.slice(0, 500) }
    case 'finishNotes':
      return advance(state)
    case 'back':
      if (state.askingBackNotes) return { ...state, askingBackNotes: false }
      if (state.index <= 0) return state
      return { ...state, index: state.index - 1, askingBackNotes: false, done: false }
    case 'jump':
      return { ...state, index: Math.max(0, Math.min(action.index, state.total - 1)), askingBackNotes: false, done: false }
  }
}

/** The POST /api/daily-logs body: only what was answered (untouched stays empty). */
export function checkInPayload(state: Pick<CheckInState, 'answers' | 'backNotes'>, date: string): Record<string, unknown> {
  const body: Record<string, unknown> = { date }
  for (const q of CHECK_IN_QUESTIONS) {
    const v = state.answers[q.key]
    if (v != null) body[q.key] = v
  }
  // "<Place> today" answers go together: { knee: 2 }.
  const regions: Record<string, number> = {}
  for (const [k, v] of Object.entries(state.answers)) if (k.startsWith('region:') && typeof v === 'number') regions[k.slice(7)] = v
  if (Object.keys(regions).length > 0) body.regionRatings = regions
  const notes = state.backNotes.trim()
  if (notes && state.answers.backToday != null && state.answers.backToday <= BACK_NOTES_AT) body.backNotes = notes
  return body
}

export function answeredCount(answers: CheckInAnswers): number {
  return CHECK_IN_QUESTIONS.filter(q => answers[q.key] != null).length
}

/** All nine answered: the check-in stops coming back and the Morning Report reads LOGGED. */
export function isCheckInComplete(answers: CheckInAnswers): boolean {
  return answeredCount(answers) === CHECK_IN_QUESTIONS.length
}

/** Where the cards resume: the first card without an answer (the first card when all are in). */
export function firstUnanswered(answers: CheckInAnswers, questions: ReadonlyArray<CheckInQuestion> = CHECK_IN_QUESTIONS): number {
  const i = questions.findIndex(q => answers[q.key] == null)
  return i < 0 ? 0 : i
}

/**
 * Answers saved on this phone while the server couldn't be reached, laid over
 * what the server has (the phone's are the newer ones).
 */
export function mergeAnswers(server: CheckInAnswers, local: CheckInAnswers | null | undefined): CheckInAnswers {
  const out: CheckInAnswers = { ...server }
  for (const [k, v] of Object.entries(local ?? {})) if (typeof v === 'number') out[k as CheckInKey] = v
  return out
}

/** A saved daily log back into answers (for editing from the collapsed card). */
export function answersFromLog(log: (Partial<Record<BaseCheckInKey, number | null | undefined>> & { regionRatingsJson?: string | null }) | null | undefined): CheckInAnswers {
  const out: CheckInAnswers = {}
  if (!log) return out
  for (const q of CHECK_IN_QUESTIONS) {
    const v = log[q.key]
    if (typeof v === 'number') out[q.key] = v
  }
  try {
    for (const [k, v] of Object.entries(JSON.parse(log.regionRatingsJson ?? '{}') as Record<string, unknown>)) if (typeof v === 'number') out[`region:${k}`] = v
  } catch { /* unreadable: leave the places unanswered */ }
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

export const CHECK_IN_REQUEST_KEY = 'waymark_checkin_requested'
/** Today's answers kept on this phone as they are given (until the full save lands). */
export const CHECK_IN_DRAFT_KEY = 'waymark_checkin_draft'

/**
 * Open the cards on every app open and every return of Today to the
 * foreground until each of the nine is answered or passed today (approved
 * 2026-10-21: a PASS counts as answered for re-opening; LOGGED still needs
 * all nine). Closing the deck only lasts until the next open. The morning
 * alarm (I'M UP) always opens them.
 */
export function shouldOpenCheckIn(input: { answers: CheckInAnswers; passed?: ReadonlyArray<CheckInKey>; requested: boolean }): boolean {
  if (input.requested) return true
  const passed = input.passed ?? []
  return !CHECK_IN_QUESTIONS.every(q => input.answers[q.key] != null || passed.includes(q.key))
}

export interface CheckInDraft { answers: CheckInAnswers; backNotes: string; passed: CheckInKey[] }

/** A draft from storage, for today only. */
export function parseCheckInDraft(raw: string | null, today: string): CheckInDraft | null {
  if (!raw) return null
  try {
    const d = JSON.parse(raw) as { date?: unknown; answers?: unknown; backNotes?: unknown; passed?: unknown }
    if (d.date !== today || !d.answers || typeof d.answers !== 'object') return null
    const answers: CheckInAnswers = {}
    for (const [k, v] of Object.entries(d.answers as Record<string, unknown>)) if (typeof v === 'number' && Number.isFinite(v)) answers[k as CheckInKey] = v
    const passed = Array.isArray(d.passed) ? d.passed.filter((k): k is CheckInKey => typeof k === 'string') : []
    return { answers, backNotes: typeof d.backNotes === 'string' ? d.backNotes : '', passed }
  } catch {
    return null
  }
}

const NOTE_DAY3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** The note board's day (page 46): "Sun 18" for 2026-10-18. */
export function noteDayLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return ''
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return `${NOTE_DAY3[d.getUTCDay()]} ${d.getUTCDate()}`
}
