// Run: tsx src/lib/coach/undo.test.ts
// UNDO (page 56 items 8-10): one tap until the session starts; a coach change
// undone holds the session; his own change comes back with what the coach
// did because of it; a later change on the same field comes back too; done
// is done.
import type { ChangeRowLike, SessionNow } from './changes'
import { heldSessionIds, planUndo } from './undo'
import { MON, assert } from './testUtil'

const TUE = MON + 1
const WED = MON + 2

function row(over: Partial<ChangeRowLike> & Pick<ChangeRowLike, 'id' | 'actor' | 'kind' | 'before' | 'after'>): ChangeRowLike {
  return { changeSetId: 'set-1', targetSessionId: null, sessionType: 'strength', why: '', detail: null, undoUntil: null, undoneAt: null, seenAt: null, held: false, createdAt: 100, ...over }
}

// His swap: Tuesday's run-walk -> bag. The coach's ease of Wednesday's B in the same set.
const swap = row({
  id: 'swap', actor: 'you', kind: 'swap', targetSessionId: 'run', createdAt: 100,
  before: { show: 'RUN-WALK', day: TUE, sessions: [{ id: 'run', f: { status: 'planned', notes: null } }] },
  after: { show: 'BAG WORK', day: TUE, sessions: [{ id: 'run', f: { status: 'skipped', notes: 'Replaced: rough day' } }], created: ['bag'] },
})
const ease = row({
  id: 'ease', actor: 'coach', kind: 'ease', targetSessionId: 'b', createdAt: 101,
  before: { show: '3×8', day: WED, sessions: [{ id: 'b', f: {}, ctx: { coachEase: null } }] },
  after: { show: '2×8', day: WED, sessions: [{ id: 'b', f: {}, ctx: { coachEase: { kind: 'one_set', reason: 'x', source: 'rebalance', at: 1 } } }] },
})
const sessions = (over: Record<string, Partial<SessionNow>> = {}) => new Map<string, SessionNow>([
  ['run', { id: 'run', status: 'skipped', scheduledDate: TUE, ...over.run }],
  ['bag', { id: 'bag', status: 'planned', scheduledDate: TUE, ...over.bag }],
  ['b', { id: 'b', status: 'planned', scheduledDate: WED, ...over.b }],
])

// Undo a coach change: only its own context key comes back, and the session is held.
const u1 = planUndo(ease, [swap, ease], sessions(), WED)
assert(u1.ok && u1.steps.length === 1 && u1.steps[0].changeId === 'ease', 'coach ease: one step')
if (u1.ok) {
  assert(u1.steps[0].hold, 'undoing a coach change holds the session')
  assert(JSON.stringify(u1.steps[0].restore) === JSON.stringify([{ id: 'b', f: {}, ctx: { coachEase: null } }]), 'the ease key comes off, nothing else')
}
assert(heldSessionIds([{ ...ease, held: true }]).has('b'), 'a held change holds its session')

// Undo his own swap: the coach's ease from the same set comes back first, then his swap.
const u2 = planUndo(swap, [swap, ease], sessions(), TUE)
assert(u2.ok && u2.steps.map(s => s.changeId).join() === 'ease,swap', 'his swap: the coach change it caused first, then his')
if (u2.ok) {
  const s = u2.steps[1]
  assert(!s.hold && s.remove.join() === 'bag' && s.restore[0].f.status === 'planned' && s.restore[0].f.notes === null, 'the run-walk is planned again and the bag goes')
  assert(!u2.steps[0].hold, 'a coach change undone with his own is not held')
}

// Done is done: the bag was done, so his swap stays; Wednesday's B started, so its ease stays.
const done = planUndo(swap, [swap, ease], sessions({ bag: { status: 'completed' } }), TUE)
assert(!done.ok && done.lock === 'done', 'a done session locks its change')
const started = planUndo(ease, [swap, ease], sessions({ b: { status: 'in_progress' } }), WED)
assert(!started.ok && started.lock === 'started', 'UNDO lasts until the session starts')
const passed = planUndo(ease, [swap, ease], sessions(), WED + 1)
assert(!passed.ok && passed.lock === 'passed', 'a passed day can\'t be undone')
const again = planUndo({ ...ease, undoneAt: 5 }, [swap, ease], sessions(), WED)
assert(!again.ok && again.lock === 'undone', 'an undone change can\'t be undone again')

// A later change on the same field: both come back (UNDO BOTH, §4.4).
const move1 = row({
  id: 'm1', actor: 'coach', kind: 'move', createdAt: 200, changeSetId: 'set-2',
  before: { show: 'TUE AM', day: TUE, sessions: [{ id: 'x', f: { scheduledDate: TUE, timeSlot: 'am' } }] },
  after: { show: 'WED PM', day: WED, sessions: [{ id: 'x', f: { scheduledDate: WED, timeSlot: 'pm' } }] },
})
const move2 = row({
  id: 'm2', actor: 'coach', kind: 'move', createdAt: 300, changeSetId: 'set-3',
  before: { show: 'WED PM', day: WED, sessions: [{ id: 'x', f: { scheduledDate: WED, timeSlot: 'pm' } }] },
  after: { show: 'THU PM', day: WED + 1, sessions: [{ id: 'x', f: { scheduledDate: WED + 1, timeSlot: 'pm' } }] },
})
const xs = new Map<string, SessionNow>([['x', { id: 'x', status: 'planned', scheduledDate: WED + 1 }]])
const both = planUndo(move1, [move1, move2], xs, TUE)
assert(both.ok && both.steps.map(s => s.changeId).join() === 'm2,m1', 'undoing the first move undoes the later one first')
if (both.ok) assert(both.steps[1].restore[0].f.scheduledDate === TUE && both.steps[1].restore[0].f.timeSlot === 'am', 'back to Tuesday AM')

// A later change on other fields stays.
const other = row({
  id: 'o', actor: 'coach', kind: 'ease', createdAt: 250, changeSetId: 'set-4',
  before: { show: '', day: WED, sessions: [{ id: 'x', f: {}, ctx: { coachEase: null } }] },
  after: { show: '', day: WED, sessions: [{ id: 'x', f: {}, ctx: { coachEase: { kind: 'reduce' } } }] },
})
const keep = planUndo(move1, [move1, other], xs, TUE)
assert(keep.ok && keep.steps.map(s => s.changeId).join() === 'm1', 'a later ease on the same session but other fields keeps its own UNDO')

// His add: undo removes the session he added.
const added = row({ id: 'add', actor: 'you', kind: 'add', changeSetId: 'set-5', before: { show: '', day: WED, sessions: [] }, after: { show: '+ SKIP ROPE', day: WED, sessions: [], created: ['rope'] } })
const ua = planUndo(added, [added], new Map([['rope', { id: 'rope', status: 'planned', scheduledDate: WED }]]), WED)
assert(ua.ok && ua.steps[0].remove.join() === 'rope' && !ua.steps[0].hold, 'undoing his add removes the session; no hold')

// Effects outside the sessions table come back as they were (a training max).
const tm = row({ id: 'tm', actor: 'coach', kind: 'tm', before: { show: '100', day: WED, sessions: [], effects: [{ kind: 'tm', lifts: [{ exerciseId: 'sq', kg: 100 }] }] }, after: { show: '105', day: WED, sessions: [], effects: [{ kind: 'tm', lifts: [{ exerciseId: 'sq', kg: 105 }] }] } })
const ut = planUndo(tm, [tm], new Map(), WED)
assert(ut.ok && ut.steps[0].effects[0].kind === 'tm' && ut.steps[0].effects[0].lifts[0].kg === 100, 'a new max comes back to the old one')

console.log('undo tests passed')
