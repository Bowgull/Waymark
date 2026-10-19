// The Waymark crest in 3D glyphs (page 08 / page 38): Logo.svg taken apart,
// each element extruded and printed in its material's glyphs. Ported from the
// mockups' buildShield; the stage animations (the splash suit-up, the loading
// crest taken apart) live in crestStage.ts.

import * as THREE from 'three'
import { SVGLoader } from 'three/examples/jsm/loaders/SVGLoader.js'

import logoSvg from '@/assets/brand/Logo.svg?raw'
import { surfaceMaterial, type SharedUniforms } from './materials'

export type CrestLayer = 'body' | 'rimDark' | 'bossField' | 'rim' | 'marks' | 'arch' | 'tip' | 'boss' | 'eye' | 'centre' | 'cut'

/** The paint as Logo.svg wrote it (url(#sgold)), kept aside by svgForLoader. */
const paint = (node: Element, attr: 'fill' | 'stroke') => node.getAttribute(`data-${attr}`) || node.getAttribute(attr) || ''

function classify(node: Element): CrestLayer {
  const f = paint(node, 'fill'), s = paint(node, 'stroke'), d = node.getAttribute('d') || '', tag = node.tagName
  if (tag === 'circle' && node.getAttribute('cy') === '259') return 'centre'
  if (tag === 'circle' && s.includes('sgold')) return 'boss'
  if (tag === 'circle') return 'bossField'
  if (f.includes('seye') || d.startsWith('M250,192') || d.startsWith('M250,21')) return 'eye'
  if (tag === 'rect') return 'arch'
  if (s.includes('sgold') && tag === 'path') return 'rim'
  if (s && tag === 'path') return 'rimDark'
  if (d.includes('L250,5')) return 'tip'
  if (tag === 'line') return 'cut'
  if (tag === 'path' && d.includes(' L') && d.length < 60) return 'marks'
  return 'body'
}
const FILL: Record<string, string> = { 'url(#sbody)': '#2f6a54', 'url(#sgold)': '#D8B048', 'url(#seye)': '#2aa07a', 'url(#sinner)': '#1f4a3c' }
/**
 * Logo.svg for SVGLoader: its gradient paints (url(#sgold)) become their flat
 * colours, the original kept in data-fill / data-stroke for classify(), and the
 * drop-shadow filter goes. SVGLoader can't read url() paints and warned about
 * every one on each load (e2e minor 26: ~50 "url access" / "Unknown color
 * model" console warnings).
 */
export function svgForLoader(svg: string): string {
  return svg
    .replace(/\s(fill|stroke)="(url\(#\w+\))"/g, (_m, attr: string, url: string) => ` ${attr}="${FILL[url] ?? '#163a2e'}" data-${attr}="${url}"`)
    .replace(/\sfilter="url\(#\w+\)"/g, '')
}

const LAYER_SET: Record<string, string> = { body: 'stone', rimDark: 'stone', bossField: 'stone', rim: 'metal', marks: 'metal', arch: 'metal', tip: 'metal', boss: 'metal', eye: 'eye', centre: 'metal' }

function offsetRing(points: THREE.Vector2[], half: number): THREE.Shape {
  const out: THREE.Vector2[] = [], inn: THREE.Vector2[] = []
  for (let i = 0; i < points.length; i++) {
    const a = points[(i - 1 + points.length) % points.length], b = points[(i + 1) % points.length]
    const tx = b.x - a.x, ty = b.y - a.y, l = Math.hypot(tx, ty) || 1, nx = -ty / l, ny = tx / l
    out.push(new THREE.Vector2(points[i].x + nx * half, points[i].y + ny * half))
    inn.push(new THREE.Vector2(points[i].x - nx * half, points[i].y - ny * half))
  }
  const area = (pts: THREE.Vector2[]) => Math.abs(THREE.ShapeUtils.area(pts))
  const [o, i] = area(out) >= area(inn) ? [out, inn] : [inn, out]
  const shape = new THREE.Shape(o); shape.holes.push(new THREE.Path(i)); return shape
}

export interface CrestPiece extends THREE.Mesh<THREE.ExtrudeGeometry, THREE.ShaderMaterial> {
  userData: { layer: CrestLayer; order: number; depth: number; home?: THREE.Vector3; homeRz?: number; off?: { x: number; y: number; z: number; rz: number }; arrive?: number }
}

export function buildShield(shared: SharedUniforms, worldGlyph: number): { holder: THREE.Group; group: THREE.Group; pieces: CrestPiece[]; S: number } {
  const data = new SVGLoader().parse(svgForLoader(logoSvg))
  const group = new THREE.Group(), S = 3.1 / 560
  group.scale.set(S, -S, S)
  const pieces: CrestPiece[] = []; let order = 0
  for (const path of data.paths) {
    const node = (path.userData as { node: Element }).node, layer = classify(node)
    if (layer === 'cut') continue
    const style = (path.userData as { style: { strokeWidth?: number } }).style, fillStr = paint(node, 'fill'), strokeStr = paint(node, 'stroke')
    order++
    let shapes: THREE.Shape[] = []
    if (strokeStr && strokeStr !== 'none' && (!fillStr || fillStr === 'none')) {
      const w = parseFloat(node.getAttribute('stroke-width') || String(style.strokeWidth ?? 4))
      for (const sp of path.subPaths) shapes.push(offsetRing(sp.getPoints(160), w / 2))
    } else shapes = SVGLoader.createShapes(path)
    if (!shapes.length) continue
    const color = FILL[fillStr] || FILL[strokeStr] || (fillStr.startsWith('#') ? fillStr : strokeStr.startsWith('#') ? strokeStr : '#163a2e')
    const depth = 6 + order * 0.9 + (({ rim: 10, marks: 14, arch: 10, boss: 12, centre: 16, tip: 8, eye: 6 } as Record<string, number>)[layer] ?? 0)
    const geo = new THREE.ExtrudeGeometry(shapes, { depth, bevelEnabled: layer !== 'body', bevelThickness: 2, bevelSize: 1.2, bevelSegments: 1, curveSegments: 24 })
    const isDark = /^#0[0-9A-F]/i.test(color) && layer !== 'eye'
    const mat = surfaceMaterial(shared, {
      set: LAYER_SET[layer], color: isDark ? '#1d4235' : color, scale: worldGlyph / S, arcCx: 250, arcCy: 252,
      emissive: 0, boost: layer === 'centre' ? 1.4 : (isDark ? 1.8 : 1), fill: isDark ? 0.3 : 0.16, min: isDark ? 0.4 : 0.15,
    })
    const mesh = new THREE.Mesh(geo, mat) as unknown as CrestPiece
    mesh.userData = { layer, order, depth }
    group.add(mesh); pieces.push(mesh)
  }
  const holder = new THREE.Group(); group.position.set(-250 * S, 280 * S, 0); holder.add(group)
  return { holder, group, pieces, S }
}
