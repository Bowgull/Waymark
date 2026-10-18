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

import type { WorldPlace } from './worldStore'

export interface PlaceView {
  /** World x of the look point (the place's origin + its local look x). */
  x: number
  lookY: number
  lookZ: number
  camY: number
  /** Screen px per world unit (the mockup frustum over its canvas height). */
  pxPerUnit: number
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

export const PLACE_VIEWS: Readonly<Record<WorldPlace, PlaceView>> = {
  // page 14: frustum 11 on a 390×844 phone, lookY 2.2
  clearing: { x: PLACE_ORIGIN.clearing, lookY: 2.2, lookZ: 0, camY: 6.5, pxPerUnit: 844 / 11, anchor: 0.5, orbit: 0.12, near: 0.1 },
  // page 33: frustum 8 on a 390×400 band at the top of the screen, camY 11, lookY 0.6, lookZ -2.5
  road: { x: PLACE_ORIGIN.road, lookY: 0.6, lookZ: -2.5, camY: 11, pxPerUnit: 400 / 8, anchor: 200 / 844, orbit: 0.12, near: 0.1 },
  // page 14b: the arch down the clearing's path (lookX = the path at the arch), a little wider than the close-up;
  // what stands between the camera and the arch is clipped (near 20 = 2 units in front of it), like the close-up
  arch: { x: PLACE_ORIGIN.clearing + pathX(-7.4), lookY: 1.4, lookZ: -7.4, camY: 3.2, pxPerUnit: 844 / 9, anchor: 0.34, orbit: 0.04, near: 20 },
  // page 32: the pond filling the screen, camY 5.6, lookY 3.6, lookZ 7
  pond: { x: PLACE_ORIGIN.pond, lookY: 3.6, lookZ: 7, camY: 5.6, pxPerUnit: 844 / 11, anchor: 0.5, orbit: 0.12, near: 0.1 },
  // page 43: the hobbit home, frustum 7.5, lookY 1.3
  home: { x: PLACE_ORIGIN.home, lookY: 1.3, lookZ: 0, camY: 6.5, pxPerUnit: 844 / 7.5, anchor: 0.5, orbit: 0.12, near: 0.1 },
}

/** Which scene a place's view stands in (the arch is inside the clearing). */
export function sceneOf(place: WorldPlace): SceneKey {
  return place === 'arch' ? 'clearing' : place
}

/** The glyph size (world units) a scene is built with, so it prints at `glyphPx` at its own view. */
export function sceneGlyphWorld(scene: SceneKey, glyphPx = 9): number {
  return glyphPx / PLACE_VIEWS[scene].pxPerUnit
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

export const GLIDE_MS = 1100

/** The view part-way from a to b (k = eased 0..1). Zoom glides in log space so it feels even. */
export function mixView(a: PlaceView, b: PlaceView, k: number): PlaceView {
  const m = (p: number, q: number) => p + (q - p) * k
  return {
    x: m(a.x, b.x), lookY: m(a.lookY, b.lookY), lookZ: m(a.lookZ, b.lookZ), camY: m(a.camY, b.camY),
    pxPerUnit: Math.exp(m(Math.log(a.pxPerUnit), Math.log(b.pxPerUnit))),
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
