import mobilityPng from '@/assets/brand/Mobility.png'
import strengthPng from '@/assets/brand/Strength.png'
import muayThaiPng from '@/assets/brand/MuayThai.png'
import bagworkPng from '@/assets/brand/Bagwork.png'
import cardioPng from '@/assets/brand/Cardio.png'
import wellnessPng from '@/assets/brand/Wellness.png'
import logoPng from '@/assets/brand/Logo.png'

export interface MarkAsset {
  png: string
  label: string
}

const SESSION_MARK_MAP: Record<string, MarkAsset> = {
  posture_corrective: { png: mobilityPng, label: 'Foundation' },
  strength: { png: strengthPng, label: 'Strength' },
  mt_class: { png: muayThaiPng, label: 'Muay Thai' },
  bag_work: { png: bagworkPng, label: 'Bagwork' },
  running: { png: cardioPng, label: 'Cardio' },
  skip_rope: { png: cardioPng, label: 'Cardio' },
  active_recovery: { png: wellnessPng, label: 'Wellness' },
}

const FALLBACK: MarkAsset = { png: wellnessPng, label: 'Wellness' }

export function getMarkAsset(sessionType: string): MarkAsset {
  return SESSION_MARK_MAP[sessionType] ?? FALLBACK
}

export function getSessionLabel(sessionType: string): string {
  return (SESSION_MARK_MAP[sessionType] ?? FALLBACK).label
}

/** Accent color per session type for ring timers and progress bars */
export function getSessionAccent(sessionType: string): string {
  switch (sessionType) {
    case 'strength':
    case 'bag_work':
      return '#E8C860'
    case 'posture_corrective':
    case 'active_recovery':
    case 'mt_class':
      return '#4ACAAA'
    case 'running':
    case 'skip_rope':
      return '#1E8A68'
    default:
      return '#E8C860'
  }
}

export { logoPng }
