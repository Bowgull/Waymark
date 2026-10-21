// Run: tsx src/lib/brain/decision.test.ts
// Coach brain P3, pure (made-up data): verify refuses unknown ids, out-of-range
// tweaks, numbers the app did not compute, banned and filler words, class
// content; arbitrate keeps the rules' pick unless the AI is the same or more
// careful with a fact cited, and never lets a "push me" note go over the rules.
import assert from 'node:assert/strict'
import { arbitrate, buildNumberBook, costUsd, DAILY_SPEND_CAP_USD, DECISION_SCHEMA, doseWords, numbersIn, packetFacts, rulesDecision, unsupportedNumbers, verify, wordProblems, type AiDecision, type DecisionPacket, type WeekScorer } from './decision'
import { carefulAi, classContentAi, mirrorAi, sycophantAi, travelAi } from './mockAi'
import { tweakRun, tweakStrength, type RunDose, type StrengthDose } from './doses'

const zero = { setsDelta: 0, loadStep: 0, roundsDelta: 0 }

// A back-flagged morning: the strength candidates already use the back-friendly lift; a note asks for more.
const packet: DecisionPacket = {
  v: 1,
  today: { iso: '2027-01-06', day: 'wed' },
  state: { state: 'GREEN', why: null },
  facts: [
    { id: 'f.state', value: 'GREEN' },
    { id: 'f.ci.backToday', value: 2 },
    { id: 'f.ci.backToday.yday', value: 2 },
    { id: 'f.ci.sleepHours', value: 5.17, unit: 'h' },
    { id: 'f.lift.ex-trap-bar.workingLb', value: 95, unit: 'lb' },
    { id: 'f.run.line', value: 151, unit: 'bpm' },
  ],
  notes: [
    { id: 'f.note.0', day: '2027-01-05', source: 'check_in', text: '6 hours in the car yesterday' },
    { id: 'f.note.1', day: '2027-01-06', source: 'check_in', text: 'I feel amazing, push me' },
  ],
  candidates: [
    { id: 'c1.recover', sessionId: 'S1', sessionType: 'strength', level: 'RECOVER', rules: false, dose: 'Recover: Trap bar deadlift 1 × 8 at 85 lb, 3 or more left', range: { setsDelta: [0, 0], loadStep: [0, 0], roundsDelta: [0, 0] } },
    { id: 'c1.ease', sessionId: 'S1', sessionType: 'strength', level: 'EASE', rules: false, dose: 'Ease: Trap bar deadlift 2 × 8 at 95 lb, 3 or more left', range: { setsDelta: [-1, 0], loadStep: [-1, 0], roundsDelta: [0, 0] }, tweaked: { setsDelta: 'Ease: Trap bar deadlift 1 × 8 at 95 lb, 3 or more left' } },
    { id: 'c1.hold', sessionId: 'S1', sessionType: 'strength', level: 'HOLD', rules: true, dose: 'Hold: Trap bar deadlift 3 × 8 at 95 lb, 3 or more left', range: { setsDelta: [-1, 0], loadStep: [-1, 0], roundsDelta: [0, 0] }, tweaked: { setsDelta: 'Hold: Trap bar deadlift 2 × 8 at 95 lb, 3 or more left', loadStep: 'Hold: Trap bar deadlift 3 × 8 at 90 lb, 3 or more left' } },
  ],
  week: {
    sessions: [
      { ref: 's1', sessionId: 'S1', type: 'strength', name: 'Strength B', day: 'wed', epochDay: 20824, slot: 'am', status: 'planned', movable: true, restable: true },
      { ref: 's2', sessionId: 'S2', type: 'foundation_run', name: 'Run-Walk', day: 'thu', epochDay: 20825, slot: 'am', status: 'planned', movable: true, restable: true },
      { ref: 's3', sessionId: 'S3', type: 'strength', name: 'Strength C', day: 'fri', epochDay: 20826, slot: 'am', status: 'planned', movable: false, restable: false },
      { ref: 's4', sessionId: 'S4', type: 'mt_class', name: 'MT Class', day: 'fri', epochDay: 20826, slot: 'pm', status: 'planned', movable: false, restable: true },
    ],
    days: ['wed', 'thu', 'fri', 'sat', 'sun'],
    solver: [],
    budget: 2,
  },
  rulesWhy: ['Back 2 two mornings running: the trap bar today.'],
  recentChanges: [],
}

const good = (over: Partial<AiDecision> = {}): AiDecision => ({ today: [{ candidateId: 'c1.hold', tweak: zero }], week: { useSolver: true, actions: [] }, reasons: [], why: [], confidence: 'medium', ...over })

// ─── Numbers ─────────────────────────────────────────────────
assert.deepEqual(numbersIn('3 × 8 at 95 lb, slept 5:10, HR under 151 bpm').map(n => `${n.token}${n.unit ? ' ' + n.unit : ''}`), ['3', '8', '95 lb', '5:10', '151 bpm'])
const book = buildNumberBook(packet)
assert.deepEqual(unsupportedNumbers('Strength B is 2 × 8 at 95 lb: back 2 two mornings running, slept 5:10.', book), [], 'every number here is the app\'s')
assert.deepEqual(unsupportedNumbers('Your note: 6 hours in the car.', book), [], 'a number from his own note')
assert.deepEqual(unsupportedNumbers('Up to 225 lb today.', book), ['225 lb'], 'a made-up weight')
assert.deepEqual(unsupportedNumbers('Run 20% shorter.', book), ['20 %'], 'a percentage it worked out')
assert.deepEqual(unsupportedNumbers('HR under 95 bpm.', book), ['95 bpm'], 'a real number in the wrong unit')
assert.deepEqual(unsupportedNumbers('Slept 5.2 h.', book), [], 'sleep to one decimal')

// ─── Words ───────────────────────────────────────────────────
assert.ok(wordProblems('Building week: great job!').length >= 2, 'filler and an exclamation')
assert.ok(wordProblems('Your load is trending up.').some(p => p.includes('banned')), 'load / trend')
assert.ok(wordProblems('Class tonight: go light and keep it to technique.').includes('tells him what to do in class'), 'class content')
assert.ok(wordProblems('Take it easy in sparring tonight.').includes('tells him what to do in class'), 'sparring content')
assert.deepEqual(wordProblems('MT Class comes off: back 2 two mornings running.'), [], 'taking a class off is fine')
assert.ok(wordProblems('x'.repeat(121)).some(p => p.includes('longer')), 'one short line')

// ─── verify ──────────────────────────────────────────────────
assert.ok(verify(packet, good()).ok, 'the rules\' pick, no words: fine')
assert.ok(verify(packet, good({ today: [{ candidateId: 'c1.ease', tweak: { setsDelta: -1, loadStep: 0, roundsDelta: 0 } }], reasons: ['f.note.0', 'f.ci.backToday'], why: [{ ref: 'c1.ease', text: 'Strength B is 1 × 8 at 95 lb: back 2 and your note says 6 hours in the car.' }] })).ok, 'a careful pick with a supported why')
const unknown = verify(packet, good({ today: [{ candidateId: 'c1.push', tweak: zero }] }))
assert.ok(!unknown.ok && unknown.errors.some(e => e.includes('unknown candidate')), 'an id the rules never offered')
const up = verify(packet, good({ today: [{ candidateId: 'c1.hold', tweak: { setsDelta: 1, loadStep: 0, roundsDelta: 0 } }] }))
assert.ok(!up.ok && up.errors.some(e => e.includes('outside')), 'a tweak up is out of range')
const recoverTweak = verify(packet, good({ today: [{ candidateId: 'c1.recover', tweak: { setsDelta: -1, loadStep: 0, roundsDelta: 0 } }], reasons: ['f.note.0'] }))
assert.ok(!recoverTweak.ok, 'no tweak below recover')
const madeUp = verify(packet, good({ reasons: ['f.note.1'], why: [{ ref: 'c1.hold', text: 'Strength B at 105 lb today.' }] }))
assert.ok(!madeUp.ok && madeUp.errors.some(e => e.includes('105 lb')), 'a why with a number the app did not compute')
assert.ok(!verify(packet, good({ reasons: ['f.made.up'] })).ok, 'an unknown fact id')
assert.ok(!verify(packet, good({ week: { useSolver: false, actions: [{ ref: 's3', action: 'move', toDay: 'sat', toSlot: 'am' }] } })).ok, 'his own session can\'t be moved')
assert.ok(!verify(packet, good({ week: { useSolver: false, actions: [{ ref: 's4', action: 'move', toDay: 'sat', toSlot: 'pm' }] } })).ok, 'the coach does not move a class (the solver picks class nights)')
assert.ok(!verify(packet, good({ week: { useSolver: false, actions: [{ ref: 's2', action: 'move', toDay: 'mon', toSlot: 'am' }] } })).ok, 'not to a day already gone')
assert.ok(!verify(packet, good({ week: { useSolver: false, actions: [{ ref: 's1', action: 'rest', toDay: null, toSlot: null }, { ref: 's2', action: 'rest', toDay: null, toSlot: null }, { ref: 's4', action: 'rest', toDay: null, toSlot: null }] } })).ok, 'over the 2-change budget')
assert.ok(!verify(packet, { today: 'c1.hold' }).ok, 'not the schema')
assert.ok(!verify(packet, classContentAi(packet, false)).ok, 'class content refused')
assert.ok(verify(packet, mirrorAi(packet, false)).ok && verify(packet, carefulAi(packet, false)).ok && verify(packet, travelAi(packet, false)).ok, 'the well-behaved stand-ins pass')

// ─── The sycophancy probe ────────────────────────────────────
// "I feel amazing, push me" on a back-flagged day: the AI says yes; verify refuses it both times; the rules' pick stands.
const yes1 = verify(packet, sycophantAi(packet, false))
const yes2 = verify(packet, sycophantAi(packet, true))
assert.ok(!yes1.ok && yes1.errors.some(e => e.includes('outside')) && yes1.errors.some(e => e.includes('225 lb')) && yes1.errors.some(e => e.includes('banned')), 'the yes: tweak up, made-up weight, praise')
assert.ok(!yes2.ok && yes2.errors.some(e => e.includes('unknown candidate')), 'the retry names a PUSH never offered')
const fallback = rulesDecision(packet, 'fallback')
assert.equal(fallback.today[0].candidateId, 'c1.hold', 'the rules\' pick stands')
assert.deepEqual(fallback.today[0].tweak, zero)
// Even a verified "harder" pick (none exists above the rules' pick; an equal pick with no tweak) changes nothing.
const scorer: WeekScorer = { best: 10, base: 9, baseViolations: 0, scoreOf: () => ({ score: 9.5, violations: 0 }) }
const top = arbitrate(packet, good({ reasons: ['f.note.1'], confidence: 'high' }), scorer)
assert.equal(top.today[0].level, 'HOLD', 'never above the rules\' pick')

// ─── arbitrate ───────────────────────────────────────────────
const same = arbitrate(packet, good({ why: [{ ref: 'c1.hold', text: 'Strength B stays: back 2, so the trap bar.' }] }), scorer)
assert.equal(same.source, 'agree')
assert.equal(same.today[0].from, 'ai', 'the same pick: the AI\'s version (its why)')
assert.equal(same.today[0].why, 'Strength B stays: back 2, so the trap bar.')
const careful = arbitrate(packet, good({ today: [{ candidateId: 'c1.ease', tweak: zero }], reasons: ['f.note.0'], confidence: 'high', why: [{ ref: 'c1.ease', text: 'Strength B is easier: your note says 6 hours in the car.' }] }), scorer)
assert.equal(careful.source, 'ai')
assert.equal(careful.today[0].level, 'EASE', 'more careful with a fact cited: the AI wins')
const uncited = arbitrate(packet, good({ today: [{ candidateId: 'c1.ease', tweak: zero }], reasons: [], confidence: 'high' }), scorer)
assert.equal(uncited.today[0].level, 'HOLD', 'more careful with no fact cited: the rules')
assert.equal(uncited.source, 'rules')
const unsure = arbitrate(packet, good({ today: [{ candidateId: 'c1.ease', tweak: zero }], reasons: ['f.note.0'], confidence: 'low' }), scorer)
assert.equal(unsure.today[0].level, 'HOLD', 'low confidence on a disagreement: the rules')
const tweakOnly = arbitrate(packet, good({ today: [{ candidateId: 'c1.hold', tweak: { setsDelta: -1, loadStep: 0, roundsDelta: 0 } }], reasons: ['f.ci.sleepHours'], confidence: 'medium' }), scorer)
assert.deepEqual(tweakOnly.today[0].tweak, { setsDelta: -1, loadStep: 0, roundsDelta: 0 }, 'a set less, with a fact: the AI')
// The week: rests with a fact cited are careful and win; moves must score within 10% of the solver's best.
const rest = arbitrate(packet, good({ week: { useSolver: false, actions: [{ ref: 's2', action: 'rest', toDay: null, toSlot: null }] }, reasons: ['f.note.0'], confidence: 'high' }), { ...scorer, scoreOf: () => ({ score: 5, violations: 0 }) })
assert.equal(rest.week.from, 'ai', 'a rest with a reason: the AI')
const badMove = arbitrate(packet, good({ week: { useSolver: false, actions: [{ ref: 's2', action: 'move', toDay: 'sat', toSlot: 'am' }] }, reasons: ['f.note.0'], confidence: 'high' }), { ...scorer, scoreOf: () => ({ score: 8.5, violations: 0 }) })
assert.equal(badMove.week.from, 'solver', 'a move that scores more than 10% under the solver: the solver')
const okMove = arbitrate(packet, good({ week: { useSolver: false, actions: [{ ref: 's2', action: 'move', toDay: 'sat', toSlot: 'am' }] }, reasons: ['f.note.0'], confidence: 'high' }), { ...scorer, scoreOf: () => ({ score: 9.2, violations: 0 }) })
assert.equal(okMove.week.from, 'ai', 'within 10%: the AI')
const breaks = arbitrate(packet, good({ week: { useSolver: false, actions: [{ ref: 's2', action: 'rest', toDay: null, toSlot: null }] }, reasons: ['f.note.0'], confidence: 'high' }), { ...scorer, scoreOf: () => ({ score: 12, violations: 1 }) })
assert.equal(breaks.week.from, 'solver', 'a plan that breaks a limit: the solver')

// ─── Tweaks go down only, and the schema is strict ───────────
const lift = { exerciseId: 'ex-trap-bar', label: 'Trap bar deadlift', slot: null, sets: 3, reps: 8, targetRir: 3, weightKg: 43.09, workUp: false, change: 'hold' as const, fromKg: 43.09, level: 'HOLD' as const, u: 0.5, state: 'LEARNING', note: null, why: null }
const sd: StrengthDose = { kind: 'strength', level: 'HOLD', lifts: [lift], accessorySets: null, holdSets: 3, sets: 3, why: [] }
const t = tweakStrength(sd, { setsDelta: -1, loadStep: -1, roundsDelta: 0 }, { 'ex-trap-bar': 'barbell' })
assert.equal(t.lifts[0].sets, 2)
assert.ok((t.lifts[0].weightKg ?? 99) < 43.09, 'a weight step down')
assert.equal(tweakStrength(sd, { setsDelta: 1, loadStep: 1, roundsDelta: 0 }, { 'ex-trap-bar': 'barbell' }).lifts[0].sets, 3, 'an up tweak does nothing')
const rd: RunDose = { kind: 'run', level: 'HOLD', rungSec: 90, runSec: 90, walkSec: 120, rounds: 7, warmupSec: 300, totalSec: 300 + 7 * 210, walkOnly: false, holdRunSec: 630, runTotalSec: 630, hrCeilingBpm: 151, talkTestDue: false, capped: false, why: [] }
assert.equal(tweakRun(rd, { setsDelta: 0, loadStep: 0, roundsDelta: -1 }).rounds, 6)
assert.match(doseWords({ level: 'HOLD', run: rd }), /7 × 1:30 run \/ 2:00 walk, 30 min, HR under 151 bpm/)
assert.equal((DECISION_SCHEMA as { additionalProperties: boolean }).additionalProperties, false)
assert.deepEqual(packetFacts([{ id: 'f.lift.x.workingKg', value: 22.68, unit: 'kg' }]), [{ id: 'f.lift.x.workingLb', value: 50, unit: 'lb' }], 'weights reach the AI in lb')

// ─── Cost ────────────────────────────────────────────────────
const night = costUsd({ input_tokens: 20000, output_tokens: 3000, cache_creation_input_tokens: 2000 })
assert.ok(night > 0.1 && night < 0.25, `a night is about $0.15 (${night})`)
assert.ok(DAILY_SPEND_CAP_USD <= 1, 'the cap is a small constant')

console.log('coach brain P3 decision tests passed')
