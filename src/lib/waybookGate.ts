// Face ID on the Waybook (approved 2026-10-19; page 61 part 1). Tapping
// Waybook anywhere asks with iOS's own prompt (Face ID, then the passcode);
// Waymark draws nothing. Success opens it, cancel leaves it closed. The rule
// itself is in waybookLock.ts: not again within 3 minutes of the Waybook last
// being open, again at once after the phone locks or he leaves the app. The
// web build has no Face ID and opens without asking.

import { BiometricAuth } from '@aparajita/capacitor-biometric-auth'
import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'

import { showPop } from '@/design/popFlap'

import { getItem, setItem } from './safeStorage'
import { gateEnabledFrom, needsFaceId, outcomeForError } from './waybookLock'

const TOGGLE_KEY = 'waybook.requireAuth'
const NO_PASSCODE = 'No passcode on this iPhone. Set one to lock the Waybook.'

type Listener = (unlocked: boolean) => void

let lastOpenAt: number | null = null
const listeners = new Set<Listener>()

function notify() {
  const u = isUnlocked()
  listeners.forEach(l => l(u))
}

function native(): boolean {
  return Capacitor.isNativePlatform()
}

// Leaving the app (or the phone locking) drops the window at once. `pause` is
// didEnterBackground: the Face ID prompt itself only makes the app inactive,
// so it doesn't relock in the middle of its own prompt.
let wired = false
function wireLifecycle() {
  if (wired || typeof window === 'undefined') return
  wired = true
  if (native()) {
    void CapacitorApp.addListener('pause', () => lock())
  } else {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') lock() })
  }
}
wireLifecycle()

export function isGateEnabled(): boolean {
  return gateEnabledFrom(getItem(TOGGLE_KEY))
}

/** Readable now without a prompt. */
export function isUnlocked(): boolean {
  return !needsFaceId({ enabled: isGateEnabled(), native: native(), lastOpenAt }, Date.now())
}

/** The Waybook is (still) open: the 3 minutes count from now. */
export function markWaybookOpen(): void {
  lastOpenAt = Date.now()
}

export function lock(): void {
  lastOpenAt = null
  notify()
}

/** iOS's own prompt, Face ID then the passcode. */
async function ask(reason: string): Promise<boolean> {
  try {
    await BiometricAuth.authenticate({
      reason,
      cancelTitle: 'Cancel',
      allowDeviceCredential: true,
      iosFallbackTitle: 'Use Passcode',
    })
    return true
  } catch (e) {
    const code = (e as { code?: string })?.code
    if (outcomeForError(code) === 'open-unprotected') {
      showPop(NO_PASSCODE, 'info')
      return true
    }
    if (code && !/cancel/i.test(code)) console.warn('Waybook auth failed:', code)
    return false
  }
}

/** Tapping Waybook: true opens it, false leaves it closed. */
export async function requireUnlock(reason = 'Open the Waybook'): Promise<boolean> {
  if (!isUnlocked()) {
    if (!(await ask(reason))) return false
  }
  markWaybookOpen()
  notify()
  return true
}

/** The Settings switch. Turning it off asks Face ID first (on the web it just turns off). */
export async function setGateEnabled(enabled: boolean): Promise<boolean> {
  if (!enabled && isGateEnabled() && native() && !(await ask('Turn off Face ID for the Waybook'))) return false
  setItem(TOGGLE_KEY, enabled ? '1' : '0')
  if (enabled) lastOpenAt = null
  notify()
  return true
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
