# Phase 11 — Schedule Intelligence + Running Rework

Start with: `"Phase 11 — schedule intelligence + running rework"`

## 11A: Weekly Template Rebuild

**Current template is wrong.** Rebuild WEEKLY_TEMPLATE to:

| Day | AM | PM |
|-----|----|----|
| Mon | Zone 2 Run (15-20min) + Foundation | MT Class |
| Tue | Strength A | — |
| Wed | Zone 2 Run (15-20min) + Foundation | MT Class |
| Thu | Strength B | — |
| Fri | Zone 2 Run (15-20min) + Foundation | MT Class |
| Sat | Bag Work + Long Run (progression) | — |
| Sun | Rest | — |

Key changes from current:
- **Add Zone 2 morning runs** on Mon/Wed/Fri (new session type or reuse 'running' with runType='zone2')
- **Add Bag Work to Saturday AM** — this was completely missing, the whole combo system had no scheduled day
- **Saturday long run replaces Tuesday PM run** — the 12-week progression plan lives here
- **Tuesday/Thursday PM slots removed** — no more Tuesday PM run or Thursday PM active recovery
- Foundation stays on run days (back-to-back AM: run then Foundation)

## 11B: Running Plan Rework

The current `runningPlanTemplate.ts` assumes 1 run/week on Tuesday PM. Needs restructuring:

- **Mon/Wed/Fri:** Always Zone 2 easy (15-20 min). No progression — these are base-building.
- **Saturday:** The progression run. This is where the 12-week plan applies:
  - Wk 1-3: Easy 25-30min (longer than weekday runs)
  - Wk 4-6: Easy 30min, ~3km target
  - Wk 7-8: Easy + strides (4-6x100m)
  - Wk 9-10: Tempo run (easy/tempo/easy)
  - Wk 11: Intervals (6x1min hard/easy)
  - Wk 12: 5K test

RunSessionView already handles prescriptions — just needs the template data updated and Zone 2 runs to show appropriate cues ("Keep it conversational. Nasal breathing when you can.").

## 11C: Settings Cascade (Schedule Intelligence)

When Josh changes MT class days in Settings:
- **Don't lose in-progress sessions** — only restructure future sessions
- If removing a MT day → suggest a replacement (bag work, run, active recovery)
- If adding a MT day → restructure that day to match the MT day template (Zone 2 + Foundation AM, MT PM)
- Show notification/confirmation of what will change before applying
- Regenerate the current week's remaining unstarted sessions

This is the most complex piece — needs a "schedule diff" view showing what's changing.

## Research Already Done
- Don Heatrick (MT S&C coach): Zone 2 Cardiac Output is the foundation cardio
- Sean Fagan: morning runs are non-negotiable for fighters
- 80/20 rule: 80% easy volume, 20% quality (the Saturday run)
- 12+ hour gap between AM run and PM MT = full recovery
- Fasted morning runs: no magic for fat loss, but improve metabolic flexibility

## Files to Touch
- `src/lib/weeklyTemplate.ts` — complete rebuild
- `src/lib/runningPlanTemplate.ts` — restructure for 4 runs/week
- `src/server/app.ts` — new Zone 2 session handling, settings cascade endpoints
- `src/features/settings/SettingsPage.tsx` — cascade confirmation UI
- `src/features/session/RunSessionView.tsx` — Zone 2 cues
- `src/features/today/TodayPage.tsx` — handle new session structure
- `src/features/program/ProgramPage.tsx` — reflect new schedule
- `src/db/seed.ts` — if Zone 2 needs new session type data

## After This
- Phase 12: UI Overhaul (all session screens, Program page, forge marks, time picker, combo form tips)
- Phase 13: Lifestyle Correlation + Goal Engine
