# Resilience Roadmap

> Mobile compatibility assessment and hardening plan for Waymark.
> Created 2026-04-13 during mobile review session.
> Branch: `claude/assess-mobile-compatibility-MU8uQ`

---

## Context

Waymark is a Capacitor 8 hybrid app (React 19 + Vite 7 + Tailwind 4) running inside a WKWebView on iOS. The app is architecturally sound and iPhone-first by design, but has gaps in failure handling, loading UX, observability, onboarding, and notification support that need to be closed before relying on it daily.

### Current state (as of this assessment)

- **Loading UX:** Every page shows plain `"Loading..."` text. No skeletons, no spinners.
- **Error handling:** ~40 `console.error()` calls across the codebase. All silent to the user. No error boundaries. No global error handlers (`window.onerror`, `unhandledrejection`).
- **Server errors:** Hono `app.ts` has no `onError` middleware. Unhandled throws return generic 500s with no logging.
- **Toast system:** Fully built (`useToast` with success/info/warning variants) but barely used. Only Settings fires toasts. No error toasts anywhere.
- **View Transitions:** CSS animations written (`::view-transition-old/new`) but JS `document.startViewTransition()` never called.
- **Data fetching:** Manual `useEffect` + `useState` + `try/catch` per page. No caching, no retry, no deduplication.
- **Tests:** Zero automated tests. No unit, integration, or E2E test frameworks installed. No CI/CD.
- **Monitoring:** No Sentry, LogRocket, or crash reporting. `.env.example` has a `SENTRY_DSN` placeholder but it was never integrated.
- **Training maxes:** Seeded to previous peak fitness values. No way to input current ability. No TM reduction mechanism.
- **Notifications:** Zero. Settings stores `amReminder` and `pmLeadMin` values but nothing fires. No push or local notification plugin installed.
- **Timers:** Rest timers work in-foreground only. Lock the phone and the timer freezes.

### Risk profile

| Category | Risk level | Notes |
|---|---|---|
| Hard crashes (WebView dies) | Low | Capacitor/WKWebView is mature and sandboxed |
| UI bugs (layout, safe area, scroll) | Medium-High | WebView rendering differences from desktop browser |
| Logic bugs (wrong data, stale state) | Medium | No regression tests, increasing with each phase |
| Silent failures (blank screens) | High | Errors are invisible to the user right now |
| Network failures (API down, cold start) | Medium | No retry, no offline support, no error UI |
| Injury risk from wrong starting weights | High | TMs are set to peak fitness, not current ability |
| iPhone bricking/damage | Impossible | WKWebView is sandboxed; cannot affect iOS |

---

## Implementation Plan

Five phases. Each step within a phase is independent and can be built, tested, and committed on its own.

---

### Phase A: Safety Net (steps 1-5)

These add resilience without changing any existing data flow or UI logic.

#### Step 1 - Error Boundary (shell level)

- **What:** A React `ErrorBoundary` component wrapping `<Outlet />` in `ShellLayout.tsx`
- **Why:** If any page throws during render, users see a fallback screen ("Something went wrong" + reset button) instead of a white screen
- **Risk:** Very low. Standard React pattern. Does not interfere with normal rendering.
- **Touches:** 1 new component, 1 small edit to `ShellLayout.tsx`

#### Step 2 - Logger utility + global error handlers

- **What:** A `logger.ts` module that:
  - Wraps `console.error` with structured context (timestamp, component, stack trace)
  - Stores errors in `localStorage` as a rolling buffer (last ~100 entries, auto-prunes)
  - Registers `window.onerror` and `window.onunhandledrejection` to catch uncaught errors
- **Why:** Right now `console.error` output is invisible on a physical iPhone unless you connect Safari Web Inspector via USB. This persists errors so you can review them later.
- **Risk:** Low. Additive only. Replaces `console.error` calls with `logger.error` (same signature).
- **Touches:** 1 new module (`src/lib/logger.ts`), find-and-replace `console.error` calls across ~15 files

#### Step 3 - Toast on error catches

- **What:** Add `showToast('Couldn't load data', 'warning')` alongside each existing `console.error` / `logger.error` call
- **Why:** Users currently see nothing when an API call fails. The toast system already exists and works.
- **Risk:** Very low. Purely additive side effect next to existing error handling.
- **Touches:** ~40 catch blocks across page components. Each is a one-liner addition.
- **Prerequisite:** Toast hook (`useToast`) must be available in the component. Most pages that fetch data will need to add it if they don't already have it.

#### Step 4 - Hidden debug screen

- **What:** A section at the bottom of Settings (or behind a 5-tap gesture on the version number) that displays the persisted error log from Step 2
- **Why:** When something breaks, you open this screen to see what happened. Includes "Copy to clipboard" and "Clear log" actions.
- **Risk:** Low. Isolated UI addition. Only visible when you look for it.
- **Touches:** 1 new component, 1 edit to `SettingsPage.tsx`
- **Depends on:** Step 2 (logger)

#### Step 5 - Hono `onError` middleware

- **What:** Add global error handler to the Hono app in `src/server/app.ts`:
  - Catches any unhandled throw in route handlers
  - Logs error with context (endpoint, method, params) via `console.error` (which Cloudflare captures)
  - Returns clean `{ error: "Internal server error" }` JSON with 500 status
- **Why:** Currently if a Drizzle query or business logic throws, the Worker crashes silently with no structured response. The client gets a network error instead of a parseable error.
- **Risk:** Low. ~10 lines at the top of `app.ts`. Catches only unhandled errors.
- **Touches:** `src/server/app.ts` only
- **Bonus:** Errors become visible in `wrangler tail` (live) and Cloudflare dashboard (historical)

---

### Phase B: Block Zero — Return to Training (steps 6-8)

The training maxes are seeded to previous peak fitness values (105 lb squat, 115 lb bench, 140 lb deadlift). After 1-2 years sedentary with tight hips, lower back pain, forward head posture, and rounded shoulders, those numbers are dangerous as a starting point. The existing wave loading, week analysis, and progression logic are solid — but they need the right starting line.

**Block Zero** is a 4-6 week ramp-up block that serves as the prerequisite before the Fighter template. It handles both weight reduction AND volume reduction to safely return to training.

#### Step 6 - Block Zero template and TM reduction

- **What:** A new block type (`block_zero` or `ramp_up`) with its own weekly template:
  - **Weeks 1-2:** Foundation + mobility focus. 2-3 sessions/day max. Strength at 50% of stored TMs, 2x/week. Walking/light jog instead of zone 2 runs. No MT class — posture correctives and movement patterning.
  - **Weeks 3-4:** Add MT class 1-2x/week. Strength TMs progressing (60-65% range). Introduce zone 2 runs. Foundation continues.
  - **Weeks 5-6:** Full template volume. TMs at ~70-75% of stored values. Transition into Block 1 of the Fighter template.
  - TM reduction: apply a return-to-training multiplier (50%) to all stored training maxes at block start. More aggressive TM bumps during ramp-up (weekly progression instead of waiting 6 weeks) since this is rebuilding, not pushing limits.
- **Why:** Standard return-to-training protocol. Connective tissue (tendons, ligaments) detrains harder than muscle and needs 4-8 weeks to re-adapt. Muscle memory means strength returns faster than initial gains, but going too heavy too fast causes tendinitis, not progress.
- **Risk:** Medium. New block type, new template logic, new TM reduction endpoint. But isolated from existing Fighter template — doesn't change how current blocks work.
- **Touches:** `src/lib/weeklyTemplate.ts` (new ramp-up template), `src/server/app.ts` (new block creation endpoint with TM reduction), `src/lib/strengthTemplates.ts` (ramp-up progression curve)
- **Block name:** "Block Zero"

#### Step 7 - Auto-detection on first launch and return from break

- **What:**
  - **First launch:** When no completed sessions exist in the database, auto-start Block Zero instead of the Fighter template. No settings toggle needed — it just happens.
  - **Return from break:** When opening the Program tab and last completed session was 10+ days ago, surface a prompt: "It's been a while. Start a new Block Zero?" Accept creates a new ramp-up block with TM reduction. Decline continues the current block.
- **Why:** The TM can currently only go up or hold — it never goes down. If you train for 3 months, take 2 weeks off, you return to elevated TMs with deconditioned tissue. Block Zero must be re-enterable for this reason.
- **Risk:** Low-Medium. Detection logic is simple (query last completed session date). The prompt is a UI addition to ProgramPage. Re-entering Block Zero reuses the same template from Step 6.
- **Touches:** `src/features/program/ProgramPage.tsx` (detection + prompt), `src/server/app.ts` (first-launch detection in generate endpoint)

#### Step 8 - Manual Block Zero trigger in Program

- **What:** A "Start Block Zero" option always available in the Program page. Allows manually entering a ramp-up block at any time, regardless of whether the auto-detection threshold is met.
- **Why:** You might feel you need a reset before the 10-day threshold. Your body, your call. The system should support that without requiring a workaround.
- **Risk:** Very low. A button that calls the same block creation logic from Step 6.
- **Touches:** `src/features/program/ProgramPage.tsx`

---

### Phase C: Local Notifications (steps 9-12)

Install `@capacitor/local-notifications` and wire it to the app's existing data.

#### Step 9 - Plugin install + permission request

- **What:** Install `@capacitor/local-notifications`, add iOS notification entitlements, request permission on first app launch.
- **Why:** Foundation for all notification features. Must happen before any notification can fire.
- **Risk:** Low. Well-documented Capacitor plugin. Permission request is a one-time iOS dialog.
- **Touches:** `package.json`, `capacitor.config.ts`, iOS `Info.plist`, app initialization in `main.tsx`

#### Step 10 - Daily reminders (morning + PM lead time)

- **What:** Schedule recurring notifications using the existing Settings values:
  - Morning reminder at `amReminder` time (default 06:30): "Time to train"
  - PM lead time at `pmSessionTime` minus `pmLeadMin` minutes (default: 17:00): "Leave for MT class in 60 minutes"
  - When settings change, cancel old notifications and schedule new ones.
  - These show on lock screen with the Waymark app icon (iOS uses app icon automatically for all notifications).
- **Why:** The Settings fields already store these values. They're just not wired to anything.
- **Risk:** Low. Standard local notification scheduling. Cancel + reschedule on settings change.
- **Touches:** New `src/lib/notifications.ts` module, edit `SettingsPage.tsx` to trigger reschedule on save

#### Step 11 - Rest timer lock-screen notifications

- **What:** When a rest timer starts (e.g., 180s between squat sets), schedule a local notification for that many seconds in the future. If the user locks their phone or backgrounds the app, the notification fires on the lock screen when rest is complete.
  - Title/body fully customizable strings, e.g.: "Rest Complete — Back to Front Squat, Set 3 of 5"
  - Fire a burst of 2-3 notifications (at 0s, 5s, 10s after rest ends) to ensure it's noticed.
  - Cancel scheduled notifications if the user returns to the app before rest ends.
  - Pair with existing haptic feedback (`heavyHaptic()`) when notification is received in-app.
- **Why:** Currently, locking the phone kills the JavaScript timer. This is the single biggest usability gap for gym use.
- **Risk:** Low-Medium. Notification scheduling is straightforward. Cancellation logic needs to be clean to avoid stale notifications firing.
- **Touches:** `src/features/session/useRestTimer.ts`, `src/features/session/RestTimer.tsx`, `src/features/session/BagWorkRoundView.tsx`, `src/features/session/SkipRopeView.tsx`, `src/lib/notifications.ts`
- **Rest durations in the app:** Warmup 30s, accessories 60-120s, main lifts 180s, bag work rounds 60s, skip rope 60s

#### Step 12 - Accountability + renewal reminders

- **What:**
  - **Inactivity nudge:** Schedule a rolling notification. Each time a session is completed, reschedule it for 3 days out. If no session is completed, it fires: "3 days since your last session — check your plan." Dismissable, not nagging.
  - **7-day renewal reminder:** On each Xcode install/app launch, schedule a notification for day 6: "Re-sign Waymark in Xcode tomorrow." (Only relevant for free Apple Developer account.)
  - **Block progress milestones:** "Block Zero: Week 3 complete — halfway there."
- **Why:** The app can't remind you to train or re-sign if it can't talk to you outside the app. These are the minimum viable set of proactive notifications.
- **Risk:** Low. Simple scheduled notifications with cancel/reschedule logic.
- **Touches:** `src/lib/notifications.ts`, session completion handlers in `src/server/app.ts` or client-side post-complete logic

### Notification customization notes

- **Wording/tone:** All notification titles and body text are plain strings in code. Change them anytime to match Waymark's tone (e.g., "Rest is over. Get under the bar." vs "Rest complete").
- **Sound:** iOS system default initially. Custom `.caf` sound files can be added to the iOS bundle later if desired.
- **Icon:** iOS uses the app icon (Waymark shield) for all notifications automatically. This is an Apple restriction — no per-notification custom icons — but it works in your favor for consistent branding.
- **Persistence:** iOS notifications fire once and sit on the lock screen until dismissed or tapped. They don't re-fire like an alarm. The burst pattern (2-3 notifications at 0s/5s/10s) simulates persistence for rest timers.

---

### Phase D: Polish (steps 13-14)

These improve perceived performance and visual quality.

#### Step 13 - Skeleton loading component

- **What:** A reusable `<Skeleton />` shimmer component. Each page replaces its `"Loading..."` text with a skeleton that approximates the page layout (card shapes, bar shapes).
- **Why:** Skeletons make loading feel intentional instead of broken. The eye has structure to anchor to while data loads.
- **Risk:** Very low. Pure CSS + JSX. No data flow changes.
- **Touches:** 1 new component (`src/components/ui/Skeleton.tsx`), edits to each page's loading return block

#### Step 14 - View transitions activation

- **What:** Wire up `document.startViewTransition()` on route navigation. The CSS animations already exist (`fade-out-down` 200ms, `fade-in-up` 200ms).
- **Why:** Smooth cross-fade between tabs instead of instant mount/unmount.
- **Risk:** Low. The View Transitions API is progressive — if the browser doesn't support it, navigation works normally (no-op fallback). TypeScript types already defined in `src/types/view-transitions.d.ts`.
- **Touches:** Navigation logic (likely `ShellLayout.tsx` or a nav wrapper)

---

### Phase E: Systemic Fix (step 15)

This is the biggest change and addresses the root cause of most loading/error UX issues.

#### Step 15 - React Query migration (page by page)

- **What:** Replace manual `useEffect` + `useState` + `try/catch` data fetching with TanStack React Query (`useQuery`)
- **Why:**
  - Tab-switching becomes instant (cached data shown immediately, background refresh)
  - Automatic retry on network failure (default 3 attempts with backoff)
  - Stale-while-revalidate (show last-known data while refreshing)
  - Request deduplication
  - Built-in `isLoading`, `isError`, `error` states per query
  - Eliminates ~40 hand-rolled fetch lifecycles with their individual edge cases
- **Risk:** Medium. Touches every page that fetches data. But:
  - `apiFetch` utility stays exactly the same (React Query wraps it)
  - Convert one page at a time, test on Simulator before moving to next
  - Each page conversion is mechanical and reversible
- **Order of conversion (simplest first):**
  1. `SettingsPage` (1 fetch)
  2. `LibraryPage` (3 fetches)
  3. `TodayPage` (2 fetches + mutations)
  4. `ProgramPage` (block/week fetches + generation)
  5. `HistoryPage` (9 fetches - most complex)
  6. `WorkoutPage` (session fetches + mutations)
- **Depends on:** Steps 1-3 should be in place first as a safety net

---

## What this roadmap does NOT address

These are known gaps that may warrant separate efforts:

- **Automated testing** — No unit/integration/E2E tests. Each phase adds features with no regression safety net. A Vitest setup covering critical logic (weight prescription, session state) would be high value but is a separate initiative.
- **Offline support** — No service worker, no local data queue. If you lose signal at the gym mid-session, data can't save until connection returns. React Query's retry helps with flaky connections but true offline requires a caching/sync layer.
- **Bleeding-edge dependencies** — React 19, Router v7, Tailwind v4 are all relatively new releases. Low probability of framework-level bugs but worth noting.
- **Physical device deployment** — The Xcode signing gate (provisioning profile, device trust) hasn't been completed yet. This is a one-time setup step, not a code change.

---

## How to use this document

1. Pull branch `claude/assess-mobile-compatibility-MU8uQ`
2. Work through phases A → B → C → D → E in order
3. Each step can be built, tested on Simulator, and committed independently
4. **Phase A (steps 1-5):** Safety net + observability — do first
5. **Phase B (steps 6-8):** Block Zero — required before first real workout
6. **Phase C (steps 9-12):** Notifications — required for gym usability
7. **Phase D (steps 13-14):** Visual polish
8. **Phase E (step 15):** Systemic data-fetching improvement
9. Test on Simulator after each step before moving to the next

### Minimum viable for first workout

If time is tight, the absolute minimum to safely start training:
- Step 1 (error boundary — catch crashes)
- Step 6 (Block Zero template + TM reduction — safe starting weights)
- Step 7 (auto-detection — so Block Zero triggers on first launch)

Everything else improves the experience but these three keep you safe.
