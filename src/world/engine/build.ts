// One place of the world, built exactly as the approved mockup scene
// (shared/ascii3d-14.js, createWorld's scene section) inside a THREE.Group:
//   'clearing' = page 14 (moss oaks, lantern, red-dirt path, rails, the rune arch down the path)
//   'road'     = page 33 (notched wayposts with lanterns, broken rails, the glow where the road ends)
//   'pond'     = pages 32 / 32b (the mirror pond, drifting lily, rise rings, glints, mushrooms; no waterfall)
//   'home'     = page 43 (the hobbit home, dragons door with window and centre knob, smoke)
// Ported line for line; changes are structural only (no globals, a group per place, bounding
// spheres so off-screen glyph cards are culled, handles the world drives).

import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import { SETS, cardMaterial, gi, surfaceMaterial, type CardOpts, type SharedUniforms, type SurfaceOpts } from './materials'
import { DOOR_STYLES, doorMask, runeMask } from './masks'
import type { WeekPost } from '../worldStore'

export type SceneKind = 'clearing' | 'road' | 'pond' | 'home'

export interface BuildEnv {
  shared: SharedUniforms
  /** Glyph size in world units for this scene. */
  gw: number
  /** Grass density multiplier (adaptive quality). */
  density: number
}

export interface CardItem { x: number; y?: number; z: number; c: string; t: number[]; p?: number; o?: [number, number] }

export interface BuiltScene {
  kind: SceneKind
  group: THREE.Group
  /** Surface materials (their glyph scale tracks the camera zoom). */
  surfaces: THREE.ShaderMaterial[]
  /** Glyph-card materials (grass, moss, mist, smoke...): their size tracks the camera zoom too (uK). */
  cards: THREE.ShaderMaterial[]
  /** Per-frame movers (the lily, the rise rings, the reflection wobble). */
  anims: Array<(t: number) => void>
  /** Materials that breathe (lit windows, the door light). */
  breath: Array<[THREE.ShaderMaterial, number]>
  smoke: THREE.InstancedMesh | null
  spill: THREE.InstancedMesh | null
  lightFlies: THREE.InstancedMesh | null
  cyanMotes: THREE.InstancedMesh | null
  beams: THREE.InstancedMesh | null
  pondWater: THREE.Mesh | null
  shrooms: THREE.InstancedMesh | null
  pondFlies: THREE.InstancedMesh | null
  /** The progress fireflies (24 at full light). */
  flies: THREE.InstancedMesh | null
  grass: Array<{ mesh: THREE.InstancedMesh; n: number }>
  mirror: THREE.Group | null
  dispose(): void
}

export const POND = { PX: 0.2, PZ: 11.0, RX: 4.6, RZ: 5.2 } as const
export const pathX = (z: number) => 0.25 + Math.sin(z * 0.42) * 0.75
const rnd = (i: number, k: number) => { const s = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return s - Math.floor(s) }
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

export function buildScene(kind: SceneKind, env: BuildEnv, weeksIn?: WeekPost[]): BuiltScene {
  const { shared, gw } = env
  const opts = {
    pond: kind === 'pond',
    door: kind === 'home',
    weeks: kind === 'road' ? (weeksIn ?? []) : null,
    arch: kind === 'clearing',
    fence: kind === 'clearing' || kind === 'home',
    grass: Math.round(({ clearing: 4200, road: 2200, pond: 1800, home: 3200 } as const)[kind] * env.density),
  }
  const group = new THREE.Group()
  const surfaces: THREE.ShaderMaterial[] = []
  const anims: Array<(t: number) => void> = []
  const add = (...o: THREE.Object3D[]) => { group.add(...o) }
  const surf = (o: Omit<SurfaceOpts, 'scale'>) => { const m = surfaceMaterial(shared, { scale: gw, ...o }); surfaces.push(m); return m }
  const m4 = new THREE.Matrix4()
  const cards: THREE.ShaderMaterial[] = []
  const card = (o: CardOpts) => { const m = cardMaterial(shared, o); cards.push(m); return m }
  const out: BuiltScene = { kind, group, surfaces, cards, anims, breath: [], smoke: null, spill: null, lightFlies: null, cyanMotes: null, beams: null, pondWater: null, shrooms: null, pondFlies: null, flies: null, grass: [], mirror: null, dispose: () => {} }

  const POND_ON = opts.pond
  const pathEnd = opts.door ? -1.7 : -16
  const onPath = (x: number, z: number, m = 0) => z < 10 && z > pathEnd && Math.abs(x - pathX(z)) < 0.55 + m
  const inPond = (x: number, z: number, m = 0) => POND_ON && ((x - POND.PX) / (POND.RX + m)) ** 2 + ((z - POND.PZ) / (POND.RZ + m)) ** 2 < 1

  // card helper: a list of glyph cards → one instanced mesh, with a bounding sphere so it culls off-screen
  function addCards(items: CardItem[], o: Partial<CardOpts>): THREE.InstancedMesh {
    const g = new THREE.PlaneGeometry(1, 1), N = Math.max(1, items.length)
    const mesh = new THREE.InstancedMesh(g, card({ w: gw * 0.62, h: gw, ...o }), N)
    const aG = new Float32Array(N), aP = new Float32Array(N), aT = new Float32Array(N * 3), aO = new Float32Array(N * 2)
    const box = new THREE.Box3()
    items.forEach((it, i) => { m4.makeTranslation(it.x, it.y ?? 0, it.z); mesh.setMatrixAt(i, m4); aG[i] = gi(it.c)[0]; aP[i] = it.p ?? i * 1.7; aT.set(it.t, i * 3); aO.set(it.o ?? [0, 0], i * 2); box.expandByPoint(V(it.x, it.y ?? 0, it.z)) })
    mesh.count = items.length
    g.setAttribute('aGlyph', new THREE.InstancedBufferAttribute(aG, 1)); g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(aP, 1)); g.setAttribute('aTint', new THREE.InstancedBufferAttribute(aT, 3)); g.setAttribute('aOff', new THREE.InstancedBufferAttribute(aO, 2))
    const sphere = items.length ? box.getBoundingSphere(new THREE.Sphere()) : new THREE.Sphere(V(0, 0, 0), 1)
    sphere.radius += 0.6 + Math.abs(o.rise ?? 0) + (o.fall ?? 0) + (o.fly ? 1 : 0) + (o.h ?? gw) * 2
    mesh.boundingSphere = sphere
    mesh.frustumCulled = true
    add(mesh)
    return mesh
  }
  function tube(pts: THREE.Vector3[], r0: number, r1: number, seg = 12, rad = 6) {
    const curve = new THREE.CatmullRomCurve3(pts), geo = new THREE.TubeGeometry(curve, seg, 1, rad, false), pos = geo.attributes.position, c = V(0, 0, 0), v = V(0, 0, 0)
    for (let i = 0; i <= seg; i++) { const t = i / seg; curve.getPointAt(t, c); const r = r0 + (r1 - r0) * Math.pow(t, 0.75); for (let j = 0; j <= rad; j++) { const k = i * (rad + 1) + j; v.fromBufferAttribute(pos, k).sub(c).multiplyScalar(r).add(c); pos.setXYZ(k, v.x, v.y, v.z) } }
    geo.computeVertexNormals(); return { geo: geo.toNonIndexed(), curve }
  }
  function clump(r: number, seed: number, sq = [1, 0.6, 1]) {
    const g = new THREE.IcosahedronGeometry(r, 1), p = g.attributes.position, v = V(0, 0, 0)
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const k = 0.75 + 0.45 * rnd(Math.round(v.x * 40 / r) + seed, Math.round(v.y * 31 / r + v.z * 17 / r)); p.setXYZ(i, v.x * k * sq[0], v.y * k * sq[1], v.z * k * sq[2]) }
    g.computeVertexNormals(); return g
  }
  const flat = (g: THREE.BufferGeometry) => (g.index ? g.toNonIndexed() : g)
  const merged = (list: THREE.BufferGeometry[]) => mergeGeometries(list.map(flat)) as THREE.BufferGeometry

  const mossBark = surf({ set: 'moss', color: '#7a9a5c', fill: 0.34, min: 0.2 }), darkBark = surf({ set: 'moss', color: '#5c5a38', fill: 0.4, min: 0.16 }), brownBark = surf({ set: 'wood', color: '#7e6a4a', fill: 0.34, min: 0.2 }), leaf = surf({ set: 'foliage', color: '#4f8a44', fill: 0.26, min: 0.14 })
  const paleBark = surf({ set: 'stone', color: '#b9c4b0', fill: 0.24, min: 0.22 })
  const redDirt = surf({ set: 'road', color: '#a4583a', fill: 0.3, min: 0.18 }), rail = surf({ set: 'wood', color: '#7a5a3c', fill: 0.26, min: 0.2 })
  const hang: Array<{ x: number; y: number; z: number; n: number; p: number }> = [], lightPts: Array<{ x: number; y: number; z: number; r: number }> = [], glintPts: number[][] = []

  // a twisted moss oak (Wistman's Wood)
  function mossOak(x: number, z: number, h: number, seed: number, reach: number | null = null, y0 = 0) {
    const g = new THREE.Group(), base: THREE.BufferGeometry[] = [], bark: THREE.BufferGeometry[] = [], twigs: THREE.BufferGeometry[] = [], leaves: THREE.BufferGeometry[] = []
    let c = 0; const R = () => rnd(seed, 500 + c++)
    const lean = reach != null ? reach : R() * 6.28
    let p = V(0, 0, 0); const trunk = [p.clone()]
    for (let s = 1; s <= 3; s++) { p = p.clone().add(V(Math.cos(lean) * h * 0.06 + (R() - 0.5) * h * 0.12, h * 0.14, Math.sin(lean) * h * 0.04 + (R() - 0.5) * h * 0.1)); trunk.push(p) }
    base.push(tube(trunk, h * 0.2, h * 0.14, 12, 9).geo)
    for (let k = 0; k < 3; k++) { const m = clump(h * (0.13 + R() * 0.08), seed * 31 + k, [1.3, 0.5, 1.1]); const a = k * 2.1 + R(); m.translate(Math.cos(a) * h * 0.18, h * 0.03, Math.sin(a) * h * 0.18); base.push(m) }
    for (let r = 0; r < 5; r++) { const a = r * 1.26 + R() * 0.6, L = h * (0.25 + R() * 0.15); base.push(tube([V(0, h * 0.1, 0), V(Math.cos(a) * L * 0.45, h * 0.03, Math.sin(a) * L * 0.45), V(Math.cos(a) * L, -0.03, Math.sin(a) * L)], h * 0.075, h * 0.02, 8, 5).geo) }
    const perp = (d: THREE.Vector3) => { const v = V(R() - 0.5, R() - 0.5, R() - 0.5); v.sub(d.clone().multiplyScalar(v.dot(d))); return v.normalize() }
    function bough(st: THREE.Vector3, dir: THREE.Vector3, len: number, r0: number, depth: number) {
      const pts = [st]; let q = st.clone(); const d = dir.clone()
      for (let s = 1; s <= 3; s++) { d.add(perp(d).multiplyScalar(0.45)); d.y -= depth * 0.06; d.normalize(); q = q.clone().add(d.clone().multiplyScalar(len / 3)); pts.push(q) }
      const B = tube(pts, r0, r0 * 0.62, 9, 7); (depth >= 2 ? twigs : bark).push(B.geo)
      if (depth >= 1) for (let t = 0.25; t <= 1.0; t += 0.25) { const k = B.curve.getPointAt(t); hang.push({ x: x + k.x, y: y0 + k.y - 0.04, z: z + k.z, n: 2 + Math.floor(R() * 5), p: seed + depth + t }) }
      const end = pts[3], ed = d.clone()
      if (depth === 2) { if (R() < 0.6) { const cl = clump(h * (0.085 + R() * 0.04), seed * 13 + c, [1.15, 0.85, 1.05]); cl.translate(end.x, end.y + h * 0.03, end.z); leaves.push(cl) } return }
      for (let k = 0; k < 2; k++) { const nd = ed.clone().add(perp(ed).multiplyScalar(0.7 + R() * 0.4)).add(V(0, 0.25, 0)).normalize(); bough(end, nd, len * (0.62 + R() * 0.12), r0 * 0.6, depth + 1) }
    }
    const top = trunk[3], nb = 2 + (R() > 0.45 ? 1 : 0)
    for (let b = 0; b < nb; b++) {
      const a = (reach != null ? reach + (b / Math.max(1, nb - 1) - 0.5) * 2.0 : b * (6.28 / nb) + R()), el = 0.75 + R() * 0.35
      bough(top.clone().add(V(0, -h * 0.04 * b, 0)), V(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)).normalize(), h * (0.42 + R() * 0.12), h * 0.12, 0)
    }
    g.add(new THREE.Mesh(merged(base), darkBark), new THREE.Mesh(merged(bark), mossBark), new THREE.Mesh(merged(leaves), leaf)); if (twigs.length) g.add(new THREE.Mesh(merged(twigs), brownBark))
    g.position.set(x, y0, z); add(g)
  }
  function paleTree(x: number, z: number, h: number, seed: number) {
    const g = new THREE.Group()
    const t = tube([V(0, 0, 0), V((rnd(seed, 1) - 0.5) * 0.3, h * 0.5, 0), V((rnd(seed, 2) - 0.5) * 0.4, h, 0)], 0.32, 0.18, 10, 8)
    g.add(new THREE.Mesh(t.geo, paleBark)); g.position.set(x, 0, z); add(g)
  }
  if (!opts.door && !opts.weeks) { mossOak(-2.5, 5.2, 2.6, 7, 0.1); mossOak(2.7, 6.0, 2.8, 9, Math.PI - 0.1) } else { mossOak(-3.4, 3.2, 2.4, 7, 0.3); mossOak(3.5, 2.6, 2.5, 9, Math.PI - 0.3) }
  if (!opts.door && !opts.weeks) { mossOak(-2.7, 2.2, 2.5, 11, 0.2); mossOak(3.0, 1.4, 2.7, 13, Math.PI - 0.2); mossOak(-3.3, -1.6, 2.3, 17, 0.4); mossOak(3.4, -2.4, 2.4, 19, Math.PI - 0.4) }
  mossOak(-1.9, -5.2, 2.1, 23, null); mossOak(2.4, -6.2, 2.2, 29, null); mossOak(-3.6, -7.5, 2.0, 31, 0.3); mossOak(0.9, -9.5, 1.9, 37, null)
  for (let i = 0; i < 9; i++) paleTree(-5 + i * 1.25 + (rnd(i, 3) - 0.5) * 0.6, -11.5 - rnd(i, 4) * 4, 15, 50 + i)
  // foreground: moss-covered boulders and a fallen log (not where the pond is)
  if (!POND_ON) {
    const st: THREE.BufferGeometry[] = []
    ;([[-1.6, 8.2, 0.7], [2.0, 7.6, 0.9], [-2.6, 6.8, 0.6], [1.3, 9.0, 0.5], [-0.9, 9.4, 0.45], [2.9, 8.8, 0.7]] as const).forEach(([bx, bz, br], i) => { const c = clump(br, 300 + i, [1.3, 0.6, 1.1]); c.translate(bx, br * 0.25, bz); st.push(c) })
    st.push(tube([V(-3.6, 0.25, 7.6), V(-2.6, 0.32, 8.1), V(-1.4, 0.22, 8.9)], 0.32, 0.26, 10, 8).geo)
    add(new THREE.Mesh(merged(st), surf({ set: 'moss', color: '#4f6e3a', fill: 0.4, min: 0.16 })))
  }
  for (let i = 0; i < 12; i++) paleTree(-8 + i * 1.4 + (rnd(i, 7) - 0.5) * 0.8, -18 - rnd(i, 8) * 5, 16, 80 + i)

  // the red-dirt path, with rustic wooden rails along it now and then
  {
    const pos: number[] = [], uv: number[] = []
    for (let z = 10; z > pathEnd; z -= 0.3) { if (inPond(pathX(z), z, 0.35)) continue; const z2 = z - 0.3, a = pathX(z), b = pathX(z2), w1 = 0.5 + Math.sin(z * 0.9) * 0.06, w2 = 0.5 + Math.sin(z2 * 0.9) * 0.06; const q = [[a - w1, z], [a + w1, z], [b + w2, z2], [b - w2, z2]]; for (const k of [0, 1, 2, 0, 2, 3]) { pos.push(q[k][0], 0.012, q[k][1]); uv.push(0, 0) } }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals(); add(new THREE.Mesh(g, redDirt))
  }
  {
    const rails: THREE.BufferGeometry[] = []
    for (const [z0, side] of (!opts.fence ? [] : opts.door ? [[3.6, 1], [0.6, -1]] : [[3.6, 1], [0.2, -1], [-3.2, 1], [-6.6, -1], [-9.4, 1]])) {
      const posts: THREE.Vector3[] = []
      for (let k = 0; k < 3; k++) { const z = z0 - k * 0.85, x = pathX(z) + side * 0.82; posts.push(V(x, 0, z)); rails.push(tube([V(x, 0, z), V(x + (rnd(z0, k) - 0.5) * 0.06, 0.62, z)], 0.045, 0.04, 2, 6).geo) }
      for (let k = 0; k < 2; k++) for (const hgt of [0.3, 0.55]) rails.push(tube([posts[k].clone().add(V(0, hgt, 0)), posts[k + 1].clone().add(V(0, hgt + (rnd(z0, k + hgt) - 0.5) * 0.06, 0))], 0.03, 0.028, 2, 5).geo)
    }
    if (rails.length) add(new THREE.Mesh(merged(rails), rail))
  }

  // the Program road: one notched waypost per week, each with a lantern (page 33)
  if (opts.weeks) {
    const ZS = [6.6, 3.6, 0.6, -2.6, -6.0, -9.6], woodM = surf({ set: 'wood', color: '#7a5a3c', fill: 0.3, min: 0.2 }), notchM = surf({ set: 'wood', color: '#2a1c10', fill: 0.4, min: 0.05 })
    const ironM = surf({ set: 'metal', color: '#4a4a44', fill: 0.3, min: 0.12 }), litM = surf({ set: 'glow', color: '#e8b870', fill: 0.4, min: 0.3, emissive: 0.75 }), nowM = surf({ set: 'glow', color: '#ffd08a', fill: 0.5, min: 0.45, emissive: 1.2 }), coldM = surf({ set: 'glow', color: '#3a4440', fill: 0.3, min: 0.1 })
    const mossCap = surf({ set: 'moss', color: '#6e9a4e', fill: 0.4, min: 0.2 })
    const runes: CardItem[] = []
    opts.weeks.forEach((w, i) => {
      const z = ZS[i] ?? -12 - i, side = i % 2 ? -1 : 1, x = pathX(z) + side * 0.9, g = new THREE.Group()
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.25, 0.16), woodM); post.position.y = 0.62; post.rotation.z = (rnd(i, 1400) - 0.5) * 0.08; g.add(post)
      for (let k = 0; k < (w.notches ?? 0); k++) { const nt = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.035, 0.06), notchM); nt.position.set(0, 0.25 + k * 0.11, 0.06); g.add(nt) }
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.04, 0.05), ironM); arm.position.set(-side * 0.14, 1.18, 0); g.add(arm)
      const cage = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.17, 0.13), ironM); cage.position.set(-side * 0.3, 1.04, 0); g.add(cage)
      const flame = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.11, 0.08), w.state === 'now' ? nowM : w.state === 'done' ? litM : coldM); flame.position.set(-side * 0.3, 1.04, 0); g.add(flame)
      if (w.state === 'now') { const cap = new THREE.Mesh(clump(0.13, 1410 + i, [1.2, 0.6, 1.2]), mossCap); cap.position.set(0, 1.28, 0); g.add(cap) }
      g.scale.setScalar(1.75); g.position.set(x, 0, z); add(g)
      // a done week: its notch carved and a teal rune on the post (design-decisions.md, Program)
      if (w.state === 'done') runes.push({ x, y: 0.62 * 1.75, z: z + 0.45, c: 'Y', t: [0.36, 0.99, 0.83], p: i * 1.3 })
      if (w.state === 'done' || w.state === 'now') { lightPts.push({ x: x - side * 0.52, y: 1.8, z: z + 0.1, r: w.state === 'now' ? 1.3 : 0.7 }); glintPts.push([x - side * 0.52, 2.0, z + 0.08]) }
      if (w.state === 'now') { const items: CardItem[] = []; for (let k = 0; k < 14; k++) items.push({ x: x + (rnd(k, 1420 + i) - 0.5) * 1.6, y: 0.4 + rnd(k, 1421 + i) * 1.4, z: z + (rnd(k, 1422 + i) - 0.5) * 1.2, c: rnd(k, 1423) > 0.5 ? '*' : '+', t: [1.0, 0.9, 0.5], p: rnd(k, 1424) * 6.28 }); addCards(items, { spill: 1, fly: 0.35, sway: 0 }) }
    })
    if (runes.length) addCards(runes, { spill: 1, sway: 0, w: gw * 1.1, h: gw * 1.6 })
    {
      const rails: THREE.BufferGeometry[] = [], STATES = ['intact', 'half', 'broken', 'intact', 'half', 'broken', 'intact']
      for (let i = 0; i < ZS.length - 1; i++) for (const side of [-1, 1]) {
        const st = STATES[(i * 2 + (side > 0 ? 1 : 0)) % STATES.length], z0 = ZS[i] - 0.5, z1 = ZS[i + 1] + 0.5, n = Math.max(2, Math.round((z0 - z1) / 0.9))
        const pts: THREE.Vector3[] = []; for (let k = 0; k <= n; k++) { const z = z0 - (z0 - z1) * k / n; pts.push(V(pathX(z) + side * 1.15, 0, z)) }
        pts.forEach((pt, k) => { const lean = st === 'half' && k === n ? 0.5 : (rnd(i * 9 + k, 1500 + side) - 0.5) * 0.12, h = st === 'broken' && k % 2 ? 0.22 : 0.62; rails.push(tube([pt, pt.clone().add(V(Math.sin(lean) * h * side, Math.cos(lean) * h, 0))], 0.075, 0.065, 2, 6).geo) })
        for (let k = 0; k < n; k++) {
          const a = pts[k], b = pts[k + 1]
          if (st === 'intact') { for (const hy of [0.3, 0.52]) rails.push(tube([a.clone().add(V(0, hy, 0)), b.clone().add(V(0, hy + (rnd(k, 1510) - 0.5) * 0.05, 0))], 0.05, 0.045, 2, 5).geo) }
          else if (st === 'half') { if (k < n - 1) rails.push(tube([a.clone().add(V(0, 0.48, 0)), b.clone().add(V(0, 0.46, 0))], 0.05, 0.045, 2, 5).geo); else rails.push(tube([a.clone().add(V(0, 0.48, 0)), b.clone().add(V(side * 0.1, 0.12, 0))], 0.05, 0.045, 2, 5).geo) }
          else if (k === 1) rails.push(tube([a.clone().add(V(side * 0.15, 0.04, 0)), b.clone().add(V(side * 0.35, 0.04, 0.1))], 0.05, 0.045, 2, 5).geo)
        }
      }
      if (rails.length) add(new THREE.Mesh(merged(rails), surf({ set: 'wood', color: '#a07a52', fill: 0.34, min: 0.24 })))
    }
    { const items: CardItem[] = []; for (let k = 0; k < 120; k++) { const a = rnd(k, 1430) * Math.PI * 2, r = Math.sqrt(rnd(k, 1431)) * 1.6; items.push({ x: pathX(-14) + Math.cos(a) * r * 1.4, y: 0.5 + Math.abs(Math.sin(a)) * r, z: -14.5 + rnd(k, 1432) * 0.6, c: rnd(k, 1433) > 0.6 ? '*' : '.', t: [1.0, 0.94, 0.75].map(v => v * (0.6 + (1 - r / 1.6) * 0.6)), p: rnd(k, 1434) * 6.28 }) } addCards(items, { spill: 1, sway: 0, w: gw * 0.7, h: gw * 1.0 }) }
  }

  // hanging moss strands off the oak limbs
  { const items: CardItem[] = []; hang.forEach((hp, k) => { for (let d = 0; d < hp.n; d++) items.push({ x: hp.x, y: hp.y - (d + 1) * gw * 0.95, z: hp.z, c: "|:!'"[(d + k) % 4], t: [0.5 + rnd(k, d) * 0.1, 0.68, 0.42].map(v => v * (1 - d / (hp.n + 5) * 0.4)), p: hp.p }) }); addCards(items, { sway: 0.06 }) }
  if (POND_ON) {
    const moss: CardItem[] = [], vines: CardItem[] = []
    hang.forEach((hp, k) => {
      const n2 = hp.n + 3 + (k % 4); for (let d = 0; d < n2; d++) moss.push({ x: hp.x + 0.07, y: hp.y - (d + 1) * gw * 0.9, z: hp.z + 0.03, c: "|:!'"[(d + k + 1) % 4], t: [0.52, 0.7, 0.42].map(v => v * (1 - d / (n2 + 6) * 0.45)), p: hp.p + 0.6 })
      if (k % 2 === 0) { const n3 = 8 + (k % 5) * 2; for (let d = 0; d < n3; d++) vines.push({ x: hp.x - 0.06 + Math.sin(d * 0.6 + k) * 0.03, y: hp.y - (d + 1) * gw * 0.95, z: hp.z - 0.02, c: d % 3 === 2 ? '&' : (d % 2 ? ')' : '('), t: d % 3 === 2 ? [0.42, 0.72, 0.34] : [0.36, 0.5, 0.28], p: hp.p + 1.3 }) }
    })
    addCards(moss, { sway: 0.07 }); addCards(vines, { sway: 0.05 })
  }
  // ferns along the path edges
  { const items: CardItem[] = []; for (let i = 0; i < 160; i++) { const z = 6 - rnd(i, 71) * 20, side = rnd(i, 72) > 0.5 ? 1 : -1, x = pathX(z) + side * (0.62 + rnd(i, 73) * 1.4); items.push({ x, z, c: '}{)('[i % 4], t: [0.3, 0.62, 0.36], p: i }) } addCards(items, { sway: 0.3 }) }
  // mist: low drifting '~' and '-' bands
  { const items: CardItem[] = []; for (let i = 0; i < 200; i++) items.push({ x: (rnd(i, 81) - 0.5) * 14, y: 0.15 + rnd(i, 82) * 1.2, z: 3 - rnd(i, 83) * 20, c: rnd(i, 84) > 0.4 ? '~' : '-', t: [0.8, 0.88, 0.84], p: rnd(i, 85) * 6.28 }); addCards(items, { fly: 1, sway: 0 }) }
  // light shafts: slanted rows of faint '/' through the canopy
  { const items: CardItem[] = []; for (let b = 0; b < 4; b++) { const bx = -1.6 + b * 1.2, bz = -3 - b * 1.6; for (let k = 0; k < 16; k++) { const t = k / 15; items.push({ x: bx + t * 1.2 + (rnd(b, k) - 0.5) * 0.2, y: 3.6 - t * 3.4, z: bz + (rnd(k, b) - 0.5) * 0.3, c: '/', t: [0.95, 0.88, 0.6], p: b * 3 + k * 0.2 }) } } out.beams = addCards(items, { glow: 1, sway: 0, w: gw * 0.7, h: gw * 1.3 }) }
  // a few leaves letting go and drifting down on the wind
  { const items: CardItem[] = []; for (let i = 0; i < 18; i++) items.push({ x: (rnd(i, 620) - 0.6) * 7, y: 3.4 + rnd(i, 621) * 1.2, z: 3 - rnd(i, 622) * 9, c: rnd(i, 623) > 0.5 ? ',' : "'", t: rnd(i, 624) > 0.4 ? [0.85, 0.7, 0.3] : [0.5, 0.75, 0.35], p: rnd(i, 625) }); addCards(items, { rise: -3.6, sway: 0 }) }
  // silver-leaf accents
  {
    const items: CardItem[] = []; const spots = opts.door ? [[-1.9, 0.6], [1.6, 0.9], [-1.2, 2.6], [2.2, 3.2]] : [[-1.25, 4.4], [1.55, 3.0], [-1.0, 0.6], [1.5, -1.4], [-1.3, -4.0], [1.2, -5.6], [2.3, 6.4], [-2.0, 7.2]]
    spots.forEach(([sx, sz], j) => { const cx = (opts.door ? sx : pathX(sz) + sx), card = j % 3 === 2; const n = card ? 9 : 14; for (let i = 0; i < n; i++) { const a2 = i / n * Math.PI * 2 + rnd(i, 810 + j) * 0.4, r2 = card ? 0.12 + (i % 3) * 0.1 : 0.06 + rnd(i, 811 + j) * 0.18; items.push({ x: cx + Math.cos(a2) * r2, y: card ? 0.05 + (i % 3) * 0.05 : 0.02, z: sz + Math.sin(a2) * r2 * 0.7, c: card ? '/\\|}{'[i % 5] : 'w*W%'[i % 4], t: [0.8, 0.88, 0.86].map(v => v * (0.85 + rnd(i, 812 + j) * 0.25)), p: j + i * 0.3 }) } })
    addCards(items, { sway: 0.22 })
  }
  // a few cyan motes, night and mist only
  { const items: CardItem[] = []; for (let i = 0; i < 16; i++) items.push({ x: (rnd(i, 820) - 0.5) * 7, y: 0.4 + rnd(i, 821) * 2.4, z: 3 - rnd(i, 822) * 11, c: rnd(i, 823) > 0.5 ? '.' : '+', t: [0.35, 0.95, 1.0], p: rnd(i, 824) * 6.28 }); out.cyanMotes = addCards(items, { glow: 1, fly: 1, sway: 0 }) }
  // fairy motes (Kokiri, only a bit)
  { const items: CardItem[] = []; for (let i = 0; i < 40; i++) items.push({ x: (rnd(i, 91) - 0.5) * 8, y: 0.3 + rnd(i, 92) * 2.2, z: 2 - rnd(i, 93) * 12, c: rnd(i, 94) > 0.85 ? '+' : '.', t: [0.85, 1.0, 0.7], p: rnd(i, 95) * 6.28 }); addCards(items, { glow: 1, fly: 1, sway: 0 }) }

  // the pond (the Ledger lives here)
  if (POND_ON) {
    const { PX, PZ, RX, RZ } = POND
    const water = new THREE.Mesh(new THREE.CircleGeometry(1, 72), new THREE.MeshBasicMaterial({ color: '#16282a', transparent: true, opacity: 0.5, depthWrite: false }))
    water.scale.set(RX, RZ, 1); water.rotation.x = -Math.PI / 2; water.position.set(PX, 0.02, PZ); water.userData.noMirror = true; add(water)
    out.pondWater = water
    const onWater = (i: number, k: number, m = 0.85): [number, number] => { const a = rnd(i, k) * Math.PI * 2, r = Math.sqrt(rnd(i, k + 1)) * m; return [PX + Math.cos(a) * r * RX, PZ + Math.sin(a) * r * RZ] }
    { const items: CardItem[] = []; for (let i = 0; i < 70; i++) { const [x, z] = onWater(i, 900); items.push({ x, y: 0.05, z, c: rnd(i, 902) > 0.5 ? '~' : '-', t: [0.55, 0.75, 0.78].map(v => v * (0.5 + rnd(i, 903) * 0.4)), p: rnd(i, 904) * 6.28 }) } addCards(items, { spill: 1, sway: 0 }) }
    {
      const pads: CardItem[] = [], lilies: CardItem[] = []
      ;([[-1.6, 0.5], [1.2, -0.4], [0.3, 0.9], [-0.6, -0.7]] as const).forEach(([cx, cz], j) => { for (let i = 0; i < 9; i++) { const x = PX + cx + (rnd(i, 960 + j) - 0.5) * 0.9, z = PZ + cz + (rnd(i, 961 + j) - 0.5) * 0.5; if (!inPond(x, z, -0.25)) continue; pads.push({ x, y: 0.05, z, c: rnd(i, 962 + j) > 0.5 ? 'o' : 'O', t: [0.28, 0.55, 0.3], p: i }); if (i % 4 === 0) lilies.push({ x: x + 0.05, y: 0.12, z, c: '*', t: [0.95, 0.97, 1.0], p: rnd(i, 963 + j) * 6.28 }) } })
      addCards(pads, { sway: 0 }); addCards(lilies, { spill: 1, sway: 0 })
    }
    const rim: THREE.BufferGeometry[] = []; for (let i = 0; i < 22; i++) { const a = i / 22 * Math.PI * 2 + rnd(i, 905) * 0.2, br = 0.16 + rnd(i, 906) * 0.24; const c = clump(br, 910 + i, [1.3, 0.55, 1.1]); c.translate(PX + Math.cos(a) * (RX + 0.12), br * 0.18, PZ + Math.sin(a) * (RZ + 0.12)); rim.push(c) }
    { const items: CardItem[] = []; [0.4, 1.9, 3.3, 4.6, 5.6].forEach((a0, j) => { for (let i = 0; i < 6; i++) { const a = a0 + (rnd(i, 970 + j) - 0.5) * 0.25, r = 1.04 + rnd(i, 971 + j) * 0.12; items.push({ x: PX + Math.cos(a) * RX * r, y: 0.12 + rnd(i, 972 + j) * 0.1, z: PZ + Math.sin(a) * RZ * r, c: i % 2 ? 'T' : 'n', t: [0.75, 1.0, 0.98], p: rnd(i, 973 + j) * 6.28 }) } }); out.shrooms = addCards(items, { spill: 1, sway: 0 }) }
    rim.push(tube([V(PX - RX - 0.4, 0.18, PZ - 0.5), V(PX - 1.2, 0.28, PZ - 0.85), V(PX - 0.2, 0.22, PZ - 1.35)], 0.22, 0.17, 10, 8).geo)
    add(new THREE.Mesh(merged(rim), surf({ set: 'moss', color: '#56704a', fill: 0.36, min: 0.16 })))
    { const items: CardItem[] = []; for (let i = 0; i < 90; i++) { const [x, z] = onWater(i, 980, 1.05); items.push({ x, y: 0.12 + rnd(i, 982) * 0.35, z, c: rnd(i, 983) > 0.45 ? '~' : '-', t: [0.82, 0.88, 0.88], p: rnd(i, 984) * 6.28 }) } addCards(items, { fly: 1, sway: 0 }) }
    { const items: CardItem[] = []; for (let i = 0; i < 16; i++) { const [x, z] = onWater(i, 990); items.push({ x, y: 0.05, z, c: rnd(i, 992) > 0.5 ? ',' : "'", t: [0.78, 0.6, 0.28], p: i }) } addCards(items, { sway: 0 }) }
    { const items: CardItem[] = []; for (let i = 0; i < 26; i++) { const [x, z] = onWater(i, 995, 1.1); items.push({ x, y: 0.4 + rnd(i, 997) * 1.3, z, c: rnd(i, 998) > 0.5 ? '*' : '+', t: [1.0, 0.86, 0.45], p: rnd(i, 999) * 6.28 }) } out.pondFlies = addCards(items, { spill: 1, fly: 0.18, sway: 0 }); out.pondFlies.visible = false }
    // the living water: one simple lily that drifts and bobs (with its reflection), rings as if a fish rose, a ring trailing the lily
    {
      const mkLily = () => {
        const g = new THREE.Group()
        const pad = new THREE.Mesh(new THREE.CircleGeometry(0.5, 24, 0.3, Math.PI * 2 - 0.6), surf({ set: 'foliage', color: '#4e7a3e', fill: 0.4, min: 0.2 }))
        pad.rotation.x = -Math.PI / 2; pad.position.y = 0.05; g.add(pad)
        const bloom = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8), surf({ set: 'stone', color: '#f2eee2', fill: 0.3, min: 0.3, emissive: 0.55 }))
        bloom.scale.y = 0.6; bloom.position.set(0.08, 0.13, 0.04); g.add(bloom)
        const heart = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), surf({ set: 'glow', color: '#f2c64a', fill: 0.4, min: 0.4, emissive: 0.8 })); heart.position.set(0.08, 0.22, 0.04); g.add(heart)
        g.userData.noMirror = true; return g
      }
      const lily = mkLily(), lilyR = mkLily(); lilyR.scale.y = -1; add(lily, lilyR)
      const mkRing = () => { const m = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 48), new THREE.MeshBasicMaterial({ color: '#d6ebe6', transparent: true, opacity: 0, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.y = 0.045; m.userData.noMirror = true; add(m); return m }
      const rings = [0, 1, 2].map(() => ({ m: mkRing(), t0: -99, x: 0, z: 0, max: 1 })), trail = { m: mkRing(), t0: -99, x: 0, z: 0, max: 0.6 }
      const spot = (): [number, number] => { const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 0.75; return [PX + Math.cos(a) * r * RX, PZ + Math.sin(a) * r * RZ] }
      let nextRise = 1.5, nextTrail = 0
      const drive = (R: { m: THREE.Mesh; t0: number; x: number; z: number; max: number }, t: number, life: number) => { const mat = R.m.material as THREE.MeshBasicMaterial; const k = (t - R.t0) / life; if (k < 0 || k > 1) { mat.opacity = 0; return } const r = 0.05 + k * R.max; R.m.scale.set(r, r * 0.62, 1); R.m.position.set(R.x, 0.045, R.z); mat.opacity = 0.42 * (1 - k) * Math.min(1, k * 6) }
      anims.push((t) => {
        const x = PX + 1.0 + Math.sin(t * 0.045) * 1.3, z = PZ + 1.4 + Math.sin(t * 0.031 + 1.2) * 0.7, bob = Math.sin(t * 1.1) * 0.012, rot = t * 0.04
        lily.position.set(x, bob, z); lily.rotation.y = rot; lilyR.position.set(x, -bob, z); lilyR.rotation.y = rot
        if (t > nextRise) { const R = rings.find(q => t - q.t0 > 4) ?? rings[0]; [R.x, R.z] = spot(); R.t0 = t; R.max = 0.7 + Math.random() * 0.6; nextRise = t + 2.5 + Math.random() * 4 }
        if (t > nextTrail) { trail.x = x; trail.z = z; trail.t0 = t; nextTrail = t + 3.2 }
        rings.forEach(R => drive(R, t, 4)); drive(trail, t, 3)
      })
    }
    // glints: tiny lights that twinkle on the water
    { const items: CardItem[] = []; for (let i = 0; i < 46; i++) { const [x, z] = onWater(i, 1300, 0.9); items.push({ x, y: 0.06, z, c: rnd(i, 1302) > 0.5 ? '.' : '+', t: [0.95, 1.0, 0.95], p: rnd(i, 1303) }) } addCards(items, { glint: 1, sway: 0 }) }
  }

  // the stone arch (Library lives here), over the path further back
  if (opts.arch) {
    const az = -7.4, ax = pathX(az), parts: THREE.BufferGeometry[] = []
    const stone = surf({ set: 'stone', color: '#9a9a86', fill: 0.24, min: 0.2, pattern: runeMask(7), patR: 1.4, patC: [ax, 1.36], patCol: '#3a382e' })
    for (const s2 of [-1, 1]) { const pier = new THREE.BoxGeometry(0.4, 1.7, 0.45); pier.translate(ax + s2 * 0.85, 0.85, az); parts.push(pier.toNonIndexed()) }
    for (let i = 0; i < 9; i++) { if (i === 6) continue; const a2 = i / 8 * Math.PI, b2 = new THREE.BoxGeometry(0.26, 0.36, 0.45); b2.rotateZ(a2 - Math.PI / 2 + (i === 5 ? 0.12 : 0)); b2.translate(ax + Math.cos(a2) * 0.85, 1.7 + Math.sin(a2) * 0.85 - (i === 5 ? 0.03 : 0), az); parts.push(b2.toNonIndexed()) }
    add(new THREE.Mesh(merged(parts), stone))
    { const fs: THREE.BufferGeometry[] = []; const f1 = new THREE.BoxGeometry(0.26, 0.2, 0.42); f1.rotateZ(0.5); f1.rotateY(0.4); f1.translate(ax + 1.25, 0.12, az + 0.35); fs.push(f1.toNonIndexed()); const f2 = new THREE.BoxGeometry(0.16, 0.14, 0.3); f2.rotateZ(-0.3); f2.translate(ax + 1.55, 0.07, az + 0.55); fs.push(f2.toNonIndexed()); add(new THREE.Mesh(merged(fs), surf({ set: 'stone', color: '#8e8e7a', fill: 0.26, min: 0.2 }))) }
    for (const [mx, my] of [[-0.85, 1.72], [0.85, 1.72], [-0.3, 2.55], [0.35, 2.52]]) { const m2 = new THREE.Mesh(clump(0.16, Math.round(mx * 10 + my * 7), [1.6, 0.45, 1.1]), mossBark); m2.position.set(ax + mx, my, az); add(m2) }
    {
      const pts: THREE.Vector3[] = []; for (let i = 0; i <= 40; i++) { const t = i / 40; let px: number, py: number; if (t < 0.3) { px = -0.85 - 0.22; py = 0.05 + t / 0.3 * 1.65 } else { const a2 = Math.PI - (t - 0.3) / 0.7 * (Math.PI * 1.12); px = Math.cos(a2) * 1.07; py = 1.7 + Math.sin(a2) * 1.07 } pts.push(V(ax + px + Math.sin(i * 1.3) * 0.04, py + Math.cos(i * 1.7) * 0.03, az + 0.2 + Math.sin(i * 0.9) * 0.05)) }
      const vine = tube(pts, 0.035, 0.018, 80, 5); add(new THREE.Mesh(vine.geo, surf({ set: 'wood', color: '#5e6a3a', fill: 0.34, min: 0.24 })))
      const lv: CardItem[] = []; for (let i = 0; i < 60; i++) { const p2 = vine.curve.getPointAt(i / 60); lv.push({ x: p2.x + (rnd(i, 801) - 0.5) * 0.12, y: p2.y - gw * 0.4, z: p2.z + 0.04, c: '%&;*'[i % 4], t: rnd(i, 802) > 0.85 ? [0.9, 0.8, 0.85] : [0.36, 0.64, 0.32].map(v => v * (0.8 + rnd(i, 803) * 0.4)), p: i * 0.7 }) }
      for (let i = 0; i < 9; i++) { const p2 = vine.curve.getPointAt(0.35 + i * 0.06), n = 2 + Math.floor(rnd(i, 804) * 4); for (let d = 0; d < n; d++) lv.push({ x: p2.x, y: p2.y - (d + 1) * gw * 0.9, z: p2.z + 0.05, c: d % 2 ? ';' : '|', t: [0.38, 0.62, 0.34], p: i }) }
      addCards(lv, { sway: 0.08 })
    }
  }

  // rest day: the hobbit home (page 43; the approved dragons door with a window and a centre knob)
  const lampLocal = V(1.58, 1.05, 1.9)
  if (opts.door) {
    const dz = -1.75, dx = pathX(dz), hz = dz - 0.95, fz = dz - 0.02
    const turf = surf({ set: 'turf', color: '#86b05a', fill: 0.32, min: 0.26 }), stoneM = surf({ set: 'stone', color: '#a8a48e', fill: 0.3, min: 0.26 })
    const plaster = surf({ set: 'plaster', color: '#d9c48c', fill: 0.42, min: 0.3 }), timber = surf({ set: 'wood', color: '#8a5a34', fill: 0.36, min: 0.26 })
    const brick = surf({ set: 'brick', color: '#a07050', fill: 0.34, min: 0.26 })
    const hill = new THREE.SphereGeometry(1, 36, 16, 0, Math.PI * 2, 0, Math.PI / 2); hill.scale(2.9, 1.45, 1.5)
    { const p = hill.attributes.position, v = V(0, 0, 0); for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const k = 1 + 0.05 * Math.sin(v.x * 5 + v.z * 3); p.setXYZ(i, v.x * k, v.y * k, Math.min(v.z, dz - 0.06 - hz)) } hill.computeVertexNormals() }
    const hm = new THREE.Mesh(hill, turf); hm.position.set(dx, 0, hz); add(hm)
    const FW = 1.6, FH = 0.95, FA = 1.32
    const front = new THREE.Shape(); front.moveTo(-FW, 0); front.lineTo(FW, 0); front.lineTo(FW, FH); front.quadraticCurveTo(0, FA + (FA - FH), -FW, FH); front.lineTo(-FW, 0)
    const wall = new THREE.Mesh(new THREE.ShapeGeometry(front, 24), plaster); wall.position.set(dx, 0, fz); add(wall)
    const eavePts: THREE.Vector3[] = []; for (let i = 0; i <= 16; i++) { const t = i / 16, x = -FW - 0.12 + t * (2 * FW + 0.24), y = FH + (FA - FH) * 2 * (1 - (2 * t - 1) ** 2) * 0.5 + 0.06; eavePts.push(V(dx + x, y, fz + 0.1)) }
    const timberGeos = [tube(eavePts, 0.08, 0.08, 24, 6).geo, tube(eavePts.map(p => p.clone().add(V(0, 0.1, -0.08))), 0.07, 0.07, 24, 6).geo]
    for (const px of [-FW, -0.78, 0.78, FW]) { const b = new THREE.BoxGeometry(0.12, px === -FW || px === FW ? FH : FH + 0.2, 0.1); b.translate(dx + px, (px === -FW || px === FW ? FH : FH + 0.2) / 2, fz + 0.05); timberGeos.push(b.toNonIndexed()) }
    add(new THREE.Mesh(merged(timberGeos), timber))
    { const items: CardItem[] = []; eavePts.forEach((p, i) => { for (let k = 0; k < 3; k++) { const n = 1 + Math.floor(rnd(i, 300 + k) * 3); for (let d = 0; d < n; d++) items.push({ x: p.x + (k - 1) * 0.06, y: p.y + 0.12 - d * gw * 0.9, z: p.z + 0.04, c: d === n - 1 ? "'" : '|', t: [0.55, 0.78, 0.38].map(v => v * (1 - d * 0.15)), p: i + k }) } }); addCards(items, { sway: 0.08 }) }
    const DY = 0.56, DR = 0.5, ST = DOOR_STYLES.dragonsplus
    const ironM = surf({ set: 'metal', color: '#4a463e', fill: 0.3, min: 0.24 }), glowM = surf({ set: 'glow', color: '#ffc870', emissive: 1.6 })
    { const r1 = new THREE.Mesh(new THREE.TorusGeometry(DR + 0.17, 0.08, 8, 36), brick); r1.position.set(dx, DY, fz + 0.04); add(r1); const r2 = new THREE.Mesh(new THREE.TorusGeometry(DR + 0.05, 0.06, 8, 36), timber); r2.position.set(dx, DY, fz + 0.06); add(r2) }
    const leafG = new THREE.CircleGeometry(DR, 48); { const p = leafG.attributes.position; for (let i = 0; i < p.count; i++) if (p.getY(i) < -DR + 0.05) p.setY(i, -DR + 0.05) }
    const door = new THREE.Mesh(leafG, surf({ set: 'plank', color: ST.leaf, fill: 0.42, min: 0.36, emissive: 0.18, pattern: ST.mask ? doorMask(ST.mask) : null, patR: DR, patCol: '#2a2622' })); door.position.set(dx, DY, fz + 0.05); add(door)
    { const st: THREE.BufferGeometry[] = []; for (let k = 0; k < 16; k++) { const a2 = k / 16 * Math.PI * 2; if (Math.sin(a2) < -0.85) continue; const g2 = new THREE.SphereGeometry(0.03, 6, 4); g2.translate(dx + Math.cos(a2) * (DR + 0.07), DY + Math.sin(a2) * (DR + 0.07), fz + 0.15); st.push(g2.toNonIndexed()) } add(new THREE.Mesh(merged(st), surf({ set: 'metal', color: '#6a645a', fill: 0.3, min: 0.3 }))) }
    const brass = surf({ set: 'glow', color: '#E8C860', emissive: 1.3 })
    { const k2 = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), brass); k2.position.set(dx, DY - 0.01, fz + 0.1); add(k2) }
    { const k4 = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.014, 6, 16), brass); k4.position.set(dx, DY - 0.11, fz + 0.1); add(k4) }
    {
      const ww = 0.12, wb = DY + 0.2, sh = new THREE.Shape()
      sh.moveTo(-ww, 0); sh.lineTo(ww, 0); sh.lineTo(ww, 0.06); sh.absarc(0, 0.06, ww, 0, Math.PI, false); sh.lineTo(-ww, 0)
      const w = new THREE.Mesh(new THREE.ShapeGeometry(sh, 12), glowM); w.position.set(dx, wb, fz + 0.07); add(w)
      const bars: THREE.BufferGeometry[] = []; const B = (a2: number[], b2: number[]) => bars.push(tube([V(dx + a2[0], wb + a2[1], fz + 0.09), V(dx + b2[0], wb + b2[1], fz + 0.09)], 0.011, 0.011, 2, 4).geo)
      B([-ww, 0.07], [ww, 0.07]); B([0, 0], [0, 0.17])
      const fr = new THREE.TorusGeometry(ww + 0.015, 0.014, 4, 16, Math.PI); fr.translate(dx, wb + 0.06, fz + 0.085); bars.push(fr.toNonIndexed())
      add(new THREE.Mesh(merged(bars), ironM))
    }
    for (const sx of [-1, 1]) {
      const wx = dx + sx * 1.19, wy = 0.6; lightPts.push({ x: wx, y: wy, z: fz + 0.12, r: 1.1 })
      const fr = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.055, 6, 24), timber); fr.position.set(wx, wy, fz + 0.06); add(fr)
      const w = new THREE.Mesh(new THREE.CircleGeometry(0.21, 20), surf({ set: 'glow', color: '#ffc870', emissive: 1.5 })); w.position.set(wx, wy, fz + 0.04); add(w)
      add(new THREE.Mesh(merged([tube([V(wx - 0.21, wy, fz + 0.07), V(wx + 0.21, wy, fz + 0.07)], 0.018, 0.018, 2, 4).geo, tube([V(wx, wy - 0.21, fz + 0.07), V(wx, wy + 0.21, fz + 0.07)], 0.018, 0.018, 2, 4).geo]), timber))
      const sill = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, 0.12), stoneM); sill.position.set(wx, wy - 0.3, fz + 0.08); add(sill)
      const fl: CardItem[] = []; for (let k = 0; k < 6; k++) fl.push({ x: wx - 0.17 + k * 0.07, y: wy - 0.27, z: fz + 0.12, c: k % 2 ? '*' : 'o', t: [[0.95, 0.5, 0.55], [1.0, 0.85, 0.4], [0.9, 0.6, 0.9]][(k + (sx > 0 ? 1 : 0)) % 3], p: k }); addCards(fl, { sway: 0.1 })
    }
    {
      const st: THREE.BufferGeometry[] = []; for (const sx of [-1, 1]) for (let i = 0; i < 7; i++) { const t = i / 6, a = t * 0.9, x = dx + sx * (FW + 0.08 + Math.sin(a) * 0.9), z = fz + 0.06 + (1 - Math.cos(a)) * 0.9, hgt = FH * (0.85 - t * 0.6); const b = new THREE.BoxGeometry(0.2, hgt, 0.28); b.rotateY(-sx * a); b.translate(x, hgt / 2, z); st.push(b.toNonIndexed()) }
      for (let k = 0; k < 2; k++) { const b = new THREE.BoxGeometry(1.1 - k * 0.2, 0.07, 0.24); b.translate(dx, 0.035 + k * 0.07, fz + 0.36 - k * 0.2); st.push(b.toNonIndexed()) }
      for (let k = 0; k < 6; k++) { const z = fz + 0.62 + k * 0.32, c = new THREE.CylinderGeometry(0.17 + rnd(k, 330) * 0.05, 0.19, 0.04, 9); c.scale(1.3, 1, 0.8); c.translate(pathX(z) + (rnd(k, 331) - 0.5) * 0.2, 0.03, z); st.push(c.toNonIndexed()) }
      add(new THREE.Mesh(merged(st), stoneM))
    }
    const chim = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.6, 0.24), brick); chim.position.set(dx + 0.7, 1.55, hz - 0.15); add(chim)
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.06, 0.32), stoneM); cap.position.set(dx + 0.7, 1.87, hz - 0.15); add(cap)
    lightPts.push({ x: dx, y: DY + 0.28, z: fz + 0.12, r: 0.8 })
    glintPts.push([dx + 0.02, DY + 0.03, fz + 0.18], [dx + 0.04, DY - 0.08, fz + 0.16], [dx - DR * 0.45, DY + 0.32, fz + 0.12], [dx + DR * 0.45, DY + 0.32, fz + 0.12], [dx + (DR + 0.07) * Math.cos(0.5), DY + (DR + 0.07) * Math.sin(0.5), fz + 0.18], [dx + (DR + 0.07) * Math.cos(2.4), DY + (DR + 0.07) * Math.sin(2.4), fz + 0.18])
    const smoke: CardItem[] = [], cw2 = gw * 0.62; for (let i = 0; i < 18; i++) for (const [ox, oy] of [[0, 0], [-0.9, 0.35], [0.9, 0.3], [0.1, 0.8], [-0.5, -0.4], [0.6, -0.35]]) smoke.push({ x: dx + 0.7, y: 1.92, z: hz - 0.15, c: 'o', o: [ox * cw2, oy * gw], t: [0.82, 0.84, 0.82].map(v => v * (0.8 + rnd(i, 611) * 0.25)), p: i / 18 })
    out.smoke = addCards(smoke, { rise: 2.6, smoke: 1, sway: 0 })
    mossOak(dx - 1.2, hz - 0.55, 1.7, 41, null, 1.05)
    { const iv: CardItem[] = []; for (let i = 0; i < 9; i++) { const x = dx - FW + 0.05 + rnd(i, 340) * 0.5, n = 2 + Math.floor(rnd(i, 341) * 5); for (let d = 0; d < n; d++) iv.push({ x: x + Math.sin(d * 1.3 + i) * 0.03, y: FH + 0.15 - d * gw * 0.9, z: fz + 0.1, c: d % 2 ? ';' : '%', t: [0.35, 0.62, 0.32], p: i }) } addCards(iv, { sway: 0.05 }) }
    { const fl: CardItem[] = []; for (let i = 0; i < 70; i++) { const a = rnd(i, 350) * Math.PI * 2, r = 0.35 + rnd(i, 351) * 0.6, lx = Math.cos(a) * r * 2.9, lz = Math.min(Math.sin(a) * r * 1.5, dz - 0.15 - hz), q = 1 - (lx / 2.9) ** 2 - (lz / 1.5) ** 2; if (q <= 0.02) continue; fl.push({ x: dx + lx, y: Math.sqrt(q) * 1.45, z: hz + lz, c: rnd(i, 352) > 0.5 ? '*' : '.', t: [[1.0, 0.85, 0.4], [0.95, 0.55, 0.6], [0.95, 0.95, 1.0]][i % 3], p: i }) } addCards(fl, { sway: 0.2 }) }
    { const mu: CardItem[] = []; ([[-1.85, 0.2], [-2.05, 0.45], [1.9, 0.35], [2.1, 0.7], [-0.75, 0.55]] as const).forEach(([mx, mz], i) => mu.push({ x: dx + mx, z: fz + mz, c: 'n', t: i % 2 ? [0.95, 0.4, 0.35] : [0.9, 0.85, 0.7], p: i })); addCards(mu, { sway: 0 }) }
    if (opts.fence) {
      const fence: THREE.BufferGeometry[] = []; for (const sx of [-1, 1]) for (let k = 0; k < 5; k++) { const fx = dx + sx * (0.6 + k * 0.34), fz2 = dz + 1.55; fence.push(tube([V(fx, 0, fz2), V(fx, 0.42, fz2)], 0.035, 0.03, 2, 5).geo) }
      for (const sx of [-1, 1]) for (const hy of [0.16, 0.34]) fence.push(tube([V(dx + sx * 0.6, hy, dz + 1.55), V(dx + sx * 1.96, hy, dz + 1.55)], 0.022, 0.022, 2, 4).geo)
      add(new THREE.Mesh(merged(fence), rail))
    }
    { const fl: CardItem[] = []; for (let i = 0; i < 40; i++) { const sx = i % 2 ? 1 : -1, fx = dx + sx * (0.65 + rnd(i, 401) * 1.3), fz2 = dz + 1.25 + rnd(i, 402) * 0.25; fl.push({ x: fx, z: fz2, c: '*o*.'[i % 4], t: [[1.0, 0.82, 0.4], [0.95, 0.5, 0.45], [0.9, 0.9, 0.95]][i % 3], p: i }) } addCards(fl, { sway: 0.15 }) }
    lampLocal.set(dx, 0.9, dz + 0.9)
  }

  // grass and moss tufts, kept off the path (in two halves so each culls on its own)
  {
    const N = opts.grass, GL = gi("/\\|',;")
    const halves: Array<{ xs: number[]; mats: THREE.Matrix4[]; g: number[]; p: number[]; t: number[] }> = [{ xs: [], mats: [], g: [], p: [], t: [] }, { xs: [], mats: [], g: [], p: [], t: [] }]
    let n = 0
    for (let i = 0; n < N && i < N * 4; i++) {
      const x = (rnd(i, 11) - 0.5) * 14, z = -11 + rnd(i, 12) * 30
      if (onPath(x, z, 0.05) || inPond(x, z, 0.05)) continue
      if (Math.sin(x * 0.7) + Math.cos(z * 0.9 + x * 0.3) < -0.9) continue
      const h = halves[z < 4 ? 0 : 1]
      h.mats.push(new THREE.Matrix4().makeTranslation(x, 0, z)); h.g.push(GL[Math.floor(rnd(i, 13) * GL.length)]); h.p.push(rnd(i, 14) * 6.28)
      const k = 0.6 + rnd(i, 15) * 0.6; h.t.push(0.36 * k, 0.7 * k, 0.36 * k); n++
    }
    for (const h of halves) {
      const cnt = h.mats.length; if (!cnt) continue
      const geo = new THREE.PlaneGeometry(1, 1), mesh = new THREE.InstancedMesh(geo, card({ w: gw * 0.62, h: gw, sway: 0.5 }), cnt)
      const box = new THREE.Box3()
      h.mats.forEach((m, i) => { mesh.setMatrixAt(i, m); box.expandByPoint(new THREE.Vector3().setFromMatrixPosition(m)) })
      geo.setAttribute('aGlyph', new THREE.InstancedBufferAttribute(new Float32Array(h.g), 1)); geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(new Float32Array(h.p), 1)); geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(new Float32Array(h.t), 3)); geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(new Float32Array(cnt * 2), 2))
      const sphere = box.getBoundingSphere(new THREE.Sphere()); sphere.radius += 0.8; mesh.boundingSphere = sphere
      add(mesh); out.grass.push({ mesh, n: cnt })
    }
  }
  // fireflies (progress light)
  {
    const FN = 24, items: CardItem[] = []
    for (let i = 0; i < FN; i++) items.push({ x: (rnd(i, 21) - 0.5) * 8, y: 0.4 + rnd(i, 22) * 1.8, z: 1 - rnd(i, 23) * 9, c: '*', t: [0.85, 0.95, 0.5], p: rnd(i, 24) * 6.28 })
    out.flies = addCards(items, { w: gw * 0.7, h: gw, glow: 1, fly: 1, sway: 0 })
  }
  // THE lantern on a post (the door scene hangs it off the wall instead)
  {
    const lx = opts.door ? pathX(-1.75) + 0.78 : 1.2, lz = opts.door ? -1.6 : 1.6
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.4, 0.12), rail); post.position.set(lx, 0.7, lz); if (!opts.door) add(post)
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.07, 0.07), rail); arm.position.set(lx + 0.19, 1.37, lz); add(arm)
    const LANTERN = [' | ', '_^_', '[_]', '|@|', '[_]']
    const frame: CardItem[] = [], fire: CardItem[] = [], cw = gw * 0.62, ch = gw
    LANTERN.forEach((row, r) => [...row].forEach((c, k) => { if (c === ' ') return; const it: CardItem = { x: lx + 0.38, y: 1.02, z: lz + 0.02, c, o: [(k - 1) * cw, (2 - r) * ch], t: c === '@' ? [1.0, 0.85, 0.45] : [0.95, 0.78, 0.45], p: 0 }; (c === '@' ? fire : frame).push(it) }))
    frame.forEach((it, i) => (it.p = i * 1.3)); fire.forEach((it, i) => (it.p = i * 1.3))
    addCards(frame, { w: cw, h: ch, sway: 0 }); addCards(fire, { w: cw, h: ch, sway: 0, glow: 1 })
    lightPts.push({ x: lx + 0.38, y: 1.1, z: lz + 0.1, r: 1.3 }); glintPts.push([lx + 0.38, 1.32, lz + 0.12], [lx + 0.19, 1.4, lz + 0.05])
  }
  // touches that apply to every scene: light spill under each light, a halo in the air, fireflies at lights, glints on metal
  {
    const items: CardItem[] = []
    lightPts.forEach((L, j) => { for (let i = 0; i < 80; i++) { const a = rnd(i + j * 50, 700) * Math.PI, rr = Math.sqrt(rnd(i + j * 50, 701)) * L.r * 1.3, x = L.x + Math.cos(a) * rr * 1.2, z = L.z + 0.1 + Math.sin(a) * rr * 1.6; const k = 1 - rr / L.r; if (onPath(x, z, 0.0) && rnd(i, 702) > 0.6) continue; items.push({ x, y: 0.06, z, c: k > 0.6 ? '=' : (k > 0.3 ? '-' : '.'), t: [1.0, 0.8, 0.45].map(v => v * (0.6 + 1.4 * k)), p: j * 1.7 }) } })
    lightPts.forEach((L, j) => { for (let i = 0; i < 110; i++) { const a = rnd(i + j * 70, 730) * Math.PI * 2, rr = L.r * (0.2 + Math.sqrt(rnd(i + j * 70, 731)) * 0.38), k = 1 - (rr - L.r * 0.2) / (L.r * 0.38); items.push({ x: L.x + Math.cos(a) * rr, y: L.y + Math.sin(a) * rr * 0.85 - gw * 0.5, z: L.z + 0.18, c: k > 0.55 ? '*' : '.', t: [1.0, 0.92, 0.7].map(v => v * (0.5 + 1.0 * k)), p: j * 1.7 }) } })
    out.spill = addCards(items, { spill: 1, sway: 0 })
  }
  { const items: CardItem[] = []; lightPts.forEach((L, j) => { for (let i = 0; i < 5; i++) items.push({ x: L.x + (rnd(i + j * 9, 710) - 0.5) * 0.9, y: Math.max(0.25, L.y + (rnd(i + j * 9, 711) - 0.4) * 0.7), z: L.z + 0.2 + rnd(i + j * 9, 712) * 0.6, c: rnd(i, 713) > 0.5 ? '*' : '+', t: [0.85, 1.0, 0.55], p: rnd(i + j * 9, 714) * 6.28 }) }); out.lightFlies = addCards(items, { glow: 1, fly: 1, sway: 0, w: gw * 0.55, h: gw * 0.8 }) }
  { const items: CardItem[] = glintPts.map(([x, y, z], i) => ({ x, y: y - gw * 0.5, z, c: i % 2 ? '+' : '*', t: [1.0, 0.95, 0.8], p: rnd(i, 720) })); addCards(items, { glint: 1, sway: 0, w: gw * 0.9, h: gw * 1.2 }) }

  // the pond's reflection: everything in this scene mirrored below the ground; only the hole in the ground shows it
  if (POND_ON) {
    const mir = new THREE.Group()
    group.children.slice().forEach(o => { if (o.userData.noMirror) return; const m = o as THREE.Mesh; if (m.geometry && m.geometry.type === 'ShapeGeometry') return; const c = o.clone(); o.userData.twin = c; mir.add(c) })
    mir.scale.y = -1; mir.userData.noMirror = true; add(mir)
    anims.push((t) => { mir.position.x = Math.sin(t * 0.55) * 0.035 + Math.sin(t * 1.3) * 0.012; mir.scale.y = -1 - Math.sin(t * 0.4) * 0.012 })
    out.mirror = mir
  }

  // breathing lights: the brightest emissive materials (windows, the door light, the brass)
  out.breath = surfaces.filter(m => (m.uniforms.uEmissive.value as number) >= 1.3).map(m => [m, m.uniforms.uEmissive.value as number])
  ;(group.userData as { lamp: THREE.Vector3 }).lamp = lampLocal

  out.dispose = () => {
    const seen = new Set<unknown>()
    group.traverse(o => {
      const m = o as THREE.Mesh
      if (m.geometry && !seen.has(m.geometry)) { seen.add(m.geometry); m.geometry.dispose() }
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : []
      for (const mat of mats) if (!seen.has(mat)) { seen.add(mat); const u = (mat as THREE.ShaderMaterial).uniforms; const pat = u?.uPat?.value as THREE.Texture | undefined; if (pat && pat.image) pat.dispose(); mat.dispose() }
    })
  }
  return out
}

/** Glyph sets the scene builder relies on exist (they're in materials.ts). */
export const _SETS_USED = SETS
