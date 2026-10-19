// Run: tsx src/lib/coach/makeRegular.test.ts
// Added sessions: the same type added 2+ weeks running, done well, becomes
// one ask with its usual slot, another safe day, or "I'll add it myself".
import { makeRegularAsk, makeRegularCandidates, makeRegularProof, safeRegularSlots, type AddedSession } from './makeRegular'
import { MON, assert, ctx, s } from './testUtil'

const NEXT = MON + 14
const bag = (day: number, extra: Partial<AddedSession> = {}): AddedSession => ({ type: 'bag_work', label: 'Bag Work', notes: null, epochDay: day, timeSlot: 'pm', status: 'completed', rpe: 7, ...extra })

// Wednesday PM bag work added in both of the last two weeks, RPE on target.
const two = makeRegularCandidates([bag(MON + 2), bag(MON + 9)], MON + 7)
assert(two.length === 1 && two[0].type === 'bag_work' && two[0].dayOfWeek === 3 && two[0].timeSlot === 'pm' && two[0].weeks === 2, 'added 2 weeks running: a candidate on its usual slot')
assert(JSON.stringify(two[0].mondays) === JSON.stringify([MON, MON + 7]), 'the weeks it ran, oldest first')
assert(two[0].notSore === false, 'no morning-after check-ins: NOT SORE is not claimed')
const easy = makeRegularCandidates([bag(MON + 2, { nextMorningSoreness: 2 }), bag(MON + 9, { nextMorningSoreness: 3 })], MON + 7)
assert(easy[0].notSore === true, 'every morning after under sore: NOT SORE')
assert(makeRegularCandidates([bag(MON + 2, { nextMorningSoreness: 2 }), bag(MON + 9, { nextMorningSoreness: 4 })], MON + 7)[0].notSore === false, 'sore (4) one morning after: no NOT SORE')
assert(makeRegularCandidates([bag(MON + 9)], MON + 7).length === 0, 'once is not a pattern')
assert(makeRegularCandidates([bag(MON - 5), bag(MON + 9)], MON + 7).length === 0, 'two weeks with a gap between: not running')
assert(makeRegularCandidates([bag(MON + 2), bag(MON + 9, { rpe: 10 })], MON + 7).length === 0, 'way over target effort: not "went well"')
assert(makeRegularCandidates([bag(MON + 2), bag(MON + 9, { readinessOff: true })], MON + 7).length === 0, 'check-ins off trend: not "went well"')
assert(makeRegularCandidates([bag(MON + 2), bag(MON + 9, { status: 'skipped' })], MON + 7).length === 0, 'skipped add does not count')
assert(makeRegularCandidates([bag(MON + 2, { type: 'mobility' }), bag(MON + 9, { type: 'mobility' })], MON + 7).length === 0, 'recovery work is not tracked')

// Next week: Wednesday has a class, so bag work (hard) can't stack there.
const nextWeek = [
  s('mt_class', NEXT + 2, { timeSlot: 'pm' }),
  s('strength', NEXT + 1), s('strength', NEXT + 3),
  s('mt_class', NEXT, { timeSlot: 'pm' }), s('mt_class', NEXT + 4, { timeSlot: 'pm' }),
]
const c = ctx({ todayEpochDay: NEXT - 1, sessions: nextWeek })
const slots = safeRegularSlots(two[0], c, NEXT)
assert(slots.length > 0 && !slots.some(x => x.dayOfWeek === 3 || x.dayOfWeek === 1 || x.dayOfWeek === 2 || x.dayOfWeek === 4 || x.dayOfWeek === 5), `only safe days offered (${slots.map(x => x.label).join(', ')})`)
const ask = makeRegularAsk(two[0], c, NEXT)
assert(ask != null && ask.options[0].id === 'usual' && ask.options[ask.options.length - 1].id === 'keep_extra', 'options: usual slot first, I\'LL ADD IT MYSELF last')
assert(ask!.options[ask!.options.length - 1].title === "I'LL ADD IT MYSELF", 'keep-extra label in plain words')
assert(ask!.question.includes('usual day is not safe'), 'says when the usual day is not safe')
const free = makeRegularAsk(two[0], ctx({ todayEpochDay: NEXT - 1, sessions: [] }), NEXT)
// Page 36: proof tiles WK 2 ✓ · WK 3 ✓ · NOT SORE, and its plain words.
const weekOf = (m: number) => (m === MON ? 2 : m === MON + 7 ? 3 : null)
const proofAsk = makeRegularAsk(easy[0], ctx({ todayEpochDay: NEXT - 1, sessions: [] }), NEXT, weekOf)
assert(JSON.stringify(proofAsk!.proof) === JSON.stringify([{ label: 'WK 2', value: '✓' }, { label: 'WK 3', value: '✓' }, { label: 'NOT SORE', value: '' }]), `proof tiles as page 36: ${JSON.stringify(proofAsk!.proof)}`)
assert(JSON.stringify(makeRegularProof({ weeks: 2, mondays: [MON, MON + 7], notSore: false })) === JSON.stringify([{ label: '2 WEEKS', value: '✓' }]), 'no week numbers: one short tile')
assert(proofAsk!.why === "You've added it two weeks running and it went well.", `why in the page-36 words: ${proofAsk!.why}`)
assert(free!.options[0].detail === "Where you've been putting it", 'usual slot sub-line as page 36')
assert(free!.options.find(o => o.id === 'another_day')!.detail === 'Pick from the safe days', 'ANOTHER DAY sub-line as page 36')
assert(free!.options.find(o => o.id === 'keep_extra')!.detail === 'Not in the plan. Still counts when you add it', "I'LL ADD IT MYSELF sub-line as page 36")
assert(free != null && free.options[0].id === 'usual' && free.options[0].kind === 'make_regular' && free.options[0].title === 'WEDNESDAYS', 'free week: WEDNESDAYS, its usual slot')
const another = free!.options.find(o => o.id === 'another_day')
assert(another != null && another.kind === 'make_regular' && another.id === 'another_day' && another.safeSlots.length >= 3, 'ANOTHER DAY lists the safe days')
assert(free!.expiresOnDay === NEXT + 7 && !free!.question.includes('!'), 'lapses after next week, house voice')
const blocked = makeRegularAsk(two[0], ctx({ todayEpochDay: NEXT - 1, sessions: [], injury: { region: 'shoulder', reason: 'Shoulder flagged.' } }), NEXT)
assert(blocked === null, 'no safe slot (injury flag on bag work): no ask')

console.log('makeRegular tests passed')
