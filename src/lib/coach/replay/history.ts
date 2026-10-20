// A real history (rows read from a copy of the database) turned into a replay
// script: each day's check-in, and each completed session with its logged
// sets or run, at the time he started it. Pure, so it is tested on made-up
// rows; scripts/replay.mts reads the real rows from a scratch copy.

import type { CheckInLog, LiftPattern, LoggedLift, ReplayAction, ReplayDay, ReplayScript } from './types'

export interface HistorySession {
  id: string
  type: string
  status: string
  scheduledDate: number | null
  timeSlot: string | null
  startedAt: number | null
  durationSec: number | null
  rpe: number | null
  notes: string | null
  skipReason: string | null
  skipReasonDetail: string | null
}

export interface HistorySet {
  sessionId: string
  exerciseId: string
  section: string | null
  orderIndex: number
  setNumber: number
  weightKg: number | null
  reps: number | null
  rir: number | null
  isWarmup: number
}

export interface HistoryRun {
  sessionId: string
  durationSec: number | null
  distanceKm: number | null
  avgHr: number | null
  maxHr: number | null
  isIndoor: number | null
}

export interface HistoryLog {
  logDate: number
  createdAt: number
  sleepHours: number | null
  sleepQuality: number | null
  energy: number | null
  soreness: number | null
  stress: number | null
  mood: number | null
  backToday: number | null
  alcoholScale: number | null
  herbScale: number | null
  notes: string | null
}

export interface HistoryNote {
  date: number
  type: string
  content: string
}

export interface History {
  sessions: HistorySession[]
  sets: HistorySet[]
  runs: HistoryRun[]
  logs: HistoryLog[]
  notes: HistoryNote[]
}

const RUN_TYPES = new Set(['running', 'foundation_run'])

/** Movement pattern of an exercise id, for mapping a logged lift onto today's prescription. */
export function liftPattern(exerciseId: string): LiftPattern {
  const id = exerciseId.toLowerCase()
  if (/squat|lunge|step-up|leg-press/.test(id)) return 'squat'
  if (/rdl|deadlift|block-pull|hip-thrust|good-morning|swing|hinge/.test(id)) return 'hinge'
  if (/row|pulldown|pull-?up|chin/.test(id)) return 'pull'
  if (/press|ohp|push-?up|dip/.test(id)) return 'press'
  return 'other'
}

/** Minutes after local midnight for a unix time, or the slot's usual time. */
export function localMinute(unixSec: number | null, tzOffsetMin: number, slot: string | null): number {
  if (unixSec == null) return slot === 'pm' ? 18 * 60 : 7 * 60
  const local = Math.floor(unixSec / 60) + tzOffsetMin
  return ((local % 1440) + 1440) % 1440
}

/** Local epoch day of a unix time. */
export function localDay(unixSec: number, tzOffsetMin: number): number {
  return Math.floor((Math.floor(unixSec / 60) + tzOffsetMin) / 1440)
}

function liftsFor(sessionId: string, sets: HistorySet[]): LoggedLift[] {
  const mine = sets.filter(s => s.sessionId === sessionId && s.isWarmup !== 1 && (s.section === 'main' || s.section == null))
  const byExercise = new Map<string, HistorySet[]>()
  for (const s of mine.sort((a, b) => a.orderIndex - b.orderIndex || a.setNumber - b.setNumber)) {
    const list = byExercise.get(s.exerciseId) ?? []
    list.push(s)
    byExercise.set(s.exerciseId, list)
  }
  return [...byExercise.entries()].map(([exerciseId, list]) => ({
    pattern: liftPattern(exerciseId),
    exerciseId,
    sets: list.map(s => ({ weightKg: s.weightKg, reps: s.reps, rir: s.rir })),
  }))
}

/**
 * The script for [fromDay, toDay]: check-ins (with that day's wellness notes),
 * completed sessions with what he logged, and skips. Missed sessions are not
 * actions: the nightly rollover finds them, as it did then. A session's day is
 * its scheduled day; its time is when he started it (else the slot's usual time).
 */
export function scriptFromHistory(h: History, opts: { name: string; fromDay: number; toDay: number; tzOffsetMin: number; blockStartDay?: number }): ReplayScript {
  const byDay = new Map<number, ReplayAction[]>()
  const push = (day: number, a: ReplayAction) => {
    if (day < opts.fromDay || day > opts.toDay) return
    const list = byDay.get(day) ?? []
    list.push(a)
    byDay.set(day, list)
  }

  for (const log of h.logs) {
    const notes = [log.notes, ...h.notes.filter(n => n.date === log.logDate && n.type === 'wellness').map(n => n.content)].filter(Boolean).join(' ')
    const entry: CheckInLog = {
      sleepHours: log.sleepHours, sleepQuality: log.sleepQuality, energy: log.energy, soreness: log.soreness,
      stress: log.stress, mood: log.mood, backToday: log.backToday, alcoholScale: log.alcoholScale, herbScale: log.herbScale,
      notes: notes || null,
    }
    push(log.logDate, { kind: 'checkin', at: localMinute(log.createdAt, opts.tzOffsetMin, 'am'), log: entry })
  }

  for (const s of h.sessions) {
    if (s.scheduledDate == null) continue
    const slot = s.timeSlot === 'pm' ? 'pm' : 'am'
    const at = localMinute(s.startedAt, opts.tzOffsetMin, slot)
    if (s.status === 'skipped') {
      push(s.scheduledDate, { kind: 'skip', at, type: s.type, reason: s.skipReason ?? 'other', detail: s.skipReasonDetail })
      continue
    }
    if (s.status !== 'completed') continue
    const durationMin = Math.max(1, Math.round((s.durationSec ?? 0) / 60))
    if (s.type === 'strength') {
      push(s.scheduledDate, { kind: 'session', at, type: 'strength', slot, durationMin, rpe: s.rpe, lifts: liftsFor(s.id, h.sets) })
    } else if (RUN_TYPES.has(s.type)) {
      const run = h.runs.find(r => r.sessionId === s.id)
      // A treadmill entry typed in seconds-as-minutes (108000 s for 30 min) reads as the session's own time.
      const runSec = run?.durationSec != null && run.durationSec <= 4 * 3600 ? run.durationSec : s.durationSec ?? 0
      push(s.scheduledDate, {
        kind: 'session', at, type: 'foundation_run', slot, durationMin: Math.max(1, Math.round(runSec / 60)), rpe: s.rpe,
        run: { durationSec: runSec, distanceKm: run?.distanceKm ?? null, avgHr: run?.avgHr ?? null, maxHr: run?.maxHr ?? null, isIndoor: run?.isIndoor === 1 },
      })
    } else {
      push(s.scheduledDate, { kind: 'session', at, type: s.type, slot, durationMin, rpe: s.rpe })
    }
  }

  const days: ReplayDay[] = [...byDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([day, actions]) => ({ day, actions: actions.sort((a, b) => a.at - b.at) }))
  return {
    name: opts.name,
    fromDay: opts.fromDay,
    toDay: opts.toDay,
    tzOffsetMin: opts.tzOffsetMin,
    ...(opts.blockStartDay != null ? { startBlock: { type: 'block_zero' as const, day: opts.blockStartDay } } : {}),
    days,
  }
}
