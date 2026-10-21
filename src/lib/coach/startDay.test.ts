// Run: tsx src/lib/coach/startDay.test.ts
// Page 64 (approved 2026-10-20): the START WHEN? board's seven tiles and its
// plain line, the waiting board's flaps and line, and the start day's one line.
import { isoToEpochDay } from '../dates'
import {
  countdownFlap,
  dayOneLine,
  isChoosableStart,
  isPendingStart,
  startDayOf,
  startHasLeadIn,
  startPreviewLabel,
  startLine,
  startMeaning,
  startTiles,
  startsFlap,
  waitLine,
} from './startDay'
import { startedAtForLocalDay } from './leadIn'
import { assert } from './testUtil'

const TUE = isoToEpochDay('2026-10-20')
const line = (d: number, today = TUE) => { const l = startLine(d, today); return `${l.lead}${l.day}${l.rest}` }

// ─── the tiles ───────────────────────────────────────────────
const tiles = startTiles(TUE)
assert(tiles.length === 7, 'seven day tiles')
assert(tiles.map(t => t.key).join(' ') === 'TODAY TOMORROW THU FRI SAT SUN MON', 'TODAY, TOMORROW, then THU..MON')
assert(tiles.map(t => t.date).join('|') === 'Tue 20|Wed 21|22|23|24|25|26', 'dates: day and date on the first two, the date after')
assert(tiles[0].day === TUE && tiles[6].day === TUE + 6, 'today to six days on')

// ─── the plain line (the mockup's own words for Tue 20 Oct) ──
assert(line(TUE + 2) === 'Starts Thu. Week 1 starts that day.', 'Thu: week 1 that day (no lead-in)')
assert(line(TUE + 5) === 'Starts Sun. Week 1 starts that day.', 'Sun: week 1 that day')
assert(line(TUE + 6) === 'Starts Mon 26 Oct. Week 1 starts that day.', 'Mon: week 1 that day')
assert(startLine(TUE + 6, TUE).day === 'Mon 26 Oct', 'the bold part on a Monday is its date')
// Coach brain P2: no lead-in. Week 1 starts on the start day, whatever the weekday.
assert(line(TUE) === 'Starts today. Week 1 starts that day.', 'today (Tue): week 1 today')
assert(line(TUE + 1) === 'Starts Wed. Week 1 starts that day.', 'Wed: week 1 that day')
const MON = TUE - 1
assert(line(MON, MON) === 'Starts Mon 19 Oct. Week 1 starts that day.', 'a Monday today still reads its date')
assert(startMeaning(TUE + 6) === 'Week 1 starts that day.', 'meaning on a Monday')

// ─── the waiting board ───────────────────────────────────────
assert(startsFlap(TUE + 2) === 'STARTS THU', 'STARTS THU')
assert(countdownFlap(TUE + 2, TUE) === 'IN 2 DAYS', 'IN 2 DAYS')
assert(countdownFlap(TUE + 2, TUE + 1) === 'TOMORROW', 'then TOMORROW')
assert(waitLine(TUE + 2) === 'Week 1 starts that day.', 'the waiting line (page 64 2A)')
assert(waitLine(TUE + 6) === 'Week 1 starts that day.', 'the waiting line on a Monday start')

// ─── pending and choosable ───────────────────────────────────
assert(isChoosableStart(TUE, TUE) && isChoosableStart(TUE + 6, TUE), 'today to six days on can be chosen')
assert(!isChoosableStart(TUE - 1, TUE) && !isChoosableStart(TUE + 7, TUE) && !isChoosableStart(TUE + 0.5, TUE), 'not yesterday, not a week on, not half a day')
assert(isPendingStart(TUE + 1, TUE) && !isPendingStart(TUE, TUE) && !isPendingStart(null, TUE), 'pending only while the start is ahead')
assert(startDayOf(startedAtForLocalDay(TUE + 2)) === TUE + 2 && startDayOf(null) === null, 'the stored start (noon UTC) reads back as the local day')

// ─── the start day's morning ─────────────────────────────────
assert(JSON.stringify(dayOneLine(TUE + 2, TUE + 2, 2)) === JSON.stringify({ flap: 'BLOCK ZERO · DAY 1', line: 'Day 1. Light today: the coach learns you from here.' }), 'Thu: day 1')
assert(dayOneLine(TUE + 5, TUE + 5, 1)?.flap === 'BLOCK ZERO · DAY 1', 'Sun: day 1')
assert(dayOneLine(TUE + 6, TUE + 6, 2)?.line === 'Day 1. Light today: the coach learns you from here.', 'Mon: day 1, no fixed block length')
assert(dayOneLine(TUE + 2, TUE + 3, 2) === null && dayOneLine(null, TUE, 2) === null, 'gone from day 2 on')


// ─── the planned week under the waiting board ────────────────
assert(!startHasLeadIn(TUE + 1) && !startHasLeadIn(TUE + 5), 'no start leads in')
assert(!startHasLeadIn(TUE + 6), 'a Monday start is week 1 that day')
assert(startPreviewLabel(TUE + 1, TUE) === 'Tomorrow', 'a start tomorrow previews as Tomorrow')
assert(startPreviewLabel(TUE + 2, TUE) === 'Starts Thu', 'a later start previews by its day')

console.log('startDay: all ok')
