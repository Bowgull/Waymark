/**
 * Seed script for Waymark local D1 database.
 *
 * Usage: npx wrangler d1 execute waymark-db --local --file=./src/db/seed.sql
 *
 * This file generates seed.sql — run `npx tsx src/db/seed.ts` to produce it,
 * then execute the SQL against D1.
 *
 * Alternatively, this exports the raw data arrays for use in API seed endpoints.
 */

import { writeFileSync } from 'fs'

const now = Math.floor(Date.now() / 1000)

// ─── Exercises ─────────────────────────────────────────────────

interface Exercise {
  id: string
  name: string
  category: string
  muscleGroups: string
  equipment: string
  formCues: string
  formVideoUrl: string | null
}

const exercises: Exercise[] = [
  // ── Strength: Main Lifts ────────────────────────────────────
  {
    id: 'ex-front-squat',
    name: 'Front Squat',
    category: 'strength',
    muscleGroups: 'quads,glutes,core',
    equipment: 'barbell',
    formCues: 'Elbows high, chest proud. This keeps the bar secure and your spine stacked. Push the floor away to stand. Heel-elevated shoes help if ankles are tight.',
    formVideoUrl: 'https://www.youtube.com/watch?v=v-mQm_droHg',
  },
  {
    id: 'ex-bench-press',
    name: 'Bench Press',
    category: 'strength',
    muscleGroups: 'chest,shoulders,triceps',
    equipment: 'barbell,bench',
    formCues: 'Squeeze shoulder blades together like you\'re holding a pencil. This protects your shoulders and builds a stronger press. Drive feet into the floor. Bar touches mid-chest.',
    formVideoUrl: 'https://www.youtube.com/watch?v=vcBig73ojpE',
  },
  {
    id: 'ex-ohp',
    name: 'Overhead Press',
    category: 'strength',
    muscleGroups: 'shoulders,triceps',
    equipment: 'barbell',
    formCues: 'Ribs down, squeeze glutes. This locks your core into a strong brace position. Bar starts at collarbone, press straight up. Head moves through at the top.',
    formVideoUrl: 'https://www.youtube.com/watch?v=_RlRDWO2jfg',
  },
  {
    id: 'ex-bent-over-row',
    name: 'Bent Over Row',
    category: 'strength',
    muscleGroups: 'back,biceps,rear_delts',
    equipment: 'barbell',
    formCues: 'Hinge at hips, flat back. Pull to lower chest and squeeze shoulder blades together at the top. This directly fights the forward-shoulder posture from desk work.',
    formVideoUrl: 'https://www.youtube.com/watch?v=G8l_8chR5BE',
  },
  {
    id: 'ex-rdl',
    name: 'Romanian Deadlift',
    category: 'strength',
    muscleGroups: 'hamstrings,glutes,lower_back',
    equipment: 'barbell',
    formCues: 'Push hips back like closing a car door. This teaches the hip hinge pattern safely. Bar slides down your legs. Feel the stretch in your hamstrings, then squeeze glutes to stand.',
    formVideoUrl: 'https://www.youtube.com/watch?v=jEy_czb3RKA',
  },
  {
    id: 'ex-block-pull',
    name: 'Block Pull',
    category: 'strength',
    muscleGroups: 'back,glutes,hamstrings',
    equipment: 'barbell,blocks',
    formCues: 'Same as conventional deadlift but bar starts elevated. This lets you practice pulling mechanics with less range. Ribs down, push the floor away. Build to full range.',
    formVideoUrl: 'https://www.youtube.com/watch?v=ZR5t8K487dQ',
  },
  {
    id: 'ex-deadlift',
    name: 'Conventional Deadlift',
    category: 'strength',
    muscleGroups: 'back,glutes,hamstrings,quads',
    equipment: 'barbell',
    formCues: 'Push the floor away. Don\'t think "pull the bar up." Ribs down, belt buckle to chin at lockout. Squeeze glutes at the top. You earned this progression.',
    formVideoUrl: 'https://www.youtube.com/watch?v=wYREQkVtvEc',
  },

  // ── Strength: Accessories ───────────────────────────────────
  {
    id: 'ex-incline-db-press',
    name: 'Incline DB Press',
    category: 'strength',
    muscleGroups: 'chest,shoulders,triceps',
    equipment: 'dumbbell,bench',
    formCues: 'Bench at 30 degrees. Pin shoulder blades back. This protects your shoulders and builds a bigger chest. Press up without letting shoulders roll forward.',
    formVideoUrl: 'https://www.youtube.com/watch?v=8iPEnn-ltC8',
  },
  {
    id: 'ex-lateral-raise',
    name: 'Lateral Raise',
    category: 'strength',
    muscleGroups: 'shoulders',
    equipment: 'dumbbell',
    formCues: 'Slight lean forward, lead with elbows. This targets the side delt and builds wider shoulders. Raise to shoulder height, control the descent. Light weight, high reps.',
    formVideoUrl: 'https://www.youtube.com/watch?v=3VcKaXpzqRo',
  },
  {
    id: 'ex-ez-curl',
    name: 'EZ Bar Curl',
    category: 'strength',
    muscleGroups: 'biceps,forearms',
    equipment: 'ez-bar',
    formCues: 'Elbows pinned to your sides. This isolates the biceps and prevents cheating. Squeeze at the top, slow descent. The angled grip is easier on your wrists.',
    formVideoUrl: 'https://www.youtube.com/watch?v=zG2xJ0Q5QtI',
  },
  {
    id: 'ex-bulgarian-split-squat',
    name: 'Bulgarian Split Squat',
    category: 'strength',
    muscleGroups: 'quads,glutes,balance',
    equipment: 'dumbbell,bench',
    formCues: 'Rear foot on bench, front foot far enough out that your knee stays over ankle. Lean slightly forward. This builds single-leg strength and fixes side-to-side imbalances.',
    formVideoUrl: 'https://www.youtube.com/watch?v=2C-uNgKwPLE',
  },
  {
    id: 'ex-db-row',
    name: 'Dumbbell Row',
    category: 'strength',
    muscleGroups: 'back,biceps,rear_delts',
    equipment: 'dumbbell,bench',
    formCues: 'One hand and knee on bench. Pull to hip, not shoulder. This targets the lats more. Squeeze the shoulder blade back at the top. Each side independently.',
    formVideoUrl: 'https://www.youtube.com/watch?v=roCP6wCXPqo',
  },
  {
    id: 'ex-tricep-pushdown',
    name: 'Tricep Pushdown',
    category: 'strength',
    muscleGroups: 'triceps',
    equipment: 'cable',
    formCues: 'Elbows locked at your sides. This isolates the triceps. Squeeze at full extension. Control the return. Rope attachment gives the best range of motion.',
    formVideoUrl: 'https://www.youtube.com/watch?v=2-LAMcpzODU',
  },
  {
    id: 'ex-hammer-curl',
    name: 'Hammer Curl',
    category: 'strength',
    muscleGroups: 'biceps,brachioradialis,forearms',
    equipment: 'dumbbell',
    formCues: 'Neutral grip (palms face each other). This targets the brachioradialis and builds forearm strength for clinch work. Slow and controlled both directions.',
    formVideoUrl: 'https://www.youtube.com/watch?v=zC3nLlEvin4',
  },
  {
    id: 'ex-face-pulls',
    name: 'Face Pulls',
    category: 'strength',
    muscleGroups: 'rear_delts,rotator_cuff,traps',
    equipment: 'cable,band',
    formCues: 'Pull to your face, pinkies rotate back. This external rotation strengthens the rotator cuff and pulls your shoulders back. Non-negotiable for desk posture recovery.',
    formVideoUrl: 'https://www.youtube.com/watch?v=rep-qVOkqgk',
  },
  {
    id: 'ex-band-pull-aparts',
    name: 'Band Pull-Aparts',
    category: 'strength',
    muscleGroups: 'rear_delts,rhomboids,traps',
    equipment: 'band',
    formCues: 'Band at arm\'s length, pull apart until it touches your chest. This wakes up the muscles between your shoulder blades. High reps, every session warmup.',
    formVideoUrl: 'https://www.youtube.com/watch?v=JObYtU7Y7ag',
  },

  // ── Strength: Pull-Up Progression ───────────────────────────
  {
    id: 'ex-pullup-band',
    name: 'Pull-Up (Band Assisted)',
    category: 'strength',
    muscleGroups: 'back,biceps,core',
    equipment: 'pull-up bar,band',
    formCues: 'Full dead hang at bottom, chin clears bar at top. The band assists the hardest part. Pull with your lats, not just arms. Progress to thinner bands over time.',
    formVideoUrl: 'https://www.youtube.com/watch?v=4yE-XGDWJPg',
  },
  {
    id: 'ex-pullup-negative',
    name: 'Pull-Up (Negative)',
    category: 'strength',
    muscleGroups: 'back,biceps,core',
    equipment: 'pull-up bar',
    formCues: 'Jump to top, lower yourself as slowly as possible. Aim for 5 seconds down. This builds the strength for real pull-ups faster than bands alone.',
    formVideoUrl: 'https://www.youtube.com/watch?v=4yE-XGDWJPg',
  },
  {
    id: 'ex-pullup',
    name: 'Pull-Up',
    category: 'strength',
    muscleGroups: 'back,biceps,core',
    equipment: 'pull-up bar',
    formCues: 'Dead hang, shoulder-width grip. Pull until chin clears bar. This builds the back strength that powers clinch work and counters desk posture. Control the descent.',
    formVideoUrl: 'https://www.youtube.com/watch?v=eGo4IYlbE5g',
  },

  // ── Core Circuit A (Anti-Extension) ─────────────────────────
  {
    id: 'ex-ab-wheel',
    name: 'Ab Wheel Roll-Out',
    category: 'core',
    muscleGroups: 'abs,lats,shoulders',
    equipment: 'ab wheel',
    formCues: 'Squeeze glutes and brace hard. Roll out only as far as you can without your lower back dipping. This is the highest EMG activation core exercise you can do.',
    formVideoUrl: 'https://www.youtube.com/watch?v=rqiTPdK1c_I',
  },
  {
    id: 'ex-hanging-leg-raise',
    name: 'Hanging Leg Raise',
    category: 'core',
    muscleGroups: 'lower_abs,hip_flexors',
    equipment: 'pull-up bar',
    formCues: 'Dead hang, raise legs to parallel without swinging. This forces your abs to work against gravity. Bend knees if straight legs are too hard. Posterior pelvic tilt at the top.',
    formVideoUrl: 'https://www.youtube.com/watch?v=Pr1ieGZ5atk',
  },
  {
    id: 'ex-pallof-press',
    name: 'Pallof Press',
    category: 'core',
    muscleGroups: 'abs,obliques',
    equipment: 'cable,band',
    formCues: 'Stand sideways to cable, press hands straight out and resist the rotation. This builds the anti-rotation stability that protects your spine during strikes and clinch.',
    formVideoUrl: 'https://www.youtube.com/watch?v=AH_QZLm_0-s',
  },
  {
    id: 'ex-side-plank-lift',
    name: 'Side Plank Hip Lift',
    category: 'core',
    muscleGroups: 'obliques,glutes',
    equipment: 'bodyweight',
    formCues: 'Side plank on elbow, drop hip to floor and lift. This builds the lateral stability that powers kicks and resists sweeps. Each side independently.',
    formVideoUrl: 'https://www.youtube.com/watch?v=UhgQi_cz5zA',
  },

  // ── Core Circuit B (Rotational + Anti-Lateral) ──────────────
  {
    id: 'ex-body-saw',
    name: 'Body Saw',
    category: 'core',
    muscleGroups: 'abs,shoulders',
    equipment: 'sliders,towel',
    formCues: 'Forearm plank with feet on sliders, rock backward and forward. The further back, the harder. Keep ribs down and hips locked. One of the highest-demand plank variations.',
    formVideoUrl: 'https://www.youtube.com/watch?v=R9HJnAdJAUs',
  },
  {
    id: 'ex-cable-woodchop',
    name: 'Cable Woodchop',
    category: 'core',
    muscleGroups: 'obliques,abs,shoulders',
    equipment: 'cable',
    formCues: 'High-to-low or low-to-high. Rotate through your core, not your arms. Your hips and shoulders create the rotation. This builds the rotational power behind every strike.',
    formVideoUrl: 'https://www.youtube.com/watch?v=pAplQXk3dkU',
  },
  {
    id: 'ex-weighted-dead-bug',
    name: 'Weighted Dead Bug',
    category: 'core',
    muscleGroups: 'abs,hip_flexors',
    equipment: 'dumbbell',
    formCues: 'Hold a weight overhead, opposite arm and leg extend. Your lower back stays glued to the floor. This teaches your core to stabilize while your limbs move, exactly like fighting.',
    formVideoUrl: 'https://www.youtube.com/watch?v=4XLEnwUr1d8',
  },
  {
    id: 'ex-suitcase-carry',
    name: 'Suitcase Carry',
    category: 'core',
    muscleGroups: 'obliques,grip,traps',
    equipment: 'dumbbell,kettlebell',
    formCues: 'Heavy weight in one hand, walk tall without leaning. This builds the anti-lateral flexion strength that keeps you upright in the clinch. Switch sides each set.',
    formVideoUrl: 'https://www.youtube.com/watch?v=tNHdx7pmrGI',
  },

  // ── Foundation: Upper Body (UCS Corrective) ─────────────────
  {
    id: 'ex-foam-roll-pecs',
    name: 'Foam Roll Pecs',
    category: 'posture',
    muscleGroups: 'chest',
    equipment: 'lacrosse ball,wall',
    formCues: 'Ball against wall, lean into chest. Find the tight spots and breathe into them. This releases the chest tightness that pulls your shoulders forward from desk work.',
    formVideoUrl: 'https://www.youtube.com/watch?v=a8KjvtbkM8E',
  },
  {
    id: 'ex-foam-roll-traps',
    name: 'Foam Roll Upper Traps',
    category: 'posture',
    muscleGroups: 'traps,neck',
    equipment: 'lacrosse ball,wall',
    formCues: 'Ball between wall and upper traps, lean in and roll slowly. These muscles get rock-hard from stress and desk posture. Release them to drop your shoulders away from your ears.',
    formVideoUrl: 'https://www.youtube.com/watch?v=RcwfX-YKnIw',
  },
  {
    id: 'ex-foam-roll-hip-flexors',
    name: 'Foam Roll Hip Flexors',
    category: 'posture',
    muscleGroups: 'hip_flexors,quads',
    equipment: 'foam roller',
    formCues: 'Face down, roller on front of hip. Roll slowly from hip crease to mid-thigh. These muscles shorten from sitting all day and pull your pelvis into tilt. Release before stretching.',
    formVideoUrl: 'https://www.youtube.com/watch?v=z4JbDQHJ_2M',
  },
  {
    id: 'ex-doorway-pec-stretch',
    name: 'Doorway Pec Stretch',
    category: 'posture',
    muscleGroups: 'chest,front_delts',
    equipment: 'doorway',
    formCues: 'Forearm on doorframe at 90 degrees, step through gently. This opens the chest that desk posture closes down. Hold 30s each side. Breathe into the stretch.',
    formVideoUrl: 'https://www.youtube.com/watch?v=wwKWBwj-05U',
  },
  {
    id: 'ex-hip-flexor-stretch',
    name: 'Half-Kneeling Hip Flexor Stretch',
    category: 'posture',
    muscleGroups: 'hip_flexors,psoas',
    equipment: 'bodyweight',
    formCues: 'Back knee down, squeeze that glute and tuck your tailbone under. This lengthens the hip flexors that pull your pelvis forward from sitting. You should feel it in the front of the back hip.',
    formVideoUrl: 'https://www.youtube.com/watch?v=YQmpO9VT2X4',
  },
  {
    id: 'ex-ytw-raises',
    name: 'Y-T-W Raises',
    category: 'posture',
    muscleGroups: 'lower_traps,rear_delts,rotator_cuff',
    equipment: 'bodyweight',
    formCues: 'Face down or standing bent over. Make Y, T, and W shapes with arms. Squeeze shoulder blades together each time. This activates the muscles that pull your shoulders back and down.',
    formVideoUrl: 'https://www.youtube.com/watch?v=VCPp1DUypo0',
  },
  {
    id: 'ex-chin-tucks',
    name: 'Chin Tucks',
    category: 'posture',
    muscleGroups: 'deep_neck_flexors',
    equipment: 'bodyweight',
    formCues: 'Pull chin straight back like making a double chin. Hold 5 seconds. This strengthens the deep neck flexors that are weak from forward head posture. Think "tall spine."',
    formVideoUrl: 'https://www.youtube.com/watch?v=wQylqaCl8Zo',
  },
  {
    id: 'ex-wall-angels',
    name: 'Wall Angels',
    category: 'posture',
    muscleGroups: 'thoracic_spine,shoulders',
    equipment: 'wall',
    formCues: 'Back against wall, arms in goalpost position. Slide up and down keeping everything touching the wall. If your back arches, brace harder. This restores overhead mobility.',
    formVideoUrl: 'https://www.youtube.com/watch?v=M_ooIhKYs7c',
  },

  // ── Foundation: Lower Body (APT Corrective + Hips) ──────────
  {
    id: 'ex-glute-bridges',
    name: 'Glute Bridges',
    category: 'posture',
    muscleGroups: 'glutes,core',
    equipment: 'bodyweight',
    formCues: 'Squeeze glutes at the top, don\'t push through your lower back. This activates the glutes that "turn off" from sitting all day. Tuck tailbone slightly. Hold 2 seconds at top.',
    formVideoUrl: 'https://www.youtube.com/watch?v=tl6xvm4-Qk0',
  },
  {
    id: 'ex-dead-bugs',
    name: 'Dead Bugs',
    category: 'posture',
    muscleGroups: 'abs,hip_flexors,core',
    equipment: 'bodyweight',
    formCues: 'Lower back pressed into the floor. Opposite arm and leg extend out. If your back arches, you went too far. This teaches your core to stabilize your spine during movement.',
    formVideoUrl: 'https://www.youtube.com/watch?v=0XVbn86Btj0',
  },
  {
    id: 'ex-bird-dogs',
    name: 'Bird Dogs',
    category: 'posture',
    muscleGroups: 'core,glutes,lower_back',
    equipment: 'bodyweight',
    formCues: 'On all fours, extend opposite arm and leg. Keep your hips level, don\'t rotate. This builds the cross-body stability that protects your spine and powers rotational movement.',
    formVideoUrl: 'https://www.youtube.com/watch?v=wGh2fZU20-M',
  },
  {
    id: 'ex-cat-cow',
    name: 'Cat-Cow',
    category: 'posture',
    muscleGroups: 'spine,core',
    equipment: 'bodyweight',
    formCues: 'Arch up (cat), then drop belly and look up (cow). Move slowly with your breath. This warms up your entire spine and teaches segmental movement through each vertebra.',
    formVideoUrl: 'https://www.youtube.com/watch?v=y39PrKY_4JM',
  },
  {
    id: 'ex-pigeon-stretch',
    name: 'Pigeon Stretch',
    category: 'posture',
    muscleGroups: 'glutes,hip_flexors',
    equipment: 'bodyweight',
    formCues: 'Front leg bent, back leg extended. Sink hips down and breathe. This opens the deep hip rotators that get locked from sitting. Hold 45s each side. Don\'t force it.',
    formVideoUrl: 'https://www.youtube.com/watch?v=Ms6VMXPq2uU',
  },
  {
    id: 'ex-cossack-squats',
    name: 'Cossack Squats',
    category: 'posture',
    muscleGroups: 'adductors,hips,ankles',
    equipment: 'bodyweight',
    formCues: 'Wide stance, shift to one side and sink deep. The other leg stays straight. This builds the hip mobility you need for powerful kicks and low guards.',
    formVideoUrl: 'https://www.youtube.com/watch?v=tpczTeSkHz0',
  },
  {
    id: 'ex-90-90-hip-switches',
    name: '90/90 Hip Switches',
    category: 'posture',
    muscleGroups: 'hips,glutes',
    equipment: 'bodyweight',
    formCues: 'Both legs at 90 degrees, rotate knees to switch sides, smooth and controlled. This opens both internal and external hip rotation, which most desk workers have lost.',
    formVideoUrl: 'https://www.youtube.com/watch?v=qq_Z7sAmVrA',
  },
  {
    id: 'ex-psoas-stretch',
    name: 'Psoas March',
    category: 'posture',
    muscleGroups: 'psoas,hip_flexors',
    equipment: 'bodyweight',
    formCues: 'Supine, band around feet. Slow marching motion with core braced. The psoas is the deepest hip flexor and the main driver of pelvic tilt from sitting. This lengthens and activates it.',
    formVideoUrl: 'https://www.youtube.com/watch?v=vHIJgPO3p9Q',
  },
  {
    id: 'ex-wall-hip-cars',
    name: 'Wall Hip CARs',
    category: 'posture',
    muscleGroups: 'hips',
    equipment: 'wall',
    formCues: 'Hands on wall for balance. Lift knee high and rotate outward in the largest circle you can control, then reverse. This builds the usable hip range that translates to kicks.',
    formVideoUrl: 'https://www.youtube.com/watch?v=5kM-o61Z14I',
  },
  {
    id: 'ex-sciatic-nerve-glide',
    name: 'Sciatic Nerve Glide',
    category: 'posture',
    muscleGroups: 'sciatic_nerve,hamstrings',
    equipment: 'bodyweight',
    formCues: 'Seated, extend one leg while flexing foot. Gently rock between pointed and flexed toe. This mobilizes the sciatic nerve that gets compressed from sitting. Never push into pain.',
    formVideoUrl: 'https://www.youtube.com/watch?v=OMbKv94Bu_U',
  },

  // ── Daily Mobility (added in mobility refactor) ─────────────
  {
    id: 'ex-crocodile-breathing',
    name: 'Crocodile Breathing',
    category: 'mobility',
    muscleGroups: 'diaphragm,ribcage',
    equipment: 'bodyweight',
    formCues: 'Face down, forehead on hands. Breathe into your lower back and ribs, not your chest. Resets the diaphragm that shallow chest breathing has parked.',
    formVideoUrl: 'https://www.youtube.com/watch?v=2ibSb6jQ3Ec',
  },
  {
    id: 'ex-foam-roll-thoracic',
    name: 'Thoracic Extension on Foam Roller',
    category: 'mobility',
    muscleGroups: 'thoracic_spine,upper_back',
    equipment: 'foam roller',
    formCues: 'Roller under mid-back, hands behind head. Let the spine extend backwards. This is the single best move against desk kyphosis.',
    formVideoUrl: 'https://www.youtube.com/watch?v=WTwJNj1IjXI',
  },
  {
    id: 'ex-prone-cobra',
    name: 'Prone Cobra',
    category: 'mobility',
    muscleGroups: 'posterior_chain,lower_traps,rear_delts',
    equipment: 'bodyweight',
    formCues: 'Lie face down, lift chest and arms, thumbs up. Hold 3s. Activates the entire posterior chain the desk switches off.',
    formVideoUrl: 'https://www.youtube.com/watch?v=LWDUyq4TRMU',
  },
  {
    id: 'ex-band-external-rotation',
    name: 'Band External Rotations',
    category: 'mobility',
    muscleGroups: 'rear_delts,rotator_cuff',
    equipment: 'band',
    formCues: 'Elbow tucked to side, rotate forearm outward against band. 10 each arm. Rear delt and rotator cuff, the muscles that pull shoulders back.',
    formVideoUrl: 'https://www.youtube.com/watch?v=lw5jkvrLwVw',
  },
  {
    id: 'ex-couch-stretch',
    name: 'Couch Stretch',
    category: 'mobility',
    muscleGroups: 'hip_flexors,quads',
    equipment: 'bodyweight,couch',
    formCues: 'Back foot on couch, front knee forward, tuck tailbone and squeeze back glute. 30s each side. Deep hip flexor lengthening that a standing stretch can not reach.',
    formVideoUrl: 'https://www.youtube.com/shorts/TML8Vqy-ACQ',
  },
  {
    id: 'ex-worlds-greatest-stretch',
    name: "World's Greatest Stretch",
    category: 'mobility',
    muscleGroups: 'hips,groin,thoracic_spine',
    equipment: 'bodyweight',
    formCues: 'Lunge, hand inside front foot, rotate top arm to ceiling. 30s each side. Opens hip, groin, and thoracic spine in one move.',
    formVideoUrl: 'https://www.youtube.com/watch?v=-CiWQ2IvY34',
  },
  {
    id: 'ex-ankle-cars',
    name: 'Ankle CARs',
    category: 'mobility',
    muscleGroups: 'ankles',
    equipment: 'bodyweight',
    formCues: 'Controlled articular rotations. Slow full circles, both directions, each ankle. Dorsiflexion quality drives squat depth and kick mechanics.',
    formVideoUrl: 'https://www.youtube.com/watch?v=6iht_ecV1Go',
  },

  // ── Removed: ex-foam-roller-thoracic (merged into foam roll series) ──
  // ── Removed: ex-wall-slides (replaced by wall angels) ──
  // ── Removed: ex-prone-y-raises (replaced by YTW raises) ──
  // ── Removed: ex-v-ups, ex-russian-twists, ex-landmine-press (replaced by research-backed selections) ──

  // ── Zone 2 warmup (standing dynamic, pre-run) ──────────────────
  {
    id: 'ex-walking-knee-hugs',
    name: 'Walking Knee Hugs',
    category: 'mobility',
    muscleGroups: 'hip_flexors,glutes',
    equipment: 'bodyweight',
    formCues: 'Step forward, pull opposite knee to chest for a beat, release and walk through. 6 per side. Dynamic hip flexor open, counters sitting-driven APT.',
    formVideoUrl: 'https://www.youtube.com/watch?v=GVU4paANHoE',
  },
  {
    id: 'ex-walking-quad-pulls',
    name: 'Walking Quad Pulls',
    category: 'mobility',
    muscleGroups: 'quads,hip_flexors',
    equipment: 'bodyweight',
    formCues: 'Step, grab same-side ankle behind you, squeeze glute for a beat, walk through. 6 per side. Lengthens rectus femoris on the move.',
    formVideoUrl: 'https://www.youtube.com/watch?v=yGN2Z6XkWNQ',
  },
  {
    id: 'ex-spiderman-tspine',
    name: 'Spiderman + T-Spine Rotation',
    category: 'mobility',
    muscleGroups: 'hips,adductors,thoracic_spine',
    equipment: 'bodyweight',
    formCues: 'Low lunge, hand inside front foot, rotate top arm to ceiling and follow with your eyes. 5 per side. Hip, hamstring, and thoracic rotation in one.',
    formVideoUrl: 'https://www.youtube.com/watch?v=nOqMAsvRJ90',
  },
  {
    id: 'ex-lateral-lunges',
    name: 'Lateral Lunges',
    category: 'mobility',
    muscleGroups: 'adductors,glutes,quads',
    equipment: 'bodyweight',
    formCues: 'Step wide, sit into one hip, other leg stays straight. 6 per side. Adductor and glute medius — frontal plane prep runners skip.',
    formVideoUrl: 'https://www.youtube.com/watch?v=4NlJdSzHeUg',
  },
  {
    id: 'ex-a-skips',
    name: 'A-Skips',
    category: 'mobility',
    muscleGroups: 'calves,hip_flexors,glutes',
    equipment: 'bodyweight',
    formCues: 'Light skip, drive lead knee to 90, opposite arm swings. 30s easy. Primes stride mechanics. Stay bouncy, not hard.',
    formVideoUrl: 'https://www.youtube.com/watch?v=GQg9L28bi1g',
  },

  // ── Zone 2 static pre-run stretches (replaces the dynamic set above) ──
  {
    id: 'ex-toe-touch-forward-fold',
    name: 'Toe-Touch Forward Fold',
    category: 'posture',
    muscleGroups: 'hamstrings,calves,low_back',
    equipment: 'bodyweight',
    formCues: 'Feet hip-width, fold from the hips, let the head hang. Soft knees if the hamstrings grip. 45s. Full posterior chain opens in one move.',
    formVideoUrl: 'https://www.youtube.com/watch?v=tlVT41u7bUQ',
  },
  {
    id: 'ex-butterfly-stretch',
    name: 'Butterfly Stretch',
    category: 'posture',
    muscleGroups: 'adductors,hips',
    equipment: 'bodyweight',
    formCues: 'Soles together, knees fall open, fold forward from the hips. 60s. Adductor and inner-hip length sitting closes off.',
    formVideoUrl: 'https://www.youtube.com/watch?v=b2DBNGlZfpo',
  },
  {
    id: 'ex-standing-quad-stretch',
    name: 'Standing Quad Stretch',
    category: 'posture',
    muscleGroups: 'quads,hip_flexors',
    equipment: 'bodyweight',
    formCues: 'Stand, grab the ankle behind you, knees together, squeeze the back glute. 30s each side. Rectus femoris and hip flexor, direct counter to APT.',
    formVideoUrl: 'https://www.youtube.com/watch?v=UGEpQ1BRx-4',
  },
  {
    id: 'ex-standing-calf-stretch',
    name: 'Standing Calf Stretch',
    category: 'posture',
    muscleGroups: 'calves,achilles',
    equipment: 'bodyweight',
    formCues: 'Hands on wall, back leg straight, press the heel down. 30s each side. Gastrocnemius and Achilles, the chain that takes every step of impact.',
    formVideoUrl: 'https://www.youtube.com/watch?v=f1HzSAuB-Vw',
  },
]

// ─── Training Maxes ───────────────────────────────────────────

interface TrainingMax {
  exerciseId: string
  weightKg: number
}

const trainingMaxes: TrainingMax[] = [
  { exerciseId: 'ex-front-squat', weightKg: 47.6 },    // 105lb
  { exerciseId: 'ex-bench-press', weightKg: 52.2 },     // 115lb
  { exerciseId: 'ex-ohp', weightKg: 31.8 },             // 70lb
  { exerciseId: 'ex-bent-over-row', weightKg: 47.6 },   // 105lb
  { exerciseId: 'ex-rdl', weightKg: 63.5 },             // 140lb (deadlift TM, starts with RDL)
  { exerciseId: 'ex-block-pull', weightKg: 63.5 },      // same TM for all DL variants
  { exerciseId: 'ex-deadlift', weightKg: 63.5 },        // same TM for all DL variants
]

// ─── Combos (5-tier research-backed progression) ──────────────

interface Combo {
  id: string
  text: string
  tier: string
  level: string
  techniques: string
  formTips: string
  unlocked: number
}

const combos: Combo[] = [
  // Tier 1 — Foundation (Hands Only) — ALL UNLOCKED
  { id: 'combo-f01', text: 'Jab → Cross', tier: 'foundation', level: 'foundation', techniques: 'boxing', formTips: 'Rotate the hip fully on the cross. Power comes from the ground, not the arm.', unlocked: 1 },
  { id: 'combo-f02', text: 'Jab → Cross → Hook', tier: 'foundation', level: 'foundation', techniques: 'boxing', formTips: 'Keep the hook tight at 90 degrees. Don\'t let the elbow flare wide.', unlocked: 1 },
  { id: 'combo-f03', text: 'Double Jab → Cross', tier: 'foundation', level: 'foundation', techniques: 'boxing', formTips: 'The second jab sets up range. Don\'t rush it. Make both jabs snap.', unlocked: 1 },
  { id: 'combo-f04', text: 'Jab → Cross → Hook → Cross', tier: 'foundation', level: 'foundation', techniques: 'boxing', formTips: 'Return hands to guard between each strike. Reset beats speed.', unlocked: 1 },
  { id: 'combo-f05', text: 'Jab → Body Cross → Lead Hook', tier: 'foundation', level: 'foundation', techniques: 'boxing', formTips: 'Drop your level for the body cross by bending the knees, not the waist.', unlocked: 1 },
  { id: 'combo-f06', text: 'Lead Hook → Cross', tier: 'foundation', level: 'foundation', techniques: 'boxing', formTips: 'Weight shifts from lead to rear on the cross. Feel the transfer through the hips.', unlocked: 1 },

  // Tier 2 — Weapons (Adding Kicks + Teep) — LOCKED
  { id: 'combo-w01', text: 'Jab → Cross → Rear Roundhouse', tier: 'weapons', level: 'weapons', techniques: 'boxing,kicks', formTips: 'Turn the hip over on the kick. Your belly button should face the bag at impact.', unlocked: 0 },
  { id: 'combo-w02', text: 'Jab → Cross → Switch Kick', tier: 'weapons', level: 'weapons', techniques: 'boxing,kicks', formTips: 'Snap the switch fast. The kick power comes from the hip switch, not the leg.', unlocked: 0 },
  { id: 'combo-w03', text: 'Jab → Cross → Low Kick', tier: 'weapons', level: 'weapons', techniques: 'boxing,kicks', formTips: 'Chop down through the target on the low kick. Shin contact, not the foot.', unlocked: 0 },
  { id: 'combo-w04', text: 'Jab → Cross → Hook → Low Kick', tier: 'weapons', level: 'weapons', techniques: 'boxing,kicks', formTips: 'Plant and reset after the hook before throwing the low kick.', unlocked: 0 },
  { id: 'combo-w05', text: 'Jab → Jab → Teep', tier: 'weapons', level: 'weapons', techniques: 'boxing,defensive', formTips: 'Push through the teep with the hip. Snap the foot back fast to guard.', unlocked: 0 },
  { id: 'combo-w06', text: 'Jab → Cross → Body Kick', tier: 'weapons', level: 'weapons', techniques: 'boxing,kicks', formTips: 'Lean slightly away from the kick for counterbalance. Arm swings down.', unlocked: 0 },
  { id: 'combo-w07', text: 'Teep → Jab → Cross', tier: 'weapons', level: 'weapons', techniques: 'boxing,defensive', formTips: 'Use the teep to create range, then step in behind the jab.', unlocked: 0 },

  // Tier 3 — Flow (Longer Combos + Level Changes) — LOCKED
  { id: 'combo-fl01', text: 'Cross → Hook → Cross → Left Kick', tier: 'flow', level: 'flow', techniques: 'boxing,kicks', formTips: 'Stay on the balls of your feet throughout. Don\'t plant flat between strikes.', unlocked: 0 },
  { id: 'combo-fl02', text: 'Double Jab → Cross → Right Kick', tier: 'flow', level: 'flow', techniques: 'boxing,kicks', formTips: 'The double jab walks you into range for the kick. Don\'t overcommit the cross.', unlocked: 0 },
  { id: 'combo-fl03', text: 'Inside Low Kick → Cross → Hook', tier: 'flow', level: 'flow', techniques: 'boxing,kicks', formTips: 'Step at an angle with the inside low kick to open the line for the cross.', unlocked: 0 },
  { id: 'combo-fl04', text: 'Jab → Cross → Lead Hook Body → Rear Roundhouse', tier: 'flow', level: 'flow', techniques: 'boxing,kicks', formTips: 'Change levels smoothly. Dip for the body hook, then rise into the kick.', unlocked: 0 },
  { id: 'combo-fl05', text: 'Right Leg Kick → Jab → Cross → Left Leg Kick', tier: 'flow', level: 'flow', techniques: 'boxing,kicks', formTips: 'Return hands to guard between the opening kick and the jab.', unlocked: 0 },
  { id: 'combo-fl06', text: 'Jab → Cross → Hook → Pivot Out', tier: 'flow', level: 'flow', techniques: 'boxing', formTips: 'Pivot on the lead foot. Exit at 45 degrees, not straight back.', unlocked: 0 },

  // Tier 4 — Deception (Feints + Defense + Counters) — LOCKED
  { id: 'combo-d01', text: 'Feint Jab → Cross → Left Kick → Step Out', tier: 'deception', level: 'deception', techniques: 'boxing,kicks,defensive', formTips: 'Make the feint convincing. Commit the shoulder, then fire the cross off the reaction.', unlocked: 0 },
  { id: 'combo-d02', text: 'Jab → Feint Teep → Cross → Hook → Reset', tier: 'deception', level: 'deception', techniques: 'boxing,defensive', formTips: 'Lift the knee for the feint teep like a real one. The sell is in the chamber.', unlocked: 0 },
  { id: 'combo-d03', text: 'Feint Low Kick → Cross → Hook → Left Body Kick', tier: 'deception', level: 'deception', techniques: 'boxing,kicks,defensive', formTips: 'The feint drops their guard low. Attack high off their reaction.', unlocked: 0 },
  { id: 'combo-d04', text: 'Jab → Check → Cross → Hook → Right Kick', tier: 'deception', level: 'deception', techniques: 'boxing,kicks,defensive', formTips: 'Lift the check sharp and fast, then immediately drive the cross.', unlocked: 0 },
  { id: 'combo-d05', text: 'Cross → Hook → Cross → Step Off', tier: 'deception', level: 'deception', techniques: 'boxing,defensive', formTips: 'The step off is the exit. Don\'t admire the work. Move your feet.', unlocked: 0 },
  { id: 'combo-d06', text: 'Teep → Step Back → Cross → Hook → Low Kick', tier: 'deception', level: 'deception', techniques: 'boxing,kicks,defensive', formTips: 'Use the step back to draw them forward, then punish the advance.', unlocked: 0 },
  { id: 'combo-d07', text: 'Slip → Cross → Hook → Low Kick', tier: 'deception', level: 'deception', techniques: 'boxing,kicks,defensive', formTips: 'Slip with the knees, not the waist. Keep your eyes on the target.', unlocked: 0 },

  // Tier 5 — Mastery (Complex Sequences) — LOCKED
  { id: 'combo-m01', text: 'Double Jab → Feint → Right Kick → Reset', tier: 'mastery', level: 'mastery', techniques: 'boxing,kicks,defensive', formTips: 'The feint between the jab and kick creates hesitation. Timing over power.', unlocked: 0 },
  { id: 'combo-m02', text: 'Jab → Cross → Hook → Check → Teep', tier: 'mastery', level: 'mastery', techniques: 'boxing,defensive', formTips: 'Transition from offense to defense and back. The check resets your stance.', unlocked: 0 },
  { id: 'combo-m03', text: 'Jab → Cross → Feint → Low Kick → Exit', tier: 'mastery', level: 'mastery', techniques: 'boxing,kicks,defensive', formTips: 'The feint before the low kick freezes the guard high. Attack what opens.', unlocked: 0 },
  { id: 'combo-m04', text: 'Feint Teep → Cross → Hook → Cross → Reset', tier: 'mastery', level: 'mastery', techniques: 'boxing,defensive', formTips: 'Three-piece after the feint must flow without pause. Commit to the rhythm.', unlocked: 0 },
  { id: 'combo-m05', text: 'Parry → Cross → Lead Hook → Rear Kick', tier: 'mastery', level: 'mastery', techniques: 'boxing,kicks,defensive', formTips: 'The parry is active. Pull the jab offline, then counter immediately.', unlocked: 0 },
]

// ─── Generate SQL ──────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/'/g, "''")
}

const lines: string[] = []

// Exercises
for (const e of exercises) {
  const videoVal = e.formVideoUrl ? `'${esc(e.formVideoUrl)}'` : 'NULL'
  lines.push(
    `INSERT OR REPLACE INTO exercises (id, name, category, muscle_groups, equipment, form_cues, form_video_url, created_at) VALUES ('${e.id}', '${esc(e.name)}', '${e.category}', '${e.muscleGroups}', '${esc(e.equipment)}', '${esc(e.formCues)}', ${videoVal}, ${now});`
  )
}

// Note: removed exercises (ex-v-ups, ex-russian-twists, ex-landmine-press, ex-foam-roller-thoracic, ex-wall-slides, ex-prone-y-raises)
// are left in DB to avoid FK constraint issues with existing sessions. They won't appear in new templates.

// Combos — use REPLACE to update existing rows with new tier/technique data
for (const c of combos) {
  lines.push(
    `INSERT OR REPLACE INTO combos (id, text, tier, level, unlocked, mastery_score, techniques, form_tips, is_favourite, times_sharp, created_at) VALUES ('${c.id}', '${esc(c.text)}', '${c.tier}', '${c.level}', ${c.unlocked}, 0, '${c.techniques}', '${esc(c.formTips)}', 0, 0, ${now});`
  )
}

// Clean up old combo IDs that no longer exist
lines.push(`DELETE FROM bag_work_round_combos WHERE combo_id LIKE 'combo-p%' OR combo_id LIKE 'combo-ls%';`)
lines.push(`DELETE FROM combos WHERE id LIKE 'combo-p%' OR id LIKE 'combo-ls%';`)

// Training maxes
for (const tm of trainingMaxes) {
  lines.push(
    `INSERT OR REPLACE INTO training_maxes (id, exercise_id, weight_kg, updated_at) VALUES ('tm-${tm.exerciseId}', '${tm.exerciseId}', ${tm.weightKg}, ${now});`
  )
}

// Default settings row
lines.push(
  `INSERT OR IGNORE INTO settings (id, mt_class_days, am_reminder, pm_lead_min, created_at, updated_at) VALUES ('default', '1,3,5', '06:30', 60, ${now}, ${now});`
)

const sql = lines.join('\n')
writeFileSync('src/db/seed.sql', sql)
console.log(`Wrote ${lines.length} statements to src/db/seed.sql`)

export { exercises, combos, trainingMaxes }
