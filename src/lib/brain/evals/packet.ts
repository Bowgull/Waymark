// Dev-side eval set (approved 2026-10-21, idea 9): turns one made-up night
// into the exact packet the nightly AI call gets, with the real pure code:
// the athlete model, readiness (with partial check-ins and short states), the
// doses at every level, the push room above the rules' default, the facts,
// the notes and the notebook. No database, no network, no personal data.
// Never imported by the app or the Worker.

import { landmineHistory, landmineSessions } from '../../landmine'
import { buildAthleteModel } from '../athleteModel'
import { athleteSignals } from '../signals'
import { bagDose, runDose, strengthDose, LEVELS, levelAbove, type DoseCtx, type Level } from '../doses'
import { nightRead, type NightRead } from '../readiness'
import { tempStates } from '../tempStates'
import { pushRoom, rangeFor, tweakedWords, type DoseLike } from '../candidates'
import { DAY_KEYS, doseWords, packetFacts, type Candidate, type DecisionPacket, type NoteFact, type WeekSession } from '../decision'
import { evidenceLines, notebookLines, type EvidenceItem, type Lesson } from '../notebook'
import { getStrengthTemplate } from '../../strengthTemplates'
import type { LoadEquipment } from '../../strengthLoads'
import type { ModelCheckIn, ModelEvents, ModelRun, ModelSession, ModelSet } from '../types'

const LB = 0.45359237
/** Monday 2027-03-01: every eval night sits in week 4 of a made-up Block Zero that began 21 days earlier. */
export const EVAL_MONDAY = 20878
export const BLOCK_START = EVAL_MONDAY - 21

export type TodaySession = 'Strength A' | 'Strength B' | 'Strength C' | 'Run-Walk' | 'Bag Work'

export interface NightSpec {
  id: string
  title: string
  /** Day of the week tonight plans (0 = Sunday); default Monday. */
  dow?: number
  /** RIR he logged on every set of the last 3 weeks (null: none logged). */
  rir?: number | null
  /** RIR on the latest strength session only (default: rir). */
  lastRir?: number | null
  /** Runs: 'under' (HR under the line, felt easy), 'over' (HR over the line), 'none'. */
  runs?: 'under' | 'over' | 'none'
  /** Overrides on the check-ins: per day back from tonight (1 = yesterday). null = no check-in that day. */
  checkIns?: Record<number, Partial<ModelCheckIn> | null>
  /** His notes: days back (0 = today, 1 = yesterday) and text. */
  notes?: Array<{ ago: number; text: string; source?: NoteFact['source'] }>
  /** Sessions skipped (days back, type, reason). */
  skips?: Array<{ ago: number; type: string; reason: string }>
  /** No training at all in the days back from..to (a missed stretch). */
  gap?: { from: number; to: number }
  /** Tonight's sessions to dose. */
  today: TodaySession[]
  /** The rest of the week (days ahead of tonight). */
  week?: Array<{ ahead: number; type: string; label?: string; slot?: 'am' | 'pm'; locked?: boolean }>
  /** Back today (from the morning check-in or a back note), for the back-friendly swap. */
  backToday?: number | null
  /** An open raven plan by region. */
  openPlans?: Array<{ region: string }>
  /** Lessons already in the notebook. */
  lessons?: Array<Pick<Lesson, 'kind' | 'claim' | 'source' | 'status'>>
}

export interface EvalNight {
  spec: NightSpec
  packet: DecisionPacket
  today: number
  night: NightRead
  /** Evidence the notebook may cite (for checking proposals). */
  index: Map<string, EvidenceItem>
  refs: Map<string, string>
}

const ci = (day: number, v: Partial<ModelCheckIn> = {}): ModelCheckIn => ({ day, sleepHours: 7.5, sleepQuality: 3, energy: 3, soreness: 2, stress: 2, mood: 3, backToday: 3, ...v })
const dow = (day: number) => ((day % 7) + 11) % 7
const iso = (day: number) => new Date(day * 86400000).toISOString().slice(0, 10)

export function equipmentOf(id: string): LoadEquipment {
  if (/^ex-lm-|landmine/.test(id)) return 'landmine'
  if (/db-|goblet|dumbbell|lunge|split-squat/.test(id)) return 'dumbbell'
  if (/glute-bridge|pullup|push-up|plank|dead-bug|bird-dog|hang/.test(id)) return 'none'
  if (/machine|cable|pulldown|leg-press/.test(id)) return 'machine'
  return 'barbell'
}

function mainLifts(label: string, day: number) {
  const t = getStrengthTemplate(dow(day), 4, 'block_zero', label)
  return t.exercises.filter(e => e.section === 'main').map(e => ({ exerciseId: e.exerciseId, label: e.label, reps: e.sets.find(x => !x.isWarmup)?.targetReps ?? 8, notes: e.notes ?? null }))
}

const LABEL_BY_DOW: Record<number, string> = { 1: 'Strength A', 3: 'Strength B', 5: 'Strength C' }

/** Three weeks of a steady Block Zero, shaped by the spec. */
export function historyFor(spec: NightSpec, today: number): ModelEvents {
  const sessions: ModelSession[] = []
  const sets: ModelSet[] = []
  const runs: ModelRun[] = []
  const checkIns: ModelCheckIn[] = []
  const notes: ModelEvents['notes'] = []
  let n = 0
  const inGap = (d: number) => spec.gap != null && today - d <= spec.gap.from && today - d >= spec.gap.to
  // lastRir lands on the last session of the lifts dosed tonight (the same Strength letter).
  const label0 = spec.today.find(t => t.startsWith('Strength'))
  const lastStrength = (() => { for (let d = today - 1; d >= BLOCK_START; d--) if (LABEL_BY_DOW[dow(d)] && (!label0 || LABEL_BY_DOW[dow(d)] === label0) && !inGap(d)) return d; return -1 })()
  for (let d = BLOCK_START; d < today; d++) {
    const ago = today - d
    const over = spec.checkIns?.[ago]
    if (over !== null && !inGap(d)) checkIns.push(ci(d, over ?? {}))
    if (inGap(d)) continue
    const skip = spec.skips?.find(s => s.ago === ago)
    const label = LABEL_BY_DOW[dow(d)]
    if (label) {
      const id = `ev-s${++n}`
      if (skip && skip.type === 'strength') { sessions.push({ id, type: 'strength', status: 'skipped', day: d, slot: 'am', startMin: null, durationSec: null, rpe: null, skipReason: skip.reason, source: 'template', blockType: 'block_zero', notes: null }); continue }
      const rir = d === lastStrength && spec.lastRir !== undefined ? spec.lastRir : (spec.rir === undefined ? 2 : spec.rir)
      sessions.push({ id, type: 'strength', status: 'completed', day: d, slot: 'am', startMin: 400, durationSec: 3000, rpe: rir == null ? 6 : rir >= 3 ? 5 : rir <= 1 ? 8 : 6, skipReason: null, source: 'template', blockType: 'block_zero', notes: null })
      for (const l of mainLifts(label, d)) {
        const eq = equipmentOf(l.exerciseId)
        const w = eq === 'dumbbell' ? 35 : eq === 'barbell' ? 85 : eq === 'machine' ? 60 : eq === 'landmine' ? 10 : 0
        for (let i = 0; i < 3; i++) sets.push({ sessionId: id, day: d, exerciseId: l.exerciseId, section: 'main', setNumber: i + 1, weightKg: w ? w * LB : null, reps: l.reps || 8, plannedWeightKg: w ? w * LB : null, plannedReps: l.reps || 8, rir, isWarmup: false, logged: true, equipment: eq })
      }
    } else if ([2, 4, 6].includes(dow(d)) && spec.runs !== 'none') {
      const id = `ev-s${++n}`
      if (skip) { sessions.push({ id, type: 'foundation_run', status: 'skipped', day: d, slot: 'am', startMin: null, durationSec: null, rpe: null, skipReason: skip.reason, source: 'template', blockType: 'block_zero', notes: null }); continue }
      const overLine = spec.runs === 'over'
      sessions.push({ id, type: 'foundation_run', status: 'completed', day: d, slot: 'am', startMin: 400, durationSec: 1560, rpe: overLine ? 7 : 4, skipReason: null, source: 'template', blockType: 'block_zero', notes: null })
      runs.push({ sessionId: id, day: d, type: 'foundation_run', durationSec: 1560, plannedDurationSec: 1560, distanceKm: 3.4, avgHr: overLine ? 158 : 138, maxHr: overLine ? 166 : 144, splits: [], isIndoor: false, completionStatus: null, shortReason: null, rpe: overLine ? 7 : 4, pieceSec: 120, rungSec: 120 })
    }
  }
  for (const x of spec.notes ?? []) notes.push({ day: today - x.ago, text: x.text, source: x.source === 'back' ? 'back' : x.source === 'journal' ? 'journal' : x.source === 'session' ? 'session' : 'check_in' })
  return {
    profile: { dob: '1990-06-01', maxHr: null, backSensitive: true }, sessions, sets, runs, talkTests: [{ day: BLOCK_START + 1, bpm: 150 }, { day: BLOCK_START + 8, bpm: 152 }],
    bag: [], checkIns, notes, moves: [], classLogs: [], trainingMaxes: [], openBodyAlerts: (spec.openPlans ?? []).map(p => ({ region: p.region, stage: 'plan' })),
  }
}

/** The night as the AI would get it. */
export function buildNight(spec: NightSpec): EvalNight {
  const monday = EVAL_MONDAY
  const today = monday + (((spec.dow ?? 1) + 6) % 7)
  const events = historyFor(spec, today)
  const model = buildAthleteModel(events, today, { fromDay: BLOCK_START })
  const notesByDay = new Map(events.notes.filter(x => x.source === 'check_in').map(x => [x.day, x.text]))
  const sickDays = new Set((spec.skips ?? []).filter(s => s.reason === 'sick').map(s => today - s.ago))
  const temp = tempStates([...events.notes, ...[...sickDays].map(d => ({ day: d, text: 'Skipped: sick' }))], today)
  const night = nightRead({ checkIns: events.checkIns, today, sickDays, notesByDay, temp }, today)
  const equipment: Record<string, LoadEquipment> = {}
  const ctxBase: DoseCtx = { day: today, state: night.state, stateWhy: night.why, model, backToday: spec.backToday ?? null, openPlans: spec.openPlans ?? [] }

  const candidates: Candidate[] = []
  const rulesWhy: string[] = []
  spec.today.forEach((t, i) => {
    const n = i + 1
    const sessionId = `T${n}`
    const type = t.startsWith('Strength') ? 'strength' : t === 'Run-Walk' ? 'foundation_run' : 'bag_work'
    const dose = (over: Partial<DoseCtx>): DoseLike => {
      const ctx = { ...ctxBase, ...over }
      if (type === 'strength') {
        const main = mainLifts(t, today)
        for (const l of main) equipment[l.exerciseId] = equipmentOf(l.exerciseId)
        for (const id of ['ex-trap-bar-deadlift', 'ex-front-squat', 'ex-block-pull', 'ex-bent-over-row', 'ex-glute-bridges', 'ex-goblet-squat', 'ex-db-rdl', 'ex-db-row']) equipment[id] = equipmentOf(id)
        const done = new Set(events.sessions.filter(x => x.status === 'completed').map(x => x.id))
        const s = strengthDose(ctx, { kind: 'block_zero', main, fighter: null, tmKg: {}, equipment, steppedThisWeek: [], lastFeltHard: null,
          landmineLast: landmineHistory(events.sets, done, today), landmineSessions: landmineSessions(events.sets, done, today) })
        return { level: s.level, strength: s }
      }
      if (type === 'foundation_run') {
        const longest = Math.max(0, ...events.runs.filter(r => r.day > today - 30).map(r => r.durationSec ?? 0))
        const r = runDose(ctx, { kind: 'run_walk', longestLast30Sec: longest || null, weekly: { lastWeekRunSec: events.runs.filter(x => x.day >= today - 7).reduce((a, x) => a + (x.durationSec ?? 0), 0), thisWeekSoFarSec: 0, sessionsLeftThisWeek: 2 }, hrCeilingBpm: model.run.lineBpm, lastRunSec: null, riseThisWeek: false })
        return { level: r.level, run: r }
      }
      const b = bagDose(ctx, { maxRounds: 6 })
      return { level: b.level, bag: b }
    }
    const rules = dose({})
    const list: Candidate[] = []
    const seen = new Set<string>()
    const push = (d: DoseLike, isRules: boolean, level: Level, above?: string[]) => {
      const words = doseWords({ ...d, level })
      const body = words.slice(words.indexOf(':') + 1)
      const id = `c${n}.${level.toLowerCase()}`
      if (seen.has(body) || list.some(c => c.id === id)) return
      seen.add(body)
      const range = rangeFor(d, equipment)
      list.push({ id, sessionId, sessionType: type, level, rules: isRules, dose: words, range, tweaked: tweakedWords(d, range, equipment), ...(above ? { above: true, evidenceIds: above } : {}) })
    }
    push(rules, true, rules.level)
    for (const level of [...LEVELS].reverse()) {
      if (level === 'REST' || !levelAbove(rules.level, level)) continue
      const d = dose({ levelCap: level })
      if (levelAbove(rules.level, d.level)) push(d, false, d.level)
    }
    const room = pushRoom({ sessionType: type, rulesDose: rules, state: night.state, confidence: night.confidence, model, checkIns: events.checkIns, today, backFlag: (spec.backToday ?? 5) <= 2 || model.back.openPlans > 0, injuryFlag: (spec.openPlans ?? []).length > 0 })
    for (const level of room.levels) {
      const d = dose({ levelCap: level, levelFloor: level })
      const higher = d.strength && rules.strength ? d.strength.lifts.some((l, k) => levelAbove(l.level, rules.strength!.lifts[k]?.level ?? 'HOLD')) : levelAbove(d.level, rules.level)
      if (higher) push(d, false, level, room.evidenceIds)
    }
    list.sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level))
    candidates.push(...list)
    const why = rules.strength?.why ?? rules.run?.why ?? rules.bag?.why ?? []
    for (const w of why) if (!rulesWhy.includes(w)) rulesWhy.push(w)
  })

  const facts = packetFacts(athleteSignals(model, events, today).filter(f => !f.id.startsWith('f.note.')))
  facts.unshift({ id: 'f.state', value: night.state })
  const notes: NoteFact[] = events.notes.filter(x => x.day > today - 14).sort((a, b) => a.day - b.day).map((x, i) => {
    const s = temp.find(t => t.mentions.includes(x.day) && t.untilDay < today)
    const src = x.source === 'check_in' ? 'ci' : x.source
    return { id: `f.note.${i}`, day: iso(x.day), source: x.source, text: x.text, ev: `n:${src}:${iso(x.day)}`, ...(s ? { ended: `${s.kind} ended ${iso(s.untilDay)}` } : {}) }
  })
  for (const s of spec.skips ?? []) notes.push({ id: `f.note.${notes.length}`, day: iso(today - s.ago), source: 'skip', text: `${s.type === 'strength' ? 'Strength' : 'Run-Walk'} skipped: ${s.reason.replace(/_/g, ' ')}`, ev: `n:skip:${iso(today - s.ago)}` })

  const weekSessions: WeekSession[] = [
    ...spec.today.map((t, i) => ({ type: t.startsWith('Strength') ? 'strength' : t === 'Run-Walk' ? 'foundation_run' : 'bag_work', label: t as string, ahead: 0, slot: 'am' as const, locked: false, id: `T${i + 1}` })),
    ...(spec.week ?? []).map((w, i) => ({ type: w.type, label: w.label ?? (w.type === 'mt_class' ? 'MT Class' : w.type), ahead: w.ahead, slot: w.slot ?? (w.type === 'mt_class' ? 'pm' as const : 'am' as const), locked: w.locked ?? false, id: `W${i + 1}` })),
  ].sort((a, b) => a.ahead - b.ahead).map((w, i) => ({
    ref: `s${i + 1}`, sessionId: w.id, type: w.type, name: w.label, day: DAY_KEYS[dow(today + w.ahead)], epochDay: today + w.ahead, slot: w.slot, status: 'planned',
    movable: !w.locked && w.type !== 'mt_class', restable: !w.locked,
  }))

  // Evidence: the sessions and check-ins of the last 21 days, and his notes.
  const index = new Map<string, EvidenceItem>()
  for (const s of events.sessions) index.set(`s:${s.id}`, { id: `s:${s.id}`, day: s.day, kind: 'session', said: false, text: `${s.type === 'strength' ? 'Strength' : 'Run-Walk'} ${s.status}${s.rpe != null ? `, RPE ${s.rpe}` : ''}` })
  for (const c of events.checkIns) index.set(`ci:${iso(c.day)}`, { id: `ci:${iso(c.day)}`, day: c.day, kind: 'checkin', said: false, text: `check-in: sleep ${c.sleepHours} h, energy ${c.energy}, soreness ${c.soreness}, back ${c.backToday}` })
  for (const x of notes) if (x.ev) index.set(x.ev, { id: x.ev, day: Math.round(Date.parse(`${x.day}T00:00:00Z`) / 86400000), kind: 'note', said: true, text: x.text })
  const lessons: Lesson[] = (spec.lessons ?? []).map((l, i) => ({ id: `lesson-${i}`, ...l, firstSeenDay: BLOCK_START + 2, lastConfirmedDay: today - 3, support: 4, counter: 0, createdDay: BLOCK_START + 5, retiredDay: null, retiredReason: null }))
  const book = notebookLines(lessons)

  const packet: DecisionPacket = {
    v: 1,
    today: { iso: iso(today), day: DAY_KEYS[dow(today)] },
    state: { state: night.state, why: night.why, confidence: night.confidence },
    notebook: book.lines,
    temp: temp.filter(t => t.untilDay >= today - 7).map(t => ({ kind: t.kind, from: iso(t.fromDay), until: iso(t.untilDay), active: t.fromDay <= today && today <= t.untilDay })),
    facts, notes, candidates,
    week: { sessions: weekSessions, days: Array.from({ length: monday + 6 - today + 1 }, (_, i) => DAY_KEYS[dow(today + i)]), solver: [], budget: 2 },
    rulesWhy,
    recentChanges: [],
    evidence: evidenceLines(index, today),
  }
  return { spec, packet, today, night, index, refs: book.refs }
}
