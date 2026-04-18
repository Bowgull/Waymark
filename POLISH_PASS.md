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

---

## Next commit

**Commit 5: Critical Alerts + custom sounds + plugin patch**

Morning base + morning storm + nuclear follow-ups must bypass silent mode via the Critical Alerts entitlement with a bundled `.caf` sound. PM leave-by and round cues stay respecting silent mode.

**Blocker:** nuclear sound file not yet chosen. User is still sampling Pixabay options (search terms in section 8 of Locked decisions: `vinyl scratch short`, `low piano hit`, `wood block`, `tape rewind`, `monastery bell short`, `singing bowl strike`). Do not start this commit until the user confirms a file and drops the MP3 at a known path. Morning sound is already decided: Musical Vintage Lo-Fi Piano (pixabay.com/sound-effects/musical-vintage-lo-fi-piano-486284/).

**Plugin capability check (do this first, before any code):**
- Read `node_modules/@capacitor/local-notifications/package.json` for the installed version.
- Read `node_modules/@capacitor/local-notifications/dist/esm/definitions.d.ts` (or equivalent) and the native iOS source under `node_modules/@capacitor/local-notifications/ios/Plugin/` to confirm whether `interruptionLevel: 'critical'` and `criticalSound` / `criticalVolume` are supported by the current version.
- Report one of three paths before proceeding:
  - (a) Native support exists → use it directly.
  - (b) No support → patch the plugin via `patch-package` (add a dev dep if not present). Patch the JS definitions to accept the new fields and the Swift `LocalNotifications.swift` (or equivalent) to map them to `UNNotificationContent.interruptionLevel = .critical` and `UNNotificationSound.criticalSoundNamed(...)`.
  - (c) Patch too invasive → fall back to a minimal custom iOS plugin in `ios/App/App/Plugins/` that exposes `scheduleCritical({ id, title, body, at, soundName })`. Keep it small, single-purpose.

**Files to touch (modulo the plugin path):**
- `ios/App/App/App.entitlements`: add `<key>com.apple.developer.usernotifications.critical-alerts</key><true/>`.
- `ios/App/App/Sounds/` (create if absent): drop `morning.caf` and `nuclear.caf` (converted from the MP3s via `afconvert` to `.caf` with 48kHz 16-bit). Wire into Xcode project's Copy Bundle Resources phase via `ios/App/App.xcodeproj/project.pbxproj` if needed (Capacitor usually picks up Resources automatically, but verify).
- `src/lib/notifications.ts`:
  - Extend `requestNotificationPermission()` (or add a sibling) to request `criticalAlert: true` on iOS. The existing call already handles base notifications; add a one-time critical-alert request near app boot.
  - In `scheduleAlarms()`, flag the morning base, snooze trio, and all nuclear notifications with `interruptionLevel: 'critical'` and `sound: 'morning.caf'` / `sound: 'nuclear.caf'` (or the critical-sound field shape the plugin expects).
  - Consider trimming the nuclear count if total pending exceeds 64 (current: 1 morning + 3 snoozes + 20 nuclear + 1 PM + 2 redeploy + up to ~5 round cues ≈ 32 — plenty of room; spec allows up to 48 nuclear if desired, keep at 20 unless user asks).
- `src/app/AppRoutes.tsx`: at boot, after `initNotificationListeners()`, trigger the critical-alerts permission request if not yet granted. One-time OS prompt.
- `patches/@capacitor+local-notifications+*.patch` (if path b) and a `postinstall: patch-package` script in `package.json`.

**iOS entitlement flow:**
- `com.apple.developer.usernotifications.critical-alerts` is a restricted entitlement in normal Apple dev accounts, but the user is on a personal dev cert and can self-grant. Entitlement file change + Xcode signing flag is enough.

**Sound conversion:**
- `afconvert -f caff -d LEI16@48000 -c 1 input.mp3 output.caf` converts MP3 to Apple's preferred CAF format. Mono 48k/16-bit plays cleanly through the iPhone speaker at volume 0.6.
- `criticalSound.volume: 0.6` per spec. Users can still lower system critical-alert volume in Settings.

**Voice canon:**
- No new copy. Existing morning + nuclear strings stay. No em dashes anywhere.

**Done criteria:**
- [ ] Plugin path chosen (a/b/c) and reported before code.
- [ ] Nuclear sound file confirmed by user and bundled as `.caf`.
- [ ] Entitlement added; signing still succeeds on user's personal dev cert.
- [ ] `scheduleAlarms` marks morning + nuclear as critical with `morning.caf` / `nuclear.caf`.
- [ ] Runtime permission flow requests `criticalAlert: true` once; follow-up launches don't re-prompt.
- [ ] Build + lint: no new errors.
- [ ] Commit on main, voice-canon message.
- [ ] Device verification REQUIRED for this commit (the whole point is that it bypasses silent mode). User should cold-launch, grant the prompt, set phone to silent, set a 1-minute alarm, and confirm audio fires.
- [ ] `POLISH_PASS.md` updated: Commit 5 moved to Completed, Next commit section removed or replaced with a closing note.
- [ ] Next session prompt emitted (or a "polish pass complete" note if this is the final commit).
