// The Ledger's goal boards on the server (page 79, approved 2026-10-23): reads
// what the pure board functions (lib/ledgerBoards.ts) need, from rows the
// Ledger route already holds plus the bag rounds, combos and settings.

import { bagWorkRounds, comboPerformance, combos, settings, trainingBlocks, type runSessions, type sessions, type strengthSessionExercises, type strengthSets } from '../db/schema'
import type { createDB } from '../db/client'
import { parseClassDays } from '../lib/classSlots'
import { loadEasyHrCeiling } from '../lib/hrAnalysis'
import { isLoggedWorkSet } from '../lib/loggedSets'
import { weightWeekly, type WeeklyPoint } from '../lib/ledger'
import type { ReadinessReport } from '../lib/brain/readinessParts'
import {
  bodyBoard, easyRunsAtLine, easyRunsEmptyLine, fightBoard, fiveKBoard, fiveKTestSec, plainNextBlock, setSpeedKmh, strengthSince,
  type BodyView, type EasyRunRow, type EasyRunsView, type LiftSetRow, type FightView, type FiveKView, type NextBlockView, type StrengthSinceView,
} from '../lib/ledgerBoards'

type DB = ReturnType<typeof createDB>
type SessionRow = typeof sessions.$inferSelect
type RunRow = typeof runSessions.$inferSelect
type SexRow = typeof strengthSessionExercises.$inferSelect
type SetRow = typeof strengthSets.$inferSelect

const RUN_TYPES = new Set(['foundation_run', 'running'])

export interface LedgerGoalBoards {
  /** Page 79 §2: the 5K first, then easy runs at his own heart line. */
  running: { fiveK: FiveKView; easy: EasyRunsView & { empty: string | null } }
  fight: FightView
  lifts: StrengthSinceView
  /** In Block Zero: the meter in plain words. */
  nextBlock: NextBlockView | null
  body: BodyView & { points: WeeklyPoint[]; weighIns: number }
}

/** Week 1 of "since you started": the latest Block Zero's first day (else the active block's, else today). */
export function programStartDay(blocks: ReadonlyArray<{ blockType: string; status: string; startedAt: number | null; createdAt: number }>, today: number): number {
  const day = (b: { startedAt: number | null; createdAt: number }) => Math.floor((b.startedAt ?? b.createdAt) / 86400)
  const ordered = [...blocks].sort((a, b) => a.createdAt - b.createdAt)
  const zero = ordered.filter(b => b.blockType === 'block_zero').pop()
  const active = ordered.find(b => b.status === 'active')
  const start = zero ? day(zero) : active ? day(active) : today
  return Math.min(start, today)
}

function parse(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null
  try { const v = JSON.parse(raw) as unknown; return v && typeof v === 'object' ? v as Record<string, unknown> : null } catch { return null }
}

export async function ledgerGoalBoards(db: DB, inp: {
  today: number
  weeks: number
  allSessions: SessionRow[]
  allRuns: RunRow[]
  allSexes: SexRow[]
  allSets: SetRow[]
  weights: { epochDay: number; weightLbs: number }[]
  readiness: ReadinessReport | null
}): Promise<LedgerGoalBoards> {
  const { today, weeks, allSessions, allRuns, allSexes, allSets } = inp
  const [blocks, rounds, comboRows, ratings, settingRows, line] = await Promise.all([
    db.select().from(trainingBlocks),
    db.select({ sessionId: bagWorkRounds.sessionId }).from(bagWorkRounds),
    db.select({ id: combos.id, text: combos.text, score: combos.masteryScore, unlocked: combos.unlocked }).from(combos),
    db.select({ comboId: comboPerformance.comboId, rating: comboPerformance.rating }).from(comboPerformance),
    db.select({ mtClassDays: settings.mtClassDays }).from(settings),
    loadEasyHrCeiling(db, today),
  ])
  const start = programStartDay(blocks, today)
  const dayOf = (s: SessionRow) => s.scheduledDate ?? Math.floor((s.completedAt ?? s.createdAt) / 86400)
  const byId = new Map(allSessions.map(s => [s.id, s]))
  const done = (s: SessionRow | undefined): s is SessionRow => s?.status === 'completed'

  // ── Running ──
  const tests: { day: number; sec: number }[] = []
  const easyRows: EasyRunRow[] = []
  let lastRunDay: number | null = null
  let runsSinceStart = 0
  for (const r of allRuns) {
    const s = byId.get(r.sessionId)
    if (!done(s)) continue
    const day = dayOf(s)
    const sec = fiveKTestSec({ runType: r.runType, durationSec: r.durationSec, distanceKm: r.distanceKm, contextJson: s.contextJson })
    if (sec != null) tests.push({ day, sec })
    easyRows.push({ epochDay: day, avgHr: r.avgHr, completed: true, runType: r.runType, paceSecKm: r.paceSecKm, distanceKm: r.distanceKm, durationSec: r.durationSec, speedKmh: setSpeedKmh(s.doseJson, s.contextJson) })
    if (day <= today) {
      lastRunDay = lastRunDay == null ? day : Math.max(lastRunDay, day)
      if (day >= start) runsSinceStart++
    }
  }
  const nextRun = allSessions
    .filter(s => RUN_TYPES.has(s.type) && s.status === 'planned' && s.scheduledDate != null && s.scheduledDate >= today)
    .sort((a, b) => a.scheduledDate! - b.scheduledDate!)[0] ?? null
  const easy = easyRunsAtLine(easyRows, line.bpm, weeks, today)

  // ── Fight ──
  const roundsBySession = new Map<string, number>()
  for (const r of rounds) roundsBySession.set(r.sessionId, (roundsBySession.get(r.sessionId) ?? 0) + 1)
  const bag = allSessions.filter(s => s.type === 'bag_work' && done(s)).map(s => ({ day: dayOf(s), rounds: roundsBySession.get(s.id) ?? 0 }))
  const rated = new Set(ratings.filter(r => r.rating > 0).map(r => r.comboId))
  const fight = fightBoard({
    rounds: bag,
    classDays: allSessions.filter(s => s.type === 'mt_class' && done(s)).map(dayOf),
    classDaysPicked: parseClassDays(settingRows[0]?.mtClassDays).length > 0,
    combos: comboRows.filter(c => c.unlocked === 1).map(c => ({ text: c.text, score: c.score, rated: rated.has(c.id) })),
  }, start, today)

  // ── Strength since you started ──
  const sexById = new Map(allSexes.map(se => [se.id, se]))
  const liftSets: LiftSetRow[] = []
  for (const st of allSets) {
    if (!isLoggedWorkSet(st) || st.weightKg == null || st.weightKg <= 0 || st.reps < 1) continue
    const se = sexById.get(st.sessionExerciseId)
    if (!se || (se.section != null && se.section !== 'main')) continue
    const s = byId.get(se.sessionId)
    if (!done(s)) continue
    liftSets.push({ day: dayOf(s), exerciseId: se.exerciseId, weightKg: st.weightKg, reps: st.reps })
  }
  const nextLift = allSessions
    .filter(s => s.type === 'strength' && s.status === 'planned' && s.scheduledDate != null && s.scheduledDate >= today)
    .sort((a, b) => a.scheduledDate! - b.scheduledDate!)[0] ?? null
  let plannedIds: string[] = []
  if (nextLift) {
    plannedIds = allSexes.filter(se => se.sessionId === nextLift.id && (se.section == null || se.section === 'main')).sort((a, b) => a.orderIndex - b.orderIndex).map(se => se.exerciseId)
    if (plannedIds.length === 0) {
      const lifts = (parse(nextLift.doseJson)?.strength as { lifts?: Array<{ exerciseId?: unknown }> } | undefined)?.lifts ?? []
      plannedIds = lifts.map(l => (typeof l.exerciseId === 'string' ? l.exerciseId : '')).filter(Boolean)
    }
  }
  const lifts = strengthSince(liftSets, start, today, { exerciseIds: plannedIds, day: nextLift?.scheduledDate ?? null, label: nextLift?.label ?? null })

  // ── Next block, Body ──
  const firstRunSec = nextRun ? (parse(nextRun.doseJson)?.run as { totalSec?: unknown } | undefined)?.totalSec : null
  const nextBlock = inp.readiness ? plainNextBlock(inp.readiness, { firstRunMin: runsSinceStart === 0 && typeof firstRunSec === 'number' ? Math.round(firstRunSec / 60) : null }) : null
  const weight = weightWeekly(inp.weights, weeks, today)
  const body = { ...bodyBoard(weight.points, weight.weighIns, { up: lifts.up, of: lifts.started ? lifts.lifts.length : 0 }), ...weight }

  return {
    running: {
      fiveK: fiveKBoard(tests, start, today),
      easy: { ...easy, empty: easy.points.length ? null : easyRunsEmptyLine(lastRunDay, nextRun?.scheduledDate ?? null, runsSinceStart === 0, today) },
    },
    fight,
    lifts,
    nextBlock,
    body,
  }
}

