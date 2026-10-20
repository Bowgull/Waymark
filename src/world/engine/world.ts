// The world engine: one canvas, one renderer, one camera gliding between the
// places (places.ts). Runs on its own frame budget:
//   - 60 fps target; adaptive quality steps down (pixel ratio, then 30 fps, then
//     fewer grass glyphs) when frames run long, and back up when there's room
//   - stops completely when paused (app hidden / backgrounded / a screen with no world)
//   - Reduce Motion: no loop at all; one still frame per view, redrawn on change
// Loaded lazily (its own chunk with three.js); see WorldLayer.tsx.

import * as THREE from 'three'

import { buildScene, POND, type BuiltScene, type SceneKind } from './build'
import { cardMaterial, gi, glyphAtlas, makeShared, skyMaterial, surfaceMaterial, type SharedUniforms } from './materials'
import { GLIDE_MS, PLACE_ORIGIN, PLACE_VIEWS, frustumFor, glideEase, lampK, mixView, sceneLamp, sceneOf, scenesInView, sceneGlyphWorld, viewGlyphWorld, type PlaceView, type SceneKey } from '../places'
import { pondLook, weeksOrDefault, type WeekPost, type WorldPlace } from '../worldStore'
import type { WorldMode } from '../timeOfDay'
import { NO_WEATHER, weatherParams, type WorldWeather } from '../weather'
import { createWeather, type ModeBase } from './weather'
import { motionBusy } from '../../design/busy'

const GLYPH_PX = 9

export interface WorldInit {
  place: WorldPlace
  mode: WorldMode
  weeks: WeekPost[] | null
  lantern: number
  offline: boolean
  reducedMotion: boolean
  /** The injury weather (page 58). */
  weather?: WorldWeather
  /** How far the canvas runs below the screen, in css px (page 67's parallax room); the camera frames the screen above it. */
  overscan?: number
}

export interface WorldStats {
  fps: number
  /** Mean CPU time spent building + submitting a frame (ms). */
  workMs: number
  /** 95th-percentile time between frames (ms). */
  p95FrameMs: number
  quality: number
  dpr: number
  /** The frame-rate cap while the boards cover the scene (page 67: 15), or null. */
  cap: number | null
  drawCalls: number
  built: SceneKey[]
  firstFrameMs: number
  /** The injury weather's knobs now (page 58) and the shoots' growth. */
  weather: { p: Record<string, number>; grow: number }
}

export interface WorldHandle {
  setPlace(place: WorldPlace, instant?: boolean): void
  setMode(mode: WorldMode): void
  setWeeks(weeks: WeekPost[] | null): void
  setLantern(k: number): void
  /** The Ledger: how the week has gone (0..1, 0.5 neutral): brighter water and more fireflies. */
  setPond(k: number): void
  setOffline(offline: boolean): void
  /** The injury weather over the whole world (page 58): green rain, downpour, storm, the quieter fall, the clearing. */
  setWeather(weather: WorldWeather): void
  setReducedMotion(reduced: boolean): void
  /** Page 67: the boards cover the scene fully; the world idles at 15 fps until they don't. */
  setCovered(covered: boolean): void
  pause(): void
  resume(): void
  resize(): void
  stats(): WorldStats
  dispose(): void
}

/** The world's idle rate while the boards cover it (page 67 item 9; world-and-ui-plan). */
export const COVERED_FPS = 15

// Quality ladder: start crisp; step down when frames run long.
const LEVELS = [
  { dpr: 2, fps: 60, density: 1 },
  { dpr: 1.5, fps: 60, density: 1 },
  { dpr: 1.5, fps: 30, density: 1 },
  { dpr: 1.15, fps: 30, density: 0.55 },
] as const

const MODES: Record<WorldMode, { clear: string; moon: string; dir: [number, number, number]; moonK: number; fog: string; lamp: number; beams: number; smoke: number; spill: number; flies: boolean; fogNear: number; fogFar: number; fogCol?: string; sky: number }> = {
  misty: { clear: '#56685f', moon: '#d0e0d6', dir: [-0.2, 0.8, 0.5], moonK: 1.35, fog: '#5a6c63', lamp: 0.35, beams: 0.25, smoke: 0.7, spill: 0.65, flies: true, fogNear: 17, fogFar: 38, sky: 3 },
  sun: { clear: '#1b2614', moon: '#ffe0a0', dir: [0.5, 0.75, 0.45], moonK: 1.6, fog: '#2a3a1c', lamp: 0.25, beams: 1.0, smoke: 0.35, spill: 0.3, flies: false, fogNear: 16, fogFar: 44, fogCol: '#5e5830', sky: 1 },
  night: { clear: '#020a08', moon: '#8fb8c8', dir: [-0.35, 0.6, 0.75], moonK: 1, fog: '#041510', lamp: 1, beams: 0.35, smoke: 1, spill: 1, flies: true, fogNear: 16, fogFar: 42, fogCol: '#0b1e26', sky: 2 },
}

export async function createWorld(canvas: HTMLCanvasElement, init: WorldInit): Promise<WorldHandle> {
  const t0 = performance.now()
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false })
  let level = 0
  const devDpr = () => Math.min(window.devicePixelRatio || 1, 3)
  const levelDpr = () => Math.min(devDpr(), LEVELS[level].dpr)
  renderer.setPixelRatio(levelDpr())
  let W = Math.max(1, canvas.clientWidth), H = Math.max(1, canvas.clientHeight)
  renderer.setSize(W, H, false)
  const overscan = Math.max(0, init.overscan ?? 0)
  const screenH = () => Math.max(1, H - overscan)
  // page 67: covered by the boards, the frame budget drops to the idle rate (nobody can tell under the veil)
  let cap: number | null = null
  const fpsNow = () => (cap == null ? LEVELS[level].fps : Math.min(cap, LEVELS[level].fps))

  const shared: SharedUniforms = makeShared(await glyphAtlas(), 1.6)
  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200)

  const sky = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), skyMaterial(shared, GLYPH_PX * renderer.getPixelRatio()))
  sky.frustumCulled = false; sky.renderOrder = -10; scene.add(sky)
  const skyU = (sky.material as THREE.ShaderMaterial).uniforms
  let skyGlyph = GLYPH_PX
  const syncSky = () => { const v = new THREE.Vector2(); renderer.getDrawingBufferSize(v); skyU.uRes.value.copy(v); skyU.uGp.value = skyGlyph * renderer.getPixelRatio() }
  syncSky()

  // one forest floor under every place, with the pond's hole cut out
  const groundMat = surfaceMaterial(shared, { set: 'soil', color: '#34502e', fill: 0.3, scale: sceneGlyphWorld('clearing') })
  {
    const px = PLACE_ORIGIN.pond + POND.PX
    const sh = new THREE.Shape([new THREE.Vector2(-60, -58), new THREE.Vector2(70, -58), new THREE.Vector2(70, 22), new THREE.Vector2(-60, 22)])
    const hole = new THREE.Path(); hole.absellipse(px, -POND.PZ, POND.RX * 0.99, POND.RZ * 0.99, 0, Math.PI * 2, true); sh.holes.push(hole)
    const ground = new THREE.Mesh(new THREE.ShapeGeometry(sh, 64), groundMat); ground.rotation.x = -Math.PI / 2; ground.frustumCulled = false; scene.add(ground)
  }

  // rain (offline): '|' glyphs falling around wherever the camera looks
  const rainGw = sceneGlyphWorld('clearing')
  const rainMat = cardMaterial(shared, { w: rainGw * 0.62, h: rainGw * 1.4, fall: 7.5, sway: 0 })
  const rain = (() => {
    // 520 for the offline rain; the green rain's downpour and storm use up to 1000 (page 58)
    const N = 1000, g = new THREE.PlaneGeometry(1, 1)
    const mesh = new THREE.InstancedMesh(g, rainMat, N)
    const aG = new Float32Array(N), aP = new Float32Array(N), aT = new Float32Array(N * 3), m4 = new THREE.Matrix4()
    const r = (i: number, k: number) => { const s = Math.sin(i * 91.7 + k * 47.3) * 43758.5453; return s - Math.floor(s) }
    for (let i = 0; i < N; i++) { m4.makeTranslation((r(i, 1) - 0.5) * 9, 7.5 + r(i, 2) * 0.5, (r(i, 3) - 0.6) * 18); mesh.setMatrixAt(i, m4); aG[i] = gi('|')[0]; aP[i] = r(i, 4); const k = 0.55 + r(i, 5) * 0.3; aT.set([0.62 * k, 0.74 * k, 0.82 * k], i * 3) }
    g.setAttribute('aGlyph', new THREE.InstancedBufferAttribute(aG, 1)); g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(aP, 1)); g.setAttribute('aTint', new THREE.InstancedBufferAttribute(aT, 3)); g.setAttribute('aOff', new THREE.InstancedBufferAttribute(new Float32Array(N * 2), 2))
    mesh.frustumCulled = false; mesh.visible = false; scene.add(mesh)
    return mesh
  })()

  // the injury weather (page 58): the grade, the green rain on the offline rain's cards, puddles, moss, storm, the clearing
  const weather = createWeather(scene, shared, rainGw, rain, rainMat, skyU)
  let worldWeather: WorldWeather = init.weather ?? NO_WEATHER
  let offline = init.offline
  const modeBase: ModeBase = { moon: new THREE.Color(), fog: new THREE.Color(), near: 17, far: 38 }

  const scenes = new Map<SceneKey, BuiltScene>()
  let weeks = weeksOrDefault(init.weeks)
  let mode: WorldMode = init.mode
  let lantern = init.lantern
  let pond = 0.5
  let reduced = init.reducedMotion
  let timeLamp = 1

  function applyMode(b: BuiltScene) {
    const M = MODES[mode]
    if (b.smoke) (b.smoke.material as THREE.ShaderMaterial).uniforms.uThin.value = M.smoke
    if (b.spill) (b.spill.material as THREE.ShaderMaterial).uniforms.uExposure.value = M.spill
    if (b.lightFlies) b.lightFlies.visible = M.flies
    if (b.cyanMotes) b.cyanMotes.visible = M.flies
    if (b.beams) { b.beams.visible = M.beams > 0.3; (b.beams.material as THREE.ShaderMaterial).uniforms.uExposure.value = M.beams }
        if (b.shrooms) b.shrooms.visible = mode !== 'sun'
    if (b.pondFlies) { b.pondFlies.visible = mode === 'night'; const tw = b.pondFlies.userData.twin as THREE.Object3D | undefined; if (tw) tw.visible = mode === 'night' }
    applyLight(b)
  }
  function applyLight(b: BuiltScene) {
    if (b.flies) b.flies.count = Math.round(24 * (0.35 + 0.65 * lantern))
    // page 32 C: the pond reacts to the week (pondLook: 0.5 is the water as drawn)
    const look = pondLook(pond)
    if (b.pondWater) { const m = b.pondWater.material as THREE.MeshBasicMaterial; m.color.set(mode === 'sun' ? '#3a2e14' : mode === 'night' ? '#061418' : '#1c2a2a').multiplyScalar(look.water); m.opacity = mode === 'night' ? 0.35 : 0.5 }
    if (b.pondFlies) { const n = (b.pondFlies.userData.n as number | undefined) ?? b.pondFlies.count; b.pondFlies.userData.n = n; b.pondFlies.count = Math.max(1, Math.round(n * look.flies)); const tw = b.pondFlies.userData.twin as THREE.InstancedMesh | undefined; if (tw) tw.count = b.pondFlies.count }
  }
  function applyDensity(b: BuiltScene) {
    for (const g of b.grass) g.mesh.count = Math.max(1, Math.floor(g.n * LEVELS[level].density))
  }
  function setModeUniforms() {
    const M = MODES[mode]
    renderer.setClearColor(M.clear)
    shared.uMoonCol.value.set(M.moon).multiplyScalar(M.moonK); shared.uMoonDir.value.set(...M.dir).normalize(); shared.uFogCol.value.set(M.fog)
    timeLamp = M.lamp
    shared.uFogNear.value = M.fogNear; shared.uFogFar.value = M.fogFar; if (M.fogCol) shared.uFogCol.value.set(M.fogCol)
    skyU.uSky.value = M.sky
    // the weather grades over the mode's own light each frame
    modeBase.moon.copy(shared.uMoonCol.value); modeBase.fog.copy(shared.uFogCol.value); modeBase.near = M.fogNear; modeBase.far = M.fogFar
  }
  /** The moss the green rain makes glow (the built scenes' moss surfaces). */
  function mossMaterials(): THREE.ShaderMaterial[] {
    const out: THREE.ShaderMaterial[] = []
    for (const b of scenes.values()) for (const m of b.surfaces) if (m.userData.set === 'moss') out.push(m)
    return out
  }

  const KIND: Record<SceneKey, SceneKind> = { clearing: 'clearing', road: 'road', pond: 'pond', home: 'home' }
  function build(key: SceneKey): BuiltScene {
    const existing = scenes.get(key)
    if (existing) return existing
    const b = buildScene(KIND[key], { shared, gw: sceneGlyphWorld(key), density: 1 }, key === 'road' ? weeks : undefined)
    b.group.position.x = PLACE_ORIGIN[key]
    scene.add(b.group)
    scenes.set(key, b)
    applyMode(b); applyDensity(b)
    lastPpu = -1
    return b
  }

  let roadStale = false
  let roadIdle = 0
  function rebuildRoad() {
    roadIdle = 0
    const old = scenes.get('road')
    if (!old) return
    scene.remove(old.group); old.dispose(); scenes.delete('road'); build('road')
    if (reduced) requestStill()
  }
  /** Rebuild the road when the phone is idle, never on the frame the camera lands (page 59 §6 item 6). */
  function rebuildRoadIdle() {
    if (roadIdle) return
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
    roadIdle = w.requestIdleCallback ? w.requestIdleCallback(() => { if (!disposed) rebuildRoad() }, { timeout: 700 }) : window.setTimeout(() => { if (!disposed) rebuildRoad() }, 200)
  }

  // ── camera ──
  let current: WorldPlace = init.place
  let view: PlaceView = PLACE_VIEWS[current]
  let glide: { from: PlaceView; to: PlaceView; start: number; lampFrom: THREE.Vector3; lampTo: THREE.Vector3 } | null = null
  const lampNow = new THREE.Vector3(...sceneLamp(sceneOf(current)))
  let lastPpu = -1
  function placeCamera(t: number) {
    const a = view.orbit * Math.sin(t * 0.08)
    camera.position.set(view.x + Math.sin(a) * 22, view.camY, view.lookZ + Math.cos(a) * 22)
    camera.lookAt(view.x, view.lookY, view.lookZ)
    const f = frustumFor(view, W, H, screenH())
    camera.left = f.left; camera.right = f.right; camera.top = f.top; camera.bottom = f.bottom
    camera.near = view.near
    camera.updateProjectionMatrix()
    // surfaces keep printing at 9 px whatever the zoom
    if (Math.abs(view.pxPerUnit - lastPpu) > lastPpu * 0.004) {
      lastPpu = view.pxPerUnit
      const gwNow = viewGlyphWorld(view)
      // the sky prints on the screen grid at the view's glyph size
      skyGlyph = view.glyph
      skyU.uGp.value = skyGlyph * renderer.getPixelRatio()
      groundMat.uniforms.uScale.value = gwNow
      for (const [key, b] of scenes) {
        for (const m of b.surfaces) m.uniforms.uScale.value = gwNow
        // the glyph cards were built for their scene's own view: scale them back to 9 px at this zoom
        const k = gwNow / sceneGlyphWorld(key)
        for (const m of b.cards) m.uniforms.uK.value = k
      }
      rainMat.uniforms.uK.value = gwNow / rainGw
      weather.scale(gwNow / rainGw)
    }
    rain.position.set(view.x, 0, view.lookZ)
    weather.follow(view.x, view.lookZ)
  }

  // ── the frame ──
  let running = false, raf = 0, lastFrame = 0, simT = 0, lastNow = 0
  const deltas: number[] = [], works: number[] = []
  let fpsCount = 0, fpsT0 = performance.now(), fps = 0, firstFrameMs = 0, calmSince = performance.now()
  // the quality ladder doesn't judge a switch: the glide, 1.5 s after a new place, and while the UI moves
  let holdUntil = 0

  function step(now: number) {
    const dt = lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 0
    lastNow = now
    if (!reduced) simT += dt
    const t = reduced ? 6 : simT
    shared.uTime.value = t
    const wx = weather.frame(t, reduced ? 0 : dt, reduced, modeBase, mossMaterials())
    shared.uWind.value = (reduced ? 0.4 : 0.5 + 0.5 * Math.sin(t * 0.33) * Math.sin(t * 0.13 + 1.0)) + wx.wind
    if (glide) {
      const k = glideEase((now - glide.start) / GLIDE_MS)
      view = mixView(glide.from, glide.to, k)
      lampNow.lerpVectors(glide.lampFrom, glide.lampTo, k)
      if (k >= 1) { glide = null; if (roadStale) { roadStale = false; rebuildRoadIdle() } }
    }
    shared.uLampPos.value.copy(lampNow)
    // at night the lantern never burns below page 14 #c's (1.6): the clearing's path and spill must read
    shared.uLamp.value = 1.6 * lampK(mode, lantern) * (timeLamp + wx.lamp) * (reduced ? 1 : 0.94 + 0.06 * Math.sin(t * 11) * Math.sin(t * 7.3))
    const inView = new Set(scenesInView(view, W))
    for (const [k, b] of scenes) {
      const vis = inView.has(k)
      b.group.visible = vis
      if (!vis) continue
      for (let i = 0; i < b.breath.length; i++) { const [m, base] = b.breath[i]; m.uniforms.uEmissive.value = reduced ? base : base * (0.72 + 0.28 * (0.5 + 0.5 * Math.sin(t * 0.8 + i * 0.9))) }
      for (const f of b.anims) f(t)
    }
    placeCamera(t)
    renderer.render(scene, camera)
  }

  function frame(now: number) {
    if (!running) return
    raf = requestAnimationFrame(frame)
    const target = 1000 / fpsNow()
    if (lastFrame && now - lastFrame < target - 2) return
    const delta = lastFrame ? now - lastFrame : target
    lastFrame = now
    const w0 = performance.now()
    step(now)
    const work = performance.now() - w0
    if (!firstFrameMs) firstFrameMs = performance.now() - t0
    deltas.push(delta); works.push(work)
    if (deltas.length > 240) { deltas.shift(); works.shift() }
    fpsCount++
    if (now - fpsT0 >= 1000) { fps = (fpsCount * 1000) / (now - fpsT0); fpsCount = 0; fpsT0 = now; adapt(now) }
  }

  // adaptive quality: if more than a fifth of recent frames ran long (or the CPU side alone eats the budget), step down;
  // after 4 calm seconds with spare CPU time, step back up one (page 59 §6 item 6: was 12)
  function adapt(now: number) {
    // a switch is never judged: its frames are dropped, so only calm frames count; nor is the covered idle rate
    if (glide || now < holdUntil || motionBusy() || cap != null) { deltas.length = 0; works.length = 0; return }
    // judge after 60 frames, or after 20 when frames are that slow (a struggling phone shouldn't wait 30 s)
    if (deltas.length < 20 || (deltas.length < 60 && deltas.reduce((a, b) => a + b, 0) < 3000)) return
    const target = 1000 / LEVELS[level].fps
    const recent = deltas.slice(-90), recentWork = works.slice(-90)
    const long = recent.filter(d => d > target * 1.45).length / recent.length
    const meanWork = recentWork.reduce((a, b) => a + b, 0) / recentWork.length
    if ((long > 0.2 || meanWork > target * 0.75) && level < LEVELS.length - 1) { setLevel(level + 1); calmSince = now; return }
    if (long < 0.03 && meanWork < target * 0.3 && level > 0 && now - calmSince > 4000) { setLevel(level - 1); calmSince = now }
    if (long >= 0.03) calmSince = now
  }
  function setLevel(l: number) {
    level = l
    renderer.setPixelRatio(levelDpr()); renderer.setSize(W, H, false); syncSky()
    for (const b of scenes.values()) applyDensity(b)
    deltas.length = 0; works.length = 0
  }

  function start() {
    if (running || reduced) { if (reduced) requestStill(); return }
    running = true; lastFrame = 0; lastNow = 0
    raf = requestAnimationFrame(frame)
  }
  function stop() { running = false; cancelAnimationFrame(raf) }
  let stillQueued = false
  function requestStill() {
    if (stillQueued) return
    stillQueued = true
    requestAnimationFrame((now) => { stillQueued = false; glide = null; view = PLACE_VIEWS[current]; lampNow.set(...sceneLamp(sceneOf(current))); step(now); if (!firstFrameMs) firstFrameMs = performance.now() - t0 })
  }

  // build the place we open on, show it, then the others when the phone is idle
  setModeUniforms()
  build(sceneOf(current))
  const order: SceneKey[] = ['clearing', 'road', 'pond', 'home']
  let idleHandle = 0
  const idle = (fn: () => void) => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
    idleHandle = w.requestIdleCallback ? w.requestIdleCallback(fn, { timeout: 1500 }) : window.setTimeout(fn, 120)
  }
  let disposed = false
  const buildRest = () => {
    if (disposed) return
    const next = order.find(k => !scenes.has(k))
    if (!next) return
    build(next)
    if (reduced) requestStill()
    idle(buildRest)
  }
  window.setTimeout(() => idle(buildRest), 900)

  const handle: WorldHandle = {
    setPlace(place, instant = false) {
      if (place === current && !glide) return
      const target = PLACE_VIEWS[place]
      build(sceneOf(place))
      const lampTo = new THREE.Vector3(...sceneLamp(sceneOf(place)))
      current = place
      holdUntil = performance.now() + 1500
      if (instant || reduced) { glide = null; view = target; lampNow.copy(lampTo); if (reduced) requestStill(); return }
      glide = { from: view, to: target, start: performance.now(), lampFrom: lampNow.clone(), lampTo }
    },
    setMode(m) { if (m === mode) return; mode = m; setModeUniforms(); for (const b of scenes.values()) applyMode(b); if (reduced) requestStill() },
    setWeeks(next) {
      const w = weeksOrDefault(next)
      if (w.length === weeks.length && w.every((p, i) => p.state === weeks[i].state && p.notches === weeks[i].notches)) return
      weeks = w
      // rebuilding the road mid-glide would hitch the glide: wait for the camera to land, then the idle time
      if (glide) { roadStale = true; return }
      // out of sight (Program's road prefetched from Today): build it while the phone is idle
      if (!scenesInView(view, W).includes('road')) { rebuildRoadIdle(); return }
      rebuildRoad()
    },
    setPond(k) { pond = Math.max(0, Math.min(1, k)); for (const b of scenes.values()) applyLight(b); if (reduced) requestStill() },
    setLantern(k) { lantern = Math.max(0, Math.min(1, k)); for (const b of scenes.values()) applyLight(b); if (reduced) requestStill() },
    // Offline rain stays grey; with the green rain, green wins (page 58 item 16).
    setOffline(off) { if (off === offline) return; offline = off; weather.set(weatherParams(worldWeather, offline), reduced ? 0 : 1.5); if (reduced) requestStill() },
    setWeather(w) {
      if (w.level === worldWeather.level && w.quiet === worldWeather.quiet && w.clearing === worldWeather.clearing) return
      const clearing = w.clearing && !worldWeather.clearing
      worldWeather = w
      weather.set(weatherParams(worldWeather, offline), reduced ? 0 : clearing ? 3.5 : 3)
      if (reduced) requestStill()
    },
    setCovered(c) {
      const next = c ? COVERED_FPS : null
      if (next === cap) return
      cap = next
      deltas.length = 0; works.length = 0
      holdUntil = performance.now() + 1500
    },
    setReducedMotion(r) { if (r === reduced) return; reduced = r; if (r) { stop(); requestStill() } else start() },
    pause() { stop() },
    resume() { start() },
    resize() {
      W = Math.max(1, canvas.clientWidth); H = Math.max(1, canvas.clientHeight)
      renderer.setSize(W, H, false); syncSky(); lastPpu = -1
      if (reduced || !running) requestStill()
    },
    stats() {
      const sorted = deltas.slice().sort((a, b) => a - b)
      return {
        fps: Math.round(fps * 10) / 10,
        workMs: works.length ? Math.round((works.reduce((a, b) => a + b, 0) / works.length) * 100) / 100 : 0,
        p95FrameMs: sorted.length ? Math.round(sorted[Math.floor(sorted.length * 0.95)] * 10) / 10 : 0,
        quality: level, dpr: renderer.getPixelRatio(), cap, drawCalls: renderer.info.render.calls,
        built: [...scenes.keys()], firstFrameMs: Math.round(firstFrameMs), weather: weather.debug() as unknown as { p: Record<string, number>; grow: number },
      }
    },
    dispose() {
      disposed = true; stop()
      const w = window as Window & { cancelIdleCallback?: (h: number) => void }
      if (w.cancelIdleCallback) w.cancelIdleCallback(idleHandle); else window.clearTimeout(idleHandle)
      if (roadIdle) { if (w.cancelIdleCallback) w.cancelIdleCallback(roadIdle); else window.clearTimeout(roadIdle) }
      for (const b of scenes.values()) b.dispose()
      scenes.clear()
      weather.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
    },
  }
  weather.set(weatherParams(worldWeather, offline), 0)
  handle.setLantern(init.lantern)
  if (reduced) requestStill(); else start()
  return handle
}
