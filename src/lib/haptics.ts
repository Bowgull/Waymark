import { Capacitor } from '@capacitor/core'
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics'

const isNative = Capacitor.isNativePlatform()

export async function tapHaptic() {
  if (isNative) await Haptics.impact({ style: ImpactStyle.Light })
}

export async function completeHaptic() {
  if (isNative) await Haptics.notification({ type: NotificationType.Success })
}

export async function heavyHaptic() {
  if (isNative) await Haptics.impact({ style: ImpactStyle.Heavy })
}

export async function mediumHaptic() {
  if (isNative) await Haptics.impact({ style: ImpactStyle.Medium })
}
