import { Keyboard } from '@capacitor/keyboard'
import { Capacitor } from '@capacitor/core'

let initialized = false

export function initKeyboardHandling() {
  if (initialized || !Capacitor.isNativePlatform()) return
  initialized = true

  Keyboard.setAccessoryBarVisible({ isVisible: true }).catch(() => {})

  Keyboard.addListener('keyboardWillShow', (info) => {
    document.documentElement.style.setProperty('--keyboard-height', `${info.keyboardHeight}px`)
    const active = document.activeElement as HTMLElement | null
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
      setTimeout(() => {
        active.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 100)
    }
  })

  Keyboard.addListener('keyboardWillHide', () => {
    document.documentElement.style.setProperty('--keyboard-height', '0px')
  })

  document.addEventListener('touchstart', (e) => {
    const target = e.target as HTMLElement
    // a press on a control keeps the keyboard up: hiding it would move the page under the finger (SAVE, a label)
    if (target.closest?.('button, [role="button"], a, label')) return
    if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA' && !target.isContentEditable) {
      Keyboard.hide().catch(() => {})
    }
  })
}
