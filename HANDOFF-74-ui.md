# Handoff: mockup 74, the UI half (branch `run-ui`)

Worktree: `C:\Users\Shadow\Waymark-runui`. Mockup: `Documents/Aang/waymark-mockups/74-run-with-strap.html`.
Nothing is pushed or deployed.

## Commits on run-ui (newest last)
- `606d37a` the run screen work, first pass (also has the Swift widget)
- `aac2da4` merge of run-strap `87aefc0` (done: their HeartContainer + heartPixels kept, their runRecordingUpload used, their Strava removals kept; DISCARD calls `dropSessionWrites`)
- the WIP commit with this file: closeHead, `boardAway.ts`, spec updates, the new spec, the timerLook unit tests

## Checks at handoff
- `npx tsc -b`: clean. `npm run test:lib`: passes (timerLook gained 4 tests).
- `tests/e2e/21-run-screen.spec.ts` (new, 5 tests): all passed on their own.
- Full Playwright run (`--retries=1`) was at 82/83 when the session stopped. Known so far:
  - `05-run-walk`: screenshot failures, expected (the ready board now has the Shape row and "≤ 147"; the run screen changed). Regenerate the baselines.
  - `13-way-out`: every test retried; `A page you went into goes back with the edge swipe (a Library group)` timed out tapping the Library `strength` row. That row is outside this work. Rerun it alone to see if it's a flake. The way-out × test now taps END AND LOG after the hold.
  - `19-tap-grass` Item 1-3 ("× still holds to end") and Item 1 (TAP TO START) were retrying at the stop. The × label is now 'End. Hold for 3 seconds.' (already updated in the spec). Check the hold timing / END AND LOG step in Item 1-3, then whether Item 1 is a knock-on.
  - Everything else seen passed. The run was still going (retries) when the session stopped.
- Swift: not compiled here (Windows). It needs the GitHub macOS build.

## Baselines to regenerate
- win32 and Linux: `05-run-walk.spec.ts/run-walk-ready.png`, `run-walk-run.png`, `run-walk-walk.png`.
- Any other run-screen or × screenshot the CI build flags.

## Per approval item
1. **Heart container**: done. Uses run-strap's `src/components/heart/HeartContainer.tsx` at 84 on the run screen. Swift draws the same 13×11 grid (14 on the lock card, 22 compact/minimal, 44 expanded).
2–4. **Settings connect/forget**: run-strap's work, not this branch.
5. **Run screen heart**: display only. It shows the zone colour; with no strap it is dim (idle) with `---` (`RunSessionView.tsx`, `.ss-live`).
6. **Distance**: from ticks, `(distanceM/1000).toFixed(2)` KM. Outdoor only; hidden indoors.
7. **Zones**: done. `nextZone` steps on every tick. `enteredOver` gives one `tapHaptic` (the haptic only, no tone). EASE OFF (clay) replaces RUNNING or RUN. The number colour eases over 1 s in CSS. The grass tint eases over 1 s (`zoneEase`, `zoneCell` in `grassScene.ts`). Reduce Motion: instant.
8. **Plan chips**: removed from the running screen. The ready board shows Time, Heart rate `≤ <line>`, Breathing NASAL, and a new Shape row (`runShape`: run-walk pieces or ONE STEADY RUN).
9. **Grass bend finish**: done in `GrassZone.tsx` with the `hold` and `zone` props.
   - Hold 3 s and the wave spreads from the thumb (formula ported from the mockup's `timerZone`), drawn at 60 fps while it bends.
   - FINISHING (xs gold flap) replaces HOLD · FINISH after 1 s.
   - Let go early and it eases back over 450 ms. A press under 300 ms is still the pause tap.
   - At full: `tapHaptic`, then after 250 ms Log your run.
   - The swipe-up finish is removed on runs (`hold` disables `onSkip`).
   - FINISH RUN is removed.
10. **× 3 s**: done for every SessionFrame screen and SessionShell (Reset).
    - The fill rises through the plate. The close window shows END AND LOG (gold) and DISCARD (small ember). A tap outside fades it away over 180 ms (`useEaseAway`).
    - DISCARD (`WorkoutPage.discardSession`): clears resume, live strip and cues; calls `runRecorder().discard()` on running and foundation_run; calls `endAllLiveActivities()` and `dropSessionWrites(id)`; queues `POST /api/sessions/:id/discard` through the outbox; then goes to `/today`.
    - END AND LOG on a run opens Log your run.
11. **Content grows**: `.ss-runmid` fills from the stop row to the grass top with space-evenly. Clock flaps are 84 px (`TimerFace big`), the live row 34 px, the heart box 92.
12. **Calm beat**: run-strap's HeartContainer.
13. **Dismiss rule**: Log your run sits over the run screen. A tap outside or CLOSE fades it away over 180 ms. The clock resumes if it was running (`resumeOnClose`, persisted), nothing is saved, and the grass eases back.
14. **Mixer**: mockup only.
15–21. **Lock card and island** (`ios/App/WaymarkActivity/WaymarkActivityWidget.swift`):
    - New run card and island regions whenever a run's state carries `hrZone`.
    - Ember rune PNGs (`rune-<pause|play|skip>-ember`) and `rune-stone-blank` for the wide stone.
    - Easy run: one 98×44 stone on the lock card, 96×44 on the island. Run-walk: pause + skip.
    - Stones and grass take the zone tint. The heart glows once per `hrSeq` via a transition. No strap: dim heart and "--".
    - TS sends `hr`, `hrZone`, `distanceKm`, `runKind`, and on run-walk `stepIndex/stepTotal`, with phase `rest` while walking.
    - **onAdvance fix**: done. Skip moves the run-walk on to the next piece (`skipPiece`) and does nothing on an easy run. It never finishes the run.
22. **Log your run filled**: from `runRecorder().snapshot()` (km, avg, max) plus the clock time. "Tap a number to change it." shows only when nothing came from the strap. SAVE RUN calls `stop()`, then `uploadRecording(rec)` (outbox, key = runId), then the PATCH.

## Left to do (exact steps)
1. Read the end of the full Playwright run (or rerun `npx playwright test --retries=1`). Rerun `13-way-out` alone. If the Library `strength` tap times out again, check whether it fails on run-strap too.
2. Regenerate the `05-run-walk` baselines: win32 with `npx playwright test tests/e2e/05-run-walk.spec.ts --update-snapshots`. Linux via CI.
3. Run the GitHub macOS build to confirm the Swift compiles. The riskiest spots: `AnyTransition.modifier` in `LiveHeart`, `Image.resizable(capInsets:)` in `WideRuneStone`, and `Text + Text` with `foregroundStyle` (needs iOS 17; the target is 17.0).
4. Delete Playwright output: `test-results/`, `playwright-report/`.
5. Phone-only checks:
   - the lock card and island visuals
   - the glow per update
   - the wide stone's look
   - the haptic on EASE OFF and at full hold
   - the 60 fps bend feel
   - recorder rejoin after a relaunch mid-run
   - DISCARD with the native recorder

## Decisions and deviations
- **Grass height**: stays at the app's 47% (the mockup draws 44%). The mid area is computed from that.
- **Shape row**: added to the ready board for run-walk / easy / zone2 runs, as drawn. Other run types have none.
- **Swift subagent extras**: the lock card also shows PAUSED / TIME / WALK states, which the mockup doesn't draw. The teal glyph on the wide stone uses the PNG's #9ee0c6, not the mockup's #4acaaa.
- **Web test hook**: `window.__wmActivity` holds the last Live Activity state on web, for the e2e.
- **Lint**: lint isn't in the ship bar. Remaining react-compiler warnings: Date.now in the `openLog`/`skipPiece` handlers, and setState in a GrassZone effect.
