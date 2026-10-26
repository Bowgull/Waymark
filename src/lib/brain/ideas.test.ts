// Run: tsx src/lib/brain/ideas.test.ts
// The 2026-10-21 coach-brain ideas Josh approved, pure and on made-up data:
//  1 the notebook's rules       2 interference spacing     3/4 class and bag load
//  5 anti-stagnation            6 the corrective retry     7 partial check-ins
//  8 short states expire       10 load pools              11 per-domain levels
// 12 the AI's push with numbers, and his own eases as signals.
import assert from 'node:assert/strict'
import { buildAthleteModel } from './athleteModel'
import { strengthDose, runDose, type DoseCtx, type StrengthIn } from './doses'
import { readinessState, nightRead, sickReturn } from './readiness'
import { tempStates, activeState, namedEnd } from './tempStates'
import { buildLevels, buildLoad, classDefaultRpe, rpeFromHr, sessionLoads } from './loadLevels'
import { hoursAfter, spacingCosts, violations, type OutlineSession } from './outline'
import { badSleep, pushRoom } from './candidates'
import { arbitrate, retryFixes, verify, type AiDecision, type DecisionPacket, type WeekScorer } from './decision'
import { checkOps, claimProblems, evidenceLines, notebookLines, rebuildLesson, CONFIRM_SPAN_DAYS, MAX_LESSONS, RECHECK_DAYS, RETIRE_DAYS, type EvidenceItem, type Lesson, type LessonLink } from './notebook'
import type { ModelCheckIn, ModelEvents, ModelRun, ModelSession, ModelSet, RunObservation } from './types'

const LB = 0.45359237
const MON = 20822 // Monday 2027-01-04
function events(over: Partial<ModelEvents> = {}): ModelEvents {
  return { profile: { dob: '1990-06-01', maxHr: 184, backSensitive: false }, sessions: [], sets: [], runs: [], talkTests: [], bag: [], checkIns: [], notes: [], moves: [], classLogs: [], trainingMaxes: [], openBodyAlerts: [], ...over }
}
let sid = 0
const session = (day: number, type: string, over: Partial<ModelSession> = {}): ModelSession =>
  ({ id: `s${++sid}`, type, status: 'completed', day, slot: 'am', startMin: 400, durationSec: 1800, rpe: 5, skipReason: null, source: 'template', blockType: 'block_zero', notes: null, ...over })
const lift = (s: ModelSession, exerciseId: string, w: number, rir: number | null, n = 3): ModelSet[] =>
  Array.from({ length: n }, (_, i) => ({ sessionId: s.id, day: s.day, exerciseId, section: 'main', setNumber: i + 1, weightKg: w * LB, reps: 8, plannedWeightKg: w * LB, plannedReps: 8, rir, isWarmup: false, logged: true, equipment: 'barbell' as const }))
const ci = (day: number, v: Partial<ModelCheckIn> = {}): ModelCheckIn => ({ day, sleepHours: 7.5, sleepQuality: 3, energy: 3, soreness: 2, stress: 2, mood: 3, backToday: 3, ...v })
const steady = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => ci(from + i))
const strengthIn = (over: Partial<StrengthIn> = {}): StrengthIn => ({
  kind: 'block_zero', main: [{ exerciseId: 'ex-bench-press', label: 'Bench Press', reps: 8 }], fighter: null, tmKg: {}, equipment: { 'ex-bench-press': 'barbell' }, steppedThisWeek: [], lastFeltHard: null, ...over,
})
const ctxFor = (ev: ModelEvents, day: number, over: Partial<DoseCtx> = {}): DoseCtx => ({ day, state: 'GREEN', stateWhy: null, model: buildAthleteModel(ev, day), backToday: null, openPlans: [], ...over })

// ─── 7: partial check-ins are reweighted, never read as fine ─
{
  const base = steady(MON - 14, MON - 1)
  const short = readinessState([...base, { day: MON, sleepHours: 5.5, sleepQuality: null, energy: 3, soreness: null, stress: null, mood: null, backToday: null }], MON)
  assert.equal(short.confidence, 'partial')
  assert.equal(short.today.read, 2)
  assert.equal(short.state, 'AMBER', '1 worse of 2 read counts like 2 of 5: AMBER')
  assert.ok(/short check-in/.test(short.why ?? ''), short.why ?? '')
  assert.equal(readinessState([...base, ci(MON, { soreness: 4 })], MON).state, 'GREEN', 'a full check-in with 1 item off stays GREEN')
  const halfFresh = readinessState([...base, { day: MON, sleepHours: 8.5, sleepQuality: 5, energy: 5, soreness: null, stress: null, mood: null, backToday: null }], MON)
  assert.equal(halfFresh.state, 'GREEN', '3 items all better: not FRESH on a partial picture')
  assert.equal(readinessState([...base, ci(MON, { sleepHours: 8.5, energy: 4, mood: 4 })], MON).state, 'FRESH', 'a full check-in can still be FRESH')
  assert.equal(readinessState(base, MON).confidence, 'none', 'no check-in: nothing read')
  console.log('ok: 7 partial check-ins')
}

// ─── 8: short states end on their own ────────────────────────
{
  const sick = tempStates([{ day: MON, text: 'Woke up sick, sore throat.' }], MON + 5)
  assert.equal(sick.length, 1)
  assert.equal(sick[0].untilDay, MON + 2, 'sick: 3 days from the mention')
  assert.equal(sick[0].endedBy, 'time')
  assert.equal(activeState(sick, 'sick', MON + 5), null, 'never stuck')
  const better = tempStates([{ day: MON, text: 'sick with a cold' }, { day: MON + 1, text: 'Feeling better today' }], MON + 1)
  assert.equal(better[0].untilDay, MON, 'he said it is over: it ends')
  assert.equal(better[0].endedBy, 'note')
  const away = tempStates([{ day: MON + 1, text: 'Away for work till Sun, hotel gym.' }], MON + 1)
  assert.equal(away[0].kind, 'away')
  assert.equal(away[0].untilDay, MON + 6, 'till Sunday')
  assert.equal(namedEnd('back Monday', MON + 3), MON + 6, 'back Monday: away through Sunday')
  assert.equal(namedEnd('trip for 3 days', MON), MON + 2)
  const capped = tempStates([{ day: MON, text: 'travelling for a month' }], MON + 30)
  assert.ok(capped[0].untilDay <= MON + 13, 'away never runs past 14 days without a new mention')
  const base = steady(MON - 14, MON + 10)
  const inp = { checkIns: base, today: MON + 1, sickDays: new Set<number>(), notesByDay: new Map<number, string>(), temp: tempStates([{ day: MON, text: 'Sick, fever last night' }], MON + 1) }
  assert.equal(nightRead(inp, MON + 1).state, 'RED', 'while sick: recover or rest')
  const later = { ...inp, today: MON + 5, temp: tempStates([{ day: MON, text: 'Sick, fever last night' }], MON + 5) }
  assert.notEqual(nightRead(later, MON + 5).state, 'RED', 'the sick state has ended by itself')
  // Rebuild Phase 8: the graded return. Sick Mon to Wed (3 days): Thu, Fri and Sat easy, no hard runs; Sunday as the morning says.
  const back = (day: number) => nightRead({ ...inp, today: day, temp: tempStates([{ day: MON, text: 'Sick, fever last night' }], day) }, day)
  for (const d of [MON + 3, MON + 4, MON + 5]) assert.deepEqual([back(d).state, back(d).returning], ['AMBER', true], `day ${d - MON}: easy, back from sick`)
  assert.ok(/Just over being sick/.test(back(MON + 3).why ?? ''), back(MON + 3).why ?? '')
  assert.notEqual(back(MON + 6).returning, true, 'one easy day per sick day, then the morning decides')
  const short = tempStates([{ day: MON, text: 'sick with a cold' }, { day: MON + 1, text: 'Feeling better today' }], MON + 1)
  assert.deepEqual([sickReturn(short, MON + 1) != null, sickReturn(short, MON + 2) != null], [true, false], 'one sick day: one easy day')
  console.log('ok: 8 short states expire')
}

// ─── 3, 4, 10: class load, HR vs RPE, two pools ──────────────
{
  const cls = session(MON, 'mt_class', { rpe: null, durationSec: 1800 })
  const bag = session(MON, 'bag_work', { rpe: 5, durationSec: 1800, avgHr: 165 })
  const ev = events({ sessions: [cls, bag], classLogs: [{ sessionId: cls.id, day: MON, learned: false, classType: 'Sparring' }] })
  const loads = sessionLoads(ev, MON)
  const c = loads.find(l => l.type === 'mt_class')!
  assert.equal(c.minutes, 60, 'a class is always 60 minutes')
  assert.equal(c.rpe, classDefaultRpe('Sparring'))
  assert.equal(c.rpeSource, 'default')
  assert.equal(c.load, 8 * 60, 'no effort logged: the default for the class type x 60')
  const b = loads.find(l => l.type === 'bag_work')!
  assert.equal(b.hrLoad, rpeFromHr(165, 184) * 30)
  assert.equal(b.load, Math.max(b.rpeLoad, b.hrLoad ?? 0), 'bag work: the larger of HR and RPE')
  assert.ok(b.load > b.rpeLoad, 'here HR says harder than the RPE')
  const logged = sessionLoads(events({ sessions: [session(MON, 'mt_class', { rpe: 6 })] }), MON)[0]
  assert.equal(logged.load, 360, 'effort logged after class x 60')

  const str = session(MON, 'strength', { rpe: 7, durationSec: 3600 })
  const run = session(MON, 'foundation_run', { rpe: 7, durationSec: 3600 })
  const pools = buildLoad(sessionLoads(events({ sessions: [str, run] }), MON + 10), MON + 10)
  assert.ok(pools.strengthFatigue > pools.enduranceFatigue, `strength fatigue decays slower (${pools.strengthFatigue} vs ${pools.enduranceFatigue})`)
  const onlyStrength = buildLoad(sessionLoads(events({ sessions: [session(MON, 'strength', { rpe: 7 })] }), MON + 3), MON + 3)
  assert.equal(onlyStrength.fitness, 0, 'strength counts toward fatigue, never fitness')
  assert.ok(onlyStrength.fatigue > 0)
  console.log('ok: 3, 4, 10 class load, HR vs RPE, pools')
}

// ─── 11: per-domain levels from completion and effort ────────
{
  const obs = (day: number, o: Partial<RunObservation>): RunObservation => ({ day, sessionId: `r${day}`, durationSec: 1500, pieceSec: 90, u: 1, uSource: 'max', driftBpm: null, avgHr: 130, rpe: 4, hasHr: true, isIndoor: false, cutShort: false, scheduleCut: false, tooFast: false, tooSlow: false, handled: true, struggled: false, ...o })
  const lv = buildLevels({
    runs: [obs(MON, {}), obs(MON + 2, {}), obs(MON + 4, { handled: false, struggled: true, rpe: 8 }), obs(MON + 6, { cutShort: true, scheduleCut: true, handled: false })],
    lifts: [{ exerciseId: 'ex-bench-press', exposure: { day: MON, topKg: 40, plannedKg: 40, lastRir: 3, lowered: false, raised: false, incomplete: false, e1rmKg: 50 }, sessionRpe: 6 }],
    combat: [{ day: MON + 1, type: 'mt_class', rpe: 6, hardEnd: false }],
  })
  assert.equal(lv.run.level, 1.1, 'up 0.3, up 0.3, down 0.5, a time cut holds')
  assert.equal(lv.run.sessions, 4)
  assert.equal(lv.press.level, 1.5, '3+ left: up 0.5')
  assert.equal(lv.mtConditioning.level, 1.3)
  assert.equal(lv.hinge.sessions, 0)
  const m = buildAthleteModel(events(), MON)
  assert.equal(m.levels.run.level, 1, 'every domain starts at 1')
  console.log('ok: 11 per-domain levels')
}

// ─── 12: his own eases shape the next pick ───────────────────
{
  const days = [MON - 14, MON - 9, MON - 7]
  const done = days.map(d => session(d, 'strength'))
  const sets = done.flatMap(s => lift(s, 'ex-bench-press', 95, 3))
  const skipped = session(MON - 2, 'strength', { status: 'skipped', skipReason: 'tired' })
  const ev = events({ sessions: [...done, skipped], sets })
  const m = buildAthleteModel(ev, MON)
  assert.deepEqual(m.ownEases.map(e => [e.domain, e.kind]), [['strength', 'skipped']])
  const d = strengthDose(ctxFor(ev, MON), strengthIn())
  assert.equal(d.lifts[0].level, 'HOLD', 'his skip for how he felt holds the next strength session (the rules alone would progress)')
  assert.ok(d.why.some(w => /sat out/.test(w)), d.why.join(' | '))
  assert.equal(strengthDose(ctxFor(events({ sessions: done, sets }), MON), strengthIn()).lifts[0].level, 'PROGRESS', 'without the skip: PROGRESS')
  const moved = events({ sessions: [...done, skipped, session(MON - 1, 'strength')], sets: [...sets, ...lift({ ...done[0], id: 'later', day: MON - 1 }, 'ex-bench-press', 95, 3)] })
  assert.equal(buildAthleteModel(moved, MON).ownEases.length, 0, 'a session done since: he has moved on')
  const swap = events({ sessions: [session(MON - 1, 'mobility', { replacedFrom: 'strength', source: 'replace' })] })
  assert.deepEqual(buildAthleteModel(swap, MON).ownEases.map(e => [e.domain, e.kind]), [['strength', 'swapped']], 'a swap to something lighter')
  const scheduleSkip = events({ sessions: [session(MON - 1, 'strength', { status: 'skipped', skipReason: 'no_time' })] })
  assert.equal(buildAthleteModel(scheduleSkip, MON).ownEases.length, 0, 'a skip for time says nothing about him')
  console.log('ok: 12 his own eases')
}

// ─── 2: interference spacing ─────────────────────────────────
{
  const s = (id: string, type: string, day: number, slot: 'am' | 'pm', label: string | null = null, notes: string | null = null): OutlineSession => ({ id, type, label, day, slot, status: 'planned', source: 'template', locked: false, notes })
  assert.equal(hoursAfter(s('a', 'mt_class', MON, 'pm'), s('b', 'strength', MON + 1, 'am')), 14)
  const hinge = violations([s('c', 'mt_class', MON, 'pm'), s('b', 'strength', MON + 1, 'am', 'Strength B')], 'block_zero', MON)
  assert.ok(hinge.some(v => /heavy hinge the morning after Monday's class/.test(v)), hinge.join('; '))
  assert.deepEqual(violations([s('c', 'mt_class', MON, 'pm'), s('b', 'strength', MON + 1, 'pm', 'Strength B')], 'block_zero', MON).filter(v => /hinge/.test(v)), [], '24 h later is fine')
  assert.deepEqual(violations([s('c', 'mt_class', MON, 'pm'), s('b', 'strength', MON + 1, 'am', 'Strength C')], 'block_zero', MON).filter(v => /hinge/.test(v)), [], 'Strength C is not a hinge day')
  // Rebuild Phase 2: a hard run in the 48 h after heavy legs is a limit, the 24 h edge included.
  const legs = violations([s('l', 'strength', MON, 'am', 'Strength A'), s('r', 'running', MON + 1, 'am', null, 'tempo')], 'block_zero', MON)
  assert.ok(legs.some(v => /within 48 h after Monday's heavy legs/.test(v)), legs.join('; '))
  assert.ok(violations([s('l', 'strength', MON, 'am', 'Strength A'), s('r', 'running', MON + 2, 'am', null, 'tempo')], 'block_zero', MON).every(v => !/48 h/.test(v)), '48 h later is fine')
  assert.ok(violations([s('r', 'running', MON, 'am', null, 'tempo'), s('l', 'strength', MON, 'pm', 'Strength A')], 'block_zero', MON).every(v => !/48 h|holds/.test(v)), 'a doubled morning keeps the rules')
  assert.ok(violations([s('r', 'running', MON, 'am', null, 'tempo'), s('l', 'strength', MON + 1, 'am', 'Strength A'), s('c', 'mt_class', MON + 2, 'pm'), s('t', 'running', MON + 4, 'am', null, 'intervals'), s('b', 'bag_work', MON + 5, 'am')], 'block_zero', MON, 4).some(v => /hard days \(cap 4\)/.test(v)), 'over the cap')
  assert.ok(violations([s('e', 'foundation_run', MON, 'am'), s('k', 'bag_conditioning', MON, 'pm')], 'block_zero', MON).every(v => !/holds/.test(v)), 'an easy run and evening Bag Conditioning share a day')
  const order = spacingCosts([s('r', 'foundation_run', MON, 'am'), s('l', 'strength', MON, 'pm', 'Strength A')], 'block_zero', MON)
  assert.ok(order.some(c => /lift first/.test(c.why)), 'a shared day: lift first')
  console.log('ok: 2 interference spacing')
}

// ─── 12: room above the rules' default, and verify / arbitrate ─
{
  const days = [MON - 14, MON - 9, MON - 7]
  const done = days.map(d => session(d, 'strength'))
  const sets = [...lift(done[0], 'ex-bench-press', 95, 2), ...lift(done[1], 'ex-bench-press', 95, 2), ...lift(done[2], 'ex-bench-press', 95, 3)]
  const ev = events({ sessions: done, sets, checkIns: steady(MON - 14, MON) })
  const m = buildAthleteModel(ev, MON)
  // Rebuild Phase 4: one easy session (3+ on the last set) steps up in the rules themselves.
  assert.equal(strengthDose(ctxFor(ev, MON), strengthIn()).lifts[0].level, 'PROGRESS', 'one easy session: the rules step up at once')
  assert.equal(pushRoom({ sessionType: 'strength', rulesDose: { level: 'PROGRESS', strength: strengthDose(ctxFor(ev, MON), strengthIn()) }, state: 'GREEN', confidence: 'full', model: m, checkIns: ev.checkIns, today: MON, backFlag: false, injuryFlag: false }).blocked, 'no numbers support a push', 'nothing left above it on a GREEN day')
  // The push room as before, on a lift held by its own numbers (3+ last time, held by one step a week).
  const rules = strengthDose(ctxFor(ev, MON), strengthIn({ steppedThisWeek: ['ex-bench-press'] }))
  assert.equal(rules.lifts[0].level, 'HOLD', 'one step a week: the rules hold')
  const g = { sessionType: 'strength', rulesDose: { level: rules.level, strength: rules }, state: 'GREEN' as const, confidence: 'full' as const, model: m, checkIns: ev.checkIns, today: MON, backFlag: false, injuryFlag: false }
  const room = pushRoom(g)
  assert.deepEqual(room.levels, ['PROGRESS'], 'GREEN: up to PROGRESS, no further')
  assert.deepEqual(room.evidenceIds, ['f.lift.ex-bench-press.lastRir'])
  assert.deepEqual(pushRoom({ ...g, state: 'FRESH' }).levels, ['PROGRESS', 'PUSH'])
  assert.equal(pushRoom({ ...g, state: 'AMBER' }).blocked, 'state AMBER')
  assert.equal(pushRoom({ ...g, backFlag: true }).blocked, 'back flag')
  assert.equal(pushRoom({ ...g, injuryFlag: true }).blocked, 'injury or raven flag')
  assert.equal(pushRoom({ ...g, confidence: 'none' }).blocked, 'no check-in read')
  assert.equal(pushRoom({ ...g, rulesDose: { level: 'EASE' as const, strength: rules } }).blocked, 'rules pick is EASE')
  const shortNight = [...steady(MON - 14, MON - 1), ci(MON, { sleepHours: 5.5 })]
  assert.ok(badSleep(shortNight, MON))
  assert.equal(pushRoom({ ...g, checkIns: shortNight }).blocked, 'short or bad night')
  const guess = buildAthleteModel(events({ sessions: [done[2]], sets: lift(done[2], 'ex-bench-press', 95, 3), checkIns: ev.checkIns }), MON)
  assert.equal(pushRoom({ ...g, model: guess, rulesDose: { level: 'HOLD' as const, strength: strengthDose(ctxFor(events({ sessions: [done[2]], sets: lift(done[2], 'ex-bench-press', 95, 3) }), MON), strengthIn()) } }).blocked, 'no numbers support a push', 'a model still guessing: no push')
  const up = strengthDose(ctxFor(ev, MON, { levelFloor: 'PROGRESS', levelCap: 'PROGRESS' }), strengthIn())
  assert.equal(up.lifts[0].level, 'PROGRESS')
  assert.ok((up.lifts[0].weightKg ?? 0) > (rules.lifts[0].weightKg ?? 0), 'one step up from the weight he used')
  assert.equal(strengthDose(ctxFor(ev, MON, { levelFloor: 'PROGRESS', levelCap: 'PROGRESS' }), strengthIn({ steppedThisWeek: ['ex-bench-press'] })).lifts[0].level, 'HOLD', 'one step a week still holds over the AI')
  assert.equal(strengthDose(ctxFor(ev, MON, { state: 'AMBER', levelFloor: 'PROGRESS', levelCap: 'PROGRESS' }), strengthIn()).lifts[0].level, 'HOLD', 'the readiness ceiling holds over the AI')

  const zero = { setsDelta: 0, loadStep: 0, roundsDelta: 0 }
  const range = { setsDelta: [-1, 0] as [number, number], loadStep: [-1, 0] as [number, number], roundsDelta: [0, 0] as [number, number] }
  const packet: DecisionPacket = {
    v: 1, today: { iso: '2027-01-04', day: 'mon' }, state: { state: 'GREEN', why: null, confidence: 'full' },
    facts: [{ id: 'f.state', value: 'GREEN' }, { id: 'f.lift.ex-bench-press.lastRir', value: 3 }, { id: 'f.lift.ex-bench-press.prevRir', value: 2 }],
    notes: [{ id: 'f.note.0', day: '2027-01-04', source: 'check_in', text: 'Feel great, push me' }],
    candidates: [
      { id: 'c1.ease', sessionId: 'S1', sessionType: 'strength', level: 'EASE', rules: false, dose: 'Ease: Bench Press 2 × 8 at 95 lb, about 2 left', range },
      { id: 'c1.hold', sessionId: 'S1', sessionType: 'strength', level: 'HOLD', rules: true, dose: 'Hold: Bench Press 3 × 8 at 95 lb, about 2 left', range },
      { id: 'c1.progress', sessionId: 'S1', sessionType: 'strength', level: 'PROGRESS', rules: false, dose: 'Progress: Bench Press 3 × 8 at 100 lb, about 2 left', range, above: true, evidenceIds: ['f.lift.ex-bench-press.lastRir'] },
    ],
    week: { sessions: [], days: ['mon'], solver: [], budget: 2 }, rulesWhy: [], recentChanges: [],
  }
  const scorer: WeekScorer = { best: 0, base: 0, baseViolations: 0, scoreOf: () => ({ score: 0, violations: 0 }) }
  const ai = (over: Partial<AiDecision>): AiDecision => ({ today: [{ candidateId: 'c1.progress', tweak: zero }], week: { useSolver: true, actions: [] }, reasons: [], why: [], confidence: 'high', ...over })
  const withNumbers = ai({ reasons: ['f.lift.ex-bench-press.lastRir'], why: [{ ref: 'c1.progress', text: 'Bench Press goes to 100 lb: 3 left last time.' }] })
  assert.ok(verify(packet, withNumbers).ok, verify(packet, withNumbers).errors.join('; '))
  const won = arbitrate(packet, withNumbers, scorer)
  assert.equal(won.today[0].level, 'PROGRESS')
  assert.equal(won.today[0].above, true)
  assert.equal(won.source, 'ai')
  const noteOnly = ai({ reasons: ['f.note.0'] })
  const v = verify(packet, noteOnly)
  assert.ok(!v.ok && v.errors.some(e => /above the rules' pick: cite one of f.lift.ex-bench-press.lastRir/.test(e)), 'his note alone never counts')
  assert.equal(arbitrate(packet, noteOnly, scorer).today[0].level, 'HOLD', 'and arbitrate keeps the rules even if it got that far')
  assert.equal(arbitrate(packet, { ...withNumbers, confidence: 'low' }, scorer).today[0].level, 'HOLD', 'a low-confidence push: the rules')
  const nonAbove = { ...packet, candidates: packet.candidates.map(c => (c.above ? { ...c, above: false } : c)) }
  assert.equal(arbitrate(nonAbove, withNumbers, scorer).today[0].level, 'HOLD', 'harder than the rules without an above candidate: never')

  // ─── 5: anti-stagnation ───
  const progressPacket: DecisionPacket = { ...packet, candidates: [packet.candidates[0], { ...packet.candidates[1], level: 'HOLD', rules: false, id: 'c1.hold' }, { ...packet.candidates[2], rules: true, above: false, evidenceIds: undefined }] }
  const careful = ai({ today: [{ candidateId: 'c1.hold', tweak: zero }], reasons: ['f.state'] })
  assert.equal(arbitrate(progressPacket, careful, scorer).today[0].level, 'HOLD', 'a careful AI with a fact still wins normally')
  assert.equal(arbitrate(progressPacket, careful, scorer, { stalled: new Set(['strength']) }).today[0].level, 'PROGRESS', 'the third hold-back in a row with no fresh note: the rules progress')
  assert.equal(arbitrate(progressPacket, { ...careful, reasons: ['f.note.0'] }, scorer, { stalled: new Set(['strength']) }).today[0].level, 'HOLD', 'a fresh note of his still lets the AI ease')
  console.log('ok: 12 push with numbers; 5 anti-stagnation')

  // ─── 6: the corrective retry names each fix ───
  const bad = verify(packet, { ...noteOnly, today: [{ candidateId: 'c1.push', tweak: { setsDelta: 1, loadStep: 0, roundsDelta: 0 } }], why: [{ ref: 'c1.push', text: 'Up to 225 lb today!' }], reasons: ['f.made.up'] })
  const fixes = retryFixes(packet, bad.errors)
  assert.ok(fixes.some(f => /unknown candidate id "c1.push" -> pick one of c1.ease, c1.hold, c1.progress/.test(f)), fixes.join('\n'))
  assert.ok(fixes.some(f => /"f.made.up" is not an id/.test(f)))
  assert.ok(fixes.some(f => /225 lb.*quote only numbers/.test(f)) || fixes.some(f => /exclamation/.test(f)), fixes.join('\n'))
  const tweakFix = retryFixes(packet, verify(packet, ai({ today: [{ candidateId: 'c1.hold', tweak: { setsDelta: 1, loadStep: 0, roundsDelta: 0 } }] })).errors)
  assert.ok(tweakFix.some(f => /-1 or 0/.test(f)), tweakFix.join('\n'))
  const pushFix = retryFixes(packet, v.errors)
  assert.ok(pushFix.some(f => /cite f.lift.ex-bench-press.lastRir in reasons/.test(f)), pushFix.join('\n'))
  console.log('ok: 6 corrective retry')
}

// ─── 1: the notebook's rules ─────────────────────────────────
{
  assert.deepEqual(claimProblems('Back feels stiffer the morning after hinge sessions.'), [])
  assert.ok(claimProblems('Back is stiff after 3 hinge days.').some(p => /number/.test(p)), 'no digits')
  assert.ok(claimProblems('Back is stiff twice a week after hinges.').some(p => /number/.test(p)), 'no number words')
  assert.ok(claimProblems('Ignores easy guidance on runs and goes too hard.').some(p => /verdict/.test(p)), 'the ADR 0025 failure')
  assert.ok(claimProblems('Lacks discipline on rest days.').some(p => /verdict/.test(p)))
  assert.ok(claimProblems('Skips Thursday evening sessions.').some(p => /verdict/.test(p)), 'adherence is the model\'s count, not a lesson')
  assert.ok(claimProblems('Gets sick when sleep drops for a while.').some(p => /short-lived/.test(p)))

  const item = (id: string, day: number, said = false): EvidenceItem => ({ id, day, kind: said ? 'note' : 'checkin', said, text: 'x' })
  const index = new Map<string, EvidenceItem>([
    ...[0, 7, 14, 21, 28].map(d => [`ci:${d}`, item(`ci:${d}`, MON + d)] as const),
    ...[1, 2, 3].map(d => [`n:ci:${d}`, item(`n:ci:${d}`, MON + d, true)] as const),
    ['s:same1', item('s:same1', MON)], ['s:same2', item('s:same2', MON)],
  ])
  const ctx = { today: MON + 30, index, lessons: [] as Lesson[], links: [] as LessonLink[], refs: new Map<string, string>() }
  const r = checkOps({
    add: [
      { kind: 'response', claim: 'Back feels stiffer the morning after hinge sessions.', evidence: ['ci:0', 'ci:7', 'ci:14'] },
      { kind: 'response', claim: 'Shins ache after treadmill runs more than road runs.', evidence: ['ci:0', 's:same1', 's:same2'] },
      { kind: 'preference', claim: 'Prefers lifting before work over evenings.', evidence: ['n:ci:1', 'n:ci:2', 'n:ci:3'] },
      { kind: 'response', claim: 'Recovers well from bag work on easy days.', evidence: ['ci:0', 'ci:7', 'nope:1'] },
      { kind: 'feeling', claim: 'Something else entirely about recovery.', evidence: ['ci:0', 'ci:7', 'ci:14'] },
    ],
    support: [{ lesson: 'L9', evidence: ['ci:21'] }], retire: [],
  }, ctx)
  assert.deepEqual(r.accepted.map(a => a.op === 'add' ? [a.claim.slice(0, 10), a.source] : a.op), [['Back feels', 'seen'], ['Prefers li', 'said']])
  assert.ok(r.refused.some(x => /3\+ separate days/.test(x.why) && x.ref.startsWith('Shins')), 'three items on one day are one occasion')
  assert.ok(r.refused.some(x => /don't exist: nope:1/.test(x.why)), 'every id must exist')
  assert.ok(r.refused.some(x => /unknown kind/.test(x.why)))
  assert.ok(r.refused.some(x => x.op === 'support' && /no such lesson/.test(x.why)))
  const full = checkOps({ add: [{ kind: 'response', claim: 'Back feels stiffer the morning after hinge sessions.', evidence: ['ci:0', 'ci:7', 'ci:14'] }], support: [], retire: [] },
    { ...ctx, lessons: Array.from({ length: MAX_LESSONS }, (_, i) => ({ id: `x${i}`, kind: 'response', claim: `lesson ${'abcdefghijklmnopqrst'[i]} about recovery`, source: 'seen', status: 'candidate', firstSeenDay: MON, lastConfirmedDay: MON, support: 3, counter: 0, createdDay: MON, retiredDay: null, retiredReason: null } as Lesson)) })
  assert.ok(full.refused.some(x => /full/.test(x.why)), 'the cap holds')

  const links = (ids: string[], role: 'support' | 'counter' = 'support'): LessonLink[] => ids.map(evidenceId => ({ lessonId: 'L', evidenceId, role }))
  const resp = { kind: 'response' as const, status: 'candidate' as const, retiredReason: null }
  assert.equal(rebuildLesson(resp, links(['ci:0', 'ci:7', 'ci:14']), index, MON + 15).status, 'candidate')
  const conf = rebuildLesson(resp, links(['ci:0', 'ci:7', 'ci:14', 'ci:21']), index, MON + 22)
  assert.equal(conf.status, 'confirmed', `4 days spanning ${CONFIRM_SPAN_DAYS}: confirmed`)
  assert.equal(conf.firstSeenDay, MON)
  assert.equal(conf.lastConfirmedDay, MON + 21)
  assert.equal(rebuildLesson(resp, links(['ci:0', 'ci:7', 'ci:14', 'ci:21']), index, MON + 21 + RECHECK_DAYS).status, 'recheck', '8 weeks with nothing new: re-check')
  const old = rebuildLesson(resp, links(['ci:0', 'ci:7', 'ci:14', 'ci:21']), index, MON + 21 + RETIRE_DAYS)
  assert.equal(old.status, 'retired', '12 weeks: retired')
  const back = rebuildLesson({ ...resp, kind: 'back' }, links(['ci:0', 'ci:7', 'ci:14', 'ci:21']), index, MON + 400)
  assert.equal(back.status, 'recheck', 'back history never expires; its triggers get re-checked')
  const countered = rebuildLesson(resp, [...links(['ci:0', 'ci:7', 'ci:14']), ...links(['ci:21', 'ci:28', 'n:ci:1'], 'counter')], index, MON + 30)
  assert.equal(countered.status, 'retired')
  assert.match(countered.retiredReason ?? '', /counter-evidence/)
  const gone = rebuildLesson(resp, links(['ci:0', 'ci:7', 'deleted:1']), index, MON + 15)
  assert.equal(gone.status, 'retired', 'its evidence is gone: under 3 days')
  assert.equal(rebuildLesson({ ...resp, status: 'retired', retiredReason: 'x' }, links(['ci:0', 'ci:7', 'ci:14', 'ci:21']), index, MON + 22).status, 'retired', 'retired stays retired')
  const said = rebuildLesson({ ...resp, kind: 'preference' }, links(['n:ci:1', 'n:ci:2', 'n:ci:3']), index, MON + 4)
  assert.equal(said.source, 'said', 'only his words: tagged said')

  const lines = notebookLines([
    { id: 'a', kind: 'response', claim: 'Recovers fast from bag work.', source: 'seen', status: 'candidate', firstSeenDay: MON, lastConfirmedDay: MON + 7, support: 3, counter: 0, createdDay: MON, retiredDay: null, retiredReason: null },
    { id: 'b', kind: 'back', claim: 'Back stiffens after long car rides.', source: 'said', status: 'confirmed', firstSeenDay: MON, lastConfirmedDay: MON + 21, support: 4, counter: 0, createdDay: MON + 1, retiredDay: null, retiredReason: null },
    { id: 'c', kind: 'response', claim: 'Gone.', source: 'seen', status: 'retired', firstSeenDay: MON, lastConfirmedDay: MON, support: 3, counter: 3, createdDay: MON, retiredDay: MON, retiredReason: 'x' },
  ])
  assert.deepEqual(lines.lines, ['L1 | back | said | confirmed | 4 days | last 2027-01-25 | Back stiffens after long car rides.', 'L2 | response | seen | candidate | 3 days | last 2027-01-11 | Recovers fast from bag work.'], 'back first, retired left out, one fixed line each')
  assert.equal(lines.refs.get('L1'), 'b')
  assert.equal(evidenceLines(index, MON + 30).length, 3, 'check-ins and sessions in the last 21 days; notes carry their own ids')
  console.log('ok: 1 notebook rules')
}

// Runs with the floor (12) never take a rung inside the week the rung went up.
{
  const s = session(MON - 2, 'foundation_run', { rpe: 3 })
  const runs: ModelRun[] = [{ sessionId: s.id, day: s.day, type: 'foundation_run', durationSec: 1400, plannedDurationSec: 1400, distanceKm: 3, avgHr: 130, maxHr: 140, splits: [], isIndoor: false, completionStatus: null, shortReason: null, rpe: 3, pieceSec: 60, rungSec: 60 }]
  const ev = events({ sessions: [s], runs, talkTests: [{ day: MON - 2, bpm: 150 }] })
  const d = runDose(ctxFor(ev, MON, { levelFloor: 'PROGRESS', levelCap: 'PROGRESS' }), { kind: 'run_walk', longestLast30Sec: 1400, weekly: { lastWeekRunSec: 0, thisWeekSoFarSec: 0, sessionsLeftThisWeek: 3 }, hrCeilingBpm: 150, lastRunSec: null, riseThisWeek: true })
  assert.notEqual(d.level, 'PROGRESS', 'one run rise a week holds over the AI')
  console.log('ok: 12 run floor respects the weekly rise')
}

console.log('coach-brain ideas tests passed')
