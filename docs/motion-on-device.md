# Motion and speed: checking it on the iPhone (page 59, item 10)

The numbers in the motion work come from Playwright on Windows (WebKit with an
iPhone 15 profile, and Chromium at full speed and at 4x CPU). Windows WebKit
draws WebGL in software, so its frame rates say nothing about a real iPhone.
These steps confirm the work on the phone itself, with Safari's Web Inspector
on the Mac. About an hour.

## Set up (once)

1. iPhone: Settings > Apps > Safari > Advanced > Web Inspector: on.
2. Mac: Safari > Settings > Advanced > "Show features for web developers": on.
3. Build the motion branch onto the phone: `npm run ios:sync`, then run from
   Xcode (`npm run ios:open`) with the phone plugged in by USB. A Debug build
   is inspectable: Capacitor turns the web view's inspector on for debug builds
   by default (`ios.webContentsDebuggingEnabled`). If Waymark is missing from
   the Develop menu, set that option to true in capacitor.config.ts for the test.
4. Mac Safari > Develop > (the iPhone) > Waymark > the `localhost` page. The
   inspector opens on the app's web view.

## 1. The tab switch (items 1 to 4)

1. Inspector > Timelines. Turn on JavaScript & Events, Layout & Rendering,
   CPU and Screenshots. Press Record (the circle), or Cmd-Shift-R.
2. On the phone: Today, then tap Program, Library, Ledger, Today, twice round.
   Wait 2 s between taps.
3. Stop. For each switch, in the Layout & Rendering lane:
   - "Styles Recalculated" should be small (a few ms) and not repeat in a
     comb through the switch. The old build showed hundreds, each restyling the
     whole page (the `body:has()` rule).
   - No "Forced Layout" or "Forced Style" warnings under the flap timers.
4. In the Frames view (the bar chart at the top of Timelines): frames through
   the switch should sit under the 16.7 ms line (WKWebView runs at 60 Hz). Note
   any over 33 ms and what they are.
5. Expected by eye: the boards sink, the forest glides (0.9 s), the boards rise
   from about 0.56 s, each label flips twice, everything still by about 1.3 s.
   Coming back to a tab shows its boards at once; no "Reading the plan."

## 2. The forest stays sharp (item 6)

1. Inspector > Console, type `__waymarkWorld.stats()` and Enter on Today
   before the switches, and again after the round of switches above.
2. `quality` should stay 0 and `dpr` 2 (or the phone's own ratio). The old
   build stepped down to 2 or 3 after a few switches and stayed there 12 s.
3. On Program: the road's wayposts should be there as the camera lands, with
   no hitch on landing (the road is built while you are still on Today).

## 3. The board blur (open question from the research)

The boards' `backdrop-filter` costs nothing on the main thread, but its GPU
cost on an iPhone is unknown.

1. Timelines > record 10 s on Program, still, then on Today, still. Note the
   fps.
2. Console: `document.querySelectorAll('.wm-board').forEach(b => b.style.backdropFilter = b.style.webkitBackdropFilter = 'none')`
3. Record again. If fps rises by more than a few frames, tell the coach; the
   blur can be dropped under Reduce Transparency or on older phones.

## 4. First load and the splash (item 9)

1. Quit the app (swipe it away) and open it. The splash plays.
2. One tap: the crest jumps to the title screen (whole and lit, WAYMARK under
   it), then lifts as usual: the app in under 3 s.
3. Quit, open, and hold a finger on the splash: straight into the app.
4. Without touching: the splash runs its 10 s as before, and Today's boards
   rise into it as it lifts.
5. Timelines during a cold open: the main thread's longest tasks (the world's
   first build) should be under about 600 ms; note the time to Today's boards.

## 5. Shader compiles

Timelines > Rendering: on the first open of each place, look for long "Program
Link" or compile gaps. Windows showed 3 or 4 links under 3 ms; iOS compiles
differently. Anything over 50 ms on the first glide to a place is worth
noting.

## 6. The small motions and haptics (items 7 and 8)

By hand, with Settings > Haptics on, then off:

- Today: a row opens and closes, the rows below glide (no jump); SKIP draws a
  clay line left to right, then the name dims; a REPLACE strikes the old row,
  collapses it and opens the new one.
- The Waybook line grows into its box.
- The check-in cards slide left as you answer and right on Back; a light tick
  on each answer.
- A tap on another tab: one selection tick. A strike and a swap landing: a
  light one. Never a buzz per letter.
- With Haptics off: nothing at all.

## 7. Reduce Motion

iPhone: Settings > Accessibility > Motion > Reduce Motion on. Then: the world
dips to dark between places, the boards crossfade, letters land at once (a
change fades in 90 ms), rows open at once with a short fade, no strike
drawing. A hold still skips the splash.

## What to send back

The fps per switch (or a screenshot of the Frames view), `stats()` before and
after, the blur on/off fps, and anything that stutters, with which tab.
