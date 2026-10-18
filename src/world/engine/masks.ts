// Canvas masks the glyph shader turns into iron or carving (mockups shared/ascii3d-14.js, ported as-is):
// the hobbit door's ironwork (door-references.md) and the rune-etched arch.

import * as THREE from 'three'

type Ctx = CanvasRenderingContext2D

function canvas(S = 512): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas'); c.width = c.height = S
  const x = c.getContext('2d') as Ctx
  x.strokeStyle = '#000'; x.fillStyle = '#000'; x.lineCap = 'round'; x.lineJoin = 'round'
  return [c, x]
}
function toTexture(c: HTMLCanvasElement): THREE.CanvasTexture { const t = new THREE.CanvasTexture(c); t.needsUpdate = true; return t }

// Two wrought-iron strap hinges ending in curling scrolls (refs 03, 06, 08).
function ironworkMask(): THREE.CanvasTexture {
  const S = 512, [c, x] = canvas(S)
  const spiral = (cx: number, cy: number, r0: number, a0: number, turns: number, dir: number, w: number) => { x.lineWidth = w; x.beginPath(); const n = 80; for (let i = 0; i <= n; i++) { const t = i / n, a = a0 + dir * t * turns * Math.PI * 2, r = r0 * (1 - t * 0.82); const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r; if (i) x.lineTo(px, py); else x.moveTo(px, py) } x.stroke() }
  for (const [y, d] of [[S * 0.36, -1], [S * 0.66, 1]]) {
    x.lineWidth = 40; x.beginPath(); x.moveTo(S * 1.0, y); x.lineTo(S * 0.62, y); x.stroke()
    x.lineWidth = 30; x.beginPath(); x.moveTo(S * 0.62, y); x.quadraticCurveTo(S * 0.4, y, S * 0.3, y + d * S * 0.06); x.stroke()
    spiral(S * 0.24, y + d * S * 0.12, S * 0.095, -d * Math.PI * 0.35, 1.25, -d, 22)
    x.lineWidth = 18; x.beginPath(); x.moveTo(S * 0.66, y); x.quadraticCurveTo(S * 0.6, y - d * S * 0.13, S * 0.5, y - d * S * 0.14); x.stroke()
    spiral(S * 0.46, y - d * S * 0.1, S * 0.055, Math.PI * (d > 0 ? 1.6 : 0.4), 1.1, d, 15)
    x.lineWidth = 10; x.beginPath(); x.moveTo(S * 0.52, y + d * S * 0.005); x.quadraticCurveTo(S * 0.48, y + d * S * 0.09, S * 0.41, y + d * S * 0.1); x.stroke()
    spiral(S * 0.39, y + d * S * 0.07, S * 0.03, Math.PI * (d > 0 ? 0.5 : 1.5), 1.0, -d, 8)
    for (let k = 0; k < 4; k++) { x.beginPath(); x.arc(S * (0.94 - k * 0.09), y, 9, 0, Math.PI * 2); x.fill() }
  }
  x.lineWidth = 16; x.beginPath(); x.moveTo(S * 0.14, S * 0.44); x.lineTo(S * 0.14, S * 0.56); x.stroke()
  return toTexture(c)
}

/** Door ironwork, one per style. Only the approved dragons door is used in the app; the rest stay for parity with the mockup engine. */
export function doorMask(kind: string): THREE.CanvasTexture {
  if (kind === 'scroll') return ironworkMask()
  const S = 512, [c, x] = canvas(S)
  const L = (w: number, pts: number[][]) => { x.lineWidth = w; x.beginPath(); pts.forEach(([a, b], i) => (i ? x.lineTo(a * S, b * S) : x.moveTo(a * S, b * S))); x.stroke() }
  const Q = (w: number, a: number[], b: number[], c2: number[], d?: number[]) => { x.lineWidth = w; x.beginPath(); x.moveTo(a[0] * S, a[1] * S); if (d) x.bezierCurveTo(b[0] * S, b[1] * S, c2[0] * S, c2[1] * S, d[0] * S, d[1] * S); else x.quadraticCurveTo(b[0] * S, b[1] * S, c2[0] * S, c2[1] * S); x.stroke() }
  const dot = (a: number, b: number, r: number) => { x.beginPath(); x.arc(a * S, b * S, r, 0, Math.PI * 2); x.fill() }
  const spiral = (cx: number, cy: number, r0: number, a0: number, turns: number, dir: number, w: number) => { x.lineWidth = w; x.beginPath(); for (let i = 0; i <= 80; i++) { const t = i / 80, a = a0 + dir * t * turns * Math.PI * 2, r = r0 * (1 - t * 0.82) * S; const px = cx * S + Math.cos(a) * r, py = cy * S + Math.sin(a) * r; if (i) x.lineTo(px, py); else x.moveTo(px, py) } x.stroke() }
  const mirror = (fn: () => void) => { fn(); x.save(); x.translate(S, 0); x.scale(-1, 1); fn(); x.restore() }
  if (kind === 'dragons') { // ref 09: two mirrored dragons, wings are the hinges, tails curl into the middle
    mirror(() => {
      x.lineWidth = 30; x.beginPath(); x.moveTo(0.3 * S, 0.22 * S); x.bezierCurveTo(0.12 * S, 0.35 * S, 0.14 * S, 0.7 * S, 0.34 * S, 0.74 * S); x.bezierCurveTo(0.44 * S, 0.76 * S, 0.47 * S, 0.66 * S, 0.44 * S, 0.6 * S); x.stroke()
      x.beginPath(); x.moveTo(0.44 * S, 0.6 * S); x.lineTo(0.47 * S, 0.54 * S); x.lineTo(0.41 * S, 0.58 * S); x.fill()
      x.beginPath(); x.moveTo(0.27 * S, 0.17 * S); x.lineTo(0.43 * S, 0.19 * S); x.lineTo(0.36 * S, 0.24 * S); x.lineTo(0.3 * S, 0.27 * S); x.fill()
      x.beginPath(); x.moveTo(0.28 * S, 0.17 * S); x.lineTo(0.24 * S, 0.1 * S); x.lineTo(0.31 * S, 0.16 * S); x.fill()
      for (let k = 0; k < 6; k++) { const t = k / 6, px = 0.21 - Math.sin(t * 2.6) * 0.02, py = 0.3 + t * 0.32; x.beginPath(); x.moveTo(px * S, py * S); x.lineTo((px - 0.04) * S, (py + 0.015) * S); x.lineTo(px * S, (py + 0.04) * S); x.fill() }
      x.beginPath(); x.moveTo(0.14 * S, 0.4 * S); x.lineTo(0.0, 0.2 * S); x.lineTo(0.04 * S, 0.36 * S); x.lineTo(0.0, 0.46 * S); x.lineTo(0.05 * S, 0.55 * S); x.lineTo(0.0, 0.66 * S); x.lineTo(0.15 * S, 0.6 * S); x.fill()
    })
  } else if (kind === 'strap' || kind === 'strapSmall') {
    const end = kind === 'strap' ? 0.2 : 0.42
    for (const y of [0.3, 0.7]) { L(30, [[1, y], [end, y]]); spiral(end - 0.03, y + 0.045, 0.05, -Math.PI * 0.5, 1.1, -1, 16); for (let k = 0; k < 5; k++) dot(0.9 - k * (0.9 - end) / 5, y, 7) }
  } else if (kind === 'rivets') {
    for (const px of [0.2, 0.4, 0.6, 0.8]) for (const py of [0.2, 0.5, 0.8]) dot(px, py, 8)
  } else if (kind === 'vine') {
    Q(14, [0.95, 0.3], [0.7, 0.15], [0.5, 0.35], [0.25, 0.3]); spiral(0.22, 0.25, 0.05, 0.3, 1.2, -1, 11)
    Q(14, [0.9, 0.72], [0.65, 0.88], [0.45, 0.62], [0.2, 0.7]); spiral(0.18, 0.66, 0.05, 0.6, 1.2, 1, 11)
  }
  return toTexture(c)
}

/** The door styles; the app uses the approved one, 'dragonsplus' (dragons, window, centre knob). */
export interface DoorStyle { leaf: string; mask: string | null; win: 'arch' | 'square' | null; bars?: 'cross' | 'grid' | 'diamond' | 'none'; frame: 'brick' | 'log' | 'stone' | 'wreath' | 'root'; studs?: boolean; knob: 'centre' | 'side' | 'ring' | 'rosette' | 'none'; knocker?: boolean }
export const DOOR_STYLES: Record<string, DoorStyle> = {
  dragonsplus: { leaf: '#c88a48', mask: 'dragons', win: 'arch', bars: 'cross', frame: 'brick', studs: true, knob: 'centre', knocker: true },
  scroll: { leaf: '#c88a48', mask: 'scroll', win: 'arch', bars: 'cross', frame: 'brick', studs: true, knob: 'centre' },
}

// Etched ruins on the arch: rune-like carvings along the curve and down the piers, and a few cracks.
// World→canvas mapping matches the arch: centre (ax, 1.36), half-size 1.4.
export function runeMask(seed: number): THREE.CanvasTexture {
  const S = 512, [c, x] = canvas(S)
  let k = seed; const R = () => { k = (k * 16807) % 2147483647; return k / 2147483647 }
  const W = (wx: number, wy: number): [number, number] => [(wx + 1.4) / 2.8 * S, (1 - (wy - 1.36 + 1.4) / 2.8) * S]
  const rune = (wx: number, wy: number, ang: number, sz: number) => {
    const [px, py] = W(wx, wy); x.save(); x.translate(px, py); x.rotate(ang); const h = sz * S / 2.8; x.lineWidth = 3.2; x.beginPath(); x.moveTo(0, -h / 2); x.lineTo(0, h / 2)
    const n = 1 + Math.floor(R() * 3); for (let i = 0; i < n; i++) { const y0 = (R() - 0.5) * h * 0.8, dir = R() > 0.5 ? 1 : -1, up = R() > 0.5 ? -1 : 1; x.moveTo(0, y0); x.lineTo(dir * h * 0.35, y0 + up * h * 0.3) }
    if (R() > 0.6) { x.moveTo(-h * 0.25, -h * 0.1); x.lineTo(h * 0.25, h * 0.15) } x.stroke(); x.restore()
  }
  for (let a = 0.18; a < Math.PI - 0.15; a += 0.21) rune(Math.cos(a) * 0.85, 1.7 + Math.sin(a) * 0.85, Math.PI / 2 - a, 0.15)
  for (const sx of [-1, 1]) for (let y = 0.25; y < 1.55; y += 0.2) rune(sx * 0.85, y, 0, 0.13)
  x.lineWidth = 2.5; x.beginPath(); for (let a = 0.1; a <= Math.PI - 0.1; a += 0.05) { const [px, py] = W(Math.cos(a) * 0.66, 1.7 + Math.sin(a) * 0.66); if (a < 0.12) x.moveTo(px, py); else x.lineTo(px, py) } x.stroke()
  x.lineWidth = 2; for (const [cx0, cy0] of [[0.55, 2.3], [-0.9, 1.1], [0.95, 0.6]]) { let [px, py] = W(cx0, cy0); x.beginPath(); x.moveTo(px, py); for (let i = 0; i < 6; i++) { px += (R() - 0.4) * 18; py += 8 + R() * 10; x.lineTo(px, py) } x.stroke() }
  return toTexture(c)
}
