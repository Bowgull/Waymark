// Where each tab sits in the one world, and how the camera frames it (pure;
// no three.js, so it runs under node in the tests).
//
// Each place is the approved mockup scene, built at its own spot along x so
// every view keeps its approved composition, joined by one forest floor:
//
//   home (-14) · clearing (0, with the rune arch down its path) · road (14) · pond (28)
//
// Framing numbers come from the mockup pages: Today page 14, Program page 33
// (a 390×400 road band), Library page 14b (the arch), Ledger page 32, rest day
// page 43. `pxPerUnit` keeps the mockups' glyph size (9 px) on any phone height.

import type { WorldMode } from './timeOfDay'
import type { WorldPlace } from './worldStore'

export interface PlaceView {
  /** World x of the look point (the place's origin + its local look x). */
  x: number
  lookY: number
  lookZ: number
  camY: number
  /** Screen px per world unit (the mockup frustum over its canvas height). */
  pxPerUnit: number
  /** The px a glyph prints at in this view (9, or larger where a mockup shows the world enlarged). */
  glyph: number
  /** Where the look point sits on screen, as a fraction from the top. */
  anchor: number
  /** How far the camera sways (the game's slow orbit). */
  orbit: number
  /**
   * The near clip, as distance from the camera (it sits 22 units back). The arch
   * view clips what stands between the camera and the arch, as if walking up
   * the path past the clearing's oaks; 0.1 elsewhere.
   */
  near: number
}

/** The build spot (x) of each scene. The arch lives inside the clearing's scene. */
export const PLACE_ORIGIN = { home: -14, clearing: 0, road: 14, pond: 28 } as const
export type SceneKey = keyof typeof PLACE_ORIGIN

const pathX = (z: number) => 0.25 + Math.sin(z * 0.42) * 0.75

/**
 * Today's mockups (pages 20, 35, 36, 42) put the page-14 forest behind the UI as a still
 * (flap.css .stillbg: a 920×1800 capture of the page-14 phone, its screen 780 px wide with
 * 70 px each side, drawn at 150% of the phone's width, centred, 42% down). That is the
 * page-14 view enlarged by TODAY_ZOOM, its look point 410.4 px down: glyphs print larger too.
 */
export const TODAY_ZOOM = (585 / 920) * 2
const TODAY_LOOK_Y_PX = (844 - 1800 * (585 / 920)) * 0.42 + 422 * TODAY_ZOOM

export const PLACE_VIEWS: Readonly<Record<WorldPlace, PlaceView>> = {
  // page 14's world (frustum 11, lookY 2.2) as Today's mockups show it: enlarged by TODAY_ZOOM, look point 410 px down
  clearing: { x: PLACE_ORIGIN.clearing, lookY: 2.2, lookZ: 0, camY: 6.5, pxPerUnit: (844 / 11) * TODAY_ZOOM, glyph: 9 * TODAY_ZOOM, anchor: TODAY_LOOK_Y_PX / 844, orbit: 0.12, near: 0.1 },
  // page 33: frustum 8 on a 390×400 render, drawn as the road band (46% of the phone, cover: 6 px off its top)
  road: { x: PLACE_ORIGIN.road, lookY: 0.6, lookZ: -2.5, camY: 11, pxPerUnit: 400 / 8, glyph: 9, anchor: (200 - 6) / 844, orbit: 0.12, near: 0.1 },
  // page 14b, exactly: the close-up of the arch down the clearing's path (frustum 4.2 on the phone, lookX = the
  // path at the arch, lookY 1.4, lookZ -7.4, camY 3.2, orbit 0.04). Glyphs keep their 9 px at this zoom (world.ts).
  arch: { x: PLACE_ORIGIN.clearing + pathX(-7.4), lookY: 1.4, lookZ: -7.4, camY: 3.2, pxPerUnit: 844 / 4.2, glyph: 9, anchor: 0.5, orbit: 0.04, near: 0.1 },
  // page 32: the pond filling the screen, camY 5.6, lookY 3.6, lookZ 7
  pond: { x: PLACE_ORIGIN.pond, lookY: 3.6, lookZ: 7, camY: 5.6, pxPerUnit: 844 / 11, glyph: 9, anchor: 0.5, orbit: 0.12, near: 0.1 },
  // page 43: the hobbit home, frustum 7.5, lookY 1.3
  home: { x: PLACE_ORIGIN.home, lookY: 1.3, lookZ: 0, camY: 6.5, pxPerUnit: 844 / 7.5, glyph: 9, anchor: 0.5, orbit: 0.12, near: 0.1 },
}

/** Which scene a place's view stands in (the arch is inside the clearing). */
export function sceneOf(place: WorldPlace): SceneKey {
  return place === 'arch' ? 'clearing' : place
}

/** The glyph size (world units) a scene is built with, so it prints at its own view's glyph size. */
export function sceneGlyphWorld(scene: SceneKey): number {
  const v = PLACE_VIEWS[scene]
  return v.glyph / v.pxPerUnit
}

/** The glyph size (world units) for a view: what surfaces print at, and what glyph cards scale to. */
export function viewGlyphWorld(view: PlaceView): number {
  return view.glyph / view.pxPerUnit
}

/** The lamp each scene lights with (world coords): THE lantern, or the hobbit home's door light. */
export function sceneLamp(scene: SceneKey): [number, number, number] {
  const ox = PLACE_ORIGIN[scene]
  if (scene === 'home') return [ox + pathX(-1.75), 0.9, -1.75 + 0.9]
  return [ox + 1.58, 1.05, 1.9]
}

/** Tab routes to places. Settings and the rest have no world (null). */
export function placeForPath(pathname: string): WorldPlace | null {
  if (pathname === '/' || pathname.startsWith('/today')) return 'clearing'
  if (pathname.startsWith('/program')) return 'road'
  if (pathname.startsWith('/library')) return 'arch'
  if (pathname.startsWith('/history')) return 'pond'
  return null
}

/** Ease in-out (cubic) for the camera glide. */
export function glideEase(t: number): number {
  const x = Math.max(0, Math.min(1, t))
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}

/** The camera's glide between places (page 59 §5.1: was 1100 ms). */
export const GLIDE_MS = 900

/** The view part-way from a to b (k = eased 0..1). Zoom glides in log space so it feels even. */
export function mixView(a: PlaceView, b: PlaceView, k: number): PlaceView {
  const m = (p: number, q: number) => p + (q - p) * k
  return {
    x: m(a.x, b.x), lookY: m(a.lookY, b.lookY), lookZ: m(a.lookZ, b.lookZ), camY: m(a.camY, b.camY),
    pxPerUnit: Math.exp(m(Math.log(a.pxPerUnit), Math.log(b.pxPerUnit))), glyph: m(a.glyph, b.glyph),
    anchor: m(a.anchor, b.anchor), orbit: m(a.orbit, b.orbit), near: m(a.near, b.near),
  }
}

/** The camera frustum (left, right, top, bottom in world units) for a view on a canvas of w×h css px. */
export function frustumFor(view: PlaceView, w: number, h: number): { left: number; right: number; top: number; bottom: number } {
  const fh = h / view.pxPerUnit, fw = w / view.pxPerUnit
  return { left: -fw / 2, right: fw / 2, top: view.anchor * fh, bottom: -(1 - view.anchor) * fh }
}

/** Scenes the camera can see from this view (with a margin), so the rest can be skipped. */
export function scenesInView(view: PlaceView, w: number): SceneKey[] {
  const half = w / view.pxPerUnit / 2 + 8
  return (Object.keys(PLACE_ORIGIN) as SceneKey[]).filter(k => Math.abs(PLACE_ORIGIN[k] - view.x) < half + 1)
}

/** The lantern's strength for the readiness value (0..1): dimmed down to 0.45 by day, at least page 14's at night. */
export function lampK(mode: WorldMode, lantern: number): number {
  const k = 0.45 + 0.55 * Math.max(0, Math.min(1, lantern))
  return mode === 'night' ? Math.max(1, k) : k
}
