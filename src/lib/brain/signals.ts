// Coach brain P1 (coach-brain.md §3 step 1): today's facts from the athlete
// model and the logged events, each with a stable id (f.ci.sleepHours,
// f.lift.ex-db-rdl.lastRir, f.run.lastU, f.note.12, ...). P2's rules and P3's
// AI read these; every number a why-line quotes must be one of them (§5.4).
// Facts only: no readiness state, no PROGRESS / HOLD / EASE (those are P2).
// Pure.

import { CHECKIN_ITEMS, itemBaseline, noteFlags } from './athleteModel'
import type { CheckInItem } from './athleteModel'
import type { AthleteModel, ModelEvents } from './types'

export interface Fact {
  id: string
  value: number | string | boolean | null
  unit?: string
  day?: number
}

const UNIT: Partial<Record<CheckInItem, string>> = { sleepHours: 'h' }

/** One check-in item against his own baseline: ≥1 point off (sleep: ≥1 h), §6.1. */
function itemFacts(events: ModelEvents, day: number, suffix: string): Fact[] {
  const c = events.checkIns.find(x => x.day === day)
  if (!c) return []
  const out: Fact[] = []
  let worse = 0
  let better = 0
  for (const item of CHECKIN_ITEMS) {
    const v = c[item]
    if (v == null) continue
    out.push({ id: `f.ci.${item}${suffix}`, value: v, unit: UNIT[item], day })
    const b = itemBaseline(events.checkIns, item, day)
    if (!b) continue
    const higherWorse = item === 'soreness' || item === 'stress'
    const delta = Math.round((v - b.mean) * 10) / 10
    out.push({ id: `f.ci.${item}${suffix}.vsUsual`, value: delta, unit: UNIT[item], day })
    if (higherWorse ? delta >= 1 : delta <= -1) worse++
    if (higherWorse ? delta <= -1 : delta >= 1) better++
  }
  out.push({ id: `f.ci.worseItems${suffix}`, value: worse, day }, { id: `f.ci.betterItems${suffix}`, value: better, day })
  return out
}

export function athleteSignals(model: AthleteModel, events: ModelEvents, today: number): Fact[] {
  const facts: Fact[] = []
  facts.push(...itemFacts(events, today, ''), ...itemFacts(events, today - 1, '.yday'))

  const back = model.back
  facts.push({ id: 'f.back.level', value: back.level }, { id: 'f.back.trend', value: back.trend }, { id: 'f.back.openPlans', value: back.openPlans }, { id: 'f.back.u', value: back.u })
  for (const [p, s] of Object.entries(back.sensitivity)) facts.push({ id: `f.back.after.${p}`, value: s?.delta ?? null })

  for (const l of Object.values(model.lifts)) {
    const k = `f.lift.${l.exerciseId}`
    facts.push({ id: `${k}.state`, value: l.state }, { id: `${k}.u`, value: l.u }, { id: `${k}.workingKg`, value: l.workingKg, unit: 'kg' }, { id: `${k}.e1rmKg`, value: l.e1rmKg, unit: 'kg' }, { id: `${k}.rirBias`, value: l.rirBias }, { id: `${k}.easeStreak`, value: l.easeStreak })
    if (l.last) {
      facts.push(
        { id: `${k}.lastRir`, value: l.last.lastRir, day: l.last.day },
        { id: `${k}.lastTopKg`, value: l.last.topKg, unit: 'kg', day: l.last.day },
        { id: `${k}.lowered`, value: l.last.lowered, day: l.last.day },
        { id: `${k}.raised`, value: l.last.raised, day: l.last.day },
        { id: `${k}.incomplete`, value: l.last.incomplete, day: l.last.day },
      )
    }
  }

  const r = model.run
  facts.push(
    { id: 'f.run.line', value: r.lineBpm, unit: 'bpm' }, { id: 'f.run.lineSource', value: r.lineSource }, { id: 'f.run.u', value: r.u },
    { id: 'f.run.U', value: r.uShare }, { id: 'f.run.drift', value: r.driftBpm, unit: 'bpm' }, { id: 'f.run.rungSec', value: r.rungSec, unit: 's' },
    { id: 'f.run.longestLast30Sec', value: r.longestLast30Sec, unit: 's' }, { id: 'f.run.recheckDue', value: r.recheckDue },
  )
  const lastRun = r.recent[r.recent.length - 1]
  if (lastRun) {
    facts.push(
      { id: 'f.run.last.U', value: lastRun.u, day: lastRun.day }, { id: 'f.run.last.drift', value: lastRun.driftBpm, unit: 'bpm', day: lastRun.day },
      { id: 'f.run.last.avgHr', value: lastRun.avgHr, unit: 'bpm', day: lastRun.day }, { id: 'f.run.last.hasHr', value: lastRun.hasHr, day: lastRun.day },
      { id: 'f.run.last.cutShort', value: lastRun.cutShort, day: lastRun.day }, { id: 'f.run.last.scheduleCut', value: lastRun.scheduleCut, day: lastRun.day },
      { id: 'f.run.last.tooFast', value: lastRun.tooFast, day: lastRun.day }, { id: 'f.run.last.tooSlow', value: lastRun.tooSlow, day: lastRun.day },
      { id: 'f.run.last.indoor', value: lastRun.isIndoor, day: lastRun.day },
    )
  }

  facts.push({ id: 'f.bag.rounds', value: model.bag.roundsTolerated }, { id: 'f.bag.u', value: model.bag.u }, { id: 'f.class.perWeek', value: model.klass.perWeekTolerated }, { id: 'f.class.u', value: model.klass.u })
  for (const [d, n] of Object.entries(model.klass.nights)) if (n.n > 0) facts.push({ id: `f.class.night.${d}.p`, value: n.p })
  for (const [cell, c] of Object.entries(model.adherence.cells)) facts.push({ id: `f.when.${cell}.p`, value: c.p }, { id: `f.when.${cell}.n`, value: c.n })
  for (const [t, s] of Object.entries(model.adherence.usualStart)) facts.push({ id: `f.when.start.${t}`, value: s.minute, unit: 'min' })
  facts.push({ id: 'f.when.restDays', value: model.adherence.preferredRestDays.join(',') || null }, { id: 'f.when.scheduleSkips28', value: model.adherence.scheduleSkips.recent.length })

  // Notes from the last 14 days that code can flag (the AI reads all of them in P3).
  events.notes
    .filter(n => n.day <= today && n.day > today - 14)
    .sort((a, b) => a.day - b.day)
    .forEach((n, i) => {
      const flags = noteFlags(n.text)
      if (n.source === 'back') flags.push('back')
      if (flags.length) facts.push({ id: `f.note.${i}`, value: flags.join(','), day: n.day })
    })
  return facts
}
