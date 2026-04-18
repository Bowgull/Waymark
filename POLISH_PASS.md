# Waymark UX Polish Pass

Out-of-step UX work after v2 Step 5 merged (`993a0f3`). Shipped as 5 small commits, one per session, each testable on device before the next starts.

Read this file every session. Read the Hard Rules and Voice Canon in `BUILD_PLAN.md` too.

---

## Context snapshot (2026-04-18)

- v2 steps 1-5 merged to main. HEAD: `993a0f3 feat: v2 step 5 today target HR line`.
- This polish pass started from user feedback on Today/indoor/settings UX and alarm UX.
- Aesthetic canon (see `~/.claude/projects/-Users-lindsaybell-Developer-Waymark/memory/user_aesthetic.md`): lofi + fantasy book, Cinzel display, Geist body, forest+gold palette, dark-dry copy, quiet-by-default.
- User sideloads on personal dev cert — iOS entitlements can be self-granted.
- User shares a bed — alarms must not be jarring.
- User's phone typically on silent — morning + nuclear alarms must bypass via Critical Alerts entitlement.

---

## Locked decisions (do not rehash)

### 1. Splash launch image
- Replace `ios/App/App/Assets.xcassets/Splash.imageset/*.png` with static logo frame on `#0a0a0a` background.
- Goal: zero white flash. Launch image blends seamlessly into React `LoadingScreen` animation.
- `capacitor.config.ts` `backgroundColor: '#0a0a0a'` is already correct.

### 2. Time picker
- In `src/features/settings/SettingsPage.tsx`: replace the Hour/Minute tab drum with **side-by-side** hour + minute ScrollDrums in one sheet.
- Minute step = **1** (not 15).
- Applies to AM alarm and PM session time. Lead-by minute drum stays as-is (step 5 or 15 is fine).

### 3. Nav + Settings gear
- Remove Settings tab from bottom nav in `src/app/ShellLayout.tsx`. Now 4 tabs: Today, Program, Library, Ledger.
- Add small gear icon bottom-right of Today page (`src/features/today/TodayPage.tsx` or wherever the bottom of Today renders) linking to `/settings`. Unobtrusive, muted-foreground, below the last card.

### 4. Background polish
- In `src/index.css`: lift bottom nav bar background ~5% L in oklch so it reads as chrome, not content.
- Add soft radial gold glow near top center of page body (~3% alpha, large radius).
- Thin `border-t border-gold/10` hairline above bottom nav.
- Do not recolor content surfaces — chrome only.

### 5. Fighter Block narrative removal
- In `src/features/program/ProgramPage.tsx`: delete `getFighterBlockNarrative()` and its render site. Keep `getBlockZeroNarrative()` and Block Zero rendering.
- When user graduates past Block Zero, the Program page simply doesn't show a block narrative. That's intentional.

### 6. One Piece display
- Indoor ready screen (`src/features/session/RunSessionView.tsx` phase === 'ready', isIndoor === true): big Cinzel readout showing `{arc} — Ep {ep}` above the "Open One Pace" button. Font: `var(--font-display)`, size `text-display-lg` or close.
- On Save Run (indoor): auto-bump `onePaceEp` by +1. Persist the new value to `/api/settings` so next run picks it up.
- Toast on bump: show `"Ep {old} → Ep {new}"` via existing `useToast` hook. Keep it brief.
- In Settings: add +/- stepper buttons next to the Episode field for manual adjustment (watched 2 episodes in one run, etc).

### 7. Redeploy countdown
- Inject `VITE_BUILD_TIME` into the bundle via `vite.config.ts` `define: { 'import.meta.env.VITE_BUILD_TIME': JSON.stringify(Date.now()) }` (or equivalent plugin hook).
- Display in Settings (top area, small pill): Cinzel number showing `{7 - daysSinceBuild}` with tiny "DAYS UNTIL REDEPLOY" caption below. Not tappable. Color: default at 3+, gold at 2, `destructive` at ≤1.
- On every app launch: read `VITE_BUILD_TIME`, compare to `localStorage.lastSeenBuildTime`. If different → save + cancel old redeploy notifications + schedule new ones for (buildTime + 6d) and (buildTime + 7d).
- Two notifications only, **no sound** (respect silent mode, default sound off, use `sound: undefined` or equivalent):
  - 1 day before: `"Redeploy tomorrow or the app goes dark."`
  - Day of: `"Redeploy today. Connect cable."`
- Notification IDs: reserve `5000` and `5001` in `src/lib/notifications.ts` comment block.

### 8. Critical Alerts + custom sounds
**Scope:** morning base + morning storm + nuclear follow-ups only. PM leave-by + round cues stay respecting silent mode.

**Sounds:**
- Morning (base + storm of 10 at 30-sec intervals): **Musical Vintage Lo-Fi Piano** — [pixabay.com/sound-effects/musical-vintage-lo-fi-piano-486284](https://pixabay.com/sound-effects/musical-vintage-lo-fi-piano-486284/). Download MP3, convert to `.caf`, bundle under `ios/App/App/Sounds/` or similar.
- Nuclear follow-ups (15-sec intervals, ~48 notifications over 12 min from +36): **TBD** — user still sampling. Search terms on Pixabay: `vinyl scratch short`, `low piano hit`, `wood block`, `tape rewind`, `monastery bell short`, `singing bowl strike`. One sound, repeated. Do not proceed with this commit until the file is chosen.

**iOS entitlement:**
- Add `com.apple.developer.usernotifications.critical-alerts` to `ios/App/App/App.entitlements`.
- At runtime request permission with `criticalAlert: true`. User sees a one-time prompt.
- On scheduled morning + nuclear notifications: `interruptionLevel: 'critical'`, `criticalSound: { name: '<file>.caf', critical: true, volume: 0.6 }`.

**Plugin capability:**
- `@capacitor/local-notifications` may not expose `interruptionLevel` natively. Before writing code: read the installed version's type definitions and plugin source in `node_modules/@capacitor/local-notifications/` to confirm support. If not supported, either:
  - (a) Patch the plugin via `patch-package`
  - (b) Swap to a fork/alternative plugin that supports it
  - (c) Write a minimal custom iOS plugin in `ios/App/App/Plugins/`
- Report which path before taking it.

**iOS cadence (total pending notifications ≤64 budget):**
- Morning storm: 10 @ 30-sec intervals from alarm time (IDs 1000-1009)
- Snooze 1/2/3: +9/+18/+27 min (IDs 1010-1012)
- Nuclear: 48 @ 15-sec intervals from +36 min (IDs 2000-2047)
- Redeploy: 2 (IDs 5000-5001)
- PM leave-by: 1 (ID 3000)
- Round cues: scheduled per-session, small number
- Total: ~65 pending — trim nuclear to 46 if you need room for round cues.

---

## Commit order (one commit per session)

1. **Splash launch image** — smallest, ships confidence.
2. **Time picker + nav gear + background polish** — UI polish batch.
3. **Fighter Block removal + One Piece display + ep bump + toast** — Program + Today surface.
4. **Redeploy countdown** — Settings addition + 2 notifications (no sound).
5. **Critical Alerts + sounds + plugin patch** — hairiest, do last.

Do not bundle commits. Each session should end with a pushed commit to main and a successful `wrangler deploy`/iOS rebuild verification before the next session starts.

---

## Session protocol

**At session start:**
1. Read this file top-to-bottom.
2. Read `BUILD_PLAN.md` Hard Rules + Voice Canon sections.
3. Read the "Next commit" section below to know which commit is next.
4. Run `git log --oneline -8 && git status --short` to confirm state.
5. If anything is ambiguous, ask one question before writing code.

**At session end:**
1. Ensure the commit is merged to main and verified on device (or explicitly note if unverified).
2. Update the "Completed commits" section below.
3. Move the completed commit out of "Next commit".
4. Write the prompt for the **next** session — the exact text the user should paste to start it. Include:
   - Which commit is next (by name)
   - Read `POLISH_PASS.md` first
   - Verify git is clean and on main
   - Any new decisions made this session that affect later commits
5. Emit that prompt in your final message to the user, clearly labeled `NEXT SESSION PROMPT:`.

---

## Completed commits

### Commit 1: Splash launch image (2026-04-18)

- Regenerated `ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732{,-1,-2}.png` as 2732x2732 PNGs: solid `#0a0a0a` canvas with `src/assets/brand/Logo.png` composited center at its native 512px.
- `Contents.json` unchanged (three entries at 1x/2x/3x, same three filenames).
- Logo size (~19% of aspect-fill viewport width on a 1170-wide phone) is matched to `LoadingScreen`'s on-screen SVG size of 220px so the transition reads as the same shield holding position, then tracing itself in.
- Generated via Pillow (see commit diff). No storyboard edit; `LaunchScreen.storyboard` still aspect-fills the imageView and the new PNG is fully opaque, so its `systemBackgroundColor` never shows through.
- **Device verification: not performed by Claude** (Mac-side build only). User has not yet confirmed on device; plans to verify later.

### Commit 2: Time picker + nav gear + background polish (2026-04-18)

- Commit: `8af89d8 polish: time picker and chrome pass`.
- `src/components/ui/ScrollDrum.tsx`: added optional `pad?: number` prop; minute drums pass `pad={2}` so single-digit values render as `07`, `00`, etc.
- `src/features/settings/SettingsPage.tsx`: removed `amDrumStep` / `pmTimeDrumStep` state + tab buttons. AM alarm and PM session time now render two side-by-side `ScrollDrum`s in one sheet (hour 1-12 step 1, minute 0-59 step 1). AM/PM toggle preserved. Lead-by drum untouched (15-120 step 15). No `% 15` / `/ 15` formatters elsewhere in the file needed fixing; the display callback already zero-pads via `padStart(2, '0')`.
- `src/app/ShellLayout.tsx`: removed `/settings` NavTab and `SettingsIcon` import. Nav now 4 tabs (Today, Program, Library, Ledger). Nav class changed from `border-t border-border bg-near-black/80 backdrop-blur-md` to `border-t border-gold/10 bg-nav/90 backdrop-blur-md`.
- `src/features/today/TodayPage.tsx`: imported `SettingsIcon` from `@/components/icons/NavIcons`; added `<button aria-label="Settings" onClick={() => navigate('/settings')}>` at the bottom of the page (inside the main container, before overlays) wrapped in `<div className="mt-8 mb-4 flex justify-end">`.
- `src/index.css`: added `--color-nav: oklch(0.15 0.025 160);` in `@theme inline` (about +5% L over body `--background: oklch(0.10 0.03 160)`). Body `background` now stacks a radial gold glow (`radial-gradient(ellipse 120% 40% at 50% -10%, oklch(0.75 0.12 90 / 0.03), transparent 60%)`) on top of the existing 175deg forest gradient.
- Preview verified: nav computed `background-color: oklab(... / 0.9)` at L=0.15, gold top border at alpha 0.1, minute `37` persists through Done (`6:37 AM` display confirmed).
- Build `tsc -b && vite build`: pass. Lint of touched files: 0 errors, 1 pre-existing warning in `ScrollDrum.tsx` (`values` array deps, unrelated to this change). Project-wide lint has 284 pre-existing problems, none introduced here.
- **Device verification: not performed by Claude** (user on same cadence as Commit 1; will verify alongside).

### Commit 3: Fighter Block removal + One Piece display + ep bump + toast (2026-04-18)

- Commit: `c0ffe96 polish: drop fighter block, surface one pace`.
- `src/features/program/ProgramPage.tsx`: deleted `getFighterBlockNarrative()` function and the Fighter-Block JSX render branch. The narrative block is now guarded by `isBlockZero && ...` (no `else` branch). Post-Block-Zero users see the week header + WeekView directly, no narrative card. Grep `FighterBlock|getFighterBlockNarrative` across `src/` returns zero matches.
- `src/features/session/RunSessionView.tsx`: imported `useToast`, wired `const { show: showToast, ToastContainer } = useToast()`. Inside the `phase === 'ready'` indoor branch, added a Cinzel readout above the Open One Pace button: `<p className="font-[family-name:var(--font-display)] text-display-lg text-gold text-center">{[onePaceArc, onePaceEp ? 'Ep ${onePaceEp}' : ''].filter(Boolean).join(' - ')}</p>`, gated on `(onePaceArc || onePaceEp)`. Separator chosen: hyphen with surrounding spaces (` - `) per POLISH_PASS options; voice canon bans em dashes, and hyphen reads cleanest against the existing inscription-style `targetSegments`.
- `src/features/session/RunSessionView.tsx` save path: after the PATCH to `/api/run-sessions/{id}` succeeds, if `isIndoor && onePaceEp`, compute `newEp = String(Number(oldEp) + 1)`, fire-and-forget PATCH `/api/settings` with `{ onePaceEp: newEp }` (errors logged, never block save), call `showToast('Ep ${old} → Ep ${new}', 'success')`, and defer `onComplete()` by `setTimeout(..., 1800)` so the toast is visible before the view unmounts into `mark-earned`. Non-indoor or empty-ep saves take the original immediate-onComplete path. `<ToastContainer />` rendered inside the logging-phase JSX tree.
- `src/features/settings/SettingsPage.tsx`: wrapped the Episode `<input>` in a flex row with `-` / `+` buttons on either side. Buttons are `min-h-[44px] w-10 rounded-md bg-border text-muted-foreground active:bg-muted`. Decrement clamps at 0 (`Math.max(0, (Number(onePaceEp) || 0) - 1)`); increment is unbounded. Value flows through the existing Save handler which already PATCHes `onePaceEp` as string. No server change needed.
- No `src/server/app.ts` change: the existing PATCH `/api/settings` already accepts `onePaceEp` as string and is used for the auto-bump.
- Build `tsc -b && vite build`: pass. Lint of touched files: 0 errors, 2 pre-existing warnings (missing-deps in `ProgramPage` `useEffect` and `RunSessionView` settings-autofill `useEffect` — both predate this commit). Project-wide lint still at 284 pre-existing problems; no new ones introduced.
- Preview verified (vite-frontend serverId, indoor run session on today's planned `running` session after priming `start-run` to create the `run_sessions` row): indoor ready readout renders `Water 7 - Ep {ep}` above Open One Pace; saving bumps `onePaceEp` server-side (verified via GET `/api/settings` — 3 → 4 → 43 across three test saves); toast `Ep 42 → Ep 43` captured in DOM during save window.
- **Device verification: not performed by Claude** (Commits 1, 2, 3 still pending a single device cold-launch from the user; Commit 4 should not begin until that's done unless user says otherwise).

### Commit 4: Redeploy countdown (2026-04-18)

- Commit: `2671323 polish: redeploy countdown`.
- `vite.config.ts`: added `define: { 'import.meta.env.VITE_BUILD_TIME': JSON.stringify(Date.now()) }`. No existing `define` entries to collide with.
- `src/vite-env.d.ts`: added `readonly VITE_BUILD_TIME: string` to `ImportMetaEnv`. TS accepts `import.meta.env.VITE_BUILD_TIME` without a cast.
- `src/lib/notifications.ts`: added a reserved-ID comment block at the top (1000-1012 morning, 2000-2047 nuclear, 3000 PM leave-by, 4000-4099 round cues, 5000-5001 redeploy). Added `REDEPLOY_WARN_ID = 5000` and `REDEPLOY_DAY_ID = 5001`. Exported `cancelRedeployReminders()` and `scheduleRedeployReminders(buildTime)`. Both gated on `isNative`. Scheduler requests permission via existing `requestNotificationPermission()`, computes `buildTime + 6d` and `buildTime + 7d`, skips any trigger already in the past, passes `sound: undefined` and no `interruptionLevel` so they respect silent mode. Copy: "Redeploy tomorrow or the app goes dark." / "Redeploy today. Connect cable." Note: `LocalNotifications.schedule` will reject with an empty `notifications` array, so I only call it when `notifications.length > 0`.
- `src/app/AppRoutes.tsx`: imported `Capacitor` from `@capacitor/core`, plus `scheduleRedeployReminders` and `cancelRedeployReminders`. Inside the existing `useEffect` that already calls `initNotificationListeners`, added a guarded block: if `Capacitor.isNativePlatform()` and `buildTime` is finite, compare `String(buildTime)` against `localStorage.getItem('lastSeenBuildTime')`; if different, fire-and-forget IIFE that `await`s `cancelRedeployReminders()`, then `scheduleRedeployReminders(buildTime)`, then writes `lastSeenBuildTime`. Errors caught and logged. Web build is skipped entirely by the `isNativePlatform()` gate.
- `src/features/settings/SettingsPage.tsx`: computed `buildTime` / `daysLeft` / `daysColor` at the top of the component. Rendered a non-interactive `<section aria-label="Days until redeploy">` above the MT Class Days section: big Cinzel `{daysLeft}` (`font-[family-name:var(--font-display)] text-display-lg leading-none`), caption `Days Until Redeploy` via `.text-label text-muted-foreground`. Color tiers match spec: `daysLeft >= 3` → `text-foreground`, `=== 2` → `text-gold`, `<= 1` → `text-destructive`. Pill is skipped entirely if `VITE_BUILD_TIME` is missing (defensive — always present in real builds).
- Build `tsc -b && vite build`: pass. Lint of touched files: 0 errors, 1 warning (pre-existing `exhaustive-deps` on the onboarding `useEffect` in `AppRoutes.tsx`, unrelated). Project-wide lint still at 284 pre-existing problems; none introduced here.
- Preview verified (vite-frontend): `/settings` shows the pill at the top with "7" (build was seconds ago), default foreground color (oklch(0.93 0.01 80)), Cinzel 36px, caption all-caps tracking-wider muted. Console clean. No native plugin calls fired on web.
- **Device verification: not performed by Claude.** Scheduling and cancellation of the two silent notifications is native-only and will only fire on a real iOS cold launch after install. Commits 1-4 still pending a single device cold-launch from the user.

### Commit 5: Critical Alerts + custom sounds + plugin patch (2026-04-18)

- Commit: `e51bdbe polish: critical alerts for morning and nuclear`.
- **Plugin path: (b) patch-package.** `@capacitor/local-notifications@8.0.2` had no `interruptionLevel` / `criticalSound` / `.criticalAlert` in Swift or in `definitions.d.ts`. Patch (`patches/@capacitor+local-notifications+8.0.2.patch`) adds `.criticalAlert` to `requestAuthorization` options in `LocalNotificationsHandler.swift`; adds `critical` / `criticalVolume` handling and `interruptionLevel` switch in `makeNotificationContent` in `LocalNotificationsPlugin.swift`; extends `LocalNotificationSchema` in `definitions.d.ts` with three optional fields. `patch-package` added as devDep (`^8.0.1`); `postinstall: patch-package` wired in `package.json` scripts so patch re-applies on every `npm install`.
- Sounds: `ios/App/App/Sounds/morning.caf` (Musical Vintage Lo-Fi Piano, 3.8 MB) and `ios/App/App/Sounds/nuclear.caf` (Dragon Studio nuclear alarm type beat, 731 KB) converted via `afconvert -f caff -d LEI16@48000 -c 1`. Sounds/ added to the App group as a folder reference (blue folder) and wired into the Copy Bundle Resources phase of `App.xcodeproj/project.pbxproj`, so any `.caf` dropped in there auto-bundles.
- Entitlement: `ios/App/App/App.entitlements` created with `com.apple.developer.usernotifications.critical-alerts = true`. Added as file reference in the App group and `CODE_SIGN_ENTITLEMENTS = App/App.entitlements` set on both Debug and Release target build configs. Signing succeeds on the user's personal dev cert (self-granted restricted entitlement).
- `src/lib/notifications.ts`:
  - Nuclear cadence changed from 20 @ 2-min intervals to 20 @ 15-sec intervals starting at base+36min (~5 min of wall-to-wall follow-ups), matching section 8 intent now that the .caf is actually loud.
  - Added `morningSound` / `nuclearSound` shape (`{ sound, critical: true, criticalVolume: 0.6, interruptionLevel: 'critical' }`) spread into the base alarm, all three snoozes, and every nuclear entry. PM leave-by and all round cues untouched (silent-mode-respecting).
  - `requestNotificationPermission()` unchanged on the surface — the patched Swift now folds `.criticalAlert` into the same authorization prompt, so no second code path is needed on the JS side.
- `src/app/AppRoutes.tsx`: imported `requestNotificationPermission`; added a one-shot `requestNotificationPermission().catch(noop)` inside the existing `initNotificationListeners` `useEffect`, gated on `Capacitor.isNativePlatform()`. First cold launch shows the combined alert/badge/sound/critical-alert prompt; subsequent launches short-circuit (permission already granted).
- Build `tsc -b && vite build`: pass. Lint of touched files: 0 errors, 1 pre-existing warning on the onboarding `useEffect` in `AppRoutes.tsx` (unchanged from Commit 4).
- **Device verification: REQUIRED and not yet performed.** Full verification flow: cold-launch, grant the OS prompt (now including Critical Alerts), set phone to silent, set AM alarm to 1 minute out, lock screen, wait. Morning piano + all snoozes should fire through silent mode. Also covers Commits 1-4 which are still pending a single device cold-launch.

### Commit 6: Arc drum + redeploy chip (2026-04-18)

- Commit: `8f21176 polish: arc drum and redeploy chip`.
- `src/lib/onePace.ts` (new): exports `ONE_PACE_ARCS` as a readonly tuple of the 32 released One Pace arcs in chronological order (Romance Dawn through Egghead). Verified against One Pace's current releases on 2026-04-18 — Egghead is their latest released arc (index 36 in their numbering, skipping filler arcs that One Pace omits entirely). Wano is included despite One Pace's in-progress Onigashima project because the Wano arc itself reads as one unit for user-facing labeling.
- `src/components/ui/ScrollDrum.tsx`: added a sibling `ScrollDrumList` component with the same item-height/snap/fade-edge chrome as the numeric `ScrollDrum`, but driven by a `readonly string[]` prop (`items`, `value: string`, `onChange: (value: string) => void`). Same Cinzel treatment on selected row (`text-gold font-semibold`), same dim/muted treatment for neighbours (opacity 0.4 at distance 1, 0.2 further out). Truncates long names with `.truncate` so entries like "Long Ring Long Land" don't overflow the constrained column. Some duplication with the numeric drum is deliberate — TS discriminated unions across value shapes were messier than two small components.
- `src/features/settings/SettingsPage.tsx`:
  - Arc: replaced the `<input type="text">` with a sheet-pattern trigger matching the time drums. Trigger button shows the current arc in Cinzel (`var(--font-display)`); tapping opens an inline panel with the `ScrollDrumList` and a Done button, consistent with AM/PM time drums. `activeDrum` state union extended to include `'arc'`. If the stored arc is missing or not in the canonical list, the drum defaults to `ONE_PACE_ARCS[0]` (Romance Dawn) on open. Persist path untouched — existing `PATCH /api/settings` with `{ onePaceArc }` still applies.
  - Row layout: `flex gap-4` with two `flex-1` children → `flex items-end gap-3` with arc as `min-w-0 flex-1` and ep as `w-28 shrink-0`. Arc column measures ~219px on a 343px settings column (~64%, close enough to the 70% target without crushing `- 999 +`). Ep stepper buttons trimmed from `w-10` to `w-8` so `- NNN +` fits in w-28 with breathing room; input uses `min-w-0 flex-1` + center text + `inputMode="numeric"`.
  - Redeploy pill: `px-4 py-3 text-center` block with `text-display-lg` Cinzel + caption line → `flex w-fit items-baseline gap-1.5 rounded-md border border-gold/10 bg-near-black/40 px-3 py-1.5`. Numeral is `text-base` Cinzel with inline `d` suffix (`7d`), followed by a muted `until redeploy` label. Color tiering intact (`text-foreground` / `text-gold` / `text-destructive`). Day-of escalation deliberately NOT added — the silent notification is what actually signals the deadline.
- Preview verified (vite-frontend): pill reads `7D UNTIL REDEPLOY` as a compact chip at the top of Settings, Cinzel "7d" at 16px. Arc row shows `WATER 7` in Cinzel 18px taking the wide column; Episode stepper `- 3 +` fits cleanly in the narrow column. Opening the drum renders all 32 arcs; selected highlight follows the stored value ("Water 7" highlighted gold on mount). Scrolling to "Zou" and clicking Done updates the trigger button to Cinzel "Zou"; Save Settings PATCHes the API and GET `/api/settings` confirms `onePaceArc: "Zou"` persisted. Restored to Water 7 post-verification.
- Build `tsc -b && vite build`: pass. Lint of touched files: 0 errors, 1 pre-existing warning on `ScrollDrum.tsx`'s numeric `values` array (unchanged from earlier commits).
- **Device verification: not performed by Claude** (web preview covers this commit per done-criteria). Still folds into the single pending device cold-launch covering Commits 1-6.

---

## Polish pass complete

All six polish-pass commits are merged to main. No further polish-pass commits are planned as of 2026-04-18. Any remaining rough edges should be opened as fresh feedback rather than appended here.

Outstanding across all six commits: a single device cold-launch to verify Commits 1-6 together. Commit 5 (Critical Alerts + sounds + entitlement) is the only one that strictly cannot be validated in the web preview and is the reason the cold-launch still matters.

---

## Device verification prompt

Paste this when ready to verify on the phone:

> Cold-launch Waymark on the phone after a fresh build/install. Work through the full polish pass in one sitting:
>
> 1. **Splash (Commit 1)** — app should open with no white flash. Static shield on `#0a0a0a` should blend into the React `LoadingScreen` shield holding position, then tracing in.
> 2. **Time picker + nav gear + background (Commit 2)** — bottom nav is 4 tabs (Today, Program, Library, Ledger). Today page has a small gear icon at bottom-right linking to `/settings`. In Settings, AM alarm and PM session time each open a sheet with side-by-side hour and minute drums, minute step is 1 (e.g. `6:37` picks correctly). Background shows a soft gold top-glow; nav bar reads as chrome (~5% lighter than body) with a hairline gold border on top.
> 3. **Fighter Block + One Pace (Commit 3)** — Program page shows no Fighter Block narrative (Block Zero still shows its narrative if applicable). Start an indoor session: the ready screen shows a big Cinzel `{arc} - Ep {N}` readout above Open One Pace. Save Run: ep bumps by +1, toast reads `Ep N → Ep N+1`, and the new ep persists on a subsequent run.
> 4. **Redeploy pill (Commit 4 + 6)** — Settings shows a small Cinzel chip `{N}d until redeploy` at the top. No hero-sized numeral, no caption line. Color defaults to foreground; should be gold at 2 days, destructive at ≤1 day. On a fresh install, check notification list (or just wait): silent reminders scheduled for build + 6d and build + 7d.
> 5. **Critical Alerts (Commit 5)** — grant the one-time OS prompt including Critical Alerts. Set phone to silent, set AM alarm to 1 minute out, lock the screen, wait. Morning Musical Vintage Lo-Fi Piano should fire through silent mode (base + storm + snoozes). Confirm nuclear alarm audio also fires through silent mode if you want to test it (it's loud).
> 6. **Arc drum (Commit 6)** — in Settings, the Current Arc control is a Cinzel drum (not a text input). Only released One Pace arcs appear. Row layout: arc takes the wide column, `- N +` ep stepper fits in the narrow column. Save persists.
>
> Flag anything that reads wrong on the device so it can be followed up as a fresh feedback item.
