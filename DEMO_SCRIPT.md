# Waymark Demo Walkthrough

**Target length:** 2-3 minutes, live talking over screen recording.
**Test phone** is already loaded with demo data (Block Zero, week 4 of 6).

This is a talking guide, not locked narration — use the bullets as cues and riff naturally.

---

## Before you hit record

1. Remote D1 is already seeded. The test iPhone is hitting `https://waymark.bocas-joshua.workers.dev`.
2. Open the app → you'll land on **Today** — Saturday, April 18.
3. Make sure you're on the **Today** tab. Confirm you see:
   - A completed morning mobility session ✓
   - A planned Bag Work session (~30 min) with prescribed rounds ready to go

If the streak or graphs look wrong, see **Re-seed** at the bottom.

---

## The story you're telling

> "I've been building this app for myself. It's a training journal for someone who lifts, does Muay Thai, and runs — and who's trying to cut back on vices without getting preachy about it. Four weeks into a six-week block. Let me show you."

That's the frame. Keep coming back to it.

---

## Shot 1 — Cold open: TODAY *(~30s)*

**What's on screen:** Today page, Morning Report + AM timeline.

**Say:**
- "This is Today. Saturday morning, week 4."
- "Up top is the Morning Report — sleep, herb, alcohol, soreness. I log this with one tap and it feeds every other screen."
- Tap **LOG** once to show the drum picker animation. *(If already logged for today, tap Sleep first to show the drum.)*
- "Below are today's sessions. Did a mobility round this morning — done. Later I've got bag work."
- Tap the **Bag Work** card.
- "The AI already built the round structure for me. Four rounds, two combos each, rationale per round — the coach voice that tells me why."

**Transition:** Swipe back, tap **PROGRAM** in the tab bar.

---

## Shot 2 — PROGRAM *(~25s)*

**What's on screen:** Program page, showing the 6-week Block Zero layout.

**Say:**
- "Every block is six weeks. This is Block Zero — the easing-in block before fighter blocks."
- "Week 4 is lit up. Each day has a session type already assigned: strength Mon and Thu, MT Tue and Fri, run Wed, bag Sat, recovery Sun."
- "If I miss one, it rolls forward automatically. If I'm wiped, it suggests a dial-back."

**Transition:** Tap **LEDGER** tab.

---

## Shot 3 — LEDGER: the history view *(~60s)*

**What's on screen:** Ledger page with completion ring, stats, and chart cards.

**Say:**
- "This is the Ledger — my history. Rings at the top show strength, conditioning, recovery for the month."
- "14-day streak. Seven PRs this month." *(point at the insight callout)*
- Scroll down through the mini-stats: Volume 12,938 lb, Sessions 6, Effort 6, Sleep 7.5h, Distance 4.3 km.
- Keep scrolling to the cards:
  - "**Consistency** — weekly session counts. You can see the dip week 2 — I'll come back to that."
  - "**Iron Log** — lift progression. Front squat, bench, row, deadlift all trending up."
  - "**Volume**, **Running** — same deal, everything graphed."

**Pause here — this is the emotional beat.** Tap **Body & Mind** card.

- "Here's the one that matters most to me."
- Tap **HERB** tab. *"Weed nights plotted against effort. You can see a cluster."*
- Tap **ALCOHOL** tab. *"Alcohol nights. That one high point — that was a bender on a Friday. Missed Saturday."*
- Tap **SLEEP** tab. *"And sleep vs effort. More sleep, better sessions. Obvious when you see it. Not obvious when you're just living."*
- "That's the whole point of this app. I log the thing, and the graph tells me the truth. Not the app telling me to stop. The pattern telling me."

**Transition:** Scroll back up, tap **LIBRARY** tab.

---

## Shot 4 — LIBRARY: the combo system *(~30s)*

**What's on screen:** Library / Combo page.

**Say:**
- "Combos are organized in five tiers."
- "Foundation is unlocked — basic boxing. Then Weapons adds kicks. Flow, Deception, Mastery get unlocked as I progress."
- "Every combo has form tips pinned to research. Not random flair — actual cues."
- Tap one. Show the detail. *"That's the Jab-Cross-Hook. 'Keep the hook tight at 90 degrees.' Same cue my coach gives."*

---

## Shot 5 — Close *(~15s)*

**Back to Today.**

**Say:**
- "Built with Cloudflare at the edge, runs offline, syncs with Strava for runs, gives me AI prescriptions per session, and tells me the truth about my vices without nagging."
- "Still rough in places. But it's mine, and I'm using it."

**Stop recording.**

---

## After recording — reset for real use

When you're ready to start using the app for real, wipe the demo data:

```bash
cd /Users/lindsaybell/Developer/Waymark
npm run db:demo:wipe:remote
```

That clears all sessions, logs, journals, blocks — but keeps the exercise library, combo library, training maxes, and settings intact. You're back to a fresh onboarding state.

Your pre-demo snapshot is saved at `.demo-backup/pre-demo-snapshot-*.sql` in case you ever need to restore the original empty state.

## Re-seed

If you need to re-generate the demo (e.g. after running it past a weekend so dates shift):

```bash
npm run db:demo:seed:generate    # regenerate SQL with fresh relative dates
npm run db:demo:wipe:remote      # clear remote user data
npm run db:demo:seed:remote      # apply fresh demo data
```

The generator always makes "today = Saturday of week 4" regardless of when you run it.
