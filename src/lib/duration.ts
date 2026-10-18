// Run durations typed by hand: "45" (minutes), "45:30" (mm:ss, minutes may
// exceed 59) or "1:05:30" (h:mm:ss). Null when it can't be read.

export function parseDurationToSec(value: string): number | null {
  const text = value.trim()
  if (!text) return null
  const parts = text.split(':').map(p => p.trim())
  if (parts.length > 3 || parts.some(p => !/^\d+$/.test(p))) {
    // A plain decimal is minutes ("42.5").
    if (parts.length === 1 && /^\d+(\.\d+)?$/.test(text)) return Math.round(parseFloat(text) * 60)
    return null
  }
  const n = parts.map(p => parseInt(p, 10))
  let sec: number
  if (n.length === 1) sec = n[0] * 60
  else if (n.length === 2) {
    if (n[1] >= 60) return null
    sec = n[0] * 60 + n[1]
  } else {
    if (n[1] >= 60 || n[2] >= 60) return null
    sec = n[0] * 3600 + n[1] * 60 + n[2]
  }
  return sec > 0 ? sec : null
}
