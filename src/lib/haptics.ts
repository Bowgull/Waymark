import { Capacitor } from '@capacitor/core'
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics'

const isNative = Capacitor.isNativePlatform()

// Settings → Haptics. A device preference, so it lives on the phone; every
// haptic in the app goes through this module and checks it.
const HAPTICS_KEY = 'waymark_haptics_enabled'

export function isHapticsEnabled(): boolean {
  try {
    return typeof window === 'undefined' || window.localStorage.getItem(HAPTICS_KEY) !== '0'
  } catch {
    return true
  }
}

export function setHapticsEnabled(enabled: boolean): void {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(HAPTICS_KEY, enabled ? '1' : '0')
  } catch {
    // storage unavailable: the default (on) stays
  }
}

function webVibrate(ms: number | number[]): void {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(ms)
  }
}

export async function tapHaptic() {
  if (!isHapticsEnabled()) return
  if (isNative) {
    await Haptics.impact({ style: ImpactStyle.Light })
    return
  }
  webVibrate(8)
}

export async function completeHaptic() {
  if (!isHapticsEnabled()) return
  if (isNative) {
    await Haptics.notification({ type: NotificationType.Success })
    return
  }
  webVibrate([6, 40, 10])
}

export async function heavyHaptic() {
  if (!isHapticsEnabled()) return
  if (isNative) {
    await Haptics.impact({ style: ImpactStyle.Heavy })
    return
  }
  webVibrate(24)
}

export async function mediumHaptic() {
  if (!isHapticsEnabled()) return
  if (isNative) {
    await Haptics.impact({ style: ImpactStyle.Medium })
    return
  }
  webVibrate(14)
}

export async function selectHaptic() {
  if (!isHapticsEnabled()) return
  if (isNative) {
    await Haptics.selectionChanged()
    return
  }
  webVibrate(4)
}
