# Waymark Build Plan

Living document. Updated at the end of every session. Read this first, every time.

---

## How to use this file

1. User pastes the session prompt template with a **Step Number**.
2. Assistant reads this file, finds that step, executes only that step.
3. At session end, assistant updates step status, appends to Session Log, commits.
4. Deploy happens at the end of the full plan, not between steps.

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
- **MT cap**: Hard-enforced by AI. Prevents overtraining from available-every-night access.

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

- **Step 4** `TODO` System prompt builder. Assembles identity + voice canon + user profile + compressed context.
  - Files: `src/lib/prompts/system.ts` (new), `src/lib/prompts/context.ts` (new)
- **Step 5** `TODO` Tool schemas for structured outputs: `weekPlan`, `weekReview`, `blockTransition`, `sessionReview`, `insight`.
  - Files: `src/lib/prompts/tools.ts` (new)
- **Step 6** `TODO` Context summarizer. Rolls weeks 5+ into compressed summaries stored in `coachingOutputs`.
  - Files: `src/lib/prompts/summarizer.ts` (new), cron or on-demand

### Phase 3: Block Zero AI

- **Step 7** `TODO` Block Zero assessment call (Sonnet, extended thinking). Takes onboarding answers, produces 4-week plan and training max calibration targets.
  - Files: `src/server/routes/blockZero.ts`, `src/features/program/ProgramPage.tsx`
  - Acceptance: Output passes tool schema. Voice canon applies to all user-facing strings in output.
- **Step 8** `TODO` Transition readiness check at end of Block Zero. Sonnet reviews 4 weeks of wellness + Drive + adherence + calibration data, decides proceed/hold/adjust.

### Phase 4: Weekly intelligence

- **Step 9** `TODO` Haiku-based weekly plan generation. Replaces rule engine in `weekAnalysis.ts`. Respects MT hard cap.
- **Step 10** `TODO` MT skill loop. Logs from MT class sessions feed back into next week's MT programming focus.
- **Step 11** `TODO` Session review capture. Post-session Haiku call produces one-line review stored on the session record.

### Phase 5: Ledger and surfacing

- **Step 12** `TODO` Ledger AI insights. Replace placeholder `insightEngine.ts` output with Haiku-generated insights. UI slots already exist.
- **Step 13** `TODO` Body metrics entry. Weight and optional fields. Simple form. Graph reuses existing sparkline component.
- **Step 14** `TODO` Coach surfaces: Block narrative view, Drive first-use explainer, injury check-in, session intent preview, skip-reason capture.

### Deploy

- **Step 15** `TODO` End-to-end QA on device. Preview build. Production deploy. Secret rotation check.

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

### Session 3 (2026-04-17) · Step 3
- Did: Created `src/features/onboarding/OnboardingPage.tsx` (three Voice Canon questions, step indicator, goals multi-select, physical textarea with Pass, training history single-select, Commit to write). Added `GET /api/user-profile` and `POST /api/user-profile` to `src/server/app.ts`. Added `/onboarding` route and profile check redirect to `src/app/AppRoutes.tsx`.
- Next: Step 4 (system prompt builder).
- Notes: Profile check runs once on app mount, skips if already on `/onboarding`. Offline fallback skips redirect. Completion navigates to `/program` with replace.

### Session 2 (2026-04-17) · Step 2
- Did: Created `src/lib/anthropic.ts` (direct fetch wrapper, prompt caching headers, retry on 429/5xx/529, offline fallback, tool use, extended thinking for Sonnet). Added `ANTHROPIC_API_KEY` to `Bindings` in `src/server/app.ts`. Noted secret in `wrangler.jsonc`.
- Next: Step 3 (onboarding screen, three questions, writes to `user_profile`).
- Notes: Two sessions ran in parallel directories and diverged. Step 2 artifacts were merged from the other tree into this one. Canonical dir going forward: `/Users/lindsaybell/Developer/Waymark-fresh` (to be renamed to `Waymark` after the broken clone is removed). Set `ANTHROPIC_API_KEY` via `wrangler secret put ANTHROPIC_API_KEY` before Step 7.
