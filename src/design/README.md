# Waymark design foundation

The split-flap look from the approved redesign
(`Documents/Aang/waymark-mockups/design-decisions.md`), ported from the
mockups (`shared/flap.css`, `wm.css`, `wm.js`, `session-icons.js`, `icon3d.js`,
pages 26, 35, 37, 38) into reusable code. Import from `@/design`.

## Files

| File | What it is |
|---|---|
| `design.css` | Tokens (`--sf-*` palette, `--session-*` colours, motion speeds/curves) and every `wm-*` class. Imported once by `src/index.css`. Reduce Motion rules at the bottom. |
| `tokens.ts` | The same colours and durations for JS (`FLAP`, `WAYMARK`, `SESSION_COLOURS`, `SORENESS_COLOURS`, `MOTION`, `TEXT_MIN`). |
| `flap.ts` | Pure split-flap rules: `flapCells` (never truncates; word gaps are clear; padding stays tiles), `flipFrames` (digits flip only through digits, the short way; letters through letters), `flapStaggerMs` (a label lands within 0.9 s), `fitFlapSize` / `flapWidth` (step a size down instead of cutting a label). |
| `FlapLabel.tsx` | `<FlapLabel text size tone len animate fit />`. Sizes `xs 14 · sm 17 · md 20 · lg 32 · xl 62` px. Tones `ink · gold · teal · clay · dim · struck`. Flips on change (or on mount with `animate="mount"`); writes glyphs straight to the tiles, so no re-render per frame. `fit` steps the size down to fit its container. |
| `components.tsx` | `Board` (glass + rivets, edges `good · bad · brass`), `CentredCard` (every selection sits centre-screen; no bottom sheets), `FlapButton` (primary = brass tiles, labels auto-fit), `FlapChip`, `FlapTile`, `TileChoice` (big one-tap tiles, `refused` = clay), `AmPmFlap` / `AmPmHeader` (teal AM / clay PM with a brass sun or moon; tap flips), `FlapSwitch` (ON teal / OFF), `FlapDrum` (▲ ▼ number on flap tiles), `SessionIcon`, `Crest`. |
| `popFlap.ts` + `PopFlapHost.tsx` | Pop-up flap message: a small board drops in from the top (teal edge good, clay failure) and lifts away; short words go on the flap, longer ones as plain words. `showPop(msg, tone)` from anywhere; the host is mounted once in `main.tsx`. `useToast()` (`components/ui/Toast.tsx`) now routes here, so every old toast is a flap pop-up. `glowRow(el, 'good' | 'bad')` makes the touched row answer; put `.wm-row-note` under it for the words on a failure. |
| `motion.ts` | `useReducedMotion()` / `prefersReducedMotion()`. |
| `sessionIconKeys.ts`, `sessionIcons.ts` | The icon set and `sessionIconFor(type, runCategory)` (Foundation = `mobility`, Reset = `active_recovery`, Zone 2 dial vs run shoe). |
| `assets/` | Pre-rendered session icons (192 px PNG each) and the crest (`crest-small.png`, crisp, for small marks; `crest-big.webp`, the glyph print, for big ones). |
| `DesignGallery.tsx` | Dev only (`/design?screen=…` under `npx vite`): every new screen with sample data, for screenshots. Not in a build. |

## Rules carried over (design-decisions.md)

- Readable minimums: prose 16, dim 15, labels 12, xs flaps 14, sm flaps 17, tags 11.
- No label truncates. A gap between words is a clear space, never a dark tile. List rows keep their padding tiles.
- Selection cards sit in the centre of the screen.
- Motion: calm, big moments. Four speeds (90 / 180 / 320 / 700 ms), ease-out arriving, linear only for timers. A flap runs once and lands within 0.9 s. Reduce Motion: flaps land at once, no drops or turns, crossfades only.
- Fonts: Cinzel (`font-display`, `font-cinzel`), Geist (`font-body`), JetBrains Mono (`font-mono`, the flap face). All three ship with the app through `@fontsource`, so the iPhone build needs no network. `--font-display` used to sit on `:root` only, so the `font-display` utility (14 uses) generated nothing and `font-cinzel` (79 uses) leaned on a stop-gap alias; all four families are real `@theme` entries now, and JetBrains Mono (used by every flap in the mockups) is bundled instead of falling back to the system mono.

## Why the icons and crest are images

The mockups model each icon in three.js (`icon3d.js`: extruded SVG, toon
material, glyph texture, one light rig) and render it to a PNG at run time.
In the iPhone web view that means shipping three.js (~600 KB), creating a
WebGL context and rendering eleven scenes on every cold start. The result
is a still picture anyway, so it is rendered once, ahead of time, at 192 px
(64 pt at 3x) and shipped as ~10–17 KB PNGs: no WebGL, no start-up cost,
instant decode, crisp at every size the app uses. The crest is the same
(small = no glyphs, crisp; big = the glyph print, WebP).

To re-render after a model or colour change: copy the mockups' `shared/`
folder next to `scripts/design/render-icons.html`, serve that folder over
http, open the page in a browser (headless Chrome with
`--dump-dom --virtual-time-budget=30000` works), and save the data URLs it
prints into `src/design/assets/` (names: `session-<key>.png`,
`crest-small.png`, `crest-big.webp`).

The animated crest moments (assembling on the splash, the taken-apart
loading crest, the close / PR moment) need the live 3D engine; they belong
to the world work (step 2).
