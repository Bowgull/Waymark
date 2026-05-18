# Waymark Session Handoff

Updated: 2026-05-18 06:43 EDT

## Current State

Active branch: `codex/roadtrip-coach`.

Road Bootcamp is implemented as a bounded 8-week block with fixed weekly rails, 18 strength variants, strength ready UI, structured session context, Road Bootcamp Ledger metrics, Strava local proof, and a fresh reset path.

The Road Bootcamp slice is complete. Estimate: 100 percent. Live AI, remote Strava poll, production Road Bootcamp fresh start, production Week 1 generation, remote readiness, iOS sync, device build, physical iPhone install, and physical iPhone launch have all been proven.

Current remaining gates:
- None for the Road Bootcamp slice.

Current workspace expectation: clean after each pass. Do not trust older dirty-file notes inside historical entries.

## 2026-05-18 06:38 EDT - Training Reality Intelligence

- Added planned-vs-actual intelligence for Road Bootcamp reality.
- New migration:
  - `drizzle/0023_training_reality.sql`.
  - Adds planned duration, completion ratio/status, and short reason to `run_sessions`.
  - Adds planned weight/reps, inferred set status, load feedback, and band color to `strength_sets`.
- Run behavior:
  - Run rows now store planned duration at start.
  - Manual/Strava run logs now compute completion ratio and status.
  - Status values: `complete`, `shortened`, `partial`.
  - Road Bootcamp run prescription now walks back after recent shortened/partial runs:
    - next easy run can reduce to 25 or 20 minutes.
    - quality run can become easy until the easy run fits.
  - Run log shows a tiny `◇ Short run noted` line when the logged duration is below target.
- Strength behavior:
  - Strength sets now store planned weight/reps before the user edits them.
  - Actual set logging infers normal/lighter/heavier/rep shortfall/rep surplus.
  - Future strength set suggestions can reduce or increase suggested load based on recent reality for the same exercise.
  - Band exercises now expose small color dots inside the existing set tracker.
- Coach context:
  - Session review prompt now includes planned run duration, completion status, changed strength sets, and band colors.
  - Local session review handles shortened/partial runs without treating them as a skipped session.
- Applied D1 migrations:
  - `npm run db:migrate:0023:local`
  - `npm run db:migrate:0023:remote`
- Deployed Worker:
  - Version id: `21022898-9d5f-458a-8bad-c8d8aa99db2b`.
- Verified:
  - `npm run test:lib`
  - `npm run lint`
  - `npm run build`
  - `npm run smoke:road-remote`
  - Browser `/today` still shows Monday May 18 with Mobility and Zone 2 ~35min.
  - `npm run ios:sync`
  - `WAYMARK_IOS_DEVICE_ID=4B88E4ED-6344-5EAE-BDB2-F63930384B26 npm run ios:build:device`
- iPhone:
  - App installed to `file:///private/var/containers/Bundle/Application/40DB9743-C1E6-4D60-A522-EC5CEB07C199/App.app/`.
  - Launch was blocked because the phone was locked.
  - Rechecked at 06:43 EDT after device was available.
  - Launch command succeeded with `Launched application with com.joshbocas.app bundle identifier.`

## 2026-05-18 05:50 EDT - iPhone Launch Proof

- Rechecked physical device state.
  - `Josh (2)` was available and paired.
- Launched installed Waymark build on the phone.
  - Command: `xcrun devicectl device process launch --device 4B88E4ED-6344-5EAE-BDB2-F63930384B26 --terminate-existing com.joshbocas.app`.
  - Result: `Launched application with com.joshbocas.app bundle identifier.`
- Rebuilt, reinstalled, and relaunched to remove any ambiguity about installed version.
  - `WAYMARK_IOS_DEVICE_ID=4B88E4ED-6344-5EAE-BDB2-F63930384B26 npm run ios:build:device` passed.
  - Installed bundle id: `com.joshbocas.app`.
  - Installed app URL: `file:///private/var/containers/Bundle/Application/588477E9-14F4-4B40-B832-310255FB044F/App.app/`.
  - Relaunch succeeded.
- Repo was clean before this handoff update.

## 2026-05-17 19:38 EDT - Road Bootcamp Add Session Intelligence

- Made Add Session block-aware for Road Bootcamp.
- Road Bootcamp suggestions now use Road Bootcamp rails:
  - Strength.
  - Easy Run.
  - Quality Run.
  - Rope Primer.
  - Mobility.
- Road Bootcamp suggestions no longer show Bag Work, Reset, or MT Class.
- Existing non-Road blocks still use the legacy Waymark training targets.
- Fixed Road Bootcamp suggestion accounting to count the 7-day block week from the Road Bootcamp start date, not a generic Sunday-start calendar window.
- Updated the picker so API suggestions can be authoritative for the visible option set.
- Added `src/lib/sessionSuggestions.test.ts`.
- Deployed Worker:
  - Version id: `6c231056-93f0-42ba-aa61-45839e83a89e`.
- Browser QA:
  - `/today` Add Session showed Strength, Easy Run, Quality Run, Rope Primer, Mobility.
  - Confirmed no Bag Work and no Reset in the Road Bootcamp picker.
- Remote API proof:
  - `GET /api/sessions/suggestions?date=2026-05-17` returned `["Strength","Easy Run","Quality Run","Rope Primer","Mobility"]`.
- Ran:
  - `npm run test:lib`
  - `npm run lint`
  - `npm run build`
  - `git diff --check`
  - `npm run ios:sync`
  - `WAYMARK_IOS_DEVICE_ID=4B88E4ED-6344-5EAE-BDB2-F63930384B26 npm run ios:build:device`
- iPhone:
  - Device build passed.
  - First install attempt failed because the phone disconnected immediately after connecting.
  - Second install attempt passed.
  - Installed bundle id: `com.joshbocas.app`.
  - Installed app URL: `file:///private/var/containers/Bundle/Application/3BC1AB6C-B39F-4BFD-8184-EB4F863296D3/App.app/`.
  - Launch was blocked because the phone was locked.

## 2026-05-17 12:40 EDT - Road Bootcamp Tomorrow Start Fix

- Fixed Road Bootcamp Day 1 handling.
- Problem:
  - Production Road Bootcamp had been generated from the current week Monday, so Sunday 2026-05-17 looked like Day 7 instead of pre-start.
- Backend:
  - `POST /api/blocks/road-bootcamp` now accepts optional `startDate`.
  - When supplied, `training_blocks.started_at` is stamped to that date instead of request time.
- Frontend:
  - Fresh Road Bootcamp start now sends tomorrow as `startDate`.
  - Road Bootcamp week generation now derives week start dates from the block start date.
  - Fighter and Block Zero week generation still use Monday-week behavior.
- Deployed Worker:
  - Version id: `445cb306-52cb-46e6-bd11-4fc930ac5067`.
- Reset production Road Bootcamp with Day 1 as `2026-05-18`.
  - New block id: `77278f9b-0a24-42ca-a131-8df4ee7e2872`.
  - `startedAt`: `1779105600`.
  - Week 1 generated from `2026-05-18`.
  - Week 1 sessions: 14.
  - Counts: 7 mobility, 2 easy runs, 1 quality run, 2 strength, 2 rope.
- Production check:
  - `GET /api/sessions/today?date=2026-05-17` returns `[]`.
  - `GET /api/sessions/today?date=2026-05-18` returns Day 1 mobility and easy run.
  - `npm run smoke:road-remote` passed with `roadStrengthPreview: "ready_state"`.
- Browser QA:
  - `/program` shows Week 1 starting Monday May 18.
  - `/today` for Sunday May 17 shows no planned sessions.
- Ran:
  - `npm run test:lib`
  - `npm run lint`
  - `npm run build`
  - `git diff --check`
  - `npm run smoke:road-remote`
  - `npm run ios:sync`
  - `npm run ios:build:generic`
- Initial physical device build/install was blocked because Xcode reported the iPhone unavailable.
- Rechecked after the phone was plugged in and unlocked:
  - `xcrun devicectl list devices` reported `Josh (2)` available and paired.
  - `WAYMARK_IOS_DEVICE_ID=4B88E4ED-6344-5EAE-BDB2-F63930384B26 npm run ios:build:device` passed.
  - Installed `/Users/lindsaybell/Library/Developer/Xcode/DerivedData/App-abudzhqhhmeiepdhfpiodsxoimvs/Build/Products/Debug-iphoneos/App.app`.
  - Installed bundle id: `com.joshbocas.app`.
  - Launch command succeeded with `Launched application with com.joshbocas.app bundle identifier.`

### Current Dirty Files

- None after commit and push.

### Next Immediate Step

Open the app on the phone and confirm Road Bootcamp shows Sunday 2026-05-17 as pre-start and Monday 2026-05-18 as Day 1.

## 2026-05-17 12:35 EDT - Road Bootcamp Program Header Polish

- Reviewed the Road Bootcamp Program page in the in-app browser against the production Worker.
- Replaced the generic teal bordered Road Bootcamp copy card with a tighter active-program header.
- New header shows:
  - Program identity.
  - Week position.
  - Current/selected state.
  - Week intent.
  - Fixed weekly rails: 3 runs, 2 strength, daily mobility.
- Changed Road Bootcamp week navigation to a compact control row with progress, instead of repeating `Week 1` and `Road week 1 of 8` below the header.
- Kept the existing WeekView list, bottom nav, colors, brand mark, and shell structure.
- Visual QA:
  - `/program` mobile-width in-app browser.
  - Header reads as one instrument surface.
  - No text overlap observed.
  - CTA/nav remains reachable.
- Ran:
  - `npm run test:lib`
  - `npm run lint`
  - `npm run build`
  - `git diff --check`
- All passed.

### Current Dirty Files

- `src/features/program/ProgramPage.tsx`
- `WAYMARK_SESSION_HANDOFF.md`

### Next Immediate Step

Commit and push the Road Bootcamp Program header polish. If accepted, sync and reinstall to phone with `npm run ios:sync`, device build, and `devicectl install`.

## 2026-05-17 12:30 EDT - Final iPhone Launch Proof

- First launch attempt failed because iOS had not trusted the developer profile yet.
  - Error: unable to launch `com.joshbocas.app` because the profile had not been explicitly trusted by the user.
- User trusted the developer profile on the iPhone.
- Reran launch:
  - Command: `xcrun devicectl device process launch --device 4B88E4ED-6344-5EAE-BDB2-F63930384B26 --terminate-existing com.joshbocas.app`.
  - Result: launched application with `com.joshbocas.app` bundle identifier.
- Physical iPhone proof is complete.

### Current Dirty Files

- `WAYMARK_SESSION_HANDOFF.md`

### Next Immediate Step

Use Waymark on the phone. Any remaining work is product feedback from real use, not Road Bootcamp build completion.

## 2026-05-17 12:25 EDT - Final iPhone Install Proof

- Reran `npm run ios:doctor`.
  - The custom doctor still reported DDI/tunnel unavailable.
  - `xcrun devicectl list devices` reported `Josh (2)` as `available (paired)`.
- Ran physical device build:
  - Command: `WAYMARK_IOS_DEVICE_ID=4B88E4ED-6344-5EAE-BDB2-F63930384B26 npm run ios:build:device`.
  - Result: `** BUILD SUCCEEDED **`.
  - Signing identity: `Apple Development: bocass_123@hotmail.com (YUHQ9MF6NF)`.
  - Bundle id: `com.joshbocas.app`.
- Installed the built app to the iPhone:
  - Command: `xcrun devicectl device install app --device 4B88E4ED-6344-5EAE-BDB2-F63930384B26 /Users/lindsaybell/Library/Developer/Xcode/DerivedData/App-abudzhqhhmeiepdhfpiodsxoimvs/Build/Products/Debug-iphoneos/App.app`.
  - Result: app installed.
  - installationURL: `file:///private/var/containers/Bundle/Application/27964689-F234-4E63-9EE6-6C9D4512121B/App.app/`.
- No source-code change was needed beyond this handoff update.

### Current Dirty Files

- `WAYMARK_SESSION_HANDOFF.md`

### Next Immediate Step

Open Waymark on the iPhone and do a human smoke pass on Today, Program, Road Bootcamp strength ready, Library, Ledger, and Settings.

## 2026-05-17 12:20 EDT - Live Proof Pass

- User approved crossing the remaining live gates with: `do whatever you need to do`.
- Ran live AI session-review smoke against production:
  - Command: `WAYMARK_LIVE_AI_SMOKE=1 WAYMARK_API_BASE=https://waymark.bocas-joshua.workers.dev npm run smoke:live-review`.
  - Result: passed.
  - Proof session id: `c2bc0121-b9d5-4f24-902d-7ac9b718f478`.
  - Review source: `ai`.
  - Review flag: `intensity_mismatch`.
  - Review: `Zone-2 attempt, HR climbed to 143 avg, 160 peak. Ceiling is 132. Pace holding back will fix it next run.`
  - Smoke cleanup reset the proof session back to planned state.
- Ran production Strava poll:
  - Command: `POST https://waymark.bocas-joshua.workers.dev/api/strava/poll-recent`.
  - Result: `{ "ingested": 0, "connected": true }`.
- Ran iOS sync:
  - Command: `npm run ios:sync`.
  - Result: passed.
- Ran iOS device doctor:
  - Command: `npm run ios:doctor`.
  - Result: blocked by device availability.
  - `Josh (2)` and `iPhone` are paired with Developer Mode enabled, but DDI services and tunnel are unavailable.
- Ran generic iOS build:
  - Command: `npm run ios:build:generic`.
  - Result: `** BUILD SUCCEEDED **`.
- Started production Road Bootcamp fresh:
  - Command: `POST /api/blocks/road-bootcamp` with `{ "confirmReset": true }`.
  - New block id: `5aa6d3f8-a885-4fc2-a324-6fa564afb0b7`.
  - Block type: `road_bootcamp`.
  - Status: `active`.
- Generated production Road Bootcamp Week 1:
  - Command: `POST /api/weeks/generate`.
  - Week 1 sessions: 14.
  - Counts: 7 mobility, 2 easy runs, 1 quality run, 2 strength, 2 rope.
  - No bag work or MT class was generated.
- Ran remote readiness after production start:
  - Command: `npm run smoke:road-remote`.
  - Result: passed.
  - `roadStrengthPreview`: `ready_state`.
  - Road Bootcamp travel-strength exercises: 16.
  - Form video URLs: 16.
- Checked production Today for `2026-05-17`:
  - 1 planned Road Bootcamp mobility session.
- Production training history was cleared as part of the approved Road Bootcamp fresh start.
- No source-code change was needed beyond this handoff update.

### Current Dirty Files

- `WAYMARK_SESSION_HANDOFF.md`

### Next Immediate Step

Wake and unlock the target iPhone, trust this Mac if prompted, keep the phone screen awake, then run `npm run ios:doctor`. If a device reports `READY`, run `WAYMARK_IOS_DEVICE_ID=<CoreDevice id> npm run ios:build:device`.

## 2026-05-17 12:15 EDT - Final Plan Drift Cleanup

- Rechecked current docs, scripts, and source for stale gate language.
- Fixed one old `BUILD_PLAN.md` session-log line that omitted the production Road Bootcamp fresh-start gate.
- No code changes were needed.
- No production data was reset.
- No live AI smoke was run.
- No remote Strava poll was run.
- No Xcode sync/install was run.

### Current Dirty Files

- `BUILD_PLAN.md`
- `WAYMARK_SESSION_HANDOFF.md`

### Next Immediate Step

Commit and push the plan drift cleanup. Remaining work is still approval-gated live proof only.

## 2026-05-17 12:08 EDT - Gate Alignment Pass

- Rechecked the repo for safe ungated work.
- `git status` was clean at start.
- `npm audit --json` still reports 4 moderate dev-tool findings through `drizzle-kit`.
  - Latest `drizzle-kit` is still `0.31.10`.
  - npm's suggested fix remains a breaking downgrade to `0.18.1`.
  - No dependency change was made.
- Updated `BUILD_PLAN.md` so the current gate list matches this handoff:
  - live AI smoke.
  - remote Strava poll.
  - production Road Bootcamp fresh start.
  - final Xcode phone proof.
- No production data was reset.
- No live AI smoke was run.
- No remote Strava poll was run.
- No Xcode sync/install was run.

### Current Dirty Files

- `BUILD_PLAN.md`
- `WAYMARK_SESSION_HANDOFF.md`

### Next Immediate Step

Commit and push the gate alignment. After that, there is no known safe ungated build work left in the Road Bootcamp slice.

## 2026-05-17 11:57 EDT - Remote Smoke Retry Hardening

- Hardened `scripts/smoke-road-remote-readiness.mjs`.
- Remote D1 reads now retry up to 3 times before failing.
- Reason:
  - The prior final verification pass hit a transient Cloudflare D1 API `7403`.
  - Direct D1 proof and the rerun passed.
  - The smoke should fail real schema/data issues, not a single remote read blip.
- Ran:
  - `npm run smoke:road-remote`
  - `npm run test:lib`
  - `npm run lint`
  - `git diff --check`
  - `npm run build`
- All passed.
- No production data was reset.
- No live AI smoke was run.
- No remote Strava poll was run.
- No Xcode sync/install was run.

### Current Dirty Files

- `scripts/smoke-road-remote-readiness.mjs`
- `WAYMARK_SESSION_HANDOFF.md`

### Next Immediate Step

Commit and push this script hardening. Remaining gates are unchanged: live AI smoke, remote Strava poll, production Road Bootcamp fresh start, and final Xcode phone proof.

## 2026-05-17 11:44 EDT - Final Safe Verification Pass

- Ran the full safe verification path:
  - `npm run test:lib`
  - `npm run lint`
  - `npm run build`
  - `npm run smoke:road-remote`
- `npm run test:lib`, `npm run lint`, and `npm run build` passed.
- First `npm run smoke:road-remote` hit Cloudflare D1 API error `7403`.
  - `npx wrangler whoami` showed the expected logged-in account.
  - `npx wrangler d1 list` showed `waymark-db`.
  - A direct `SELECT 1` against remote D1 then passed.
  - Rerunning `npm run smoke:road-remote` passed.
- Final remote smoke proof:
  - Worker origin: `https://waymark.bocas-joshua.workers.dev`.
  - Unconfirmed Road Bootcamp reset returns `400`.
  - `sessions.context_json`, `sessions.skip_reason`, and `sessions.skip_reason_detail` exist.
  - Road Bootcamp exercise proof: 16 rows, 16 video URLs.
  - Road strength preview: `not_applicable` because production is not currently in Road Bootcamp.
- No code changes were needed.
- No production data was reset.
- No live AI smoke was run.
- No remote Strava poll was run.
- No Xcode sync/install was run.

### Current Dirty Files

- `WAYMARK_SESSION_HANDOFF.md`

### Next Immediate Step

Commit and push the verification handoff. Remaining gates still require explicit approval: live AI smoke, remote Strava poll, production Road Bootcamp fresh start, and final Xcode phone proof.

## 2026-05-17 10:27 EDT - Remote Preview Scripts

- Verified production reference routes are healthy:
  - `/api/exercises`: 72 rows.
  - `/api/combos`: 55 rows.
  - `/api/history/road-bootcamp?days=30`: 200.
- Added explicit localhost browser-QA scripts that point the UI at the production Worker:
  - `npm run dev:remote`
  - `npm run build:remote`
  - `npm run preview:remote`
- Updated README with the remote-preview path.
- Reason:
  - Default web dev still points to `localhost:8787` through `.env.local`.
  - That is correct for local Worker work.
  - It causes empty or failed screens if Vite is running without Wrangler.
  - Remote-preview scripts make quick UI QA explicit instead of silently depending on local D1.
- Ran:
  - `npm run test:lib`
  - `npm run lint`
  - `npm run build:remote`
  - `npm run build`
- All passed.
- No production data was reset.
- No live AI or remote Strava poll was run.

### Current Dirty Files

- `package.json`
- `README.md`
- `WAYMARK_SESSION_HANDOFF.md`

### Next Immediate Step

Commit and push the preview-script slice. Continue app-completion work without more Xcode sync until final phone proof.

## 2026-05-17 10:24 EDT - Dependency Audit Reduction

- Ran `npm audit --json`.
  - Starting state: 11 vulnerabilities.
  - 3 high.
  - 8 moderate.
- Ran `npm audit fix` after dry-run confirmed the safe fix set.
- Updated lockfile packages:
  - `@xmldom/xmldom`: 0.8.11 to 0.8.13.
  - `vite`: 7.3.1 to 7.3.3.
  - `postcss`: 8.5.8 to 8.5.14.
  - `hono`: 4.12.9 to 4.12.19.
  - `fast-uri`: 3.1.0 to 3.1.2.
  - `ip-address`: 10.1.0 to 10.2.0.
  - `express-rate-limit`: 8.3.2 to 8.5.2.
- New audit state: 4 moderate vulnerabilities, all through `drizzle-kit` and its old `@esbuild-kit` dev dependency path.
- Did not run `npm audit fix --force`.
  - npm would install `drizzle-kit@0.18.1`, a breaking downgrade from `0.31.10`.
- Ran:
  - `npm run test:lib`
  - `npm run lint`
  - `npm run build`
- All passed.
- No production data was reset.
- No live AI or remote Strava poll was run.

### Current Dirty Files

- `package-lock.json`
- `WAYMARK_SESSION_HANDOFF.md`

### Next Immediate Step

Commit and push the audit reduction. Leave the remaining `drizzle-kit` moderate findings as tracked dev-tool risk unless a non-downgrade fix becomes available.

## 2026-05-17 10:19 EDT - iOS Device Doctor

- Added `scripts/ios-device-doctor.mjs`.
- Added package scripts:
  - `npm run ios:doctor`
  - `npm run ios:build:device`
- `ios:doctor` reads `xcrun devicectl list devices --json-output` and prints the fields that matter for sideload:
  - CoreDevice id.
  - UDID.
  - pairing state.
  - Developer Mode state.
  - DDI service availability.
  - CoreDevice tunnel state.
- Physical device build command now uses:
  - `WAYMARK_IOS_DEVICE_ID=<CoreDevice id> npm run ios:build:device`
- Updated README with the new physical-device gate and build command.
- User decision: defer more Xcode sync/install work until the app build is otherwise finished.
- Do not keep running native sync/build on every pass. Use the scripts when final phone proof is needed.
- No production data was reset.
- No live AI or remote Strava poll was run.

### Current Dirty Files

- `scripts/ios-device-doctor.mjs`
- `package.json`
- `README.md`
- `WAYMARK_SESSION_HANDOFF.md`

### Next Immediate Step

Commit and push the iOS doctor slice, then pivot back to app completion work. Physical install proof waits until the final build pass.

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
  - `npm run deploy` passes. Deployed Worker version `22a4d8ca-c01c-46ad-b0ca-c0aefac49596`.
  - Remote checks returned 200 for `/api/history/weekly-zones?weeks=8` and `/api/history/aerobic-fitness?days=90`.
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
- Ledger HR zone surfaces:
  - `npx tsx src/lib/historyHrMetrics.test.ts` first failed because `historyHrMetrics` did not exist.
  - Added read-only `/api/history/weekly-zones` and `/api/history/aerobic-fitness`.
  - Ledger now has gated Weekly Zones and Aerobic Base cards derived from completed Strava/manual run evidence.
  - Both cards wait for at least 3 HR-equipped samples.
  - `npm run test:lib` passes.
  - `npm run lint` passes.
  - `npm run build` passes.
- Browser and production schema QA:
  - In-app browser first exposed Program stuck in loading state against the production API.
  - Root cause was remote D1 schema drift: `sessions.skip_reason` and `sessions.skip_reason_detail` were missing.
  - Applied `drizzle/0011_skip_reason.sql` to remote D1. No history reset.
  - Re-ran `/api/weeks/generate` for current Block Zero week 4. It now returns 200 and generated 18 planned sessions.
  - Removed two empty duplicate week plans created by failed generation attempts.
  - Headless Playwright verified `/today`, `/program`, `/library`, `/history`, and `/settings` load with Waymark logo/nav and no loading or failed state.
  - Screenshot evidence saved outside the repo at `/tmp/waymark-qa/waymark-history-qa.png`.
- Remote readiness guard:
  - Hardened `scripts/smoke-road-remote-readiness.mjs` so it checks `sessions.context_json`, `sessions.skip_reason`, and `sessions.skip_reason_detail`.
  - `npm run smoke:road-remote` passes and now reports all 3 required session columns.
  - `npm run test:lib` passes.
  - `npm run lint` passes.
  - `npm run build` passes.
- Targeted migration commands:
  - Added `db:migrate:0011:local` and `db:migrate:0011:remote` so the skip-reason migration can be applied directly.
  - Updated README to show targeted D1 migration commands and warn against passing extra `--file` arguments through the base `db:migrate:remote` script.
  - `npm run smoke:road-remote` passes.
  - `npm run test:lib` passes.
  - `npm run lint` passes.
  - `npm run build` passes.
- Road strength preview remote guard:
  - Extended `scripts/smoke-road-remote-readiness.mjs` to check Road Bootcamp strength preview behavior when a production Road Bootcamp strength session exists.
  - The smoke now asserts `roadBootcampReady: true` and no pre-generated exercises for that preview.
  - If production has no Road Bootcamp strength session, the smoke reports `roadStrengthPreview: "not_applicable"` instead of failing on an empty D1 result.
  - `npm run smoke:road-remote` passes.
  - `npm run test:lib` passes.
  - `npm run lint` passes.
  - `npm run build` passes.
- Road strength ready copy source:
  - Exported `getRoadBootcampAdaptationLine` from `src/lib/roadBootcampStrengthTemplates.ts`.
  - Added test coverage proving the helper is reusable by the fixed matrix and UI.
  - Updated the Road Bootcamp strength ready screen to use the shared helper instead of duplicating adaptation-line copy.
  - `npx tsx src/lib/roadBootcampStrengthTemplates.test.ts` passes.
  - `npm run test:lib` passes.
  - `npm run lint` passes.
  - `npm run build` passes.
- Road run HR ceiling alignment:
  - Removed hardcoded `145 bpm` from Road Bootcamp HR adjustment copy.
  - Road Bootcamp run prescriptions now carry the computed profile-based Zone 2 ceiling when HR evidence is present.
  - Run session target chips use the prescription ceiling for profile-based Zone 2 work.
  - `npx tsx src/lib/roadBootcampTemplate.test.ts` passes.
  - `npm run test:lib` passes.
  - `npm run lint` passes.
  - `npm run build` passes.
- Program/run HR preview alignment:
  - Program now reads `/api/user-profile` and passes `maxHr` into week previews.
  - Program Zone 2 details now show profile-derived HR bands when available, or talk test when not.
  - Road Bootcamp Program previews use Road week run durations instead of the old 15-20 minute fallback.
  - Block Zero/Fighter Zone 2 prescriptions now carry the computed Zone 2 ceiling through the run API.
  - System HR coaching prompt no longer teaches a fixed `130-145` or `145 bpm` ceiling.
  - `npm run test:lib` passes.
  - `npm run lint` passes.
  - `npm run build` passes.
  - `npm run smoke:foundation-run` passes after starting local Wrangler on `127.0.0.1:8787`.
- Worker deploy after HR ceiling alignment:
  - Deployed the current `codex/roadtrip-coach` Worker after the run API/profile HR ceiling changes.
  - Production Worker version: `efff7cf4-49d2-4820-a040-280f9f5f4722`.
  - `npm run smoke:road-remote` passes.
  - Remote smoke returned `unconfirmedResetStatus: 400`.
  - Remote D1 still has `sessions.context_json`, `sessions.skip_reason`, and `sessions.skip_reason_detail`.
  - Remote D1 still has 16 Road Bootcamp travel-strength exercises and 16 form videos.
  - No remote Road Bootcamp reset, live AI smoke, or remote Strava poll was run.
- Foundation-run HR smoke hardening:
  - Tightened `npm run smoke:foundation-run` so it asserts the returned prescription includes `z2CeilingBpm`.
  - The smoke now rejects stale `HR target: 130-145 bpm` text.
  - The first hardened smoke exposed that Road Bootcamp easy-run prescriptions omitted `z2CeilingBpm` before HR history existed.
  - Fixed Road Bootcamp easy-run prescriptions so they carry the computed Zone 2 ceiling from day 1.
  - `npx tsx src/lib/roadBootcampTemplate.test.ts` passes.
  - `npm run smoke:foundation-run` passes with local profile ceiling `132`.
  - `npm run test:lib` passes.
  - `npm run lint` passes.
  - `npm run build` passes.
- Worker deploy after foundation-run HR smoke hardening:
  - Deployed the current Worker after `948eb51`.
  - Production Worker version: `92a7f3a2-afda-4cab-bbe8-b995e677a268`.
  - `npm run smoke:road-remote` passes.
  - Remote smoke returned `unconfirmedResetStatus: 400`.
  - Remote D1 still has required Road Bootcamp session columns, 16 travel-strength exercises, and 16 form videos.
  - No remote Road Bootcamp reset, live AI smoke, remote Strava poll, or Xcode sync was run.
- Writable smoke remote guards:
  - `npm run smoke:foundation-run` and `npm run smoke:offline-review` now refuse non-local API targets unless `WAYMARK_ALLOW_REMOTE_SMOKE=1` is set.
  - Verified both scripts fail closed against `https://waymark.bocas-joshua.workers.dev` before any API call.
  - Verified both scripts still pass against local Wrangler on `127.0.0.1:8787`.
  - Updated README data rules with the writable-smoke guard.
  - `npm run test:lib` passes.
  - `npm run lint` passes.
  - `npm run build` passes.
- Build-plan stale gate cleanup:
  - Updated `BUILD_PLAN.md` so the old mobility migration session log no longer says production migration is pending.
  - Added explicit current gates to the top of this handoff.
  - Added a note that older dirty-file notes are historical and should not override current `git status`.
  - `npm run test:lib` passes.
  - `npm run lint` passes.
  - `npm run build` passes.
- Recovery-doc safety cleanup:
  - Updated `docs/TESTING.md` so recovery guidance no longer recommends staging everything or using destructive reset by reflex.
  - Updated the copied setup reference in `docs/reference/waymark-full-stack-setup.txt` to match the same no-destructive-cleanup posture.
  - `rg "git reset --hard|reset --hard" docs README.md BUILD_PLAN.md WAYMARK_SESSION_HANDOFF.md` now only finds the explicit warning in `docs/TESTING.md`.

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
- v2 `BUILD_PLAN.md` has been corrected from stale TODO state to current DONE state for steps 1-7.
- Ledger page was screenshot-verified after the production schema fix.

## Next Slice

1. If live AI QA is approved and `ANTHROPIC_API_KEY` is available to Wrangler, run `WAYMARK_LIVE_AI_SMOKE=1 npm run smoke:live-review`.
2. If remote Strava polling is approved, run the existing poll checks against production once.
3. Continue targeted Road Bootcamp UI polish only where a real flow still feels unclear.
4. Final Xcode sync/install waits until the full finished build gate.
