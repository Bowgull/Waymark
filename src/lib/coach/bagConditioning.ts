// Bag Conditioning (page 93, approved 2026-10-25; research: bag-workouts.md):
// a separate session from Bag Work. Bag Work is skill (his combos, rated). Bag
// Conditioning is engine: strikes he already owns and bodyweight moves on the
// page 81 interval timer, one move big at a time. No combo ratings; it never
// moves his level.
//
// - Ten sourced workouts (templates), never made up. Each starts with the same
//   warm-up (rope or jog 4:00, joint and hip circles 2:00, one shadow round
//   2:00) and ends with a cool-down (slow shadow 2:00, breathe 2:00).
// - No jumps: squat jumps become squat, stand, kick; burpees and sprawls step
//   back (round 2).
// - His Settings switches apply: a move whose group is off is swapped for a
//   hand or bodyweight move (a knee-only part is left out); a block left with
//   no bag move of its own drops.
// - The coach picks from the list by his level, the day's minutes, whether a
//   hard day fits, his check-in and variety; then turns one knob at a time
//   (one more block, longer work, shorter rest, more power). Up after two
//   sessions in a row at or under the planned effort with no pain note; down
//   after one way over, or a pain note. The lighter week takes a block off.
// - Kicks share one weekly budget with the bag finisher (lib/coach/kickBudget).
// - Logged per block (done, skipped, cut short) and with the built effort card.
//
// Pure: the start route on the server writes the plan into context_json; the
// phone runs it with the interval timer's part maths; the coach's week planner
// calls pickConditioning (the plain function, documented below).

import { mmss, warnLen, type IntervalCue, type IntervalPart } from '../timers/intervalTimer'
import type { KickCount } from './kickBudget'

// ─── the moves ────────────────────────────────────────────────

export type MoveKey =
  | 'rope_or_jog' | 'joint_circles' | 'shadow' | 'slow_shadow' | 'breathe' | 'walk'
  | 'jab_teep' | 'jab_cross' | 'straight_punches' | 'fast_punches' | 'power_punches' | 'light_punches' | 'body_hooks' | 'power_combo' | 'free_rhythm' | 'rhythm_threes'
  | 'body_kicks_right' | 'switch_kicks' | 'double_kicks' | 'power_kicks' | 'check_kick' | 'squat_stand_kick' | 'jab_body_kick' | 'cross_switch_kick' | 'teep_body_kick'
  | 'teeps_switch' | 'teeps_left' | 'teeps_right' | 'balance_teep' | 'alt_teeps'
  | 'knees_bag'
  | 'shadow_jab_check' | 'shadow_jab_kick' | 'shadow_cross_switch'
  | 'push_ups' | 'squats' | 'slow_squats' | 'lunges' | 'mountain_climbers' | 'plank' | 'knee_to_elbow' | 'step_back_sprawls' | 'step_back_burpees' | 'run_on_spot'
  | 'goblet_squats' | 'push_press' | 'db_rows'

export interface Move {
  /** One move big on the screen ("BODY KICKS · RIGHT", "SQUAT › STAND › KICK"). */
  name: string
  /** The Settings groups it needs (none: bodyweight, always on). */
  groups: ReadonlyArray<string>
  /** Shin kicks a minute, per side (the week's kick budget). */
  kicks?: KickCount
  /** One short cue, shown the first 10 s (Fagan and the kru report). */
  cue?: string
  /** Left out (not swapped) when its group is off. */
  dropWhenOff?: boolean
}

const K = (right: number, left: number): KickCount => ({ right, left })

export const MOVES: Readonly<Record<MoveKey, Move>> = {
  rope_or_jog: { name: 'ROPE OR JOG', groups: [] },
  joint_circles: { name: 'JOINT CIRCLES', groups: [], cue: 'HIPS BEFORE KICKS' },
  shadow: { name: 'SHADOW', groups: [], cue: 'JAB, TEEP, CHECK' },
  slow_shadow: { name: 'SLOW SHADOW', groups: [] },
  breathe: { name: 'BREATHE', groups: [], cue: 'IN THROUGH THE NOSE' },
  walk: { name: 'WALK', groups: [] },
  jab_teep: { name: 'JAB › TEEP', groups: ['boxing', 'defensive'], cue: 'BACK TO STANCE' },
  jab_cross: { name: 'JAB › CROSS', groups: ['boxing'], cue: 'HANDS HOME' },
  straight_punches: { name: 'STRAIGHT PUNCHES', groups: ['boxing'], cue: 'LEGS REST HERE' },
  fast_punches: { name: 'FAST PUNCHES', groups: ['boxing'], cue: 'LOOSE AND QUICK' },
  power_punches: { name: 'POWER PUNCHES', groups: ['boxing'], cue: 'TURN THE HIP' },
  light_punches: { name: 'LIGHT PUNCHES · FOOTWORK', groups: ['boxing'], cue: 'KEEP MOVING' },
  body_hooks: { name: 'BODY HOOKS · BOTH SIDES', groups: ['boxing'], cue: 'BEND THE KNEES' },
  power_combo: { name: 'POWER COMBO', groups: ['boxing'], cue: 'TURN THE HIP' },
  free_rhythm: { name: 'FREE RHYTHM', groups: ['boxing'], cue: 'PUSH THE BAG' },
  rhythm_threes: { name: 'RHYTHM · THREES AND FIVES', groups: ['boxing'], cue: 'PUSH THE BAG' },
  body_kicks_right: { name: 'BODY KICKS · RIGHT', groups: ['kicks'], kicks: K(16, 0), cue: 'SHIN, NOT FOOT' },
  switch_kicks: { name: 'SWITCH KICKS', groups: ['kicks'], kicks: K(0, 16), cue: 'HANDS UP AFTER' },
  double_kicks: { name: 'DOUBLE KICKS', groups: ['kicks'], kicks: K(10, 10), cue: 'RESET, THEN AGAIN' },
  power_kicks: { name: 'POWER KICKS · BOTH SIDES', groups: ['kicks'], kicks: K(8, 8), cue: 'TURN THE HIP OVER' },
  check_kick: { name: 'CHECK › BODY KICK', groups: ['kicks', 'defensive'], kicks: K(10, 0), cue: 'CHECK IS A STRIKE' },
  squat_stand_kick: { name: 'SQUAT › STAND › KICK', groups: ['kicks'], kicks: K(8, 0), cue: 'STAND TALL, THEN KICK' },
  jab_body_kick: { name: 'JAB › BODY KICK', groups: ['boxing', 'kicks'], kicks: K(10, 0), cue: 'SHIN, NOT FOOT' },
  cross_switch_kick: { name: 'CROSS › SWITCH KICK', groups: ['boxing', 'kicks'], kicks: K(0, 10), cue: 'SNAP THE SWITCH' },
  teep_body_kick: { name: 'TEEP › BODY KICK', groups: ['defensive', 'kicks'], kicks: K(10, 0), cue: 'BACK TO STANCE' },
  teeps_switch: { name: 'TEEPS · SWITCH LEGS', groups: ['defensive'], cue: 'BACK TO STANCE' },
  teeps_left: { name: 'TEEPS · LEFT', groups: ['defensive'], cue: 'PUSH WITH THE HIP' },
  teeps_right: { name: 'TEEPS · RIGHT', groups: ['defensive'], cue: 'PUSH WITH THE HIP' },
  balance_teep: { name: 'BALANCE TEEP', groups: ['defensive'], cue: 'SLOW AND TALL' },
  alt_teeps: { name: 'ALTERNATING TEEPS', groups: ['defensive'], cue: 'BACK TO STANCE' },
  knees_bag: { name: 'KNEES ON THE BAG', groups: ['knees'], cue: 'HIPS THROUGH', dropWhenOff: true },
  shadow_jab_check: { name: 'SHADOW · JAB › CHECK', groups: [], cue: 'CHECK IS A STRIKE' },
  shadow_jab_kick: { name: 'SHADOW · JAB › BODY KICK', groups: [], cue: 'SHIN, NOT FOOT' },
  shadow_cross_switch: { name: 'SHADOW · CROSS › SWITCH KICK', groups: [], cue: 'SNAP THE SWITCH' },
  push_ups: { name: 'PUSH-UPS', groups: [], cue: 'KNEES DOWN IS FINE' },
  squats: { name: 'SQUATS', groups: [], cue: 'CHEST UP' },
  slow_squats: { name: 'SLOW SQUATS', groups: [] },
  lunges: { name: 'LUNGES', groups: [], cue: 'KNEE OVER TOES' },
  mountain_climbers: { name: 'MOUNTAIN CLIMBERS', groups: [], cue: 'HIPS LOW' },
  plank: { name: 'PLANK', groups: [], cue: 'SQUEEZE EVERYTHING' },
  knee_to_elbow: { name: 'KNEE TO ELBOW', groups: [], cue: 'SLOW IS FINE' },
  step_back_sprawls: { name: 'STEP-BACK SPRAWLS', groups: [], cue: 'NO JUMP' },
  step_back_burpees: { name: 'STEP-BACK BURPEES', groups: [], cue: 'NO JUMP' },
  run_on_spot: { name: 'RUN ON THE SPOT', groups: [], cue: 'HANDS UP' },
  goblet_squats: { name: 'GOBLET SQUATS', groups: [], cue: 'LIGHT, FORM FIRST' },
  push_press: { name: 'PUSH PRESS', groups: [], cue: 'LIGHT, FORM FIRST' },
  db_rows: { name: 'DUMBBELL ROWS', groups: [], cue: 'LIGHT, FORM FIRST' },
}

/**
 * A move switched on, or what it becomes when its group is off: a punch-only
 * move goes to shadow (hands off: never the bag), anything else to straight
 * punches, else teeps, else squats; a knee-only part is left out (null).
 */
export function moveFor(key: MoveKey, on: ReadonlySet<string>): MoveKey | null {
  const m = MOVES[key]
  if (m.groups.every(g => on.has(g))) return key
  if (m.dropWhenOff) return null
  if (m.groups.length === 1 && m.groups[0] === 'boxing') return 'shadow'
  if (on.has('boxing')) return 'straight_punches'
  if (on.has('defensive')) return 'teeps_switch'
  return 'squats'
}

// ─── the workouts ─────────────────────────────────────────────

/** The small word over a work part's move: how hard (no percentages on screen). */
export type EffortWord = 'EASY' | 'STEADY' | 'HARD' | 'HARD LAST 20 S' | 'FAST' | 'ALL OUT' | 'LIGHT'

export interface PartSpec {
  ph: 'work' | 'rest'
  sec: number
  /** Work: the move. Rest: what's next is shown instead (or a task: "10 PUSH-UPS FIRST"). */
  move?: MoveKey
  effort?: EffortWord
  /** A counted set (Camp Finish): GOAL under the clock, page 86's red. */
  goal?: number
  /** A rest's own job, small under NEXT ("5 SLOW SQUATS FIRST"). */
  task?: string
}

export type BlockKind = 'warmup' | 'main' | 'cooldown'

export interface BlockSpec {
  kind: BlockKind
  parts: PartSpec[]
}

export type TemplateId =
  | 'steady_rounds' | 'kick_minutes' | 'bag_floor_30' | 'fighter_hour' | 'bag_emom'
  | 'sprint_punches' | 'bells_bag' | 'red_zone' | 'power_waves' | 'camp_finish'

export interface Template {
  id: TemplateId
  /** Its plain name ("Kick Minutes"). */
  name: string
  /** The levels it fits (1: weeks 1 to 3, 2: weeks 3 to 8, 3: from week 8). */
  levels: ReadonlyArray<1 | 2 | 3>
  /** The effort he should feel, 1 to 10 (7+: a hard day). */
  effort: number
  /** The short line on Today: "1 min a move · 30 s rest". */
  what: string
  /** Light dumbbells: never on a lift day. */
  dumbbells?: boolean
  /** Rest between main blocks, seconds. */
  between: number
  /** Its own warm-up and cool-down (null: the shared ones). */
  warmup?: BlockSpec
  cooldown?: BlockSpec
  main: BlockSpec[]
  /** Where it comes from, in a line. */
  source: string
}

const W = (move: MoveKey, sec: number, effort: EffortWord = 'STEADY'): PartSpec => ({ ph: 'work', sec, move, effort })
const R = (sec: number, task?: string): PartSpec => ({ ph: 'rest', sec, ...(task ? { task } : {}) })
const block = (parts: PartSpec[]): BlockSpec => ({ kind: 'main', parts })
/** Work parts with a rest between each (none after the last). */
const chain = (sec: number, rest: number, moves: ReadonlyArray<MoveKey | [MoveKey, EffortWord]>): PartSpec[] =>
  moves.flatMap((m, i) => {
    const [move, effort] = Array.isArray(m) ? m : [m, 'STEADY' as EffortWord]
    const w = W(move as MoveKey, sec, effort as EffortWord)
    return i < moves.length - 1 && rest > 0 ? [w, R(rest)] : [w]
  })

/** The shared warm-up (8 min) and cool-down (4 min). */
export const WARM_UP: BlockSpec = { kind: 'warmup', parts: [W('rope_or_jog', 240, 'EASY'), W('joint_circles', 120, 'EASY'), W('shadow', 120, 'EASY')] }
export const COOL_DOWN: BlockSpec = { kind: 'cooldown', parts: [W('slow_shadow', 120, 'EASY'), W('breathe', 120, 'EASY')] }

const burner = (a: MoveKey, b: MoveKey): PartSpec[] => [1, 2, 3].flatMap(() => [W(a, 10, 'STEADY'), W(b, 20, 'FAST')])

export const TEMPLATES: ReadonlyArray<Template> = [
  {
    id: 'steady_rounds', name: 'Steady Rounds', levels: [1], effort: 5, between: 60,
    what: 'one move a round · 1 min rest',
    main: [
      block([W('jab_teep', 120)]), block([W('straight_punches', 120)]), block([W('body_kicks_right', 120)]),
      block([W('switch_kicks', 120)]), block([W('check_kick', 120)]), block([W('free_rhythm', 120)]),
    ],
    source: 'Martial Spirit (one weapon a block), Evolve ("a pace you can sustain"), Sylvie (rhythm), Fagan 20-minute (one theme a round).',
  },
  {
    id: 'kick_minutes', name: 'Kick Minutes', levels: [1, 2], effort: 6, between: 60,
    what: '1 min a move · 30 s rest',
    main: [
      block(chain(60, 30, ['body_kicks_right', 'switch_kicks', 'teeps_switch'])),
      block(chain(60, 30, ['check_kick', 'squat_stand_kick', 'body_kicks_right'])),
      block(chain(60, 30, [['body_kicks_right', 'HARD LAST 20 S'], ['switch_kicks', 'HARD LAST 20 S'], 'straight_punches'])),
    ],
    source: 'Fagan, 10-minute kick workout and 10-minute bag workout (1:00 a technique, 0:30 rest, power at the end).',
  },
  {
    id: 'bag_floor_30', name: 'Bag and Floor 30/30', levels: [2], effort: 7, between: 60,
    what: '30 s on · 30 s off · bag and floor',
    main: [
      block(chain(30, 30, [['fast_punches', 'FAST'], 'push_ups', ['body_kicks_right', 'HARD'], 'squat_stand_kick', ['switch_kicks', 'HARD'], 'mountain_climbers', 'jab_teep', 'plank'])),
      block(chain(30, 30, [['fast_punches', 'FAST'], 'step_back_sprawls', ['body_kicks_right', 'HARD'], 'lunges', ['switch_kicks', 'HARD'], 'mountain_climbers', 'jab_teep', 'plank'])),
      block(chain(30, 30, ['jab_cross', ['fast_punches', 'FAST'], ['body_kicks_right', 'HARD'], 'jab_teep', ['teeps_switch', 'FAST'], ['switch_kicks', 'HARD'], ['knees_bag', 'HARD']])),
    ],
    source: "Sebastian's beginner workout (30 on / 30 off floor moves between bag work), Phil Daru (climbers and planks as active rest), fightTIPS 30/30/30, Pentagon MMA (squats, lunges, push-ups between).",
  },
  {
    id: 'fighter_hour', name: 'Fighter Hour', levels: [2], effort: 7, between: 60,
    what: 'shadow, bag rounds, a 10-min burner',
    warmup: { kind: 'warmup', parts: [W('rope_or_jog', 480, 'EASY'), W('joint_circles', 180, 'EASY')] },
    main: [
      block([W('shadow_jab_check', 60), W('shadow_jab_kick', 60), W('shadow_cross_switch', 60)]),
      block([W('shadow_jab_check', 60), W('shadow_jab_kick', 60), W('shadow_cross_switch', 60)]),
      block([W('jab_cross', 60), W('jab_body_kick', 60), W('cross_switch_kick', 60)]),
      block([W('free_rhythm', 180)]),
      block([W('power_kicks', 60, 'HARD'), W('switch_kicks', 60, 'HARD'), W('double_kicks', 60, 'HARD')]),
      block([...burner('balance_teep', 'alt_teeps'), R(30), ...burner('plank', 'knee_to_elbow'), R(30), ...burner('jab_cross', 'power_punches'), R(30), ...burner('squats', 'squat_stand_kick')]),
    ],
    source: 'Fagan, 60-Minute Fighter Follow Along (built for beginners; cut to fit 60 min).',
  },
  {
    id: 'bag_emom', name: 'Bag EMOM', levels: [2], effort: 7, between: 60,
    what: 'a new pair each minute · 3 passes',
    warmup: { kind: 'warmup', parts: [W('rope_or_jog', 120, 'EASY'), W('joint_circles', 60, 'EASY'), W('shadow', 120, 'EASY')] },
    cooldown: { kind: 'cooldown', parts: [W('slow_shadow', 60, 'EASY'), W('breathe', 60, 'EASY')] },
    main: (['STEADY', 'STEADY', 'FAST'] as EffortWord[]).map(e => block(chain(45, 15, [['jab_cross', e], ['jab_body_kick', e], ['cross_switch_kick', e], ['teep_body_kick', e], ['body_hooks', e]]))),
    source: 'NateBowerFitness, Heavy Bag EMOM (boxing; the Muay Thai pairs are from his library).',
  },
  {
    id: 'sprint_punches', name: 'Sprint Punches and Kicks', levels: [2, 3], effort: 6, between: 120,
    what: '5 s all out · 25 s easy · 10 times',
    main: (['power_punches', 'body_kicks_right', 'switch_kicks'] as MoveKey[]).map(m => block(Array.from({ length: 10 }, (_, i) => [W(m, 5, 'ALL OUT'), ...(i < 9 ? [W('shadow', 25, 'EASY')] : [])]).flat())),
    source: 'Joel Jamieson (8WeeksOut) high-resistance intervals; Kamandulis 2018 (14 × 3 s, 10 s rest, 3 rounds).',
  },
  {
    id: 'bells_bag', name: 'Bells and Bag', levels: [2, 3], effort: 7, between: 60, dumbbells: true,
    what: '2 min bag · 1 min light dumbbells',
    main: (['goblet_squats', 'push_press', 'db_rows', 'goblet_squats'] as MoveKey[]).map(d => block([W('body_kicks_right', 60), W('straight_punches', 60), W(d, 60)])),
    source: 'Boxing Science (bag work paired with strength moves); the dumbbell picks are ours.',
  },
  {
    id: 'red_zone', name: 'Red Zone Circuit', levels: [3], effort: 8, between: 60,
    what: '3 min rounds of 30 s parts',
    main: [0, 1, 2, 3, 4].map(r => block(chain(30, 0, [['power_combo', r < 2 ? 'STEADY' : 'HARD'], 'step_back_burpees', ['fast_punches', 'FAST'], 'run_on_spot', ['body_kicks_right', r < 2 ? 'STEADY' : 'HARD'], 'step_back_sprawls']))),
    source: 'Boxing Science bag circuit (3:00 rounds of 0:30 parts; reached 90%+ of max heart rate sooner than bag intervals alone).',
  },
  {
    id: 'power_waves', name: 'Power Waves', levels: [3], effort: 8, between: 60,
    what: 'hard and light waves · 15 s, then 30 s',
    cooldown: { kind: 'cooldown', parts: [W('slow_shadow', 120, 'EASY'), W('breathe', 120, 'EASY')] },
    main: [
      ...([0, 1, 2] as const).map(r => block([0, 1, 2, 3, 4, 5].flatMap(() => [W(r === 1 ? 'power_kicks' : 'power_punches', 15, 'HARD'), W('light_punches', 15, 'LIGHT')]))),
      block([W('walk', 120, 'EASY')]),
      block([0, 1, 2, 3, 4, 5].flatMap(() => [W('power_punches', 30, 'HARD'), W('light_punches', 30, 'LIGHT')])),
    ],
    source: 'Phil Daru, 15/15 and 30/30 lactate rounds (he builds the 30/30 to 8:00 and calls it advanced).',
  },
  {
    id: 'camp_finish', name: 'Camp Finish', levels: [3], effort: 8, between: 60,
    what: 'rhythm rounds, then counted sets',
    main: [
      block([W('rhythm_threes', 180), R(60, '10 PUSH-UPS FIRST'), W('rhythm_threes', 180), R(60, '10 PUSH-UPS FIRST'), W('rhythm_threes', 180), R(60, '10 PUSH-UPS FIRST'), W('rhythm_threes', 180)]),
      block([
        { ...W('body_kicks_right', 45, 'HARD'), goal: 20 }, R(20), { ...W('switch_kicks', 45, 'HARD'), goal: 20 }, R(20),
        { ...W('teeps_left', 45, 'HARD'), goal: 20 }, R(20), { ...W('teeps_right', 45, 'HARD'), goal: 20 }, R(20),
        { ...W('knees_bag', 65, 'HARD'), goal: 30 },
      ]),
      block([W('plank', 120, 'STEADY')]),
    ],
    source: "Sylvie's camp day (push-ups between rounds, counted kicks, teeps and knees); the counts from the kru report, sized for him.",
  },
]

// Steady Rounds' 5 slow squats in the rests after rounds 3 and 5 (a rest's task, not a part)
const SQUAT_RESTS: Readonly<Partial<Record<TemplateId, ReadonlyArray<number>>>> = { steady_rounds: [2, 4] }

export function templateById(id: string | null | undefined): Template | null {
  return TEMPLATES.find(t => t.id === id) ?? null
}

/** A hard day: effort 7 or more (bag-workouts.md section 3). */
export const HARD_EFFORT = 7

/** His level by weeks back in training: 1 for weeks 1 to 3, 2 for weeks 3 to 8, 3 from week 8. */
export function conditioningLevel(weeksBack: number): 1 | 2 | 3 {
  if (!(weeksBack >= 3)) return 1
  return weeksBack >= 8 ? 3 : 2
}

// ─── one knob at a time ───────────────────────────────────────

/** The knobs in order (a harder move isn't one: no jumps by default). */
export const KNOBS = ['block', 'work', 'rest', 'power'] as const
export const MAX_STEP = KNOBS.length

/** Every session is 60 min or less. */
export const SESSION_CAP_MIN = 60

export interface StepEntry {
  templateId: string
  step: number
  /** The effort the plan asked for. */
  planned: number
  /** His effort card (1 to 10); null: not given. */
  effort: number | null
  /** A wrist, shin or knee note after it. */
  pain?: boolean
}

/**
 * The step for a template from his last sessions of it (newest first): up one
 * after two in a row at or under the planned effort with no pain note; down
 * one after one way over (2 or more above) or a pain note; else the same.
 */
export function nextStep(history: ReadonlyArray<StepEntry>, templateId: string): number {
  const mine = history.filter(h => h.templateId === templateId)
  const now = mine[0]?.step ?? 0
  if (!mine[0]) return 0
  const last = mine[0]
  if (last.pain || (last.effort != null && last.effort >= last.planned + 2)) return Math.max(0, now - 1)
  const two = mine.slice(0, 2)
  if (two.length === 2 && two.every(h => !h.pain && h.effort != null && h.effort <= h.planned && h.step === now)) return Math.min(MAX_STEP, now + 1)
  return now
}

// ─── the plan ─────────────────────────────────────────────────

export interface PlanPart extends PartSpec {
  /** The block it belongs to (index into the plan's blocks). */
  block: number
}

export interface PlanBlock {
  kind: BlockKind
  /** WARM-UP, ROUND 1, COOL-DOWN. */
  name: string
  /** Main blocks: its number (1-based) of `rounds`. */
  round?: number
}

export interface ConditioningPlan {
  templateId: TemplateId
  name: string
  /** The knob step it was built at. */
  step: number
  /** The Settings switches it was shaped by (kept with the session so it rebuilds the same). */
  switches: string[]
  effort: number
  hard: boolean
  /** Main blocks. */
  rounds: number
  blocks: PlanBlock[]
  parts: PlanPart[]
}

const clampSec = (v: number, lo: number) => Math.max(lo, Math.round(v))

/** A template's blocks at a step, the lighter week and his switches. */
function shapeBlocks(t: Template, step: number, on: ReadonlySet<string>, lighter: boolean): { main: BlockSpec[]; warm: BlockSpec; cool: BlockSpec } {
  let main = t.main.map(b => ({ ...b, parts: b.parts.map(p => ({ ...p })) }))
  // knob 1: one more block (the last main block again)
  if (step >= 1 && main.length > 0) main.push({ ...main[main.length - 1], parts: main[main.length - 1].parts.map(p => ({ ...p })) })
  // knob 2: longer work (bursts and counted sets keep theirs)
  if (step >= 2) main = main.map(b => ({ ...b, parts: b.parts.map(p => (p.ph === 'work' && p.sec >= 20 && p.goal == null ? { ...p, sec: p.sec + (p.sec >= 120 ? 30 : 10) } : p)) }))
  // knob 3: shorter rest
  if (step >= 3) main = main.map(b => ({ ...b, parts: b.parts.map(p => (p.ph === 'rest' && !p.task ? { ...p, sec: clampSec(p.sec - 10, 15) } : p)) }))
  // knob 4: more power: each block's last steady bag part goes hard
  if (step >= 4) {
    main = main.map(b => {
      const i = [...b.parts].reverse().findIndex(p => p.ph === 'work' && p.effort === 'STEADY' && p.move && MOVES[p.move].groups.length > 0)
      if (i < 0) return b
      const k = b.parts.length - 1 - i
      return { ...b, parts: b.parts.map((p, j) => (j === k ? { ...p, effort: 'HARD' as EffortWord } : p)) }
    })
  }
  // the lighter week: a block off, the power kept
  if (lighter && main.length > 2) main = main.slice(0, -1)
  // his switches: swap or leave out; a block with no bag move of its own left drops
  const filtered: BlockSpec[] = []
  for (const b of main) {
    const hadBag = b.parts.some(p => p.ph === 'work' && p.move && MOVES[p.move].groups.length > 0)
    const keptBag = b.parts.some(p => p.ph === 'work' && p.move && MOVES[p.move].groups.length > 0 && moveFor(p.move, on) === p.move)
    if (hadBag && !keptBag && main.length > 1) continue
    const parts: PartSpec[] = []
    for (const p of b.parts) {
      if (p.ph === 'work' && p.move) {
        const to = moveFor(p.move, on)
        if (!to) { if (parts.length && parts[parts.length - 1].ph === 'rest') parts.pop(); continue }
        parts.push(to === p.move ? p : { ...p, move: to, goal: undefined })
      } else parts.push(p)
    }
    while (parts.length && parts[parts.length - 1].ph === 'rest') parts.pop()
    if (parts.some(p => p.ph === 'work')) filtered.push({ ...b, parts })
  }
  return { main: filtered.length > 0 ? filtered : main.slice(0, 1), warm: t.warmup ?? WARM_UP, cool: t.cooldown ?? COOL_DOWN }
}

/** The whole session as timer parts: warm-up, the main blocks with their rests between, cool-down. */
export function buildPlan(t: Template, opts: { step?: number; switches: ReadonlySet<string>; lighterWeek?: boolean }): ConditioningPlan {
  const step = Math.max(0, Math.min(MAX_STEP, Math.round(opts.step ?? 0)))
  const shaped = shapeBlocks(t, step, opts.switches, !!opts.lighterWeek)
  // never over the hour: drop knobs from the top until it fits
  if (step > 0 && planSec(shaped, t.between) / 60 > SESSION_CAP_MIN) return buildPlan(t, { ...opts, step: step - 1 })
  const blocks: PlanBlock[] = []
  const parts: PlanPart[] = []
  const squatRests = SQUAT_RESTS[t.id] ?? []
  const add = (b: BlockSpec, name: string, round?: number) => {
    const bi = blocks.length
    blocks.push({ kind: b.kind, name, ...(round != null ? { round } : {}) })
    for (const p of b.parts) parts.push({ ...p, block: bi })
  }
  add(shaped.warm, 'WARM-UP')
  shaped.main.forEach((b, i) => {
    if (i > 0 && t.between > 0) parts.push({ ph: 'rest', sec: t.between, block: blocks.length - 1, ...(squatRests.includes(i - 1) ? { task: '5 SLOW SQUATS FIRST' } : {}) })
    add(b, `ROUND ${i + 1}`, i + 1)
  })
  add(shaped.cool, 'COOL-DOWN')
  return { templateId: t.id, name: t.name, step, switches: [...opts.switches], effort: t.effort, hard: t.effort >= HARD_EFFORT, rounds: shaped.main.length, blocks, parts }
}

function planSec(s: { main: BlockSpec[]; warm: BlockSpec; cool: BlockSpec }, between: number): number {
  const sum = (b: BlockSpec) => b.parts.reduce((n, p) => n + p.sec, 0)
  return sum(s.warm) + s.main.reduce((n, b) => n + sum(b), 0) + Math.max(0, s.main.length - 1) * between + sum(s.cool)
}

/** The whole plan, seconds (the 10 s GET READY included). */
export function planTotalSec(p: Pick<ConditioningPlan, 'parts'>): number {
  return GET_READY_SEC + p.parts.reduce((n, x) => n + x.sec, 0)
}

/** Planned minutes, rounded. */
export function planMinutes(p: Pick<ConditioningPlan, 'parts'>): number {
  return Math.round(planTotalSec(p) / 60)
}

/** Kicks a side the plan asks for (its kick parts' minutes × the move's rate). */
export function planKicks(p: Pick<ConditioningPlan, 'parts'>, done?: (i: number) => boolean): KickCount {
  const out = { right: 0, left: 0 }
  p.parts.forEach((x, i) => {
    if (x.ph !== 'work' || !x.move || (done && !done(i))) return
    const k = MOVES[x.move].kicks
    if (!k) return
    if (x.goal != null) { out.right += k.right > 0 ? x.goal : 0; out.left += k.left > 0 ? x.goal : 0; return }
    out.right += Math.round((k.right * x.sec) / 60)
    out.left += Math.round((k.left * x.sec) / 60)
  })
  return out
}

// ─── the coach's pick (the planner's plain function) ──────────

export type ConditioningReadiness = 'low' | 'ok' | 'high'

export interface ConditioningPickInput {
  /** His stage: 1 weeks 1 to 3, 2 weeks 3 to 8, 3 from week 8 (conditioningLevel). */
  level: 1 | 2 | 3
  /** How ready he is today (his morning check-in, an ease, an injury note): low takes the steady version. */
  readiness: ConditioningReadiness
  /** His Settings technique switches (boxing, kicks, defensive, knees, elbows). */
  switches: ReadonlySet<string>
  /** Whether a hard day fits around his runs, lifts and classes (default yes). */
  hardAllowed?: boolean
  /** Minutes free that day (default and most: 60). */
  freeMin?: number
  /** The last one he did: not the same one again. */
  lastTemplateId?: string | null
  /** A lift that day: no dumbbell workout. */
  liftDay?: boolean
  /** The plan's lighter week (every 4th): one block off. */
  lighterWeek?: boolean
  /** His last sessions' steps and efforts, newest first (nextStep). */
  history?: ReadonlyArray<StepEntry>
  /** What is left of the week's kicks, per side (lib/coach/kickBudget); none: no limit. */
  kicksLeft?: KickCount | null
}

export interface ConditioningPick {
  template: Template
  /** Planned minutes, warm-up and cool-down included. */
  minutes: number
  /** Effort 7 or more: a hard day. */
  hard: boolean
  plan: ConditioningPlan
}

/** The order the coach goes round them in, for variety (the next one after the last). */
const ROTATION: ReadonlyArray<TemplateId> = ['kick_minutes', 'steady_rounds', 'bag_floor_30', 'bag_emom', 'fighter_hour', 'sprint_punches', 'bells_bag', 'red_zone', 'power_waves', 'camp_finish']
/** A short day (25 min or less): the short ones. */
const SHORT: ReadonlySet<TemplateId> = new Set(['bag_emom', 'sprint_punches', 'steady_rounds', 'kick_minutes'])

/**
 * The coach's pick (page 93): from the list, never made up. A rough morning
 * takes the steady version (Steady Rounds). Otherwise the workouts for his
 * level that fit the day's minutes, a hard day only when one fits, no dumbbells
 * on a lift day, not the same as last time, and kicks inside the week's budget
 * (a workout over it runs with its kicks swapped for hands). Then his step for
 * it, his switches and the lighter week shape it.
 */
export function pickConditioning(inp: ConditioningPickInput): ConditioningPick {
  const free = Math.min(SESSION_CAP_MIN, inp.freeMin ?? SESSION_CAP_MIN)
  const hardOk = inp.hardAllowed !== false && inp.readiness !== 'low'
  const build = (t: Template, switches: ReadonlySet<string>) => buildPlan(t, { step: inp.readiness === 'low' ? 0 : nextStep(inp.history ?? [], t.id), switches, lighterWeek: inp.lighterWeek })
  const fitsKicks = (p: ConditioningPlan) => { if (!inp.kicksLeft) return true; const k = planKicks(p); return k.right <= inp.kicksLeft.right && k.left <= inp.kicksLeft.left }
  const done = (t: Template, p: ConditioningPlan): ConditioningPick => ({ template: t, minutes: planMinutes(p), hard: p.hard, plan: p })

  const steady = templateById('steady_rounds')!
  if (inp.readiness === 'low') return done(steady, withKicks(steady, inp, build))

  const start = Math.max(0, ROTATION.indexOf((inp.lastTemplateId ?? '') as TemplateId) + 1)
  const order = [...ROTATION.slice(start), ...ROTATION.slice(0, start)].map(id => templateById(id)!)
  const ok = (t: Template) => t.levels.includes(inp.level) && (hardOk || t.effort < HARD_EFFORT) && !(t.dumbbells && inp.liftDay) && (free > 25 || SHORT.has(t.id))
  const fresh = order.filter(t => ok(t) && t.id !== inp.lastTemplateId)
  for (const t of [...fresh, ...order.filter(t => ok(t) && t.id === inp.lastTemplateId)]) {
    const p = build(t, inp.switches)
    if (planMinutes(p) <= free && fitsKicks(p)) return done(t, p)
  }
  // nothing fits as it is: the first that fits the minutes, kicks swapped for hands when the week is spent
  for (const t of fresh.length > 0 ? fresh : [steady]) {
    const p = withKicks(t, inp, build)
    if (planMinutes(p) <= free) return done(t, p)
  }
  return done(steady, withKicks(steady, inp, build))
}

/** A plan whose kicks fit the week's budget: as it is, else with KICKS treated as off. */
function withKicks(t: Template, inp: ConditioningPickInput, build: (t: Template, s: ReadonlySet<string>) => ConditioningPlan): ConditioningPlan {
  const p = build(t, inp.switches)
  if (!inp.kicksLeft) return p
  const k = planKicks(p)
  if (k.right <= inp.kicksLeft.right && k.left <= inp.kicksLeft.left) return p
  return build(t, new Set([...inp.switches].filter(g => g !== 'kicks')))
}

// ─── running it (the interval timer's part maths) ─────────────

export const GET_READY_SEC = 10

/** The timer's parts: a 10 s GET READY, then every part in order. `round` is the plan part's index + 1 (0: get ready). */
export function conditioningParts(p: Pick<ConditioningPlan, 'parts'>): IntervalPart[] {
  const out: IntervalPart[] = [{ ph: 'ready', len: GET_READY_SEC, round: 0, startSec: 0 }]
  let at = GET_READY_SEC
  p.parts.forEach((x, i) => {
    out.push({ ph: x.ph, len: x.sec, round: i + 1, startSec: at })
    at += x.sec
  })
  return out
}

/**
 * The timer's sounds (page 81's pattern, Poppy only where her clips exist):
 * the change chime at every part, then "Get ready.", "Round n." (or "Last
 * round.") as a round starts, "Rest." between rounds; a short tick each orange
 * second; at the end the done chime and "Done.". The native timer plays this
 * list by itself with the phone locked.
 */
export function conditioningCues(plan: ConditioningPlan, parts: ReadonlyArray<IntervalPart>): IntervalCue[] {
  const out: IntervalCue[] = []
  let lastBlock = -1
  for (const p of parts) {
    const x = p.round > 0 ? plan.parts[p.round - 1] : null
    const block = x ? plan.blocks[x.block] : null
    let voice: string | null = null
    if (p.ph === 'ready') voice = 't_get_ready'
    else if (x && block?.round != null && x.ph === 'work' && x.block !== lastBlock) voice = block.round === plan.rounds && plan.rounds > 1 ? 't_last_round' : `t_round_${Math.min(30, block.round)}`
    else if (x && x.ph === 'rest' && x.sec >= 45) voice = 't_rest'
    if (x) lastBlock = x.block
    out.push({ atSec: p.startSec, kind: 'change', clips: voice ? ['t_change', voice] : ['t_change'] })
    const w = warnLen(p)
    for (let k = 0; k < w; k++) {
      const at = p.startSec + p.len - w + k
      if (at > p.startSec) out.push({ atSec: at, kind: 'tick', clips: ['t_tick'] })
    }
  }
  const last = parts[parts.length - 1]
  out.push({ atSec: last.startSec + last.len, kind: 'done', clips: ['chime_done', 't_done'] })
  return out
}

/** The next work part's move after part `i` (a rest and GET READY show it). */
export function nextMove(p: Pick<ConditioningPlan, 'parts'>, i: number): MoveKey | null {
  for (let k = Math.max(0, i + 1); k < p.parts.length; k++) if (p.parts[k].ph === 'work' && p.parts[k].move) return p.parts[k].move!
  return null
}

/** "0:45 · GOAL 20" under a counted set. */
export function goalLine(x: Pick<PartSpec, 'sec' | 'goal'>): string {
  return `${mmss(x.sec)} · GOAL ${x.goal}`
}

// ─── the log (kept with the session: context_json.conditioningLog) ───

export type BlockStatus = 'done' | 'skipped' | 'cut'

export interface ConditioningLog {
  /** Per plan part: done (its time ran out), skipped (swiped past or never reached), null not yet. */
  parts: Array<'done' | 'skipped' | null>
  /** Held through on the grass. */
  ended: boolean
  /** The timer part it was last seen at (index into conditioningParts). */
  at: number
}

export function newConditioningLog(p: Pick<ConditioningPlan, 'parts'>): ConditioningLog {
  return { parts: p.parts.map(() => null), ended: false, at: 0 }
}

/** Time ran from timer part `log.at` to `toIdx`: every plan part it passed is done. */
export function condRanTo(log: ConditioningLog, parts: ReadonlyArray<IntervalPart>, toIdx: number): ConditioningLog {
  const next = [...log.parts]
  for (let i = Math.max(0, log.at); i < Math.min(toIdx, parts.length); i++) {
    const r = parts[i].round
    if (r > 0 && next[r - 1] == null) next[r - 1] = 'done'
  }
  return { ...log, parts: next, at: Math.max(log.at, Math.min(toIdx, parts.length)) }
}

/** A jump from timer part `fromIdx` to `toIdx`: a part swiped past is skipped (a swipe down keeps its mark). */
export function condJumped(log: ConditioningLog, parts: ReadonlyArray<IntervalPart>, fromIdx: number, toIdx: number, skipped: boolean): ConditioningLog {
  const next = [...log.parts]
  const r = parts[fromIdx]?.round ?? 0
  if (skipped && r > 0 && next[r - 1] == null) next[r - 1] = 'skipped'
  return { ...log, parts: next, at: Math.max(0, Math.min(toIdx, parts.length)) }
}

/** Held through at timer part `idx`: it and every part after it are skipped. */
export function condEnded(log: ConditioningLog, parts: ReadonlyArray<IntervalPart>, idx: number): ConditioningLog {
  const from = Math.max(0, (parts[idx]?.round ?? 1) - 1)
  return { ...log, ended: true, parts: log.parts.map((s, i) => (i >= from && s == null ? 'skipped' : s)) }
}

export interface BlockResult {
  name: string
  kind: BlockKind
  status: BlockStatus
  /** Work seconds done. */
  secDone: number
  /** Work seconds planned. */
  secPlanned: number
}

/** Each block: done (every work part), skipped (none), or cut short (some, with the seconds done). */
export function blockResults(p: Pick<ConditioningPlan, 'parts' | 'blocks'>, log: Pick<ConditioningLog, 'parts'>): BlockResult[] {
  return p.blocks.map((b, bi) => {
    const work = p.parts.map((x, i) => ({ x, i })).filter(({ x }) => x.block === bi && x.ph === 'work')
    const done = work.filter(({ i }) => log.parts[i] === 'done')
    const secDone = done.reduce((n, { x }) => n + x.sec, 0)
    const secPlanned = work.reduce((n, { x }) => n + x.sec, 0)
    const status: BlockStatus = done.length === work.length ? 'done' : done.length === 0 ? 'skipped' : 'cut'
    return { name: b.name, kind: b.kind, status, secDone, secPlanned }
  })
}

/** As it is sent: a part never reached is skipped. */
export function finalConditioningLog(log: ConditioningLog): ConditioningLog {
  return { ...log, parts: log.parts.map(s => s ?? 'skipped') }
}

/** The kicks a side the done parts spent (the week's budget). */
export function loggedKicks(p: Pick<ConditioningPlan, 'parts'>, log: Pick<ConditioningLog, 'parts'>): KickCount {
  return planKicks(p, i => log.parts[i] === 'done')
}

/** A stored plan, or null when it isn't one (rebuilt from its template, step and switches, so nothing stored is trusted). */
export function parseConditioning(raw: unknown): { templateId: TemplateId; step: number; switches: string[]; lighterWeek: boolean } | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const t = templateById(typeof r.templateId === 'string' ? r.templateId : null)
  if (!t) return null
  const step = typeof r.step === 'number' && Number.isInteger(r.step) ? Math.max(0, Math.min(MAX_STEP, r.step)) : 0
  const switches = Array.isArray(r.switches) ? r.switches.filter((x): x is string => typeof x === 'string').slice(0, 8) : ['boxing', 'kicks', 'defensive']
  return { templateId: t.id, step, switches, lighterWeek: r.lighterWeek === true }
}

/** A stored log for a plan of `n` parts, or null. */
export function parseConditioningLog(raw: unknown, n: number): ConditioningLog | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.parts) || r.parts.length !== n) return null
  const parts = r.parts.map(x => (x === 'done' || x === 'skipped' ? x : null))
  const at = typeof r.at === 'number' && Number.isInteger(r.at) && r.at >= 0 ? r.at : 0
  return { parts, ended: r.ended === true, at }
}

/** The phone's copy of the log until the session is finished. */
export function conditioningLogKey(sessionId: string): string {
  return `waymark_conditioning_log:${sessionId}`
}

// ─── the words ────────────────────────────────────────────────

/** The plan line on Today: "Kick Minutes · 3 rounds". */
export function workoutLine(p: Pick<ConditioningPlan, 'name' | 'rounds'>): string {
  return `${p.name} · ${p.rounds} round${p.rounds === 1 ? '' : 's'}`
}

/** The moves on Today, the first three different bag moves in plain words ("body kicks, switch kicks, teeps"). */
export function movesLine(p: Pick<ConditioningPlan, 'parts' | 'blocks'>): string {
  const seen: string[] = []
  for (const x of p.parts) {
    if (x.ph !== 'work' || !x.move || p.blocks[x.block]?.kind !== 'main') continue
    const word = MOVES[x.move].name.split(' · ')[0].toLowerCase()
    if (!seen.includes(word)) seen.push(word)
    if (seen.length >= 3) break
  }
  return seen.join(', ')
}

/** "warm-up, rounds 1–2, cool-down": block names in a line, rounds in a row run together. */
export function blocksWords(names: ReadonlyArray<string>): string {
  const out: string[] = []
  let run: number[] = []
  const flush = () => {
    if (run.length === 0) return
    out.push(run.length === 1 ? `round ${run[0]}` : `rounds ${run[0]}–${run[run.length - 1]}`)
    run = []
  }
  for (const n of names) {
    const m = /^ROUND (\d+)$/.exec(n)
    if (m && (run.length === 0 || Number(m[1]) === run[run.length - 1] + 1)) { run.push(Number(m[1])); continue }
    flush()
    if (m) run.push(Number(m[1]))
    else out.push(n.toLowerCase())
  }
  flush()
  return out.join(', ')
}

/** The done row's lines (page 93): BLOCKS done ✓, SHORT what was cut short or skipped. */
export function doneBlockLines(results: ReadonlyArray<BlockResult>): Array<{ label: 'BLOCKS' | 'SHORT'; value: string; tick?: boolean }> {
  const done = results.filter(r => r.status === 'done').map(r => r.name)
  const cut = results.filter(r => r.status === 'cut').map(r => r.name)
  const skipped = results.filter(r => r.status === 'skipped').map(r => r.name)
  const out: Array<{ label: 'BLOCKS' | 'SHORT'; value: string; tick?: boolean }> = []
  if (done.length > 0) out.push({ label: 'BLOCKS', value: blocksWords(done), tick: true })
  const short = [cut.length ? blocksWords(cut) : null, skipped.length ? `${blocksWords(skipped)} skipped` : null].filter(Boolean)
  if (short.length > 0) out.push({ label: 'SHORT', value: short.join(' · ') })
  return out
}

/**
 * The plan a row shows (Today, Program): the one the session keeps once it has
 * started; before, the week planner's pick (context_json.conditioningPick) at
 * its first step with the default switches; else null (the start picks it).
 */
export function planFromContext(contextJson: string | null | undefined): ConditioningPlan | null {
  let ctx: Record<string, unknown> = {}
  try { const v = JSON.parse(contextJson ?? '{}') as unknown; if (v && typeof v === 'object') ctx = v as Record<string, unknown> } catch { ctx = {} }
  const kept = parseConditioning(ctx.conditioning)
  const t = kept && templateById(kept.templateId)
  if (kept && t) return buildPlan(t, { step: kept.step, switches: new Set(kept.switches), lighterWeek: kept.lighterWeek })
  const pick = ctx.conditioningPick as { templateId?: unknown } | undefined
  const placed = templateById(typeof pick?.templateId === 'string' ? pick.templateId : null)
  return placed ? buildPlan(placed, { switches: new Set(['boxing', 'kicks', 'defensive']) }) : null
}
