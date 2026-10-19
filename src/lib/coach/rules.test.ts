// Run: tsx src/lib/coach/rules.test.ts
// Small/big classification, missed-session fixes, training max rules,
// MT ramp reset, bag governance and injury flags.
import { classifyReplan, coachEaseFrom, mergeContext, withCoachEase } from './classify'
import { missedFix } from './missed'
import { mtRampStartDay, weeksSinceRampStart } from './mtRamp'
import { fighterTmDecision, transitionTmWrites, type BlockWorkingSet } from './tm'
import { bagRules, fallbackRoundTypes, governBagRounds } from './bag'
import { injuryActionFor, injuryFlag, normaliseRegion } from './injury'
import { MON, assert, s } from './testUtil'

// ─── Small auto, big ask ─────────────────────────────────────

const run = { type: 'running', notes: 'zone2' }
const strength = { type: 'strength', notes: null }
assert(classifyReplan({ shiftAction: 'hold', targetSessionType: 'strength' }, strength).size === 'small', 'hold is small')
const red = classifyReplan({ shiftAction: 'reduce_intensity', targetSessionType: 'strength' }, strength)
assert(red.size === 'small' && red.action === 'ease' && red.kind === 'reduce', 'reduce intensity on strength: small ease, fewer sets')
const rr = classifyReplan({ shiftAction: 'reduce_intensity', targetSessionType: 'running' }, run)
assert(rr.size === 'small' && rr.action === 'ease' && rr.kind === 'run_to_walk', 'reduce intensity on a run: walk or bike')
const bike = classifyReplan({ shiftAction: 'swap', targetSessionType: 'active_recovery' }, run)
assert(bike.size === 'small' && bike.action === 'ease', 'a run swapped to a walk or bike is small')
assert(classifyReplan({ shiftAction: 'swap', targetSessionType: 'bag_work' }, strength).size === 'big', 'swap to another type is big')
assert(classifyReplan({ shiftAction: 'swap', targetSessionType: 'bag_work' }, run).size === 'big', 'a run swapped to bag work is big')
assert(classifyReplan({ shiftAction: 'move', targetSessionType: 'strength' }, strength).size === 'big', 'move is big')
assert(classifyReplan({ shiftAction: 'add_recovery', targetSessionType: 'active_recovery' }, null).size === 'big', 'adding a session is big')
assert(classifyReplan({ shiftAction: 'reduce_intensity', targetSessionType: 'strength' }, null).size === 'small', 'reduce with no target: note only')
const ctxJson = withCoachEase(JSON.stringify({ blockZero: { x: 1 } }), { kind: 'reduce', reason: 'Sleep is down.', source: 'reactive', at: 1 })
assert(coachEaseFrom(ctxJson)?.kind === 'reduce' && JSON.parse(ctxJson).blockZero.x === 1, 'coach ease merges into context_json and reads back')
assert(coachEaseFrom('not json') == null && coachEaseFrom(null) == null, 'bad context_json reads as no ease')
assert(JSON.parse(mergeContext(ctxJson, { coach: { a: 1 } })).coachEase.kind === 'reduce', 'mergeContext keeps the ease')

// ─── Missed sessions -> the coach applies its fix (never asks) ──

// Tue Strength A missed (Fighter, weekday strength); Fri strength is planned within reach.
const missed = { ...s('strength', MON + 1, { status: 'missed', label: null }), id: 'tue' }
const fix = missedFix(missed, [{ ...s('mt_class', MON + 2, { timeSlot: 'pm', label: 'MT Class' }), id: 'mt' }, { ...s('strength', MON + 4), id: 'fri' }], { blockType: 'fighter', weekNumber: 3 })
assert(fix.kind === 'merge' && fix.targetSessionId === 'fri', 'a missed strength session: its main lifts go into the next strength day in reach')
assert(fix.kind === 'merge' && !/[!—]/.test(fix.why) && /accessories dropped/.test(fix.why), 'one line, house voice')
const late = missedFix({ ...s('bag_work', MON + 1, { status: 'missed' }), id: 'bag' }, [], { blockType: 'fighter', weekNumber: 3 })
assert(late.kind === 'let_go', 'a missed bag session goes: nothing is crammed (F14)')

// ─── MT ramp reset ──────────────────────────────────────────

assert(mtRampStartDay([], 50) == null, 'no classes: a fresh ramp')
assert(mtRampStartDay([10, 13, 17], 20) === 10, 'no gap: ramp counts from the first class')
assert(mtRampStartDay([10, 13, 40, 44], 46) === 40, 'a 14+ day class gap restarts the ramp at the next class')
assert(mtRampStartDay([10, 13], 40) == null, '14+ days since the last class: this class starts a new ramp')
assert(weeksSinceRampStart([10, 13, 40, 44], 54) === 2 && weeksSinceRampStart([1, 5], 60) == null, 'weeks since the ramp start')

// ─── Training max rules ─────────────────────────────────────

const sets = (week: number, w: number, reps: number, n = 3, planned = { w, reps }): BlockWorkingSet[] =>
  Array.from({ length: n }, () => ({ week, weightKg: w, reps, plannedWeightKg: planned.w, plannedReps: planned.reps }))
const progressing = fighterTmDecision({ exerciseId: 'ex-front-squat', currentTmKg: 100, region: 'lower', sets: [...sets(1, 75, 5), ...sets(2, 80, 5), ...sets(5, 84, 5, 3, { w: 80, reps: 5 }), ...sets(6, 90, 3)] })
assert(progressing.action === 'progress' && progressing.newTmKg === 104.54, 'clean block and best effort up past the noise: +4.54 kg lower')
const flat = fighterTmDecision({ exerciseId: 'ex-bench-press', currentTmKg: 80, region: 'upper', sets: [...sets(1, 60, 5), ...sets(2, 64, 5), ...sets(4, 60, 5), ...sets(5, 64, 5)] })
assert(flat.action === 'hold' && /noise/.test(flat.reason), 'same weights all block: inside the noise, max holds (F20)')
const dirty = fighterTmDecision({ exerciseId: 'ex-ohp', currentTmKg: 50, region: 'upper', sets: [...sets(1, 37.5, 5), ...sets(5, 45, 3, 3, { w: 45, reps: 5 })] })
assert(dirty.action === 'hold' && /clean/.test(dirty.reason), 'under 90% clean sets: max holds')
assert(fighterTmDecision({ exerciseId: 'ex-ohp', currentTmKg: 50, region: 'upper', sets: [] }).action === 'hold', 'no sets logged: never bumped')
const tms = new Map([['ex-bench-press', 70], ['ex-ohp', 45]])
assert(transitionTmWrites('extend', [{ exerciseId: 'ex-bench-press', weightKg: 80, source: 'ai' }], new Set(['ex-bench-press']), tms).length === 0, 'extend writes no maxes')
assert(transitionTmWrites('not_yet', [{ exerciseId: 'ex-bench-press', weightKg: 80, source: 'ai' }], new Set(), tms).length === 0, 'not yet writes no maxes')
const go = transitionTmWrites('proceed', [
  { exerciseId: 'ex-bench-press', weightKg: 80, source: 'ai' },
  { exerciseId: 'ex-ohp', weightKg: 50, source: 'ai' },
  { exerciseId: 'ex-row', weightKg: 60, source: 'ai' },
], new Set(['ex-bench-press']), tms)
assert(go.find(w => w.exerciseId === 'ex-bench-press')?.weightKg === 80, 'proceed: a retested lift keeps the AI number (the retest rule caps it next)')
assert(go.find(w => w.exerciseId === 'ex-ohp')?.weightKg === 45, 'no retest: capped at the current max')
assert(!go.some(w => w.exerciseId === 'ex-row'), 'no retest and no current max: nothing written')

// ─── Bag governance ─────────────────────────────────────────

const normal = bagRules({ blockType: 'fighter', weekNumber: 4, eased: false, easeReason: null, returnActive: false, gapDays: 0, returnReason: null })
assert(!normal.noFinishers && normal.maxRounds === 6 && fallbackRoundTypes(normal).includes('power'), 'normal day: finishers stay')
const eased = bagRules({ blockType: 'fighter', weekNumber: 4, eased: true, easeReason: 'Sleep is down.', returnActive: false, gapDays: 0, returnReason: null })
const easedRounds = fallbackRoundTypes(eased)
assert(eased.noFinishers && easedRounds.length === 4 && !easedRounds.includes('power') && !easedRounds.includes('conditioning') && easedRounds[0] === 'warmup', 'eased: 4 rounds, no finishers, warm-up kept')
const gap = bagRules({ blockType: 'fighter', weekNumber: 4, eased: false, easeReason: null, returnActive: true, gapDays: 9, returnReason: '9 days off.' })
assert(gap.noFinishers && gap.maxRounds === 5 && gap.promptLines.some(l => /No power/.test(l)), 'after a 7+ day gap: no finishers, and the prompt says so')
const ai = governBagRounds([1, 2, 3, 4, 5, 6].map(n => ({ roundNumber: n, roundType: n === 1 ? 'warmup' : n >= 5 ? 'conditioning' : 'combo_practice', rationale: 'x' })), gap)
assert(ai.length === 5 && ai.every(r => r.roundType !== 'conditioning') && ai.map(r => r.roundNumber).join() === '1,2,3,4,5', 'AI rounds held to the rules and renumbered')
assert(bagRules({ blockType: 'block_zero', weekNumber: 1, eased: false, easeReason: null, returnActive: false, gapDays: 0, returnReason: null }).noFinishers, 'early Block Zero: technique only')

// ─── Injury flags (F16) ─────────────────────────────────────

assert(normaliseRegion('Lower back') === 'back' && normaliseRegion('Knee') === 'knee' && normaliseRegion('Ankle') === 'ankle', 'regions from the skip sheet')
const kneeFlag = injuryFlag([{ epochDay: MON, skipReason: 'injury', detail: 'Knee', notes: null }], MON + 2)
assert(kneeFlag?.region === 'knee' && /Knee flagged on Mon/.test(kneeFlag.reason), 'injury skip -> region flag')
assert(injuryFlag([{ epochDay: MON, skipReason: 'injury', detail: 'Knee', notes: null }], MON + 11) == null, 'flag lapses after 10 days')
assert(injuryFlag([{ epochDay: MON, skipReason: 'tired', detail: null, notes: null }], MON + 1) == null, 'a tired skip is not an injury')
const back = injuryFlag([{ epochDay: MON, skipReason: 'injury', detail: 'Lower back', notes: null }], MON + 1)
assert(injuryActionFor('strength', back).action === 'back_swap' && injuryActionFor('foundation_run', back).action === 'walk_or_bike', 'back flag: back-friendly lifts, walk instead of the run')
assert(injuryActionFor('strength', kneeFlag).action === 'ease' && injuryActionFor('running', kneeFlag).action === 'walk_or_bike' && injuryActionFor('mt_class', kneeFlag).action === 'technical', 'knee flag: conservative ease')
const shoulder = injuryFlag([{ epochDay: MON, skipReason: 'injury', detail: 'Shoulder', notes: null }], MON + 1)
assert(injuryActionFor('running', shoulder).action === 'none', 'shoulder flag leaves runs alone')

console.log('coach rules tests passed')
