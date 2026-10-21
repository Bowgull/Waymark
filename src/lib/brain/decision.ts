// Coach brain P3 (coach-brain.md §5.3, §5.4, §6): the AI call's packet, its
// strict output schema, the rules' check of every answer (verify) and who
// wins (arbitrate). Pure, shared by the Worker and the phone.
//
// The AI never writes a dose. The rules offer candidates for each of today's
// sessions (levels up to the rules' own pick, which is already the most the
// push gate and the readiness ceiling allow), each with its exact dose in
// plain words. The AI picks one per session plus a bounded tweak (a set less,
// a weight step down, a round less: never up), at most 2 week actions (move
// or rest), the fact ids it leaned on, one plain why per change, and how sure
// it is. verify refuses any answer with an unknown id, an out-of-range tweak,
// a number in a why that the app did not compute, a banned or filler phrase,
// or anything that tells him what to do in class. arbitrate keeps the rules'
// pick unless the AI is the same or more careful and says why.

import { kgToLbs } from '../units'
import { BANNED, CLASS_CONTENT } from './words'
import { NOTEBOOK_SCHEMA, type NotebookOps } from './notebook'
import type { Fact } from './signals'
import { leftWords, levelAbove, type BagDose, type Level, type RunDose, type StrengthDose, type Tweak } from './doses'

export const DECISION_VERSION = 1

/** Most visible coach changes a night (page 56), the solver's and the AI's alike. */
export const MAX_WEEK_ACTIONS = 2
/** One plain line (coach-brain.md §11). */
export const WHY_MAX_CHARS = 120

export type Confidence = 'low' | 'medium' | 'high'
export const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
export type DayKey = (typeof DAY_KEYS)[number]

export interface TweakRange { setsDelta: [number, number]; loadStep: [number, number]; roundsDelta: [number, number] }

export interface Candidate {
  /** c<n>.<level>, n = the session's number today. */
  id: string
  sessionId: string
  sessionType: string
  level: Level
  /** The rules' own pick for this session. */
  rules: boolean
  /** The dose in plain words, his units (lb, min, km): every number here is the app's. */
  dose: string
  range: TweakRange
  /** The dose with each allowed tweak applied, in the same words. */
  tweaked?: Partial<Record<keyof Tweak, string>>
  /**
   * Above the rules' default, up to the safe ceiling (item 12). Picking it needs
   * at least one of evidenceIds in reasons: numbers, never a note.
   */
  above?: boolean
  evidenceIds?: string[]
}

export interface WeekSession {
  /** s<n>: the short ref the AI uses. */
  ref: string
  sessionId: string
  type: string
  name: string
  day: DayKey
  epochDay: number
  slot: 'am' | 'pm'
  status: string
  /** The coach may move it (not his own pick, not held by an UNDO, not started, not a class). */
  movable: boolean
  /** The coach may take it off this week (rest). */
  restable: boolean
}

export interface SolverChange {
  /** w<n>. */
  ref: string
  kind: 'add' | 'move' | 'rest'
  /** The session it touches (s<n>), or null for a class it adds. */
  session: string | null
  to: { day: DayKey; slot: 'am' | 'pm' } | null
  why: string
}

export interface NoteFact {
  id: string
  day: string
  source: 'check_in' | 'back' | 'session' | 'journal' | 'skip'
  text: string
  /** Its evidence id for the notebook (n:ci:<day>, n:s:<id>, ...). */
  ev?: string
  /** The short state this note started has ended (idea 8): history, not tonight. */
  ended?: string
}

/** A short state from his notes (idea 8) with its end day. */
export interface TempFact { kind: 'sick' | 'away' | 'busy'; from: string; until: string; active: boolean }

export interface PacketFact {
  id: string
  value: number | string | boolean | null
  unit?: string
}

export interface DecisionPacket {
  v: number
  today: { iso: string; day: DayKey }
  state: { state: string; why: string | null; /** How much of the check-in was read (idea 7). */ confidence?: string }
  /** The coach's notebook (item 1), one fixed line per lesson, near the top. */
  notebook?: string[]
  /** Short states with their end days (idea 8). */
  temp?: TempFact[]
  facts: PacketFact[]
  notes: NoteFact[]
  candidates: Candidate[]
  week: {
    sessions: WeekSession[]
    /** Days a session may move to (today on, this week). */
    days: DayKey[]
    solver: SolverChange[]
    budget: number
  }
  /** The rules' own why lines (app-computed: numbers in them may be quoted). */
  rulesWhy: string[]
  recentChanges: Array<{ day: string; actor: string; kind: string; session: string; why: string | null; undone: boolean }>
  /** Citable raw rows for the notebook, last 21 days: id | day | what (item 1). */
  evidence?: string[]
}

export interface AiPick { candidateId: string; tweak: Tweak }
export interface AiWeekAction { ref: string; action: 'move' | 'rest'; toDay: DayKey | null; toSlot: 'am' | 'pm' | null }
export interface AiDecision {
  today: AiPick[]
  week: { useSolver: boolean; actions: AiWeekAction[] }
  reasons: string[]
  why: Array<{ ref: string; text: string }>
  confidence: Confidence
  /** Notebook proposals (item 1); code checks them apart from the decision. */
  notebook?: NotebookOps
}

// ─── The strict output schema (output_config.format) ─────────

const tweakInt = { type: 'integer', enum: [-1, 0, 1] }

/** Static, so the playbook and schema stay one cacheable prefix; membership and ranges are verify's job. */
export const DECISION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['today', 'week', 'reasons', 'why', 'confidence', 'notebook'],
  properties: {
    today: {
      type: 'array',
      description: 'One pick per session in candidates: a candidate id and a tweak (each field -1 or 0).',
      items: {
        type: 'object', additionalProperties: false, required: ['candidateId', 'tweak'],
        properties: {
          candidateId: { type: 'string' },
          tweak: { type: 'object', additionalProperties: false, required: ['setsDelta', 'loadStep', 'roundsDelta'], properties: { setsDelta: tweakInt, loadStep: tweakInt, roundsDelta: tweakInt } },
        },
      },
    },
    week: {
      type: 'object', additionalProperties: false, required: ['useSolver', 'actions'],
      properties: {
        useSolver: { type: 'boolean', description: 'true: keep the solver\'s changes (actions ignored). false: actions are the whole set of week changes (may be empty).' },
        actions: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false, required: ['ref', 'action', 'toDay', 'toSlot'],
            properties: {
              ref: { type: 'string' },
              action: { type: 'string', enum: ['move', 'rest'] },
              toDay: { anyOf: [{ type: 'string', enum: [...DAY_KEYS] }, { type: 'null' }] },
              toSlot: { anyOf: [{ type: 'string', enum: ['am', 'pm'] }, { type: 'null' }] },
            },
          },
        },
      },
    },
    reasons: { type: 'array', items: { type: 'string' }, description: 'Fact and note ids the call rests on.' },
    why: {
      type: 'array',
      description: 'One plain line per change: ref is a picked candidate id, a week session ref (s<n>) or a solver change ref (w<n>).',
      items: { type: 'object', additionalProperties: false, required: ['ref', 'text'], properties: { ref: { type: 'string' }, text: { type: 'string' } } },
    },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    notebook: NOTEBOOK_SCHEMA,
  },
}

// ─── Plain words for a dose (the numbers the why may quote) ──

export function mmss(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function lb(kg: number | null | undefined): string | null {
  return kg == null || !(kg > 0) ? null : `${kgToLbs(kg)} lb`
}

const TITLE: Record<string, string> = { REST: 'Rest', RECOVER: 'Recover', EASE: 'Ease', HOLD: 'Hold', PROGRESS: 'Progress', PUSH: 'Push' }

/** A dose in plain words, his units. */
export function doseWords(d: { level: Level; strength?: StrengthDose; run?: RunDose; bag?: BagDose }): string {
  const head = `${TITLE[d.level]}: `
  if (d.strength) {
    return head + d.strength.lifts.map(l => {
      if (l.workUp) return `${l.label} find your weight, ${l.sets} sets of ${l.reps}${lb(l.setWeightsKg?.[0] ?? l.weightKg) ? ` from ${lb(l.setWeightsKg?.[0] ?? l.weightKg)}` : ''}`
      return `${l.label} ${l.sets} × ${l.reps}${lb(l.weightKg) ? ` at ${lb(l.weightKg)}` : ''}, ${leftWords(l.targetRir)}`
    }).join('; ')
  }
  if (d.run) {
    const r = d.run
    if (r.walkOnly) return `${head}easy walk or bike ${Math.round(r.totalSec / 60)} min`
    if (r.rounds <= 1) return `${head}run ${Math.round(r.runSec / 60)} min, HR under ${r.hrCeilingBpm} bpm`
    return `${head}${r.rounds} × ${mmss(r.runSec)} run / ${mmss(r.walkSec)} walk, ${Math.round(r.totalSec / 60)} min, HR under ${r.hrCeilingBpm} bpm`
  }
  if (d.bag) return `${head}${d.bag.rounds} rounds${d.bag.finishers ? ' with finishers' : ''}`
  return TITLE[d.level]
}

// ─── The number book: every number the app computed, in every form it may be said ──

export type Unit = '' | 'lb' | 'kg' | 'bpm' | 'h' | 'min' | 's' | 'km' | '%'
export type NumberBook = Map<Unit, Set<string>>

const UNIT_WORD: Record<string, Unit> = {
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb', kg: 'kg', bpm: 'bpm', h: 'h', hr: 'h', hrs: 'h', hour: 'h', hours: 'h',
  min: 'min', mins: 'min', minute: 'min', minutes: 'min', s: 's', sec: 's', secs: 's', second: 's', seconds: 's', km: 'km', '%': '%',
}

function norm(n: number): string {
  return String(Math.round(n * 100) / 100)
}

function add(book: NumberBook, unit: Unit, ...vals: Array<string | number>) {
  for (const u of new Set<Unit>([unit, ''])) {
    const set = book.get(u) ?? new Set<string>()
    for (const v of vals) set.add(typeof v === 'number' ? norm(v) : v)
    book.set(u, set)
  }
}

/** Register one numeric value with its unit, in the forms a plain line may use. */
export function addValue(book: NumberBook, v: number, unit?: string) {
  if (!Number.isFinite(v)) return
  const r1 = Math.round(v * 10) / 10
  switch (unit) {
    case 'kg': add(book, 'kg', v, r1, Math.round(v)); add(book, 'lb', kgToLbs(v), Math.round(v * 2.20462 * 2) / 2); break
    case 'lb': add(book, 'lb', v, Math.round(v)); break
    case 's': add(book, 's', v); add(book, 'min', Math.round(v / 60), Math.round((v / 60) * 10) / 10, mmss(v)); add(book, '', mmss(v)); break
    case 'min': add(book, 'min', v, Math.round(v)); add(book, '', `${Math.floor(v / 60) % 12 || 12}:${String(Math.round(v % 60)).padStart(2, '0')}`); break
    case 'h': add(book, 'h', v, r1, Math.round(v), mmss(v * 60)); add(book, '', mmss(v * 60)); break
    case 'bpm': add(book, 'bpm', v, Math.round(v)); break
    case 'km': add(book, 'km', v, r1); break
    default:
      add(book, '', v, r1, Math.round(v))
      if (v > 0 && v <= 1 && !Number.isInteger(v)) add(book, '%', Math.round(v * 100))
  }
}

/** Number tokens in a line, each with the unit word right after it (if any). */
export function numbersIn(text: string): Array<{ token: string; unit: Unit | null }> {
  const out: Array<{ token: string; unit: Unit | null }> = []
  const re = /(\d+(?::\d{2})?(?:\.\d+)?)\s*(%|[a-zA-Z]+)?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    // A digit glued to a word ("A2", "s3") is a label, not a quantity.
    if (m.index > 0 && /[A-Za-z]/.test(text[m.index - 1])) continue
    const word = (m[2] ?? '').toLowerCase()
    out.push({ token: m[1].replace(/\.0+$/, ''), unit: UNIT_WORD[word] ?? null })
  }
  return out
}

/** Every number written in a piece of app text (a dose, a rules why, his own note), kept with its unit. */
export function addText(book: NumberBook, text: string) {
  for (const { token, unit } of numbersIn(text)) add(book, unit ?? '', token)
}

export function buildNumberBook(p: Pick<DecisionPacket, 'facts' | 'notes' | 'candidates' | 'rulesWhy' | 'state' | 'week' | 'evidence'>): NumberBook {
  const book: NumberBook = new Map()
  for (const f of p.facts) if (typeof f.value === 'number') addValue(book, f.value, f.unit)
  for (const n of p.notes) addText(book, n.text)
  for (const c of p.candidates) for (const t of [c.dose, ...Object.values(c.tweaked ?? {})]) addText(book, t)
  for (const w of [...p.rulesWhy, p.state.why ?? '', ...p.week.solver.map(s => s.why)]) addText(book, w)
  // The evidence lines' measurements are the app's (the id and date are not quotable numbers).
  for (const e of p.evidence ?? []) addText(book, e.split(' | ').slice(2).join(' | '))
  return book
}

export function unsupportedNumbers(text: string, book: NumberBook): string[] {
  const bad: string[] = []
  for (const { token, unit } of numbersIn(text)) {
    const set = book.get(unit ?? '')
    if (!set || !set.has(token)) bad.push(unit ? `${token} ${unit}` : token)
  }
  return bad
}

// ─── Words ───────────────────────────────────────────────────

export { BANNED, CLASS_CONTENT } from './words'

export function wordProblems(text: string): string[] {
  const out: string[] = []
  const b = text.match(BANNED)
  if (b) out.push(`banned phrase "${b[0]}"`)
  if (CLASS_CONTENT.test(text)) out.push('tells him what to do in class')
  if (/!/.test(text)) out.push('exclamation mark')
  if (/\p{Extended_Pictographic}/u.test(text)) out.push('emoji')
  if (text.length > WHY_MAX_CHARS) out.push(`longer than ${WHY_MAX_CHARS} characters`)
  if (!text.trim()) out.push('empty')
  return out
}

// ─── verify (coach-brain.md §5.4) ────────────────────────────

export interface VerifyResult { ok: boolean; errors: string[]; decision: AiDecision | null }

const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x)

/** The rules check every AI answer. Any error refuses the whole answer. */
export function verify(packet: DecisionPacket, raw: unknown): VerifyResult {
  const errors: string[] = []
  const fail = (e: string) => { errors.push(e) }
  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['not an object'], decision: null }
  const d = raw as Partial<AiDecision>
  if (!Array.isArray(d.today) || !d.week || typeof d.week !== 'object' || !Array.isArray(d.reasons) || !Array.isArray(d.why) || !['low', 'medium', 'high'].includes(d.confidence as string)) {
    return { ok: false, errors: ['does not match the schema'], decision: null }
  }
  const byId = new Map(packet.candidates.map(c => [c.id, c]))
  const picked = new Set<string>()
  for (const p of d.today) {
    const c = p && typeof p.candidateId === 'string' ? byId.get(p.candidateId) : undefined
    if (!c) { fail(`unknown candidate id "${String(p?.candidateId)}"`); continue }
    if (picked.has(c.sessionId)) fail(`two picks for ${c.id.split('.')[0]}`)
    picked.add(c.sessionId)
    const t = p.tweak as Partial<Tweak> | undefined
    for (const k of ['setsDelta', 'loadStep', 'roundsDelta'] as const) {
      const v = t?.[k]
      if (!isInt(v)) { fail(`${c.id}: tweak ${k} is not a whole number`); continue }
      const [lo, hi] = c.range[k]
      if (v < lo || v > hi) fail(`${c.id}: tweak ${k} ${v} is outside ${lo}..${hi}`)
    }
  }

  const week = d.week as Partial<AiDecision['week']>
  if (typeof week.useSolver !== 'boolean' || !Array.isArray(week.actions)) fail('week does not match the schema')
  const actions = Array.isArray(week.actions) ? week.actions : []
  const refs = new Map(packet.week.sessions.map(s => [s.ref, s]))
  if (week.useSolver === false) {
    if (actions.length > packet.week.budget) fail(`${actions.length} week changes; at most ${packet.week.budget} tonight`)
    const seen = new Set<string>()
    for (const a of actions) {
      const s = refs.get(a?.ref)
      if (!s) { fail(`unknown session ref "${String(a?.ref)}"`); continue }
      if (seen.has(s.ref)) fail(`${s.ref} changed twice`)
      seen.add(s.ref)
      if (a.action === 'move') {
        if (!s.movable) fail(`${s.ref} can't be moved by the coach`)
        if (!a.toDay || !packet.week.days.includes(a.toDay)) fail(`${s.ref}: ${String(a.toDay)} is not a day it can move to`)
        if (a.toSlot !== 'am' && a.toSlot !== 'pm') fail(`${s.ref}: no slot`)
        if (a.toDay === s.day && a.toSlot === s.slot) fail(`${s.ref}: a move to where it already is`)
      } else if (a.action === 'rest') {
        if (!s.restable) fail(`${s.ref} can't be taken off by the coach`)
      } else fail(`${s.ref}: unknown action`)
    }
  }

  const factIds = new Set([...packet.facts.map(f => f.id), ...packet.notes.map(n => n.id)])
  for (const r of d.reasons) if (typeof r !== 'string' || !factIds.has(r)) fail(`unknown fact id "${String(r)}"`)
  // A pick above the rules' default needs its numbers cited (item 12). A note alone never counts.
  for (const p of d.today) {
    const c = p && typeof p.candidateId === 'string' ? byId.get(p.candidateId) : undefined
    if (!c?.above) continue
    const ev = c.evidenceIds ?? []
    if (!ev.some(id => (d.reasons as string[]).includes(id))) fail(`${c.id} is above the rules' pick: cite one of ${ev.join(', ') || '(none offered)'} in reasons`)
  }

  const book = buildNumberBook(packet)
  const whyRefs = new Set<string>([...d.today.map(p => p?.candidateId), ...actions.map(a => a?.ref), ...packet.week.solver.map(s => s.ref)].filter((x): x is string => typeof x === 'string'))
  for (const w of d.why) {
    if (!w || typeof w.text !== 'string' || typeof w.ref !== 'string') { fail('a why line does not match the schema'); continue }
    if (!whyRefs.has(w.ref)) fail(`why for "${w.ref}", which it did not pick or change`)
    for (const p of wordProblems(w.text)) fail(`why "${w.text.slice(0, 60)}": ${p}`)
    const bad = unsupportedNumbers(w.text, book)
    if (bad.length) fail(`why "${w.text.slice(0, 60)}": ${bad.join(', ')} not computed by the app`)
  }
  return errors.length ? { ok: false, errors, decision: null } : { ok: true, errors: [], decision: d as AiDecision }
}

// ─── The corrective retry (approved idea 6) ──────────────────

/** Marks the retry part of the user message (the replay's stand-in parser cuts here). */
export const RETRY_MARKER = "\n\nThe app's check refused your last answer:"

/**
 * One specific fix per refusal, so the one retry repairs the answer instead of
 * starting over: the ids that exist, the ranges, the numbers it may quote, the
 * evidence a push needs. At most 12 lines.
 */
export function retryFixes(packet: DecisionPacket, errors: readonly string[]): string[] {
  const out: string[] = []
  const ids = (prefix: string) => packet.candidates.filter(c => c.id.startsWith(`${prefix}.`)).map(c => c.id).join(', ')
  for (const e of errors.slice(0, 12)) {
    let fix = ''
    let m: RegExpMatchArray | null
    if ((m = e.match(/unknown candidate id "([^"]*)"/))) {
      const prefix = m[1].split('.')[0]
      fix = ids(prefix) ? `pick one of ${ids(prefix)}` : `pick only from ${packet.candidates.map(c => c.id).join(', ')}`
    } else if (/tweak \w+ .* is outside/.test(e) || /is not a whole number/.test(e)) fix = "a tweak is -1 or 0, inside that candidate's range; never up"
    else if ((m = e.match(/: (.+) not computed by the app/))) fix = `remove ${m[1]}: quote only numbers in facts, candidates, rulesWhy, state or his notes, in the same unit, or say it without a number`
    else if ((m = e.match(/banned phrase "([^"]+)"/))) fix = `drop "${m[1]}" and say it plainly`
    else if (/tells him what to do in class/.test(e)) fix = 'never say how to train in class; a class can only stay or come off'
    else if (/exclamation mark|emoji/.test(e)) fix = 'no exclamation marks or emoji'
    else if (/longer than/.test(e)) fix = `keep each why under ${WHY_MAX_CHARS} characters`
    else if ((m = e.match(/unknown fact id "([^"]*)"/))) fix = `"${m[1]}" is not an id: reasons are ids from facts or notes, as written`
    else if ((m = e.match(/is above the rules' pick: cite one of (.+) in reasons/))) fix = `cite ${m[1]} in reasons (numbers, not a note), or pick the rules' candidate`
    else if (/which it did not pick or change/.test(e)) fix = 'write a why only for a candidate you picked, a session you moved or rested, or a solver change you kept'
    else if (/can't be moved|can't be taken off/.test(e)) fix = `movable: ${packet.week.sessions.filter(s => s.movable).map(s => s.ref).join(', ') || 'none'}; restable: ${packet.week.sessions.filter(s => s.restable).map(s => s.ref).join(', ') || 'none'}`
    else if (/is not a day it can move to|no slot/.test(e)) fix = `move only to ${packet.week.days.join(', ')}, with a slot am or pm`
    else if (/week changes; at most/.test(e)) fix = `at most ${packet.week.budget} week changes tonight`
    else if (/two picks for/.test(e)) fix = 'one pick per session'
    else if (/schema|not an object|no readable JSON/.test(e)) fix = 'reply with only the JSON object in the given schema'
    out.push(fix ? `${e} -> ${fix}` : e)
  }
  return out
}

// ─── arbitrate (coach-brain.md §5.4 table) ───────────────────

export type DecisionSource = 'agree' | 'ai' | 'rules' | 'fallback' | 'offline' | 'capped' | 'quiet'

export interface FinalPick {
  sessionId: string
  candidateId: string
  level: Level
  tweak: Tweak
  /** Above the rules' default with numeric evidence (item 12): the dose lifts a HOLD to this level, under the ceiling. */
  above?: boolean
  /** The AI's why when its pick stands; null keeps the rules' own why lines. */
  why: string | null
  from: 'ai' | 'rules'
}

export interface FinalWeek {
  from: 'ai' | 'solver'
  /** AI actions (from 'ai'), else the solver's changes by ref. */
  actions: AiWeekAction[]
  solverRefs: string[]
  /** Why per session ref (s<n>) or solver ref (w<n>). */
  why: Record<string, string>
}

export interface FinalDecision {
  v: number
  source: DecisionSource
  today: FinalPick[]
  week: FinalWeek
  reasons: string[]
  confidence: Confidence | null
}

/** How the server scores a week plan (the outline solver's score and limits). */
export interface WeekScorer {
  /** The solver's best (its own changes applied) and the week as it stands. */
  best: number
  base: number
  baseViolations: number
  scoreOf(actions: AiWeekAction[]): { score: number; violations: number }
}

const ZERO: Tweak = { setsDelta: 0, loadStep: 0, roundsDelta: 0 }

/** The rules-only decision (no AI, a refused answer, offline, over the spend cap). */
export function rulesDecision(packet: DecisionPacket, source: DecisionSource): FinalDecision {
  const today = packet.candidates.filter(c => c.rules).map(c => ({ sessionId: c.sessionId, candidateId: c.id, level: c.level, tweak: ZERO, why: null, from: 'rules' as const }))
  return { v: DECISION_VERSION, source, today, week: { from: 'solver', actions: [], solverRefs: packet.week.solver.map(s => s.ref), why: {} }, reasons: [], confidence: null }
}

export interface ArbitrateOpts {
  /**
   * Session types where the AI held back the rules' PROGRESS or PUSH on the
   * last 2 decisions in a row (approved idea 5, anti-stagnation). A third ease
   * stands only with a note of his from the last 2 days; otherwise the rules'
   * progression goes ahead.
   */
  stalled?: ReadonlySet<string>
}

/** A note of his from today or yesterday. */
function freshNoteCited(packet: DecisionPacket, ai: AiDecision): boolean {
  const y = new Date(Date.parse(`${packet.today.iso}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)
  return packet.notes.some(n => ai.reasons.includes(n.id) && n.day >= y)
}

/**
 * Who wins. Per session: the same pick → the AI's version (its tweak and why);
 * more careful with a fact cited → the AI, unless the AI has already held back
 * this kind of session's progression twice running with no fresh note of his
 * (idea 5); harder → the AI only for a candidate above the rules' default with
 * its numbers cited (item 12; verify has checked them) and never on low
 * confidence; low confidence on a disagreement → the rules. The week: the AI's
 * plan when it breaks no more limits than the week already does and either
 * only takes sessions off (careful, with a fact cited) or scores within 10% of
 * the solver's best; otherwise the solver's.
 */
export function arbitrate(packet: DecisionPacket, ai: AiDecision, scorer: WeekScorer, opts: ArbitrateOpts = {}): FinalDecision {
  const rules = rulesDecision(packet, 'rules')
  const byId = new Map(packet.candidates.map(c => [c.id, c]))
  const whyOf = (ref: string) => ai.why.find(w => w.ref === ref)?.text ?? null
  const cites = ai.reasons.length > 0
  let disagreements = 0
  let overrides = 0
  const today: FinalPick[] = rules.today.map(r => {
    const pick = ai.today.find(p => byId.get(p.candidateId)?.sessionId === r.sessionId)
    const c = pick ? byId.get(pick.candidateId) : undefined
    if (!pick || !c) return r
    const tweaked = pick.tweak.setsDelta !== 0 || pick.tweak.loadStep !== 0 || pick.tweak.roundsDelta !== 0
    if (c.id === r.candidateId && !tweaked) return { ...r, why: whyOf(c.id), from: 'ai' }
    disagreements++
    const harder = levelAbove(c.level, r.level)
    if (harder) {
      const evidence = (c.evidenceIds ?? []).some(id => ai.reasons.includes(id))
      if (!c.above || !evidence || ai.confidence === 'low') return r
      overrides++
      return { sessionId: r.sessionId, candidateId: c.id, level: c.level, tweak: pick.tweak, why: whyOf(c.id), from: 'ai', above: true }
    }
    if (!cites || ai.confidence === 'low') return r
    const rulesProgress = r.level === 'PROGRESS' || r.level === 'PUSH'
    if (rulesProgress && opts.stalled?.has(c.sessionType) && !freshNoteCited(packet, ai)) return r
    overrides++
    return { sessionId: r.sessionId, candidateId: c.id, level: c.level, tweak: pick.tweak, why: whyOf(c.id), from: 'ai' }
  })

  let week: FinalWeek = { ...rules.week, why: Object.fromEntries(packet.week.solver.map(s => [s.ref, whyOf(s.ref) ?? s.why])) }
  if (!ai.week.useSolver) {
    const sameAsSolver = sameWeek(ai.week.actions, packet)
    if (!sameAsSolver) {
      disagreements++
      const { score, violations } = scorer.scoreOf(ai.week.actions)
      const onlyRests = ai.week.actions.length > 0 && ai.week.actions.every(a => a.action === 'rest')
      const withinTen = score >= scorer.best - Math.abs(scorer.best) * 0.1 - 1e-9
      const ok = violations <= scorer.baseViolations && ai.confidence !== 'low' && ((onlyRests && cites) || withinTen)
      if (ok) {
        overrides++
        week = { from: 'ai', actions: ai.week.actions, solverRefs: [], why: Object.fromEntries(ai.week.actions.map(a => [a.ref, whyOf(a.ref) ?? ''])) }
      }
    }
  }
  const source: DecisionSource = disagreements === 0 ? 'agree' : overrides > 0 ? 'ai' : 'rules'
  return { v: DECISION_VERSION, source, today, week, reasons: ai.reasons, confidence: ai.confidence }
}

/** The AI's actions are exactly the solver's moves and rests (it can't add a class itself). */
function sameWeek(actions: AiWeekAction[], packet: DecisionPacket): boolean {
  const solver = packet.week.solver
  if (solver.some(s => s.kind === 'add')) return false
  if (actions.length !== solver.length) return false
  return solver.every(s => actions.some(a => a.ref === s.session && a.action === s.kind && (s.kind === 'rest' || (a.toDay === s.to?.day && a.toSlot === s.to?.slot))))
}

// ─── Cost and the daily spend cap ────────────────────────────

/** Opus 5.5 per million tokens (Claude API, cached 2026-10-06): input, output, cache read, 5-min cache write. */
export const PRICE_PER_MTOK = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 } as const

/**
 * The most the coach spends on AI in any 24 hours (a constant, not a setting).
 * A normal night is about $0.10-0.20; this leaves room for one retry and a
 * second night's run on a deploy day, then everything is rules only.
 */
export const DAILY_SPEND_CAP_USD = 1.0
/** And never more than this many decision calls in 24 hours (§5.5: 3 a night). */
export const DAILY_CALL_CAP = 3

export function costUsd(u: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }): number {
  const c = (u.input_tokens * PRICE_PER_MTOK.input + u.output_tokens * PRICE_PER_MTOK.output + (u.cache_read_input_tokens ?? 0) * PRICE_PER_MTOK.cacheRead + (u.cache_creation_input_tokens ?? 0) * PRICE_PER_MTOK.cacheWrite) / 1e6
  return Math.round(c * 10000) / 10000
}

/** Facts as the packet shows them: kg in lb (his units), stable order, no nulls. */
export function packetFacts(facts: readonly Fact[]): PacketFact[] {
  return facts
    .filter(f => f.value != null && f.value !== '')
    .map(f => (f.unit === 'kg' && typeof f.value === 'number' ? { id: f.id.replace(/Kg$/, 'Lb'), value: kgToLbs(f.value), unit: 'lb' } : { id: f.id, value: f.value, ...(f.unit ? { unit: f.unit } : {}) }))
}
