// Run: tsx src/lib/coach/changes.test.ts
// The change model (page 56): restorable state, runes per day and per row,
// the words on the day's back and in the week log, and the one quiet line
// for the alarm and the finish card.
import {
  applyContext,
  changeLock,
  changesLine,
  clockOf,
  dayRune,
  logDayLabel,
  logStatus,
  pickContext,
  readChangeRow,
  renderWhy,
  rowRune,
  slotStart,
  untilLine,
  whenLine,
  whoWord,
  writtenKeys,
  type ChangeRowLike,
} from './changes'
import { finishLine, morningLine, type LineChange } from './summary'
import { MON, assert } from './testUtil'

const WED = MON + 2
const SAT = MON + 5

function c(over: Partial<ChangeRowLike>): ChangeRowLike {
  return {
    id: 'c', changeSetId: 's', actor: 'coach', kind: 'ease', targetSessionId: 'b', sessionType: 'strength', why: '', detail: null,
    undoUntil: null, undoneAt: null, seenAt: null, held: false, createdAt: 1,
    before: { show: '3×8', day: WED, sessions: [] }, after: { show: '2×8', day: WED, sessions: [] }, ...over,
  }
}

// ─── Runes ──────────────────────────────────────────────────
assert(dayRune([c({})], WED) === 'new', 'a coach change: Dagaz, new until seen')
assert(dayRune([c({ seenAt: 5 })], WED) === 'seen', 'seen: dim')
assert(dayRune([c({ actor: 'you' })], WED) == null, 'his own change: no rune')
assert(dayRune([c({ undoneAt: 9 })], WED) == null, 'undone: no rune')
assert(dayRune([c({ kind: 'missed', seenAt: null })], WED) === 'miss' && dayRune([c({ kind: 'missed', seenAt: 3 })], WED) === 'missseen', 'missed: Nauthiz, new then seen')
assert(dayRune([c({ seenAt: 3 }), c({ id: 'd', kind: 'missed' })], WED) === 'miss', 'one rune per day: unseen first, missed before a change')
assert(dayRune([c({})], SAT) == null, 'a rune sits on its own day only')
assert(rowRune([c({ seenAt: 2 })], 'b') === 'seen' && rowRune([c({})], 'z') == null, 'the row carries its change\'s rune')

// ─── Lock: UNDO until the session starts ────────────────────
const touch = c({ before: { show: '', day: WED, sessions: [{ id: 'b', f: {} }] }, after: { show: '', day: WED, sessions: [{ id: 'b', f: {} }] } })
assert(changeLock(touch, new Map([['b', { id: 'b', status: 'planned', scheduledDate: WED }]]), WED) === 'open', 'planned, today: open')
assert(changeLock(touch, new Map([['b', { id: 'b', status: 'in_progress', scheduledDate: WED }]]), WED) === 'started', 'under way: started')
assert(changeLock(touch, new Map([['b', { id: 'b', status: 'completed', scheduledDate: WED }]]), WED) === 'done', 'logged: done')
assert(logStatus('open') === 'undo' && logStatus('undone') === 'put back' && logStatus('started') === 'started', 'the log\'s right side')

// ─── Words ──────────────────────────────────────────────────
assert(renderWhy('Bag work {d:' + (WED - 1) + '} on a rough day.', WED) === 'Bag work yesterday on a rough day.', 'a day token reads against the reader\'s day')
assert(renderWhy('{n:' + SAT + ':Run-Walk} is 5 rounds again.', MON + 3) === "Saturday's run-walk is 5 rounds again.", 'a name token on another day')
assert(renderWhy('{n:' + WED + ':Strength B} is 3×8 again.', WED) === 'Strength B is 3×8 again.', 'a name token on its own day')
assert(renderWhy('A. [[Only here. ]]B.', WED, 'log') === 'A. B.' && renderWhy('A. [[Only here. ]]B.', WED) === 'A. Only here. B.', 'back-only words leave the log')
assert(clockOf(slotStart(WED, 'am')) === '7:00 AM' && clockOf(slotStart(WED, 'pm', '18:30')) === '6:30 PM', 'slot starts')
assert(untilLine(slotStart(WED, 'am'), WED) === 'Until it starts, 7:00 AM', 'until, same day')
assert(untilLine(slotStart(SAT, 'am'), MON + 3) === 'Until it starts, Sat 7:00 AM', 'until, another day')
assert(untilLine(null, SAT, { day: MON + 7, name: 'Strength A' }) === "Until Monday's A starts", 'until, a missed session\'s fix')
assert(whenLine(MON * 86400 + 18 * 3600 + 11 * 60 + 86400, WED) === 'TUE 6:11 PM' && whenLine((MON + 1) * 86400 + 18 * 3600 + 600, MON + 1) === '6:10 PM', 'who line times')
assert(logDayLabel(MON + 1) === `TUE ${new Date((MON + 1) * 86400000).getUTCDate()}`, 'log day heading')
assert(whoWord({ actor: 'you', kind: 'swap' }) === 'YOU' && whoWord({ actor: 'coach', kind: 'missed' }) === 'MISSED' && whoWord({ actor: 'weekly_pass', kind: 'ease' }) === 'COACH', 'who')
assert(changesLine(5) === '5 changes ›' && changesLine(1) === '1 change ›' && changesLine(0) == null, 'the quiet line under the week')

// ─── Restorable state ───────────────────────────────────────
const ctxJson = applyContext(JSON.stringify({ blockZero: 1, coachEase: { kind: 'x' } }), { coachEase: null, mergedLifts: { a: 1 } })
assert(ctxJson != null && !('coachEase' in JSON.parse(ctxJson)) && JSON.parse(ctxJson).mergedLifts.a === 1 && JSON.parse(ctxJson).blockZero === 1, 'context keys set and cleared, the rest kept')
assert(JSON.stringify(pickContext(ctxJson, ['mergedLifts', 'coachEase'])) === JSON.stringify({ mergedLifts: { a: 1 }, coachEase: null }), 'context keys read back')
const keys = writtenKeys({ before: { show: '', day: 1, sessions: [{ id: 'x', f: { status: 'planned', notes: 'a' } }] }, after: { show: '', day: 1, sessions: [{ id: 'x', f: { status: 'skipped', notes: 'a' } }], created: ['y'] } })
assert(keys.has('f.status@x') && !keys.has('f.notes@x') && keys.has('*@y'), 'written keys: only what changed')
const legacy = readChangeRow({ id: 'l', changeSetId: null, actor: null, kind: null, targetSessionId: null, sessionType: 'strength', beforeJson: null, afterJson: null, why: null, reason: 'old', detail: null, undoUntil: null, undoneAt: null, seenAt: null, held: 0, createdAt: 1 })
assert(legacy == null, 'a legacy row (no kind) is not a change record')

// ─── One quiet line ─────────────────────────────────────────
const line = (over: Partial<LineChange>): LineChange => ({ actor: 'coach', kind: 'ease', undoneAt: null, seenAt: null, createdAt: 10, open: true, name: 'Strength B', day: WED, after: { show: '2×8', day: WED, sessions: [] }, ...over })
assert(morningLine([line({})], WED) === 'Strength B is 2×8 today. Tap to see.', 'the alarm names the change')
assert(morningLine([line({ seenAt: 5 })], WED) == null && morningLine([line({ actor: 'you' })], WED) == null, 'nothing new, no line')
assert(finishLine([line({ name: 'Run-Walk', day: SAT, after: { show: '4 ROUNDS', day: SAT, sessions: [] } })], MON + 3) === "Saturday's run-walk: 4 rounds. Tap to see.", 'the finish card names what moved')

console.log('changes tests passed')
