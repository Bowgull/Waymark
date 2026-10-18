// The glyph materials of the page-14 engine (mockups shared/ascii3d-14.js),
// ported as-is: a real lit scene with characters printed on every surface,
// one glyph set per material, density following the light; camera-facing
// glyph cards for grass, moss, mist, motes, smoke, rain; the sky printed on
// the screen grid. Only the code shape changed (TypeScript, shared atlas).

import * as THREE from 'three'

// ── Glyph atlas: printable ASCII 32..127 in a 16×6 grid, drawn once ──
let ATLAS: THREE.CanvasTexture | null = null
export async function glyphAtlas(): Promise<THREE.CanvasTexture> {
  if (ATLAS) return ATLAS
  try { await document.fonts.load('700 40px "JetBrains Mono Variable"') } catch { /* the bundled font may not be ready; fall back */ }
  const cw = 40, ch = 60, cv = document.createElement('canvas')
  cv.width = cw * 16; cv.height = ch * 6
  const g = cv.getContext('2d') as CanvasRenderingContext2D
  g.fillStyle = '#fff'
  g.font = '700 46px "JetBrains Mono Variable", "JetBrains Mono", Menlo, Consolas, monospace'
  g.textAlign = 'center'; g.textBaseline = 'middle'
  for (let i = 0; i < 96; i++) g.fillText(String.fromCharCode(32 + i), (i % 16) * cw + cw / 2, Math.floor(i / 16) * ch + ch / 2 + 2)
  const tex = new THREE.CanvasTexture(cv)
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.anisotropy = 4
  ATLAS = tex
  return tex
}

/** A string's characters as atlas indices. */
export const gi = (s: string): number[] => [...s].map(c => c.charCodeAt(0) - 32)

// glyph sets, ordered dark → bright (density follows light)
export const SETS: Record<string, number[]> = {
  stone: gi('.:-=+*#%@@'), metal: gi('.:;=+*x#%@'), foliage: gi(' .,:;^*AA#'), soil: gi('  ..,,\':;'),
  snow: gi('..:^^**#'), eye: gi('.:oO0@@@@'), rune: gi('<>YX|'), glow: gi('.+*@'),
  moss: gi(".,;:'%&&@#"), road: gi("  ..,,:;'"), wood: gi('.:-=+=#'),
  turf: gi(" .,':;\"vwW"), plank: gi('..::||||||'), plaster: gi('   ..,::-='), brick: gi('.:=#=#=#[]'),
}
function padSet(a: number[]): number[] { const out = a.slice(0, 10); while (out.length < 10) out.push(out[out.length - 1]); return out }

const BLANK = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1); BLANK.needsUpdate = true
const HASH = 'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }'

/** Uniforms every glyph material shares (one object; the world updates it each frame). */
export interface SharedUniforms {
  [k: string]: THREE.IUniform
  uAtlas: THREE.IUniform<THREE.Texture>
  uTime: THREE.IUniform<number>
  uWind: THREE.IUniform<number>
  uAscii: THREE.IUniform<number>
  uExposure: THREE.IUniform<number>
  uMoonDir: THREE.IUniform<THREE.Vector3>
  uMoonCol: THREE.IUniform<THREE.Color>
  uLampPos: THREE.IUniform<THREE.Vector3>
  uLampCol: THREE.IUniform<THREE.Color>
  uLamp: THREE.IUniform<number>
  uFogCol: THREE.IUniform<THREE.Color>
  uFogNear: THREE.IUniform<number>
  uFogFar: THREE.IUniform<number>
}

export function makeShared(atlas: THREE.Texture, lamp = 1.6): SharedUniforms {
  return {
    uAtlas: { value: atlas }, uTime: { value: 0 }, uWind: { value: 0 }, uAscii: { value: 1 }, uExposure: { value: 1 },
    uMoonDir: { value: new THREE.Vector3(-0.35, 0.6, 0.75).normalize() }, uMoonCol: { value: new THREE.Color('#8fb8c8') },
    uLampPos: { value: new THREE.Vector3(1.6, 1.4, 1.6) }, uLampCol: { value: new THREE.Color('#ffd38a') }, uLamp: { value: lamp },
    uFogCol: { value: new THREE.Color('#041510') }, uFogNear: { value: 30 }, uFogFar: { value: 58 },
  }
}

export interface SurfaceOpts {
  set?: string
  color?: string
  scale: number
  emissive?: number
  fill?: number
  snow?: number
  pattern?: THREE.Texture | null
  patR?: number
  patC?: [number, number]
  patCol?: string
  min?: number
  show?: number
  arcCx?: number
  arcCy?: number
  boost?: number
}

export function surfaceMaterial(shared: SharedUniforms, o: SurfaceOpts): THREE.ShaderMaterial {
  const set = SETS[o.set ?? 'stone']
  const uniforms = {
    ...shared,
    uColor: { value: new THREE.Color(o.color ?? '#2D6B4F') },
    uScale: { value: o.scale }, uSet: { value: padSet(set) }, uCount: { value: set.length },
    uEmissive: { value: o.emissive ?? 0 }, uFill: { value: o.fill ?? 0.16 }, uSnow: { value: o.snow ?? 0 },
    uPat: { value: o.pattern ?? BLANK }, uPatOn: { value: o.pattern ? 1 : 0 }, uPatR: { value: o.patR ?? 1 }, uPatC: { value: new THREE.Vector2(...(o.patC ?? [0, 0])) }, uPatCol: { value: new THREE.Color(o.patCol ?? '#1c1a17') },
    uMin: { value: o.min ?? 0 }, uShow: { value: o.show ?? 1 }, uArc: { value: 2 }, uArcCenter: { value: new THREE.Vector2(o.arcCx ?? 0, o.arcCy ?? 0) }, uBoost: { value: o.boost ?? 1 },
  }
  return new THREE.ShaderMaterial({
    uniforms, side: THREE.DoubleSide,
    vertexShader: `
      varying vec3 vObj; varying vec3 vObjN; varying vec3 vWorld; varying vec3 vWorldN; varying float vDepth;
      void main(){
        vObj = position; vObjN = normal;
        vec4 w = modelMatrix * vec4(position,1.0); vWorld = w.xyz;
        vWorldN = normalize(mat3(modelMatrix) * normal);
        // a mirrored copy (the pond's reflection) is lit exactly like the real thing above the water
        if (determinant(mat3(modelMatrix)) < 0.0) { vWorld.y = -vWorld.y; vWorldN.y = -vWorldN.y; }
        vec4 mv = viewMatrix * w; vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D uAtlas; uniform vec3 uColor; uniform float uScale; uniform float uSet[10]; uniform int uCount;
      uniform vec3 uMoonDir; uniform vec3 uMoonCol; uniform vec3 uLampPos; uniform vec3 uLampCol; uniform float uLamp;
      uniform float uEmissive; uniform float uFill; uniform float uSnow; uniform float uAscii; uniform float uExposure;
      uniform float uMin; uniform float uShow; uniform float uArc; uniform vec2 uArcCenter; uniform float uBoost; uniform float uTime;
      uniform vec3 uFogCol; uniform float uFogNear; uniform float uFogFar;
      uniform sampler2D uPat; uniform float uPatOn; uniform float uPatR; uniform vec3 uPatCol; uniform vec2 uPatC;
      varying vec3 vObj; varying vec3 vObjN; varying vec3 vWorld; varying vec3 vWorldN; varying float vDepth;
      ${HASH}
      void main(){
        vec3 an = abs(vObjN);
        vec2 p = (an.z >= an.x && an.z >= an.y) ? vObj.xy : ((an.x >= an.y) ? vObj.zy : vObj.xz);
        vec2 gpos = p / vec2(uScale * 0.62, uScale);
        vec2 cell = floor(gpos); vec2 f = fract(gpos);
        float h = hash(cell);
        if (h > uShow) discard;
        float ang = abs(atan(vObj.y - uArcCenter.y, abs(vObj.x - uArcCenter.x))) / 1.5708;
        if (ang > uArc) discard;
        vec3 n = normalize(vWorldN); if (!gl_FrontFacing) n = -n;
        float moon = max(dot(n, normalize(uMoonDir)), 0.0);
        vec3 L = uLampPos - vWorld; float d = length(L);
        float lamp = max(dot(n, L / d), 0.0) * uLamp / (1.0 + d * d * 0.35);
        vec3 light = vec3(0.16, 0.21, 0.19) + uMoonCol * moon * 1.35 + uLampCol * lamp;
        vec3 base = uColor;
        if (uSnow > 0.0) base = mix(base, vec3(0.80, 0.88, 0.85), smoothstep(uSnow, uSnow + 0.8, vWorld.y));
        vec3 lit = base * light * uBoost;
        float lum = dot(lit, vec3(0.3, 0.59, 0.11)) * 3.2 + uEmissive * 0.6;
        float level = clamp(max(lum, uMin) + (h - 0.5) * 0.22, 0.0, 0.999);
        float g = uSet[int(level * float(uCount))];
        float pm = uPatOn > 0.5 ? texture2D(uPat, (vObj.xy - uPatC) / (2.0 * uPatR) + 0.5).a : 0.0;
        if (pm > 0.5) { g = h > 0.45 ? 32.0 : 3.0; }
        vec2 auv = vec2((mod(g, 16.0) + f.x) / 16.0, 1.0 - (floor(g / 16.0) + 1.0 - f.y) / 6.0);
        float ink = texture2D(uAtlas, auv).a;
        vec3 inkCol = lit * 2.3 + base * uEmissive * 1.4;
        vec3 col = uAscii > 0.5 ? mix(lit * uFill + base * uEmissive * 0.08, inkCol, ink) : lit * 1.5 + base * uEmissive * 0.6;
        if (pm > 0.5) col = mix(uPatCol * 0.25, uPatCol + light * 0.22, ink);
        float fog = smoothstep(uFogNear, uFogFar, vDepth);
        col = mix(col, uFogCol, fog) * uExposure;
        gl_FragColor = vec4(col, 1.0);
      }`,
  })
}

export interface CardOpts {
  w: number
  h: number
  sway?: number
  glow?: number
  fly?: number
  rise?: number
  fall?: number
  smoke?: number
  glint?: number
  spill?: number
}

// Grass, moss, mist, motes, smoke, rain: camera-facing glyph cards, rooted, swaying.
export function cardMaterial(shared: SharedUniforms, o: CardOpts): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...shared, uW: { value: o.w }, uH: { value: o.h }, uSway: { value: o.sway ?? 0.18 }, uGlow: { value: o.glow ?? 0 }, uFly: { value: o.fly ?? 0 }, uRise: { value: o.rise ?? 0 }, uFall: { value: o.fall ?? 0 }, uSmoke: { value: o.smoke ?? 0 }, uGlint: { value: o.glint ?? 0 }, uSpill: { value: o.spill ?? 0 }, uThin: { value: 1 }, uExposure: { value: 1 } },
    transparent: true, depthWrite: false,
    vertexShader: `
      attribute float aGlyph; attribute float aPhase; attribute vec3 aTint; attribute vec2 aOff;
      uniform float uW; uniform float uH; uniform float uTime; uniform float uSway; uniform float uFly; uniform float uRise; uniform float uFall; uniform float uSmoke; uniform float uWind; varying float vFade;
      varying vec2 vUv; varying float vGlyph; varying vec3 vTint; varying vec3 vRoot; varying float vDepth; varying float vPhase;
      void main(){
        vec4 root = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        if (uFly > 0.0) root.xyz += vec3(sin(uTime * 0.5 + aPhase) * 0.6, sin(uTime * 0.9 + aPhase * 2.0) * 0.25, cos(uTime * 0.4 + aPhase) * 0.6) * min(uFly, 1.0);
        vFade = 1.0;
        float sz = 1.0; vGlyph = aGlyph;
        if (uFall > 0.0) { float k = fract(uTime * 0.55 + aPhase); root.y -= k * uFall; root.x += sin(aPhase * 40.0) * 0.02 * k;
          vFade = smoothstep(0.0, 0.08, k) * (1.0 - smoothstep(0.85, 1.0, k)); float c = mod(floor(uTime * 6.0 + aPhase * 17.0), 3.0); vGlyph = c < 1.0 ? 92.0 : (c < 2.0 ? 26.0 : 1.0); }
        if (uRise != 0.0) { float k = fract(uTime * (uSmoke > 0.0 ? 0.11 : 0.07) + aPhase);
          root.xyz += vec3(sin(k * 5.0 + aPhase * 6.0) * 0.22 * k + k * k * (0.4 + uWind * 1.1) * (uSmoke > 0.0 ? 1.0 : 1.6), k * uRise, sin(k * 3.0 + aPhase * 9.0) * 0.15);
          vFade = smoothstep(0.0, 0.1, k) * (1.0 - k);
          if (uSmoke > 0.0) { sz = 0.8 + k * 1.8; vGlyph = k < 0.12 ? 14.0 : (k < 0.35 ? 79.0 : (k < 0.65 ? 47.0 : (k < 0.85 ? 8.0 : 94.0))); }
          else { vGlyph = mod(floor(uTime * 2.0 + aPhase * 10.0), 2.0) < 1.0 ? aGlyph : 7.0; } }
        vRoot = root.xyz; vec4 mv = viewMatrix * root; vDepth = -mv.z;
        float top = position.y + 0.5;
        float sway = (sin(uTime * 1.7 + aPhase + root.x * 0.6) + 0.4 * sin(uTime * 3.1 + aPhase) + uWind * 1.2) * top * uSway * (0.6 + uWind);
        mv.xy += vec2(position.x * uW * sz + sway * uW, top * uH * sz) + aOff * sz;
        gl_Position = projectionMatrix * mv;
        vUv = uv; vTint = aTint; vPhase = aPhase;
      }`,
    fragmentShader: `
      uniform sampler2D uAtlas; uniform vec3 uLampPos; uniform vec3 uLampCol; uniform float uLamp; uniform float uExposure; uniform float uAscii;
      uniform vec3 uFogCol; uniform float uFogNear; uniform float uFogFar; uniform float uGlow; uniform float uTime; uniform float uGlint; uniform float uSpill; uniform float uThin; uniform float uSmoke;
      varying vec2 vUv; varying float vGlyph; varying vec3 vTint; varying vec3 vRoot; varying float vDepth; varying float vPhase; varying float vFade;
      void main(){
        vec2 auv = vec2((mod(vGlyph, 16.0) + vUv.x) / 16.0, 1.0 - (floor(vGlyph / 16.0) + 1.0 - vUv.y) / 6.0);
        float ink = uAscii > 0.5 ? texture2D(uAtlas, auv).a : smoothstep(0.5, 0.2, abs(vUv.x - 0.5));
        if (ink < 0.3) discard;
        float d = length(uLampPos - vRoot);
        vec3 light = vec3(0.3, 0.4, 0.36) + uLampCol * uLamp * 1.2 / (1.0 + d * d * 0.3);
        vec3 col = vTint * light * (0.55 + vUv.y * 0.8);
        if (uGlow > 0.0) col = vTint * (0.6 + 0.6 * sin(uTime * 3.0 + vPhase * 7.0)) * 2.0;
        if (uGlint > 0.0) { float gl = pow(max(0.0, sin(uTime * 0.45 + vPhase * 6.2832)), 60.0); if (gl < 0.08) discard; col = vTint * 2.4 * gl; }
        if (uSpill > 0.0) col = vTint * (0.72 + 0.28 * (0.5 + 0.5 * sin(uTime * 0.8 + vPhase)));
        if (uSmoke > 0.0 && fract(vPhase * 37.13) > uThin) discard;
        col = mix(col, uFogCol, smoothstep(uFogNear, uFogFar, vDepth)) * uExposure;
        if (ink * vFade < 0.3) discard;
        gl_FragColor = vec4(col, ink);
      }`,
  })
}

// The sky behind the canopy, printed on the screen grid. 1 = day (the sun low behind the trees, slow rays),
// 2 = night (twinkling stars, a crescent moon), 3 = misty (pale drifting haze).
export function skyMaterial(shared: SharedUniforms, gp: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { ...shared, uSky: { value: 3 }, uRes: { value: new THREE.Vector2(1, 1) }, uGp: { value: gp } },
    depthTest: false, depthWrite: false,
    vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.9999, 1.0); }',
    fragmentShader: `
      uniform sampler2D uAtlas; uniform float uSky; uniform vec2 uRes; uniform float uGp; uniform float uTime; uniform float uExposure;
      ${HASH}
      float ramp(float i){
        if (i < 1.0) return 0.0; if (i < 2.0) return 14.0; if (i < 3.0) return 12.0; if (i < 4.0) return 26.0; if (i < 5.0) return 27.0;
        if (i < 6.0) return 29.0; if (i < 7.0) return 11.0; if (i < 8.0) return 10.0; if (i < 9.0) return 3.0; return 32.0; }
      void main(){
        vec2 cs = vec2(uGp * 0.62, uGp); vec2 gp = gl_FragCoord.xy / cs; vec2 cell = floor(gp); vec2 f = fract(gp);
        vec2 uv = (cell + 0.5) * cs / uRes; float asp = uRes.x / uRes.y; float h = hash(cell);
        vec3 bg; vec3 ic = vec3(0.0); float g = 0.0;
        if (uSky < 1.5) {
          vec2 d = (uv - vec2(0.62, 0.8)) * vec2(asp, 1.0); float r = length(d), a = atan(d.y, d.x);
          float rays = pow(0.5 + 0.5 * sin(a * 9.0 + sin(uTime * 0.12) * 0.8), 5.0) * exp(-r * 1.3);
          float I = clamp(exp(-r * 3.4) * 0.75 + exp(-r * 10.0) * 0.7 + rays * 0.4 + smoothstep(0.55, 0.15, uv.y) * 0.18, 0.0, 1.0);
          bg = mix(vec3(0.09, 0.11, 0.05), vec3(0.55, 0.50, 0.28), I);
          g = ramp(floor(clamp(I + (h - 0.5) * 0.16, 0.0, 0.999) * 10.0));
          ic = mix(vec3(0.55, 0.56, 0.3), vec3(1.0, 0.93, 0.68), I) * 1.15;
        } else if (uSky > 2.5) {
          float m = 0.5 + 0.5 * sin(uv.y * 14.0 + uTime * 0.2 + sin(uv.x * 5.0 + uTime * 0.1) * 1.5);
          bg = mix(vec3(0.58, 0.68, 0.63), vec3(0.42, 0.52, 0.48), smoothstep(0.3, 1.0, uv.y)) / 0.6;
          if (h > 0.82) { g = m > 0.6 ? 94.0 : (m > 0.3 ? 13.0 : 14.0); ic = vec3(0.78, 0.86, 0.82) * (0.9 + 0.3 * m); }
        } else {
          bg = mix(vec3(0.035, 0.10, 0.12), vec3(0.008, 0.02, 0.045), smoothstep(0.2, 0.95, uv.y));
          if (h > 0.972 && uv.y > 0.28) {
            float tw = 0.45 + 0.55 * sin(uTime * (0.8 + h * 4.0) + h * 91.0);
            float k = hash(cell + 7.0); g = k > 0.8 ? 10.0 : (k > 0.45 ? 11.0 : 14.0);
            ic = vec3(0.78, 0.88, 1.0) * (0.35 + 0.65 * tw) * smoothstep(0.28, 0.6, uv.y) * 1.6;
          }
          vec2 md = (uv - vec2(0.47, 0.87)) * vec2(asp, 1.0); float mr = length(md), R = 0.06;
          bg += vec3(0.07, 0.11, 0.15) * exp(-mr * 9.0);
          if (mr < R) {
            float lit = step(R * 0.92, length(md - vec2(R * 0.55, R * 0.18)));
            g = lit > 0.5 ? (h > 0.5 ? 32.0 : 3.0) : 14.0;
            ic = lit > 0.5 ? vec3(0.92, 0.96, 0.86) * 1.5 : vec3(0.25, 0.32, 0.38);
          } else if (uv.y > 0.18 && uv.y < 0.42 && h > 0.9) { g = 94.0; ic = vec3(0.3, 0.5, 0.52) * 0.8; }
        }
        float ink = 0.0;
        if (g > 0.5) { vec2 auv = vec2((mod(g, 16.0) + f.x) / 16.0, 1.0 - (floor(g / 16.0) + 1.0 - f.y) / 6.0); ink = texture2D(uAtlas, auv).a; }
        gl_FragColor = vec4(mix(bg * 0.6, ic, ink) * uExposure, 1.0);
      }`,
  })
}
