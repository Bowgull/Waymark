# Ideas for the Waymark revamp (October 2026)

Notes gathered while working on another project, to look at when Waymark gets picked back up. Nothing here is
decided. Every idea gets a mockup before anything is built.

## 1. ASCII art, in Waymark green

**The inspiration:** a solo dev (Ansenjeo / Senje) is building an ASCII MMORPG: a dark fantasy world drawn
entirely in text characters, with grass that bends as players walk through it, stone castles and lamp light.
- TikTok: https://vt.tiktok.com/ZSgjhW7S6/ ("Making the ASCII MMORPG of my dreams! Grass collision")
- The dev's channel (Steam page "coming"): https://www.youtube.com/channel/UCs6p0xLf-WckOCsAeN12xiA
- How it's made (per an observer): a normal 3D game whose frames are converted to text characters by a shader.
  https://x.com/STGshmups/status/2109472358964637781
- A similar open-source project to study: Blackwater, a Godot ASCII RPG with glyph grass, wind and water
  reflections. https://github.com/AndreaZero/ascii-mmorpg-game

**Why it might fit Waymark:** the deep forest / forest / teal palette is already close to that game's look.
Places it could make sense (to be mocked up, not decided):
- empty states (no session logged, rest day)
- a round or interval timer drawn as grass bending in the wind
- the splash / loading screen
- offline or error screens
- small ASCII touches in the coach's messages

**Starting code:** `docs/ideas/ascii/ascii.js` is a tiny renderer (each scene is a light field turned into
characters, with a `waymark` colour style taken from `src/index.css`). `docs/ideas/ascii/demo.html` shows four
scenes moving. Run it with `npx serve docs/ideas/ascii`.

## 2. "20 Claude animation styles"

TikTok (jesseeisenbart): https://vt.tiktok.com/ZSgjUb1qa/ shows 20 styles Claude can animate:
particles, liquid morph, neon glow, Y2K chrome, kinetic type, paper cutout, holographic, isometric, ASCII art,
clay 3D, retro VHS, comic book, split flap, hand drawn, blueprint, physics, pixel art, Bauhaus, art deco,
neo-brutalism.

Ones worth trying for a training app:
- **Kinetic type**: rep counts, round numbers and timers that move with the work.
- **Split flap**: the week's plan or the day's session flipping in, like a station board.
- **Physics**: logged sessions dropping into the week like weights; streaks stacking.
- **ASCII art**: see section 1.
- **Blueprint**: the training block / program view as a plan drawing.
- **Particles**: a finished session or PR celebration (short, rare).
Skip: Y2K chrome, holographic, comic book, Bauhaus, art deco (off-brand for Waymark).

## 3. "Go big": how to ask Claude for more ambitious work

From a TikTok (chase_ai_, https://vt.tiktok.com/ZSgjaWLce/) about a post by a lead Claude engineer. Ambition has
four knobs: speed, altitude, depth and range. Append this to big prompts:
1. What would a top professional in this field do that I'm not asking for?
2. What is the rawest material they would start from, instead of something already digested?
3. Which specific methods and tools would that expert use?
4. What, other than you or me, would show the result is right?
Then rewrite the prompt to ask for exactly that.

For Waymark, the experts are: a sports-medicine doctor, a strength and conditioning coach, a muay thai kru, a
sports-app product designer, and an app architect.

## 4. Going big on Waymark

**Training science.** Already in the prompts: periodization, deloads, RPE, zone 2, the muay thai protection rule
(`src/lib/prompts/system.ts`). Worth adding:
- session RPE x minutes as a tracked weekly load number
- readiness (sleep, soreness, HRV if available)
- muay thai injury prevention: shin conditioning, wrists and hands, neck strength for the clinch
- a cap on how fast running mileage grows
- citing real sources (ACSM, NSCA position stands, peer-reviewed papers) rather than appeals to authority
- proof it works: his own logs (load steady, niggles trending down), and a coach's review of a generated week

**Front end.** The style guide exists (`docs/style-guide/`). Worth adding: written motion rules, a component
inventory, and gym-proof UX (big targets for sweaty hands, logging a round in two seconds, readable between
rounds, one-handed).

**Back end.** Worth adding: an auth design, offline-first logging that syncs later (the gym has bad signal), an
API contract, and tracked migrations (only 2 of 22 are in Drizzle's journal).

## 5. What changed since April

- **Claude models:** Opus 5.5, Sonnet 5.5 and Haiku 5.5 are current. Moving off Sonnet 4.6 / Haiku 4.5 is more
  than renaming: forced `tool_choice` and `budget_tokens` thinking need changes (check the Claude API docs).
- **Dependencies:** Vite 8, ESLint 10 and TypeScript 7 are out (majors); Capacitor 8.5, wrangler and React have
  minor updates.
- **Building for iPhone:** the Mac that will build it needs a current Xcode. A GitHub Actions macOS runner (free
  for public repos) can build it, then a free sideloading tool installs it.
