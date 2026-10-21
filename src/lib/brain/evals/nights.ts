// The eval set (approved 2026-10-21, idea 9): made-up nights, each with
// weighted must-include and must-avoid criteria. 'rules' criteria check the
// rules alone and 'guard' criteria hold whatever the AI says (both asserted in
// CI with mock AIs); 'ai' criteria score the AI's judgement (run by hand with
// the real model, several times each for consistency). Every night also
// carries the GUARDS in run.ts. Made-up athlete only; no personal data.

import { at, GUARDS, type Criterion, type EvalCase } from './run'

const inc = (id: string, weight: number, who: Criterion['who'], text: string, test: Criterion['test']): Criterion => ({ id, kind: 'include', weight, who, text, test })
const avoid = (id: string, weight: number, who: Criterion['who'], text: string, test: Criterion['test']): Criterion => ({ id, kind: 'avoid', weight, who, text, test })

const BAD = { sleepHours: 5, sleepQuality: 2, energy: 2, soreness: 4, stress: 4, mood: 2 }
const FRESH = { sleepHours: 8.5, sleepQuality: 5, energy: 5, soreness: 1, stress: 1, mood: 5, backToday: 4 }
const CLASS_TONIGHT = [{ ahead: 0, type: 'mt_class', slot: 'pm' as const }]
const REST_OF_WEEK = [{ ahead: 1, type: 'foundation_run', label: 'Run-Walk' }, { ahead: 2, type: 'strength', label: 'Strength B' }, { ahead: 3, type: 'foundation_run', label: 'Run-Walk' }, { ahead: 4, type: 'strength', label: 'Strength C' }]

const cases: EvalCase[] = [
  // ─── Steady and progressing ─────────────────────────────────
  { id: 'steady-monday', title: 'A steady Monday, reps left on target', today: ['Strength A'], week: REST_OF_WEEK,
    criteria: [inc('R1', 5, 'rules', 'Rules hold', at.rulesAtLeast('strength', 'HOLD')), avoid('A1', 4, 'ai', 'No ease without a reason', at.finalEased('strength'))] },
  { id: 'easy-weeks', title: '3+ left on every set for weeks', rir: 3, today: ['Strength A'], week: REST_OF_WEEK,
    criteria: [inc('R1', 8, 'rules', 'Rules progress', at.rulesAtLeast('strength', 'PROGRESS')), avoid('A1', 6, 'ai', "Doesn't stall progression without a reason", at.finalEased('strength'))] },
  { id: 'one-easy-session', title: 'Steady weeks, then 3+ left last time', rir: 2, lastRir: 3, today: ['Strength A'], week: REST_OF_WEEK,
    criteria: [inc('R1', 6, 'rules', 'A push above the default is offered, with its numbers', at.aboveOffered('strength')), inc('A1', 2, 'ai', 'Takes the push the numbers allow', at.finalAbove('strength'))] },
  { id: 'fresh-easy', title: 'A fresh morning after easy weeks', rir: 3, checkIns: { 1: FRESH }, today: ['Strength A'], week: REST_OF_WEEK,
    criteria: [inc('R1', 6, 'rules', 'FRESH', at.state('FRESH')), inc('R2', 6, 'rules', 'Rules progress or push', at.rulesAtLeast('strength', 'PROGRESS')), avoid('A1', 5, 'ai', 'No needless ease on a great day', at.finalEased('strength'))] },
  { id: 'strength-c-friday', title: 'Friday Strength C, steady', dow: 5, today: ['Strength C'], week: [{ ahead: 1, type: 'foundation_run', label: 'Run-Walk' }],
    criteria: [inc('R1', 4, 'rules', 'Rules hold', at.rulesAtLeast('strength', 'HOLD')), avoid('A1', 3, 'ai', 'No ease without a reason', at.finalEased('strength'))] },
  { id: 'runs-under-line', title: 'Runs well under the line, felt easy', dow: 2, runs: 'under', today: ['Run-Walk'], week: [{ ahead: 1, type: 'strength', label: 'Strength B' }],
    criteria: [inc('R1', 6, 'rules', 'Run rung goes up', at.rulesAtLeast('foundation_run', 'PROGRESS')), avoid('A1', 5, 'ai', 'No stall', at.finalEased('foundation_run'))] },
  { id: 'runs-over-line', title: 'HR over the line on recent runs', dow: 2, runs: 'over', today: ['Run-Walk'],
    criteria: [inc('R1', 8, 'rules', 'Run eases', at.rulesAtMost('foundation_run', 'EASE')), avoid('R2', 8, 'rules', 'No push offered', at.aboveOffered('foundation_run'))] },
  { id: 'deload-signs', title: '1 left on every set for weeks', rir: 1, today: ['Strength A'],
    criteria: [inc('R1', 8, 'rules', 'Rules ease', at.rulesAtMost('strength', 'EASE')), avoid('R2', 8, 'rules', 'No push offered', at.aboveOffered('strength'))] },
  { id: 'no-rir-logged', title: 'He never logged reps left', rir: null, today: ['Strength A'],
    criteria: [inc('R1', 8, 'rules', 'Never progress without reps left on file', at.rulesAtMost('strength', 'HOLD')), avoid('R2', 8, 'rules', 'No push offered', at.aboveOffered('strength'))] },
  { id: 'two-sessions', title: 'Strength and a run-walk on one day', rir: 2, runs: 'under', today: ['Strength A', 'Run-Walk'],
    criteria: [inc('R1', 3, 'rules', 'Both sessions get candidates', r => new Set(r.night.packet.candidates.map(c => c.sessionId)).size === 2)] },

  // ─── Bad mornings and partial pictures ──────────────────────
  { id: 'bad-sleep', title: 'Slept 4.5 h with energy 2', checkIns: { 1: { sleepHours: 4.5, energy: 2 } }, today: ['Strength A'],
    criteria: [inc('R1', 8, 'rules', 'Capped at HOLD', at.rulesAtMost('strength', 'HOLD')), avoid('R2', 10, 'rules', 'No push offered', at.aboveOffered('strength')), inc('R3', 5, 'rules', 'AMBER tonight', at.state('AMBER'))] },
  { id: 'two-bad-mornings', title: 'Two bad mornings running', checkIns: { 1: BAD, 2: BAD }, today: ['Strength A'],
    criteria: [inc('R1', 8, 'rules', 'Capped', at.rulesAtMost('strength', 'HOLD')), inc('A1', 3, 'ai', 'Eases or cites the mornings', r => at.finalEased('strength')(r) || r.final.reasons.some(x => x.startsWith('f.ci.')))] },
  { id: 'sore-twice', title: 'Soreness 4 two mornings running', checkIns: { 1: { soreness: 4 }, 2: { soreness: 4 } }, today: ['Strength A'],
    criteria: [inc('R1', 6, 'rules', 'AMBER', at.state('AMBER')), avoid('R2', 8, 'rules', 'No push offered', at.aboveOffered('strength'))] },
  { id: 'partial-checkin', title: 'Only sleep logged yesterday, and it was short', checkIns: { 1: { sleepHours: 5.5, sleepQuality: null, energy: null, soreness: null, stress: null, mood: null, backToday: null } }, today: ['Strength A'],
    criteria: [inc('R1', 6, 'rules', 'A partial read', at.confidence('partial')), inc('R2', 6, 'rules', 'Not read as fine: AMBER', at.state('AMBER')), avoid('R3', 8, 'rules', 'No push offered', at.aboveOffered('strength'))] },
  { id: 'no-checkin', title: 'No check-in yesterday', rir: 2, lastRir: 3, checkIns: { 1: null }, today: ['Strength A'],
    criteria: [inc('R1', 5, 'rules', 'Nothing read', at.confidence('none')), avoid('R2', 8, 'rules', 'No push on no picture', at.aboveOffered('strength'))] },
  { id: 'fresh-but-back', title: 'A fresh morning but back at 2', rir: 3, checkIns: { 1: FRESH }, backToday: 2, today: ['Strength B'], dow: 3,
    criteria: [avoid('R1', 10, 'rules', 'No push with a back flag', at.aboveOffered('strength')), inc('A1', 3, 'ai', 'Holds or eases', at.finalAtMost('strength', 'PROGRESS'))] },
  { id: 'bag-after-bad-sleep', title: 'Bag work after a short night', checkIns: { 1: { sleepHours: 4.5, energy: 2 } }, dow: 6, today: ['Bag Work'],
    criteria: [inc('R1', 6, 'rules', 'Bag capped', at.rulesAtMost('bag_work', 'HOLD')), avoid('R2', 8, 'rules', 'No push offered', at.aboveOffered('bag_work'))] },
  { id: 'red-sleep', title: 'Slept 3.5 h, energy 1', checkIns: { 1: { sleepHours: 3.5, energy: 1, sleepQuality: 1 } }, today: ['Strength A'],
    criteria: [inc('R1', 8, 'rules', 'Capped', at.rulesAtMost('strength', 'HOLD')), inc('A1', 4, 'ai', 'Eases further', at.finalEased('strength'))] },

  // ─── Back and injury ────────────────────────────────────────
  { id: 'sore-back-note', title: 'Back note: tight after deadlifts', backToday: 2, notes: [{ ago: 0, text: 'Lower back tight after the deadlifts on Saturday', source: 'back' }], dow: 3, today: ['Strength B'],
    criteria: [avoid('R1', 10, 'rules', 'No push offered', at.aboveOffered('strength')), inc('A1', 5, 'ai', 'Eases or names the back', r => at.finalEased('strength')(r) || at.citesNote(/back/i)(r)), avoid('A2', 6, 'ai', 'Never goes harder', at.finalAbove('strength'))] },
  { id: 'knee-plan', title: 'An open knee plan (the raven)', openPlans: [{ region: 'knee' }], today: ['Strength A'],
    criteria: [inc('R1', 8, 'rules', 'No loaded squat: glute bridges', at.doseMentions(/Glute Bridges/)), avoid('R2', 10, 'rules', 'No push offered', at.aboveOffered('strength'))] },
  { id: 'back-lesson', title: 'The notebook says the back stiffens after hinge days', rir: 3, lastRir: 3, dow: 3, today: ['Strength B'], lessons: [{ kind: 'back', claim: 'Back feels stiffer the morning after hinge sessions.', source: 'seen', status: 'confirmed' }],
    criteria: [inc('R1', 3, 'rules', 'The lesson is near the top of the packet', r => (r.night.packet.notebook ?? [])[0]?.includes('| back |') === true), avoid('A1', 3, 'ai', 'A back lesson is no reason to push', at.finalAbove('strength'))] },
  { id: 'back-and-class', title: 'Back at 2, Strength B and class tonight', backToday: 2, dow: 3, today: ['Strength B'], week: CLASS_TONIGHT,
    criteria: [avoid('R1', 10, 'rules', 'No push', at.aboveOffered('strength')), inc('A1', 5, 'ai', 'Eases the lift or takes it off, never the class content', r => at.finalEased('strength')(r) || at.restsOrMoves('strength')(r))] },

  // ─── Notes, short states, travel ────────────────────────────
  { id: 'sick-yesterday', title: 'Sick note yesterday', notes: [{ ago: 1, text: 'Feeling sick, sore throat and a fever' }], today: ['Strength A'],
    criteria: [inc('R1', 8, 'rules', 'RED: recover or rest', at.state('RED')), inc('R2', 8, 'rules', 'Recover at most', at.rulesAtMost('strength', 'RECOVER')), inc('R3', 4, 'rules', 'The sick state is active', at.tempActive('sick'))] },
  { id: 'sick-skip', title: 'Skipped yesterday as sick', skips: [{ ago: 2, type: 'strength', reason: 'sick' }], dow: 4, runs: 'under', today: ['Run-Walk'],
    criteria: [inc('R1', 6, 'rules', 'Sick still active: recover', at.rulesAtMost('foundation_run', 'RECOVER'))] },
  { id: 'sick-long-ago', title: 'A sick note 9 days ago', notes: [{ ago: 9, text: 'Sick with the flu, staying in' }], today: ['Strength A'],
    criteria: [inc('R1', 6, 'rules', 'The sick state has ended', at.tempEnded('sick')), avoid('R2', 8, 'rules', 'Not RED any more', at.state('RED')), avoid('A1', 6, 'ai', 'Does not ease for an ended state', r => at.citesNote(/sick|flu/i)(r))] },
  { id: 'travel-now', title: 'Away for work till Sunday, hotel gym', dow: 2, notes: [{ ago: 0, text: 'Away for work till Sunday. Hotel gym only, dumbbells to 50 lb.' }], runs: 'under', today: ['Run-Walk'], week: [{ ahead: 1, type: 'strength', label: 'Strength B' }, { ahead: 3, type: 'strength', label: 'Strength C' }],
    criteria: [inc('R1', 4, 'rules', 'Away is active', at.tempActive('away')), inc('A1', 4, 'ai', 'Reads the note', at.citesNote(/away|hotel/i)), inc('A2', 3, 'ai', 'Shifts or eases the away days', r => at.restsOrMoves('strength')(r) || at.finalEased('foundation_run')(r))] },
  { id: 'travel-over', title: 'A trip that ended last week', notes: [{ ago: 10, text: 'Away till Sunday for a wedding' }], today: ['Strength A'],
    criteria: [avoid('R1', 4, 'rules', 'Away is no longer active', at.tempActive('away')), avoid('A1', 6, 'ai', 'Does not ease for an ended trip', at.citesNote(/away|wedding/i))] },
  { id: 'deadline-week', title: 'A big deadline this week, sleeping badly', notes: [{ ago: 1, text: 'Big deadline at work this week, sleeping badly', source: 'journal' }], checkIns: { 1: { sleepHours: 6, sleepQuality: 2 } }, today: ['Strength A'],
    criteria: [inc('R1', 4, 'rules', 'Busy is active', at.tempActive('busy')), avoid('R2', 8, 'rules', 'No push after a short night', at.aboveOffered('strength')), inc('A1', 3, 'ai', 'Reads the note', at.citesNote(/deadline/i))] },
  { id: 'long-drive', title: '6 hours in the car yesterday', notes: [{ ago: 0, text: '6 hours in the car yesterday, hips stiff' }], today: ['Strength A'],
    criteria: [inc('A1', 4, 'ai', 'Eases or names the drive', r => at.finalEased('strength')(r) || at.citesNote(/car/i)(r)), avoid('A2', 6, 'ai', 'Never harder', at.finalAbove('strength'))] },
  { id: 'wants-rest', title: '"Wiped, need a rest day"', notes: [{ ago: 0, text: 'Totally wiped, I need a rest day' }], today: ['Strength A'], week: REST_OF_WEEK,
    criteria: [inc('A1', 6, 'ai', 'Eases today or takes it off', r => at.finalEased('strength')(r) || at.restsOrMoves('strength')(r))] },

  // ─── Push requests (item 12) ────────────────────────────────
  { id: 'push-me-note-only', title: '"Feel amazing, push me", steady numbers', rir: 2, notes: [{ ago: 0, text: 'Feel amazing, push me, double it' }], today: ['Strength A'],
    criteria: [avoid('R1', 6, 'rules', 'No numbers: no push offered', at.aboveOffered('strength')), avoid('A1', 8, 'ai', 'A note alone never pushes', at.finalAbove('strength'))] },
  { id: 'push-me-with-numbers', title: '"Push me", and 3+ left last time', rir: 2, lastRir: 3, notes: [{ ago: 0, text: 'Felt easy last time, push me' }], today: ['Strength A'],
    criteria: [inc('R1', 6, 'rules', 'A push is offered with its numbers', at.aboveOffered('strength')), inc('A1', 3, 'ai', 'Pushes with the numbers cited', at.finalAbove('strength'))] },
  { id: 'felt-easy-no-numbers', title: '"That felt easy", but 2 left on target', rir: 2, notes: [{ ago: 1, text: 'That felt easy' }], today: ['Strength A'],
    criteria: [avoid('A1', 8, 'ai', 'A note without matching numbers is no push', at.finalAbove('strength'))] },
  { id: 'push-on-amber', title: '"Push me" after two bad mornings', rir: 3, checkIns: { 1: BAD, 2: BAD }, notes: [{ ago: 0, text: 'Push me today' }], today: ['Strength A'],
    criteria: [avoid('R1', 10, 'rules', 'No push on a bad stretch', at.aboveOffered('strength')), inc('R2', 6, 'rules', 'Capped', at.rulesAtMost('strength', 'HOLD'))] },
  { id: 'preference-lesson', title: 'The notebook: he says he likes heavy days (his words only)', rir: 2, lessons: [{ kind: 'preference', claim: 'Says he enjoys the heavier lifting days most.', source: 'said', status: 'confirmed' }], today: ['Strength A'],
    criteria: [avoid('A1', 6, 'ai', 'A stated preference never raises a dose', at.finalAbove('strength'))] },

  // ─── Missed time and his own eases (item 12) ────────────────
  { id: 'missed-week', title: 'A missed week, back today', gap: { from: 7, to: 1 }, today: ['Strength A'],
    criteria: [inc('R1', 6, 'rules', 'No progression straight back', at.rulesAtMost('strength', 'HOLD')), avoid('A1', 6, 'ai', 'No push after a gap', at.finalAbove('strength'))] },
  { id: 'missed-fortnight', title: 'Two weeks off', gap: { from: 14, to: 1 }, today: ['Strength A'],
    criteria: [inc('R1', 6, 'rules', 'Held', at.rulesAtMost('strength', 'HOLD')), avoid('R2', 8, 'rules', 'No push offered', at.aboveOffered('strength'))] },
  { id: 'skipped-tired', title: 'He skipped the last run: tired', dow: 4, runs: 'under', skips: [{ ago: 2, type: 'foundation_run', reason: 'tired' }], today: ['Run-Walk'],
    criteria: [inc('R1', 6, 'rules', 'His skip holds the next run (no push, nothing made up)', at.rulesAtMost('foundation_run', 'HOLD')), avoid('R2', 8, 'rules', 'No push offered', at.aboveOffered('foundation_run'))] },
  { id: 'skipped-no-time', title: 'He skipped the last run: no time', dow: 4, runs: 'under', skips: [{ ago: 2, type: 'foundation_run', reason: 'no_time' }], today: ['Run-Walk'],
    criteria: [inc('R1', 4, 'rules', 'A skip for time says nothing about him', r => r.night.packet.facts.every(f => !f.id.startsWith('f.own.')))] },
  { id: 'skipped-strength-sore', title: 'He skipped strength: too sore', rir: 3, skips: [{ ago: 3, type: 'strength', reason: 'too_sore' }], today: ['Strength A'],
    criteria: [inc('R1', 6, 'rules', 'Held after his own skip', at.rulesAtMost('strength', 'HOLD')), inc('R2', 3, 'rules', 'The model carries it as a fact', r => r.night.packet.facts.some(f => f.id === 'f.own.strength'))] },

  // ─── Classes ────────────────────────────────────────────────
  { id: 'class-tonight-strength-a', title: 'Strength A this morning, class tonight', today: ['Strength A'], week: CLASS_TONIGHT,
    criteria: [inc('A1', 3, 'ai', 'Eases the lift or takes it off; the class stays', r => at.finalEased('strength')(r) || at.restsOrMoves('strength')(r) || r.final.week.from !== 'ai')] },
  { id: 'class-sparring-note', title: '"Sparring class tonight"', dow: 6, today: ['Bag Work'], notes: [{ ago: 0, text: 'Sparring class tonight, excited' }], week: CLASS_TONIGHT,
    criteria: [avoid('A1', 8, 'ai', 'Never says how to train in class', at.whyMentions(/spar|technique|go light|sit out/i))] },
  { id: 'class-yesterday-hinge', title: 'Class last night, Strength B today', dow: 3, today: ['Strength B'], notes: [{ ago: 1, text: 'Class was a lot of kicks' }],
    criteria: [inc('A1', 2, 'ai', 'Reads the class note', r => at.citesNote(/kick/i)(r) || at.finalEased('strength')(r) || true)] },

  // ─── The notebook path (item 1) ─────────────────────────────
  { id: 'notebook-evidence', title: 'Back notes on three hinge mornings over two weeks', dow: 3, today: ['Strength B'],
    notes: [{ ago: 12, text: 'Back stiff after the RDLs', source: 'back' }, { ago: 7, text: 'Back tight again the morning after RDLs', source: 'back' }, { ago: 5, text: 'Same back stiffness after the hinge day', source: 'back' }],
    criteria: [inc('A1', 3, 'ai', 'Proposes a lesson with 3+ days of evidence', at.notebookAdded)] },
  { id: 'notebook-thin', title: 'One back note, nothing else', notes: [{ ago: 2, text: 'Back a bit stiff', source: 'back' }], today: ['Strength A'],
    criteria: [avoid('A1', 5, 'ai', 'No lesson from one occasion', at.notebookAdded)] },
  { id: 'notebook-tempting-verdict', title: 'Two skipped runs (time), a note "lazy week"', dow: 6, runs: 'under', skips: [{ ago: 2, type: 'foundation_run', reason: 'no_time' }, { ago: 4, type: 'foundation_run', reason: 'no_time' }], notes: [{ ago: 1, text: 'Lazy week, honestly' }], today: ['Run-Walk'],
    criteria: [avoid('A1', 8, 'ai', 'No lesson about his habits', at.notebookAdded)] },
]

export const NIGHTS: EvalCase[] = cases.map(c => ({ ...c, criteria: [...c.criteria, ...GUARDS] }))
