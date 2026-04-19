/**
 * Safe localStorage wrapper.
 *
 * On iOS under Capacitor, certain privacy modes or iCloud sync settings can
 * cause localStorage to throw. Using these helpers keeps callers crash-free.
 */

export function getItem(key: string): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function setItem(key: string, value: string): void {
  try {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(key, value)
  } catch {
    // quota or privacy mode — drop silently
  }
}

export function removeItem(key: string): void {
  try {
    if (typeof window === 'undefined') return
    window.localStorage.removeItem(key)
  } catch {
    // noop
  }
}
