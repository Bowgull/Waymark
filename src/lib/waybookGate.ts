import { BiometricAuth, BiometryErrorType } from '@aparajita/capacitor-biometric-auth'
import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'

const TIMEOUT_MS = 3 * 60 * 1000
const TOGGLE_KEY = 'waybook.requireAuth'

type Listener = (unlocked: boolean) => void

let unlockedAt: number | null = null
let backgroundedAt: number | null = null
let lifecycleWired = false
const listeners = new Set<Listener>()

function notify() {
  const u = isUnlocked()
  listeners.forEach((l) => l(u))
}

function wireLifecycle() {
  if (lifecycleWired) return
  lifecycleWired = true
  if (!Capacitor.isNativePlatform()) {
    const onVis = () => {
      if (document.visibilityState === 'hidden') {
        backgroundedAt = Date.now()
      } else if (document.visibilityState === 'visible' && backgroundedAt) {
        if (Date.now() - backgroundedAt > TIMEOUT_MS) lock()
        backgroundedAt = null
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return
  }
  CapacitorApp.addListener('appStateChange', ({ isActive }) => {
    if (!isActive) {
      backgroundedAt = Date.now()
    } else if (backgroundedAt) {
      if (Date.now() - backgroundedAt > TIMEOUT_MS) lock()
      backgroundedAt = null
    }
  })
}

export function isGateEnabled(): boolean {
  try {
    return localStorage.getItem(TOGGLE_KEY) === '1'
  } catch {
    return false
  }
}

export function setGateEnabled(enabled: boolean) {
  try {
    localStorage.setItem(TOGGLE_KEY, enabled ? '1' : '0')
  } catch {
    // ignore
  }
  if (!enabled) {
    // Disabling the gate also unlocks so downstream UI reveals content.
    unlockedAt = Date.now()
  } else {
    // Enabling forces a fresh unlock next time something is touched.
    unlockedAt = null
  }
  notify()
}

export function isUnlocked(): boolean {
  if (!isGateEnabled()) return true
  if (unlockedAt === null) return false
  return Date.now() - unlockedAt < TIMEOUT_MS
}

export function lock() {
  unlockedAt = null
  notify()
}

export async function requireUnlock(reason = 'Unlock Waybook'): Promise<boolean> {
  wireLifecycle()
  if (!isGateEnabled()) return true
  if (isUnlocked()) {
    unlockedAt = Date.now()
    return true
  }
  try {
    await BiometricAuth.authenticate({
      reason,
      cancelTitle: 'Cancel',
      allowDeviceCredential: true,
      iosFallbackTitle: 'Use Passcode',
    })
    unlockedAt = Date.now()
    notify()
    return true
  } catch (e) {
    const code = (e as { code?: BiometryErrorType })?.code
    if (code === BiometryErrorType.userCancel || code === BiometryErrorType.appCancel || code === BiometryErrorType.systemCancel) {
      return false
    }
    console.warn('Waybook auth failed:', code ?? e)
    return false
  }
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export async function isBiometryAvailable(): Promise<boolean> {
  try {
    const res = await BiometricAuth.checkBiometry()
    return res.isAvailable || res.deviceIsSecure
  } catch {
    return false
  }
}
