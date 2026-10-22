# Handoff: page 74, the recorder half (branch `run-strap`)

Worktree: `C:\Users\Shadow\Waymark-run`, branch `run-strap`, built from 96eea12. Nothing has been pushed or deployed.
The run-screen UI half belongs to the other session (worktree `Waymark-runui`, branch `run-ui`).

## DONE

Commits on `run-strap`:
- `e22eb54` Run recorder: the native strap + GPS recorder, the JS interface with a web mock, the recording ingest, Strava retired on the server.
- `87aefc0` Settings: the heart rate strap is the only connection; Strava taken out of the app; the heart container; the upload helper; e2e 20-strap.
- (this commit) Swift tweaks (rejoin padding, throttling of the Live Activity distance updates) and this file.

Branch `run-strap-ui-wip` (`51c1c61`, on top of e22eb54) holds UI work I had already started before the split: the × 3 s hold with a fill, EndControl/CloseWindow (END AND LOG / DISCARD), the × on SessionShell, the hold constants in timerLook, and an older HeartContainer. It is **not** finished: WorkoutPage's `SessionNav.discard` is not wired, so tsc fails on that branch. The UI half can take it or leave it. The HeartContainer on `run-strap` is the newer one.

### Files (my half)
- `ios/App/App/WaymarkRunRecorderPlugin.swift`: the spike file, renamed and hardened (the pbxproj entry was renamed in place; AppViewController registers it).
  - CoreBluetooth for HRS 0x180D/0x2A37. The strap is remembered under the spike's UserDefaults keys. Reconnect has no timeout; state restoration is on. A watchdog re-subscribes after 10 s of silence while linked and reconnects after 20 s. Values with 0 bpm or "not in contact" are dropped.
  - CoreLocation runs in the background (When In Use, a CLBackgroundActivitySession held for the whole run, no auto-pause). Fixes are filtered on accuracy (30 m in the first minute, then 20 m), age (10 s or less), and speed (8 m/s or less), with a drift guard for standing still.
  - A 1 Hz JSONL journal lives in Application Support/run-recordings, writable while locked. Crash-resume: the active runId is kept in UserDefaults; start() with the same runId rejoins and pads the seconds lost while the app was dead (no HR, no distance).
  - The Live Activity heart rate, zone, distance and hrSeq are updated natively while the phone is locked: on a zone change at once, a moved number every 5 s at most, distance alone every 15 s.
- `ios/App/App/WaymarkAttributes.swift` + `WaymarkLiveActivityPlugin.swift`: optional ContentState fields `hr`, `hrZone` (in|gold|over|none), `hrSeq`, `distanceKm`, `runKind` (easy|runwalk). These are data only; the widget does not draw them yet.
- `ios/App/App/Info.plist`: the `strava` query scheme is removed.
- `src/lib/runRecorder.ts`: **the interface contract** (see below).
- `src/lib/runRecording.ts`: the RunRecording shape, cleanHr, summarizeRecording, recordingSplits, zoneStreams, isRecording, durationText.
- `src/lib/hrZoneState.ts`: the zone stepper (GOLD_BAND 5, OVER_SEC 30), ZONE_TINT, heartState, enteredOver. Swift uses the same numbers.
- `src/lib/runRecordingUpload.ts`: uploadRecording and resumeRecordingUploads (the latter is called at launch in AppRoutes).
- `src/lib/outboxSync.ts`: `dropSessionWrites(sessionId)`, for DISCARD.
- `src/server/runRecordingIngest.ts` + route `POST /api/run-sessions/:id/recording` (behind the Idempotency-Key middleware). It uses hrZones bucketZones, sustainedMaxHr and maxHrAfterRun plus the Tanaka seed, and writes source 'waymark', attachment 'confirmed', splits replaced whole, activity start and end.
- `src/server/discardSession.ts` + route `POST /api/sessions/:id/discard` (idempotent). The session goes back to planned and every row its start created is removed (sets, sse, the Block Zero auto e1RM rows written during it, rounds/combos/ratings, the run plus splits, holds, rope, recovery, class log). It answers 409 on a completed session.
- `src/server/routes/strava.ts`: the webhook POST and `/poll-recent` are now no-ops (no call to Strava). The ingest code stays, unused, so its tests still pass.
- `src/features/session/RunSessionView.tsx`: Strava parts only (deep link, poll, PULL RUN FROM STRAVA, FROM STRAVA, confirm, the ready-board note).
- `src/features/settings/StrapBoard.tsx` + `SettingsPage.tsx` + `settings.css`: Connections holds only the strap. The One Pace / Naruto rows moved to the Training board.
- `src/components/heart/HeartContainer.tsx` + `heartPixels.ts`: the heart container (option I).
- Removed: `RecorderSpikePage`, `recorderSpike*.ts`, the `/dev/recorder` route and the crest hold on Logs.
- Tests: `hrZoneState.test.ts`, `runRecording.test.ts`, `server/runRecordingIngest.test.ts` (ingest + discard), all in `test:lib`. e2e `tests/e2e/20-strap.spec.ts`.

### The interface contract (`src/lib/runRecorder.ts`)
`runRecorder()` returns the RunRecorderApi: native on iOS, the web mock elsewhere.
- `strapStatus()`, `connectStrap()` (resolves when linked; rejects after about 20 s with no strap; the mock takes 1.7 s), `forgetStrap()`, `onStrap(cb)`. StrapStatus = `{ link: none|saved|searching|connected|silent, name, battery?, hr? }`. `strapLine()` gives the Settings words.
- `start({ runId, sessionId, runSessionId, outdoor, ceilingBpm, startedAtMs })`. Calling it again with the same runId rejoins the run.
- `pause()`, `resume()`, `snapshot()` (the recording so far), `stop()` returns a RunRecording, `discard(runId?)`, `unfinished()` returns `{ recording, active }`, `ackUploaded(runId)`.
- `onTick(cb)` at 1 Hz: `{ t, elapsedSec, movingSec, hr|null, distanceM, link, zone? }`.
- Web/test hook: `window.__wmStrapMock.hr(bpm|null)`, `.distance(m)`, `.absent(bool)`. localStorage `wm.mockStrap` marks a strap as remembered.

## Integration points the UI half must call
1. On START RUN: `runRecorder().start({ runId: newIdempotencyKey(), sessionId, runSessionId: runSession.id, outdoor: !isIndoor, ceilingBpm: prescription.z2CeilingBpm, startedAtMs })`. **Keep the runId in the run's engine state (resume)**, so that BACK IN YOUR SESSION / relaunch rejoins the same journal.
2. The grass tap pause/resume: `runRecorder().pause()` / `resume()`.
3. The live screen: `onTick` gives hr, distanceM and link. Step `nextZone(prev, tick.hr, ceiling, tick.t)` for teal/gold/ember and fire the one buzz on `enteredOver`. Show a dim heart with "--" when link is not `connected`.
4. Log your run, filled: `snapshot()` then `summarizeRecording(rec)` gives `distanceKm`, `durationSec` (show it with `durationText`), `avgHr`, `maxHr`. Do not stop the recorder until SAVE RUN, so a tap outside returns to the run.
5. SAVE RUN: `stop()` then `uploadRecording(rec)` (outbox, key = runId, acks itself). Then keep today's PATCH plus the effort close. Note: the PATCH of typed values runs after the upload; if the upload is queued offline, it lands later and its values win.
6. DISCARD: `runRecorder().discard(runId)`, `dropSessionWrites(sessionId)`, then queueWrite `POST /api/sessions/:id/discard` (kind 'discard'), clear resume/live session, end the LA, and go to Today.
7. Live Activity config for runs: send `hrZone`, `runKind` ('easy' or 'runwalk') and the latest `hr` / `distanceKm` with every JS update, so the native values never blink out. stateKey already includes hrZone and runKind. The widget must draw these fields (heart grid from heartPixels, zone colours, stones by colour, ember rune assets) — UI half.
8. TodayPage (Today owner): it still POSTs `/api/strava/poll-recent`, which now returns `{ingested:0, connected:false}`. That call can be deleted, and the max-HR bump pop-up there is gated on `connected`, so it never fires for recorded runs: move that check after a run is saved.

## LEFT (exact steps)
1. Compile on the GitHub macOS build (`ios:build:generic` in CI). I could not compile Swift on Windows. Spots to watch in `WaymarkRunRecorderPlugin.swift`:
   - `call.getDouble`, `call.getInt` for a null `ceilingBpm`;
   - `Activity.content.state` mutation;
   - the struct memberwise init of `Run`;
   - `Self.nn` for NSNull;
   - `CLBackgroundActivitySession` (iOS 17 target, fine).
2. On the phone (Sideloadly, free ID):
   - pair the H9Z in Settings;
   - a 30–45 min locked run: no GPS gaps, HR continuous, the blue indicator showing;
   - unclip the strap for 60 s (silent, then reconnect);
   - kill the app mid-run, relaunch, rejoin (padding);
   - airplane-mode finish, then one upload (no duplicates);
   - Live Activity HR/zone updates while locked (throttled by iOS budget; may skip);
   - check the Coospo silent-notification issue on iOS 27.
3. The run-screen wiring (integration points 1–7) is the UI half.
4. Linux e2e baselines to regenerate: `05-run-walk.spec.ts/run-walk-ready.png` (the Strava note is gone from the ready board) and the new `20-strap.spec.ts/strap-connected.png`. win32 baselines for both are updated and committed.

## Test results (at 87aefc0)
- `npx tsc -b`: clean.
- `npm run test:lib`: all pass, including the new tests.
- Full Playwright `--retries=1`: **70 passed, 4 failed, 4 did not run** (22 min). The failures are 16-start-day (2: "A start tomorrow…", "A later day…"), 18-dead-ends #4 and 19-tap-grass "Items 4-5". All four wait for the Program page ("Weeks of the block" / Restart Block Zero / CHANGE DAY), and none of them touch my files.
  - 18-dead-ends #4 passes alone on the base commit 96eea12. I did **not** get to run it alone on run-strap, or the full suite on base, so whether these are order-dependent or date-dependent and pre-existing is **unconfirmed**.
  - Next step: run `npx playwright test tests/e2e/16-start-day.spec.ts tests/e2e/18-dead-ends.spec.ts` on run-strap. If they pass alone, the failure is suite-order state from the earlier specs (it is not caused by the strap spec, which runs last as 20-).
- Playwright output deleted.

## Migrations
None. run_sessions already has source, zone_seconds, activity_start_at/end_at, and run_splits exists. The new value `source='waymark'` needs no schema change.

## Spotify
Removed from scope (Josh did not choose it). Nothing was added.

## Known risks
- Background BLE/GPS and Live Activity updates are best effort on iOS. LA updates are budgeted with no published number.
- The H9Z contact/RR behaviour is unknown; samples marked noContact are dropped.
- The GPS drift filter is simple: check distance against a known loop.
- Discard regenerates start rows on the next ENTER: bag rounds come from the AI again, strength from the brain dose of that day.
- The journal of an old crashed run is deleted if a *different* run is started before it is rejoined.
- The 7-day free-signing expiry is unchanged.
