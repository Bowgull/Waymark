// The crest moments of page 38 (approved), on their own small canvas:
//   'splash'  A · the suit-up, about 8 s: the still crest unlocks, its pieces lift away turning and hang,
//             then come home one layer at a time (body, rim, marks, arch, boss) with a small overshoot,
//             and the eye ignites last with a warm bloom.
//   'loading' A · the crest taken apart: its layers float apart and drift while the app works, then
//             snap together when the answer arrives.
//   'moment'  page 19 #6 · the close: the taken-apart crest snaps together over the first 45% of 3.2 s
//             while it turns home, and its eye and centre flare (19-sessions.html c3).
// Ported from 38-splash-loading-error.html (wA and wL), timings unchanged.

import * as THREE from 'three'

import { buildShield, type CrestPiece } from './crest'
import { glyphAtlas, makeShared } from './materials'

export type CrestKind = 'splash' | 'loading' | 'moment'

export interface CrestStage {
  /** Seconds since the stage started. */
  elapsed(): number
  /** Loading only: snap the crest together (0.5 s). */
  finish(): void
  dispose(): void
}

const ORDER = ['body', 'rimDark', 'bossField', 'rim', 'tip', 'marks', 'arch', 'boss', 'eye', 'centre']
const hsh = (i: number, k: number) => { const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x) }
const inout = (x: number) => { x = Math.max(0, Math.min(1, x)); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2 }
const back = (x: number) => { x = Math.max(0, Math.min(1, x)); const c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2) }
const ease = (x: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 3)

export async function createCrestStage(canvas: HTMLCanvasElement, kind: CrestKind, opts: { still?: boolean; frustum?: number; shieldY?: number; transparent?: boolean } = {}): Promise<CrestStage> {
  const W = Math.max(1, canvas.clientWidth), H = Math.max(1, canvas.clientHeight)
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: !!opts.transparent })
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.setSize(W, H, false)
  if (opts.transparent) renderer.setClearColor(0x000000, 0); else renderer.setClearColor(0x020a08)
  // CREST = { world: false, shield: true, shieldY: 0.35, frustum: 6, camY: 0.01, lookY: 0, orbit: 0, lamp: 2.6 }
  const frustumH = opts.frustum ?? 6, aspect = W / H
  const camera = new THREE.OrthographicCamera(-frustumH * aspect / 2, frustumH * aspect / 2, frustumH / 2, -frustumH / 2, 0.1, 200)
  camera.position.set(0, 0.01, 22); camera.lookAt(0, 0, 0)
  const glyphWorld = (frustumH / H) * 9
  const shared = makeShared(await glyphAtlas(), 2.6)
  shared.uLampPos.value.set(1.6, 1.2, 3)
  shared.uFogNear.value = 30; shared.uFogFar.value = 58
  const scene = new THREE.Scene()
  const shield = buildShield(shared, glyphWorld)
  shield.holder.position.set(0, opts.shieldY ?? 0.35, 0)
  scene.add(shield.holder)
  const pieces = shield.pieces as CrestPiece[]
  pieces.forEach((p, i) => {
    const a = hsh(i, 1) * Math.PI * 2, r = 55 + hsh(i, 2) * 75
    p.userData.home = p.position.clone(); p.userData.homeRz = p.rotation.z
    p.userData.off = { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.9, z: 40 + hsh(i, 3) * 90, rz: (hsh(i, 4) - 0.5) * 0.7 }
    const li = Math.max(0, ORDER.indexOf(p.userData.layer)); p.userData.arrive = 2.4 + li * 0.42 + hsh(i, 5) * 0.18
  })

  const t0 = performance.now()
  let finishAt = -1, raf = 0, alive = true
  const S = () => (performance.now() - t0) / 1000

  function splashFrame(s: number, t: number) {
    for (const p of pieces) {
      const d = p.userData, o = d.off!, u = p.material.uniforms
      let f = s < 0.8 ? 0 : s < 2.0 ? inout((s - 0.8) / 1.2) : 1
      if (s >= (d.arrive ?? 0)) f = 1 - back((s - (d.arrive ?? 0)) / 0.75)
      const drift = f > 0.98 ? Math.sin(t * 1.3 + d.order) * 6 : 0
      p.position.set(d.home!.x + o.x * f, d.home!.y + o.y * f + drift, d.home!.z + o.z * f); p.rotation.z = (d.homeRz ?? 0) + o.rz * f
      if (d.layer === 'eye') u.uEmissive.value = s < 6.0 ? 0.15 : Math.min(1.3, 0.15 + (s - 6.0) * 2.2) - Math.max(0, s - 6.6) * 0.25
      if (d.layer === 'centre') u.uEmissive.value = s < 6.1 ? 0.2 : Math.min(1.1, 0.2 + (s - 6.1) * 2)
    }
    shield.holder.rotation.y = -0.12 + (s > 0.8 && s < 6.2 ? Math.sin((s - 0.8) / 5.4 * Math.PI) * -0.35 : 0)
  }
  function loadingFrame(t: number) {
    const sinceDone = finishAt < 0 ? -1 : S() - finishAt
    const done = sinceDone >= 0, snap = done ? ease(sinceDone / 0.5) : 0, drift = 0.55 + 0.25 * Math.sin(t * 0.8)
    shield.holder.rotation.y = Math.sin(t * 0.3) * 0.35 * (1 - snap); shield.holder.rotation.x = -0.1 * (1 - snap)
    for (const p of pieces) {
      p.position.z = (1 - snap) * drift * p.userData.order * 9 + (1 - snap) * Math.sin(t * 0.9 + p.userData.order) * 4
      if (p.userData.layer === 'eye') p.material.uniforms.uEmissive.value = done ? 0.6 + snap * 0.6 : 0.35 + 0.15 * Math.sin(t * 1.5)
    }
  }
  function momentFrame(s: number, t: number) {
    const k = s / 3.2, ex = 1 - ease(Math.min(1, k / 0.45))
    shield.holder.rotation.y = Math.sin(t * 0.35) * 0.25 - ex * 0.5; shield.holder.rotation.x = -0.12 * ex
    for (const p of pieces) {
      p.position.z = ex * p.userData.order * 9
      if (p.userData.layer === 'eye') p.material.uniforms.uEmissive.value = 0.6 + (k > 0.45 ? 0.4 : 0) + 0.12 * Math.sin(t * 2)
      if (p.userData.layer === 'centre') p.material.uniforms.uEmissive.value = k > 0.45 ? 1.1 : 0.5
    }
  }
  function draw() {
    const s = S()
    shared.uTime.value = s
    if (opts.still) {
      // Reduce Motion: the finished crest, lit, no movement
      for (const p of pieces) { if (p.userData.layer === 'eye') p.material.uniforms.uEmissive.value = 1.0; if (p.userData.layer === 'centre') p.material.uniforms.uEmissive.value = 0.9 }
      shield.holder.rotation.y = -0.12
    } else if (kind === 'splash') splashFrame(s, s)
    else if (kind === 'moment') momentFrame(s, s)
    else loadingFrame(s)
    renderer.render(scene, camera)
  }
  function loop() { if (!alive) return; draw(); if (!opts.still) raf = requestAnimationFrame(loop) }
  loop()

  return {
    elapsed: S,
    finish() { if (finishAt < 0) finishAt = S(); if (opts.still) draw() },
    dispose() {
      alive = false; cancelAnimationFrame(raf)
      for (const p of pieces) { p.geometry.dispose(); p.material.dispose() }
      renderer.dispose(); renderer.forceContextLoss()
    },
  }
}
