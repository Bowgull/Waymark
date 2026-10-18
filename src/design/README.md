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
| `popFlap.ts` + `PopFlapHost.tsx` | Pop-up flap message: a small board drops in from the top (teal edge good, clay failure) and lifts away; short words go on the flap (good news teal, a failure on plain tiles with the clay edge); a longer message gives its first sentence to the flap when it fits (COULDN'T SAVE) and keeps the rest as plain words. `showPop(msg, tone)` from anywhere; the host is mounted once in `main.tsx`. `useToast()` (`components/ui/Toast.tsx`) now routes here, so every old toast is a flap pop-up. `glowRow(el, 'good' | 'bad')` makes the touched row answer; put `.wm-row-note` under it for the words on a failure. |
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

The tab bar's place icons (`tab-lantern/waypost/arch/lilypond.png`, page 42 A)
are rendered the same way from `icon3d.js` (`iconImage(model, { col, set:
"#%=+:'" }, 'model', 96, { look: 'toon', tex: 'faint' })`); see `tabIcons.ts`.

## The world (step 2): `src/world/`

| File | What it is |
|---|---|
| `engine/` | The page-14 glyph engine ported to TypeScript on three.js 0.160 (`materials.ts` shaders, `masks.ts` door / rune masks, `build.ts` one place per approved mockup scene, `world.ts` the renderer / camera / frame budget, `crest.ts` + `crestStage.ts` the splash suit-up and the loading crest). Loaded only through `loadEngine.ts` (a dynamic import), so three.js is its own chunk. |
| `places.ts` | Pure: tab to place, each place's camera (from the mockup frustums), the glide, which scenes are in view. Scenes are built side by side along x: home −14, clearing 0 (the arch down its path), road 14, pond 28. Today is page 14's forest enlarged exactly as Today's mockups draw it (their `.stillbg`, `TODAY_ZOOM`); Library is page 14b's close-up (frustum 4.2). Each view has a glyph size: surfaces and glyph cards rescale with the zoom (`uScale`, `uK`), so the close-up never prints chunky glyphs. |
| `timeOfDay.ts`, `useWorldTime.ts` | Clock → misty / sun / night, and the Settings override (kept on the phone). |
| `worldStore.ts` | What screens tell the world: Today's rest-day home, the lantern (readiness), Program's weeks, offline (rain), the session entrance's blur, and a backdrop place for a screen with none of its own (the MT Class Log, page 31). Full-screen dark pages (`.wm-dark`) sit at z-index 1 above the world's fixed layer. |
| `WorldLayer.tsx` | The fixed canvas behind the shell. Pauses when hidden / backgrounded / on a screen with no world; Reduce Motion = one still frame per place with a quick dip between. |
| `Splash.tsx`, `CrestLoading.tsx` | Page 38 A splash on the mockup's own timeline (unlock 0.8 s, layers home from 2.4 s, eye 6.0 s, WAYMARK 6.8 s, Today fades up 9.0–9.7 s; no skip; `?nosplash` skips it for screenshots) and loading A (full screen on the dark, "Reading your profile."). |

Frame budget: 60 fps target; the engine steps down (DPR 2 → 1.5 → 30 fps → fewer grass glyphs) when frames run long and back up after 12 calm seconds. `window.__waymarkWorld.stats()` reports fps, CPU work per frame, p95 frame time, quality level and draw calls.
