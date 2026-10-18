// A tiny ASCII renderer (first drawn for Aang's sheet 39, 2026-10-17; copied here as a starting idea for Waymark). Each scene is a light field: for every cell it returns how bright it is, its
// colour and (sometimes) a chosen glyph. Brightness picks a character from a ramp, the way the ASCII MMORPG turns
// shaded 3D frames into text. Three styles read the same field differently.
const RAMP = ' .,:;-~=+*#%@';
const STYLES = {
  game: { bg: '#0b0d0a', tint: (c) => c },
  mix: { bg: '#120b06', tint: (c) => [c[0] * 0.75 + 20, c[1] * 0.65 + 10, c[2] * 0.55], dim: 0.8 },
  term: { bg: '#0c0904', tint: () => [255, 176, 64], mono: true },
  // Waymark's own colours (src/index.css): deep forest, forest, teal, gold.
  waymark: { bg: '#020A08', tint: (c) => [c[0] * 0.35 + 20, c[1] * 0.75 + 45, c[2] * 0.55 + 35] },
};

function hash(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
function noise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const clamp = (v) => Math.max(0, Math.min(1, v));

// Grass that leans with the wind: the glyph shows the lean, like the game's grass blades.
function grass(x, y, t, horizon, ox = 0) {
  const depth = (y - horizon) / (1 - horizon);
  const wind = Math.sin(x * 9 + t * 1.6 + noise(x * 4 + t * 0.3, y * 3) * 3) + noise(x * 6 - t * 0.8, y * 5) - 0.5;
  const ch = wind > 0.55 ? '/' : wind < -0.55 ? '\\' : (hash(x * 99 + ox, y * 77) > 0.6 ? '|' : '\'');
  const b = 0.35 + depth * 0.5 + noise(x * 12, y * 12) * 0.2;
  return { b, c: mix([40, 90, 50], [110, 200, 90], clamp(depth + wind * 0.15)), ch };
}
function lamp(x, y, lx, ly, r, aspect = 1.25) { const d = Math.hypot((x - lx) * aspect, y - ly); return clamp(1 - d / r); }

export const SCENES = {
  // Dusk meadow with a lantern and fireflies: the everyday scene.
  meadow(x, y, t) {
    const horizon = 0.55;
    const glow = lamp(x, y, 0.72, 0.6, 0.38) ** 1.4;
    let cell;
    if (y < horizon) {
      const cloud = noise(x * 3 + t * 0.05, y * 6) * (1 - y / horizon);
      cell = { b: 0.12 + cloud * 0.4 + (y / horizon) * 0.25, c: mix([70, 60, 130], [240, 150, 90], y / horizon), ch: cloud > 0.42 ? (cloud > 0.6 ? '~' : '-') : (hash(x * 300, y * 300) > 0.9 ? '.' : ' ') };
      if (Math.abs(y - horizon + 0.03) < 0.04) cell = { b: 0.4, c: [70, 70, 110], ch: noise(x * 20, 1) > 0.5 ? '^' : '_' };
    } else cell = grass(x, y, t, horizon);
    cell.b = clamp(cell.b + glow * 0.9); cell.c = mix(cell.c, [255, 200, 120], glow * 0.85);
    if (Math.abs(x - 0.72) < 0.012 && y > 0.56 && y < 0.66) cell = { b: 1, c: [255, 210, 120], ch: y < 0.6 ? 'A' : '#' };
    for (let i = 0; i < 7; i++) { const fx = (hash(i, 3) + Math.sin(t * 0.4 + i) * 0.05) % 1, fy = 0.5 + hash(i, 9) * 0.4 + Math.sin(t * 0.9 + i * 2) * 0.03;
      if (Math.abs(x - fx) < 0.008 && Math.abs(y - fy) < 0.02 && Math.sin(t * 3 + i) > -0.2) cell = { b: 1, c: [240, 255, 140], ch: '*' }; }
    return cell;
  },
  // Rain on a pond: quiet, for empty screens.
  rain(x, y, t) {
    const horizon = 0.62;
    if (y < horizon) {
      const streak = hash(Math.floor(x * 90), 1); const fall = (y * 3 + t * 2.2 + streak * 10) % 1;
      const on = streak > 0.72 && fall < 0.12;
      return on ? { b: 0.6, c: [140, 170, 220], ch: '/' } : { b: 0.05 + noise(x * 4, y * 4 + t * 0.2) * 0.12, c: [40, 50, 80] };
    }
    let b = 0.12 + noise(x * 8, y * 30 + t * 0.4) * 0.15;
    for (let i = 0; i < 4; i++) { const cx = hash(i, Math.floor(t * 0.7 + i * 0.25)), cy = horizon + 0.1 + hash(i + 7, Math.floor(t * 0.7 + i * 0.25)) * 0.3;
      const age = (t * 0.7 + i * 0.25) % 1; const d = Math.hypot((x - cx) * 1.25, (y - cy) * 3) - age * 0.35; if (Math.abs(d) < 0.03) { b = 0.7 * (1 - age); return { b, c: [150, 190, 230], ch: 'o' }; } }
    return { b, c: [50, 70, 110], ch: '~' };
  },
  // Night sky with a moon and drifting clouds: new tab.
  night(x, y, t) {
    const moon = lamp(x, y, 0.2, 0.3, 0.12);
    if (moon > 0.6) return { b: 0.9, c: [240, 230, 200], ch: '@' };
    const star = hash(Math.floor(x * 120), Math.floor(y * 40)); const tw = Math.sin(t * 2 + star * 40);
    if (star > 0.985 && tw > -0.3) return { b: 0.8, c: [220, 220, 255], ch: star > 0.995 ? '+' : '.' };
    const cloud = noise(x * 2.5 - t * 0.04, y * 5);
    const hill = y > 0.78 + Math.sin(x * 6) * 0.05 + noise(x * 5, 0) * 0.06;
    if (hill) return { b: 0.12 + moon * 0.2, c: [30, 45, 60], ch: '#' };
    return { b: 0.04 + Math.max(0, cloud - 0.5) * 0.6 + moon * 0.4, c: mix([30, 30, 70], [180, 170, 160], moon) };
  },
  // The lantern lights up, then the name resolves: waking up / loading.
  lantern(x, y, t) {
    const k = clamp((t % 6) / 3); const glow = lamp(x, y, 0.5, 0.42, 0.15 + k * 0.6) ** 1.5 * k;
    let cell = { b: 0.03 + glow * 0.8 + noise(x * 10, y * 10 + t) * 0.05 * glow, c: mix([60, 30, 80], [255, 190, 110], glow) };
    const body = Math.abs(x - 0.5) < 0.07 && y > 0.26 && y < 0.56;
    if (body) cell = { b: 0.6 + k * 0.4, c: [255, 210, 130], ch: y < 0.3 ? '_' : (y > 0.52 ? '=' : (Math.abs(x - 0.5) > 0.055 ? '|' : (Math.abs(x - 0.5) < 0.02 ? '#' : '*'))) };
    const word = 'SAMARA', wy = 0.78; const row = Math.abs(y - wy) < 0.03;
    if (row && Math.abs(x - 0.5) < 0.12) { const i = Math.floor((x - 0.38) / 0.24 * word.length); const reveal = clamp((t % 6) - 3.2) * 6;
      if (i >= 0 && i < word.length) return { b: 1, c: [255, 224, 150], ch: i < reveal ? word[i] : RAMP[Math.floor(hash(i, Math.floor(t * 12)) * RAMP.length)] }; }
    return cell;
  },
  // A thin band of grass for "Aang is working".
  strip(x, y, t) { const c = grass(x, 0.5 + y * 0.5, t * 1.4, 0.5); const run = (t * 0.25) % 1.2 - 0.1;
    if (Math.abs(x - run) < 0.01 && y > 0.3) return { b: 1, c: [240, 255, 140], ch: '*' }; return c; },
  // Raid night: a tiny boss silhouette over embers (WoW).
  raid(x, y, t) {
    const ember = noise(x * 8, y * 6 + t * 1.5) * clamp((y - 0.35) * 1.8) * 1.4;
    const fire = lamp(x, y, 0.5, 1.05, 0.7);
    let cell = { b: 0.05 + ember * 0.6 + fire * 0.4, c: mix([60, 20, 20], [255, 120, 40], ember + fire * 0.5) };
    const bx = (x - 0.5) * 1.25, by = y - 0.45; const head = Math.hypot(bx, by + 0.18) < 0.08; const bodyS = Math.abs(bx) < 0.12 - by * 0.25 && by > -0.12 && by < 0.28;
    const horns = (Math.abs(bx - 0.09) < 0.025 || Math.abs(bx + 0.09) < 0.025) && by < -0.2 && by > -0.3;
    if (head || bodyS || horns) cell = { b: 0.45, c: [70, 30, 60], ch: horns ? '^' : '#' };
    if (Math.abs(bx + 0.04) < 0.02 && Math.abs(by + 0.18) < 0.02 || Math.abs(bx - 0.04) < 0.02 && Math.abs(by + 0.18) < 0.02) cell = { b: 1, c: [255, 80, 60], ch: 'o' };
    return cell;
  },
  // Apex: a jump pad beam pulsing upward.
  apex(x, y, t) {
    const beam = clamp(1 - Math.abs(x - 0.5) * 6) * clamp(y * 1.2); const pulse = (Math.sin((y * 10 + t * 6)) + 1) / 2;
    let cell = { b: 0.04 + noise(x * 5, y * 5) * 0.08 + beam * (0.35 + pulse * 0.6), c: mix([30, 30, 40], [255, 90, 70], beam) };
    if (y > 0.86 && Math.abs(x - 0.5) < 0.12) cell = { b: 0.8, c: [220, 220, 230], ch: '=' };
    if (beam > 0.3 && pulse > 0.85) cell.ch = '^';
    return cell;
  },
  // Lost the connection: a broken tower in the rain (errors, offline).
  ruin(x, y, t) {
    const base = SCENES.rain(x, y, t);
    const tx = Math.abs(x - 0.5), top = 0.25 + (x > 0.5 ? (x - 0.5) * 2.5 : 0) + noise(x * 30, 0) * 0.05;
    if (tx < 0.08 && y > top && y < 0.65) return { b: 0.3 + noise(x * 20, y * 20) * 0.2, c: [110, 105, 120], ch: hash(Math.floor(x * 80), Math.floor(y * 30)) > 0.5 ? '#' : '%' };
    if (tx < 0.025 && y > 0.48 && y < 0.65) return { b: 0.05, c: [10, 10, 10], ch: ' ' };
    return base;
  },
  // Samara's world: a plum glow behind the shield.
  shield(x, y, t) {
    const glow = lamp(x, y, 0.5, 0.5, 0.6) * (0.8 + Math.sin(t * 1.3) * 0.2);
    const sx = (x - 0.5) * 1.25, sy = y - 0.5; const inShield = Math.abs(sx) < 0.25 * (1 - Math.max(0, sy) * 2.2) && sy > -0.3 && sy < 0.42;
    const edge = inShield && Math.abs(sx) > 0.25 * (1 - Math.max(0, sy) * 2.2) - 0.04;
    if (edge) return { b: 0.9, c: [255, 196, 60], ch: '#' };
    if (inShield) return { b: 0.35 + noise(x * 10, y * 10 + t * 0.3) * 0.3, c: [140, 90, 210], ch: Math.abs(sx) < 0.03 ? '|' : null };
    return { b: 0.03 + glow * 0.4 + noise(x * 6 + t * 0.1, y * 6) * 0.08, c: mix([40, 20, 60], [150, 100, 210], glow) };
  },
};

/** Draw a scene into a canvas, animated while it is on screen (12 frames a second, paused off screen). */
export function mount(canvas, sceneName, styleName, opts = {}) {
  const cols = opts.cols ?? 72, rows = opts.rows ?? 26, fs = opts.font ?? 11;
  const cw = fs * 0.6, ch = fs * 1.15, dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(cols * cw * dpr); canvas.height = Math.round(rows * ch * dpr);
  canvas.style.width = `${cols * cw}px`; canvas.style.height = `${rows * ch}px`;
  const g = canvas.getContext('2d'); g.scale(dpr, dpr); g.font = `${fs}px "Cascadia Mono", Consolas, monospace`; g.textBaseline = 'top';
  const st = STYLES[styleName], scene = SCENES[sceneName];
  let visible = true, last = 0;
  new IntersectionObserver((e) => { visible = e[0].isIntersecting; }).observe(canvas);
  function frame(now) {
    if (!canvas.isConnected && last) return;   // replaced by a style switch: stop drawing it
    requestAnimationFrame(frame);
    if (!visible || now - last < 83) return; last = now;
    const t = now / 1000 + (opts.offset ?? 0);
    g.fillStyle = st.bg; g.fillRect(0, 0, cols * cw, rows * ch);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const cell = scene(c / cols, r / rows, t);
      let b = Math.pow(clamp(cell.b), 0.6) * (st.dim ?? 1); if (b < 0.1 && !cell.ch) continue;
      const glyph = cell.ch && cell.ch !== ' ' ? cell.ch : RAMP[Math.floor(b * (RAMP.length - 1))];
      if (glyph === ' ') continue;
      const col = st.tint(cell.c); const k = st.mono ? 0.25 + b * 0.75 : 0.35 + b * 0.65;
      g.fillStyle = `rgb(${col[0] * k | 0},${col[1] * k | 0},${col[2] * k | 0})`;
      g.fillText(glyph, c * cw, r * ch);
    }
  }
  requestAnimationFrame(frame);
}
