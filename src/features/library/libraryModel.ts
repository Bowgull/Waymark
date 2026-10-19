// The Library (page 21, page 39): pure rules, no React, so the unit tests
// run under node.

import type { SessionIconKey } from '@/design/sessionIconKeys'

export interface LibraryExercise {
  id: string
  name: string
  category: string
  muscleGroups: string | null
  equipment: string | null
  formCues: string | null
  formVideoUrl: string | null
}

export interface LibraryCombo {
  id: string
  text: string
  tier: string
  level: string
  unlocked: number
  masteryScore: number
  techniques: string
  formTips: string | null
  isFavourite: number
  timesSharp: number
}

export interface LibraryJournalEntry {
  id: string
  date: number
  type: string
  content: string
  createdAt: number
}

/** The six groups, in the app's order (page 39): icon, flap name. */
export type GroupKey = 'strength' | 'core' | 'posture' | 'mobility' | 'bag' | 'waybook'

export const GROUPS: ReadonlyArray<{ key: GroupKey; name: string; icon: SessionIconKey }> = [
  { key: 'strength', name: 'STRENGTH', icon: 'strength' },
  { key: 'core', name: 'CORE', icon: 'core' },
  // the daily posture track is Foundation everywhere (its category stays `posture`)
  { key: 'posture', name: 'FOUNDATION', icon: 'foundation' },
  { key: 'mobility', name: 'MOBILITY', icon: 'mobility' },
  { key: 'bag', name: 'BAGWORK', icon: 'bag' },
  { key: 'waybook', name: 'WAYBOOK', icon: 'waybook' },
]

export const EXERCISE_GROUPS: ReadonlyArray<GroupKey> = ['strength', 'core', 'posture', 'mobility']

export function isGroupKey(v: string | null): v is GroupKey {
  return v != null && GROUPS.some(g => g.key === v)
}

// ─── Bagwork ──────────────────────────────────────────────────

export const TIER_ORDER = ['foundation', 'weapons', 'flow', 'deception', 'mastery'] as const
export const TIER_NAMES: Readonly<Record<string, string>> = {
  foundation: 'FUNDAMENTALS',
  weapons: 'WEAPONS',
  flow: 'FLOW',
  deception: 'DECEPTION',
  mastery: 'MASTERY',
}

/** Mastery score = the last five ratings (Struggled 1, Solid 2, Sharp 3), out of 15. */
export const MASTERY_MAX = 15
/** Mastered at 9 or more. */
export const MASTERED_AT = 9

export function isMastered(c: Pick<LibraryCombo, 'masteryScore'>): boolean {
  return c.masteryScore >= MASTERED_AT
}

/** The five brass dots: score ÷ 3, whole dots, 0 to 5. */
export function masteryDots(score: number): number {
  if (!Number.isFinite(score) || score <= 0) return 0
  return Math.min(5, Math.floor(score / 3))
}

/**
 * A combo's strikes (each its own tile, joined by ›): "Jab → Cross → Hook"
 * gives JAB, CROSS, HOOK. Older text with " - " or "," separators splits too.
 */
export function comboStrikes(text: string): string[] {
  return text
    .split(/\s*(?:→|->|›|>|,|\s-\s|·)\s*/)
    .map(s => s.trim().toUpperCase())
    .filter(Boolean)
}

/** Bagwork's count on the list: unlocked / total. */
export function bagCount(combos: ReadonlyArray<Pick<LibraryCombo, 'unlocked'>>): string {
  return `${combos.filter(c => c.unlocked).length}/${combos.length}`
}

export interface TierView {
  tier: string
  name: string
  combos: LibraryCombo[]
  unlocked: number
  mastered: number
  /** No combo unlocked yet: the tier shows the lock and stays shut. */
  locked: boolean
}

/** Tiers in order, each with its combos; a tier's count is mastered / unlocked. */
export function tierViews(combos: ReadonlyArray<LibraryCombo>): TierView[] {
  const known = new Set<string>(TIER_ORDER)
  const order = [...TIER_ORDER, ...[...new Set(combos.map(c => c.tier))].filter(t => !known.has(t))]
  return order
    .map(tier => {
      const list = combos.filter(c => c.tier === tier)
      const unlocked = list.filter(c => c.unlocked).length
      return {
        tier,
        name: TIER_NAMES[tier] ?? tier.toUpperCase(),
        // unlocked first, keeping the seed order inside each half
        combos: [...list.filter(c => c.unlocked), ...list.filter(c => !c.unlocked)],
        unlocked,
        mastered: list.filter(c => c.unlocked && isMastered(c)).length,
        locked: unlocked === 0,
      }
    })
    .filter(t => t.combos.length > 0)
}

/** The tier that opens with Bagwork: the highest tier with an unlocked combo. */
export function currentTier(tiers: ReadonlyArray<TierView>): string | null {
  const open = tiers.filter(t => !t.locked)
  return open.length ? open[open.length - 1].tier : null
}

// ─── Exercises ────────────────────────────────────────────────

/** "rear_delts" → "Rear Delts"; short words stay upper case ("ab" → "AB"). */
export function muscleName(raw: string): string {
  return raw
    .trim()
    .split('_')
    .filter(Boolean)
    .map(w => (w.length <= 2 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(' ')
}

export function muscleBadges(raw: string | null): string[] {
  return raw ? raw.split(',').map(muscleName).filter(Boolean) : []
}

/** "barbell,bench" → "Barbell, Bench"; "pull-up bar" → "Pull-up Bar". */
export function equipmentName(raw: string | null): string {
  if (!raw) return ''
  return raw
    .split(',')
    .map(part => part.trim().split(' ').filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' '))
    .filter(Boolean)
    .join(', ')
}

export function exerciseCounts(exercises: ReadonlyArray<Pick<LibraryExercise, 'category'>>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const ex of exercises) out[ex.category] = (out[ex.category] ?? 0) + 1
  return out
}

// ─── The Waybook (page 21 B: an old book page) ────────────────

const DAY3 = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
const MON3 = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER']

function utc(epochDay: number): Date {
  return new Date(epochDay * 86400000)
}

/** "SAT, OCT 18", and " · WEEKLY" on a weekly entry. */
export function entryDateLine(e: Pick<LibraryJournalEntry, 'date' | 'type'>): string {
  const d = utc(e.date)
  const base = `${DAY3[d.getUTCDay()]}, ${MON3[d.getUTCMonth()]} ${d.getUTCDate()}`
  return e.type === 'weekly' ? `${base} · WEEKLY` : base
}

/** The Waybook's entry type for a morning note (the check-in's + ADD NOTE, daily_logs.notes). */
export const MORNING_ENTRY_TYPE = 'morning'

/** A morning note gets the small MORNING tag (page 46); reflections stay untagged. */
export function isMorningNote(e: Pick<LibraryJournalEntry, 'type'>): boolean {
  return e.type === MORNING_ENTRY_TYPE
}

export interface BookPage {
  /** "2026-10" */
  key: string
  /** "THE WAYBOOK · OCTOBER '26" */
  head: string
  entries: LibraryJournalEntry[]
}

/**
 * The book: one page per month, newest first. Reflections and the morning
 * notes from the check-in (page 46, tagged MORNING); a day's morning note sits
 * above that day's reflections. The Body Log's notes are not on the page.
 */
export function bookPages(entries: ReadonlyArray<LibraryJournalEntry>): BookPage[] {
  const reflections = entries
    .filter(e => e.type !== 'wellness' && e.content.trim())
    .slice()
    .sort((a, b) => b.date - a.date || Number(isMorningNote(b)) - Number(isMorningNote(a)) || b.createdAt - a.createdAt)
  const pages: BookPage[] = []
  for (const e of reflections) {
    const d = utc(e.date)
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    let page = pages.find(p => p.key === key)
    if (!page) {
      page = { key, head: `THE WAYBOOK · ${MONTHS[d.getUTCMonth()]} '${String(d.getUTCFullYear()).slice(2)}`, entries: [] }
      pages.push(page)
    }
    page.entries.push(e)
  }
  return pages
}

/**
 * An entry's paragraphs (each Save / Add More is its own block), first letter
 * capitalised so the drop cap is a capital.
 */
export function entryParagraphs(content: string): string[] {
  return content
    .split(/\n+/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => s.charAt(0).toUpperCase() + s.slice(1))
}

// ─── Search ───────────────────────────────────────────────────

export function matchExercise(ex: LibraryExercise, q: string): boolean {
  const s = q.trim().toLowerCase()
  if (!s) return true
  return ex.name.toLowerCase().includes(s) || !!ex.muscleGroups?.toLowerCase().includes(s) || !!ex.equipment?.toLowerCase().includes(s)
}

export function matchCombo(c: LibraryCombo, q: string): boolean {
  const s = q.trim().toLowerCase()
  if (!s) return true
  return c.text.toLowerCase().includes(s) || c.tier.toLowerCase().includes(s) || (TIER_NAMES[c.tier] ?? '').toLowerCase().includes(s)
}

export function matchEntry(e: LibraryJournalEntry, q: string): boolean {
  const s = q.trim().toLowerCase()
  return !!s && e.content.toLowerCase().includes(s)
}
