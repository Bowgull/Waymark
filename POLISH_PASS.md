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

---

## Next commit

**Commit 3: Fighter Block removal + One Piece display + ep bump + toast**

Program page cleanup plus indoor-ready surface for Run Session, plus auto-increment of the One Pace episode on indoor run save.

**Files to touch:**
- `src/features/program/ProgramPage.tsx` (delete Fighter Block narrative)
- `src/features/session/RunSessionView.tsx` (big `{arc} — Ep {ep}` readout on indoor ready screen; auto-bump on save)
- `src/features/settings/SettingsPage.tsx` (+/- stepper next to Episode field)
- Possibly `src/server/app.ts` if the `/api/settings` PATCH doesn't yet accept numeric incr — grep first; current payload already writes `onePaceEp` as string so a client-side `String(Number(ep)+1)` should work without server change.

**Fighter Block removal (ProgramPage.tsx):**
- Delete `getFighterBlockNarrative()` function entirely.
- Delete the JSX render site(s) that call it (likely a conditional block guarded on `programBlock !== 'block_zero'` or similar).
- Keep `getBlockZeroNarrative()` and the Block Zero render path.
- Post-Block-Zero, the Program page simply renders no block narrative. That's intentional. Do not substitute a placeholder.
- Grep the file first for `FighterBlock` / `fighter_block` / `getFighterBlockNarrative` to catch all call sites and any imports.

**One Piece ready screen (RunSessionView.tsx):**
- Locate the `phase === 'ready'` branch.
- Scope: only when `isIndoor === true` (grep for how indoor is derived — likely a `sessionType` or `runCategory` check).
- Above the existing "Open One Pace" button, render the current arc + episode in a big Cinzel readout: `{arc} — Ep {ep}`. Use `var(--font-display)` (not the character), class `text-display-lg` or `text-display` (confirm which reads better against the ready-screen layout; `text-display-lg` is 2.25rem).
- Read `onePaceArc` / `onePaceEp` from settings. If `runSession` already carries them, prefer that. Otherwise fetch from `/api/settings` on mount or use an existing context.
- NO EM DASHES. Use a regular hyphen or the word "Ep". Verify copy matches voice canon: short, plain. Example: `Water 7 — Ep 3` → rewrite as `Water 7  Ep 3` or `Water 7 / Ep 3`. Pick one, stay consistent.

**Auto-bump on save (RunSessionView.tsx + useToast):**
- On indoor Save Run handler, after the save API call succeeds:
  1. Compute `newEp = String(Number(onePaceEp ?? '0') + 1)`.
  2. PATCH `/api/settings` with `{ onePaceEp: newEp }`.
  3. Show toast via existing `useToast` hook: `"Ep {old} → Ep {new}"`. Keep under voice canon; no exclamation.
- If PATCH fails: silent, do not block save. Log to console.
- Guard: if `onePaceEp` is null/empty, skip the bump.

**Settings stepper (SettingsPage.tsx):**
- In the existing One Pace section, next to the Episode `<input>`, add `-` and `+` buttons that decrement / increment the numeric value.
- Clamp at 0 minimum. No max.
- Buttons: `min-h-[44px]`, small square, use existing `bg-border text-muted-foreground active:bg-muted` style. Place them inline with the input (flex row, input flex-1 + two buttons).
- Value persists on Save like the rest of the form.

**Done criteria:**
- [ ] `getFighterBlockNarrative` deleted; grep returns zero references in `src/`
- [ ] Post-Block-Zero users see no block narrative on Program page, no crash
- [ ] Indoor run ready screen shows Cinzel `{arc}  Ep {ep}` above Open One Pace button
- [ ] Saving an indoor run bumps `onePaceEp` by 1 on the server and shows `Ep {old} → Ep {new}` toast
- [ ] Settings Episode field has - / + stepper; disabled/clamped at 0
- [ ] Build + lint: no new errors
- [ ] Commit on main, voice-canon message
- [ ] `POLISH_PASS.md`: move Commit 3 to Completed, advance Next commit to Commit 4 (Redeploy countdown) with file-level detail
- [ ] Next session prompt emitted at end of final message
