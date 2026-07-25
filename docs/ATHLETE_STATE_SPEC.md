# Athlete-State Pass — Design Spec

_The unified reasoning layer from `docs/INTELLIGENCE_AUDIT.md`. Date: 2026-06-10._

## Goal

Replace the fragmented, memoryless coaching rules with **one reasoning pass** that:
1. sees the **whole athlete** (set trends, RPE, wellness, notes, HR, adherence) in one context,
2. **remembers** — reads its own prior conclusion back in,
3. emits a **structured, persisted `AthleteState`** that downstream surfaces consume,
4. keeps deterministic progression as an **overridable floor**, not the ceiling.

Non-goal: ripping out deterministic loading. It stays as a guardrail.

---

## 1. The data model

```ts
// src/lib/athleteState/types.ts
export type ReadinessLevel = 'fresh' | 'normal' | 'taxed' | 'overreached'
export type LiftVerdict = 'push' | 'hold' | 'deload'
export type WeekShape = 'as_planned' | 'pull_back' | 'add_recovery' | 'push_volume'

export interface LiftAssessment {
  exerciseId: string
  exerciseName: string
  verdict: LiftVerdict
  // multiplier applied to the deterministic prescription (e.g. 0.9, 1.0, 1.05).
  // The brain sets this; the floor clamps it (see §6).
  loadFactor: number
  rationale: string          // one sentence, voice canon
  trendSummary: string       // what the last N sessions showed
}

export interface AthleteState {
  // readiness
  readiness: ReadinessLevel
  readinessRationale: string
  // per-lift verdicts (only lifts seen in the trend window)
  lifts: LiftAssessment[]
  // week-level
  weekShape: WeekShape
  weekShapeRationale: string
  // flags surfaced to the user / other surfaces
  flags: Array<{ kind: 'pain' | 'plateau' | 'overreach' | 'undertrained'; detail: string }>
  // free-text the session review / UI can render
  note: string
  // provenance
  computedAtEpoch: number
  trigger: string
  modelVersion: string
}
```

This is the single artifact every downstream surface reads.

---

## 2. The context assembler

One builder — `src/lib/athleteState/assembleContext.ts` — replaces the per-surface
context slices. It produces a recent-window snapshot. **Trends, not last-reading.**

### Inputs (recent window, default last 21 days / last 6 sessions per lift)

| Block | Source | Shape |
|---|---|---|
| **Strength trends** | `strength_sets` ⨝ `strength_session_exercises` ⨝ `sessions` | per `exerciseId`: last N working sets with `weightKg`, `reps`, `plannedWeightKg`, `plannedReps`, `inferredStatus`, `bandColor`, session date. **Computed trend** = direction over the window, not the latest row. |
| **Effort trajectory** | `sessions.rpe`, `difficulty` | last N sessions, ordered |
| **Wellness trend** | `daily_logs` | sleepHours, soreness, alcoholScale over window |
| **Notes corpus** | `sessions.notes`, `daily_logs.notes` | concatenated, for pain/mood mining |
| **Run quality** | `run_sessions` | completionStatus, pace, avgHr/maxHr, shortReason |
| **Adherence** | `computeBlockAdherence` (reuse) | existing snapshot |
| **Combo ratings** | `combo_performance` | recent ratings (bag) |
| **Bodyweight** | `body_metrics` | trend |
| **Training maxes** | `training_maxes` | current TMs |
| **Prior state (MEMORY)** | latest `AthleteState` (see §5) | the previous conclusion, read back |

### The key new helper — trend loader (replaces `loadRecentStrengthReality`)

```ts
// returns, per exercise, the trajectory across the window — NOT just the latest set.
interface LiftTrend {
  exerciseId: string
  exerciseName: string
  sessions: Array<{ date: number; topWeightKg: number | null; totalReps: number;
                    avgInferred: string; bandColor: string | null }>
  direction: 'progressing' | 'stalling' | 'regressing' | 'insufficient_data'
}
async function loadLiftTrends(db, windowDays = 21): Promise<LiftTrend[]>
```

`direction` is a cheap deterministic pre-computation (e.g. top-weight slope + repeated
`rep_shortfall`); the brain gets both the raw sessions and this hint.

---

## 3. The reasoning pass

`src/lib/athleteState/runAthleteState.ts`.

- **Model:** Opus (`claude-opus-4-8`). Single call, tool-use, `tool_choice: { type: 'tool' }`.
  Requires adding `'claude-opus-4-8'` to `AnthropicModel` in `anthropic.ts:7` (+ its header
  branch at `:87`).
- **System prompt:** reuse `buildSystemPrompt(profile, …)` so goals/injuries/constraints/TMs
  are present, plus the existing voice-canon block.
- **User prompt:** the assembled snapshot, serialized like the existing `buildPrompt` in
  `reactiveCoach.ts` (day labels, trend lines, "weight Effort heavily", notes-scan instruction).
- **Output:** the `assessAthlete` tool below.

### Tool schema (matches `prompts/tools.ts` conventions)

```ts
export const TOOL_ASSESS_ATHLETE: Tool = {
  name: 'assessAthlete',
  description:
    'Form a single coherent read of the athlete from the full recent picture: strength ' +
    'trends, effort, wellness, notes, runs. Compound the signals — high effort + poor sleep ' +
    '+ rep shortfall means deload, not three separate nudges. Honor the deterministic ' +
    'program as a baseline; only override with a reason. Voice canon: observation before ' +
    'conclusion, no second person, no hype, no em dashes.',
  input_schema: {
    type: 'object',
    properties: {
      readiness: { type: 'string', enum: ['fresh', 'normal', 'taxed', 'overreached'] },
      readinessRationale: { type: 'string', description: 'One sentence. Voice canon.' },
      lifts: {
        type: 'array',
        description: 'Only lifts present in the trend window. Omit lifts with insufficient data.',
        items: {
          type: 'object',
          properties: {
            exerciseId: { type: 'string' },
            verdict: { type: 'string', enum: ['push', 'hold', 'deload'] },
            loadFactor: { type: 'number', description: '0.85–1.05 multiplier on the baseline prescription.' },
            rationale: { type: 'string', description: 'One sentence tying the verdict to the trend.' },
          },
          required: ['exerciseId', 'verdict', 'loadFactor', 'rationale'],
        },
      },
      weekShape: { type: 'string', enum: ['as_planned', 'pull_back', 'add_recovery', 'push_volume'] },
      weekShapeRationale: { type: 'string' },
      flags: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['pain', 'plateau', 'overreach', 'undertrained'] },
            detail: { type: 'string' },
          },
          required: ['kind', 'detail'],
        },
      },
      note: { type: 'string', description: 'One-line silent summary. Under 140 chars. Voice canon.' },
    },
    required: ['readiness', 'readinessRationale', 'lifts', 'weekShape', 'weekShapeRationale', 'note'],
  },
}
```

---

## 4. Triggers & cadence (replacing the cost gates)

Today: hardcoded `gate()` pre-filters + 2h debounce + "never Sonnet" decide whether the
model runs at all (`reactiveCoach.ts:267`, `:35`). For a single-athlete app this is the
throttle. New policy:

| Event | Run athlete-state? |
|---|---|
| Strength session completed (sets logged) | **yes** (this is the gap today) |
| Run completed | yes |
| Wellness logged crossing soft threshold | yes |
| Session skipped/replaced | yes |
| Nightly rollover | yes (baseline refresh) |

Keep a **light debounce** (e.g. 30–60 min) purely to coalesce rapid edits, not to suppress.
Drop the "never Opus / skip if no rule fires" gates. Cost for one user ≈ pennies/day.

---

## 5. Persistence & memory

Reuse `coaching_outputs` — no new table needed.

- **Write:** one row, `kind = 'athlete_state'`, `outputJson = JSON.stringify(AthleteState)`,
  `model`, token counts, `createdAt`. (Same pattern as `reactiveCoach.ts:520`.)
- **Read back (the memory fix):** at the top of the assembler, load the most recent
  `kind = 'athlete_state'` row and feed its `outputJson` into the prompt as "your previous
  read." The index `idx_coaching_kind_created` already supports this query cheaply.

This single read-back is what turns the stateless loop into one with continuity, and enables
the closed loop (§7).

---

## 6. Downstream consumers (read state, don't recompute)

| Consumer | Today | After |
|---|---|---|
| Next strength weight | `adjustSuggestedStrengthWeight` fixed ×0.9/×1.05 (`app.ts:384`) | read `lifts[].loadFactor`; **clamp to the deterministic floor** (e.g. never deload below program min, never push >5%/session) |
| Next band color | `adjustBandColorFromReality` (`trainingReality.ts:85`) | drive off `lifts[].verdict` instead of last-reading inferredStatus |
| Week plan shape | `generateWeekPlan` recomputes from adherence/HR | seed with `weekShape` + `weekShapeRationale` |
| Reactive replan | `runReactiveReplan` rebuilds its own context | consume `AthleteState` directly; it becomes a thin renderer of `weekShape` |
| Session review | `runSessionReview` ("Load change noted.") | quote `note` + relevant `lifts[].rationale` |
| UI flags | none | render `flags[]` (pain/plateau) |

**The guardrail floor.** `loadFactor` is advisory; a deterministic clamp wraps it so the
brain can nudge but never produce an absurd jump. Strength progression stays predictable.

---

## 7. Closed loop (free once memory exists)

Because the prior `AthleteState` is read back, the next pass can compare its last prediction
to what actually happened ("predicted deload on squat; athlete then hit the reduced target →
verdict was right"). Add this as a prompt instruction in Phase 2+; no new infra.

---

## 8. Files: reuse vs new vs gut

**Reuse:** `anthropic.ts` (add Opus), `prompts/system.ts`, `prompts/context.ts`,
`coaching_outputs`, `computeBlockAdherence`, `hrAnalysis`, `assessStrengthSet`/`assessBandSet`
(now feed the trend loader, not the live nudge).

**New:** `src/lib/athleteState/{types,assembleContext,loadLiftTrends,runAthleteState}.ts`,
`TOOL_ASSESS_ATHLETE` in `prompts/tools.ts`.

**Gut / demote:** `loadRecentStrengthReality` → `loadLiftTrends`;
`adjustSuggestedStrengthWeight` heuristic → clamp wrapper around `loadFactor`;
`gate()` pre-filters + "never Sonnet" in `reactiveCoach.ts` → removed; `runReactiveReplan`
slims to a renderer of `AthleteState`.

---

## 9. Phasing (unchanged from audit, with file targets)

| Phase | Deliverable |
|---|---|
| 0 | `loadLiftTrends` + let `runReactiveReplan` see trends. Kills "some sets adjust, others don't." Lowest risk. |
| 1 | `assembleContext` — merge the slices into one snapshot. |
| 2 | `runAthleteState` (Opus) + `TOOL_ASSESS_ATHLETE` + persist & read-back via `coaching_outputs`. |
| 3 | Rewire consumers (§6) to read `AthleteState`; add the `loadFactor` clamp. |
| 4 | Drop cost gates; trigger on set-logging (§4). |

---

## 10. Open decisions (need your call before Phase 2)

1. **Trend window** — 21 days / 6 sessions per lift? Or block-relative?
2. **`loadFactor` clamp bounds** — how much override do you trust the brain with? (proposed:
   0.85–1.05/session, never below program floor.)
3. **Opus everywhere, or Opus for athlete-state + Haiku for the cheap renders?**
4. **Debounce window** — 30 min? 60? (only to coalesce rapid set edits.)
5. **Reuse `coaching_outputs` vs dedicated `athlete_state` table** — spec assumes reuse; a
   dedicated table is cleaner if you want to query state history directly.
