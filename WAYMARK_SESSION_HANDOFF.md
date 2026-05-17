# Waymark Session Handoff

Updated: 2026-05-17 10:15 EDT

## Current State

Active branch: `codex/roadtrip-coach`.

Road Bootcamp is implemented as a bounded 8-week block with fixed weekly rails, 18 strength variants, strength ready UI, structured session context, Road Bootcamp Ledger metrics, Strava local proof, and a fresh reset path.

The current build is functional but not finished. Estimate: roughly 98 percent of the Road Bootcamp slice.

## 2026-05-17 10:15 EDT - iOS Command Scripts

- Added repeatable package scripts for the phone build path:
  - `npm run ios:sync`
  - `npm run ios:devices`
  - `npm run ios:build:generic`
  - `npm run ios:open`
- Updated the README iOS section to use those scripts.
- `npm run ios:devices` still sees `Josh (2)` and `iPhone` as `unavailable`.
- Ran `npm run ios:sync`.
  - `npm run build` passed.
  - `npx cap sync ios` passed.
- Ran `npm run ios:build:generic`.
  - Result: `** BUILD SUCCEEDED **`.
- Ran `npm run lint`; it passed.
- Ran `npm install --package-lock-only --ignore-scripts`; package lock stayed current.
  - npm audit still reports 11 existing vulnerabilities: 8 moderate, 3 high.
- No production data was reset.
- No live AI or remote Strava poll was run.

### Current Dirty Files

- `package.json`
- `README.md`
- `WAYMARK_SESSION_HANDOFF.md`

### Next Immediate Step

Commit and push the iOS script slice. Physical phone install still waits on device availability in Xcode.

## 2026-05-17 10:13 EDT - README Replaced

- Replaced the root Vite template README with a Waymark-specific project README.
- New README covers:
  - current Road Bootcamp state.
  - local Vite and Wrangler workflow.
  - core checks.
  - Road Bootcamp smoke scripts.
  - Capacitor iOS sync and native compile command.
  - deploy command.
  - data safety rules for production reset, live AI, and remote Strava polling.
- Used Waymark voice rules:
  - short declaratives.
  - no hype.
  - no template SaaS language.
- No production data was reset.
- No live AI or remote Strava poll was run.

### Current Dirty Files

- `README.md`
- `WAYMARK_SESSION_HANDOFF.md`

### Next Immediate Step

Run checks, commit, and push the README handoff slice.

## 2026-05-17 10:11 EDT - iOS Platform Install And Native Build

- Resolved the local Xcode platform gate that previously blocked native compilation.
- Ran `xcodebuild -runFirstLaunch -checkForNewerComponents`; Xcode reported no newer updates for `17F42`.
- Attempted `xcodebuild -prepareDeviceSupport -platform iOS -osVersion 26.5 -architecture arm64e`; it detected connected iPhone UDID `00008101-001C61812E8B001E` but did not complete cleanly.
- Ran `xcodebuild -downloadPlatform iOS -buildVersion 26.5 -architectureVariant arm64`.
  - Installed `iOS 26.5 Simulator (23F77) (arm64)`.
- Ran `xcodebuild -showdestinations -project ios/App/App.xcodeproj -scheme App -skipPackageUpdates`.
  - Xcode now lists generic iOS and iOS Simulator destinations.
- Ran native generic build:
  - `xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO -skipPackageUpdates build`
  - Result: `** BUILD SUCCEEDED **`.
- Build artifact:
  - `/Users/lindsaybell/Library/Developer/Xcode/DerivedData/App-abudzhqhhmeiepdhfpiodsxoimvs/Build/Products/Debug-iphoneos/App.app`
- Ran `xcrun devicectl list devices`.
  - `Josh (2)` and `iPhone` are visible but currently `unavailable`.
  - Remaining sideload gate is physical device availability/signing, not a generic Waymark compile failure.
- No production data was reset.
- No live AI or remote Strava poll was run.

### Current Dirty Files

- `WAYMARK_SESSION_HANDOFF.md`

### Next Immediate Step

Commit and push this handoff. Then rerun physical-device install once the iPhone is unlocked, trusted, and available to Xcode.

## 2026-05-17 09:46 EDT - Remote Reset Guard Smoke

- Tightened `npm run smoke:road-remote`.
- The remote readiness smoke now makes a non-destructive production request:
  - `POST /api/blocks/road-bootcamp` with no body.
  - Expected result: `400`.
- This proves production rejects accidental Road Bootcamp fresh-start calls unless `confirmReset: true` is present.
- Ran:
  - `npm run smoke:road-remote`
  - `npm run lint`
  - `git diff --check`
- All passed.
- Remote smoke output included:
  - `unconfirmedResetStatus: 400`
  - `roadExerciseCount: 16`
  - `videoCount: 16`
- No production data was reset.
- No live AI or remote Strava poll was run.

### Current Dirty Files

- `scripts/smoke-road-remote-readiness.mjs`
- `WAYMARK_SESSION_HANDOFF.md`

### Next Immediate Step

Commit and push the remote reset-guard smoke. Remaining hard gate is still Xcode/device support for phone install.

## 2026-05-17 09:44 EDT - Road Bootcamp Reset Guard

- Added a backend confirmation contract for the destructive Road Bootcamp fresh-start endpoint.
- `POST /api/blocks/road-bootcamp` now returns 400 unless the JSON body includes `{ "confirmReset": true }`.
- Updated Program fresh-start UI to send `confirmReset: true` only after the existing two-tap confirmation.
- Updated Road Bootcamp reset-dependent smoke scripts to send explicit confirmation:
  - `smoke:road-reset`
  - `smoke:road-week`
  - `smoke:road-strength`
  - `smoke:road-strength-complete`
  - `smoke:road-run`
- `smoke:road-reset` now first proves that an unconfirmed reset returns 400, then runs the confirmed local reset.
- Ran:
  - `npm run test:lib`
  - `npm run lint`
  - `npm run build`
  - `npm run smoke:road-reset`
  - `npm run smoke:road-week`
  - `npm run smoke:road-strength`
  - `npx cap sync ios`
  - `npm run deploy`
  - `npm run smoke:road-remote`
  - `git diff --check`
- All passed.
- Deployed Worker version `fe76f87c-1aec-4e82-8805-4459abb0b4a5`.
- No production data was reset.
- No live AI or remote Strava poll was run.

### Current Dirty Files

- `scripts/smoke-road-bootcamp-reset.mjs`
- `scripts/smoke-road-run-flow.mjs`
- `scripts/smoke-road-strength-completion.mjs`
- `scripts/smoke-road-strength-matrix.mjs`
- `scripts/smoke-road-week-generation.mjs`
- `src/features/program/ProgramPage.tsx`
- `src/server/app.ts`
- `WAYMARK_SESSION_HANDOFF.md`

### Next Immediate Step

Commit and push the reset guard. Remaining gate is Xcode/device support for phone install. Product reset should still wait for explicit user approval because it clears real history.

## 2026-05-17 09:39 EDT - Starter HR Graduation

- Closed a real coaching-intelligence gap in `src/lib/starterStatus.ts`.
- Before this pass, the deconditioned-starter status could only graduate by time:
  - 8 weeks since first completed session.
  - The HR-based graduation rule was documented but deferred.
- Starter status now joins completed run sessions to `run_sessions` and checks actual HR evidence.
- Graduation now fires when the 3 most recent qualifying easy runs are all under 150 bpm average HR:
  - `foundation_run` qualifies.
  - `zone2`, `easy`, `foundation`, and `foundation_run` run tags qualify.
  - Quality runs do not qualify.
- Added `src/lib/starterStatus.test.ts`.
- Added the starter-status test to `npm run test:lib`.
- Ran:
  - `npx tsx src/lib/starterStatus.test.ts`
  - `npm run test:lib`
  - `npm run lint`
  - `npm run build`
  - `npx cap sync ios`
  - `git diff --check`
- All passed.
- No production data was reset.
- No live AI or remote Strava poll was run.

### Current Dirty Files

- `package.json`
- `src/lib/starterStatus.ts`
- `src/lib/starterStatus.test.ts`
- `WAYMARK_SESSION_HANDOFF.md`

### Next Immediate Step

Commit, deploy Worker, run `npm run smoke:road-remote`, then continue only if a remaining Road Bootcamp flow has real risk.

## 2026-05-17 09:35 EDT - iOS/Xcode Sideload Gate

- Verified native project state for Xcode sideload path.
- Ran `npx cap sync ios`; it passed and regenerated current web assets/config into `ios/App/App/public`.
- Found the tracked Xcode SwiftPM lockfile was stale:
  - Previous `capacitor-swift-pm`: `8.2.0`.
  - Current Capacitor JS packages: `8.3.1`.
  - Updated `ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved` to `8.3.1`.
- Ran `swift package resolve` inside `ios/App/CapApp-SPM`; it resolved `capacitor-swift-pm` at `8.3.1` and downloaded the Capacitor/Cordova XCFramework artifacts.
- Ran `xcodebuild -list -project ios/App/App.xcodeproj -skipPackageUpdates`; it listed targets and schemes:
  - Targets: `App`, `WaymarkActivity`.
  - Schemes include `App` and `WaymarkActivity`.
- Attempted generic iOS build:
  - `xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO -skipPackageUpdates build`
  - Result: blocked by local Xcode device/simulator environment before compile.
  - Xcode reports CoreSimulator mismatch: installed CoreSimulator `1051.50.0`, Xcode expects `1051.54.0`.
  - Xcode also reports connected device `Josh (2)` is ineligible until iOS 26.5 platform/device support is installed from Xcode settings.
- Ran `xcodebuild -showsdks`; installed SDK list reports `iphoneos26.5` and `iphonesimulator26.5`, so the remaining gate is Xcode platform/device-support state, not a Waymark source-code failure.
- No production data was reset.
- No live AI or remote Strava poll was run.

### Current Dirty Files

- `ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved`
- `WAYMARK_SESSION_HANDOFF.md`

### Next Immediate Step

Commit and push the Capacitor SwiftPM lockfile update plus this handoff. Then update Xcode components/device support locally and rerun the iOS build/device install from Xcode.

## 2026-05-17 09:23 EDT - Mobile Visual QA

- Ran headless mobile browser QA at 390 × 844.
- Verified `/today`:
  - Logo renders visually as Waymark.
  - Morning Report fits.
  - Bottom nav does not overlap primary controls.
  - Browser console reported 0 errors.
- Verified `/program`:
  - Road Bootcamp card renders.
  - Week 1 rails render.
  - Prepared-week copy renders.
  - No desktop layout drift.
  - Browser console reported 0 errors.
- Verified `/history`:
  - Ledger loads after wait, not just loading mark.
  - Road Bootcamp metrics card renders.
  - Week tabs and bottom nav fit.
  - Browser console reported 0 errors.
- Verified `/settings`:
  - Strava connected state renders.
  - AI usage toggle is absent.
  - Top settings content fits mobile width.
  - Browser console reported 0 errors.
- Verified Road Bootcamp strength ready:
  - Time controls fit.
  - Equipment controls fit.
  - Bottom `Start Strength` CTA is reachable and not overlapping content.
  - Browser console reported 0 errors.
- Verified active Road Bootcamp strength:
  - HAPBEAR note renders in-session: `HAPBEAR yellow band. Move clean. No strain.`
  - Form video link renders.
  - Set controls fit mobile width.
  - Browser console reported 0 errors.
- Removed browser screenshot artifacts after QA.

### Current Dirty Files

- None before this handoff update.

### Next Immediate Step

Commit and push the mobile visual QA handoff. Remaining major gate is Xcode phone install and production fresh-start decision.

## 2026-05-17 09:16 EDT - Road Run Flow Smoke And Metrics Fix

- Added `npm run smoke:road-run`.
- Smoke is local-reset-safe by default:
  - Refuses remote reset unless `WAYMARK_ALLOW_RESET=1` is set.
  - Starts a fresh local Road Bootcamp block.
  - Completes one `foundation_run` through `start-foundation-run`.
  - Completes one quality `running` session through `start-run`.
  - Patches distance, pace, HR, and elevation onto both run rows.
  - Verifies prescriptions, reviews, review flags, and review source persist.
  - Verifies Road Bootcamp Ledger run metrics move.
- Smoke exposed a real Ledger classification bug:
  - Quality run minutes were classified as easy if the run row carried `runType: easy`.
  - Road Bootcamp should classify easy versus quality from session type.
- Fixed `computeRoadBootcampMetrics`:
  - `foundation_run` counts as easy.
  - `running` counts as quality.
  - Test now covers a quality `running` session with `runType: easy`.
- Local smoke result:
  - Easy run: 4.80 km at 7:18/km, avg HR 126.
  - Quality run: 5.10 km at 5:53/km, avg HR 151.
  - Ledger counted `runMinutes: 65`, `easyRunMinutes: 35`, `qualityRunMinutes: 30`.
- Ran `npm run smoke:road-run`, `npm run test:lib`, `npm run smoke:road-strength-complete`, `npm run smoke:road-strength`, `npm run smoke:road-week`, `npm run lint`, `npm run build`, `npx cap sync ios`, `npm run deploy`, `npm run smoke:road-remote`, and `git diff --check`. All passed.
- Deployed Worker version `d4917ecb-2113-42d4-ad5e-e51f0bbe87bb`.

### Current Dirty Files

- `package.json`
- `scripts/smoke-road-run-flow.mjs`
- `src/lib/roadBootcampMetrics.ts`
- `src/lib/roadBootcampMetrics.test.ts`

### Next Immediate Step

Commit and push the Road run-flow smoke and metrics fix. Remaining major gate is final mobile visual proof and Xcode phone install.

## 2026-05-17 09:12 EDT - Road Strength Completion Smoke

- Added `npm run smoke:road-strength-complete`.
- Smoke is local-reset-safe by default:
  - Refuses remote reset unless `WAYMARK_ALLOW_RESET=1` is set.
  - Starts a fresh local Road Bootcamp block.
  - Inserts a Road Bootcamp strength session.
  - Starts a 30-minute no-gym strength session.
  - Verifies exercises have form videos.
  - Verifies HAPBEAR guidance appears in band work.
  - Marks all strength sets complete.
  - Completes the session.
  - Verifies review, review flag, and review source persist.
  - Verifies Road Bootcamp Ledger metrics move for strength completed, 30-minute selection, and no-gym equipment.
- Local result:
  - 6 exercises.
  - 5 HAPBEAR-guided exercises.
  - Review: `30 minutes. No gym. 6 movements logged.`
  - Review source: `local`.
  - Ledger counted `strengthCompleted: 1`, `30: 1`, `no_gym: 1`.
- Ran `npm run smoke:road-strength-complete`, `npm run test:lib`, `npm run smoke:road-strength`, `npm run smoke:road-week`, `npm run lint`, `npm run build`, `npx cap sync ios`, and `git diff --check`. All passed.

### Current Dirty Files

- `package.json`
- `scripts/smoke-road-strength-completion.mjs`

### Next Immediate Step

Commit and push the Road strength completion smoke. Continue with run-flow QA next.

## 2026-05-17 08:56 EDT - HAPBEAR Road Bands

- User selected the Amazon.ca HAPBEAR long-loop pull-up assistance band set:
  - URL: `https://www.amazon.ca/HAPBEAR-Pull-Assistance-Bands-Resistance/dp/B0CSF8P2P4`
  - Constraint: Amazon Canada, under $50 CAD, same-day delivery if available.
- Replaced the uncommitted SUNPOW-specific band guidance with HAPBEAR-specific guidance.
- Road Bootcamp strength notes now call out HAPBEAR bands:
  - Yellow for pull-aparts and light warmup work.
  - Yellow or orange for clean movement/loading on unilateral work.
  - Red or blue for rows, presses, and curls.
  - Blue or purple for good mornings, tempo squats, and reverse-lunge loading.
  - Purple only if position stays solid.
- Added test coverage that Road Bootcamp band exercises include HAPBEAR guidance.
- Ran `npm run test:lib`, `npm run smoke:road-strength`, `npm run lint`, `npm run build`, `npx cap sync ios`, `npm run deploy`, `npm run smoke:road-remote`, and `git diff --check`. All passed.
- Deployed Worker version `c020d03e-04e2-4ba7-8396-52ca88504f12`.

### Current Dirty Files

- `src/lib/roadBootcampStrengthTemplates.ts`
- `src/lib/roadBootcampStrengthTemplates.test.ts`

### Next Immediate Step

Commit and push the HAPBEAR band guidance.

## 2026-05-17 05:32 EDT - Ledger, Settings, Strength Ready QA

- Browser QA checked Ledger at mobile size:
  - Road Bootcamp metrics card renders.
  - Empty state metrics are sane after fresh local reset.
  - Browser console reported 0 errors.
- Browser QA checked Settings at mobile size:
  - Strava shows connected.
  - Strava copy reads `Runs log themselves.`
  - AI usage toggle is not present.
  - Browser console reported 0 errors.
- Created a local Road Bootcamp strength session and opened `/session/:id`.
- Verified the Road Bootcamp strength ready screen:
  - Time choices render.
  - Equipment choices render.
  - Default line reads `30 minutes. No gym. Main work stays, accessories drop.`
  - Selecting Hotel gym and starting moved into the workout shell.
- Verified stored strength context after start:
  - `timeAvailable: "30"`
  - `equipment: "hotel_gym"`
  - `adaptationLine: "30 minutes. Hotel gym. Main work stays, accessories drop."`
- Removed browser artifacts after QA.

### Current Dirty Files

- None before this handoff update.

### Next Immediate Step

Continue final QA/polish. Remaining useful checks are session completion/review surfaces and any last mobile overflow issues.

## 2026-05-17 05:29 EDT - Road Smoke Isolation And Program Copy

- Program QA after Strava poll testing showed extra local Saturday runs.
- Root cause was local QA state, not the Road Bootcamp weekly template.
- Tightened the Road Bootcamp local smokes:
  - `npm run smoke:road-week` now resets local Road Bootcamp state before asserting the 14-session template.
  - `npm run smoke:road-strength` now resets local Road Bootcamp state before creating the 18 variants.
  - Remote targets will not reset unless `WAYMARK_ALLOW_RESET=1` is set.
- Re-ran `npm run smoke:road-week`; it passed with 14 sessions.
- Re-ran `npm run smoke:road-strength`; it passed across 18 variants.
- Replaced the Program draft copy:
  - From `Auto-generated. Review and approve`
  - To `Prepared week. Review and approve.`
  - Supporting line now says `Remove anything that will not happen.`
- Browser QA reloaded Program at mobile size:
  - Correct 14-session week shown.
  - Corrected copy rendered.
  - Browser console reported 0 errors.
- Ran `npm run lint`, `npm run test:lib`, `npm run build`, `npx cap sync ios`, and `git diff --check`. All passed.

### Current Dirty Files

- `scripts/smoke-road-week-generation.mjs`
- `scripts/smoke-road-strength-matrix.mjs`
- `src/features/program/WeekView.tsx`

### Next Immediate Step

Commit and push the smoke isolation and Program copy polish.

## 2026-05-17 05:25 EDT - Strava Poll Idempotency

- Ran mobile browser QA against local Today and Library without taking over the user's screen.
- Today and Library logo surfaces render correctly in current local screenshots.
- Found a real local browser console error:
  - `POST /api/strava/poll-recent` could return 500 when two safety polls overlapped.
  - Root cause: both polls could see the same recent Strava activity before either insert committed, then the second write hit the unique `run_sessions.strava_activity_id` index.
- Made Strava ingestion idempotent at the database write:
  - If insert/update collides and the activity now exists, return `duplicate` instead of throwing.
  - If no duplicate exists after the failed write, log the real failure and rethrow.
- Verified two concurrent local `POST /api/strava/poll-recent` calls both return 200.
- Re-ran Today in browser QA:
  - `POST /api/strava/poll-recent` returned 200 twice.
  - Browser console reported 0 errors.
- Ran `npm run test:lib`, `npm run lint`, `npm run build`, and `git diff --check`. All passed.
- Deployed Worker version `aa011f90-8e02-40db-80b8-08f8c0a13ea4`.
- Ran `npm run smoke:road-remote` after deploy. It passed.
- Did not call remote Strava poll because that can ingest real production activities.

### Current Dirty Files

- `src/server/routes/strava.ts`

### Next Immediate Step

Commit and push the Strava idempotency fix, then continue final QA/polish.

## 2026-05-17 05:20 EDT - Remote Readiness Smoke Script

- Added `npm run smoke:road-remote`.
- The smoke is non-destructive:
  - Reads `GET https://waymark.bocas-joshua.workers.dev/api/health`.
  - Reads `GET /api/history/road-bootcamp?days=30`.
  - Checks remote D1 has `sessions.context_json`.
  - Checks remote D1 has 16 Road Bootcamp travel-strength exercises.
  - Checks all 16 Road Bootcamp travel-strength exercises have form videos.
- Verified the smoke passes against the live Worker and remote D1.
- Ran `npm run lint`, `npm run test:lib`, and `npm run build`. All passed.
- This gives future passes a quick proof that the sideloaded iOS build has the backend shape it needs without clearing remote data.

### Current Dirty Files

- `package.json`
- `scripts/smoke-road-remote-readiness.mjs`

### Next Immediate Step

Commit and push the remote readiness smoke, then continue final Road Bootcamp app QA and targeted polish.

## 2026-05-17 05:16 EDT - Phone-Facing Remote Road Bootcamp Readiness

- Checked the phone-facing Worker and remote D1 after the native API-base fix.
- Found remote D1 was behind the Road Bootcamp schema:
  - `sessions.context_json` was missing.
  - Road Bootcamp travel-strength exercise rows were missing.
- Applied `npm run db:migrate:0022:remote`.
- Remote migration wrote the Road Bootcamp context column and 16 travel-strength exercise rows.
- Verified remote D1 read-only:
  - `sessions.context_json` exists.
  - Road Bootcamp exercise count is 16.
  - Road Bootcamp exercise video count is 16.
- Found the deployed Worker was still old:
  - `POST /api/blocks/road-bootcamp` returned 404 before deploy.
- Ran `npm run deploy`.
- Deployed Worker version `05713245-c2cf-406e-8128-d7256074b885`.
- Verified phone-facing routes without resetting remote training history:
  - `GET /api/health` returned 200.
  - `GET /api/history/road-bootcamp?days=30` returned 200 and Road Bootcamp metric JSON.
- Did not call the remote fresh-start endpoint because that would clear remote training history.
- Current phone-facing backend is now aligned with the sideloaded iOS bundle.

### Current Dirty Files

- None before this handoff update.

### Next Immediate Step

Continue final Road Bootcamp app QA against the phone-facing build path. Use non-destructive remote checks unless the user explicitly asks to start/reset Road Bootcamp on production data.

## 2026-05-17 05:15 EDT - Native API Base Guard

- Re-centered the session in `/Users/lindsaybell/Developer/Waymark` after the CereBro workspace mistake.
- Verified the active branch is `codex/roadtrip-coach` and the remote is `git@github.com:Bowgull/Waymark.git`.
- Built and synced iOS once for Xcode readiness, then fixed the Capacitor version mismatch it exposed:
  - `@capacitor/core@8.3.1`
  - `@capacitor/ios@8.3.1`
  - `@capacitor/cli@8.3.1`
- Committed and pushed that native sync hygiene as `46f7e88 Align Capacitor iOS sync versions`.
- Found a phone-critical API-base issue: `.env.local` can point `VITE_API_URL` at localhost, which would make a sideloaded iPhone build try to call `http://localhost:8787`.
- Added a native API-base resolver so Capacitor iOS falls back to `https://waymark.bocas-joshua.workers.dev` when the configured API origin is blank, `localhost`, or `127.0.0.1`.
- Kept web dev behavior unchanged: browser dev still uses `http://localhost:8787`.
- Added `src/lib/apiBase.test.ts` and wired it into `npm run test:lib`.
- Ran `npm run lint`, `npm run test:lib`, `npm run build`, and `npx cap sync ios`. All passed.
- iOS web assets were synced after the API-base fix. Generated `ios/App/App/public` assets are not tracked.

### Current Dirty Files

- `package.json`
- `src/lib/apiBase.ts`
- `src/lib/apiBase.test.ts`

### Next Immediate Step

Commit and push the native API-base guard, then continue final Road Bootcamp QA and targeted polish. Do not run live AI smoke unless explicitly approved with the Anthropic key available to Wrangler.

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
- Added a Road Bootcamp fresh-start smoke:
  - `npm run smoke:road-reset` seeds disposable local profile, daily log, body metric, and running session data.
  - Starts Road Bootcamp through `POST /api/blocks/road-bootcamp`.
  - Verifies the new block is active, `road_bootcamp`, and 8 weeks.
  - Verifies profile, settings, Strava connection state, exercise library, and seeded form videos are preserved.
  - Verifies sessions, body metrics, and daily logs are cleared.
  - This smoke is local-state destructive by design. Use it against local D1 only.
- Added a Road Bootcamp week-generation smoke:
  - `npm run smoke:road-week` generates Week 1 through `POST /api/weeks/generate`.
  - Verifies the API writes 14 Road Bootcamp sessions.
  - Verifies weekly rails: 7 mobility, 2 easy runs, 1 quality run, 2 strength, 2 rope primers.
  - Verifies no bag work and no MT class are assumed.
  - Verifies the quality run carries `notes: "progression"`.
  - Verifies strength sessions keep `blockWeek: 1`.
  - Verifies Road Bootcamp strength preview stays in ready state with no pre-generated exercises.
  - Verifies repeated Week 1 generation is idempotent.
- Added a Road Bootcamp strength matrix route smoke:
  - `npm run smoke:road-strength` starts all 18 variants through `/api/sessions/:id/start-strength`.
  - Verifies every returned exercise has a form video URL.
  - Verifies every variant includes pulling work.
  - Verifies no variant includes suitcase carry.
  - Verifies no-gym and hotel-gym variants avoid barbell equipment.
  - Verifies no-gym variants include bands.
  - Verifies full-gym variants include full-gym equipment.
  - Verifies Road Bootcamp time/equipment context and adaptation line are stored.
  - Verifies repeat start remains idempotent and does not regenerate from changed input.
- Removed the local Worker `node:fs` boot warning:
  - `src/db/demoSeed.ts` now stays Worker-safe and only exports seed generation.
  - CLI file writing moved to `scripts/write-demo-seed.ts`.
  - `npm run db:demo:seed:generate` now uses the script wrapper.
- Removed the production build chunk warning:
  - Added Vite manual chunks for React, native/Capacitor code, charts, icons, tour, and shared vendor code.
  - Main app chunk dropped to 330.38 kB before gzip.
  - Build now completes without the prior 500 kB chunk warning.
- Made HR analysis use the athlete profile max HR:
  - `computeHrSnapshot` now accepts `maxHr` and derives the Zone 2 ceiling from 70% of that value.
  - The old 145 bpm ceiling remains as fallback when profile max HR is missing.
  - Weekly planning, Road Bootcamp run prescription, Road Bootcamp strength fatigue logic, reactive coaching, replace suggestions, and Block Zero transition context now pass the stored profile max HR into HR analysis.
  - Added `src/lib/hrAnalysis.test.ts` to prove the profile-based ceiling changes over-paced detection and prompt text.
- Checked remote D1 for the static warmup rows from migration `0019`.
  - Remote already has `ex-toe-touch-forward-fold`, `ex-butterfly-stretch`, `ex-standing-quad-stretch`, and `ex-standing-calf-stretch`.
  - No remote migration was run.
- Added a Strava ingest mapping contract:
  - Extracted pure mapping helpers from the Strava route for activity summary fields, split fields, HR zone buckets, and Tanaka max HR fallback.
  - `src/server/routes/strava.test.ts` proves Strava local date, distance, moving time, pace, indoor/outdoor flag, average HR, max HR, elevation, split HR/elevation, zone seconds, and DOB-derived max HR behavior.
  - `npm run test:lib` now includes the Strava route mapping test.
- Added bounded recent run evidence to Ledger AI:
  - `/api/history/running-progress` now returns `recentRunEvidence` for the latest 5 completed runs inside the selected period.
  - Evidence includes date, run type, source, distance, pace, average HR, max HR, elevation, zone seconds, and review flag.
  - Ledger sends that compact evidence to `/api/ai/ledger-insights`.
  - `buildLedgerInsightPrompt` now includes the recent run evidence block and tells the model not to overfit one run.
  - Added `src/lib/ledgerInsightsAI.test.ts`.

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
- Road Bootcamp fresh reset:
  - `npm run smoke:road-reset` passes.
  - Output confirmed `blockType: "road_bootcamp"`.
  - Output confirmed profile/settings preservation and `stravaConnectedPreserved: true`.
  - Output confirmed `exerciseCount: 72` and `formVideoCount: 72`.
  - `npm run smoke:foundation-run` passes after the reset.
  - `npm run smoke:offline-review` passes after the reset.
  - `npm run test:lib` passes.
  - `npm run lint` passes.
  - `npm run build` passes.
  - `git diff --check` passes.
- Road Bootcamp week generation:
  - `npm run smoke:road-reset` passes before the week smoke.
  - `npm run smoke:road-week` passes.
  - Output confirmed 14 sessions: 7 mobility, 2 easy runs, 1 quality run, 2 strength, 2 rope.
  - `npm run smoke:foundation-run` passes.
  - `npm run smoke:offline-review` passes.
  - `npm run test:lib` passes.
  - `npm run lint` passes.
  - `npm run build` passes.
  - `git diff --check` passes.
- Road Bootcamp strength matrix route smoke:
  - `npm run smoke:road-reset` passes before the route smoke chain.
  - `npm run smoke:road-week` passes before the strength matrix smoke.
  - `npm run smoke:road-strength` passes.
  - Output confirmed 18 variants.
  - Output confirmed exercise range: 4 to 13 exercises.
  - Output confirmed set range: 10 to 37 sets.
  - `npm run smoke:foundation-run` passes.
  - `npm run smoke:offline-review` passes.
  - `npm run test:lib` passes.
  - `npm run lint` passes.
  - `npm run build` passes.
  - `git diff --check` passes.
- Worker boot cleanup:
  - `npx wrangler dev --local --port 8787` boots with no `node:fs` warning.
  - Only the expected local scheduled-worker notice remains.
  - `npm run db:demo:seed:generate` writes 435 demo seed statements through the new CLI wrapper.
  - `npm run smoke:foundation-run` passes against the cleaned local Worker.
  - `npm run smoke:offline-review` passes against the cleaned local Worker.
  - `npm run test:lib` passes.
  - `npm run lint` passes.
  - `npm run build` passes.
  - `git diff --check` passes.
- Production chunk split:
  - `npm run build` passes with no large chunk warning.
  - Largest generated JavaScript chunk is `index` at 330.38 kB before gzip.
  - `npm run test:lib` passes.
  - `npm run lint` passes.
  - `git diff --check` passes.
- Profile-based HR analysis:
  - `npx tsx src/lib/hrAnalysis.test.ts` first failed against the old fixed 145 bpm ceiling.
  - `npm run test:lib` passes and now includes `hrAnalysis tests passed`.
  - `npm run lint` passes.
  - `npm run build` passes.
  - `git diff --check` passes.
  - `npm run smoke:road-week` initially failed with 36 sessions because local D1 already had extra QA sessions. Root cause was stale local QA state, not this change.
  - `npm run smoke:road-reset` then passed.
  - `npm run smoke:road-week` passed after reset with 14 Road Bootcamp sessions.
  - `npm run smoke:foundation-run` passes.
  - `npm run smoke:offline-review` passes.
  - Remote D1 read-only check confirmed the four `0019` warmup exercise rows exist.
- Strava ingest mapping contract:
  - `npx tsx src/server/routes/strava.test.ts` first failed because the mapping helpers were not exported.
  - `npx tsx src/server/routes/strava.test.ts` now passes.
  - `npm run test:lib` passes and now includes `strava route tests passed`.
  - `npm run lint` passes.
  - `npm run build` passes.
  - `git diff --check` passes.
  - `npx wrangler dev --local --port 8787` boots with only the expected local scheduled-worker notice.
  - `npm run smoke:foundation-run` passes.
  - `npm run smoke:offline-review` passes.
- Ledger recent run evidence:
  - `npx tsx src/lib/ledgerInsightsAI.test.ts` first failed because the prompt builder was not exported.
  - `npx tsx src/lib/ledgerInsightsAI.test.ts` now passes.
  - `npm run test:lib` passes and now includes `ledgerInsightsAI tests passed`.
  - `npm run lint` passes.
  - `npm run build` passes.
  - `git diff --check` passes.
  - Local route smoke against `http://127.0.0.1:8787/api/history/running-progress?days=7` confirmed `recentRunEvidence` returns the completed run's HR, pace, elevation, source, run type, and review flag.

## Known Warnings

- Vite build no longer reports the prior large chunk warning.
- Local wrangler no longer warns about `node:fs` on boot.
- Favicon was fixed after the last browser smoke. Static build proof passes. A live browser resmoke has not been run since that tiny fix.
- The first offline-review smoke used `start-foundation-run` and hit a local D1 posture warmup insert failure. The actual root cause was missing local warmup exercise seed rows from migration `0019`, not the `posture_session_exercises.completed` column.

## Open Product Gaps

- Session review AI now sees bounded Strava/run and strength evidence, with prompt-level test coverage. It has not been live-AI smoke tested to avoid unnecessary model spend.
- Local no-key coaching now stores deterministic reviews for completed sessions.
- Session review AI now sees prescribed HR target versus actual HR evidence for runs.
- Weekly planning and reactive coaching now use the same profile-based Zone 2 ceiling as visible run targets.
- Strava ingest mapping for run evidence now has pure test coverage.
- Ledger AI now sees Road Bootcamp summary metrics plus bounded recent run evidence.
- Local QA currently falls back when `ANTHROPIC_API_KEY` is missing. That is expected and keeps spend at zero for this pass.
- Live session-review QA now has an opt-in smoke, but it has not been run live because local Wrangler does not expose `ANTHROPIC_API_KEY`.
- Weekly Road Bootcamp generation intentionally bypasses AI and uses fixed templates.
- Road Bootcamp Week 1 route generation now has API smoke coverage.
- Road Bootcamp strength generation now has API smoke coverage across all 18 fixed variants.
- Some Ledger surfaces still feel dense, but current copy and layout are aligned enough for this slice. Needs targeted polish, not a visual-system rewrite.
- `/metrics` remains a separate manual logging route. Folding it into Ledger should wait until there is a real UX reason, not just cleanup pressure.
- Local QA has reset local D1 into a fresh Road Bootcamp state. Profile/settings/Strava/static libraries remain; generated history was cleared by `npm run smoke:road-reset`.

## Next Slice

1. If live AI QA is approved and `ANTHROPIC_API_KEY` is available to Wrangler, run `WAYMARK_LIVE_AI_SMOKE=1 npm run smoke:live-review`.
2. Continue targeted polish only where a real Road Bootcamp flow still feels unclear.
3. Remote D1 has the migration `0019` warmup rows. No action needed there unless a future remote smoke exposes a separate issue.
