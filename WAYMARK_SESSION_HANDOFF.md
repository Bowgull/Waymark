# Waymark Session Handoff

Updated: 2026-05-16 18:37 EDT

## Current State

Active branch: `codex/roadtrip-coach`.

Road Bootcamp is implemented as a bounded 8-week block with fixed weekly rails, 18 strength variants, strength ready UI, structured session context, Road Bootcamp Ledger metrics, Strava local proof, and a fresh reset path.

The current build is functional but not finished. Estimate: roughly 85 percent of the Road Bootcamp slice.

## What Changed This Pass

- Read Waymark canon and build docs. No root `AGENTS.md` exists in this repo.
- Cleaned lint scope so generated/local tool folders do not hide real app issues.
- Fixed app lint errors without product behavior changes:
  - Split tour context from `TourProvider`.
  - Removed synchronous state writes from effects where practical.
  - Fixed demo seed typing.
  - Fixed unused chart prop.
  - Moved timer anchor writes to user actions.
- Wired Road Bootcamp metrics into Ledger AI insight context.
- Replaced old Ledger fallback cheerleading copy with dry observational copy.
- Constrained `SessionShell` footer content to the same mobile measure as session bodies.
- Expanded session review context so the coach can read bounded run evidence, Strava HR/pace/splits, strength set summaries, and Road Bootcamp time/equipment context.
- Browser-clicked Road Bootcamp strength ready into a Hotel gym 30-minute session.
- Verified Road Bootcamp strength re-entry/start idempotency: 6 exercises and 14 sets stayed stable on repeat start.
- Added a low-cost session review prompt test proving Strava run evidence and Road Bootcamp strength evidence reach the coach prompt.
- Updated the Waymark style guide navigation canon to match the current app: 4 bottom tabs plus a Settings gear.
- Tightened Ledger, Metrics, and fallback insight copy away from wellness-dashboard language:
  - `Body & Mind` is now `Readiness`.
  - Road Bootcamp stats now read as run time, strength days, and rope primers.
  - Body metrics empty state is factual.
  - `/metrics` stays as a secondary Settings surface for now.
- Added `npm run test:lib` for the local Road Bootcamp and session-review prompt tests.
- Ran mobile headless browser QA without visible Chrome takeover:
  - `/today` showed the Waymark mark intact and the 4-tab shell.
  - `/program` showed Road Bootcamp weekly rails and approved/skipped state.
  - `/history` showed Ledger, Road Bootcamp metrics, Readiness, running, and strength records.
  - `/settings` showed Strava connected state and Body metrics secondary entry.
  - `/metrics` showed manual body metric logging and factual empty state.
- Removed the decorative `~` from Ledger insight copy and fixed `1 days` grammar.
- Cleared all remaining React hook lint warnings:
  - App routing onboarding redirect now tracks route/nav dependencies.
  - Loading screen dismissal is callback-stable.
  - Scroll drum values are memoized.
  - Toast cleanup captures the timer map safely.
  - Library month grouping is callback-stable.
  - Program week loading is callback-stable.
  - Session timer effects read stable timer fields instead of whole timer objects.
- Re-ran Road Bootcamp strength ready in headless mode after warning cleanup:
  - Created a local planned Road Bootcamp strength QA session for 2026-05-18.
  - Ready screen loaded with time and equipment choices.
  - Start Strength reached the skip-rope warmup.
  - API proof: 6 exercises, 15 sets, `in_progress`, `contextJson` stored `30` and `no_gym`.
  - Repeat `start-strength` stayed idempotent at 6 exercises and 15 sets.
- Quieted local AI fallback logging:
  - Missing `ANTHROPIC_API_KEY` now logs once as info.
  - Ledger insight fallback logs as info.
  - Real Anthropic auth/network errors still log as errors.
- Ran a final headless app smoke after the fallback logging change:
  - `/today` loaded Morning Report, Waybook, mobility, run, and the 4-tab shell.
  - `/program` loaded Road Bootcamp week 1 rails and the local QA strength session.
  - `/history` loaded Ledger, Road Bootcamp metrics, Readiness, running, and strength records.
  - `/settings` loaded Body metrics entry and Strava connected state.
  - Browser console showed only React DevTools info and favicon 404.
  - Worker logs showed local AI fallback as info, not error/warn.
  - Local dev servers were stopped after QA.
- Added a static SVG favicon using Waymark colors and wired it in `index.html`.
  - Build output now includes `dist/favicon.svg`.
  - `dist/index.html` references the favicon.
- Tightened Road Bootcamp strength matrix tests:
  - The test now reads `src/db/seed.sql` and `drizzle/0022_road_bootcamp.sql`.
  - Every exercise used by all 18 Road Bootcamp strength variants must have a seeded `http`/`https` form video URL.
- Excluded `src/**/*.test.ts` from the app TypeScript build so local test files are not treated as shipped app code.
- Tightened run coaching evidence:
  - Session review prompts now include the prescribed HR target line beside actual Strava HR, pace, splits, and zone evidence.
  - The coach uses the same profile `maxHr` source that Today uses for visible target zones.
  - `sessionReview` now supports an `intensity_mismatch` flag for cases where prescribed run intensity does not match heart-rate evidence.
  - Prompt test coverage now checks prescribed target HR and intensity mismatch instruction text.
- Surfaced stored coach reviews in Ledger Recent Sessions:
  - `review` and `reviewFlag` now render in the Recent Sessions list.
  - `intensity_mismatch` shows as the quiet label `Heart ran high`.
  - Other stored flags render as small labels only.
  - The empty state now reads `No completed sessions yet.`
- Tightened Road Bootcamp Ledger density:
  - Removed nested stat boxes inside the Road Bootcamp card.
  - Added a single completion rail.
  - Converted the metrics into divided rows for running, strength, equipment, rope, and readiness.
  - Capped right-side metric text so mobile rows do not sprawl.
- Added zero-spend session review fallback:
  - When Anthropic is offline or no API key exists, completed sessions now get a deterministic local review instead of no review.
  - Zone 2 HR mismatches return `Prescribed easy. Heart said hard. Easier next time.` with `intensity_mismatch`.
  - Road Bootcamp strength sessions get a short time/equipment/movement-count review.
  - Local fallback behavior is covered in `sessionReviewAI.test.ts`.
- Added `npm run smoke:offline-review`:
  - Creates an ad-hoc Zone 2 running session through the API.
  - Starts the run, records distance, pace, HR, and elevation.
  - Completes the session with no Anthropic key required.
  - Asserts the stored session has a persisted coach review and `intensity_mismatch` flag.
  - Resets the smoke session back to planned in local D1 cleanup.
- Fixed the route-smoke gap it exposed:
  - Completion notes can replace `sessions.notes`.
  - Run review context now uses `run_sessions.run_type` unless `sessions.notes` is still an approved run category.
  - The coach keeps the prescribed run target available after the user logs completion notes.
- Investigated the local `start-foundation-run` failure:
  - Root cause was missing local D1 exercise seed rows from `drizzle/0019_static_stretch_warmup.sql`.
  - Local D1 had `ex-pigeon-stretch` but was missing the four newer warmup exercises.
  - Added an API guard so foundation-run start returns `409` with missing exercise IDs and the exact migration recovery command instead of a generic 500.
  - Added `npm run smoke:foundation-run`.
  - Applied `npm run db:migrate:0019:local` to the local D1 database.
  - Verified foundation-run start creates a Zone 2 run, 5 warmup exercises with videos, and idempotent repeat start.
- Added a live-review smoke harness without accidental spend:
  - `/api/sessions/:id/complete` now returns `reviewSource`.
  - `reviewSource` is `ai` only when a live `coaching_outputs(kind='session_review')` row is written.
  - `reviewSource` is `local` when the deterministic fallback writes the session review.
  - `npm run smoke:offline-review` now asserts `reviewSource: "local"`.
  - Added `npm run smoke:live-review`, gated behind `WAYMARK_LIVE_AI_SMOKE=1`.
  - The live smoke refuses to run unless explicitly enabled, then asserts `reviewSource: "ai"`, a stored review line, a valid flag, and no exclamation mark.
  - Local Wrangler does not currently expose `ANTHROPIC_API_KEY`, so no live model call was made in this pass.

## Verification

- `npm run lint` passes with 0 warnings and 0 errors.
- `npm run test:lib` passes:
  - `sessionReviewAI tests passed`
  - `roadBootcampTemplate tests passed`
  - `roadBootcampStrengthTemplates tests passed`
  - `roadBootcampMetrics tests passed`
- `npm run build` passes.
- `npx tsx src/lib/sessionReviewAI.test.ts` passes.
- `npx tsx src/lib/roadBootcampTemplate.test.ts` passes.
- `npx tsx src/lib/roadBootcampStrengthTemplates.test.ts` passes.
- `npx tsx src/lib/roadBootcampMetrics.test.ts` passes.
- `git diff --check` passes.
- `test -f dist/favicon.svg && rg 'favicon.svg' dist/index.html && head -5 public/favicon.svg` passes.
- Browser QA checked `/today`, `/program`, `/library`, `/history`, `/settings`, `/metrics`, and a Road Bootcamp strength ready session.
- Browser QA started Road Bootcamp strength from ready state.
- API re-entry proof: repeat `start-strength` returned the same exercise and set counts.
- Latest browser QA used headless Playwright only. No visible external browser.
- No browser run was needed for the 18:37 follow-up because it changed coach prompt evidence and tool schema only.
- Local route smoke for the Ledger follow-up:
  - `curl -s 'http://127.0.0.1:8787/api/history/sessions?limit=5'` returned session rows with `review` and `reviewFlag` fields.
  - `curl -s -I http://127.0.0.1:5173/history` returned 200.
  - Local app/API servers were stopped after the check.
- Road Bootcamp Ledger density follow-up:
  - `npm run lint` passes.
  - `npm run test:lib` passes.
  - `npm run build` passes.
  - `git diff --check` passes.
  - Browser proof was not run because no callable in-app browser tool was exposed in this turn and visible Chrome was avoided.
- Zero-spend session review fallback:
  - `npx tsx src/lib/sessionReviewAI.test.ts` passes.
  - `npm run lint` passes.
  - `npm run test:lib` passes.
  - `npm run build` passes.
  - `git diff --check` passes.
- Offline review route smoke:
  - `npm run smoke:offline-review` passes against local wrangler on `127.0.0.1:8787`.
  - Output confirmed `review: "Prescribed easy. Heart said hard. Easier next time."`.
  - Output confirmed `reviewFlag: "intensity_mismatch"`.
  - `npm run test:lib` passes.
  - `npm run lint` passes.
  - `npm run build` passes.
  - `git diff --check` passes.
- Foundation-run smoke:
  - Before local migration, `npm run smoke:foundation-run` returned `409` with missing IDs:
    `ex-toe-touch-forward-fold`, `ex-butterfly-stretch`, `ex-standing-quad-stretch`, `ex-standing-calf-stretch`.
  - `npm run db:migrate:0019:local` applied successfully.
  - After migration, `npm run smoke:foundation-run` passes with `runType: "zone2"` and `warmupCount: 5`.
  - `npm run smoke:offline-review` passes.
  - `npm run test:lib` passes.
  - `npm run lint` passes.
  - `npm run build` passes.
  - `git diff --check` passes.
- Live-review guard:
  - `npm run smoke:live-review` refuses to run without `WAYMARK_LIVE_AI_SMOKE=1`.
  - The refusal message names the required opt-in and Anthropic key check.
  - `npm run smoke:offline-review` passes and returns `reviewSource: "local"`.
  - `npm run smoke:foundation-run` passes.
  - `npm run test:lib` passes.
  - `npm run lint` passes.
  - `npm run build` passes.
  - `git diff --check` passes.

## Known Warnings

- Vite build still reports the existing large chunk warning.
- Local wrangler still warns that `node:fs` needs `nodejs_compat` because `src/db/demoSeed.ts` imports Node fs. That is local dev surface, not app runtime behavior tested here.
- Favicon was fixed after the last browser smoke. Static build proof passes. A live browser resmoke has not been run since that tiny fix.
- The first offline-review smoke used `start-foundation-run` and hit a local D1 posture warmup insert failure. The actual root cause was missing local warmup exercise seed rows from migration `0019`, not the `posture_session_exercises.completed` column.

## Open Product Gaps

- Session review AI now sees bounded Strava/run and strength evidence, with prompt-level test coverage. It has not been live-AI smoke tested to avoid unnecessary model spend.
- Local no-key coaching now stores deterministic reviews for completed sessions.
- Session review AI now sees prescribed HR target versus actual HR evidence for runs.
- Ledger AI now sees Road Bootcamp summary metrics, not raw run or strength detail.
- Local QA currently falls back when `ANTHROPIC_API_KEY` is missing. That is expected and keeps spend at zero for this pass.
- Live session-review QA now has an opt-in smoke, but it has not been run live because local Wrangler does not expose `ANTHROPIC_API_KEY`.
- Weekly Road Bootcamp generation intentionally bypasses AI and uses fixed templates.
- Some Ledger surfaces still feel dense, but current copy and layout are aligned enough for this slice. Needs targeted polish, not a visual-system rewrite.
- `/metrics` remains a separate manual logging route. Folding it into Ledger should wait until there is a real UX reason, not just cleanup pressure.
- Local QA created one planned/in-progress Road Bootcamp strength session on 2026-05-18 in the local D1 dev database. It is test state only.

## Next Slice

1. If live AI QA is approved and `ANTHROPIC_API_KEY` is available to Wrangler, run `WAYMARK_LIVE_AI_SMOKE=1 npm run smoke:live-review`.
2. Continue targeted polish only where a real Road Bootcamp flow still feels unclear.
3. If remote D1 has not had migration `0019` applied, run `npm run db:migrate:0019:remote` before testing remote foundation runs.
