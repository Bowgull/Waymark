# Waymark Intelligence Audit & Athlete-State Design

_Full pass over the coaching/adaptation layer. Date: 2026-06-10._

## TL;DR

The bottleneck is **not** the model, the data, or a missing API key. The app already
calls Claude at runtime in **seven** different places. It captures pro-grade data across
**28 tables**. The failure is architectural: **every signal is digested by its own narrow
rule in its own silo, and the context is thrown away before any model sees it.** No
component is allowed to look at everything at once and form a judgment, and nothing
remembers anything from one event to the next.

Intelligence comes from **synthesis** — one brain seeing the signals together over time —
not from the number of data points. Adding more inputs to siloed rules just produces more
siloed rules.

---

## What the app captures (the data is good)

Rich, per-event signal already in the schema:

| Source | Signal |
|---|---|
| `strength_sets` | weight, reps, plannedWeight, plannedReps, **inferredStatus**, loadFeedback, bandColor, restSec, isWarmup, completedAt |
| `sessions` | rpe, difficulty, notes, review, reviewFlag, skipReason, skipReasonDetail, duration, status |
| `daily_logs` | sleepHours, soreness, alcoholScale, weedGrams, notes |
| `run_sessions` | distance, duration, completionRatio/Status, shortReason, pace, **avgHr/maxHr** |
| `combo_performance` | per-combo rating |
| `body_metrics`, `training_maxes`, `weekly_journals`, `mt_class_logs` | bodyweight trend, TMs, reflections, class logs |

**The data layer is not the problem.** This is more signal than most commercial apps collect.

---

## The seven AI surfaces (the fragmentation)

Each builds its own context slice and never shares with the others:

| # | Surface | Model | Trigger | Sees | **Blind to** |
|---|---|---|---|---|---|
| 1 | `blockZero.ts` | Sonnet | onboarding | profile | — |
| 2 | `reactiveCoach.runReactiveReplan` | Sonnet | session complete/skip/replace, wellness, nightly rollover | type, RPE, notes, HR, wellness, missed days | **weights, reps, bands** |
| 3 | `reactiveCoach.runReplaceSuggestions` | Sonnet | manual replace | today's slot, wellness, week | strength history |
| 4 | `sessionReviewAI.runSessionReview` | Haiku | session complete | this session's sets/HR | **can't change the plan** |
| 5 | `weeklyPlanAI.generateWeekPlan` | Haiku | week generation | adherence, HR | set-level reality |
| 6 | `bagPrescriptionAI.runBagPrescription` | Haiku | bag session start | combo ratings | everything else |
| 7 | `ledgerInsightsAI.runLedgerInsights` | Haiku | ledger view | ledger | training |

Plus `prompts/summarizer.ts` (Haiku) for context compression.

---

## The six concrete gaps

### Gap 1 — Set-level data is a dead end
Logging a strength set fires **no AI at all**. It writes an `inferredStatus` tag
(`app.ts:1196`) and stops. The *only* consumer is a deterministic nudge at the next
prescription:

- `loadRecentStrengthReality` (`app.ts:347`) takes the **single most recent set reading**
  per exercise — `if (epoch > current.epoch)` — no trend, no history.
- `adjustSuggestedStrengthWeight` (`app.ts:384`) applies a fixed `×0.9 / ×1.05`.

This is exactly the "some sets adjust, others don't" behaviour. The rule has **amnesia**:
it reacts to your last rep on one exercise and forgets everything before it. Bench and
deadlift get the same blunt 10% chop.

### Gap 2 — Seven brains, each half-blind
No surface sees the whole athlete. The week coach (the thing that reshapes your plan)
**explicitly never reads weights/reps/bands**. The session review *sees* sets but can't
touch the plan. The bag prescriber sees combos and nothing else.

### Gap 3 — No memory
`coaching_outputs` is written on every AI call but only read back for:
- **dedup** — `select id` to check "did we already review this session?" (`app.ts:1244`)
- **debounce** — `select createdAt`, the 2h window (`reactiveCoach.ts:307`)

The live coaching loop **never reads its own past conclusions**. Every call is stateless.
It cannot form or maintain a model of you over time. (Only `blockZero` reads prior
`outputJson` back, and only for onboarding continuity.)

### Gap 4 — Signals can't compound
RPE 9 + 6h sleep + rep-shortfall on squats should compound into one verdict:
*under-recovered, deload*. But those three facts live in three different code paths that
never meet — RPE/sleep go to the week coach, rep-shortfall goes to the `×0.9` nudge. The
conclusion that requires all three is **structurally unreachable**.

### Gap 5 — Cost gates are the ceiling, and they're wrong for this app
`reactiveCoach.ts:16-19` states the design intent: "One Haiku call per trigger, never
Sonnet. Pre-filter gates: if no rule fires, we skip the AI call entirely." Hardcoded
human-written rules decide **whether the model runs at all** and **what slice it sees**.
The rules are the intelligence ceiling.

This is SaaS cost discipline borrowed into a **single-athlete-forever** app. Even Opus
reasoning on every meaningful event is pennies/day for one user. The cost architecture is
solving a problem you don't have, and it's the single biggest throttle on the intelligence.

### Gap 6 — No closed loop on outcomes
Nothing checks whether a past adjustment was *right* — did you then hit the reduced target
after the `×0.9`? The system never learns from its own calls.

---

## What's NOT broken (don't throw these out)

- **Deterministic progression is a feature, not a bug.** Real programs (5/3/1, linear
  periodization) are formulas. Keep deterministic loading as a **floor/guardrail**. The
  flaw isn't "it's a heuristic" — it's "it's a heuristic with amnesia looking at one
  exercise's last rep with no idea how you slept." Keep the floor; add a brain that can
  override it with reasoning.
- **The data capture.** Don't add more sensors. Synthesize what's there.
- **The plumbing.** `anthropic.ts`, `prompts/system.ts`, `prompts/context.ts`, tool-use
  schemas, and `coaching_outputs` are all reusable. ~60% of the scaffolding exists.

---

## The design: a unified Athlete-State pass

One reasoning component — the **athlete model** — replaces the fragmented rules.

```
  events (set logged, session done, wellness logged, nightly)
        │
        ▼
  ┌─────────────────────────┐
  │ 1. Context Assembler    │  one builder, recent-window snapshot:
  │                         │   - per-lift set TRENDS (last N sessions, not last reading)
  │                         │   - RPE trajectory, wellness trend, mined notes
  │                         │   - run completion + HR, combo ratings, bodyweight, TMs
  │                         │   - PRIOR athlete-state (memory, read back)
  └───────────┬─────────────┘
              ▼
  ┌─────────────────────────┐
  │ 2. Athlete-State Pass   │  single Opus tool-use call → structured AthleteState:
  │    (the one brain)      │   - readiness / fatigue estimate (with rationale)
  │                         │   - per-lift progression verdict (hold / push / deload)
  │                         │   - week-shape recommendation
  │                         │   - flags (pain signal in notes, overreach, plateau)
  └───────────┬─────────────┘
              ▼
  ┌─────────────────────────┐
  │ 3. Persist AthleteState │  new table (or coaching_outputs repurposed as READABLE memory)
  └───────────┬─────────────┘
              ▼
  ┌─────────────────────────┐
  │ 4. Downstream consumers │  read AthleteState instead of each computing a narrow rule:
  │                         │   - next strength prescription (weight/band)
  │                         │   - week plan shape
  │                         │   - session targets
  │                         │   deterministic floor still applies as guardrail
  └─────────────────────────┘
```

### Why this fixes each gap
- **Gap 1/4:** set trends + wellness + RPE land in one context → signals compound.
- **Gap 2:** one brain sees everything; downstream surfaces consume its verdict.
- **Gap 3:** AthleteState is persisted and read back → continuity/memory.
- **Gap 5:** delete the pre-filter gates; for one user, let it run on real events.
- **Gap 6:** persisted state lets the next pass compare predicted vs actual → a learning loop.

---

## Phasing (smallest-risk order)

| Phase | Work | Reuses | Guts/replaces |
|---|---|---|---|
| 0 | Stop discarding set history: a **trend loader** (last N sessions per lift) | schema | `loadRecentStrengthReality` |
| 1 | Single **context assembler** merging the 7 slices into one snapshot | `prompts/context.ts`, `prompts/system.ts` | per-surface context builders |
| 2 | **Athlete-State reasoning pass** (Opus, tool-use), persisted + read back as memory | `anthropic.ts`, tool schemas, `coaching_outputs` | the `gate()` pre-filters in `reactiveCoach.ts` |
| 3 | Rewire downstream (prescription nudge, week plan, targets) to read AthleteState | existing prescription paths | `adjustSuggestedStrengthWeight` heuristic → guardrail only |
| 4 | Loosen cost gates; allow set-logging to trigger the pass | — | `DEBOUNCE_SEC`, "never Sonnet" gates |

### Honest effort estimate
This is a **reasoning-layer redesign, not a plumbing job**. The new pieces with real work:
1. Context assembler with **trends** (the hard part — defining the recent-window model).
2. The `AthleteState` tool schema + persistence + read-back.
3. Rewiring consumers to read state instead of recomputing.

Scaffolding (~60%) exists. The missing ~40% is synthesis + memory + rewiring.

### Smallest first step
Phase 0 alone — replacing the last-reading-only `loadRecentStrengthReality` with a
trend-aware loader, and letting the existing `runReactiveReplan` *see* strength trends —
would directly fix the "some sets adjust, others don't" complaint without the full redesign.
It's the highest-leverage single change.
