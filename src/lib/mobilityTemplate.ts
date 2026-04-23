export type MobilitySection = 'upper' | 'lower' | 'breathing'

export interface MobilityExerciseTemplate {
  exerciseId: string
  label: string
  section: MobilitySection
  sets: number
  holdSec: number | null
  reps: number | null
  notes?: string
}

/**
 * Daily Mobility. Runs every day AM, ~8 min.
 *
 * Science-backed sequence:
 * - Breathing first (diaphragm reset sequences the ribcage correctly).
 * - Thoracic extension + prone cobra target UCS (mid/lower trap + posterior chain).
 * - Band external rotations train rear delt / rotator cuff (anti-rounded-shoulders).
 * - Couch stretch lengthens rectus femoris (direct APT driver).
 * - World's greatest stretch is a compound hip + thoracic opener.
 * - Ankle CARs maintain dorsiflexion (squat depth, kick mechanics, gait).
 *
 * Zero overlap with FR_WARMUP_TEMPLATE so daily + Zone 2 on same morning
 * don't double up.
 */
export const DAILY_MOBILITY_TEMPLATE: MobilityExerciseTemplate[] = [
  {
    exerciseId: 'ex-crocodile-breathing',
    label: 'Crocodile Breathing',
    section: 'breathing',
    sets: 1,
    holdSec: 120,
    reps: null,
    notes: 'Face down, forehead on hands. Breathe into your lower back and ribs, not your chest. Resets the diaphragm that shallow chest breathing has parked.',
  },
  {
    exerciseId: 'ex-foam-roll-thoracic',
    label: 'Thoracic Extension on Foam Roller',
    section: 'upper',
    sets: 1,
    holdSec: 60,
    reps: null,
    notes: 'Roller under mid-back, hands behind head. Let the spine extend backwards. This is the single best move against desk kyphosis.',
  },
  {
    exerciseId: 'ex-prone-cobra',
    label: 'Prone Cobra',
    section: 'upper',
    sets: 2,
    holdSec: 3,
    reps: 10,
    notes: 'Lie face down, lift chest and arms, thumbs up. Hold 3s. Activates the entire posterior chain the desk switches off.',
  },
  {
    exerciseId: 'ex-band-external-rotation',
    label: 'Band External Rotations',
    section: 'upper',
    sets: 2,
    holdSec: null,
    reps: 10,
    notes: 'Elbow tucked to side, rotate forearm outward against band. 10 each arm. Rear delt and rotator cuff, the muscles that pull shoulders back.',
  },
  {
    exerciseId: 'ex-couch-stretch',
    label: 'Couch Stretch',
    section: 'lower',
    sets: 1,
    holdSec: 30,
    reps: null,
    notes: 'Back foot on couch, front knee forward, tuck tailbone and squeeze back glute. 30s each side. Deep hip flexor lengthening that a standing stretch can not reach.',
  },
  {
    exerciseId: 'ex-worlds-greatest-stretch',
    label: "World's Greatest Stretch",
    section: 'lower',
    sets: 1,
    holdSec: 30,
    reps: null,
    notes: 'Lunge, hand inside front foot, rotate top arm to ceiling. 30s each side. Opens hip, groin, and thoracic spine in one move.',
  },
  {
    exerciseId: 'ex-ankle-cars',
    label: 'Ankle CARs',
    section: 'lower',
    sets: 2,
    holdSec: null,
    reps: 10,
    notes: 'Controlled articular rotations. Slow full circles, both directions, each ankle. Dorsiflexion quality drives squat depth and kick mechanics.',
  },
]

/**
 * Zone 2 pre-run stretch block. Runs M/W/F AM before the Zone 2 run.
 *
 * Static holds. The sports-med consensus is that pre-run static stretching
 * drops power output a few percent on the session that follows — a real
 * trade-off, and the honest framing. We take it because: a warmup the athlete
 * actually does beats an optimal warmup they skip, warm-to-cold static holds
 * don't carry the injury risk cold ones do, and this athlete's APT and
 * desk-tight posterior chain get more out of length than from drills at Z2
 * intensity. ~4 min total.
 *
 * Zero overlap with DAILY_MOBILITY_TEMPLATE so both on the same morning don't
 * double up.
 */
export const FR_WARMUP_TEMPLATE: MobilityExerciseTemplate[] = [
  {
    exerciseId: 'ex-toe-touch-forward-fold',
    label: 'Toe-Touch Forward Fold',
    section: 'lower',
    sets: 1,
    holdSec: 45,
    reps: null,
    notes: 'Feet hip-width, fold from the hips, let the head hang. Soft knees if the hamstrings grip. 45s. Full posterior chain opens in one move.',
  },
  {
    exerciseId: 'ex-butterfly-stretch',
    label: 'Butterfly Stretch',
    section: 'lower',
    sets: 1,
    holdSec: 60,
    reps: null,
    notes: 'Soles together, knees fall open, fold forward from the hips. 60s. Adductor and inner-hip length sitting closes off.',
  },
  {
    exerciseId: 'ex-pigeon-stretch',
    label: 'Pigeon Stretch',
    section: 'lower',
    sets: 1,
    holdSec: 45,
    reps: null,
    notes: 'Front shin across, back leg extended, fold over. 45s each side. Deep glute and external rotator, the lengths runners lose.',
  },
  {
    exerciseId: 'ex-standing-quad-stretch',
    label: 'Standing Quad Stretch',
    section: 'lower',
    sets: 1,
    holdSec: 30,
    reps: null,
    notes: 'Stand, grab the ankle behind you, knees together, squeeze the back glute. 30s each side. Rectus femoris and hip flexor, direct counter to APT.',
  },
  {
    exerciseId: 'ex-standing-calf-stretch',
    label: 'Standing Calf Stretch',
    section: 'lower',
    sets: 1,
    holdSec: 30,
    reps: null,
    notes: 'Hands on wall, back leg straight, press the heel down. 30s each side. Gastrocnemius and Achilles, the chain that takes every step of impact.',
  },
]

/**
 * Legacy Foundation Run cooldown block. Kept as a named export for any
 * historical references; the active Zone 2 flow now uses FR_WARMUP_TEMPLATE
 * before the run and skips post-run mobility (Daily Mobility covers it).
 */
export const FR_COOLDOWN_TEMPLATE: MobilityExerciseTemplate[] = [
  {
    exerciseId: 'ex-foam-roll-pecs',
    label: 'Foam Roll Pecs',
    section: 'upper',
    sets: 1,
    holdSec: 60,
    reps: null,
    notes: 'Releases the chest tightness from desk posture. 60s each side.',
  },
  {
    exerciseId: 'ex-foam-roll-hip-flexors',
    label: 'Foam Roll Hip Flexors',
    section: 'lower',
    sets: 1,
    holdSec: 60,
    reps: null,
    notes: '60s each side. Releases before stretching gets better range.',
  },
  {
    exerciseId: 'ex-doorway-pec-stretch',
    label: 'Doorway Pec Stretch',
    section: 'upper',
    sets: 1,
    holdSec: 45,
    reps: null,
    notes: 'Warm tissue takes a deeper stretch. 45s each side, breathe into it.',
  },
  {
    exerciseId: 'ex-hip-flexor-stretch',
    label: 'Hip Flexor Stretch',
    section: 'lower',
    sets: 1,
    holdSec: 45,
    reps: null,
    notes: 'Half-kneeling. Squeeze back glute, tuck tailbone. 45s each side.',
  },
  {
    exerciseId: 'ex-pigeon-stretch',
    label: 'Pigeon Stretch',
    section: 'lower',
    sets: 1,
    holdSec: 60,
    reps: null,
    notes: 'Deep external rotator release. 60s each side, sink in and breathe.',
  },
  {
    exerciseId: 'ex-cossack-squats',
    label: 'Cossack Squats',
    section: 'lower',
    sets: 2,
    holdSec: null,
    reps: 8,
    notes: 'Loaded hip mobility. 8 each side. Builds usable range, not just passive range.',
  },
  {
    exerciseId: 'ex-90-90-hip-switches',
    label: '90/90 Hip Switches',
    section: 'lower',
    sets: 2,
    holdSec: null,
    reps: 10,
    notes: 'Internal and external hip rotation. Most desk workers have lost this range entirely.',
  },
  {
    exerciseId: 'ex-dead-bugs',
    label: 'Dead Bugs',
    section: 'lower',
    sets: 2,
    holdSec: null,
    reps: 10,
    notes: 'Core lockdown to finish. 10 each side, low back stays flat on the floor.',
  },
]

export const MOBILITY_SECTION_LABELS: Record<MobilitySection, string> = {
  breathing: 'Breathing',
  upper: 'Upper Body',
  lower: 'Lower Body',
}
