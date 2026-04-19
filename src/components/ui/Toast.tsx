import { useCallback, useEffect, useRef, useState } from 'react'

type ToastVariant = 'success' | 'info' | 'warning'

interface ToastOptions {
  actionLabel?: string
  onAction?: () => void
}

interface ToastState {
  message: string
  variant: ToastVariant
  id: number
  actionLabel?: string
  onAction?: () => void
}

const VARIANT_STYLES: Record<ToastVariant, string> = {
  success: 'bg-[#1E8A68]/90 text-white',
  info: 'bg-[#2A2520]/90 text-[#D4C9A8] border border-[#3A3530]',
  warning: 'bg-[#C45A3C]/90 text-white',
}

let toastCounter = 0

export function useToast() {
  const [toasts, setToasts] = useState<ToastState[]>([])
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const show = useCallback(
    (message: string, variant: ToastVariant = 'info', options?: ToastOptions) => {
      const id = ++toastCounter
      setToasts(prev => [
        ...prev,
        { message, variant, id, actionLabel: options?.actionLabel, onAction: options?.onAction },
      ])

      const timer = setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id))
        timersRef.current.delete(id)
      }, options?.actionLabel ? 6000 : 3500)

      timersRef.current.set(id, timer)
    },
    [],
  )

  useEffect(() => {
    return () => {
      for (const timer of timersRef.current.values()) clearTimeout(timer)
    }
  }, [])

  const ToastContainer = useCallback(
    () => (
      <div
        className="fixed left-0 right-0 z-50 flex flex-col items-center gap-2 px-4"
        style={{ bottom: 'calc(5rem + env(safe-area-inset-bottom))' }}
      >
        {toasts.map(t => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm font-medium shadow-lg animate-fade-in-up ${VARIANT_STYLES[t.variant]}`}
          >
            <span>{t.message}</span>
            {t.actionLabel && t.onAction && (
              <button
                onClick={() => {
                  t.onAction?.()
                  const timer = timersRef.current.get(t.id)
                  if (timer) clearTimeout(timer)
                  timersRef.current.delete(t.id)
                  setToasts(prev => prev.filter(x => x.id !== t.id))
                }}
                className="shrink-0 rounded border border-white/30 px-2 py-1 text-xs font-semibold uppercase tracking-wide active:bg-white/10"
              >
                {t.actionLabel}
              </button>
            )}
          </div>
        ))}
      </div>
    ),
    [toasts],
  )

  return { show, ToastContainer }
}
