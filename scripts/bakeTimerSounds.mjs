#!/usr/bin/env node
// Bakes the 4 in-session timer sounds from src/lib/sounds.ts into .caf files.
// Run: node scripts/bakeTimerSounds.mjs
// Output: ios/App/App/Sounds/{round_start,round_end,finish_warning,rest_warning}.caf
// Re-run any time sounds.ts synthesis params change.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const outDir = path.join(repoRoot, 'ios/App/App/Sounds')
const tmpDir = path.join(repoRoot, '.sound-build')

const SR = 44100

// ── synthesis helpers ──────────────────────────────────────────

function silence(seconds) {
  return new Float32Array(Math.ceil(seconds * SR))
}

// Mix `src` into `dst` starting at sample `offsetSamples`. Grows dst if needed.
function addInto(dst, src, offsetSamples) {
  const endNeeded = offsetSamples + src.length
  let out = dst
  if (endNeeded > dst.length) {
    out = new Float32Array(endNeeded)
    out.set(dst)
  }
  for (let i = 0; i < src.length; i++) {
    out[offsetSamples + i] += src[i]
  }
  return out
}

// Shape: gain=0 at t=0, linear ramp to `peak` at t=attackEnd, then exponential
// decay to 0.001 at t=decayEnd. Matches the Web Audio envelope used in sounds.ts.
function envelope(t, peak, attackEnd, decayEnd) {
  if (t < 0) return 0
  if (t <= attackEnd) {
    return (t / attackEnd) * peak
  }
  if (t >= decayEnd) return 0
  // exponentialRampToValueAtTime from `peak` at attackEnd to 0.001 at decayEnd:
  // g(t) = peak * (0.001 / peak) ^ ((t - attackEnd) / (decayEnd - attackEnd))
  const frac = (t - attackEnd) / (decayEnd - attackEnd)
  return peak * Math.pow(0.001 / peak, frac)
}

function renderSine(freq, peak, attackEnd, decayEnd, totalSec) {
  const len = Math.ceil(totalSec * SR)
  const out = new Float32Array(len)
  const w = 2 * Math.PI * freq
  for (let i = 0; i < len; i++) {
    const t = i / SR
    if (t >= decayEnd) break
    out[i] = envelope(t, peak, attackEnd, decayEnd) * Math.sin(w * t)
  }
  return out
}

function renderSquare(freq, peak, attackEnd, decayEnd, totalSec) {
  const len = Math.ceil(totalSec * SR)
  const out = new Float32Array(len)
  const w = 2 * Math.PI * freq
  for (let i = 0; i < len; i++) {
    const t = i / SR
    if (t >= decayEnd) break
    out[i] = envelope(t, peak, attackEnd, decayEnd) * Math.sign(Math.sin(w * t))
  }
  return out
}

// Bell: fundamental + inharmonic partials at ratios 1, 2.756, 5.404
// with relative gains 1, 0.5, 0.2. Instant 2ms attack, exponential decay over
// `decaySec`. Matches playBell() in sounds.ts.
function renderBell(freq, decaySec, peakGain) {
  const partials = [1, 2.756, 5.404]
  const partialGains = [1, 0.5, 0.2]
  const totalSec = decaySec + 0.05
  const len = Math.ceil(totalSec * SR)
  let out = new Float32Array(len)
  for (let p = 0; p < partials.length; p++) {
    const tone = renderSine(
      freq * partials[p],
      peakGain * partialGains[p],
      0.002,
      decaySec,
      totalSec,
    )
    out = addInto(out, tone, 0)
  }
  return out
}

// ── sound definitions (match sounds.ts exactly) ────────────────

function soundRoundStart() {
  return renderBell(880, 2.5, 0.75)
}

function soundRoundEnd() {
  return renderBell(587, 3.0, 0.75)
}

function soundFinishWarning() {
  // 3 square pulses at 1100 Hz, spaced 0.22s, peak 0.35, attack 8ms, decay ends at +0.18, osc stops at +0.2
  const pulseTotal = 0.2
  let out = silence(3 * 0.22 + pulseTotal)
  for (let i = 0; i < 3; i++) {
    const offset = i * 0.22
    const pulse = renderSquare(1100, 0.35, 0.008, 0.18, pulseTotal)
    out = addInto(out, pulse, Math.round(offset * SR))
  }
  return out
}

function soundRestWarning() {
  // 2 sine pulses at 330 Hz, spaced 0.4s, peak 0.28, attack 40ms, decay ends at +0.5, osc stops at +0.55
  const pulseTotal = 0.55
  let out = silence(0.4 + pulseTotal)
  for (let i = 0; i < 2; i++) {
    const offset = i * 0.4
    const pulse = renderSine(330, 0.28, 0.04, 0.5, pulseTotal)
    out = addInto(out, pulse, Math.round(offset * SR))
  }
  return out
}

// ── WAV writer ─────────────────────────────────────────────────

function writeWav(filePath, samples) {
  const numChannels = 1
  const bitsPerSample = 16
  const byteRate = (SR * numChannels * bitsPerSample) / 8
  const blockAlign = (numChannels * bitsPerSample) / 8
  const dataSize = samples.length * 2
  const buf = Buffer.alloc(44 + dataSize)

  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(numChannels, 22)
  buf.writeUInt32LE(SR, 24)
  buf.writeUInt32LE(byteRate, 28)
  buf.writeUInt16LE(blockAlign, 32)
  buf.writeUInt16LE(bitsPerSample, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataSize, 40)

  // Soft clip + dither just enough to avoid hard clipping if stacked partials exceed ±1.
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i])
    if (a > peak) peak = a
  }
  const norm = peak > 0.98 ? 0.98 / peak : 1
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i] * norm))
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2)
  }

  fs.writeFileSync(filePath, buf)
}

// ── driver ─────────────────────────────────────────────────────

const specs = [
  { name: 'round_start', render: soundRoundStart },
  { name: 'round_end', render: soundRoundEnd },
  { name: 'finish_warning', render: soundFinishWarning },
  { name: 'rest_warning', render: soundRestWarning },
]

fs.mkdirSync(tmpDir, { recursive: true })
fs.mkdirSync(outDir, { recursive: true })

for (const spec of specs) {
  const samples = spec.render()
  const wavPath = path.join(tmpDir, `${spec.name}.wav`)
  const cafPath = path.join(outDir, `${spec.name}.caf`)
  writeWav(wavPath, samples)
  // -f caff: Apple Core Audio Format container
  // -d LEI16@44100: little-endian 16-bit PCM, 44.1 kHz — smallest uncompressed, fast to load
  // -c 1: mono
  execFileSync('afconvert', [
    '-f', 'caff',
    '-d', 'LEI16@44100',
    '-c', '1',
    wavPath,
    cafPath,
  ], { stdio: 'inherit' })
  const size = fs.statSync(cafPath).size
  console.log(`  baked ${path.relative(repoRoot, cafPath)}  (${size.toLocaleString()} bytes)`)
}

// Cleanup tmp WAVs
fs.rmSync(tmpDir, { recursive: true, force: true })
console.log('done.')
