// Pop-up flap messages (page 35, A + C): a small flap board drops in from the
// top (teal edge for good news, clay for a failure) and lifts away; the row
// you touched glows. A tiny store so any code (hooks, the outbox, plain
// functions) can raise one; <PopFlapHost /> draws them. Pure apart from timers.

import { fitsOnFlap } from './flap'

export type PopTone = 'good' | 'bad' | 'info'

export interface PopMessage {
  id: number
  tone: PopTone
  /** Short words on the flap (LOGGED, COULDN'T SAVE). */
  title: string | null
  /** Plain words under it when the message is longer than a flap holds. */
  text: string | null
  actionLabel?: string
  onAction?: () => void
  leaving: boolean
}

export interface PopOptions {
  /** Force a flap title; otherwise a short message becomes the title. */
  title?: string
  durationMs?: number
  actionLabel?: string
  onAction?: () => void
}

type Listener = (messages: PopMessage[]) => void

let nextId = 0
let messages: PopMessage[] = []
const listeners = new Set<Listener>()
const LEAVE_MS = 320

function emit() {
  for (const l of listeners) l(messages)
}

/** Split a message into a flap title and plain words: short ones go on the flap. */
export function popParts(message: string, title?: string): { title: string | null; text: string | null } {
  const msg = message.trim()
  const bare = msg.replace(/[.!]+$/, '')
  if (title) return { title, text: msg && bare.toUpperCase() !== title.toUpperCase() ? msg : null }
  if (fitsOnFlap(bare)) return { title: bare, text: null }
  return { title: null, text: msg }
}

export function showPop(message: string, tone: PopTone = 'info', opts: PopOptions = {}): number {
  const id = ++nextId
  const parts = popParts(message, opts.title)
  messages = [...messages, { id, tone, ...parts, actionLabel: opts.actionLabel, onAction: opts.onAction, leaving: false }].slice(-3)
  emit()
  const hold = opts.durationMs ?? (opts.actionLabel ? 6000 : parts.text && parts.text.length > 60 ? 5000 : 2400)
  setTimeout(() => dismissPop(id), hold)
  return id
}

export function dismissPop(id: number) {
  if (!messages.some(m => m.id === id && !m.leaving)) return
  messages = messages.map(m => (m.id === id ? { ...m, leaving: true } : m))
  emit()
  setTimeout(() => {
    messages = messages.filter(m => m.id !== id)
    emit()
  }, LEAVE_MS)
}

export function subscribePops(listener: Listener): () => void {
  listeners.add(listener)
  listener(messages)
  return () => { listeners.delete(listener) }
}

/**
 * Row glow: the row you touched answers, teal for good, clay for a failure.
 * Restarts the animation if it is already glowing.
 */
export function glowRow(el: Element | null | undefined, tone: 'good' | 'bad') {
  if (!el) return
  el.classList.remove('wm-glow-good', 'wm-glow-bad')
  void (el as HTMLElement).offsetWidth
  el.classList.add(tone === 'good' ? 'wm-glow-good' : 'wm-glow-bad')
}
