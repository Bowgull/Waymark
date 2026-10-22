// Run: tsx src/lib/brain/classPicker.test.ts
// Coach brain P4: class days (coach-brain.md §9, page 70 A): the slot per day
// (Settings wins; learned or default otherwise), the ladder, the why lines,
// and the solver placing classes by their real slot.
import assert from 'node:assert/strict'
import { buildAthleteModel } from './athleteModel'
import { candidateClassDays, classLadder, classLean, classOffWhy, classSlotChoices, classWhy, learnedClassSlots, slotForClassDay, slotsOf } from './classPicker'
import { solveOutline, violations, type OutlineIn, type OutlineSession } from './outline'
import { classDaySlots, defaultClassSlot, formatClassSlots, nextClassSlot, parseClassSlots } from '../classSlots'
import type { ModelCheckIn, ModelEvents, ModelSession } from './types'

const MON = 20822 // Monday 2027-01-04
let sid = 0
const cls = (day: number, over: Partial<ModelSession> = {}): ModelSession => ({ id: `c${++sid}`, type: 'mt_class', status: 'completed', day, slot: 'pm', startMin: 18 * 60 + 30, durationSec: 3600, rpe: 7, skipReason: null, source: 'coach', blockType: 'block_zero', notes: null, ...over })
const ci = (day: number, soreness: number): ModelCheckIn => ({ day, sleepHours: 7.5, sleepQuality: 3, energy: 3, soreness, stress: 2, mood: 3, backToday: 3 })
const events = (over: Partial<ModelEvents> = {}): ModelEvents => ({ profile: { dob: '1990-06-01', maxHr: null, backSensitive: true }, sessions: [], sets: [], runs: [], talkTests: [], bag: [], checkIns: [], notes: [], moves: [], classLogs: [], trainingMaxes: [], openBodyAlerts: [], ...over })

// ─── Settings: the stored slots (page 70) ────────────────────
{
  assert.equal(defaultClassSlot(1), 'pm', 'a weekday starts PM')
  assert.equal(defaultClassSlot(6), 'any', 'Saturday starts ANY')
  assert.equal(defaultClassSlot(0), 'any', 'Sunday starts ANY')
  assert.deepEqual(['am', 'pm', 'any'].map(s => nextClassSlot(s as 'am')), ['pm', 'any', 'am'], 'the flap: AM → PM → ANY → AM')
  assert.deepEqual(parseClassSlots('mon:pm,sat:am,xyz:pm,tue:soon'), { 1: 'pm', 6: 'am' }, 'unknown parts ignored')
  assert.equal(formatClassSlots([6, 1, 3], { 6: 'am' }), 'mon:pm,wed:pm,sat:am', 'week order, defaults filled in')
  assert.deepEqual(classDaySlots([1, 6], null), { 1: 'pm', 6: 'any' }, 'saved days with no slot: nothing changes until he taps')
  assert.deepEqual(classDaySlots([1, 6], 'sat:am'), { 1: 'pm', 6: 'am' })
}

// ─── The slot per day ────────────────────────────────────────
{
  const learned = learnedClassSlots([cls(MON + 5, { startMin: 10 * 60, slot: 'am' }), cls(MON + 12, { startMin: 9 * 60 + 30, slot: 'am' }), cls(MON + 9), cls(MON + 2, { status: 'skipped', startMin: null })], MON + 14)
  assert.deepEqual(learned[6], { am: 2, pm: 0 }, 'Saturday classes he did in the morning')
  assert.deepEqual(learned[3], { am: 0, pm: 1 }, 'a skipped class teaches nothing')
  assert.equal(slotForClassDay(6, learned, 'pm'), 'pm', 'his Settings choice always wins')
  assert.equal(slotForClassDay(6, learned, 'any'), 'any')
  assert.equal(slotForClassDay(6, learned, null), 'am', 'no setting: what he did')
  assert.equal(slotForClassDay(2, learned, null), 'pm', 'no data: a weekday evening')
  assert.equal(slotForClassDay(0, learned, null), 'am', 'no data: a weekend morning')
  assert.equal(classLean(6, learned), 'am', 'an ANY day leans to the slot he used (a move he made counts)')
  assert.deepEqual(slotsOf('any'), ['am', 'pm'])
  const choices = classSlotChoices([], MON, classDaySlots([1, 6], 'sat:any'))
  assert.equal(choices[6], 'any')
  assert.equal(choices[1], 'pm')
  assert.deepEqual(candidateClassDays([]), [0, 1, 2, 3, 4, 5, 6], 'no days set: the coach suggests from every day')
  assert.deepEqual(candidateClassDays([1, 3, 9]), [1, 3])
}

// ─── The ladder: 1 → 2 → 3, and back ─────────────────────────
{
  assert.equal(classLadder([], [], MON, MON).level, 1, 'starts at one a week')
  // Two classes done, soreness 2 and 3 the next mornings: two a week from the next week.
  const done = [cls(MON + 2), cls(MON + 9)]
  const sore = [ci(MON + 3, 2), ci(MON + 10, 3)]
  assert.equal(classLadder(done, sore, MON + 11, MON + 7).level, 1, 'not in the same week')
  const up = classLadder(done, sore, MON + 14, MON + 14)
  assert.equal(up.level, 2, 'up the next week')
  assert.ok(up.step?.dir === 'up' && /soreness 2 and 3/.test(classWhy(buildAthleteModel(events(), MON + 14), MON + 18, 'pm', { setDays: true, ladder: up, nth: 2 })), 'the why quotes the soreness')
  // Soreness 4 after a class: back down.
  const down = classLadder([...done, cls(MON + 16)], [...sore, ci(MON + 17, 4)], MON + 21, MON + 21)
  assert.equal(down.level, 1, 'soreness 4 the morning after: a step down')
  // Two placed classes skipped with no reason, at one a week: a week off, and that day stops being suggested.
  const skipped = [cls(MON + 9, { status: 'missed', startMin: null }), cls(MON + 16, { status: 'skipped', startMin: null })]
  const off = classLadder(skipped, [], MON + 17, MON + 21)
  assert.equal(off.paused, true, 'a week off after two placed classes went undone')
  assert.deepEqual(off.avoidDays, [3], 'Wednesday stops being suggested for now')
  assert.equal(classLadder(skipped, [], MON + 29, MON + 28).paused, false, 'then one a week again')
  // Skips with a reason never count against him.
  const reasons = [cls(MON + 9, { status: 'skipped', skipReason: 'class_time', startMin: null }), cls(MON + 16, { status: 'skipped', skipReason: 'tired', startMin: null }), cls(MON + 23, { status: 'skipped', skipReason: 'coach_rest', startMin: null })]
  const kept = classLadder(reasons, [], MON + 24, MON + 28)
  assert.ok(!kept.paused && kept.avoidDays.length === 0, 'time, tired and the coach\'s own rest day: no step down')
  const why = classWhy(buildAthleteModel(events(), MON + 28), MON + 32, 'pm', { setDays: true, ladder: off })
  assert.ok(/Wednesday's class was skipped twice, so it moves to Friday evening/.test(why), why)
}

// ─── The why lines: plain, real numbers, never "night" ───────
{
  const m = buildAthleteModel(events(), MON)
  const a = classWhy(m, MON + 5, 'am', { setDays: true })
  assert.equal(a, 'Of your class days, Saturday morning fits the week: no heavy legs in the 24 h before.')
  assert.ok(/No class days set, so the coach picked Wednesday evening/.test(classWhy(m, MON + 2, 'pm', { setDays: false })))
  assert.equal(classOffWhy({ day: MON + 2 }, { day: MON + 1, rpe: 7 }, { day: MON + 4 }), 'Class last night: an hour at effort 7. Wednesday\'s class comes off so you get a day between; Friday\'s stays.', 'page 69 §3')
  for (const w of [a, classOffWhy({ day: MON + 2 }, { day: MON + 1, rpe: 7 }, null)]) assert.ok(w.length <= 120 && !/night/i.test(w.replace('last night', '')), w)
}

// ─── The solver: classes in their real slot ──────────────────
const os = (id: string, type: string, day: number, over: Partial<OutlineSession> = {}): OutlineSession => ({ id, type, label: type === 'strength' ? 'Strength A' : null, day, slot: 'am', status: 'planned', source: 'template', locked: false, ...over })
const W = MON + 7
const week = (): OutlineSession[] => [
  os('a', 'strength', W, { label: 'Strength A' }), os('r1', 'foundation_run', W + 1),
  os('b', 'strength', W + 2, { label: 'Strength B' }), os('r2', 'foundation_run', W + 3),
  os('c', 'strength', W + 4, { label: 'Strength C' }), os('r3', 'foundation_run', W + 5, { slot: 'pm' }),
]
const inOf = (over: Partial<OutlineIn> = {}): OutlineIn => ({
  today: W, monday: W, blockType: 'block_zero', blockStart: MON, sessions: week(), classDays: [6], classDaysSet: true, classCap: 3, classHeld: false,
  model: buildAthleteModel(events(), W), state: 'GREEN', restDue: null, ...over,
})
{
  // Saturday set to AM: the class goes in the morning.
  const am = solveOutline(inOf({ classSlots: { 6: 'am' } })).changes.find(c => c.kind === 'add')
  assert.ok(am && am.day === W + 5 && am.slot === 'am', `Saturday AM (${JSON.stringify(am)})`)
  // Saturday ANY with a run that evening: the morning fits.
  const any = solveOutline(inOf({ classSlots: { 6: 'any' } })).changes.find(c => c.kind === 'add')
  assert.ok(any && any.slot === 'am', 'ANY: the free slot that fits')
  // Saturday PM with the run there: no class on a slot that holds a session.
  assert.equal(solveOutline(inOf({ classSlots: { 6: 'pm' } })).changes.filter(c => c.kind === 'add').length, 0, 'never on a taken slot')
  // A Saturday morning class: Friday evening heavy legs is inside its 24 h; Friday morning is not.
  const fridayPm = [...week().filter(s => s.id !== 'c'), os('c', 'strength', W + 4, { label: 'Strength A', slot: 'pm' }), os('k', 'mt_class', W + 5, { slot: 'am' })]
  assert.ok(violations(fridayPm, 'block_zero', W).some(v => /heavy legs before Saturday's class/.test(v)), 'heavy legs 14 h before a morning class')
  const fridayAm = [...week().filter(s => s.id !== 'c'), os('c', 'strength', W + 4, { label: 'Strength A', slot: 'am' }), os('k', 'mt_class', W + 5, { slot: 'am' })]
  assert.ok(!violations(fridayAm, 'block_zero', W).some(v => /heavy legs before/.test(v)), 'heavy legs 24 h before: fine')
  // Hinge after a Saturday morning class: Saturday evening is inside 24 h.
  const hinge = [...week(), os('k', 'mt_class', W + 5, { slot: 'am' }), os('h', 'strength', W + 5, { label: 'Strength B', slot: 'pm' })]
  assert.ok(violations(hinge, 'block_zero', W).some(v => /heavy hinge the evening after Saturday's class/.test(v)), 'the hinge-after-class rule by the real slot')
  // Amber today: no new class today.
  const amber = solveOutline(inOf({ today: W + 5, classSlots: { 6: 'am' }, state: 'AMBER' })).changes.filter(c => c.kind === 'add')
  assert.equal(amber.length, 0, 'amber morning: no new class that day')
}

// ─── Off-plan class (page 69 §3): the planned one next to it comes off ─
{
  const sessions = [...week(), os('his', 'mt_class', W + 1, { slot: 'pm', locked: true, source: 'ad_hoc', status: 'completed', rpe: 7 }), os('wed', 'mt_class', W + 2, { slot: 'pm', source: 'coach' }), os('fri', 'mt_class', W + 4, { slot: 'pm', source: 'coach' })]
  const r = solveOutline(inOf({ today: W + 2, sessions, classDays: [3, 5], ladder: { level: 2, paused: false, avoidDays: [], step: null } }))
  const off = r.changes.find(c => c.kind === 'rest')
  assert.ok(off && 'sessionId' in off && off.sessionId === 'wed', `Wednesday's class comes off (${JSON.stringify(r.changes)})`)
  assert.equal(off!.why, 'Class last night: an hour at effort 7. Wednesday\'s class comes off so you get a day between; Friday\'s stays.')
  assert.ok(!r.changes.some(c => 'sessionId' in c && c.sessionId === 'fri'), 'Friday\'s stays')
  assert.ok(r.changes.length <= 2)
}

console.log('class day tests passed')
