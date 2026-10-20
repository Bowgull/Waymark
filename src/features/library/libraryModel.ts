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
  tips?: string | null
  // 0038 (page 60): the video's details and the weekly link check
  videoStartSec?: number | null
  videoSource?: string | null
  videoTitle?: string | null
  videoLength?: string | null
  videoStatus?: string | null
  altVideoUrl?: string | null
  altVideoSource?: string | null
  altVideoStatus?: string | null
  tiktokUrl?: string | null
  coachHint?: string | null
  /** Folded into another item: not listed. */
  mergedInto?: string | null
  /** 0040 (page 65): the one cue line when it isn't the cue's first sentence; the shortened coach note. */
  cueLine?: string | null
  coachNote?: string | null
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
  /** 'class': added or unlocked from an MT class (the glove, page 49 section 3). */
  source?: string | null
  /** The class's local epoch day ("From your class, Tue 20 Oct"). */
  classDate?: number | null
  /** The cue flap (4 words, 20 characters at most). */
  cue?: string | null
  formVideoUrl?: string | null
  // 0038 (page 60): the video's details and the weekly link check
  videoStartSec?: number | null
  videoSource?: string | null
  videoTitle?: string | null
  videoLength?: string | null
  videoStatus?: string | null
  altVideoUrl?: string | null
  altVideoSource?: string | null
  altVideoStatus?: string | null
  tiktokUrl?: string | null
  coachHint?: string | null
}

/** Techniques (page 52 / 60, new kind): one real strike behind the combos' names. */
export interface LibraryTechnique {
  id: string
  name: string
  kind: string
  /** JSON array: the combo names that mean this one ("Left Kick" is the switch kick). */
  aliases: string
  /** 0040 (page 65): the one cue line when it isn't the cue's first sentence. */
  cueLine?: string | null
  cue: string | null
  tips: string | null
  formVideoUrl: string | null
  // 0038 (page 60): the video's details and the weekly link check
  videoStartSec?: number | null
  videoSource?: string | null
  videoTitle?: string | null
  videoLength?: string | null
  videoStatus?: string | null
  altVideoUrl?: string | null
  altVideoSource?: string | null
  altVideoStatus?: string | null
  tiktokUrl?: string | null
  coachHint?: string | null
}

/** Runs (page 52 / 60, new kind): a run type. */
export interface LibraryRun {
  id: string
  name: string
  runType: string
  /** 0040 (page 65): the one cue line when it isn't the what's first sentence. */
  cueLine?: string | null
  sub: string | null
  what: string | null
  tips: string | null
  formVideoUrl: string | null
  // 0038 (page 60): the video's details and the weekly link check
  videoStartSec?: number | null
  videoSource?: string | null
  videoTitle?: string | null
  videoLength?: string | null
  videoStatus?: string | null
  altVideoUrl?: string | null
  altVideoSource?: string | null
  altVideoStatus?: string | null
  tiktokUrl?: string | null
  coachHint?: string | null
}

export interface LibraryJournalEntry {
  id: string
  date: number
  type: string
  content: string
  createdAt: number
}

/** Every kind, in the app's order (page 39, and page 52's two new kinds): icon, flap name. */
export type GroupKey = 'strength' | 'core' | 'posture' | 'mobility' | 'bag' | 'techniques' | 'runs' | 'waybook'

export const GROUPS: ReadonlyArray<{ key: GroupKey; name: string; icon: SessionIconKey }> = [
  { key: 'strength', name: 'STRENGTH', icon: 'strength' },
  { key: 'core', name: 'CORE', icon: 'core' },
  // the daily posture track is Foundation everywhere (its category stays `posture`)
  { key: 'posture', name: 'FOUNDATION', icon: 'foundation' },
  { key: 'mobility', name: 'MOBILITY', icon: 'mobility' },
  { key: 'bag', name: 'BAGWORK', icon: 'bag' },
  // page 52: the single strikes (the MT Class glove) and the run types (the shoe)
  { key: 'techniques', name: 'TECHNIQUES', icon: 'mt' },
  { key: 'runs', name: 'RUNS', icon: 'run' },
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

/** Bagwork's count on the list, in words (page 65): "18 of 55", then a small "unlocked". */
export function bagCount(combos: ReadonlyArray<Pick<LibraryCombo, 'unlocked'>>): string {
  return `${combos.filter(c => c.unlocked).length} of ${combos.length}`
}

/** A tier's count, in words (page 65): "3 of 18 mastered" (mastered of unlocked). */
export function tierCount(t: Pick<TierView, 'mastered' | 'unlocked'>): string {
  return `${t.mastered} of ${t.unlocked} mastered`
}

/** Under a combo's five dots (page 65): "6 of 15 to mastered"; once mastered, "Mastered". */
export function masteryWords(score: number): string {
  return score >= MASTERED_AT ? 'Mastered' : `${Math.max(0, score)} of ${MASTERY_MAX} to mastered`
}

/** The MORE ratings line: "Sharp once.", "Sharp twice.", "Sharp 4 times.". */
export function sharpLine(n: number): string {
  return n === 1 ? 'Sharp once.' : n === 2 ? 'Sharp twice.' : `Sharp ${n} times.`
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

/** "barbell,bench" → "Barbell, Bench"; "pull-up bar" → "Pull-up Bar"; "trap_bar" → "Trap Bar", "ez-bar" → "EZ Bar". */
export function equipmentName(raw: string | null): string {
  if (!raw) return ''
  return raw
    .split(',')
    // Library ids, not words (e2e minor 25: "Trap_bar", "Ez-bar").
    .map(part => part.trim().replace(/_/g, ' ').replace(/^ez[- ]bar$/i, 'EZ bar'))
    .map(part => part.split(' ').filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' '))
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

// ─── Techniques, runs, items (page 52 / 60) ───────────────────

/** Not listed: an exercise folded into another (Spiderman + T-Spine into the World's Greatest Stretch). */
export function listed(ex: Pick<LibraryExercise, 'mergedInto'>): boolean {
  return !ex.mergedInto
}

const strikeKey = (s: string) => s.trim().toLowerCase().replace(/\s*[×x]\s*\d+$/, '').replace(/\s+/g, ' ')

export function aliasesOf(t: Pick<LibraryTechnique, 'aliases'>): string[] {
  try {
    const v = JSON.parse(t.aliases) as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** The technique a combo's strike name means ("Left Kick" → Switch Kick; "Jab × 3" → Jab). */
export function techniqueFor(strike: string, techniques: ReadonlyArray<LibraryTechnique>): LibraryTechnique | null {
  const k = strikeKey(strike)
  return techniques.find(t => strikeKey(t.name) === k || aliasesOf(t).some(a => strikeKey(a) === k)) ?? null
}

/** The combos that use a technique (each combo once). */
export function combosUsing<C extends Pick<LibraryCombo, 'text'>>(t: LibraryTechnique, combos: ReadonlyArray<C>, techniques: ReadonlyArray<LibraryTechnique>): C[] {
  return combos.filter(c => comboStrikes(c.text).some(s => techniqueFor(s, techniques)?.id === t.id))
}

/** "Kick · also Right Kick, Body Kick": the kind and the other combo names that mean it. */
export function techniqueSub(t: LibraryTechnique): string {
  const others = aliasesOf(t).filter(a => strikeKey(a) !== strikeKey(t.name))
  return others.length ? `${t.kind} · also ${others.join(', ')}` : t.kind
}

/** Tips are stored joined by " | "; at most three are shown. */
export function tipList(tips: string | null | undefined): string[] {
  return (tips ?? '').split('|').map(s => s.trim()).filter(Boolean).slice(0, 3)
}

/** The coach hint's first sentence goes bold (page 52): [lead, rest]. */
export function hintParts(hint: string): [string, string] {
  const m = /^(.+?[.!?])(\s+|$)([\s\S]*)$/.exec(hint.trim())
  return m ? [m[1], m[3]] : [hint.trim(), '']
}

const DOW3 = ['Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed']
/** "Tue 20 Oct" for a local epoch day. */
export function classDayLabel(epochDay: number): string {
  const d = new Date(epochDay * 86400000)
  const mon = MON3[d.getUTCMonth()]
  return `${DOW3[((epochDay % 7) + 7) % 7]} ${d.getUTCDate()} ${mon.charAt(0)}${mon.slice(1).toLowerCase()}`
}

export function matchTechnique(t: LibraryTechnique, q: string): boolean {
  const s = q.trim().toLowerCase()
  return !!s && (t.name.toLowerCase().includes(s) || t.kind.toLowerCase().includes(s) || aliasesOf(t).some(a => a.toLowerCase().includes(s)))
}

export function matchRun(r: LibraryRun, q: string): boolean {
  const s = q.trim().toLowerCase()
  return !!s && (r.name.toLowerCase().includes(s) || (r.sub ?? '').toLowerCase().includes(s))
}

/** What a technique search lists: each matching name once, the technique's own or a combo name for it ("teep": Teep, Lead Teep...). */
export function techniqueHits(techniques: ReadonlyArray<LibraryTechnique>, q: string): Array<{ technique: LibraryTechnique; label: string }> {
  const s = q.trim().toLowerCase()
  if (!s) return []
  const out: Array<{ technique: LibraryTechnique; label: string }> = []
  const seen = new Set<string>()
  for (const t of techniques) {
    for (const label of [t.name, ...aliasesOf(t)]) {
      const k = strikeKey(label)
      if (!label.toLowerCase().includes(s) || seen.has(k)) continue
      seen.add(k)
      out.push({ technique: t, label })
    }
  }
  return out
}

// ─── Item pages (page 65): one top board, one cue line, MORE ──

/** A text's sentences, each with its stop. */
export function sentences(text: string | null | undefined): string[] {
  const t = (text ?? '').trim()
  if (!t) return []
  return (t.match(/[^.!?]+(?:[.!?]+|$)/g) ?? [t]).map(x => x.trim()).filter(Boolean)
}

/**
 * The one cue line and what MORE keeps of the cue. The line is the item's own
 * short line (cue_line, page 65's new copy) or the cue's first sentence. The
 * rest is the cue without that sentence; a short line that rewrites the whole
 * cue (Jab) leaves no rest.
 */
export function cueSplit(cue: string | null | undefined, cueLine?: string | null): { line: string | null; rest: string | null } {
  const all = sentences(cue)
  const own = cueLine?.trim() || null
  const line = own ?? all[0] ?? null
  if (!line) return { line: null, rest: null }
  const i = all.indexOf(line)
  const rest = own && i < 0 ? [] : all.filter((_, k) => k !== (i < 0 ? 0 : i))
  return { line, rest: rest.length ? rest.join(' ') : null }
}

/** MORE's summary: "3 tips · from the coach", "2 tips · 1 sharp rating", "3 tips · your combos". */
export function moreSummary(p: { tips: number; coach?: boolean; how?: boolean; combos?: boolean; sharp?: number }): string {
  const out: string[] = []
  if (p.tips > 0) out.push(`${p.tips} ${p.tips === 1 ? 'tip' : 'tips'}`)
  if (p.sharp && p.sharp > 0) out.push(`${p.sharp} sharp ${p.sharp === 1 ? 'rating' : 'ratings'}`)
  if (p.combos) out.push('your combos')
  if (p.coach) out.push('from the coach')
  else if (p.how) out.push('how it works')
  return out.join(' · ')
}

/** A lift's meta line: "Barbell · last time 105 lb × 8" (equipment, then his last set). */
export function exerciseMeta(equipment: string, lastSet: string | null): string {
  if (!lastSet) return equipment
  return equipment ? `${equipment} · last time ${lastSet}` : `Last time ${lastSet}`
}

/** A technique's meta line: "Punch · in 26 of your combos". */
export function techniqueMeta(t: Pick<LibraryTechnique, 'kind'>, uses: number): string {
  return uses > 0 ? `${t.kind} · in ${uses} of your combos` : t.kind
}
