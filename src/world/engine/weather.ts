// The injury weather in the engine (page 58, approved 2026-10-19), built on
// what src/world already has: the shared lighting uniforms (the green grade,
// the thicker mist, the lantern warm through it), the offline rain's 520
// instanced '|' cards (green, by level, slanting in the storm's wind), glyph
// cards for the splashes, the glowing puddles on the path, the moss's green
// motes, the storm's torn leaves and the pond's rings, the sky shader's soft
// lightning (at most one flash every 4 s, none under Reduce Motion), and for
// the clearing the sun mode's beams with glints, fairy dust and fresh shoots.
// Numbers follow page 58's own engine grade (its grade() function).

import * as THREE from 'three'

import { cardMaterial, gi, type SharedUniforms } from './materials'
import { pathX, POND } from './build'
import { PLACE_ORIGIN } from '../places'
import { WEATHER_KEYS, full, nextBoltIn, type WeatherParams } from '../weather'

const rnd = (i: number, k: number) => { const s = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return s - Math.floor(s) }

/** Page 58: the moon turns a sick yellow-green, the fog green. */
const SICK = new THREE.Color('#a6d85e').multiplyScalar(1.3)
const SICK_FOG = new THREE.Color('#6c8c48')
const GREEN_RAIN = new THREE.Color(150 / 255, 236 / 255, 96 / 255)

export interface ModeBase {
  moon: THREE.Color
  fog: THREE.Color
  near: number
  far: number
}

export interface WeatherFx {
  /** Move toward these knobs over `secs` (0: at once). */
  set(p: WeatherParams, secs: number): void
  /** One frame: writes the shared uniforms over the mode's own (`base`). Returns the lantern's lift. */
  frame(t: number, dt: number, reduced: boolean, base: ModeBase, moss: THREE.ShaderMaterial[]): { lamp: number; wind: number }
  /** The camera's look point (the rain, splashes, motes and leaves fall around it). */
  follow(x: number, z: number): void
  /** Glyph cards keep their print size at any zoom. */
  scale(k: number): void
  /** The weather is doing anything at all (the frame loop can't idle). */
  active(): boolean
  /** For the stats overlay and checks: the knobs now and the shoots' growth. */
  debug(): { p: WeatherParams; grow: number }
  dispose(): void
}

type Item = { x: number; y: number; z: number; c: string; t: [number, number, number]; p: number; o?: [number, number] }

export function createWeather(scene: THREE.Scene, shared: SharedUniforms, gw: number, rain: THREE.InstancedMesh, rainMat: THREE.ShaderMaterial, skyU: Record<string, THREE.IUniform>): WeatherFx {
  const group = new THREE.Group()
  const around = new THREE.Group()
  scene.add(group); group.add(around)
  const mats: THREE.ShaderMaterial[] = []
  const meshes: THREE.InstancedMesh[] = []
  const m4 = new THREE.Matrix4()

  function cards(items: Item[], o: Parameters<typeof cardMaterial>[1], parent: THREE.Object3D): { mesh: THREE.InstancedMesh; mat: THREE.ShaderMaterial; n: number } {
    const g = new THREE.PlaneGeometry(1, 1), N = Math.max(1, items.length)
    const mat = cardMaterial(shared, o)
    const mesh = new THREE.InstancedMesh(g, mat, N)
    const aG = new Float32Array(N), aP = new Float32Array(N), aT = new Float32Array(N * 3), aO = new Float32Array(N * 2)
    items.forEach((it, i) => { m4.makeTranslation(it.x, it.y, it.z); mesh.setMatrixAt(i, m4); aG[i] = gi(it.c)[0]; aP[i] = it.p; aT.set(it.t, i * 3); aO.set(it.o ?? [0, 0], i * 2) })
    g.setAttribute('aGlyph', new THREE.InstancedBufferAttribute(aG, 1)); g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(aP, 1)); g.setAttribute('aTint', new THREE.InstancedBufferAttribute(aT, 3)); g.setAttribute('aOff', new THREE.InstancedBufferAttribute(aO, 2))
    mesh.count = items.length; mesh.frustumCulled = false; mesh.visible = false
    parent.add(mesh); mats.push(mat); meshes.push(mesh)
    return { mesh, mat, n: items.length }
  }
  const G: [number, number, number] = [0.55, 0.95, 0.42]

  // splashes where the drops land, around the camera
  const splash = cards(Array.from({ length: 260 }, (_, i) => ({ x: (rnd(i, 1) - 0.5) * 9, y: 0.03, z: (rnd(i, 2) - 0.6) * 18, c: '.', t: [0.75, 1.0, 0.62] as [number, number, number], p: rnd(i, 3) })), { w: gw * 0.62, h: gw, sway: 0, splash: 1 }, around)
  // the moss breathing out green motes (Stardew's green rain)
  const motes = cards(Array.from({ length: 70 }, (_, i) => ({ x: (rnd(i, 11) - 0.5) * 8, y: 0.1 + rnd(i, 12) * 0.4, z: (rnd(i, 13) - 0.6) * 14, c: '.+:'[i % 3], t: [0.55, 0.98, 0.42] as [number, number, number], p: rnd(i, 14) })), { w: gw * 0.62, h: gw, sway: 0, rise: 1.3, glow: 0 }, around)
  // torn leaves on the storm's wind
  const leaves = cards(Array.from({ length: 30 }, (_, i) => ({ x: (rnd(i, 21) - 0.5) * 2, y: 0.8 + rnd(i, 22) * 2.6, z: (rnd(i, 23) - 0.6) * 10, c: '*^v,'[i % 4], t: (i % 3 ? [0.32, 0.55, 0.24] : [0.55, 0.45, 0.26]) as [number, number, number], p: rnd(i, 24) })), { w: gw * 0.62, h: gw, sway: 0, drift: 0.17 }, around)
  // the clearing: glints on wet leaves, fairy dust rising in the shafts
  const glints = cards(Array.from({ length: 60 }, (_, i) => ({ x: (rnd(i, 41) - 0.5) * 8, y: 1.2 + rnd(i, 42) * 2.2, z: (rnd(i, 43) - 0.7) * 12, c: i % 3 ? '*' : '+', t: [1.0, 0.97, 0.85] as [number, number, number], p: rnd(i, 44) })), { w: gw * 0.62, h: gw, sway: 0, glint: 1 }, around)
  const dust = cards(Array.from({ length: 70 }, (_, i) => ({ x: -1.4 + rnd(i, 51) * 4, y: 0.4 + rnd(i, 52) * 2.2, z: -8 + rnd(i, 53) * 6, c: '.', t: [1.0, 0.93, 0.74] as [number, number, number], p: rnd(i, 54) })), { w: gw * 0.62, h: gw, sway: 0, rise: 2.2 }, around)

  // glowing puddles on the paths of the clearing and the road
  const puddleItems: Item[] = []
  for (const ox of [PLACE_ORIGIN.clearing, PLACE_ORIGIN.road]) {
    let k = 0
    for (let z = 8.5; z > -9; z -= 1.35, k++) {
      if (k % 2 && k !== 3) continue
      const x = ox + pathX(z) + ((k % 3) - 1) * 0.12
      const ph = rnd(k, ox + 61) * 6.28
      for (const [dx, c] of [[-0.11, '~'], [0, '~'], [0.11, '~']] as Array<[number, string]>) puddleItems.push({ x: x + dx, y: 0.03, z, c, t: G, p: ph })
      for (const [dx, c] of [[-0.18, '-'], [-0.09, '~'], [0, '-'], [0.09, '~'], [0.18, '-']] as Array<[number, string]>) puddleItems.push({ x: x + dx, y: 0.02, z: z + 0.16, c, t: [0.42, 0.72, 0.34], p: ph })
    }
  }
  const puddles = cards(puddleItems, { w: gw * 0.62, h: gw, sway: 0, glow: 1 }, group)

  // fresh shoots by the clearing's path: a base glyph that grows, then a stem, two leaves and a bud
  const sproutItems: Item[] = []
  // where the path shows between the Morning Report and the day (page 58 keeps them above 73% of the screen)
  for (let k = 0; k < 11; k++) {
    const z = -2.4 - k * 0.62
    for (const side of [-1, 1]) {
      if (rnd(k, side + 5) > 0.75) continue
      const x = pathX(z) + side * (0.42 + rnd(k, side + 9) * 0.3)
      const delay = (k / 11) * 0.5 + rnd(k, side + 7) * 0.2
      const at = { x, y: 0.02, z: z + rnd(k, side + 2) * 0.1 }
      const s = gw * 0.9
      sproutItems.push({ ...at, c: '.', t: [0.59, 0.93, 0.43], p: delay })
      sproutItems.push({ ...at, c: '|', t: [0.59, 0.93, 0.43], p: 10 + delay, o: [0, s * 1.1] })
      sproutItems.push({ ...at, c: '\\', t: [0.67, 0.96, 0.55], p: 20 + delay, o: [-s * 0.6, s * 2] })
      sproutItems.push({ ...at, c: '/', t: [0.67, 0.96, 0.55], p: 30 + delay, o: [s * 0.6, s * 2] })
      sproutItems.push({ ...at, c: '*', t: [0.43, 0.86, 0.75], p: 40 + delay, o: [0, s * 2.7] })
    }
  }
  const sprouts = cards(sproutItems, { w: gw * 0.62, h: gw, sway: 0.02, grow: 0 }, group)

  // rings on the Ledger pond
  const ringItems: Item[] = []
  for (let r = 0; r < 26; r++) {
    const a = rnd(r, 71) * Math.PI * 2, d = Math.sqrt(rnd(r, 72)) * 0.85
    const x = PLACE_ORIGIN.pond + POND.PX + Math.cos(a) * d * POND.RX, z = POND.PZ + Math.sin(a) * d * POND.RZ
    for (let k = 0; k < 10; k++) {
      const an = (k / 10) * Math.PI * 2
      ringItems.push({ x, y: 0.06, z, c: '.', t: [0.75, 1.0, 0.65], p: rnd(r, 73), o: [Math.cos(an), Math.sin(an) * 0.35] })
    }
  }
  const rings = cards(ringItems, { w: gw * 0.62, h: gw, sway: 0, splash: 2 }, group)

  // the weather's own glyphs glow in their colour (page 58 draws them additive)
  for (const o of [splash, motes, rings, dust, glints, sprouts]) { o.mat.uniforms.uUnlit.value = 1; o.mat.blending = THREE.AdditiveBlending }
  // the clearing's dust and glints catch the light in front of the leaves, as page 58 draws them
  for (const o of [dust, glints, sprouts, rings]) { o.mat.depthTest = false; o.mesh.renderOrder = 9 }
  // drawn under the boards' scrim, they need the mockup's brightness (its glyphs sit above the scrim)
  for (const [o, b] of [[sprouts, 1.5], [dust, 2.2], [glints, 1.6], [motes, 1.9], [splash, 1.7], [rings, 2.4]] as const) o.mat.uniforms.uBright.value = b
  const rainH = rainMat.uniforms.uH.value as number

  // ── state ──
  let P: WeatherParams = full({})
  let from: WeatherParams = P, to: WeatherParams | null = null, t0 = 0, dur = 1
  let flash = 0, nextBolt = 1.2, boltAge = 9, grow = 0
  const ease = (u: number) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2)
  const show = (o: { mesh: THREE.InstancedMesh; mat: THREE.ShaderMaterial; n: number }, k: number, byCount = false) => {
    o.mesh.visible = k > 0.01
    o.mat.uniforms.uAlpha.value = byCount ? Math.min(1, k * 2) : Math.min(1, k)
    if (byCount) o.mesh.count = Math.max(1, Math.round(o.n * Math.min(1, k)))
  }

  return {
    set(p, secs) {
      if (secs <= 0) { P = { ...p }; to = null; grow = p.sprouts; return }
      from = { ...P }; to = { ...p }; t0 = performance.now(); dur = secs * 1000
    },
    frame(t, dt, reduced, base, moss) {
      if (to) {
        const u = Math.min(1, (performance.now() - t0) / dur), e = ease(u)
        const next = { ...P }
        for (const k of WEATHER_KEYS) next[k] = from[k] + (to[k] - from[k]) * e
        P = next
        if (u >= 1) to = null
      }
      // the green grade over the mode's light (page 58's grade())
      shared.uMoonCol.value.copy(base.moon).lerp(SICK, P.green * 0.85)
      shared.uFogCol.value.copy(base.fog).lerp(SICK_FOG, P.green)
      shared.uFogNear.value = Math.max(1, base.near - 5 * P.fog)
      shared.uFogFar.value = Math.max(shared.uFogNear.value + 6, base.far - 8 * P.fog)
      // lightning: soft and rare, never under Reduce Motion
      if (!reduced && P.lightning > 0.5) {
        nextBolt -= dt
        if (nextBolt <= 0) { nextBolt = nextBoltIn(Math.random()); flash = 1; boltAge = 0; skyU.uBolt.value.set(0.25 + Math.random() * 0.5, 0, 1, Math.random() * 100) }
      }
      boltAge += dt
      skyU.uBolt.value.y = boltAge
      if (boltAge > 0.35) skyU.uBolt.value.z = 0
      flash = reduced ? 0 : Math.max(0, flash - dt * 3.5)
      skyU.uFlash.value = flash
      shared.uExposure.value = 1 - 0.22 * P.dark + flash * 0.7
      // the rain: green by level (grey offline), slanting in the wind
      const greenRain = P.rain > 0.005
      rain.visible = greenRain || P.grey > 0.01
      rain.count = greenRain ? Math.max(1, Math.round(1000 * Math.min(1, 0.25 + 0.75 * P.rain))) : 520
      rainMat.uniforms.uTintTo.value.copy(GREEN_RAIN)
      rainMat.uniforms.uTintK.value = greenRain ? Math.min(1, P.green * 1.1) : 0
      rainMat.uniforms.uUnlit.value = greenRain ? 1 : 0
      rainMat.uniforms.uBright.value = greenRain ? 1.1 + 0.45 * P.rain : 1
      // the storm's wind slants it (page 58: '/' at about 30 degrees)
      rainMat.uniforms.uSlant.value = P.wind > 0.45 ? P.wind * 0.55 : P.wind * 0.12
      rainMat.uniforms.uAlpha.value = greenRain ? Math.min(1, 0.4 + 0.9 * P.rain) : 1
      rainMat.uniforms.uH.value = rainH * (greenRain ? (P.wind > 0.45 ? 1.5 : 1.6 + 1.2 * P.rain) : 1)
      const blend = greenRain ? THREE.AdditiveBlending : THREE.NormalBlending
      // the green rain falls in front of everything, as page 58 draws it over the forest
      if (rainMat.blending !== blend) { rainMat.blending = blend; rainMat.depthTest = !greenRain; rain.renderOrder = greenRain ? 10 : 0; rainMat.needsUpdate = true }
      show(splash, P.rain, true)
      splash.mat.uniforms.uAlpha.value = Math.min(1, P.rain * 2.2)
      show(motes, P.motes)
      show(leaves, P.leaves)
      show(puddles, P.puddles)
      show(rings, Math.min(1, P.rain * 2.2), false)
      show(glints, P.glints)
      show(dust, P.dust)
      // the shoots grow over about 3 s (at once in a still)
      if (P.sprouts > 0.01) grow = reduced ? P.sprouts : Math.min(P.sprouts, grow + dt / 3)
      else grow = 0
      sprouts.mesh.visible = grow > 0.001
      sprouts.mat.uniforms.uGrow.value = grow
      // the moss glows a little
      for (const m of moss) {
        if (m.userData.emissive0 === undefined) m.userData.emissive0 = m.uniforms.uEmissive.value
        m.uniforms.uEmissive.value = (m.userData.emissive0 as number) + 0.35 * P.motes
      }
      void t
      return { lamp: 0.45 * P.green, wind: P.wind * 0.9 }
    },
    follow(x, z) { around.position.set(x, 0, z) },
    scale(k) { for (const m of mats) m.uniforms.uK.value = k },
    active() { return to != null || WEATHER_KEYS.some(k => P[k] > 0.005) },
    debug() { return { p: { ...P }, grow } },
    dispose() {
      for (const m of meshes) { m.geometry.dispose() }
      for (const m of mats) m.dispose()
      scene.remove(group)
    },
  }
}
