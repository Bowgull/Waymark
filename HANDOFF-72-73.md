# Handoff: mockups 72 (weather on Today) and 73 (Program planner)

Branch `today-program` (from 96eea12). Not pushed, not deployed.
Commits: b7e4be2 (the pages), c5f9302 (these notes), then the finishing commit (specs, row minutes, Strava poll removed).

## State
- `npx tsc -b`: passes. `npm run test:lib`: passes (suites added: `src/lib/brain/picks.test.ts`, `src/features/weather/weatherData.test.ts`; row-minutes cases in `src/features/dayboard/rowState.test.ts`).
- `tests/e2e/20-planner.spec.ts` (9 tests): passed locally on Windows against the running servers.
- Updated for pages 72/73 but NOT run (Playwright can't launch a browser on the Mac; they run on GitHub): `01-today`, `08-units`, `09-coach`, `13-way-out`, `16-start-day`, `18-dead-ends`, `19-class-days`, `19-tap-grass`. The spec files also typecheck.
- Full Playwright suite not run yet.

## What's done
### Page 72: weather on Today
- `src/features/weather/weatherData.ts`: sources, parsing, `buildWeather`, `coachLine` (pure), fetchers (`loadWeather`).
  - Now: nearest EC SWOB station within 10 km (`api.weather.gc.ca/collections/swob-stations` + `swob-realtime`), used if ≤20 min old, else Open-Meteo current. Feels-like = EC wind chill / humidex (station T + RH, model wind).
  - Rain timing: EC radar nowcast `Radar_1km_RainPrecipRate-Extrapolation` (GeoMet GetCapabilities for the times, GetFeatureInfo per 6-min step) + `RADAR_1KM_RRAI` for "raining now"; then the model hours.
  - Hours: Open-Meteo best model (`timezone=auto`, 12 forecast hours), first hours nudged to the station, fading over 4 h.
  - High/low, week, warnings: EC `citypageweather-realtime` (nearest city in a bbox, then the item). An afternoon read starting with "Tonight" takes today's high from Open-Meteo daily. Open-Meteo daily is the week fallback if EC fails.
  - All CORS-checked (ACAO `*`). Only Open-Meteo is required; if it fails the strip hides.
- `useWeather.ts`: `navigator.geolocation` once per open (denial remembered in safeStorage `waymark_wx_denied`), rounded to 2 decimals, cached `waymark_wx_loc`; refresh on open + every 5 min while visible. Info.plist already has NSLocationWhenInUseUsageDescription (no native change).
- `plannedHours.ts`: planned hour = usual start from `/api/coach/hours` (per type, AM/PM), class `context_json.suggested.time`, else Settings PM start, else 7 AM.
- `WeatherStrip.tsx` / `PixelSky.tsx` / `weather.css`: strip A, board in place (now, feels, High/low, 8 hours with the run's hour marked by its icon, rain line, 7 DAYS ›, ‹ TODAY, CLOSE / tap outside / pull down / Escape).
- `TodayPage.tsx`: week strip + DayBack removed; strip rendered where it was (all modes, not while a Block Zero start is waiting); coach line; run lines get a WEATHER line.
- `lib/units.ts temperatureUnit()` returns 'C' (Settings has no miles setting today; one place to switch).

### Page 73: Program planner + the same rows on Today
- `src/features/program/PlannerWeek.tsx`: THIS WEEK / NEXT WEEK flap tabs, sub line, 7 day rows (flap date, gold today, ≤3 icons, one line `weekModel.dayLine`, Dagaz rune button), one day open at a time (Expand), reveal-scroll after opening, AM/PM board of `PlanRow`s, + add session.
- `ProgramPage.tsx`: week nav / six week tiles / week text / "N changes ›" + WeekLog / "Not prepared yet" removed. Next week = POST `/api/weeks/generate` for next Monday (template path, idempotent), shown with no marks. Sub copy: "Block Zero · week N" / "Planned. Fine-tuned the night before.". Raven line, CHANGE DAY and Restart Block Zero kept. Waiting-start view uses PlannerWeek with no tabs, start day open.
- `src/features/plan/`: `PlanRow` (cursor, hold 500 ms + gold trace, lines via `summaryData.loadSummary` + `planLines`), `PixelCursor`, `CommandWindow` (Cmd frame in a portal, pop 180 ms / leave 120 ms, scroll/outside/Escape close; ActBody, WhyBody, RuneBody, PicksBody), `usePlanMenu` (the whole flow), `changeLines` (why-line with struck before/after for ease kinds), `planLines` (lines per type), `plan.css`.
- `TodayDay.tsx`: rows are `PlanRow` (+ td-row/td-rowhit classes kept), tap → lines + `ENTER ›` / `RESUME ›`, hold → menu; Strava cards, flights, EndHold, "+ What you learned" kept. SessionPicker and ReasonTiles no longer used on Today/Program.
- Deleted dead code: WeekView, DayBack, DayBoardRow, WeekLog, pickToast, TodayBoards.WeekStrip. `loadSummary` moved to `dayboard/summaryData.ts`.

### Server contracts added/changed
- `GET /api/sessions/coach-picks?mode=replace&sessionId=…|mode=add&date=YYYY-MM-DD[&pm=1][&wx=rain|cold|heat|storm&wxHour=6 PM]&today=` → `{ picks, rest, all }`, each `{ key, type, label, runCategory?, timeSlot, flexibleTimeSlot, reason, minutes, lines: [label, value, 'up'|'down'?][], action? }`. Ranking = `src/lib/brain/picks.ts rankPicks` (readiness night/morning state, outline `violations`/`spacingCosts` deltas, days trained in a row, same-domain easier, ownEases, scheduleSkips → short, weather at hour, knee flag; picks never break a limit; 1–3; distinct reasons). Preview lines = `computeDose` on the session as it would land (`src/server/coachPicks.ts previewLines`).
- `GET /api/coach/hours?today=` → `{ usual: { [type]: { am, pm } }, pmStart }`.
- `POST /api/changes/:id/redo` (`changes.ts redoChange`): re-applies an undone change's after-snapshot (not for changes that created sessions).
- `POST /api/sessions/:id/replace` now also returns `changeId`.
- `PATCH /api/changes/:id/reason` accepts `swap` changes too (updates original's skipReason + "Replaced:" note, created session's `replaced.userSkipReason`, the why).
- `departures.ts`: `REPLACE_WHY_TILES` (TIME→schedule, BODY→too_sore, JUST BECAUSE→variety), `SKIP_WHY_TILES` (TIME→schedule, BODY→too_sore, SICK→sick, PAIN→injury, place unspecified). Test added.

## What's left
1. Full suite on GitHub (`npx playwright test --retries=1`); fix what the run shows; delete `test-results/` and `playwright-report/` after any local run.
2. The max-HR bump pop-up (`checkMaxHrBump` in `src/lib/maxHrBump.ts`) has no trigger now (Today's Strava poll is gone); it is to fire after a recorded run is saved (run-ui's files, after the merge).

## Finishing commit (after c5f9302)
- Today no longer POSTs `/api/strava/poll-recent` (Strava removed). The max-HR pop-up's logic moved unchanged to `src/lib/maxHrBump.ts` (exported, not called).
- Row minutes (Josh, 2026-10-22: must match the coach's dose): `src/lib/brain/doseMinutes.ts` (`doseMinutes`, `doseJsonMinutes`) is the one source; `plannedRowMinutes` uses the row's `dose_json` first (Program and Today rows, Program's day line), and the coach picks' preview minutes (`coachPicks.ts minutesFor`) use the same function. Without a dose the old estimate stays.
- `plan.css`: let go early, the row's darkening eases back with `--ease-in` (motion table), not plain `ease`.
- Specs: `09-coach` row names match case-insensitively (the icon's alt is the upper-case flap name); `13-way-out` first test now runs on the weather board (no `close-head.png`); `16-start-day` uses the day list and the `Weeks` tablist, no `.td-t7`; `18-dead-ends` #4 Program has lines and no ENTER (ENTER from Today), #5 skip and UNDO SKIP by the hold; `19-class-days` reads the class's rune on Program's day row (UNDO, no REDO); `19-tap-grass` opens today's day on Program and the running session's lines (no RESUME/ENTER; the "under way" line is gone with the old board).
- Removed unused baselines: `09-coach/replace-why-rough-day.png`, `13-way-out/close-head.png` (linux and win32).

## Linux screenshot baselines that will legitimately change (do not regenerate on Windows)
- None of the remaining `toHaveScreenshot` calls frames Today's top or Program (checked: 01 morning-report is the row alone; 12-motion and 17 have no Today/Program baselines). `13-way-out/close-head.png` and `09-coach/replace-why-rough-day.png` are deleted. `01-today/morning-report.png` only if the row's width moved. Check the full run's diff list.

## Decisions / deviations from the mockups (for Josh)
- Coach line speaks for runs only (bag and class are indoors; "Indoor works too" makes no sense for them).
- Units: no °F/miles setting exists in Settings, so °C always (helper ready).
- Bag "FIRST" combo shows only once rounds exist (combos are picked at start); planned bag shows rounds × 3 min · 1 min rest from the brain's dose, else "ABOUT ~N min".
- Program rows have no ENTER (mockup), Today keeps ENTER › (now a gold text link per mockup, not the big buttons).
- REDO offered only for coach changes that edited sessions (ease/move/skip); an added class/strength can't come back after UNDO.
- Struck old value in the why-line uses the change's before/after flap words lowercased (e.g. "~~as planned~~ one set less: …") for ease kinds.
- "N changes ›" week log link removed from Program (mockup draws none); Restart Block Zero link, CHANGE DAY and the raven line kept (not drawn but existing features).
- No SWAPPED/ADDED pop after SWAP IN/ADD (mockup goes straight to WHY?).
- Lift labels use the existing short names (e.g. "BENT OVER ROW", truncated in the 78 px column).
- Gold plates already measure ≥4.5:1 with the app's dark ink (#1c1608 on #a0823c ≈ 4.9:1); colours unchanged.
- ~~Program row minutes from the old estimate~~: not approved; fixed (rows read the brain's dose, see the finishing commit).
