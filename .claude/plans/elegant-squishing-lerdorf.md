# Phase 9 — Weight Prescription (Personal Trainer Mode)

## Start with
"Phase 9 — read the plan at `.claude/plans/elegant-squishing-lerdorf.md`"

---

## What's Done (Phases 1-8)

- Full brand identity, all 7 session types, workout engines
- Wave loading, deadlift phasing, form cues, TM progression
- Waybook (journal) with fantasy display, Body Log, search
- Ledger with collapsible sections, charts, lifestyle tracking
- Library with exercise reference, search across all content

---

## The Problem

SetTracker currently lets you **input** weight but doesn't **tell** you what to load. Josh is starting near-fresh (5'9", 158lb, 35yo, 2yr sedentary) and needs the app to act like a personal trainer — prescribing specific weights and plates based on his training plan and history.

---

## Phase 9A: Weight Prescription on SetTracker

**Goal:** When you open a set, the app tells you exactly what to load.

**Data sources already available:**
- Training Maxes (TMs) in DB — Front Squat 105lb, Bench 115lb, OHP 70lb, Row 105lb, DL 140lb
- Wave loading protocol — Weeks 1,4: 75% TM, Weeks 2,5: 80% TM, Weeks 3,6: 90% TM
- Current week number in training block
- Previous session history (last weights used, reps completed)
- Exercise type (main lift vs accessory vs core)

**Display on SetTracker:**
- **Main lifts:** Show prescribed weight from wave loading (e.g., "3×5 @ 87lb") + plate math ("bar + 20 on each side")
- **Accessories:** Show last weight used + suggestion ("Last: 30lb × 10, try 35lb" if all sets hit top range)
- **Core:** Show progression cue ("Add 2.5lb plate" or "Slow to 3s tempo")

**Plate math helper:**
- Standard bar = 45lb
- Available plates: 45, 35, 25, 10, 5, 2.5 (per side)
- Display as human-readable: "Bar + 25 + 10 each side" for 115lb
- Handle odd weights: round to nearest 5lb, show actual vs prescribed

**Where to show:**
- Above the weight input on SetTracker, before the user starts
- Subtle, not blocking — the user can always override
- Gold accent text, like a coach's note

---

## Phase 9B: Progressive Overload Logic

**Main lifts (wave loading):**
- Calculate from current TM × wave percentage
- After block completion (6 weeks): if all 90% sets done clean → suggest TM increase (+5lb upper, +10lb lower)
- If sets were missed → keep TM, note it

**Accessories (double progression):**
- Track reps achieved across sets
- If all sets hit top of rep range (e.g., 3×12 when range is 10-12) → suggest +5lb next session
- If reps dropped below minimum → suggest same weight or drop 5lb

**Core exercises:**
- Track by feel/RPE more than weight
- Suggest tempo changes, weight additions, or rest reductions based on history

---

## Phase 9C: "Last Time" Context

Show historical context on every exercise:
- "Last session: 87lb × 5, 5, 5 — RPE 6"
- "PR: 105lb × 3 (Mar 23)"
- For accessories: "Last 3 sessions: 30lb → 30lb → 35lb"

This data already exists in `strengthSets` + `strengthSessionExercises` tables.

---

## Files to investigate
- `src/features/session/SetTracker.tsx` — where weight prescription displays
- `src/features/session/ExerciseView.tsx` — exercise context during workout
- `src/server/app.ts` — API endpoints for history per exercise
- `src/db/schema.ts` — trainingMaxes, strengthSets, strengthSessionExercises
- `src/lib/strengthTemplates.ts` — wave loading percentages, rep schemes

## New functionality needed
- Plate math utility function
- Weight prescription calculation (TM × wave %, or last weight + progression)
- API endpoint: `/api/exercises/:id/history` — last N sessions for an exercise
- SetTracker UI: prescription display above weight input

---

## Verification
1. Open a strength session, verify prescribed weight shows on each exercise
2. Verify plate math displays correctly (bar + plates per side)
3. Verify "Last time" context shows previous weights/reps
4. Verify accessory progression suggestions work
5. Verify wave loading percentage matches current week in block
