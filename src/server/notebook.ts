// The coach's notebook on the server (item 1; pure rules in lib/brain/notebook.ts).
//
// - loadEvidenceIndex: every raw row a lesson may cite, from the active
//   block's start to today: sessions (s:<id>), sets (set:<id>), check-ins
//   (ci:<day>) and his notes (n:ci:<day>, n:back:<day>, n:s:<id>, n:skip:<id>,
//   n:j:<id>). Ids are the row id's first 8 characters (or the date), so they
//   stay the same night to night. Josh starts from scratch at the block start.
// - rebuildNotebook: every lesson's status, dates, counts and source worked
//   out again from its evidence links and the rows that still exist.
// - applyNotebookOps: the AI's proposals after code's check (checkOps): new
//   lessons and new evidence links only. A claim is never edited.

import { and, eq, gte, inArray, lte } from 'drizzle-orm'
import { coachLessonEvidence, coachLessons, dailyLogs, exercises, journalEntries, runSessions, sessions, strengthSessionExercises, strengthSets } from '../db/schema'
import type { createDB } from '../db/client'
import { kgToLbs } from '../lib/units'
import { isoOf } from '../lib/coach'
import { checkOps, rebuildLesson, type EvidenceItem, type Lesson, type LessonKind, type LessonLink, type LessonSource, type LessonStatus, type OpsResult } from '../lib/brain/notebook'
import { reasonWords } from './changes'
import { modelFromDay } from './athleteModel'

type DB = ReturnType<typeof createDB>

const short = (id: string) => id.slice(0, 8)
const NAME: Record<string, string> = { strength: 'Strength', foundation_run: 'Run-Walk', running: 'Run', bag_work: 'Bag Work', mt_class: 'MT Class', skip_rope: 'Skip Rope', mobility: 'Foundation', active_recovery: 'Reset' }
const MACHINE_NOTE = /^(zone2|progression|tempo|intervals|long|easy)$/i
const clip = (t: string, n = 160) => t.trim().replace(/\s+/g, ' ').slice(0, n)

/** Every citable row from the block start (Josh starts from scratch there) to today. */
export async function loadEvidenceIndex(db: DB, today: number): Promise<Map<string, EvidenceItem>> {
  const from = await modelFromDay(db, today)
  const index = new Map<string, EvidenceItem>()
  if (from > today) return index
  const put = (it: EvidenceItem) => { if (!index.has(it.id)) index.set(it.id, it) }

  const sess = await db.select().from(sessions).where(and(gte(sessions.scheduledDate, from), lte(sessions.scheduledDate, today)))
  const done = sess.filter(s => s.scheduledDate != null && (s.status === 'completed' || s.status === 'skipped' || s.status === 'missed') && s.skipReason !== 'coach_rest')
  const ids = done.map(s => s.id)
  const sets = ids.length ? await db.select({
    id: strengthSets.id, sessionId: strengthSessionExercises.sessionId, exerciseId: strengthSessionExercises.exerciseId, section: strengthSessionExercises.section,
    weightKg: strengthSets.weightKg, reps: strengthSets.reps, rir: strengthSets.rir, isWarmup: strengthSets.isWarmup, completedAt: strengthSets.completedAt, setNumber: strengthSets.setNumber,
  }).from(strengthSets).innerJoin(strengthSessionExercises, eq(strengthSessionExercises.id, strengthSets.sessionExerciseId)).where(inArray(strengthSessionExercises.sessionId, ids)) : []
  const exName = new Map((await db.select({ id: exercises.id, name: exercises.name }).from(exercises)).map(e => [e.id, e.name]))
  const runs = ids.length ? await db.select().from(runSessions).where(inArray(runSessions.sessionId, ids)) : []

  for (const s of done) {
    const day = s.scheduledDate as number
    const name = s.label ?? NAME[s.type] ?? s.type
    const parts: string[] = []
    if (s.status === 'completed') {
      parts.push(`${name} done`)
      if (s.rpe != null) parts.push(`RPE ${s.rpe}`)
      if (s.type === 'strength') {
        const main = sets.filter(x => x.sessionId === s.id && x.section === 'main' && x.isWarmup !== 1 && x.completedAt != null)
        for (const exId of [...new Set(main.map(x => x.exerciseId))]) {
          const mine = main.filter(x => x.exerciseId === exId).sort((a, b) => a.setNumber - b.setNumber)
          const top = Math.max(...mine.map(x => x.weightKg ?? 0))
          const last = mine[mine.length - 1]
          parts.push(`${exName.get(exId) ?? exId} ${mine.length} x ${last.reps}${top > 0 ? ` at ${kgToLbs(top)} lb` : ''}${last.rir != null ? `, ${last.rir >= 3 ? '3+' : last.rir} left on the last set` : ''}`)
        }
      }
      const run = runs.find(r => r.sessionId === s.id)
      if (run) {
        if (run.durationSec) parts.push(`${Math.round(run.durationSec / 60)} min`)
        if (run.distanceKm) parts.push(`${Math.round(run.distanceKm * 10) / 10} km`)
        if (run.avgHr) parts.push(`HR ${run.avgHr} avg`)
        if (run.completionStatus === 'shortened' || run.completionStatus === 'partial') parts.push(`ended early${run.shortReason ? ` (${run.shortReason.replace(/_/g, ' ')})` : ''}`)
      }
    } else parts.push(`${name} ${s.status}${s.skipReason ? ` (${reasonWords(s.skipReason)?.toLowerCase() ?? s.skipReason.replace(/_/g, ' ')})` : ''}`)
    put({ id: `s:${short(s.id)}`, day, kind: 'session', said: false, text: parts.join(', ') })
    if (s.notes?.trim() && !MACHINE_NOTE.test(s.notes.trim())) put({ id: `n:s:${short(s.id)}`, day, kind: 'note', said: true, text: `${name}: ${clip(s.notes)}` })
    if (s.status === 'skipped' && s.skipReason) put({ id: `n:skip:${short(s.id)}`, day, kind: 'note', said: true, text: `${name} skipped: ${reasonWords(s.skipReason) ?? s.skipReason.replace(/_/g, ' ')}` })
  }
  for (const x of sets) {
    const s = done.find(q => q.id === x.sessionId)
    if (!s || x.completedAt == null) continue
    put({ id: `set:${short(x.id)}`, day: s.scheduledDate as number, kind: 'set', said: false, text: `${exName.get(x.exerciseId) ?? x.exerciseId} ${x.reps} reps${x.weightKg ? ` at ${kgToLbs(x.weightKg)} lb` : ''}${x.rir != null ? `, ${x.rir} left` : ''}` })
  }
  const logs = await db.select().from(dailyLogs).where(and(gte(dailyLogs.logDate, from), lte(dailyLogs.logDate, today)))
  for (const l of logs) {
    const iso = isoOf(l.logDate)
    const items = [
      l.sleepHours != null ? `sleep ${l.sleepHours} h` : null, l.sleepQuality != null ? `sleep quality ${l.sleepQuality}` : null, l.energy != null ? `energy ${l.energy}` : null,
      l.soreness != null ? `soreness ${l.soreness}` : null, l.stress != null ? `stress ${l.stress}` : null, l.mood != null ? `mood ${l.mood}` : null, l.backToday != null ? `back ${l.backToday}` : null,
    ].filter(Boolean)
    if (items.length) put({ id: `ci:${iso}`, day: l.logDate, kind: 'checkin', said: false, text: `check-in: ${items.join(', ')}` })
    if (l.notes?.trim()) put({ id: `n:ci:${iso}`, day: l.logDate, kind: 'note', said: true, text: clip(l.notes) })
    if (l.backNotes?.trim()) put({ id: `n:back:${iso}`, day: l.logDate, kind: 'note', said: true, text: `back: ${clip(l.backNotes)}` })
  }
  const journal = await db.select().from(journalEntries).where(and(gte(journalEntries.date, from), lte(journalEntries.date, today)))
  for (const j of journal) if (j.content?.trim()) put({ id: `n:j:${short(j.id)}`, day: j.date, kind: 'note', said: true, text: clip(j.content) })
  return index
}

export async function loadNotebook(db: DB): Promise<{ lessons: Lesson[]; links: LessonLink[] }> {
  const rows = await db.select().from(coachLessons)
  const links = await db.select().from(coachLessonEvidence)
  return {
    lessons: rows.map(r => ({
      id: r.id, kind: r.kind as LessonKind, claim: r.claim, source: r.source as LessonSource, status: r.status as LessonStatus,
      firstSeenDay: r.firstSeenDay, lastConfirmedDay: r.lastConfirmedDay, support: r.supportCount, counter: r.counterCount,
      createdDay: r.createdDay, retiredDay: r.retiredDay, retiredReason: r.retiredReason,
    })),
    links: links.map(l => ({ lessonId: l.lessonId, evidenceId: l.evidenceId, role: l.role as LessonLink['role'] })),
  }
}

/** Every lesson's record worked out again from its links and the raw rows that still exist. */
export async function rebuildNotebook(db: DB, today: number, nowSec: number, index?: Map<string, EvidenceItem>): Promise<Lesson[]> {
  const idx = index ?? await loadEvidenceIndex(db, today)
  const { lessons, links } = await loadNotebook(db)
  const out: Lesson[] = []
  for (const l of lessons) {
    const r = rebuildLesson(l, links.filter(x => x.lessonId === l.id), idx, today)
    const retiredDay = r.status === 'retired' ? (l.retiredDay ?? today) : null
    const next: Lesson = { ...l, status: r.status, source: r.source, firstSeenDay: r.firstSeenDay, lastConfirmedDay: r.lastConfirmedDay, support: r.support, counter: r.counter, retiredDay, retiredReason: r.retiredReason }
    const changed = next.status !== l.status || next.source !== l.source || next.firstSeenDay !== l.firstSeenDay || next.lastConfirmedDay !== l.lastConfirmedDay || next.support !== l.support || next.counter !== l.counter || next.retiredReason !== l.retiredReason
    if (changed) {
      await db.update(coachLessons).set({
        status: next.status, source: next.source, firstSeenDay: next.firstSeenDay, lastConfirmedDay: next.lastConfirmedDay,
        supportCount: next.support, counterCount: next.counter, retiredDay, retiredReason: next.retiredReason, updatedAt: nowSec,
      }).where(eq(coachLessons.id, l.id))
    }
    out.push(next)
  }
  return out
}

/** The AI's notebook proposals, checked by code, then written: new lessons and new evidence links only. */
export async function applyNotebookOps(db: DB, raw: unknown, ctx: { today: number; nowSec: number; decisionId: string; index: Map<string, EvidenceItem>; refs: Map<string, string> }): Promise<OpsResult> {
  const { lessons, links } = await loadNotebook(db)
  const result = checkOps(raw, { today: ctx.today, index: ctx.index, lessons, links, refs: ctx.refs })
  for (const a of result.accepted) {
    const lessonId = a.op === 'add' ? crypto.randomUUID() : a.lessonId
    if (a.op === 'add') {
      const ds = a.evidence.map(e => e.day)
      await db.insert(coachLessons).values({
        id: lessonId, kind: a.kind, claim: a.claim, source: a.source, status: 'candidate', firstSeenDay: Math.min(...ds), lastConfirmedDay: Math.max(...ds),
        supportCount: new Set(ds).size, counterCount: 0, createdDay: ctx.today, createdDecisionId: ctx.decisionId, updatedAt: ctx.nowSec,
      })
    }
    const role = a.op === 'retire' ? 'counter' : 'support'
    for (const e of a.evidence) {
      await db.insert(coachLessonEvidence).values({ id: crypto.randomUUID(), lessonId, evidenceId: e.id, role, day: e.day, addedDay: ctx.today, decisionId: ctx.decisionId }).onConflictDoNothing()
    }
  }
  if (result.accepted.length) await rebuildNotebook(db, ctx.today, ctx.nowSec, ctx.index)
  return result
}
