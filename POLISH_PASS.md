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

---

## Next commit

**Commit 4: Redeploy countdown**

Sideload-cert apps go dark after 7 days. Give the user a passive countdown in Settings + 2 silent notifications so they remember to plug in and redeploy before it expires.

**Files to touch:**
- `vite.config.ts` (inject `VITE_BUILD_TIME` via `define`)
- `src/features/settings/SettingsPage.tsx` (countdown pill at top of page)
- `src/lib/notifications.ts` (reserve IDs 5000/5001; add `scheduleRedeployReminders(buildTime)` function with silent notifications; add cancel helper)
- `src/App.tsx` or `src/main.tsx` (on launch: compare `VITE_BUILD_TIME` to `localStorage.lastSeenBuildTime`; if changed → cancel old, schedule new, save)

**Build-time injection (vite.config.ts):**
- Add to `defineConfig`: `define: { 'import.meta.env.VITE_BUILD_TIME': JSON.stringify(Date.now()) }`.
- Confirm this doesn't collide with existing `define` entries; current config has none (grep first).
- Add type declaration for `VITE_BUILD_TIME` in `src/vite-env.d.ts` so TS accepts `import.meta.env.VITE_BUILD_TIME` as `string`.

**Settings pill (SettingsPage.tsx):**
- Above the first section (MT Class Days), render a small non-interactive pill/card:
  - Read `import.meta.env.VITE_BUILD_TIME` (string → Number).
  - Compute `daysLeft = 7 - Math.floor((Date.now() - buildTime) / 86400000)`. Clamp min to 0.
  - Big Cinzel number (e.g. `text-display-lg font-[family-name:var(--font-display)]`), tiny caption below: `DAYS UNTIL REDEPLOY` (text-label, tracking-wider, muted-foreground).
  - Color tiers: default foreground at `daysLeft >= 3`, `text-gold` at `daysLeft === 2`, `text-destructive` (or equivalent red) at `daysLeft <= 1`.
  - Not tappable, no interaction.

**Launch-time reschedule (App.tsx / main.tsx — check which owns app-boot side effects):**
- In a `useEffect(() => { ... }, [])` on app mount (or module-level if simpler):
  1. Read `buildTime = Number(import.meta.env.VITE_BUILD_TIME)`.
  2. Read `lastSeen = localStorage.getItem('lastSeenBuildTime')`.
  3. If `String(buildTime) !== lastSeen`:
     - Call `notifications.cancel({ notifications: [{ id: 5000 }, { id: 5001 }] })` (wrapped in try/catch; plugin may 404 if nothing scheduled).
     - Call `scheduleRedeployReminders(buildTime)`.
     - Write `localStorage.setItem('lastSeenBuildTime', String(buildTime))`.
- Skip entirely when `!Capacitor.isNativePlatform()` (web dev should not schedule native notifs).

**notifications.ts additions:**
- At the top of the file, add a comment block reserving IDs 1000-1012 (morning storm + snoozes), 2000-2047 (nuclear), 3000 (PM leave-by), 5000/5001 (redeploy). Keeps ID allocation visible.
- Export `scheduleRedeployReminders(buildTime: number)`:
  - ID 5000, trigger `buildTime + 6 * 86400000`, title `"Redeploy tomorrow or the app goes dark."`, body empty (or repeat title).
  - ID 5001, trigger `buildTime + 7 * 86400000`, title `"Redeploy today. Connect cable."`, body empty.
  - Both notifications: `sound: undefined` and no `critical*` fields. They must respect silent mode. No `interruptionLevel` needed (defaults to time-sensitive off).
- Export `cancelRedeployReminders()` for use at launch-time and when we wire the settings toggle later.

**Voice canon:**
- Pill caption: `DAYS UNTIL REDEPLOY` (no period, all-caps label style).
- Notification copy per spec. No em dashes.

**Done criteria:**
- [ ] `VITE_BUILD_TIME` injected at build time, readable in renderer, typed in `vite-env.d.ts`.
- [ ] Settings page shows countdown pill at top with correct day math + color tier, non-interactive.
- [ ] On native app cold-launch after a new build, old 5000/5001 notifications cancelled and new ones scheduled; `lastSeenBuildTime` updated.
- [ ] Notifications have no sound field and do not bypass silent mode.
- [ ] Web build path still works (pill renders; no native plugin calls fire).
- [ ] Build + lint: no new errors.
- [ ] Commit on main, voice-canon message.
- [ ] `POLISH_PASS.md`: move Commit 4 to Completed, advance Next commit to Commit 5 (Critical Alerts + sounds + plugin patch) with file-level detail.
- [ ] Next session prompt emitted at end of final message.
