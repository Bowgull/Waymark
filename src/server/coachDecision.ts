// Coach brain P3 on the server (coach-brain.md §5.3-5.5): the one AI call a
// night and its records. The packet, verify and arbitrate are pure
// (lib/brain/decision.ts); the candidates and the writes live with the rest of
// the nightly pass (server/brain.ts). Here:
//
// - loadRecentNotes: his own words from the last 14 days (check-in notes, back
//   notes, session notes, Waybook entries, skip reasons): what the AI reads
//   that code can't.
// - spendToday: what the decision calls cost in the last 24 hours (the daily
//   spend cap, a constant in lib/brain/decision.ts).
// - callDecision: claude-opus-5-5, adaptive thinking at medium effort, strict
//   structured output, the playbook as a cached system block, the server-side
//   refusal fallback. Every answer goes through verify; a refused answer gets
//   one retry with the errors, then the rules' pick stands. Any failure
//   (no key, a rejected parameter, a timeout, a refusal) is "offline": the
//   rules' pick, silently.
// - storeDecision: one coach_decisions row a night.

import { and, eq, gte, lte } from 'drizzle-orm'
import { coachDecisions, dailyLogs, journalEntries, sessions } from '../db/schema'
import type { createDB } from '../db/client'
import { anthropicCall, cachedSystem, getStructuredOutput, type AnthropicRequest, type AnthropicUsage } from '../lib/anthropic'
import { MODELS } from '../lib/models'
import { COACH_PLAYBOOK } from '../lib/prompts/coachPlaybook'
import { costUsd, DAILY_CALL_CAP, DAILY_SPEND_CAP_USD, DECISION_SCHEMA, RETRY_MARKER, retryFixes, verify, type DecisionPacket, type FinalDecision, type NoteFact, type VerifyResult } from '../lib/brain/decision'
import { isoOf } from '../lib/coach'
import { reasonWords } from './changes'
import type { TempState } from '../lib/brain/tempStates'
import { LEVELS, type Level } from '../lib/brain/doses'

type DB = ReturnType<typeof createDB>

export const NOTE_DAYS = 14
const NOTE_MAX_CHARS = 600
/** One attempt's limit; the pass runs overnight, so the AI may take its time (§5.5). */
export const DECISION_TIMEOUT_MS = 90_000
/** Room for adaptive thinking at medium effort plus the JSON. */
const MAX_TOKENS = 16_000
/** A run category stored in sessions.notes, not his words. */
const MACHINE_NOTE = /^(zone2|progression|tempo|intervals|long|easy)$/i


/** His own words from the last 14 days, oldest first, each with a stable id (f.note.<n>). */
export async function loadRecentNotes(db: DB, today: number, temp?: readonly TempState[]): Promise<NoteFact[]> {
  const from = today - NOTE_DAYS + 1
  const logs = await db.select({ day: dailyLogs.logDate, notes: dailyLogs.notes, back: dailyLogs.backNotes }).from(dailyLogs)
    .where(and(gte(dailyLogs.logDate, from), lte(dailyLogs.logDate, today)))
  const sess = await db.select({ id: sessions.id, day: sessions.scheduledDate, label: sessions.label, type: sessions.type, notes: sessions.notes, status: sessions.status, skipReason: sessions.skipReason })
    .from(sessions).where(and(gte(sessions.scheduledDate, from), lte(sessions.scheduledDate, today)))
  const journal = await db.select({ id: journalEntries.id, day: journalEntries.date, content: journalEntries.content }).from(journalEntries)
    .where(and(gte(journalEntries.date, from), lte(journalEntries.date, today)))
  // Each note keeps its notebook evidence id (server/notebook.ts uses the same ids).
  const raw: Array<{ day: number; source: NoteFact['source']; text: string; ev: string }> = []
  for (const l of logs) {
    if (l.notes?.trim()) raw.push({ day: l.day, source: 'check_in', text: l.notes, ev: `n:ci:${isoOf(l.day)}` })
    if (l.back?.trim()) raw.push({ day: l.day, source: 'back', text: l.back, ev: `n:back:${isoOf(l.day)}` })
  }
  for (const s of sess) {
    if (s.day == null) continue
    const name = s.label ?? s.type
    if (s.notes?.trim() && !MACHINE_NOTE.test(s.notes.trim()) && (s.status === 'completed' || s.status === 'skipped')) raw.push({ day: s.day, source: 'session', text: `${name}: ${s.notes}`, ev: `n:s:${s.id.slice(0, 8)}` })
    if (s.status === 'skipped' && s.skipReason && s.skipReason !== 'coach_rest') raw.push({ day: s.day, source: 'skip', text: `${name} skipped: ${reasonWords(s.skipReason) ?? s.skipReason.replace(/_/g, ' ')}`, ev: `n:skip:${s.id.slice(0, 8)}` })
  }
  for (const j of journal) if (j.content?.trim()) raw.push({ day: j.day, source: 'journal', text: j.content, ev: `n:j:${j.id.slice(0, 8)}` })
  const order: Record<NoteFact['source'], number> = { check_in: 0, back: 1, session: 2, skip: 3, journal: 4 }
  raw.sort((a, b) => a.day - b.day || order[a.source] - order[b.source] || a.text.localeCompare(b.text))
  return raw.map((n, i) => {
    const note: NoteFact = { id: `f.note.${i}`, day: isoOf(n.day), source: n.source, text: n.text.trim().replace(/\s+/g, ' ').slice(0, NOTE_MAX_CHARS), ev: n.ev }
    // A short state this note started that has ended (idea 8): marked, so it reads as history.
    const s = temp?.find(t => t.mentions.includes(n.day) && t.untilDay < today)
    return s ? { ...note, ended: `${s.kind} ended ${isoOf(s.untilDay)}` } : note
  })
}

/** Decision calls and their cost in the 24 hours before `nowSec`. */
export async function spendToday(db: DB, nowSec: number): Promise<{ usd: number; calls: number }> {
  const rows = await db.select({ cost: coachDecisions.costUsd, calls: coachDecisions.calls }).from(coachDecisions).where(gte(coachDecisions.decidedAt, nowSec - 86400))
  return { usd: rows.reduce((s, r) => s + (r.cost ?? 0), 0), calls: rows.reduce((s, r) => s + (r.calls ?? 0), 0) }
}

/**
 * Anti-stagnation (approved idea 5): session types where the AI held back the
 * rules' PROGRESS or PUSH on the last 2 decisions that offered one, in a row
 * (a lower pick or a down tweak). arbitrate then lets the rules' progression
 * through unless a fresh note of his says otherwise.
 */
export async function loadStalled(db: DB, today: number): Promise<Set<string>> {
  const rows = await db.select({ day: coachDecisions.day, candidatesJson: coachDecisions.candidatesJson, finalJson: coachDecisions.finalJson }).from(coachDecisions)
    .where(and(gte(coachDecisions.day, today - 21), lte(coachDecisions.day, today - 1)))
  rows.sort((a, b) => b.day - a.day)
  const denied = new Map<string, number>()
  const settled = new Set<string>()
  for (const r of rows) {
    let cands: Array<{ sessionId: string; sessionType: string; level: string; rules: boolean }> = []
    let final: FinalDecision | null = null
    try { cands = JSON.parse(r.candidatesJson); final = JSON.parse(r.finalJson) as FinalDecision } catch { continue }
    for (const c of cands.filter(x => x.rules && (x.level === 'PROGRESS' || x.level === 'PUSH'))) {
      if (settled.has(c.sessionType)) continue
      const pick = final?.today.find(t => t.sessionId === c.sessionId)
      const held = pick != null && pick.from === 'ai' && (LEVELS.indexOf(pick.level) < LEVELS.indexOf(c.level as Level) || pick.tweak.setsDelta < 0 || pick.tweak.loadStep < 0 || pick.tweak.roundsDelta < 0)
      if (held) denied.set(c.sessionType, (denied.get(c.sessionType) ?? 0) + 1)
      else settled.add(c.sessionType)
    }
  }
  return new Set([...denied.entries()].filter(([, n]) => n >= 2).map(([t]) => t))
}

export function overCap(spent: { usd: number; calls: number }): boolean {
  return spent.usd >= DAILY_SPEND_CAP_USD || spent.calls >= DAILY_CALL_CAP
}

export async function existingDecision(db: DB, day: number, trigger = 'nightly'): Promise<{ id: string; final: FinalDecision } | null> {
  const [row] = await db.select({ id: coachDecisions.id, finalJson: coachDecisions.finalJson }).from(coachDecisions)
    .where(and(eq(coachDecisions.day, day), eq(coachDecisions.trigger, trigger))).limit(1)
  if (!row) return null
  try { return { id: row.id, final: JSON.parse(row.finalJson) as FinalDecision } } catch { return null }
}

export function decisionRequest(packet: DecisionPacket, refused: string[] | null, last: unknown = null): AnthropicRequest {
  const body = JSON.stringify(packet)
  // The corrective retry (idea 6): each refusal with its specific fix, plus the refused answer to repair.
  const content = refused
    ? `${body}${RETRY_MARKER}\n- ${retryFixes(packet, refused).join('\n- ')}${last != null ? `\nYour refused answer: ${JSON.stringify(last).slice(0, 4000)}` : ''}\nFix only what was refused and answer again, inside the candidates and ranges, with only numbers the app gave you.`
    : body
  return {
    model: MODELS.decision,
    max_tokens: MAX_TOKENS,
    system: [cachedSystem(COACH_PLAYBOOK)],
    messages: [{ role: 'user', content }],
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: DECISION_SCHEMA } },
    fallbacks: 'default',
  }
}

export interface CallOutcome {
  /** The verified answer, or null (offline, refused twice, unreadable). */
  verified: VerifyResult | null
  /** The last raw answer (kept for the record, even when refused). */
  raw: unknown
  offline: boolean
  calls: number
  model: string | null
  latencyMs: number
  usage: Required<AnthropicUsage>
  costUsd: number
  errors: string[]
}

/** The decision call with one retry on a refused answer, inside the calls still allowed today. */
export async function callDecision(apiKey: string, packet: DecisionPacket, callsLeft: number): Promise<CallOutcome> {
  const usage: Required<AnthropicUsage> = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  const out: CallOutcome = { verified: null, raw: null, offline: false, calls: 0, model: null, latencyMs: 0, usage, costUsd: 0, errors: [] }
  let refused: string[] | null = null
  const t0 = Date.now()
  for (let attempt = 0; attempt < 2 && out.calls < callsLeft; attempt++) {
    out.calls++
    const res = await anthropicCall(apiKey, decisionRequest(packet, refused, out.raw), { timeoutMs: DECISION_TIMEOUT_MS })
    if (res.offline) { out.offline = true; break }
    out.model = res.model
    usage.input_tokens += res.usage.input_tokens ?? 0
    usage.output_tokens += res.usage.output_tokens ?? 0
    usage.cache_read_input_tokens += res.usage.cache_read_input_tokens ?? 0
    usage.cache_creation_input_tokens += res.usage.cache_creation_input_tokens ?? 0
    const parsed = getStructuredOutput<unknown>(res)
    out.raw = parsed
    const v = parsed == null ? { ok: false, errors: ['no readable JSON'], decision: null } : verify(packet, parsed)
    if (v.ok) { out.verified = v; break }
    out.errors.push(...v.errors.map(e => `try ${attempt + 1}: ${e}`))
    refused = v.errors
  }
  out.latencyMs = Date.now() - t0
  out.costUsd = costUsd(usage)
  return out
}

export interface DecisionRecord {
  id: string
  day: number
  nowSec: number
  inputHash: string
  packet: DecisionPacket
  rules: FinalDecision
  final: FinalDecision
  call: CallOutcome | null
  /** What the AI proposed for the notebook and what code accepted or refused (item 1). */
  notebook?: { proposed: unknown; accepted: unknown[]; refused: unknown[] } | null
}

export async function storeDecision(db: DB, r: DecisionRecord): Promise<void> {
  const c = r.call
  await db.insert(coachDecisions).values({
    id: r.id, day: r.day, decidedAt: r.nowSec, trigger: 'nightly', inputHash: r.inputHash,
    factsJson: JSON.stringify({ state: r.packet.state, facts: r.packet.facts, notes: r.packet.notes, week: r.packet.week, rulesWhy: r.packet.rulesWhy }),
    candidatesJson: JSON.stringify(r.packet.candidates),
    rulesPickJson: JSON.stringify(r.rules),
    aiPickJson: c?.raw != null ? JSON.stringify(c.raw) : null,
    finalJson: JSON.stringify(r.final),
    source: r.final.source,
    model: c?.model ?? null,
    calls: c?.calls ?? 0,
    latencyMs: c ? c.latencyMs : null,
    inputTokens: c ? c.usage.input_tokens : null,
    outputTokens: c ? c.usage.output_tokens : null,
    cacheReadTokens: c ? c.usage.cache_read_input_tokens : null,
    cacheWriteTokens: c ? c.usage.cache_creation_input_tokens : null,
    costUsd: c?.costUsd ?? 0,
    verifyErrorsJson: c && c.errors.length ? JSON.stringify(c.errors) : null,
    notebookJson: r.notebook ? JSON.stringify(r.notebook) : null,
  }).onConflictDoNothing()
}

/** A stable hash of the night's inputs (the decision key). */
export async function inputHash(packet: DecisionPacket): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(packet))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}
