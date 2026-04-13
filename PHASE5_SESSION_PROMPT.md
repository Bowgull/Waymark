# Phase 5: Program + Weight Intelligence — Build Session Prompt

> **Phase 5 makes Waymark a real training tool. Everything before was UI; this is intelligence.**

## Before You Start

Check memory for ALL of these — they are the source of truth:
- `user_profile.md` — Josh's full physical profile, schedule, goals, form cue philosophy
- `project_training_plan.md` — Complete revised program (corrected schedule, core circuits, Foundation, wave loading)
- `project_app_vision.md` — App design with corrected weekly template
- `project_redesign_progress.md` — Phase 5 scope breakdown (Sub-Phases A-E)
- `research_training_science.md` — Research findings on APT, core hypertrophy, deadlift safety, form cueing

This file (`PHASE5_SESSION_PROMPT.md`) contains the complete build spec. Memory files have the full program details. Explore the codebase to understand current file structure before making changes.

The design system is **LOCKED** — Cinzel display, Geist body, forest palette, gold accents, sharp corners, plaque buttons, 3-layer atmosphere.

---

## What's Wrong Right Now

The app has beautiful UI but the training data is **wrong**:

1. **Weekly template is backwards** — MT is in PM slots (should be PM evening), strength is in PM (should be early AM), Foundation runs every day as standalone AM (should only be Mon/Wed/Fri/Sat AM — on strength days it's built into the warmup)
2. **Strength templates are wrong exercises** — Strength A has Landmine Press, V-Ups, Russian Twists. Should be: Bench Press, Bent Over Row, Incline DB Press, Lateral Raise, EZ Bar Curl, Ab Wheel, Hanging Leg Raises, Pallof Press, Side Plank Hip Lift
3. **Core is an afterthought** — 8 min of 3 exercises tacked on. Should be 15-18 min dedicated Core Circuit with 4 exercises, own section identity, research-backed selection (Escamilla EMG rankings)
4. **Foundation is too small** — 6 exercises, UCS-only. Should be 19 exercises: combined UCS + APT corrective (with glute bridges, hip flexor stretch, dead bugs, bird dogs) + hip mobility
5. **No wave loading** — weights are just stored TM, not calculated as TM × week%
6. **No deadlift phasing** — no week-aware exercise swapping (RDL → Block Pull → Conventional)
7. **No form videos** — no `formVideoUrl` field, no "Watch Form" link
8. **No weight history** — SetTracker shows suggested weight but not "Last time: Xlb × Y"
9. **Program tab shows "Start 12-Week Base Build" button** — should show active weekly view
10. **Form cues are generic** — need Josh-specific educational cues (APT-aware, external focus)
11. **Missing ~25 exercises from seed data** — Bench Press, deadlift variants, core circuit exercises, APT correctives all missing

---

## Build Order (dependency-sequenced)

### Step 1: Schema Migration
- Add `formVideoUrl` (text, nullable) to `exercises` table
- Add `blockWeek` (integer, nullable) to `sessions` table
- File: `src/db/schema.ts` + migration SQL

### Step 2: Seed Data (~30 exercises)
- Add all missing exercises with Josh-specific form cues (educational tone, two-part: cue + why)
- Add `formVideoUrl` to ALL exercises — search YouTube for each (Alan Thrall deadlift, Jeff Nippard squat/bench/OHP, Jeremy Ethier pull-ups, AthleanX face pulls/pallof)
- Update existing exercise form cues to use the educational pattern
- Add initial training maxes (Front Squat 47.6kg, Bench 52.2kg, OHP 31.8kg, Row 47.6kg, DL 63.5kg)
- Files: `src/db/seed.ts`, `src/db/seed.sql`

### Step 3: Template Rewrites
**Weekly template** (`src/lib/weeklyTemplate.ts`):
- Mon: Foundation AM (25min) + MT Class PM (100min)
- Tue: Strength A AM (75min) + Run PM (30min)
- Wed: Foundation AM (25min) + MT Class PM (100min)
- Thu: Strength B AM (75min) + Active Recovery PM (20min)
- Fri: Foundation AM (25min) + MT Class PM (100min)
- Sat: Foundation AM (25min) + Mobility Flow PM (30min)
- Sun: No sessions (full rest)

**Strength templates** (`src/lib/strengthTemplates.ts`):
- Add `section` field to TemplateExercise: `'warmup' | 'main' | 'accessory' | 'core'`
- STRENGTH_A: warmup (Face Pulls + Band Pull-Aparts) → main (Front Squat, Bench, Bent Over Row) → accessories (Incline DB, Face Pulls, Lateral Raise, EZ Curl) → Core Circuit A (Ab Wheel, Hanging Leg Raises, Pallof Press, Side Plank Hip Lift)
- STRENGTH_B: warmup → main (Deadlift[week-aware], OHP, Pull-Up Progression) → accessories (Bulgarian Split Squat, DB Row, Tricep Pushdown, Hammer Curl) → Core Circuit B (Body Saw, Cable Woodchop, Weighted Dead Bug, Suitcase Carry)
- Add wave loading helpers: `getWaveLoadingSetsReps(blockWeek)`, `getWeekPercentage(blockWeek)`, `getDeadliftExerciseId(blockWeek)`
- Change signature: `getStrengthTemplate(dayOfWeek, blockWeek = 1)`

**Foundation template** (`src/lib/postureTemplate.ts`):
- Add `section` field: `'upper' | 'lower'`
- 19 exercises in 2 sections: upper (foam roll pecs + traps + hip flexors, doorway stretch, hip flexor stretch, Y-T-W, chin tucks, glute bridges, band pull-aparts, wall angels) + lower (pigeon, cossack squats, 90/90, cat-cow, psoas stretch, wall hip CARs, dead bugs, bird dogs)
- Each exercise has an educational note explaining why it matters

### Step 4: API Changes (`src/server/app.ts`)
- **Wave loading in `start-strength`**: calculate weight as `TM × getWeekPercentage(blockWeek)` for working sets, `TM × 0.5` for warmup. Use `getWaveLoadingSetsReps(blockWeek)` for rep counts on main lifts.
- **Block week tracking**: store `blockWeek` on sessions when generated
- **TM progression fix**: only increase TM after week 6 with all 90% sets completed (+5lb upper, +10lb lower)
- **Exercise history endpoint**: `GET /api/exercises/:id/last-session` — returns most recent weight/reps/date for weight suggestions
- **MT flexibility**: read `mtClassDays` from settings, adapt daily session generation
- **formVideoUrl in responses**: include in `buildWorkoutResponse` and `buildPostureWorkoutResponse`
- **Section field**: pass `section` from template through to workout response so UI can render section headers

### Step 5: UI Changes
- **Program page**: Kill "Start 12-Week Base Build". Show active weekly view with week nav (prev/next) and block week indicator ("Week 3 of 6 — 90% Week")
- **SetTracker**: Add "Last time: 135lb × 8" above weight input. Show "Try 140lb?" as tappable suggestion.
- **ExerciseView**: Add "Watch Form" link (teal, opens YouTube in system browser) from `formVideoUrl`
- **Foundation (PostureExerciseView)**: Section headers ("Upper Body — Release & Activate" / "Lower Body — Hips & Spine"), breathing cue interstitial (3s "Breathe" between exercises), notes displayed prominently (not hidden)
- **Strength (WorkoutPage)**: Section dividers when transitioning between warmup → main → accessories → core circuit. Gold text headers with horizontal rule.
- **WorkoutPage wiring**: Pass formVideoUrl + section to ExerciseView, fetch last-session data for SetTracker

---

## Critical Details

**Form cue tone**: Educational, not clinical. Two-part: external cue + empowering why.
- YES: "Ribs down — this locks your core into a strong brace position"
- NO: "Your pelvis tilts forward so you need to compensate"

**Core circuits are their own identity**: They are NOT exercises tacked on the end. They are a labeled phase of the workout with visual treatment (section header, gold accent). Target: 12-16 hard sets/week across both circuits.

**Foundation is a ritual**: Intentional pacing, breathing cues between exercises, notes explain the "why" prominently. Not a checklist to rush through.

**Wave loading math**:
- Week 1,4: 75% TM, 3×5
- Week 2,5: 80% TM, 3×5
- Week 3,6: 90% TM, 3×3
- Warmup: 50% TM
- After block: +5lb upper, +10lb lower (only if all 90% sets completed)

**Deadlift phasing**: Weeks 1-2 → `ex-rdl`, Weeks 3-4 → `ex-block-pull`, Weeks 5-6 → `ex-deadlift`

**Preview and verify each change.** Read the memory files for any details not covered here.
