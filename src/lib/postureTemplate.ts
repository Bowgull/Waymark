export type PostureSection = 'upper' | 'lower'

export interface PostureExerciseTemplate {
  exerciseId: string
  label: string
  section: PostureSection
  sets: number
  holdSec: number | null // null = rep-based, not timed hold
  reps: number | null    // null = hold-based, not rep-based
  notes?: string
}

/**
 * Foundation. Combined UCS + APT Corrective + Hip Mobility.
 *
 * Two sections:
 * - Upper Body, Release & Activate (UCS focus: chest release, shoulder activation)
 * - Lower Body, Hips & Spine (APT focus: glute activation, hip flexor lengthening, hip mobility)
 *
 * 19 exercises, ~25 min. Body-mind ritual with intentional pacing.
 */
export const POSTURE_TEMPLATE: PostureExerciseTemplate[] = [
  // ── Upper Body, Release & Activate ─────────────────────────
  {
    exerciseId: 'ex-foam-roll-pecs',
    label: 'Foam Roll Pecs',
    section: 'upper',
    sets: 1,
    holdSec: 60,
    reps: null,
    notes: 'Releases the chest tightness from desk posture. Opens your shoulders for stronger hooks and guard position.',
  },
  {
    exerciseId: 'ex-foam-roll-traps',
    label: 'Foam Roll Upper Traps',
    section: 'upper',
    sets: 1,
    holdSec: 60,
    reps: null,
    notes: 'Drops the tension that climbs into your neck and shoulders from stress and screen time.',
  },
  {
    exerciseId: 'ex-foam-roll-hip-flexors',
    label: 'Foam Roll Hip Flexors',
    section: 'upper',
    sets: 1,
    holdSec: 60,
    reps: null,
    notes: 'These shorten from sitting. Releasing them before stretching gets better range. 60s each side.',
  },
  {
    exerciseId: 'ex-doorway-pec-stretch',
    label: 'Doorway Pec Stretch',
    section: 'upper',
    sets: 1,
    holdSec: 30,
    reps: null,
    notes: 'Opens the chest wall that desk posture closes down. 30s each side, breathe into it.',
  },
  {
    exerciseId: 'ex-hip-flexor-stretch',
    label: 'Hip Flexor Stretch',
    section: 'upper',
    sets: 1,
    holdSec: 30,
    reps: null,
    notes: 'Lengthens the muscles pulling your pelvis forward. Squeeze the back glute, tuck tailbone. 30s each side.',
  },
  {
    exerciseId: 'ex-ytw-raises',
    label: 'Y-T-W Raises',
    section: 'upper',
    sets: 2,
    holdSec: null,
    reps: 10,
    notes: 'Activates the muscles between your shoulder blades that pull your posture back into fighter position.',
  },
  {
    exerciseId: 'ex-chin-tucks',
    label: 'Chin Tucks',
    section: 'upper',
    sets: 2,
    holdSec: 5,
    reps: 10,
    notes: 'Strengthens the deep neck muscles that counteract forward head posture. Hold 5s each. Think "tall spine."',
  },
  {
    exerciseId: 'ex-band-pull-aparts',
    label: 'Band Pull-Aparts',
    section: 'upper',
    sets: 2,
    holdSec: null,
    reps: 15,
    notes: 'Wakes up the rhomboids and rear delts, the muscles that hold your shoulders back all day.',
  },
  {
    exerciseId: 'ex-wall-angels',
    label: 'Wall Angels',
    section: 'upper',
    sets: 2,
    holdSec: null,
    reps: 10,
    notes: 'Restores overhead mobility and teaches your body to keep shoulders back under load.',
  },

  // ── Lower Body, Hips & Spine ───────────────────────────────
  {
    exerciseId: 'ex-glute-bridges',
    label: 'Glute Bridges',
    section: 'lower',
    sets: 2,
    holdSec: null,
    reps: 15,
    notes: 'Reactivates the glutes that "turn off" from sitting. This is the foundation of pelvic stability and kick power.',
  },
  {
    exerciseId: 'ex-dead-bugs',
    label: 'Dead Bugs',
    section: 'lower',
    sets: 2,
    holdSec: null,
    reps: 10,
    notes: 'Teaches your core to stabilize while limbs move, exactly what happens in fighting. 10 each side, back stays flat.',
  },
  {
    exerciseId: 'ex-bird-dogs',
    label: 'Bird Dogs',
    section: 'lower',
    sets: 2,
    holdSec: null,
    reps: 10,
    notes: 'Builds cross-body stability that protects your spine and powers rotational strikes. 10 each side.',
  },
  {
    exerciseId: 'ex-cat-cow',
    label: 'Cat-Cow',
    section: 'lower',
    sets: 2,
    holdSec: null,
    reps: 10,
    notes: 'Warms up every segment of your spine. Move slowly with breath. This is spinal hygiene.',
  },
  {
    exerciseId: 'ex-pigeon-stretch',
    label: 'Pigeon Stretch',
    section: 'lower',
    sets: 1,
    holdSec: 45,
    reps: null,
    notes: 'Opens the deep hip rotators that get locked from sitting. 45s each side, sink in and breathe.',
  },
  {
    exerciseId: 'ex-cossack-squats',
    label: 'Cossack Squats',
    section: 'lower',
    sets: 2,
    holdSec: null,
    reps: 8,
    notes: 'Builds the hip mobility you need for powerful kicks and low guards. 8 each side.',
  },
  {
    exerciseId: 'ex-90-90-hip-switches',
    label: '90/90 Hip Switches',
    section: 'lower',
    sets: 2,
    holdSec: null,
    reps: 10,
    notes: 'Opens both internal and external hip rotation, range most desk workers have completely lost.',
  },
  {
    exerciseId: 'ex-psoas-stretch',
    label: 'Psoas March',
    section: 'lower',
    sets: 2,
    holdSec: null,
    reps: 10,
    notes: 'Lengthens and activates the deepest hip flexor, the main driver of pelvic tilt from sitting. 10 each side.',
  },
  {
    exerciseId: 'ex-wall-hip-cars',
    label: 'Wall Hip CARs',
    section: 'lower',
    sets: 2,
    holdSec: null,
    reps: 8,
    notes: 'Controlled articular rotation. Builds the usable hip range that translates directly to kicks. 8 each direction.',
  },
  {
    exerciseId: 'ex-sciatic-nerve-glide',
    label: 'Sciatic Nerve Glide',
    section: 'lower',
    sets: 2,
    holdSec: null,
    reps: 10,
    notes: 'Mobilizes the sciatic nerve that gets compressed from prolonged sitting. Gentle, never push into pain. 10 each side.',
  },
]

/** Section display labels for Foundation UI. */
export const POSTURE_SECTION_LABELS: Record<PostureSection, string> = {
  upper: 'Upper Body, Release & Activate',
  lower: 'Lower Body, Hips & Spine',
}
