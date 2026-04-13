import { useCallback, useEffect, useRef, useState } from 'react'

type ToastVariant = 'success' | 'info' | 'warning'

interface ToastState {
  message: string
  variant: ToastVariant
  id: number
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

  const show = useCallback((message: string, variant: ToastVariant = 'info') => {
    const id = ++toastCounter
    setToasts(prev => [...prev, { message, variant, id }])

    const timer = setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
      timersRef.current.delete(id)
    }, 3500)

    timersRef.current.set(id, timer)
  }, [])

  useEffect(() => {
    return () => {
      for (const timer of timersRef.current.values()) clearTimeout(timer)
    }
  }, [])

  const ToastContainer = useCallback(() => (
    <div className="fixed bottom-20 left-0 right-0 z-50 flex flex-col items-center gap-2 px-4 pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`px-4 py-2.5 rounded-lg text-sm font-medium shadow-lg animate-fade-in-up ${VARIANT_STYLES[t.variant]}`}
        >
          {t.message}
        </div>
      ))}
    </div>
  ), [toasts])

  return { show, ToastContainer }
}
