// Run: tsx src/lib/coach/bagConditioning.test.ts
// Bag Conditioning (page 93): ten sourced workouts on the interval timer, no
// jumps, his switches, one knob at a time, the coach's pick, the per-block log,
// and the kicks shared with the finisher.
import assert from 'node:assert/strict'

import {
  HARD_EFFORT,
  MAX_STEP,
  MOVES,
  SESSION_CAP_MIN,
  TEMPLATES,
  blockResults,
  blocksWords,
  buildPlan,
  condEnded,
  condJumped,
  condRanTo,
  conditioningCues,
  conditioningLevel,
  conditioningParts,
  doneBlockLines,
  finalConditioningLog,
  loggedKicks,
  moveFor,
  movesLine,
  newConditioningLog,
  nextMove,
  nextStep,
  parseConditioning,
  parseConditioningLog,
  pickConditioning,
  planFromContext,
  planKicks,
  planMinutes,
  templateById,
  workoutLine,
  type MoveKey,
} from './bagConditioning'
import { kicksLeft, weekStartDay, WEEKLY_KICKS } from './kickBudget'

const ON = new Set(['boxing', 'kicks', 'defensive'])
const set = (s: string) => new Set(s.split(',').filter(Boolean))

// ─── the ten workouts, as page 93 lists them ──
{
  assert.equal(TEMPLATES.length, 10)
  assert.deepEqual(TEMPLATES.map(t => t.name), ['Steady Rounds', 'Kick Minutes', 'Bag and Floor 30/30', 'Fighter Hour', 'Bag EMOM', 'Sprint Punches and Kicks', 'Bells and Bag', 'Red Zone Circuit', 'Power Waves', 'Camp Finish'])
  const hard = TEMPLATES.filter(t => t.effort >= HARD_EFFORT).map(t => t.id)
  assert.deepEqual(hard, ['bag_floor_30', 'fighter_hour', 'bag_emom', 'bells_bag', 'red_zone', 'power_waves', 'camp_finish'], 'moderate: Steady Rounds, Kick Minutes, Sprint Punches')
  for (const t of TEMPLATES) {
    assert.ok(t.source.length > 20, `${t.id}: sourced`)
    const p = buildPlan(t, { switches: ON })
    assert.ok(planMinutes(p) <= SESSION_CAP_MIN, `${t.id}: 60 min or less`)
    assert.equal(p.blocks[0].name, 'WARM-UP')
    assert.equal(p.blocks[p.blocks.length - 1].name, 'COOL-DOWN')
    // no jumps anywhere: squat jumps and burpees are swapped (round 2)
    for (const x of p.parts) if (x.move) assert.doesNotMatch(MOVES[x.move].name, /JUMP(?!.*NO)|^BURPEES$|^SPRAWLS$/, `${t.id}: ${MOVES[x.move].name}`)
  }
  assert.ok(Object.values(MOVES).every(m => !/SQUAT JUMP|JUMPING/.test(m.name)))
  // the squat-then-kick drill is in it (squat, stand, kick)
  assert.ok(buildPlan(templateById('kick_minutes')!, { switches: ON }).parts.some(x => x.move === 'squat_stand_kick'))
  // steady rounds: 5 slow squats in the rests after rounds 3 and 5
  const steady = buildPlan(templateById('steady_rounds')!, { switches: ON })
  assert.equal(steady.parts.filter(x => x.task === '5 SLOW SQUATS FIRST').length, 2)
  assert.equal(workoutLine(steady), 'Steady Rounds · 6 rounds')
  assert.equal(movesLine(buildPlan(templateById('kick_minutes')!, { switches: ON })), 'body kicks, switch kicks, teeps')
}

// ─── his switches ──
{
  assert.equal(moveFor('body_kicks_right', set('boxing,defensive')), 'straight_punches', 'KICKS off: hands')
  assert.equal(moveFor('body_kicks_right', set('defensive')), 'teeps_switch')
  assert.equal(moveFor('body_kicks_right', set('')), 'squats')
  assert.equal(moveFor('fast_punches', set('kicks,defensive')), 'shadow', 'hands off: shadow, never the bag')
  assert.equal(moveFor('knees_bag', ON), null, 'KNEES off: the knee part is left out')
  assert.equal(moveFor('knees_bag', set('boxing,kicks,defensive,knees')), 'knees_bag')
  assert.equal(moveFor('push_ups', set('')), 'push_ups', 'bodyweight is always on')
  // Kick Minutes with KICKS off: kick-only blocks drop, the plan still runs
  const noKicks = buildPlan(templateById('kick_minutes')!, { switches: set('boxing,defensive') })
  assert.ok(noKicks.parts.every(x => !x.move || MOVES[x.move].groups.every(g => g !== 'kicks')), 'no kick left')
  assert.ok(noKicks.rounds >= 1)
  // Bag and Floor block C: the knee part only with KNEES on
  const floor = (s: string) => buildPlan(templateById('bag_floor_30')!, { switches: set(s) }).parts.filter(x => x.move === 'knees_bag').length
  assert.equal(floor('boxing,kicks,defensive'), 0)
  assert.equal(floor('boxing,kicks,defensive,knees'), 1)
}

// ─── one knob at a time ──
{
  const t = templateById('kick_minutes')!
  const at = (step: number) => buildPlan(t, { switches: ON, step })
  assert.equal(at(1).rounds, at(0).rounds + 1, 'knob 1: one more block')
  const work = (step: number) => at(step).parts.filter(x => x.ph === 'work' && at(step).blocks[x.block].kind === 'main').map(x => x.sec)
  assert.ok(work(2).every((s, i) => s >= work(1)[i]) && work(2)[0] > work(1)[0], 'knob 2: longer work')
  const rest = (step: number) => at(step).parts.filter(x => x.ph === 'rest' && x.sec === 20).length
  assert.ok(rest(3) > rest(2), 'knob 3: shorter rest')
  const hard = (step: number) => at(step).parts.filter(x => x.effort === 'HARD').length
  assert.ok(hard(4) > hard(3), 'knob 4: more power')
  assert.equal(at(99).step, MAX_STEP)
  // never over the hour: Fighter Hour stops turning knobs before 60 min
  assert.ok(planMinutes(buildPlan(templateById('fighter_hour')!, { switches: ON, step: MAX_STEP })) <= SESSION_CAP_MIN)
  // the lighter week: a block off
  assert.equal(buildPlan(t, { switches: ON, lighterWeek: true }).rounds, at(0).rounds - 1)

  // up after two on-target sessions, down after one way over or a pain note
  const h = (step: number, effort: number | null, pain = false) => ({ templateId: 'kick_minutes', step, planned: 6, effort, pain })
  assert.equal(nextStep([], 'kick_minutes'), 0)
  assert.equal(nextStep([h(1, 6), h(1, 5)], 'kick_minutes'), 2, 'two at or under: up one')
  assert.equal(nextStep([h(1, 6), h(0, 5)], 'kick_minutes'), 1, 'the step just changed: hold')
  assert.equal(nextStep([h(1, 7), h(1, 5)], 'kick_minutes'), 1, 'one over: hold')
  assert.equal(nextStep([h(2, 8), h(2, 6)], 'kick_minutes'), 1, 'way over: down one')
  assert.equal(nextStep([h(2, 5, true), h(2, 5)], 'kick_minutes'), 1, 'a pain note: down one')
  assert.equal(nextStep([h(2, null), h(2, 5)], 'kick_minutes'), 2, 'no effort given: hold')
}

// ─── the coach's pick (the planner's function) ──
{
  assert.equal(conditioningLevel(0), 1)
  assert.equal(conditioningLevel(3), 2)
  assert.equal(conditioningLevel(8), 3)
  const base = { level: 1 as const, readiness: 'ok' as const, switches: ON }
  const first = pickConditioning(base)
  assert.ok(first.template.levels.includes(1))
  assert.equal(first.minutes, planMinutes(first.plan))
  assert.equal(first.hard, first.template.effort >= 7)
  // variety: not the same one again
  assert.notEqual(pickConditioning({ ...base, lastTemplateId: first.template.id }).template.id, first.template.id)
  // a rough morning: the steady version
  const low = pickConditioning({ ...base, level: 3, readiness: 'low' })
  assert.equal(low.template.id, 'steady_rounds')
  assert.equal(low.hard, false)
  // no hard day fits: only moderate ones
  for (let i = 0; i < 4; i++) assert.equal(pickConditioning({ level: 2, readiness: 'ok', switches: ON, hardAllowed: false, lastTemplateId: TEMPLATES[i].id }).hard, false)
  // a short day: one that fits the minutes
  const short = pickConditioning({ level: 2, readiness: 'ok', switches: ON, freeMin: 25 })
  assert.ok(short.minutes <= 25, `${short.template.id} ${short.minutes}`)
  // a lift day: no dumbbells
  for (const last of TEMPLATES.map(t => t.id)) assert.notEqual(pickConditioning({ level: 3, readiness: 'ok', switches: ON, liftDay: true, lastTemplateId: last }).template.id, 'bells_bag')
  // the week's kicks spent: the plan's kicks fit what's left, or it runs with hands instead
  const spent = pickConditioning({ ...base, kicksLeft: { right: 0, left: 0 } })
  assert.deepEqual(planKicks(spent.plan), { right: 0, left: 0 })
  // his step from history shapes it
  const stepped = pickConditioning({ ...base, lastTemplateId: 'steady_rounds', history: [{ templateId: 'kick_minutes', step: 1, planned: 6, effort: 5 }, { templateId: 'kick_minutes', step: 1, planned: 6, effort: 6 }] })
  if (stepped.template.id === 'kick_minutes') assert.equal(stepped.plan.step, 2)
}

// ─── running it and the log ──
{
  const plan = buildPlan(templateById('kick_minutes')!, { switches: ON })
  const parts = conditioningParts(plan)
  assert.equal(parts[0].ph, 'ready')
  assert.equal(parts.length, plan.parts.length + 1)
  assert.equal(nextMove(plan, -1), 'rope_or_jog', 'GET READY shows the first move')
  const firstRest = plan.parts.findIndex(x => x.ph === 'rest')
  assert.equal(nextMove(plan, firstRest), plan.parts[firstRest + 1].move as MoveKey, 'a rest shows what is next')

  let log = newConditioningLog(plan)
  // the warm-up ran out (timer parts 1-3 are its three parts)
  log = condRanTo(log, parts, 4)
  // swipe up past round 1's first move
  log = condJumped(log, parts, 4, 5, true)
  // held through in round 2
  const r2 = parts.findIndex(p => p.round > 0 && plan.parts[p.round - 1].block === 2)
  log = condRanTo(log, parts, r2)
  log = condEnded(log, parts, r2)
  const res = blockResults(plan, finalConditioningLog(log))
  assert.deepEqual(res.map(r => [r.name, r.status]), [['WARM-UP', 'done'], ['ROUND 1', 'cut'], ['ROUND 2', 'skipped'], ['ROUND 3', 'skipped'], ['COOL-DOWN', 'skipped']])
  assert.equal(res[1].secDone, 120, 'cut short: the seconds done')
  const kicks = loggedKicks(plan, log)
  assert.deepEqual(kicks, { right: 0, left: 16 }, 'only the done kick parts count')

  // stored, read back
  assert.deepEqual(parseConditioning({ templateId: 'kick_minutes', step: 9, switches: ['boxing'] }), { templateId: 'kick_minutes', step: MAX_STEP, switches: ['boxing'], lighterWeek: false })
  assert.equal(parseConditioning({ templateId: 'made_up' }), null)
  assert.equal(parseConditioningLog({ parts: ['done'] }, 3), null)
  assert.deepEqual(parseConditioningLog({ parts: ['done', 'x', null], at: 2 }, 3), { parts: ['done', null, null], ended: false, at: 2 })
}

// ─── one weekly kick budget ──
{
  assert.equal(weekStartDay(20391), 20388, 'a Thursday to its Monday')
  assert.equal(weekStartDay(20388), 20388)
  assert.deepEqual(kicksLeft(1, [{ right: 40, left: 20 }, { right: 100, left: 20 }]), { right: 0, left: WEEKLY_KICKS[1] - 40 })
}

// ─── the words on Today, Poppy's clips, the row's plan ──
{
  assert.equal(blocksWords(['WARM-UP', 'ROUND 1', 'ROUND 2']), 'warm-up, rounds 1–2')
  assert.equal(blocksWords(['ROUND 3', 'COOL-DOWN']), 'round 3, cool-down')
  assert.equal(blocksWords(['ROUND 1', 'ROUND 3']), 'round 1, round 3')
  assert.deepEqual(doneBlockLines([
    { name: 'WARM-UP', kind: 'warmup', status: 'done', secDone: 480, secPlanned: 480 },
    { name: 'ROUND 1', kind: 'main', status: 'done', secDone: 180, secPlanned: 180 },
    { name: 'ROUND 2', kind: 'main', status: 'done', secDone: 180, secPlanned: 180 },
    { name: 'ROUND 3', kind: 'main', status: 'cut', secDone: 60, secPlanned: 180 },
    { name: 'COOL-DOWN', kind: 'cooldown', status: 'skipped', secDone: 0, secPlanned: 240 },
  ]), [{ label: 'BLOCKS', value: 'warm-up, rounds 1–2', tick: true }, { label: 'SHORT', value: 'round 3 · cool-down skipped' }], 'page 93: the done row')

  const plan = buildPlan(templateById('kick_minutes')!, { switches: ON })
  const cues = conditioningCues(plan, conditioningParts(plan))
  const voice = cues.filter(c => c.kind === 'change').map(c => c.clips[1]).filter(Boolean)
  assert.deepEqual(voice, ['t_get_ready', 't_round_1', 't_rest', 't_round_2', 't_rest', 't_last_round'], 'Poppy only where her clips exist; the change chime first')
  assert.ok(cues.every(c => c.clips.every(k => /^(t_|chime_)/.test(k))))
  assert.deepEqual(cues[cues.length - 1].clips, ['chime_done', 't_done'])

  // a row before it starts: the week planner's pick; once started, what the session keeps
  assert.equal(planFromContext(null), null)
  assert.equal(planFromContext(JSON.stringify({ conditioningPick: { templateId: 'bag_emom' } }))?.templateId, 'bag_emom')
  const kept = planFromContext(JSON.stringify({ conditioningPick: { templateId: 'bag_emom' }, conditioning: { templateId: 'kick_minutes', step: 1, switches: ['boxing', 'kicks', 'defensive'] } }))
  assert.equal(kept?.templateId, 'kick_minutes')
  assert.equal(kept?.step, 1)
}

console.log('bagConditioning tests passed')
