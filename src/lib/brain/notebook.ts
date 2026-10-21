// The coach's notebook: long-term memory (approved by Josh 2026-10-21, item 1;
// coach-memory-research-2026-10-21.md §c; philippe-ths ADR 0025).
//
// A small, capped set of one-line lessons the numbers alone don't show, each
// tied to the raw evidence behind it. What it is NOT is as important:
//
// - Never numbers. A lesson says what to look at ("back is stiffer the
//   morning after hinge days"); the athlete model supplies every number. A
//   claim with a digit or a number word is refused.
// - Never a verdict on him. No character, motivation or compliance words
//   ("lazy", "skips", "ignores", "inconsistent"...): the ADR 0025 failure,
//   where a stored "ignores easy guidance" turned the coach into a nag.
//   Adherence patterns are computed by the model, not remembered.
// - Never a short state (sick, away): those expire on their own (tempStates.ts).
// - Three kinds kept apart: 'response' (how his body responds), 'preference'
//   (what he says he prefers; safety rules always beat it) and 'back' (back
//   and injury history: never expires, its triggers get re-checked). A lesson
//   whose evidence is only his own words is tagged source 'said'.
//
// The AI only PROPOSES: add (kind, claim, 3+ evidence ids), support (more
// evidence for a lesson) or retire (counter-evidence). Code checks every id
// exists and the 3-separate-days rule, and refuses the rest. The claim text is
// never edited. Each night the record is REBUILT FROM THE EVIDENCE LINKS (not
// from its own prior status): status, dates, counts and source are worked out
// again from the raw rows that still exist, so a wrong lesson can't feed on
// itself:
//
//   candidate  3+ supporting items on 3+ separate days
//   confirmed  4+ separate days spanning 3+ weeks
//   recheck    no new support for 8 weeks (back lessons: also on counter-evidence)
//   retired    no new support for 12 weeks, counter-evidence that matches the
//              support, or its evidence gone (back lessons never retire)
//
// Pure.

import { BANNED } from './words'

export type LessonKind = 'response' | 'preference' | 'back'
export type LessonStatus = 'candidate' | 'confirmed' | 'recheck' | 'retired'
export type LessonSource = 'said' | 'seen'

export const LESSON_KINDS: readonly LessonKind[] = ['response', 'preference', 'back']
export const MAX_LESSONS = 20
export const MIN_EVIDENCE = 3
export const CONFIRM_MIN_DAYS = 4
export const CONFIRM_SPAN_DAYS = 21
export const RECHECK_DAYS = 56
export const RETIRE_DAYS = 84
export const MIN_CLAIM_CHARS = 12
export const MAX_CLAIM_CHARS = 140
export const MAX_ADDS_PER_NIGHT = 2
/** Evidence the AI sees and may cite (days back). */
export const EVIDENCE_DAYS = 21

export interface Lesson {
  id: string
  kind: LessonKind
  claim: string
  source: LessonSource
  status: LessonStatus
  firstSeenDay: number | null
  lastConfirmedDay: number | null
  support: number
  counter: number
  createdDay: number
  retiredDay: number | null
  retiredReason: string | null
}

export interface LessonLink {
  lessonId: string
  evidenceId: string
  role: 'support' | 'counter'
}

/** One raw row a lesson may cite: a session, a set, a check-in or one of his notes. */
export interface EvidenceItem {
  id: string
  day: number
  kind: 'session' | 'set' | 'checkin' | 'note'
  /** His own words (a note or a reason he picked), not a measurement. */
  said: boolean
  text: string
}

export interface NotebookOps {
  add: Array<{ kind: string; claim: string; evidence: string[] }>
  support: Array<{ lesson: string; evidence: string[] }>
  retire: Array<{ lesson: string; evidence: string[] }>
}

export const EMPTY_OPS: NotebookOps = { add: [], support: [], retire: [] }

// ─── The claim ───────────────────────────────────────────────

const NUMBER_WORDS = /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|hundred|once|twice|thrice|half|double|triple|percent|dozen)\b/i
/** Verdicts on him, his character, motivation or compliance: never stored (ADR 0025). */
export const VERDICT = /\b(lazy|laziness|unmotivated|motivat\w*|disciplin\w*|undisciplined|commit(?:ted|ment)|reliab\w*|unreliable|complian\w*|noncomplian\w*|non-complian\w*|excuses?|procrastinat\w*|sandbag\w*|quits?|quitter|gives? up|skips?|skipped|skipping|misses|missed|avoids?|ignores?|ignored|ignoring|doesn'?t (?:follow|listen|do|try)|fails? to|won'?t|refuses?|weak|soft|tough|mental(?:ly)?|attitude|character|honest|dishonest|lies|lying|exaggerat\w*|inconsistent|consistency|flak\w*|stubborn|ego|overconfident|careless|sloppy|half-?hearted|cheat\w*)\b/i
/** Short states belong to tempStates.ts, not here. */
const TEMPORARY = /\b(sick|illness|ill|flu|a cold|covid|travel\w*|trip|away|hotel|vacation|holiday|this week|today|tomorrow|tonight|yesterday)\b/i

export function claimProblems(claim: string): string[] {
  const out: string[] = []
  const t = claim.trim()
  if (t.length < MIN_CLAIM_CHARS) out.push('too short')
  if (t.length > MAX_CLAIM_CHARS) out.push(`longer than ${MAX_CLAIM_CHARS} characters`)
  if (/\d/.test(t) || NUMBER_WORDS.test(t)) out.push('has a number: numbers come from the athlete model, never a lesson')
  const v = t.match(VERDICT)
  if (v) out.push(`a verdict on him ("${v[0]}"): only what his body does or what he says he prefers`)
  if (TEMPORARY.test(t)) out.push('a short-lived state, not a lesson')
  const b = t.match(BANNED)
  if (b) out.push(`banned phrase "${b[0]}"`)
  if (/[!?]/.test(t) || /\p{Extended_Pictographic}/u.test(t)) out.push('not a plain statement')
  return out
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim()

// ─── Proposals ───────────────────────────────────────────────

export interface OpsContext {
  today: number
  /** Every citable raw row (block start to today), by id. */
  index: ReadonlyMap<string, EvidenceItem>
  /** Lessons as rebuilt tonight. */
  lessons: readonly Lesson[]
  links: readonly LessonLink[]
  /** The refs the AI saw (L1, L2, ...) → lesson ids. */
  refs: ReadonlyMap<string, string>
}

export type AcceptedOp =
  | { op: 'add'; kind: LessonKind; claim: string; evidence: EvidenceItem[]; source: LessonSource }
  | { op: 'support'; lessonId: string; evidence: EvidenceItem[] }
  | { op: 'retire'; lessonId: string; evidence: EvidenceItem[] }

export interface OpsResult { accepted: AcceptedOp[]; refused: Array<{ op: string; ref: string; why: string }> }

/** Distinct days among evidence items. */
const days = (xs: readonly EvidenceItem[]) => new Set(xs.map(x => x.day)).size

export function sourceOf(items: readonly EvidenceItem[]): LessonSource {
  return items.length > 0 && items.every(i => i.said) ? 'said' : 'seen'
}

/** Code's check of the AI's proposals: every id must exist; adds need 3+ items on 3+ separate days; the cap holds. */
export function checkOps(raw: unknown, ctx: OpsContext): OpsResult {
  const out: OpsResult = { accepted: [], refused: [] }
  const ops = (raw && typeof raw === 'object' ? raw : {}) as Partial<NotebookOps>
  const known = (ids: unknown): { items: EvidenceItem[]; unknown: string[] } => {
    const list = Array.isArray(ids) ? [...new Set(ids.filter((x): x is string => typeof x === 'string'))] : []
    const items: EvidenceItem[] = []
    const unknown: string[] = []
    for (const id of list) {
      const it = ctx.index.get(id)
      if (it && it.day <= ctx.today) items.push(it)
      else unknown.push(id)
    }
    return { items, unknown }
  }
  const active = ctx.lessons.filter(l => l.status !== 'retired')
  let room = MAX_LESSONS - active.length
  let adds = 0
  for (const a of Array.isArray(ops.add) ? ops.add : []) {
    const claim = typeof a?.claim === 'string' ? a.claim.trim().replace(/\s+/g, ' ') : ''
    const ref = claim.slice(0, 40) || '(empty)'
    const kind = LESSON_KINDS.includes(a?.kind as LessonKind) ? (a.kind as LessonKind) : null
    if (!kind) { out.refused.push({ op: 'add', ref, why: `unknown kind "${String(a?.kind)}"` }); continue }
    const problems = claimProblems(claim)
    if (problems.length) { out.refused.push({ op: 'add', ref, why: problems.join('; ') }); continue }
    const { items, unknown } = known(a.evidence)
    if (unknown.length) { out.refused.push({ op: 'add', ref, why: `evidence ids that don't exist: ${unknown.slice(0, 5).join(', ')}` }); continue }
    if (items.length < MIN_EVIDENCE || days(items) < MIN_EVIDENCE) { out.refused.push({ op: 'add', ref, why: `needs ${MIN_EVIDENCE}+ evidence items on ${MIN_EVIDENCE}+ separate days (has ${items.length} on ${days(items)})` }); continue }
    if (active.some(l => norm(l.claim) === norm(claim)) || out.accepted.some(x => x.op === 'add' && norm(x.claim) === norm(claim))) { out.refused.push({ op: 'add', ref, why: 'already in the notebook: support it instead' }); continue }
    if (adds >= MAX_ADDS_PER_NIGHT) { out.refused.push({ op: 'add', ref, why: `at most ${MAX_ADDS_PER_NIGHT} new lessons a night` }); continue }
    if (room <= 0) { out.refused.push({ op: 'add', ref, why: `the notebook is full (${MAX_LESSONS}): retire one first` }); continue }
    out.accepted.push({ op: 'add', kind, claim, evidence: items, source: sourceOf(items) })
    adds++
    room--
  }
  const linked = new Set(ctx.links.map(l => `${l.lessonId}|${l.evidenceId}`))
  for (const [op, list] of [['support', ops.support], ['retire', ops.retire]] as const) {
    for (const s of Array.isArray(list) ? list : []) {
      const ref = typeof s?.lesson === 'string' ? s.lesson : '(none)'
      const id = ctx.refs.get(ref)
      const lesson = id ? active.find(l => l.id === id) : undefined
      if (!lesson) { out.refused.push({ op, ref, why: 'no such lesson in the notebook' }); continue }
      const { items, unknown } = known(s.evidence)
      if (unknown.length) { out.refused.push({ op, ref, why: `evidence ids that don't exist: ${unknown.slice(0, 5).join(', ')}` }); continue }
      const fresh = items.filter(i => !linked.has(`${lesson.id}|${i.id}`))
      if (fresh.length === 0) { out.refused.push({ op, ref, why: 'no new evidence' }); continue }
      if (op === 'retire' && lesson.kind === 'back') {
        // Back history never expires: counter-evidence only sends its triggers to a re-check.
        out.accepted.push({ op: 'retire', lessonId: lesson.id, evidence: fresh })
        continue
      }
      out.accepted.push(op === 'support' ? { op: 'support', lessonId: lesson.id, evidence: fresh } : { op: 'retire', lessonId: lesson.id, evidence: fresh })
    }
  }
  return out
}

// ─── The nightly rebuild ─────────────────────────────────────

export interface Rebuilt {
  status: LessonStatus
  source: LessonSource
  firstSeenDay: number | null
  lastConfirmedDay: number | null
  support: number
  counter: number
  retiredReason: string | null
}

/**
 * A lesson's record worked out again from its evidence links and the raw rows
 * that still exist. A retired lesson stays retired.
 */
export function rebuildLesson(lesson: Pick<Lesson, 'kind' | 'status' | 'retiredReason'>, links: readonly LessonLink[], index: ReadonlyMap<string, EvidenceItem>, today: number): Rebuilt {
  const live = links.map(l => ({ l, it: index.get(l.evidenceId) })).filter((x): x is { l: LessonLink; it: EvidenceItem } => x.it != null)
  const support = live.filter(x => x.l.role === 'support').map(x => x.it)
  const counter = live.filter(x => x.l.role === 'counter').map(x => x.it)
  const supportDays = days(support)
  const counterDays = days(counter)
  const firstSeenDay = support.length ? Math.min(...support.map(i => i.day)) : null
  const lastConfirmedDay = support.length ? Math.max(...support.map(i => i.day)) : null
  const base = { source: sourceOf(support), firstSeenDay, lastConfirmedDay, support: supportDays, counter: counterDays }
  if (lesson.status === 'retired') return { ...base, status: 'retired', retiredReason: lesson.retiredReason ?? 'retired' }
  const age = lastConfirmedDay == null ? Infinity : today - lastConfirmedDay
  if (lesson.kind === 'back') {
    // Back and injury history never expires; its triggers get re-checked.
    const recheck = supportDays < MIN_EVIDENCE || age >= RECHECK_DAYS || (counterDays >= 2 && counterDays >= supportDays)
    return { ...base, status: recheck ? 'recheck' : supportDays >= CONFIRM_MIN_DAYS && (lastConfirmedDay! - firstSeenDay!) >= CONFIRM_SPAN_DAYS ? 'confirmed' : 'candidate', retiredReason: null }
  }
  if (supportDays < MIN_EVIDENCE) return { ...base, status: 'retired', retiredReason: 'its evidence is gone' }
  if (counterDays >= 2 && counterDays >= supportDays) return { ...base, status: 'retired', retiredReason: 'counter-evidence matched the support' }
  if (age >= RETIRE_DAYS) return { ...base, status: 'retired', retiredReason: 'not re-confirmed in 12 weeks' }
  if (age >= RECHECK_DAYS) return { ...base, status: 'recheck', retiredReason: null }
  const confirmed = supportDays >= CONFIRM_MIN_DAYS && (lastConfirmedDay! - firstSeenDay!) >= CONFIRM_SPAN_DAYS
  return { ...base, status: confirmed ? 'confirmed' : 'candidate', retiredReason: null }
}

// ─── What the AI sees ────────────────────────────────────────

const ORDER: Record<LessonStatus, number> = { confirmed: 0, candidate: 1, recheck: 2, retired: 3 }

function iso(day: number): string {
  return new Date(day * 86400000).toISOString().slice(0, 10)
}

/**
 * The notebook as the AI reads it, near the top of the packet, one fixed line
 * per lesson: ref | kind | source | status | evidence days | last confirmed | claim.
 * Back lessons first. Retired lessons are left out.
 */
export function notebookLines(lessons: readonly Lesson[]): { lines: string[]; refs: Map<string, string> } {
  const live = lessons.filter(l => l.status !== 'retired')
    .sort((a, b) => (a.kind === 'back' ? 0 : 1) - (b.kind === 'back' ? 0 : 1) || ORDER[a.status] - ORDER[b.status] || a.createdDay - b.createdDay || a.id.localeCompare(b.id))
  const refs = new Map<string, string>()
  const lines = live.map((l, i) => {
    const ref = `L${i + 1}`
    refs.set(ref, l.id)
    return `${ref} | ${l.kind} | ${l.source} | ${l.status} | ${l.support} days | last ${l.lastConfirmedDay != null ? iso(l.lastConfirmedDay) : '-'} | ${l.claim}`
  })
  return { lines, refs }
}

/** The evidence the AI may cite, one line each: id | day | what. Notes carry their own ev ids in `notes`. */
export function evidenceLines(index: ReadonlyMap<string, EvidenceItem>, today: number): string[] {
  return [...index.values()]
    .filter(i => i.kind !== 'note' && i.kind !== 'set' && i.day > today - EVIDENCE_DAYS && i.day <= today)
    .sort((a, b) => a.day - b.day || a.id.localeCompare(b.id))
    .map(i => `${i.id} | ${iso(i.day)} | ${i.text}`)
}

// ─── The output schema's notebook part ───────────────────────

const ids = { type: 'array', items: { type: 'string' } }

export const NOTEBOOK_SCHEMA: Record<string, unknown> = {
  type: 'object', additionalProperties: false, required: ['add', 'support', 'retire'],
  description: 'Proposals for the coach\'s notebook (usually all empty). Code checks every evidence id.',
  properties: {
    add: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['kind', 'claim', 'evidence'],
        properties: { kind: { type: 'string', enum: [...LESSON_KINDS] }, claim: { type: 'string' }, evidence: ids },
      },
    },
    support: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['lesson', 'evidence'], properties: { lesson: { type: 'string' }, evidence: ids } } },
    retire: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['lesson', 'evidence'], properties: { lesson: { type: 'string' }, evidence: ids } } },
  },
}
