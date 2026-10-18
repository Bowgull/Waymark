import { useCallback } from 'react'

import { showPop } from '@/design/popFlap'

// Toasts are flap pop-ups now (design-decisions.md: "Toasts: flap pills at
// the top"; page 35 A): a small flap board drops in from the top, teal edge
// for good news, clay for a failure. <PopFlapHost /> at the app root draws
// them; this hook keeps the old call sites working unchanged.

type ToastVariant = 'success' | 'info' | 'warning'

interface ToastOptions {
  actionLabel?: string
  onAction?: () => void
  /** How long the toast stays up. Longer for refusals that list options. */
  durationMs?: number
}

const TONE = { success: 'good', info: 'info', warning: 'bad' } as const

const noContainer = (): null => null

export function useToast() {
  const show = useCallback(
    (message: string, variant: ToastVariant = 'info', options?: ToastOptions) => {
      showPop(message, TONE[variant], options)
    },
    [],
  )
  // Kept for the existing call sites; the host at the root draws the pop-ups.
  return { show, ToastContainer: noContainer }
}
