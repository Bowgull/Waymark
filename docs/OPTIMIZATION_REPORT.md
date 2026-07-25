# Waymark — Software Optimization Report

> Author: Claude (audit pass). Date: 2026-06-02. Branch: `codex/roadtrip-coach`.
> Scope: full front + back review through four lenses — software engineer, personal trainer / Muay Thai coach, product/marketing, intended end user (the athlete).
> **No application code was changed to produce this report.** It is analysis only.

---

## 0. How to read this

Findings are ranked **P0 → P3**:

- **P0** — correctness/security; can lose data, lie to the user, or expose the system.
- **P1** — meaningfully limits the product or invites bugs; high leverage.
- **P2** — quality/maintainability; pay it down deliberately.
- **P3** — polish / nice-to-have.

Each finding cites the evidence file so it can be verified, not taken on faith.

**Integrity note:** a deeper read corrected several claims from my first verbal audit. Those corrections are in §6 so the record is honest — the app is *more* mature than the first pass implied.

---

## 1. Executive summary

Waymark is a genuinely sophisticated single-athlete training OS: ~90 API routes, 8 workout engines, a bounded-AI coaching layer with real cost discipline (prompt caching, fail-closed offline, token accounting), a deterministic sports-science guidance floor, Strava ingestion with webhook + poll backfill, an aggressive notification system, and a premium brand with a disciplined voice. The engineering fundamentals are well above hobby grade.

The weaknesses are **imbalances**, not rot, and they cluster in four places:

1. **Security** — the API is public and unauthenticated (P0).
2. **Reactivity** — the "adaptive coach" is largely a once-nightly batch; its rich per-event triggers are built but unwired (P1).
3. **Front-end data layer** — hand-rolled fetching with no cache/dedup and no optimistic-write rollback (P1).
4. **Muay Thai depth** — the skill brain is thin relative to the excellent conditioning brain (P1, product).

There are also internal doctrine contradictions (ACWR), a 3,776-line server monolith, 4× duplicated session-creation logic, and a near-total absence of component/E2E tests around the most complex UI.

**Single highest-leverage fix:** wire the per-event reactive triggers — the intelligence already exists; it's one call per route. **Single most urgent fix:** add auth, because the bill and the data are currently exposed.

---

## 2. Scorecard

| Area | Grade | One-line |
|---|---|---|
| Coaching doctrine (conditioning/strength) | A | Detraining curves, ACWR critique, concurrent-training, starter context — excellent |
| AI cost discipline | A− | Caching, gates, debounce, fail-closed, token accounting |
| Notifications / gym-day UX | A− | Escalating alarm, lock-screen round cues, wall-clock timers |
| Deterministic logic layer (`src/lib`) | A− | Pure, tested, well-factored algorithms |
| Data model (schema) | B+ | Clean, normalized, well-indexed |
| Brand / voice | A | Premium, differentiated, consistent |
| Reactivity wiring | C | Triggers built, not fired; nightly-only |
| Front-end data layer | C+ | Retry yes; cache/dedup/rollback no |
| Security | D | Public, unauthenticated, open CORS |
| Server architecture | C | 3,776-line monolith, duplicated logic |
| Test coverage (integration/UI) | D | lib tested; WorkoutPage untested |
| Muay Thai skill depth | C− | 32 combos, no real progression model |
| Data durability | D | No backup/export of the forever log |

---

## 3. Findings by severity

### P0 — Security & data durability

**P0-1 — The API is public and unauthenticated.**
`app.use('/api/*', cors())` ([app.ts:51](../src/server/app.ts)) opens CORS to all origins, and there is **no auth middleware anywhere**. Anyone who learns `https://waymark.bocas-joshua.workers.dev` can read and write all training data, drive the AI endpoints (your Anthropic bill), and trigger Strava operations.
*Fix:* a single shared-secret bearer check in Hono middleware (you're one user — a long random token in the app + a `c.req.header('authorization')` gate is enough). Lock CORS to the known app origins. Low effort, removes the worst exposure.

**P0-2 — No backup or export of the D1 database.**
This is your *forever* training log in one D1 instance. A bad migration, an accidental `confirmReset`, or the demo-reset cron mis-firing (`DEMO_MODE`) wipes it with no recovery.
*Fix:* a scheduled `wrangler d1 export` to R2/local on a cron, plus a manual "Export my data" endpoint. Treat the log as irreplaceable.

**P0-3 — Secrets at rest & webhook trust.**
Strava access/refresh tokens are stored plaintext in D1 ([schema `stravaTokens`](../src/db/schema.ts)). The webhook GET verifies `hub.verify_token` (good, [strava.ts:172](../src/server/routes/strava.ts)) but the webhook POST accepts any caller — a forged event can trigger ingestion. Low practical risk for one user, but note it.

**P0-4 — Reopen-mid-workout crash loop (reported bug, root-caused).**
Closing the app during a session and reopening crashes the workout screen and the user cannot get back in. Mechanism:
- The session `ErrorBoundary` "Resume" button (`handleRetry`) only flips `hasError = false` ([ErrorBoundary.tsx:38](../src/components/ui/ErrorBoundary.tsx)) — it re-renders the same crashing component with the same state, so a deterministic crash re-throws immediately. The only escape, "Back to Today," fires **POST `/abandon`** and discards the session. Nothing clears persisted recovery; `handleReload` re-reads it and re-crashes.
- **Recovery model drift:** `workoutRecovery.ts` `RECOVERABLE_PHASES = {exercise, rest, round, video}`, but the real `Phase` union ([WorkoutPage.tsx:222](../src/features/session/WorkoutPage.tsx)) has no `round`/`video` and uses `bag-warmup`/`fr-run`/`combo-rating`/etc. Non-strength resume always fails validation and falls back to `setPhase('exercise')` (a strength phase) with an unsafe `recovery.phase as Phase` cast.
- **Asymmetric validation:** strength validates the restored index against set counts ([WorkoutPage.tsx:522](../src/features/session/WorkoutPage.tsx)); non-strength paths trust the saved index unchecked ([:444](../src/features/session/WorkoutPage.tsx)) → out-of-bounds risk.
- **Auto-resume only handles strength** ([TodayPage.tsx:158](../src/features/today/TodayPage.tsx)); non-strength in-progress sessions land on Today, get `endAllLiveActivities()`, and (if the date passed) drop out of the list — unreachable.
- **Likely trigger:** iOS kills the backgrounded WKWebView; cold reopen re-runs `load()`; if the network isn't ready, `apiFetch('/api/sessions')` throws before `sessionType` is set → a render branch dereferences null → boundary → loop. The exact stack is already persisted to `app_logs` and visible in **Settings → Logs**.
*Fix set:* (1) ErrorBoundary "Resume" should `clearWorkoutRecovery()` and re-trigger `load()`, not just clear the flag; (2) "Back to Today" must not abandon; (3) reconcile `RECOVERABLE_PHASES` with the real `Phase` union and remove the `as Phase` casts; (4) bounds-validate non-strength recovery like strength; (5) extend TodayPage auto-resume to all in-progress session types; (6) guard the load path so a null `sessionType` renders a recoverable empty state, not a throw.

### P1 — Correctness & product leverage

**P1-1 — Per-event reactive coaching is unwired.**
`reactiveCoach.ts` defines triggers for `session_skipped`, `session_completed`, `wellness_logged`, `session_replaced` — all gated and ready. **`app.ts` never calls `runReactiveReplan` for any of them**; the only caller is the nightly cron with `trigger: 'rollover'` ([index.ts:67](../src/index.ts)), which only acts on 2+ missed days in 3. The skip handler returns `coach: null` ([app.ts:887](../src/server/app.ts)). `TOOL_SKIP_RESPONSE` is dead code.
*Effect:* a single skipped class produces no reshape, no makeup, no coach line. The "real-time adaptive coach" is a once-nightly batch.
*Fix:* call `runReactiveReplan({ trigger: 'session_skipped'|'session_completed'|... })` from the skip / complete / daily-log routes (use `ctx.waitUntil` so it doesn't block the response). The debounce already prevents spam. **This is the highest-leverage change in the codebase.**

**P1-2 — Optimistic UI writes have no rollback.**
`apiFetch` *does* retry (1 retry, 10s timeout, on 5xx/network — [api.ts:49](../src/lib/api.ts)), so the transport is more robust than I first said. But the **components** mutate local state then fire the request and never reconcile on failure: `commitSkip`, `handleEndEarly`, `handleReplaceAccept` in [TodayPage.tsx](../src/features/today/TodayPage.tsx) all `setSessions(...)` first and only `console.error` in the catch. A failed write after retries leaves the screen showing a state the server rejected.
*Fix:* adopt **TanStack Query** mutations with `onError` rollback + query invalidation. Also fixes no-cache/no-dedup/stale-while-revalidate in one move (this is RESILIENCE_ROADMAP step 15, still undone).

**P1-3 — Internal doctrine contradiction: ACWR.**
`system.ts` explicitly tells the model to stop reporting numeric Acute:Chronic ratios ("the math has been criticized... use the directional heuristic instead of reporting numeric ratios"). But `adherence.ts` computes and **serializes the exact number into the prompt**: `Acute:Chronic workload ratio: X (target 0.8-1.3...)` ([adherence.ts:181](../src/lib/adherence.ts)). The deterministic layer feeds the model the precise figure the doctrine forbids.
*Fix:* drop the numeric ACWR line from `serializeAdherenceForPrompt` (or gate it), keep the directional label. One-line consistency fix with real coaching impact.

**P1-4 — Muay Thai skill brain is thin (product).**
32 combos in seed; "mastery" is a self-rated 0–10 tap; the `tier/level/unlocked` skill tree is declared but not built; no shadowbox/footwork/clinch; the loop doesn't close — MT-class weaknesses are read once by [bagPrescriptionAI.ts:119](../src/lib/bagPrescriptionAI.ts) and forgotten. For a Muay Thai athlete this is the biggest substantive gap: it's a conditioning app that logs MT, not an MT app.
*Fix:* (a) expand the combo/technique library; (b) build the progression model the schema already gestures at; (c) make logged weaknesses durably drive drill blocks; (d) add the shadowboxing engine (already scoped — `waymark-shadowboxing-plan`).

**P1-5 — No persistent athlete model.**
Every AI call rebuilds context from scratch (`compressedHistory` is passed `null` in the reactive path). Nothing compounds across months — which is the entire payoff of a forever-single-user app.
*Fix:* a coach-owned record (injury recurrence, load response, what worked) read into every system prompt and updated by one weekly pass.

### P2 — Architecture & maintainability

**P2-1 — `app.ts` is a 3,776-line / 146 KB monolith** (~90 routes + inline helpers like `buildBagWorkResponse`). `routes/` proves the split pattern (strava/blockZero/logs); the other ~80 routes never moved. Every change risks the whole file and it's merge-hostile.
*Fix:* extract by domain into `routes/` (sessions, workouts, history, weeks, ai, profile). Mechanical, incremental.

**P2-2 — Session-creation logic duplicated 4×** (generate-today + auto-generate ×3 for block-zero/road/fallback). They've already drifted: only the block-zero copy persists `entry.notes`; road/fallback don't ([app.ts:606,2339](../src/server/app.ts)). This is why shadowboxing needed a workaround and is a latent bug farm.
*Fix:* one `createSessionsFromTemplate(template, ctx)` helper. Add `notes?` to `TemplateSession` and persist it everywhere.

**P2-3 — Session `label` is not persisted** — display name is derived from `type` ([TimelineRow.tsx](../src/features/today/TimelineRow.tsx)). Limits custom/ad-hoc sessions and is the reason "shadow = bag_work" reads wrong.

**P2-4 — `WorkoutPage.tsx` is a 1,523-line component with a ~14-phase state machine** (`Phase` union at line 222) and a per-type if/else loader. It's the execution heart and the highest-complexity, highest-churn surface.
*Fix:* split per session-type into child components/hooks; extract the loader into a `useWorkoutData(type, id)` hook.

**P2-5 — Stale/incorrect comment** — `reactiveCoach.ts` header says "One Haiku call per trigger, never Sonnet," but the call uses `claude-sonnet-4-6` ([reactiveCoach.ts:498](../src/lib/reactiveCoach.ts)). Either the comment or the model is wrong; pick one. Add an AI **spend cap** while you're there (a daily token ceiling read from `coachingOutputs`).

### P2 — Testing & observability

**P2-6 — Zero component/E2E tests.** 16 lib test files (the algorithms are genuinely well covered — good), but `WorkoutPage` (1,523 lines) and the whole integration layer that actually breaks at the gym have no coverage.
*Fix:* add a smoke E2E (Playwright) for the critical path (Today → start strength → log sets → complete) and component tests for the WorkoutPage state machine.

**P2-7 — Inconsistent error reporting** — raw `console.error` sits beside `logger.error` in the same files (e.g. TodayPage), so a chunk of failures never reach the LogsPage you built. `onError` middleware *does* exist now ([app.ts:56](../src/server/app.ts)) — good. Finish the job: replace residual `console.error` with `logger.error`.

### P3 — Polish

- **Onboarding under-collects.** Only goals/injuries/recency, while `userProfile` has columns for MT cap, schedule, equipment, dob, maxHr ([OnboardingPage.tsx](../src/features/onboarding/OnboardingPage.tsx)). Capture them so coaching starts sharp.
- **Timezone fragility** — UTC epoch-day vs local; matters because you're on the road across zones. Audit `sessionRollover`/scheduling for DST/zone edges.
- **No identity/journey surface** day-to-day — the voice is great but the *why* and the *arc* aren't reflected back; over months that risks flatness.

---

## 3.5 — UI / UX (dedicated pass)

**Problems:**
- **UX-1 (high) — Silent failures.** ~20 front-end surfaces call the API; only **6 use toast**. The other ~14 fail with a `console.error` only. At the gym a failed save looks identical to success. This is the user-facing half of the error-handling gap.
- **UX-2 (high) — Low-opacity text hurts outdoor legibility.** Heavy use of `text-gold/40`, `text-muted-foreground/45`, `/50` (pervasive in TodayPage). On a dark theme this likely fails WCAG contrast and is hard to read in daylight — which matters because training happens outdoors and on the road. The style guide claims high contrast; the code doesn't always honor it.
- **UX-3 (medium) — No "needs you" signaling in nav.** The 4 bottom tabs are static — no badge for a pending coach adjustment, unlogged wellness, or a makeup session. The coach reshapes silently and the UI gives no ambient cue.
- **UX-4 (medium) — Accessibility is thin.** Sparse `aria`/roles/focus management; WorkoutPage has ~1 a11y signal; history charts have no text/data fallback.
- **UX-5 (low) — No undo** on skip / end-early beyond the optimistic flip.

**Already good (keep):** safe-area insets + `dvh` units (proper notch/home-bar handling), `max-w-[430px]` mobile shell, `OfflineBanner`, first-run Tour, rich on-brand animation set, a "mark earned" ceremony (`MarkEarnedOverlay`).

**Corrections to old roadmap (now done):** skeletons are adopted (no more "Loading…" text); view transitions are wired (`navigate.ts` calls `startViewTransition`).

## 4. What is already excellent (keep / don't touch)

Credit where due — these are strengths, not todos:

- **Coaching doctrine** ([system.ts](../src/lib/prompts/system.ts)): detraining curves, the *explicit rejection* of ACWR thresholds, concurrent-training-interference nuance, starter context, MT-protection rule, zone-2 discipline. Better than shipped commercial apps.
- **AI plumbing** ([anthropic.ts](../src/lib/anthropic.ts)): ephemeral prompt caching, retry on 429/5xx/529, fail-closed-to-offline, per-call token logging, `coachingOutputs` accounting.
- **Notifications** ([notifications.ts](../src/lib/notifications.ts)): a 4-phase escalating morning alarm, lock-screen round/rest/strength cues with `timeSensitive` + custom `.caf` sounds, redeploy reminders, foreground kill-switch. This is the opposite of the old "zero notifications" state.
- **Rest timer survives screen lock** ([useRestTimer.ts](../src/features/session/useRestTimer.ts)) via wall-clock timestamp math — the gym-critical bug from the old roadmap is solved.
- **Deterministic guidance floor** ([adherence.ts](../src/lib/adherence.ts)): translates adherence into concrete deload/progression defaults the AI can override — exactly the right architecture.
- **Strava integration** ([strava.ts](../src/server/routes/strava.ts)): transparent token refresh, webhook real-time path + 14-day poll backfill, demo-mode guard.

---

## 5. Recommended sequence

Ordered by leverage-per-effort, given **single-user-forever, no Apple Watch, conversational coach deprioritized**:

1. **P0-1 auth + CORS lock** — hours. Stops the exposure.
2. **P0-2 DB backup/export** — hours. Protects the irreplaceable log.
3. **P1-1 wire reactive triggers** — small, highest product leverage. The brain exists.
4. **P1-3 ACWR contradiction + P2-5 spend cap/comment** — one-liners, real impact.
5. **P1-2 TanStack Query migration** — page by page; kills the desync class and the loading jank.
6. **P1-4 Muay Thai skill loop** (incl. shadowboxing) + **P1-5 athlete model** — the substantive product depth; build over time.
7. **P2-1/2-2 split `app.ts` + dedupe session creation** — pay down before the next feature wave.
8. **P2-6 critical-path E2E** — lock in the gym flow before refactors.

---

## 6. Corrections to my earlier verbal audit (honesty ledger)

Deeper reading overturned these first-pass claims — recording them so the report is trustworthy:

| Earlier claim | Reality after reading source |
|---|---|
| "No retry on API calls" | **Wrong.** `api.ts` retries once on 5xx/network with a 10s timeout. The real gap is cache/dedup/optimistic-rollback, not retry. |
| "No `onError` middleware" (from old roadmap) | **Wrong.** `app.ts:56` has it now. |
| "Rest timers freeze on lock" (from old roadmap) | **Wrong.** `useRestTimer` is wall-clock based and survives lock; lock-screen cues fire via notifications. |
| "Zero notifications" (from old roadmap) | **Wrong.** Notifications are extensively wired. |
| "Reactive coach not wired at all" (my first grep) | **Partly wrong.** It IS wired — but only via the nightly `rollover` cron. The per-event triggers remain unwired (P1-1 stands). |

The substantive criticisms that **survived** verification: no auth (P0-1), no backup (P0-2), per-event reactivity unwired (P1-1), optimistic rollback missing (P1-2), ACWR contradiction (P1-3), thin MT depth (P1-4), no athlete model (P1-5), monolith + duplication (P2-1/2), untested UI (P2-6).

---

## 7. GitHub / external — integrate, learn, or ignore?

**Honest stance: mostly "learn," rarely "integrate," never "reshape."** This is a bespoke single-user app; importing a framework would add bloat and fight the clean lib/transport split.

- **Adopt (libraries):** TanStack Query (directly fixes P1-2 / data layer) — the single highest-value external dependency. Your existing choices (Hono, Drizzle, Capacitor) are correct; don't replace them.
- **Learn from (domain):** open training-science projects (e.g. intervals.icu) for *training-load data modeling* — borrow the model, not the ACWR formula you deliberately rejected.
- **Avoid:** generic fitness-app templates, gamification/social SDKs (anti-brand), and "AI coach" starter kits — yours is more disciplined than any of them.
- **Build, don't borrow:** the Muay Thai combo library, skill-progression model, and shadowbox/clinch curriculum. There is little good open-source here; this is your moat.

---

## 8. Coverage caveat

This report is thorough but not literally every line. **Read in depth:** schema, route map, system/tools prompts, reactiveCoach, bagPrescriptionAI, insightEngine, adherence, api, anthropic, notifications, useRestTimer, TodayPage, OnboardingPage, roadBootcampTemplate, AppRoutes, index.ts, style guide, strava (token/webhook paths). **Sampled, not exhaustive:** `WorkoutPage` internals beyond its state machine, full `strava.ts` body, `weeklyPlanAI`/`sessionReviewAI`/`ledgerInsightsAI` internals, the history/chart endpoints and components. A line-by-line of those four is the natural next pass if you want P2/P3 findings there too.
