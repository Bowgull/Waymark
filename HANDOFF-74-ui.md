# Handoff: mockup 74, the UI half (branch `run-ui`)

Worktree: `Waymark-runui` (branch `run-ui`). Mockup: `Documents/Aang/waymark-mockups/74-run-with-strap.html`.
Nothing is pushed or deployed.

## Commits on run-ui (newest last)
- `606d37a` the run screen work, first pass (also has the Swift widget)
- `aac2da4` merge of run-strap `87aefc0` (done: their HeartContainer + heartPixels kept, their runRecordingUpload used, their Strava removals kept; DISCARD calls `dropSessionWrites`)
- `30fe23d` closeHead, `boardAway.ts`, spec updates, the new spec, the timerLook unit tests
- `9670f44` merge of run-strap `d3cb44f` (Swift rejoin padding, LA distance every 15 s, HANDOFF-74-recorder.md). Clean, no conflicts.
- the commit with this update: 19-tap-grass Items 4-5 and Item 6 drive the real 3 s × hold; 13-way-out checks the close window's two plates.

## State (2026-10-22, on the Mac)
- `npx tsc -b`: clean. `npm run test:lib`: passes. The edited specs also typecheck on their own.
- Playwright was **not run**: it can't launch a browser on this Mac (macOS 13). The e2e suite runs on GitHub.
- Swift was **not compiled** (Xcode 15.2 here). The risky spots were re-read and look right for iOS 17 / Swift 5.9: `AnyTransition.modifier(active:identity:)` in `LiveHeart`, `Image.resizable(capInsets:resizingMode:)` in `WideRuneStone`, `Text + Text` with `Text.foregroundStyle` (iOS 17, the target is 17.0), and the merged rejoin padding in `WaymarkRunRecorderPlugin.start`.
- Spec changes (by reading the code, unverified in a browser):
  - `19-tap-grass` Items 4-5: a tap on × opens nothing; a 3.3 s mouse hold opens the close window (`dialog` named `<head>: end`) with END AND LOG and DISCARD; a tap outside (8, 8) closes it and the session stays; a second hold, END AND LOG, then the close.
  - `19-tap-grass` Item 6: hold × 3.3 s, then END AND LOG in the close window. A local `holdX` helper does the hold (the same mouse-down way 21-run-screen does).
  - `13-way-out` Hold ×: Enter opens the close window at once (the keyboard path); checks DISCARD is there, then END AND LOG.
  - Items 1-3 and Item 1 (TAP TO START): nothing in the code contradicts them (hint texts, grass labels and the × label match). Their retries on Windows are unexplained; rerun them on CI.
- Approval list re-checked in code: heart 84 / 18 / 14 at whole pixels; gold within 5 bpm or over for under 30 s with no cue or buzz, one `tapHaptic` on entering ember; boards in 320 ms (`wm-card-in`, `--t-move`), out 180 ms; × fill rises and eases back 450 ms; island compact heart + BPM in zone colour, minimal heart only, expanded heart + BPM large, time, distance, EASE OFF when over; no strap dim heart and "--" (the run screen draws "---", as the mockup's LIVE2 does); the island and lock card offer only pause / play / skip; lock card distance top right; Log your run without the strap keeps "Tap a number to change it.". No mismatches found.

## Baselines to regenerate
- win32 and Linux: `05-run-walk.spec.ts/run-walk-ready.png`, `run-walk-run.png`, `run-walk-walk.png`.
- Linux: `20-strap.spec.ts/strap-connected.png` (new, from run-strap).
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
1. Run the full Playwright suite on GitHub (`--retries=1`). Watch `19-tap-grass` (Items 1-3, Item 1, Items 4-5, Item 6), `13-way-out` (the Library `strength` edge-swipe test timed out on Windows; check whether it fails on run-strap too) and `21-run-screen`.
2. Regenerate the baselines listed above (win32 with `--update-snapshots`, Linux via CI).
3. Run the GitHub macOS build to confirm the Swift compiles.
4. The max-HR bump after a recorded run (Josh wants it): hook it in `RunSessionView.handleSave`, right after `await uploadRecording(rec)` returns `'sent'`. The server's ingest result has `maxHrBumped` but the outbox doesn't pass the response back, so either read `/api/user-profile` there and compare with Today's `MAX_HR_LS_KEY`, or have the outbox return the body. Not wired (Today is the other builder's file).
5. Delete Playwright output (`test-results/`, `playwright-report/`) after any local run.
6. Phone-only checks:
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
