# Waymark Build Plan v2 — Strava, Heart Rate, Coaching

Living document. Updated at the end of every session. Read this first, every time.

v1 (15 steps, AI coaching foundation) is complete and archived at `BUILD_PLAN_v1_DONE.md`. Voice Canon, Hard Rules, and User Profile in v1 remain authoritative. This plan inherits them.

---

## How to use this file

1. User pastes the session prompt template with a **Step Number**.
2. Assistant reads this file, finds that step, executes only that step.
3. At session end, assistant runs the end-of-session prompt (below), updates step status, appends to Session Log, commits, then tells the user what the next step is.
4. Deploy happens at the end of the plan, not between steps. Exception: step 2 (ingestion) requires prod to receive webhooks, so a partial prod push after step 2 may be warranted. Decision deferred to step 2 itself.

### Sequential session rule (enforced every session)

Before writing any code, the assistant must:

1. Run `git log main --oneline -10` to see what is actually merged.
2. Identify the highest v2 step merged (commits of the form `feat: v2 step N ...`).
3. Confirm the requested step is exactly `that number + 1`. If it is not, stop and tell the user which step to run next instead.

### End-of-session prompt (run every session before closing)

1. Confirm the step's work is committed to main (show `git log main --oneline -3`).
2. State the next step number and one-line description.
3. List any blockers the user needs to resolve before the next session (e.g. "set STRAVA_CLIENT_SECRET via wrangler secret put").
4. Append to Session Log with the template below.

---

## Hard Rules (inherited from v1, non-negotiable)

- **No em dashes.** Ever. Not in code, not in comments, not in UI copy, not in responses.
- **No AI-speak.** Banned openers, closers, and connectives per v1.
- **Match the Voice Canon.** All user-facing copy passes through the canon.
- **One step per session.** Do not pre-build future steps. Do not refactor adjacent code unless the step requires it.
- **No generic AI UI.** The coach is silent and embedded.
- **Voice Canon and Hard Rules get re-read every session.** Non-optional.

---

## Voice Canon additions for this phase

Inherits all v1 specimens. New specimens for HR-era surfaces:

| Surface | Copy |
|---|---|
| Today target HR (prescribed session) | Zone 2. 140 to 155 bpm. |
| Today target HR (tempo) | Zone 4. Push the edge. |
| Empty state, run logged without strap | Ran without the strap. Next one will have it. |
| Confirm auto-matched activity | This run was the Foundation Run? |
| HR mismatch flag in session review | Prescribed easy. Heart said hard. Easier next time. |
| Max HR ceiling bumped | Peak was 188. Ceiling updated. |
| Weekly polarization flag | Too much middle this week. Easy got fast, hard got easy. Separate them. |
| Aerobic fitness progress | Same heart, faster feet. Base is building. |
| Strava disconnected | Strava's offline. Manual log until it comes back. |
| First Strava link prompt | Connect Strava. Runs log themselves. |

Voice rules from v1 still apply: short sentences, no exclamation marks, observation before instruction, numbers stated plainly, no congratulations.

---

## User Profile additions

- `max_hr` int, nullable. Seeded from age-predicted (220 minus age) when Strava is first connected OR when onboarding collects DOB. Auto-refined on every Strava ingest: if observed peak > stored max_hr, bump it.
- `resting_hr` deferred. Not in scope. User will revisit after this plan lands.

Zone mapping (computed dynamically from max_hr, not stored):

| Zone | % of max | Purpose |
|---|---|---|
| Z1 | 50-60 | Recovery |
| Z2 | 60-70 | Aerobic base |
| Z3 | 70-80 | Tempo / grey zone |
| Z4 | 80-90 | Threshold |
| Z5 | 90-100 | Max |

---

## Technical Reference

### Strava API

- **Client ID**: `226927` (public, safe in code or env).
- **Client Secret**: set via `wrangler secret put STRAVA_CLIENT_SECRET` before step 1 runs. Never in repo.
- **Authorization callback domain**: `waymark.bocas-joshua.workers.dev`.
- **Callback URL**: `https://waymark.bocas-joshua.workers.dev/api/strava/callback`.
- **Rate limits**: 200 req / 15 min, 2000 / day. Well under for single-user app.
- **Scopes**: `read,activity:read_all`. Read-only. No write scopes ever.
- **Token refresh**: access tokens expire every 6 hours, refresh tokens are long-lived. Store both, refresh on 401.
- **Webhook**: subscription callback URL must echo `hub.challenge` on initial GET. POST events include `aspect_type` ("create"/"update"/"delete"), `object_type` ("activity"), `object_id`, `owner_id`.

### Ingestion strategy

Webhook is the fast path. Poll is the safety net. Both converge on a single `ingestStravaActivity(activityId)` function.

- **Webhook** `/api/strava/webhook`
  - GET: echo `hub.challenge` for subscription verification.
  - POST: enqueue activity ID for ingestion. Respond 200 within 2 seconds (Strava retries otherwise).
- **Poll** `/api/strava/poll-recent`
  - Called on every Today page load.
  - Fetches athlete activities modified in the last 48h.
  - Ingests any not already linked (`strava_activity_id` foreign key to `run_sessions`).

### Matching strategy

On ingestion, attempt auto-match:

1. Look up prescribed Waymark session on the activity's local date.
2. If sport matches (Strava `Run` -> Waymark running session, `Workout` / `WeightTraining` not matched in this plan, those stay manual for now).
3. If match found: attach with `attachment_status = 'auto_attached'`, do not overwrite any manual fields already set.
4. If no match: attach with `attachment_status = 'orphaned'`, show in a "Review this" slot on Today.

Confirmation UI: every auto-attached activity shows a one-time "This run was the X session?" prompt. Accept / Reassign. Reassignment shows a picker of the same week's planned sessions.

---

## Pacing

Compressed. Steps 1-5 all ship today. Steps 6-7 deferred to the following week so they can be built against real HR data.

- **Today (2026-04-18)**: steps 1-5. One commit per step. Prod deploy mid-day at end of step 2 (webhooks need a public URL).
- **Mon (04-20)**: training begins. No HR yet. RPE + soreness + adherence drive coaching.
- **Wed (04-22)**: strap arrives. Pair to iPhone Strava. Short test run end of day to verify pipeline.
- **Thu (04-23)**: first HR-captured session. Target-HR line, auto-match, schema all exercised for real.
- **Thu-Sun (04-23 to 04-26)**: data accumulates. No new build.
- **Following week (04-27+)**: steps 6-7 built against real data. Final deploy after step 7.

If the Wed strap ship slips, move the test run to Thu. No effect on steps 6-7 pacing — data just starts accumulating a day later.

---

## Phases and Steps

Status legend: `TODO` · `DOING` · `DONE` · `BLOCKED`

### Phase 1: Strava ingestion pipeline

- **Step 1** `TODO` Strava OAuth + token storage
  - Files: `src/db/schema.ts` (new `strava_tokens` table), `drizzle/0012_strava_tokens.sql`, `src/server/routes/strava.ts` (new), `src/server/app.ts` (route registration, Bindings), `src/features/settings/SettingsPage.tsx` (Connect Strava button, status display), `wrangler.jsonc` (secret note).
  - Acceptance: GET `/api/strava/authorize` returns Strava auth URL with correct scopes and redirect. GET `/api/strava/callback?code=...` exchanges code for tokens, stores them, redirects to Settings with status. Settings page shows connected athlete name and "Disconnect" button. Refresh on 401 works.
  - Commit: `feat: v2 step 1 Strava OAuth and token storage`

- **Step 2** `TODO` Webhook + poll ingestion
  - Files: `src/server/routes/strava.ts` (extend), `src/server/app.ts` (webhook route, poll route), `src/features/today/TodayPage.tsx` (call poll on mount).
  - Acceptance: GET `/api/strava/webhook` echoes `hub.challenge`. POST `/api/strava/webhook` accepts create/update events and logs them (ingestion itself lands in step 3 once schema is ready). POST `/api/strava/poll-recent` returns list of recent activity IDs with `already_linked` flag. Today page calls poll silently on mount.
  - Note: webhook subscription creation is a one-time manual curl call documented in the step. Production URL required, so a prod deploy happens at end of this step to wire webhooks.
  - Commit: `feat: v2 step 2 Strava webhook and poll ingestion`

### Phase 2: HR data in Waymark

- **Step 3** `TODO` Schema for HR, splits, and strava link
  - Files: `src/db/schema.ts`, `drizzle/0013_hr_and_strava_link.sql`.
    - Add to `run_sessions`: `avg_hr` int nullable, `max_hr` int nullable, `zone_seconds` text nullable (JSON `{z1,z2,z3,z4,z5}` in seconds), `elevation_gain_m` int nullable, `source` text (`'strava' | 'manual' | 'indoor'`), `strava_activity_id` int nullable unique, `attachment_status` text nullable.
    - Add to `user_profile`: `max_hr` int nullable, `dob` text nullable (ISO date, used if present for 220 minus age fallback).
    - New table `run_splits`: `id`, `run_session_id`, `km_index`, `duration_sec`, `avg_hr`, `elevation_gain_m`.
  - Acceptance: migration applies cleanly. Backfill sets `source='manual'` on existing rows. Typecheck clean.
  - Commit: `feat: v2 step 3 HR schema and strava link`

- **Step 4** `TODO` Activity ingestion + auto-match + confirm UI
  - Files: `src/server/routes/strava.ts` (complete the `ingestStravaActivity` function), `src/features/today/ActivityConfirmCard.tsx` (new), `src/features/today/TodayPage.tsx` (show orphaned and unconfirmed attachments).
  - Acceptance: new Strava activity flows into `run_sessions` with HR + zones + elevation populated. Auto-match by date + sport type. "This run was the X session?" card on Today for every un-confirmed auto-attachment. Accept dismisses the card, Reassign opens the week-session picker. Max HR in profile auto-bumps if peak exceeds stored value.
  - Commit: `feat: v2 step 4 activity ingestion and confirm UI`

- **Step 5** `TODO` Today target HR line on prescribed sessions
  - Files: `src/features/today/TimelineRow.tsx` (add target-HR line under intent), `src/lib/sessionIntent.ts` (new `getSessionTargetHr` function given session type + user max_hr).
  - Acceptance: on every running session with a known target zone and a non-null profile max_hr, a second `<p>` renders under the intent line using identical styling (`text-[13px] text-muted-foreground italic leading-relaxed`). Copy matches voice canon: `Zone 2. 140 to 155 bpm.`
  - Edge case: no max_hr yet -> omit the line silently.
  - Commit: `feat: v2 step 5 today target HR line`

### Phase 3: AI coaching updates

- **Step 6** `TODO` HR-aware coaching
  - Files: `src/lib/sessionReviewAI.ts` (include avg HR + zone distribution + target zone in prompt, add "intensity mismatch" as a possible review flag), `src/lib/weeklyPlanAI.ts` (include last week's zone distribution across all runs, flag polarization failures, adjust next week's easy days if too much Z3 observed).
  - Acceptance: session review emits HR-aware one-liners when data present. Weekly plan output shows evidence of zone-distribution awareness in `adjustmentNotes`. Voice canon holds.
  - Commit: `feat: v2 step 6 HR-aware coaching`

### Phase 4: New ledger surfaces

- **Step 7** `TODO` Aerobic Fitness + Weekly Zones ledger cards
  - Files: `src/features/history/AerobicFitnessChart.tsx` (new), `src/features/history/WeeklyZonesChart.tsx` (new), `src/features/history/HistoryPage.tsx` (add both ChartCards), `src/server/app.ts` (two new GET routes).
  - Acceptance: Aerobic Fitness shows pace-at-fixed-HR over weeks (default HR band 135-145, adjustable). Weekly Zones shows stacked horizontal bar per week with Z1-Z5 in distinct colors. Both cards only render when at least 3 HR-equipped runs exist. Empty state copy: "Strap up a few runs and this starts showing up."
  - Commit: `feat: v2 step 7 aerobic fitness and weekly zones cards`

---

## Session Log

Append one entry per session. Keep under 5 lines each.

<!-- template
### Session N (YYYY-MM-DD) · v2 Step X
- Did: ...
- Next: Step Y
- Notes: ...
- Blocker for next session: ... (or "none")
-->

<!-- First entry goes here when Step 1 runs. -->
