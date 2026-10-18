// Run: tsx src/lib/coach/adaptive.test.ts
// The adaptive coach's other rules: the training max proposal, the weekly
// pass (eases with reasons, why line, idempotency) and the morning summary.
import { fighterTmDecision, tmAcceptValues, tmProposal, type BlockWorkingSet } from './tm'
import { claimDecision, easeDetail, placePlannedWeek, type PlannedEntry, houseLine, STALE_CLAIM_SEC, weekRuleEases, weeklyPassKey, weeklyPassTarget, whyThisWeek, type WeekSignals } from './weeklyPass'
import { buildCoachSummary, easeBody, morningLine } from './summary'
import { summarizeEffort } from './feltHard'
import { MON, assert, ctx, s } from './testUtil'
import { analyzeWeek, previousAnalysisFrom } from '../weekAnalysis'

const houseVoice = (t: string) => !t.includes('!') && !t.includes('—')

// ─── Training max proposal ───────────────────────────────────

const clean = (week: number, w: number): BlockWorkingSet => ({ week, weightKg: w, reps: 5, plannedWeightKg: w, plannedReps: 5 })
const squat = fighterTmDecision({ exerciseId: 'sq', currentTmKg: 140, region: 'lower', sets: [1, 1, 2, 2, 5, 5, 6, 6].map((wk, i) => clean(wk, i < 4 ? 100 : 112)) })
const bench = fighterTmDecision({ exerciseId: 'bp', currentTmKg: 90, region: 'upper', sets: [clean(1, 70), clean(2, 70)] })
assert(squat.action === 'progress' && bench.action === 'hold', 'rules: squat moves, bench holds (too few sets)')
const names = new Map([['sq', 'Squat'], ['bp', 'Bench']])
const proposal = tmProposal([squat, bench], names)
assert(proposal != null && proposal.lifts.length === 1 && proposal.lifts[0].currentKg === 140 && proposal.lifts[0].proposedKg === squat.newTmKg, 'proposal: old -> new per lift')
assert(proposal!.lifts[0].minKg === 140 && proposal!.lifts[0].maxKg === squat.newTmKg, 'bounds: never below the current max, never above the rule')
assert(proposal!.holds.length === 1 && proposal!.holds[0].name === 'Bench', 'held lifts listed with why')
assert(proposal!.decline.title === 'KEEP THE OLD ONES' && houseVoice(proposal!.question), 'decline keeps the old ones; question in house voice')
assert(tmProposal([bench], names) === null, 'nothing moved: no proposal')
const writes = tmAcceptValues(proposal!.lifts, { sq: 200 })
assert(writes[0].weightKg === squat.newTmKg && writes[0].clamped, 'an adjusted value above the rule is clamped')
assert(tmAcceptValues(proposal!.lifts, { sq: 141.13 })[0].weightKg === 141.13, 'a value inside the bounds is kept')
assert(tmAcceptValues(proposal!.lifts, { sq: 100 })[0].weightKg === 140, 'below the current max: clamped to it')
assert(tmAcceptValues(proposal!.lifts, null)[0].weightKg === squat.newTmKg, 'plain approve takes the proposal')

// ─── Weekly pass: eases with reasons, why line ───────────────

const base: WeekSignals = {
  weekNumber: 4, totalWeeks: 12, blockType: 'fighter',
  lastWeek: { planned: 10, completed: 9, missed: 1, skipped: 0, added: 0 },
  completionRate: 0.9,
  load: { last7: 2400, prev7: 2300, changePct: 4, flagged: false },
  readiness: { days: 7, flaggedDays: 0, easeDays: 0, freshDays: 1, oversleepFatigueDays: 0 },
  effort: summarizeEffort([{ epochDay: MON - 3, type: 'strength', rpe: 7 }]),
  avgSoreness: 2.2, avgSleep: 7.4,
  returnRamp: { active: false, gapDays: 0, reason: null },
  retestLastWeek: false, waveEnd: false, athleteShape: null,
}
const week = [s('foundation_run', MON, { label: 'Zone 2' }), s('mt_class', MON, { timeSlot: 'pm' }), s('strength', MON + 1), s('strength', MON + 3), s('bag_work', MON + 5)]
assert(weekRuleEases(base, week).length === 0, 'good week: nothing eases')
const good = whyThisWeek(base, [])
assert(good.startsWith('9 of 10 done, check-ins on trend.') && houseVoice(good), `why line: ${good}`)

const tired: WeekSignals = { ...base, readiness: { ...base.readiness, flaggedDays: 3, easeDays: 2 }, avgSoreness: 3.8 }
const eases = weekRuleEases(tired, week)
assert(eases.length === 2 && week[eases[0].index].type === 'strength' && week[eases[1].index].type === 'strength', 'two causes: the two strength days ease first')
assert(eases.every(e => e.kind === 'reduce' && houseVoice(e.reason) && e.was && e.now), 'each ease has a reason and a was/now')
assert(eases[0].reason.startsWith('Check-ins were off your trend on 2 days.'), `reason names the cause: ${eases[0].reason}`)
const why = whyThisWeek(tired, eases)
assert(why.includes('2 sessions ease') && why.length <= 160, `why line counts the eases: ${why}`)
const spiky = weekRuleEases({ ...base, load: { last7: 3200, prev7: 2300, changePct: 39, flagged: true }, avgSoreness: 4, effort: summarizeEffort([{ epochDay: 1, type: 'strength', rpe: 9 }, { epochDay: 2, type: 'strength', rpe: 10 }]) }, week)
assert(spiky.length === 2, 'never more than two eases a week')
assert(weekRuleEases({ ...tired, returnRamp: { active: true, gapDays: 12, reason: 'Back after 12 days.' } }, week).length === 0, 'after a gap the return ramp does the easing')
assert(whyThisWeek({ ...tired, returnRamp: { active: true, gapDays: 12, reason: 'Back after 12 days. Loads at 90%.' } }, []) === 'Back after 12 days. Loads at 90%.', 'gap: the why line is the return ramp')
const low = weekRuleEases({ ...base, lastWeek: { planned: 10, completed: 3, missed: 7, skipped: 0, added: 0 }, completionRate: 0.3 }, week)
assert(low.length === 1 && low[0].reason.includes('Nothing is made up'), 'low completion eases, never makes up')
assert(whyThisWeek({ ...base, waveEnd: true }, []).includes('training maxes'), 'wave end: the why line mentions the max review')
assert(whyThisWeek({ ...base, lastWeek: { ...base.lastWeek, added: 2 } }, []).includes('2 added sessions counted'), 'added sessions count toward the week')
assert(easeDetail('reduce', { type: 'strength' }).now === 'One set less, load 10% lower', 'ease detail in plain words')
assert(houseLine('Big week — huge!! Keep going.') === 'Big week, huge. Keep going.', 'house voice: no em dash, no exclamation')

// Idempotency per block and calendar week.
const SUN = MON + 6
assert(weeklyPassTarget(SUN) === MON + 7, 'Sunday prepares next week')
assert(weeklyPassTarget(MON) === MON, 'Monday catches up this week')
assert(weeklyPassTarget(MON + 2) === null, 'midweek: no pass')
assert(weeklyPassKey('b1', MON + 7) === `b1:${MON + 7}`, 'one key per block and Monday')
assert(weeklyPassKey('b1', weeklyPassTarget(SUN) as number) === weeklyPassKey('b1', weeklyPassTarget(MON + 7) as number), 'Sunday run and Monday catch-up share the key: one pass')
assert(claimDecision(null, 100) === 'insert', 'no pass yet: claim it')
assert(claimDecision({ status: 'done', createdAt: 0 }, 10 ** 9) === 'skip', 'done: never again')
assert(claimDecision({ status: 'running', createdAt: 100 }, 100 + 60) === 'skip', 'a fresh claim: skip (cron and app racing)')
assert(claimDecision({ status: 'running', createdAt: 100 }, 100 + STALE_CLAIM_SEC + 1) === 'takeover', 'a stale claim: take over')
assert(claimDecision({ status: 'failed', createdAt: 100 }, 100 + STALE_CLAIM_SEC + 1) === 'takeover', 'a failed pass is retried later')

// E1 placement on the planner's week: the template's own sessions stay, changes must pass.
const pe = (type: string, day: number, slot: 'am' | 'pm' = 'am'): PlannedEntry => ({ type, label: null, notes: null, epochDay: day, timeSlot: slot, estimatedMin: null })
const tmpl = [pe('mt_class', MON, 'pm'), pe('strength', MON + 1)]
const aiWeek = [pe('mt_class', MON, 'pm'), pe('strength', MON + 1), pe('bag_work', MON, 'pm'), pe('strength', MON + 4)]
const placed = placePlannedWeek(aiWeek, tmpl, ctx({ todayEpochDay: MON - 1 }), MON)
assert(placed.accepted.some(p => p.type === 'strength' && p.epochDay === MON + 1), 'template strength after a class stays (the rules week)')
assert(placed.dropped.length === 1 && placed.dropped[0].entry.type === 'bag_work' && placed.dropped[0].code === 'stacked_hard', 'an added hard session on a class day is dropped with its reason')
assert(placed.accepted.some(p => p.epochDay === MON + 4 && p.type === 'strength'), 'a moved strength day that passes is kept')

// The old crash: an AI-shaped analysis read back as the previous week.
const aiShaped = { narrative: 'Week 3.', days: [], mtSessionsThisWeek: 2, adjustmentNotes: 'Lighter.' }
assert(previousAnalysisFrom(aiShaped) === null && previousAnalysisFrom('x') === null, 'an AI week plan reads as no history (no deficits.map crash)')
let threw = false
try { analyzeWeek([], [], [], aiShaped as never) } catch { threw = true }
assert(!threw, 'analyzeWeek survives a malformed previous analysis')
const missed = [0, 1].map(i => ({ type: 'strength', status: 'missed', scheduledDate: MON + i, timeSlot: 'am', rpe: null, difficulty: null, notes: null }))
const wa = analyzeWeek(missed, [], [], null)
assert(!wa.recommendations.some(r => /make up/i.test(r.reason)) && !wa.recommendations.some(r => r.action === 'add'), 'missed work is never made up')
const wa2 = analyzeWeek(missed, [], [], previousAnalysisFrom(wa))
assert(wa2.recommendations.some(r => r.action === 'swap'), 'missed two weeks running: a swap note, not a make-up')

// ─── Morning summary ─────────────────────────────────────────

assert(morningLine(2, 1) === '2 changes, 1 question' && morningLine(1, 0) === '1 change' && morningLine(0, 3) === '3 questions' && morningLine(0, 0) === null, 'morning line wording')
const since = 1000
const now = 5000
const summary = buildCoachSummary([
  { id: 'a', adjustmentType: 'felt_hard', status: 'accepted', auto: 1, reason: 'Thu strength eases.', createdAt: 1500, expiresAt: null, sourceData: JSON.stringify({ was: 'Planned sets and load', lead: 'Strength C eased', body: ': one set less, load 10% lower. Soreness 4 the morning after Wed strength.' }) },
  { id: 'b', adjustmentType: 'reactive', status: 'accepted', auto: 0, reason: 'Hold.', createdAt: 1600, expiresAt: null },
  { id: 'c', adjustmentType: 'felt_hard', status: 'accepted', auto: 1, reason: 'Old.', createdAt: 500, expiresAt: null },
  { id: 'd', adjustmentType: 'ramp_up', status: 'proposed', auto: 0, reason: 'Push a little this week?', createdAt: 1700, expiresAt: 9000 },
  { id: 'e', adjustmentType: 'missed_session', status: 'proposed', auto: 0, reason: 'Tue run was missed.', createdAt: 800, expiresAt: 4000 },
  { id: 'f', adjustmentType: 'missed_session', status: 'accepted', auto: 0, reason: 'Answered.', createdAt: 1800, expiresAt: 9000 },
], [{ id: 'w', weekNumber: 5, whyLine: '9 of 10 done.', preparedAt: 2000 }, { id: 'w0', weekNumber: 4, whyLine: null, preparedAt: 10 }], since, now)
assert(summary.changes === 2 && summary.questions === 1, `counts: ${summary.changes} changes, ${summary.questions} questions`)
assert(summary.line === '2 changes, 1 question', 'line for the alarm')
assert(summary.changeLines.some(l => l.line === 'Week 5 is ready. 9 of 10 done.') && summary.changeLines.find(l => l.id === 'a')?.was === 'Planned sets and load', 'a prepared week and an auto change, with its "was"')
assert(summary.questionLines[0].id === 'd', 'only open, unexpired questions; questions listed first')
const eased = summary.changeLines.find(l => l.id === 'a')
assert(eased?.lead === 'Strength C eased' && eased.body?.startsWith(': one set less'), 'an ease carries its bold lead and the words after it (page 36 Coach board)')
assert(summary.changeLines.find(l => l.id === 'w')?.lead == null, 'lines without a lead stay plain')
assert(easeBody('One set less, load 10% lower', 'Soreness 4 the morning after Wed strength. Sat strength c eases.') === ': one set less, load 10% lower. Soreness 4 the morning after Wed strength.', 'ease body: what it is now, then the cause')

console.log('adaptive coach tests passed')
