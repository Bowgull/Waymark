# Waymark Build Plan

Living document. Updated at the end of every session. Read this first, every time.

---

## How to use this file

1. User pastes the session prompt template with a **Step Number**.
2. Assistant reads this file, finds that step, executes only that step.
3. At session end, assistant updates step status, appends to Session Log, commits.
4. Deploy happens at the end of the full plan, not between steps.

### Sequential session rule (enforced every session)

Before writing any code, the assistant must:

1. Run `git log main --oneline -8` to see what is actually merged.
2. Identify the highest step number present in main's commit history.
3. Confirm the requested step is exactly `that number + 1`. If it is not, stop and tell the user which step to run next instead.

This prevents parallel worktrees from forking off the same base and diverging.
Each step must be merged to main before the next session starts.

---

## Hard Rules (non-negotiable)

- **No em dashes.** Ever. Not in code, not in comments, not in UI copy, not in responses. Use periods, commas, or parentheses.
- **No AI-speak.** Banned openers: "I'll", "Let me", "Certainly", "Great question". Banned closers: "Let me know if...", "Feel free to...", "Hope this helps". Banned connectives: "Furthermore", "Additionally", "Moreover", "In conclusion".
- **Match the Voice Canon.** All user-facing copy passes through the canon below. If a string does not sound like the canon, it is wrong.
- **One step per session.** Do not pre-build future steps. Do not refactor adjacent code unless the step requires it.
- **No generic AI UI.** No chat bubbles, no "How can I help?", no sparkle icons, no purple gradients, no "AI" badges. The coach is silent and embedded.
- **Voice Canon and Hard Rules get re-read every session.** Non-optional.

---

## Voice Canon (locked)

Dark humor, sparse, honest. Lord of the Rings / Stormlight / Kingkiller / Malazan gravity in the UI metaphors only. Voice is closer to a quiet coach who has seen people quit before.

### Approved specimens

| Surface | Copy |
|---|---|
| Week review | Three of five. The week didn't kill you. Next one has to try harder. |
| Session skip | Noted. We'll make it up Saturday if the body cooperates. |
| Block Zero intro | Four weeks. Corrective work, light loading, habit building. Skip this block and the next one breaks you. |
| Block transition | Cleared. The groundwork held. Next block expects more. |
| PR hit | Deadlift 145. That was your ceiling last month. It's your floor now. |
| Wellness flag | Sleep slipping, soreness climbing. Volume drops this week. The body's honest. |
| Empty state (no sessions) | Blank slate. Every block starts here. |
| Empty state (no PRs) | No marks yet. Show up a few more times and they start showing up. |
| AI offline | Coach is offline. The program knows what to do. Default week running. |
| Network offline | Offline. Train anyway. It'll sync. |
| Onboarding (why) | Why are you here. Fitness, MT, body, all three. Pick what's honest. |
| Onboarding (physical) | Any pain, injuries, postural issues. The app works better when it knows. |
| Onboarding (recent training) | When did you last train seriously. Rough estimate is fine. |

### Button set

`Enter` · `Pass` · `Close` · `Commit` · `Begin`

### Voice rules derived from canon

- Short sentences. Fragments allowed.
- No exclamation marks. No emoji.
- Observation before instruction. ("Sleep slipping" before "Volume drops.")
- Never congratulate. Acknowledge, then raise the bar.
- Never apologize to the user for app behavior. State the fact.
- Numbers get stated plainly (`Deadlift 145`, not `You hit 145lb on deadlift!`).

---

## User Profile Reference

- **Physical**: Upper Cross Syndrome (forward head, rounded shoulders). Chronic lower back stiffness from sitting and posture.
- **Background**: Lifelong athlete. Natural Muay Thai talent. Detrained on strength.
- **Goals**: Fit body. Good at MT. Fix posture. All three, ranked roughly equal.
- **Schedule**: 3-4 training days/week realistic. Sunday is chill by preference. MT gym available most evenings plus Sunday boxing technique class.
- **Current state**: Brand new install. Block Zero starts fresh. Legacy seed training maxes are **not** their real numbers. Cold start required.
- **MT cap**: Soft guideline enforced by AI. Target is mtCapPerWeek. AI may exceed by one session when soreness is low and load is otherwise light.

---

## Technical Reference

### AI integration

- **Provider**: Anthropic API via direct `fetch` from Cloudflare Workers (no SDK, smaller bundle).
- **Models**:
  - `claude-sonnet-4-6` for Block Zero initial assessment and block transitions only. Extended thinking enabled.
  - `claude-haiku-4-5-20251001` for weekly generation, daily adjustments, insight summaries, session reviews.
- **Prompt caching**: System prompt and user profile cached. Cached reads at ~$0.08/1M (Haiku) and ~$0.30/1M (Sonnet).
- **Tool use**: Structured outputs only. No free-form JSON parsing.
- **Context compression**: Last 4 weeks raw, older weeks summarized into coachingOutputs.
- **Failure mode**: AI offline falls back to default weekly template. Voice canon covers the offline surface.

### New tables (Phase 1)

- `userProfile` (one row): goals, constraints, injuries, MT gym access, training history
- `bodyMetrics`: weight, resting HR, optional measurements, timestamped
- `coachingOutputs`: model outputs (week plans, reviews, block transitions), cached for context reuse

### Key existing files

- `src/server/app.ts` - Hono routes, 100+ endpoints
- `src/db/schema.ts` - Drizzle schema
- `src/lib/weeklyTemplate.ts` - Fighter and Block Zero templates (current rule-based)
- `src/lib/weekAnalysis.ts` - Rule engine to be replaced by AI
- `src/lib/postureTemplate.ts` - UCS-specific corrective routine (already built, keep)
- `src/features/program/ProgramPage.tsx` - Block Zero entry point
- `src/features/session/SessionComplete.tsx` - Drive rating capture

---

## Phases and Steps

Status legend: `TODO` · `DOING` · `DONE` · `BLOCKED`

### Phase 1: Foundation

- **Step 1** `DONE` Schema additions: `userProfile`, `bodyMetrics`, `coachingOutputs` tables. Migration. Seed sane defaults.
  - Files: `src/db/schema.ts`, `drizzle/0010_ai_foundation.sql`
  - Acceptance: `drizzle-kit` generates clean migration. Tables queryable.
  - Notes: `user_profile` is singleton with `id` default `'default'`, written on onboarding. No seed defaults yet. Typecheck deferred (no node on this machine). Verify on the machine that has node before Step 2 runs its migration.
- **Step 2** `DONE` Anthropic client: direct `fetch` wrapper with caching, tool use, retry, offline fallback.
  - Files: `src/lib/anthropic.ts` (new), `src/server/app.ts` (Bindings), `wrangler.jsonc` (secret note)
  - Acceptance: Haiku and Sonnet both callable. Cache hits logged. Offline returns typed fallback.
- **Step 3** `DONE` Onboarding screen. Three questions from Voice Canon (why, physical, recent training). Writes to `userProfile`.
  - Files: `src/features/onboarding/*` (new), routing, server endpoint
  - Acceptance: First launch with no profile routes to onboarding. Completion writes row, routes to Block Zero intro.

### Phase 2: Prompt infrastructure

- **Step 4** `DONE` System prompt builder. Assembles identity + voice canon + user profile + compressed context.
  - Files: `src/lib/prompts/system.ts` (new), `src/lib/prompts/context.ts` (new)
- **Step 5** `DONE` Tool schemas for structured outputs: `weekPlan`, `weekReview`, `blockTransition`, `sessionReview`, `insight`.
  - Files: `src/lib/prompts/tools.ts` (new)
- **Step 6** `DONE` Context summarizer. Rolls weeks 5+ into compressed summaries stored in `coachingOutputs`.
  - Files: `src/lib/prompts/summarizer.ts` (new), `POST /api/ai/summarize-old-weeks` in `src/server/app.ts`

### Phase 3: Block Zero AI

- **Step 7** `DONE` Block Zero assessment call (Sonnet, extended thinking). Takes onboarding answers, produces 6-week plan overview and starting weight calibration targets.
  - Files: `src/server/routes/blockZero.ts`, `src/features/program/ProgramPage.tsx`
  - Acceptance: Output passes tool schema. Voice canon applies to all user-facing strings in output.
- **Step 8** `DONE` Transition readiness check at end of Block Zero. Sonnet reviews 4 weeks of wellness + Drive + adherence + calibration data, decides proceed/hold/adjust.

### Phase 4: Weekly intelligence

- **Step 9** `DONE` Haiku-based weekly plan generation. Replaces rule engine in `weekAnalysis.ts`. Respects MT hard cap.
  - Files: `src/lib/weeklyPlanAI.ts` (new), `src/server/app.ts` (auto-generate route)
  - Acceptance: AI generates `WeekPlanOutput` via `weekPlan` tool. MT day filter applied post-AI as safety net. Offline falls back to `analyzeWeek` + template.
- **Step 10** `DONE` MT skill loop. Logs from MT class sessions feed back into next week's MT programming focus.
- **Step 11** `DONE` Session review capture. Post-session Haiku call produces one-line review stored on the session record.

### Phase 5: Ledger and surfacing

- **Step 12** `DONE` Ledger AI insights. Replace placeholder `insightEngine.ts` output with Haiku-generated insights. UI slots already exist.
- **Step 13** `DONE` Body metrics entry. Weight and optional fields. Simple form. Graph reuses existing sparkline component.
  - Files: `src/features/metrics/BodyMetricsPage.tsx` (new), `src/server/app.ts` (two routes), `src/app/AppRoutes.tsx` (/metrics route)
  - Acceptance: POST /api/body-metrics writes weight (required), resting HR / bodyfat / notes (optional). GET returns recent entries. /metrics page shows form and sparkline once 2+ entries exist.
- **Step 14** `DONE` Coach surfaces: Block narrative view, Drive first-use explainer, injury check-in, session intent preview, skip-reason capture.

### Deploy

- **Step 15** `DONE` End-to-end QA on device. Preview build. Production deploy. Secret rotation check.

---

## Session Log

Append one entry per session. Keep under 5 lines each.

<!-- template
### Session N (YYYY-MM-DD) · Step X
- Did: ...
- Next: Step Y
- Notes: ...
-->

### Session 1 (2026-04-17) · Step 1
- Did: Added `user_profile`, `body_metrics`, `coaching_outputs` tables to `src/db/schema.ts` and wrote `drizzle/0010_ai_foundation.sql`.
- Next: Step 2 (Anthropic client).
- Notes: This project hand-writes migrations and applies them via wrangler, not via `drizzle-kit generate`. Meta journal is intentionally stale. Apply `0010_ai_foundation.sql` to local D1 with `wrangler d1 execute` to verify.

### Session 2 (2026-04-17) · Step 2
- Did: Created `src/lib/anthropic.ts` (direct fetch wrapper, prompt caching headers, retry on 429/5xx/529, offline fallback, tool use, extended thinking for Sonnet). Added `ANTHROPIC_API_KEY` to `Bindings` in `src/server/app.ts`. Noted secret in `wrangler.jsonc`.
- Notes: Set `ANTHROPIC_API_KEY` via `wrangler secret put ANTHROPIC_API_KEY` before Step 7.

### Session 3 (2026-04-17) · Step 3
- Did: Created `src/features/onboarding/OnboardingPage.tsx` (three Voice Canon questions, step indicator, goals multi-select, physical textarea with Pass, training history single-select, Commit to write). Added `GET /api/user-profile` and `POST /api/user-profile` to `src/server/app.ts`. Added `/onboarding` route and profile check redirect to `src/app/AppRoutes.tsx`.
- Next: Step 4 (system prompt builder).
- Notes: Profile check runs once on app mount, skips if already on `/onboarding`. Offline fallback skips redirect. Completion navigates to `/program` with replace.

### Session 4 (2026-04-17) · Step 4
- Did: Created `src/lib/prompts/system.ts` (identity + voice canon block cached, user profile block cached, optional compressed history block uncached) and `src/lib/prompts/context.ts` (WeekContext/CompressedWeekSummary types, buildContextBlock formatter for recent raw weeks + older compressed summaries).
- Next: Step 5 (tool schemas).
- Notes: Two cache checkpoints: identity is always stable, profile changes only on onboarding update.

### Session 5 (2026-04-17) · Step 5
- Did: Created `src/lib/prompts/tools.ts` with five Anthropic tool definitions (weekPlan, weekReview, blockTransition, sessionReview, insight) and matching TypeScript output types. Exported ALL_TOOLS array and TOOL_BY_NAME map.
- Next: Step 6 (context summarizer).

### Session 6 (2026-04-17) · Step 6
- Did: Created `src/lib/prompts/summarizer.ts`. Exports `summarizeOldWeeks` (Haiku call, tool use, writes to `coaching_outputs`) and `getWeekSummaries` (reads stored summaries for context building). Added `POST /api/ai/summarize-old-weeks` route. Added sequential session rule to BUILD_PLAN.
- Next: Step 7 (Block Zero assessment call).

### Session 7 (2026-04-18) · Step 7
- Did: Created `src/server/routes/blockZero.ts` (Sonnet extended thinking, `blockZeroAssessment` tool schema, `runBlockZeroAssessment`, `getStoredBlockZeroAssessment`). Added `POST /api/ai/block-zero-assessment` and `GET /api/ai/block-zero-assessment` routes to `app.ts`. Updated `ProgramPage.tsx`: assessment loading state, assessment result card (narrative, week themes, starting weights, coachNote, Begin button), and resume-after-crash recovery in the mount effect.
- Next: Step 8 (Block Zero transition readiness check).

### Session 8 (2026-04-18) · Step 8
- Did: Merged step 7 branch to main. Added `runBlockZeroTransition` and `getStoredBlockZeroTransition` to `src/server/routes/blockZero.ts`. Gathers week adherence, RPE, difficulty, sleep, and soreness. Calls Sonnet with extended thinking using `TOOL_BLOCK_TRANSITION`. Applies calibration targets to training maxes. Added `POST /api/ai/block-zero-transition` and `GET /api/ai/block-zero-transition` routes. Added transition panel to `ProgramPage.tsx`, visible from week 4 onward during Block Zero.
- Next: Step 9 (Haiku weekly plan generation).

### Session 9 (2026-04-18) · Step 9
- Did: Created `src/lib/weeklyPlanAI.ts` (Haiku call, `weekPlan` tool, gathers user profile + training maxes + compressed history + previous week sessions and wellness, stores result in `coaching_outputs`). Updated `POST /api/weeks/auto-generate` in `app.ts`: AI path uses `aiPlan.days[]` to create sessions with `blockType` set correctly; offline falls back to existing `analyzeWeek` + template logic. MT class day filter applied as post-AI safety net.
- Next: Step 10 (MT skill loop).

### Session 10 (2026-04-18) · Step 10
- Did: Imported `mtClassLogs` in `weeklyPlanAI.ts`. Added `MtLogRecord` interface and `prevMtLogs` parameter to `buildPrompt`. Fetches MT class logs (classType, focusSkill, weakness, concept, actionItems) joined to previous week sessions in parallel with session and wellness queries. Injects them as a labeled block in the Haiku prompt so AI can tailor MT focus notes for next week.
- Next: Step 11 (session review capture).

### Session 11 (2026-04-18) · Step 11
- Did: Added `review` and `review_flag` columns to `sessions` table in `schema.ts`. Wrote `drizzle/0011_session_review.sql`. Created `src/lib/sessionReviewAI.ts` (Haiku call, `sessionReview` tool, recent session context, logs to `coaching_outputs`). Updated `POST /api/sessions/:id/complete` to await the review call and write `review` + `reviewFlag` back to the session row.
- Next: Step 12 (ledger AI insights).

### Session 12 (2026-04-18) · Step 12
- Did: Added `getToolInputs` helper in `src/lib/anthropic.ts` (collects all tool_use blocks). Created `src/lib/ledgerInsightsAI.ts` (Haiku, `tool_choice: any`, emits 2-4 `insight` tool calls, formats dashboard/consistency/PRs/correlations/runs/rings into prompt, logs to `coaching_outputs` with kind `ledger_insights`, sorts by priority). Added `POST /api/ai/ledger-insights` route in `src/server/app.ts`. Updated `src/features/history/HistoryPage.tsx` to POST data payload to AI endpoint, fall back to local `generateInsights` on null/error.
- Next: Step 13 (body metrics entry).
- Notes: `generateInsights` in `insightEngine.ts` retained as offline fallback. No new DB migration. Typecheck passes on Step 12 files (`npx tsc -b`). Three preexisting errors remain on main (anthropic unused var, two app.ts null type errors) untouched by this step. No worker dev server on this machine so runtime verification deferred.

### Session 13 (2026-04-18) · Step 13
- Did: Created `src/features/metrics/BodyMetricsPage.tsx` (form with weight required, resting HR / bodyfat / notes optional, weight sparkline via existing Sparkline component, recent entry list). Added `bodyMetrics` to schema import in `app.ts`. Added `POST /api/body-metrics` and `GET /api/body-metrics` routes. Added `/metrics` route to `AppRoutes.tsx`. Merged step 12 worktree branch to main before starting.
- Next: Step 14 (coach surfaces).
- Notes: Weight stored as kg, displayed as lbs using existing `kgToLbsDisplay`. No migration needed (body_metrics table in schema since step 1). No node on this machine, typecheck deferred.

### Session 14 (2026-04-18) · Step 14
- Did: Added block narrative card to `ProgramPage.tsx` (shows block name + narrative from block transition coaching output). Added first-use Drive explainer in `SessionComplete.tsx` with localStorage dismissal. Created `src/features/today/InjuryCheckCard.tsx` (flag something / all clear). Created `src/lib/sessionIntent.ts` and wired intent preview into `TimelineRow.tsx` / `WeekView.tsx`. Created `src/features/session/SkipReasonSheet.tsx` (6 canned reasons + free text) and wired into `TodayPage.tsx` skip flow with reschedule prompt.
- Next: Step 15 (QA and deploy).
- Notes: Five surfaces render cleanly in preview (TodayPage: injury card, wellness, journal, timeline; ProgramPage: FIGHTER BLOCK narrative). API extended with injury-flag and session-intent endpoints in `app.ts`.

### Session 15 (2026-04-18) · Step 15
- Did: QA sweep fixed 4 user-facing em-dashes (`ProgramPage.tsx`, `BagWorkRoundView.tsx`, `strengthTemplates.ts`) and 2 prompt em-dashes in `weeklyPlanAI.ts`. Fixed replace-then-cancel bug in `WeekView.tsx`: skip is no longer PATCHed optimistically; replace flow now defers all mutation to atomic `POST /api/sessions/:id/replace` fired only on picker-select, so cancel paths touch nothing. `tsc -b && vite build` clean (886.69 kB / 260.11 kB gzip). Set `ANTHROPIC_API_KEY` via `wrangler secret put` (old key rotated). Deployed to `https://waymark.bocas-joshua.workers.dev` (version `d81f4431-faaa-4e26-845d-fe333af9894d`). `/api/health` returns 200, no errors in tail.
- Next: Build plan complete. Future work out of plan.
- Notes: Repo grep clean (no `sk-ant-` tokens, no inline `ANTHROPIC_API_KEY=`). `wrangler.jsonc` references secret in comment only.
