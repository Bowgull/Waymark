import { Capacitor } from '@capacitor/core'
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics'

const isNative = Capacitor.isNativePlatform()

function webVibrate(ms: number | number[]): void {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    navigator.vibrate(ms)
  }
}

export async function tapHaptic() {
  if (isNative) {
    await Haptics.impact({ style: ImpactStyle.Light })
    return
  }
  webVibrate(8)
}

export async function completeHaptic() {
  if (isNative) {
    await Haptics.notification({ type: NotificationType.Success })
    return
  }
  webVibrate([6, 40, 10])
}

export async function heavyHaptic() {
  if (isNative) {
    await Haptics.impact({ style: ImpactStyle.Heavy })
    return
  }
  webVibrate(24)
}

export async function mediumHaptic() {
  if (isNative) {
    await Haptics.impact({ style: ImpactStyle.Medium })
    return
  }
  webVibrate(14)
}

export async function selectHaptic() {
  if (isNative) {
    await Haptics.selectionChanged()
    return
  }
  webVibrate(4)
}
