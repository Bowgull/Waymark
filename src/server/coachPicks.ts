// The coach picks for REPLACE and + add (page 73, approved 2026-10-22), from
// the new brain (lib/brain/picks.ts ranks; the readiness, the week, his
// skips and eases come from the same inputs the night reads). Every option
// carries a preview of exactly what it would be that day, from the brain's
// own dose builder (computeDose on the session as it would land): the lifts
// with sets × reps · weight, the run's minutes and HR cap, the bag rounds.

import { and, eq, gte, lte } from 'drizzle-orm'
import type { createDB } from '../db/client'
import { sessions, type sessions as SessionsTable } from '../db/schema'
import { allBoardRows, withBlockLabels } from '../lib/sessionSuggestions'
import { injuryActionFor, kneeSafeOnly, pickDayOption, strengthLetterFor, type PickAction } from '../lib/coach'
import { estimatedMinutes } from '../lib/coach/sessions'
import { KEY_TYPES } from '../lib/keyTypes'
import { mondayOf } from '../lib/dates'
import { foundationLevel, foundationMinutes } from '../lib/foundation'
import { RESET_WALK_MIN, resetMinutes } from '../lib/activeRecoveryTemplate'
import { ropeMinutes, ropeRounds } from '../lib/plannedLength'
import { loadLabel } from '../lib/strengthLoads'
import { doseMinutes } from '../lib/brain/doseMinutes'
import { rankPicks, type PickOption, type PickWeather } from '../lib/brain/picks'
import { dowOf } from '../lib/brain/classPicker'
import type { OutlineSession } from '../lib/brain/outline'
import { shortLift } from '../features/dayboard/rowState'
import { computeDose, loadBrainInputs, morningState, nightState, runLabelFor, type StoredDose } from './brain'
import { getActiveBlock } from './blockZeroData'
import { blockKind, loadInjuryFlag, loadPlacementContext, mtClassDays, trainingWeekFor, weekStamps } from './coachData'
import { lowerLegOnWatch } from './bodyWatch'

type DB = ReturnType<typeof createDB>
type SessionRow = typeof SessionsTable.$inferSelect

/** One line of a preview: label, value, and ↑ / ↓ where a weight moved. */
export type PreviewLine = [string, string] | [string, string, 'up' | 'down']

export interface CoachPick {
  key: string
  type: string
  label: string
  runCategory?: string
  timeSlot: 'am' | 'pm'
  flexibleTimeSlot: boolean
  /** The coach's one short reason (picks only). */
  reason: string | null
  /** About how long (minutes), from the dose when it has one. */
  minutes: number | null
  /** Exactly what it would be that day. */
  lines: PreviewLine[]
  /** + add: the week's next strength pulled to this day, as the board does. */
  action?: PickAction
}

export interface CoachPicksOut {
  picks: CoachPick[]
  /** Everything else, the list's own order. */
  rest: CoachPick[]
  /** Every option, the list's own order (EVERYTHING ELSE ›). */
  all: CoachPick[]
}

export interface CoachPicksQuery {
  day: number
  today: number
  mode: 'replace' | 'add'
  /** REPLACE: the session it swaps out. */
  sessionId?: string | null
  /** + add: the slot (AM gone after noon on the day). */
  pmOnly?: boolean
  weather?: PickWeather | null
}

const keyOf = (o: { type: string; runCategory?: string }) => (o.runCategory ? `${o.type}:${o.runCategory}` : o.type)
const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`
/** The plan lines' load words: "35 lb", a work-up "20→35 lb", "BW" only for a bodyweight move. */
const lb = (kg: number | null | undefined, equipment: string | null | undefined, fromKg?: number | null) => {
  const w = loadLabel(kg, equipment, fromKg)
  return /\d$/.test(w) ? `${w} lb` : w
}

/** The preview lines from a dose (or the session's fixed shape when it has none). */
export function previewLines(type: string, dose: StoredDose | null, opts: { week: number; slot: 'am' | 'pm'; rope?: { rounds: number }; foundationMin?: number; equipment?: Readonly<Record<string, string>> }): PreviewLine[] {
  if (dose?.strength) {
    return dose.strength.lifts.slice(0, 4).map(l => {
      const name = shortLift(l.label).toUpperCase()
      const eq = opts.equipment?.[l.exerciseId] ?? null
      // A work-up shows its ladder, first set to top, the same as the plan lines.
      const ladder = (l.setWeightsKg ?? []).filter((w): w is number => w != null && w > 0)
      const value = l.workUp && ladder.length > 0
        ? `${l.sets}×${l.reps} · ${lb(ladder[ladder.length - 1], eq, ladder[0])}`
        : `${l.sets}×${l.reps} · ${lb(l.weightKg, eq)}`
      return l.change === 'increase' ? [name, value, 'up'] : l.change === 'decrease' ? [name, value, 'down'] : [name, value]
    })
  }
  if (dose?.run) {
    const r = dose.run
    if (r.walkOnly) return [['EASY', `walk or bike · ${Math.round(r.totalSec / 60)} min`]]
    if (r.rounds <= 1 && r.walkSec === 0) return [['RUN', `${Math.round(r.runSec / 60)} min · HR ≤${r.hrCeilingBpm}`], ['SHAPE', 'one steady run']]
    return [['RUN', `${Math.round(r.totalSec / 60)} min · HR ≤${r.hrCeilingBpm}`], ['ROUNDS', `${r.rounds} × run ${mmss(r.runSec)}, walk ${mmss(r.walkSec)}`]]
  }
  if (dose?.bag) return [['ROUNDS', `${dose.bag.rounds} × 3 min · 1 min rest`], ...(dose.bag.finishers ? [['FINISH', 'one hard round'] as PreviewLine] : [])]
  switch (type) {
    case 'mobility': return [['BLOCKS', 'back, then neck and shoulder'], ['LEVEL', `${foundationLevel(opts.week)} · ~${opts.foundationMin ?? foundationMinutes({ week: opts.week })} min`]]
    case 'active_recovery': return [['EASY', `walk or bike · ${RESET_WALK_MIN} min`], ['THEN', `hips and foam roller · ~${resetMinutes()} min in all`]]
    case 'skip_rope': return [['ROUNDS', `${opts.rope?.rounds ?? 5} × 3 min · 1 min rest`]]
    case 'mt_class': return [['CLASS', `${opts.slot === 'am' ? 'morning' : 'evening'} · 60 min`], ['AFTER', 'easier morning after']]
    default: return []
  }
}

/** The minutes a preview stands for. */
function minutesFor(type: string, dose: StoredDose | null, row: SessionRow, week: number, kind: 'block_zero' | 'fighter', opts: { ropeRounds: number; foundationMin: number }): number | null {
  // The same minutes a row with this dose shows (page 73).
  const fromDose = doseMinutes({ ...row, blockType: kind }, dose)
  if (fromDose != null) return fromDose
  if (type === 'mobility') return opts.foundationMin
  if (type === 'skip_rope') return ropeMinutes(opts.ropeRounds)
  if (type === 'mt_class') return 60
  return estimatedMinutes({ type, notes: null, estimatedMin: null }, kind, week)
}

/** REPLACE leaves out the session it swaps (a run-walk keeps Zone 2, page 56 1B). */
function keepsFor(target: Pick<SessionRow, 'type' | 'label' | 'notes'>, o: { type: string; runCategory?: string }): boolean {
  const same = o.type === target.type && (o.runCategory ?? null) === (target.type === 'running' ? target.notes ?? null : null)
  return !same || (target.type === 'foundation_run' && /run-walk/i.test(target.label ?? ''))
}

export async function coachPicksFor(db: DB, q: CoachPicksQuery): Promise<CoachPicksOut | null> {
  const block = await getActiveBlock(db)
  const kind = blockKind(block?.blockType)
  const target = q.mode === 'replace' && q.sessionId ? (await db.select().from(sessions).where(eq(sessions.id, q.sessionId)))[0] ?? null : null
  if (q.mode === 'replace' && !target) return null
  const day = target?.scheduledDate ?? q.day
  const monday = mondayOf(day)
  const tw = block ? await trainingWeekFor(db, block, Math.max(day, q.today), q.today) : null
  const stamps = block && tw ? weekStamps(block, tw) : { weekNumber: 1, strengthWeek: 1 }
  const rows = await db.select().from(sessions).where(and(gte(sessions.scheduledDate, monday - 1), lte(sessions.scheduledDate, monday + 7)))
  const inp = await loadBrainInputs(db, q.today)
  const read = day === q.today ? morningState(inp, day) ?? nightState(inp, day) : nightState(inp, day)

  const board = withBlockLabels(allBoardRows(), block?.blockType ?? null)
  const options = board.filter(o => !target || keepsFor(target, o))
  const slotFor = (o: { timeSlot: 'am' | 'pm'; flexibleTimeSlot: boolean }): 'am' | 'pm' => {
    if (target) return o.flexibleTimeSlot ? (target.timeSlot === 'pm' ? 'pm' : 'am') : o.timeSlot
    return q.pmOnly ? 'pm' : o.timeSlot
  }

  // + add: the board's own action (strength on a day without lifting pulls the week's next one here).
  const placement = q.mode === 'add' && block ? await loadPlacementContext(db, day, q.today) : null
  const weekLike = rows.filter(r => r.scheduledDate != null && r.scheduledDate >= monday && r.scheduledDate <= monday + 6)
    .map(r => ({ id: r.id, type: r.type, label: r.label, notes: r.notes, epochDay: r.scheduledDate as number, timeSlot: r.timeSlot === 'pm' ? 'pm' as const : 'am' as const, status: r.status }))

  // Rope rounds from the same read and injury flag the rope's start uses (one number, audit #23).
  const injury = await loadInjuryFlag(db, day)
  const rope = ropeRounds(read.state, injuryActionFor('skip_rope', injury).action === 'walk_or_bike')
  // Foundation's minutes for that day's routine (its level and day), not a flat 12 (audit #24).
  const foundationMin = foundationMinutes({ week: kind === 'block_zero' ? stamps.weekNumber : null, dayOfWeek: new Date(day * 86400000).getUTCDay() })

  // The preview: the session as it would land that day, dosed by the brain.
  const out = new Map<string, CoachPick>()
  for (const o of options) {
    const slot = slotFor(o)
    const label = o.type === 'strength' && kind === 'block_zero'
      ? (target?.type === 'strength' && target.label ? target.label : `Strength ${strengthLetterFor(day, weekLike, false)}`)
      : o.type === 'strength' ? null : o.label
    const row: SessionRow = {
      ...(target ?? ({} as SessionRow)),
      id: target ? `preview-${target.id}` : `preview-${keyOf(o)}`,
      type: o.type, label, notes: o.type === 'running' ? o.runCategory ?? null : null,
      scheduledDate: day, timeSlot: slot, blockWeek: o.type === 'strength' ? stamps.strengthWeek : null,
      blockType: block?.blockType ?? 'fighter', status: 'planned', source: target ? 'replace' : 'ad_hoc',
      contextJson: null, doseJson: null, weekPlanId: target?.weekPlanId ?? null,
    } as SessionRow
    const dose = KEY_TYPES.has(o.type) ? await computeDose(db, row, q.today, inp, { decision: null }).catch(() => null) : null
    const action = placement ? pickDayOption({ type: o.type, label: null, notes: o.type === 'running' ? o.runCategory ?? null : null, timeSlot: slot }, day, placement).action : undefined
    // A run reads the name its dose gives it (Easy Run, Run-Walk, Easy Walk or Bike), as its row will (audit #14).
    const runName = (o.type === 'foundation_run' || o.type === 'running') && dose ? runLabelFor(row, dose) : null
    out.set(keyOf(o), {
      key: keyOf(o), type: o.type, label: action?.label && o.type === 'strength' ? action.label : runName ?? o.label, ...(o.runCategory ? { runCategory: o.runCategory } : {}),
      timeSlot: slot, flexibleTimeSlot: action && action.kind !== 'add' ? false : o.flexibleTimeSlot,
      reason: null,
      minutes: minutesFor(o.type, dose, row, stamps.weekNumber, kind, { ropeRounds: rope, foundationMin }),
      lines: previewLines(o.type, dose, { week: stamps.weekNumber, slot, rope: { rounds: rope }, foundationMin, equipment: inp.equipment }),
      ...(action ? { action } : {}),
    })
  }

  const kneeFlag = kneeSafeOnly(injury) || await lowerLegOnWatch(db)
  const week: OutlineSession[] = rows.filter(r => r.scheduledDate != null).map(r => ({
    id: r.id, type: r.type, label: r.label, notes: r.notes, day: r.scheduledDate as number, slot: r.timeSlot === 'pm' ? 'pm' : 'am', status: r.status, source: r.source, locked: true,
  }))
  const trained = new Set(inp.events.sessions.filter(s => s.status === 'completed' && KEY_TYPES.has(s.type) && s.day < day).map(s => s.day))
  // A class only on a day he picked in Settings (none picked: he isn't going); EVERYTHING ELSE still lists it.
  const classDay = (await mtClassDays(db)).has(dowOf(day))
  const pickOptions: PickOption[] = options.filter(o => o.type !== 'mt_class' || classDay)
    .map(o => ({ key: keyOf(o), type: o.type, label: o.label, ...(o.runCategory ? { runCategory: o.runCategory } : {}) }))
  const ranked = rankPicks({
    mode: q.mode, day, today: q.today, slot: target ? (target.timeSlot === 'pm' ? 'pm' : 'am') : q.pmOnly ? 'pm' : 'am',
    replacing: target ? { id: target.id, type: target.type, label: target.label, notes: target.notes } : null,
    week, monday, blockType: kind, state: read.state, stateWhy: read.why,
    ownEases: inp.model.ownEases ?? [], scheduleSkips: inp.model.adherence.scheduleSkips.recent,
    trainedDays: trained, options: pickOptions,
    minutes: Object.fromEntries([...out.values()].map(p => [p.key, p.minutes])),
    weather: q.weather ?? null, kneeFlag,
  })
  return {
    picks: ranked.picks.map(r => ({ ...out.get(r.key)!, reason: r.reason })),
    rest: ranked.rest.map(r => out.get(r.key)!),
    all: [...out.values()],
  }
}
