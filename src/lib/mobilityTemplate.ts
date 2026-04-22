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
 * Zone 2 warmup block. Runs M/W/F AM before the Zone 2 run.
 *
 * RAMP protocol (Raise / Activate / Mobilize / Potentiate), tuned for a
 * sedentary user with APT and sore low back. All standing/dynamic — no floor
 * rehab work. Moves are running-coach staples:
 * - Walking knee hugs: dynamic hip flexor open (counters APT tightness).
 * - Walking quad pulls: rectus femoris lengthening on the move.
 * - Spiderman + T-spine rotation: world's greatest stretch compound — hip,
 *   hamstring, adductor, and thoracic rotation for arm swing (UCS).
 * - Lateral lunges: adductor + glute medius, the frontal plane runners skip.
 * - A-skips: primes stride mechanics and elastic tissue without taxing HR.
 *
 * Zero floor work, zero static stretching (pre-run static stretching reduces
 * power output per current sports-med consensus). ~4 min total.
 *
 * Zero overlap with DAILY_MOBILITY_TEMPLATE so both on the same morning don't
 * double up.
 */
export const FR_WARMUP_TEMPLATE: MobilityExerciseTemplate[] = [
  {
    exerciseId: 'ex-walking-knee-hugs',
    label: 'Walking Knee Hugs',
    section: 'lower',
    sets: 1,
    holdSec: null,
    reps: 12,
    notes: 'Step forward, pull opposite knee to chest for a beat, release and walk through. 6 per side. Dynamic hip flexor open — counters APT tightness from sitting.',
  },
  {
    exerciseId: 'ex-walking-quad-pulls',
    label: 'Walking Quad Pulls',
    section: 'lower',
    sets: 1,
    holdSec: null,
    reps: 12,
    notes: 'Step, grab same-side ankle behind you, squeeze glute for a beat, walk through. 6 per side. Lengthens rectus femoris on the move, the other half of APT.',
  },
  {
    exerciseId: 'ex-spiderman-tspine',
    label: 'Spiderman + T-Spine Rotation',
    section: 'lower',
    sets: 1,
    holdSec: null,
    reps: 10,
    notes: 'Low lunge, hand inside front foot, rotate top arm to ceiling and follow with your eyes. 5 per side. Hip, adductor, hamstring, and thoracic rotation in one move.',
  },
  {
    exerciseId: 'ex-lateral-lunges',
    label: 'Lateral Lunges',
    section: 'lower',
    sets: 1,
    holdSec: null,
    reps: 12,
    notes: 'Step wide, sit into one hip, other leg stays straight. 6 per side. Adductor and glute medius — the frontal plane runners neglect.',
  },
  {
    exerciseId: 'ex-a-skips',
    label: 'A-Skips',
    section: 'lower',
    sets: 1,
    holdSec: 30,
    reps: null,
    notes: 'Light skip, drive lead knee to 90 degrees, opposite arm swings. 30s easy. Primes stride mechanics and elastic tissue. Stay bouncy, not hard.',
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
