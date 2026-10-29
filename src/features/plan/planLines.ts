// What an opened session shows (page 73 §1b, approved 2026-10-22): its real
// lines, small, under the row, in the session summary's language. Strength:
// each lift with sets × reps · weight and ↑ / ↓ where it moved, then core and
// minutes. Run: minutes · HR cap, the shape, the weather at his hour. Bag:
// rounds × minutes · rest, the first combo. Foundation: its blocks and level.
// Class: its time and "easier morning after". Done: plan against what he did,
// ✓ and effort. A skip says so first; his reason closes a swap. Pure; the
// data is SessionSummary's (the per-type endpoints) and the row's own dose.

import { FOUNDATION_ROWS, foundationLevel, foundationMinutes, foundationTemplate } from '../../lib/foundation'
import { ARM_BLOCK_IDS } from '../../lib/landmine'
import { RESET_WALK_MIN, resetMinutes } from '../../lib/activeRecoveryTemplate'
import type { SummaryData } from '../dayboard/summaryData'
import type { RunPlace } from '../weather/runPlace'
import { fiveKText, hardKindOf, speedsFrom, toGoalText, GOAL_5K_SEC, type HardPlan } from '../../lib/brain/hardRuns'
import { BASE_INCLINE, paceText, speedText, type TreadmillUnit } from '../../lib/runSpeed'
import { postRunLine } from '../../lib/postRun'
import { blockResults, doneBlockLines, movesLine, planFromContext, templateById, workoutLine } from '../../lib/coach/bagConditioning'
import { actualMinutes, continuousRunMin, liftLoad, plannedRowMinutes, rowStatus, runWalkShapeFor, shortLift, strengthDiffLines, type DayBoardSession, type WorkoutExercise } from '../dayboard/rowState'

export interface PlanLine {
  label: string
  value: string
  mark?: 'up' | 'down'
  /** A teal ✓ closes the value. */
  tick?: boolean
  /** One plain line behind a tap on this line (page 93: why this press). */
  explain?: string
  /** Page 94: a logbook line. The label is the move in plain words; its note sits under it, sets and weight on the right. */
  move?: { sets?: string | null; load?: string | null; note?: string | null; warm?: boolean }
  /** Page 94: a group's head in the logbook (Main, Core, Arms). */
  head?: boolean
}

export interface LinesOpts {
  /** The block week (Foundation's level, a run-walk's shape). */
  weekNumber?: number | null
  /** "6 PM: 2° and rain": the weather at a run's hour (today only). */
  weather?: string | null
  /** A class's start ("7 PM"). */
  classTime?: string | null
  /** Page 76: inside or outside at the run's hour, and why ("inside: 3° and sleet at 6"). */
  where?: RunPlace | null
  /** Page 76: the treadmill speed unit picked in Settings (null: both show). */
  unit?: TreadmillUnit
}

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`

/** The words for his reason on a row (the page 73 tiles, then the older codes). */
const REASON_WORD: Readonly<Record<string, string>> = {
  schedule: 'time', too_sore: 'body', sick: 'sick', injury: 'pain', variety: 'just because',
  tired: 'tired', rough_day: 'rough day', low_sleep: 'low on sleep', low_drive: 'low motivation', illness: 'body signal', class_time: "class time doesn't fit", other: 'other', coach_rest: 'rest day',
}

export function reasonWord(code: string | null | undefined): string | null {
  if (!code) return null
  return REASON_WORD[code] ?? code.replace(/_/g, ' ')
}

function parse(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {}
  try { const v = JSON.parse(raw); return v && typeof v === 'object' ? v as Record<string, unknown> : {} } catch { return {} }
}

/** His reason on a session he swapped in (context_json.replaced.userSkipReason). */
export function swapReason(s: Pick<DayBoardSession, 'contextJson'>): string | null {
  const r = parse(s.contextJson).replaced as { userSkipReason?: unknown } | undefined
  return typeof r?.userSkipReason === 'string' ? r.userSkipReason : null
}

/** The row's own dose (sessions.dose_json), when it carries one. */
function doseOf(s: Pick<DayBoardSession, 'doseJson'>): { bag?: { rounds: number }; run?: { runSec: number; walkSec: number; rounds: number; totalSec: number; hrCeilingBpm: number; walkOnly: boolean; talkTestDue?: boolean } } | null {
  const d = parse(s.doseJson)
  return Object.keys(d).length ? d as never : null
}

function liftName(ex: WorkoutExercise): string {
  return shortLift(ex.label || ex.name || ex.exercise?.name || 'Lift').toUpperCase()
}

// ─── Page 94: the logbook (approved 2026-10-29) ─────────────────
// Every opened session lists every move: the move in plain words on the left,
// big and bright, its note under it ("each side"); sets and weight on the
// right, lined up. A thin rule and a small head between groups. Nothing cut.

const move = (name: string, sets: string | null, load: string | null = null, note: string | null = null, warm = false): PlanLine =>
  ({ label: name, value: '', move: { sets, load, note, ...(warm ? { warm: true } : {}) } })
const head = (t: string): PlanLine => ({ label: t, value: '', head: true })

/** His strength warm-up (2026-10-29): the session's rope timer, or an easy jog instead. */
export const WARM_JOG = move('Easy jog', null, '1.5 km', 'or 3 min of rope', true)

/** Names that read better than the library's on the logbook. */
const MOVE_NAME: Readonly<Record<string, string>> = {
  'ex-chin-up-negative': 'Chin-up negatives',
  'ex-chin-up': 'Chin-ups',
  'ex-db-row': 'Dumbbell row',
  'ex-lm-rdl': 'Landmine RDL',
  'ex-db-rdl': 'Dumbbell RDL',
  'ex-suitcase-carry': 'Suitcase carry',
}

/** A short how-to under a move whose name doesn't say it. */
const MOVE_NOTE: Readonly<Record<string, string>> = {
  'ex-chin-up-negative': 'jump up, lower for 3 to 5 s',
}

/** Sentence case that keeps the short caps (RDL, DB) and inner capitals (McGill): "Goblet Squat" reads "Goblet squat". */
export function plainName(name: string): string {
  const out = name.trim().split(' ').map(w => w.split('-').map(p => (/^[A-Z][a-z']+$/.test(p.replace(/[()]/g, '')) ? p.toLowerCase() : p)).join('-')).join(' ')
  return out.charAt(0).toUpperCase() + out.slice(1)
}

/** "each side", "each leg", "each arm", "each hand" from the template's line; a per-side move without one reads "each side". */
export function eachNote(notes: string | null | undefined, setsReps: string): string | null {
  const m = /\beach (side|leg|arm|hand)\b/i.exec(notes ?? '')
  if (m) return `each ${m[1].toLowerCase()}`
  return / each$/.test(setsReps) ? 'each side' : null
}

/** A move timed in seconds: a sentence of its line opens with the time ("30s each side", "Seconds each side"), not a tempo cue ("2-3s down"). */
export function isTimed(notes: string | null | undefined): boolean {
  return /(^|[.:]\s+)(\d+s|seconds)\b/i.test(notes ?? '')
}

/** The logbook's sets: "3×8", a timed move "2×30s". */
export function setsText(setsReps: string, timed: boolean): string {
  const sr = setsReps.replace(/ each$/, '')
  return timed && /×\d+$/.test(sr) ? `${sr}s` : sr
}

const LEG_IDS = new Set(['ex-nordic-curl', 'ex-bent-knee-calf-raise', 'ex-single-leg-calf-raise', 'ex-tibialis-raise'])

function groupOf(ex: WorkoutExercise, core: WorkoutExercise[]): string | null {
  if (ex.section === 'warmup') return null
  if (ex.section === 'main') return 'Main'
  if (ex.section === 'core') return core.every(c => LEG_IDS.has(c.exerciseId)) ? 'Legs' : 'Core'
  return ARM_BLOCK_IDS.has(ex.exerciseId) || ex.exerciseId === 'ex-db-row' ? 'Arms' : 'More'
}

export function strengthLog(data: Extract<SummaryData, { kind: 'strength' }>): PlanLine[] {
  const out: PlanLine[] = [WARM_JOG]
  const core = data.exercises.filter(ex => ex.section === 'core')
  let group: string | null = null
  for (const ex of data.exercises) {
    const g = groupOf(ex, core)
    if (g && g !== group) { out.push(head(g)); group = g }
    const sr = ex.prescription?.setsReps ?? ''
    const load = liftLoad(ex)
    const lb = /\d$/.test(load) ? `${load} lb` : load === 'bar only' ? 'bar' : null
    const find = load === 'find your weight' ? 'find your weight' : null
    const note = [MOVE_NOTE[ex.exerciseId] ?? eachNote(ex.notes, sr), find].filter(Boolean).join(', ') || null
    const brain = data.brainLifts?.find(l => l.exerciseId === ex.exerciseId)
    const line = move(MOVE_NAME[ex.exerciseId] ?? plainName(ex.label || ex.name || ex.exercise?.name || 'Lift'), sr ? setsText(sr, isTimed(ex.notes)) : null, lb, note)
    out.push(brain?.change === 'increase' ? { ...line, mark: 'up' } : brain?.change === 'decrease' ? { ...line, mark: 'down' } : line)
  }
  return out
}

/** Foundation's moves as the logbook (page 94): back first, then neck and shoulders. */
export function foundationLog(moves: Array<{ name: string; sets?: number | null; holdSec?: number | null; reps?: number | null; perSide?: boolean; section?: string | null }>): PlanLine[] {
  const out: PlanLine[] = []
  let group: string | null = null
  for (const m of moves) {
    const g = m.section === 'upper' ? 'Neck and shoulders' : 'Back'
    if (g !== group) { out.push(head(g)); group = g }
    const sets = m.sets != null && m.sets > 1 ? `${m.sets}×` : ''
    const amount = m.reps != null ? `${m.reps}` : m.holdSec != null ? `${m.holdSec}s` : ''
    const hold = m.reps != null && m.holdSec != null ? `hold ${m.holdSec} s` : null
    const note = [m.perSide ? 'each side' : null, hold].filter(Boolean).join(', ') || null
    out.push(move(plainName(m.name), `${sets}${amount}` || null, null, note))
  }
  return out
}

/** Which Foundation block a move sits in, from the routine (an older row without its section). */
function foundationSection(name: string): string | null {
  const row = FOUNDATION_ROWS.find(r => r.label.toLowerCase() === name.toLowerCase())
  return row ? row.section : null
}

function strengthDone(data: Extract<SummaryData, { kind: 'strength' }>): PlanLine[] {
  const main = data.exercises.filter(ex => ex.section !== 'warmup' && ex.section !== 'core')
  return strengthDiffLines(main).map((l, i) => {
    const text = l.parts.map(p => p.text).join('')
    const value = /\d$/.test(text) ? `${text} lb` : text
    return { label: liftName(main[i]), value, tick: true, ...(l.band === 'up' ? { mark: 'up' as const } : l.band === 'down' ? { mark: 'down' as const } : {}) }
  })
}

function runPlan(s: DayBoardSession, data: SummaryData | null, opts: LinesOpts): PlanLine[] {
  const plan = data?.kind === 'run' ? data.plan : null
  const dose = doseOf(s)?.run ?? null
  const cap = plan?.z2CeilingBpm ?? dose?.hrCeilingBpm ?? null
  const out: PlanLine[] = []
  const rw = plan?.runWalk ?? (dose && dose.rounds > 1 ? { runSec: dose.runSec, walkSec: dose.walkSec, rounds: dose.rounds, warmupSec: 0 } : null)
  // Page 94: the logbook. What to do with its minutes, the heart's top, the treadmill, the talk test.
  const walkRun = (rounds: number, runSec: number, walkSec: number, total: number) =>
    out.push(move('Run-walk', null, `${total} min`, `${rounds} × run ${mmss(runSec)}, walk ${mmss(walkSec)}`))
  if (dose?.walkOnly) out.push(move('Easy walk or bike', null, `${Math.round(dose.totalSec / 60)} min`))
  else if (rw && rw.walkSec > 0) {
    const total = plan?.targetDurSec ? Math.round(plan.targetDurSec / 60) : dose ? Math.round(dose.totalSec / 60) : Math.round((rw.rounds * (rw.runSec + rw.walkSec) + rw.warmupSec) / 60)
    walkRun(rw.rounds, rw.runSec, rw.walkSec, total)
  } else {
    const min = plan?.targetDurSec ? Math.round(plan.targetDurSec / 60) : continuousRunMin(s) ?? (dose ? Math.round(dose.runSec / 60) : null)
    if (min == null && s.type === 'foundation_run' && s.blockType === 'block_zero') {
      const w = runWalkShapeFor(s, opts.weekNumber ?? s.blockWeek ?? 1)
      walkRun(w.rounds, w.runSec, w.walkSec, Math.round((w.rounds * (w.runSec + w.walkSec) + w.warmupSec) / 60))
    } else {
      out.push(move('Easy run', null, min != null ? `${min} min` : null, 'no walk breaks, you can talk in full sentences'))
    }
  }
  if (cap && !dose?.walkOnly) out.push(move('Heart rate', null, `max ${cap}`))
  // Page 76: every piece has a speed; an easy run inside shows the one to set.
  const easyKmh = plan?.easyKmh ?? null
  if (easyKmh && !dose?.walkOnly && opts.where?.place !== 'outside') {
    const unit = opts.unit ?? null
    out.push(unit ? move('Treadmill', null, speedText(easyKmh, unit), `incline ${BASE_INCLINE}`) : move('Treadmill', null, null, `${speedText(easyKmh, unit)} · incline ${BASE_INCLINE}`))
  }
  if (dose?.talkTestDue && !dose.walkOnly) out.push(move('Talk test', null, null, 'at the end: say a full sentence, note your heart rate'))
  if (opts.weather) out.push({ label: 'WEATHER', value: opts.weather })
  return out
}

const min = (sec: number) => `${Math.round(sec / 60)} min`

/** A piece's numbers: inside "speed 10.8 km/h · incline 1", outside "pace 5:33 /km". */
function setWords(kmh: number, outside: boolean, unit: TreadmillUnit): string {
  return outside ? `pace ${paceText(kmh, unit)}` : `speed ${speedText(kmh, unit)} · incline ${BASE_INCLINE}`
}

/** Page 76 §2: a hard run's lines. What to do, the numbers to set (or the pace outside), the heart range, and where. */
function hardTodo(h: HardPlan, opts: LinesOpts): PlanLine[] {
  const unit = opts.unit ?? null
  const out = opts.where?.place === 'outside'
  const where = opts.where ? [{ label: 'WHERE', value: opts.where.line }] : []
  const p = h.pieces
  const warm = p[0]?.sec ?? 600
  const cool = p[p.length - 1]?.sec ?? 300
  if (h.kind === 'steady') {
    const st = p.find(x => x.kind === 'steady')
    return [
      { label: 'WHAT', value: `easy ${min(warm)}, tempo ${min(st?.sec ?? 900)}, easy ${min(cool)}` },
      { label: 'HARD', value: setWords(h.speeds.steady, out, unit) },
      { label: 'EASY', value: setWords(h.speeds.easy, out, unit) },
      { label: 'HEART', value: h.heart.low != null ? `stay ${h.heart.low}–${h.heart.top}` : `up to ${h.heart.top}` },
      ...where,
    ]
  }
  if (h.kind === 'test') {
    return [
      { label: 'WHAT', value: `easy ${min(warm)}, then 5 km as fast as you can, easy ${min(cool)}` },
      { label: 'START', value: setWords(h.speeds.test, out, unit) },
      { label: 'THEN', value: 'a little faster each km if you can' },
      ...where,
    ]
  }
  const hard = p.find(x => x.kind === 'hard')
  const jog = p.find(x => x.kind === 'jog')
  return [
    { label: 'WHAT', value: `RUN HARD ${min(hard?.sec ?? 120)}, then EASY JOG ${min(jog?.sec ?? 120)} · ${h.reps} times` },
    { label: 'HARD', value: setWords(h.speeds.hard, out, unit) },
    { label: 'JOG', value: setWords(h.speeds.jog, out, unit) },
    { label: 'HEART', value: `hard: up to ${h.heart.top}${h.heart.jogTop ? ` · jog: under ${h.heart.jogTop}` : ''}` },
    ...where,
  ]
}

/** Page 76 §6: the test's result on its row: the time, how far from 22:00, the new speeds it set. */
function testDone(sec: number, unit: TreadmillUnit): PlanLine[] {
  const sp = speedsFrom(sec)
  return [
    { label: '5K', value: fiveKText(sec), tick: true },
    { label: 'GOAL', value: `${fiveKText(GOAL_5K_SEC)} · ${toGoalText(sec)}` },
    { label: 'NEW', value: `tempo ${speedText(sp.steady, unit)} · intervals ${speedText(sp.hard, unit)}` },
  ]
}

/** The lines an opened row shows. */
export function planLines(s: DayBoardSession, data: SummaryData | null, opts: LinesOpts = {}): PlanLine[] {
  const status = rowStatus(s.status)
  const out: PlanLine[] = []
  if (status === 'skipped') out.push({ label: 'SKIPPED', value: reasonWord(s.skipReason) ?? 'no reason given' })
  const done = status === 'done'
  const min = actualMinutes(s)
  const effort = s.rpe != null ? ` · effort ${s.rpe}` : ''
  const doneLine = (lead: string | null) => out.push({ label: 'DONE', value: [lead, min != null ? `${min} min` : null].filter(Boolean).join(' · ') + effort })
  switch (s.type) {
    case 'strength':
      if (data?.kind === 'strength') out.push(...(done ? strengthDone(data) : strengthLog(data)))
      if (done) doneLine(null)
      break
    case 'running':
    case 'foundation_run': {
      const run = data?.kind === 'run' ? data : null
      const fiveK = run?.run?.fiveKSec ?? s.runSession?.fiveKSec ?? null
      if (done && hardKindOf(s) === 'test' && fiveK) {
        out.push(...testDone(fiveK, opts.unit ?? null))
        doneLine(null)
        break
      }
      // Page 76 §4b: a done run's one line (outside from GPS, inside from the speed).
      const post = done && run?.post ? postRunLine(run.post, opts.unit ?? null) : null
      if (post) { out.push({ label: 'RUN', value: post }); break }
      if (!done && run?.plan?.hard) { out.push(...hardTodo(run.plan.hard, opts)); break }
      if (done) {
        const run = data?.kind === 'run' ? data.run ?? s.runSession ?? null : s.runSession ?? null
        const rm = run?.durationSec ? Math.round(run.durationSec / 60) : min
        // A walk-only day (audit #8) was an easy walk or bike, never a run.
        const walked = doseOf(s)?.run?.walkOnly === true
        out.push({ label: walked ? 'EASY' : 'RUN', value: `${rm != null ? `${rm} min` : 'done'}${run?.avgHr ? ` · avg HR ${run.avgHr}` : ''}`, tick: true })
        const shape = walked ? 'walk or bike' : data?.kind === 'run' && data.plan?.runWalk && data.plan.runWalk.walkSec > 0 ? 'run-walk' : 'one steady run'
        out.push({ label: 'DONE', value: `${shape}${effort}` })
      } else out.push(...runPlan(s, data, opts))
      break
    }
    case 'bag_work': {
      const bag = data?.kind === 'bag' ? data : null
      const rounds = bag && bag.rounds > 0 ? bag.rounds : doseOf(s)?.bag?.rounds ?? null
      const roundMin = bag && bag.plannedSecs.length > 0 ? Math.round(bag.plannedSecs[bag.plannedSecs.length - 1] / 60) : 3
      const rest = bag?.restSec != null ? Math.round(bag.restSec / 60) : 1
      if (rounds && done) out.push({ label: 'ROUNDS', value: `${rounds} × ${roundMin} min · ${rest} min rest`, tick: true })
      else if (rounds) {
        // Page 94: each round with what it asks for, then the rest.
        for (let i = 0; i < rounds; i++) {
          const sec = bag?.plannedSecs[i]
          out.push(move(`Round ${i + 1}`, `${sec ? Math.round(sec / 60) : roundMin} min`, null, bag?.roundCombos?.[i]?.join(', ') || null))
        }
        out.push(move('Rest', `${rest} min`, null, 'between rounds'))
      } else out.push({ label: 'ABOUT', value: `~${bag?.plannedMin ?? plannedRowMinutes(s, opts.weekNumber)} min` })
      if (done) doneLine(null)
      break
    }
    case 'bag_conditioning': {
      // Page 93: WORKOUT, WHAT, MOVES, JUMPS (none) before; done, each block's mark, then minutes and effort.
      const cond = data?.kind === 'conditioning' ? data : null
      const plan = cond?.plan ?? planFromContext(s.contextJson)
      if (done) {
        if (plan && cond?.log) out.push(...doneBlockLines(blockResults(plan, cond.log)))
        doneLine(null)
        break
      }
      if (plan) {
        out.push({ label: 'WORKOUT', value: workoutLine(plan) })
        const what = templateById(plan.templateId)?.what
        if (what) out.push({ label: 'WHAT', value: what })
        const moves = movesLine(plan)
        if (moves) out.push({ label: 'MOVES', value: moves })
      } else out.push({ label: 'ABOUT', value: `~${cond?.plannedMin ?? plannedRowMinutes(s, opts.weekNumber)} min` })
      out.push({ label: 'JUMPS', value: 'none' })
      break
    }
    case 'skip_rope': {
      const rope = data?.kind === 'rope' ? data : null
      out.push({ label: 'ROUNDS', value: `${rope?.rounds ?? 5} × ${rope?.roundSec ? Math.round(rope.roundSec / 60) : 3} min · 1 min rest`, tick: done })
      if (done) doneLine(null)
      break
    }
    case 'mobility': {
      const week = s.blockType === 'block_zero' ? opts.weekNumber ?? s.blockWeek ?? null : null
      const level = foundationLevel(week)
      // The routine's own minutes for its level and day (audit #24), never a flat 12.
      const fmin = data?.kind === 'mobility' && data.plannedMin ? data.plannedMin : foundationMinutes({ week, dayOfWeek: s.scheduledDate != null ? new Date(s.scheduledDate * 86400000).getUTCDay() : null })
      if (done) { out.push({ label: 'BLOCKS', value: 'back, neck and shoulder', tick: true }); doneLine(null); break }
      // Page 94: every move. Its own rows once written; before, the routine it will be (his level and day).
      const rows = data?.kind === 'mobility' && data.moves.some(m => m.sets != null || m.reps != null || m.holdSec != null)
        ? data.moves.map(m => ({ ...m, section: m.section ?? foundationSection(m.name) }))
        : foundationTemplate({ week, dayOfWeek: s.scheduledDate != null ? new Date(s.scheduledDate * 86400000).getUTCDay() : null }).map(t => ({ name: t.label, sets: t.sets, holdSec: t.holdSec, reps: t.reps, perSide: t.perSide === true, section: t.section }))
      if (rows.length > 0) out.push(...foundationLog(rows))
      else out.push({ label: 'LEVEL', value: `${level} · ~${fmin} min` })
      break
    }
    case 'mt_class': {
      const mt = data?.kind === 'mt' ? data : null
      const kind = mt?.classType?.toLowerCase() ?? (s.label && !/^mt class$/i.test(s.label.trim()) ? s.label.toLowerCase().replace(/^mt\s+/, '') : null)
      const when = opts.classTime ?? (s.timeSlot === 'pm' ? 'evening' : 'morning')
      if (done) { out.push({ label: 'CLASS', value: [mt?.durationMin ? `${mt.durationMin} min` : null, kind].filter(Boolean).join(' · ') || 'done', tick: true }); if (s.rpe != null) out.push({ label: 'DONE', value: `effort ${s.rpe}` }) }
      else out.push({ label: 'CLASS', value: [when, kind].filter(Boolean).join(' · ') }, { label: 'AFTER', value: 'easier morning after' })
      break
    }
    case 'active_recovery':
      if (done) doneLine(null)
      // Reset (audit #15): the easy walk or bike first, then hips and the foam roller; one length everywhere.
      else out.push({ label: 'EASY', value: `walk or bike · ${RESET_WALK_MIN} min` }, { label: 'THEN', value: `hips and foam roller · ~${resetMinutes()} min in all` })
      break
    default:
      if (done) doneLine(null)
  }
  const why = status !== 'skipped' ? reasonWord(swapReason(s)) : null
  if (why) out.push({ label: 'WHY', value: why })
  return out
}
