import { useEffect, useRef, useState } from 'react'
import { tapHaptic } from '@/lib/haptics'

interface BottomSheetProps {
  open: boolean
  onClose: () => void
  children: React.ReactNode
  /** Distance in px past which a downward drag will close on release. */
  dismissThreshold?: number
  /** Downward velocity (px/ms) that will dismiss regardless of distance. */
  velocityThreshold?: number
  ariaLabel?: string
}

export function BottomSheet({
  open,
  onClose,
  children,
  dismissThreshold = 120,
  velocityThreshold = 0.6,
  ariaLabel,
}: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const [dragY, setDragY] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [mounted, setMounted] = useState(open)
  const startRef = useRef({ y: 0, t: 0, lastY: 0, lastT: 0 })

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  function handlePointerDown(e: React.PointerEvent) {
    const target = e.target as HTMLElement
    if (!target.dataset.sheetHandle) return
    setDragging(true)
    startRef.current = { y: e.clientY, t: performance.now(), lastY: e.clientY, lastT: performance.now() }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!dragging) return
    const dy = Math.max(0, e.clientY - startRef.current.y)
    startRef.current.lastY = e.clientY
    startRef.current.lastT = performance.now()
    setDragY(dy)
  }

  function handlePointerUp() {
    if (!dragging) return
    const travel = dragY
    const dt = Math.max(1, startRef.current.lastT - startRef.current.t)
    const velocity = travel / dt
    setDragging(false)
    if (travel > dismissThreshold || velocity > velocityThreshold) {
      tapHaptic()
      onClose()
    } else {
      setDragY(0)
    }
  }

  function handleBackdropClick() {
    onClose()
  }

  function handleTransitionEnd() {
    if (!open && dragY === 0) setMounted(false)
  }

  function handleSheetAnimationStart() {
    if (open && dragY !== 0) setDragY(0)
  }

  if (!mounted && !open) return null

  const translate = open ? dragY : 9999
  const backdropOpacity = open ? Math.max(0, 1 - dragY / 400) : 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      <div
        className="absolute inset-0 bg-black/60 transition-opacity duration-200"
        style={{ opacity: backdropOpacity }}
        onClick={handleBackdropClick}
      />
      <div
        ref={sheetRef}
        className="relative w-full max-w-md rounded-t-xl border-t border-gold/10 bg-surface shadow-2xl"
        style={{
          transform: `translateY(${translate}px)`,
          transition: dragging ? 'none' : 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1)',
          paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))',
          touchAction: 'pan-y',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onTransitionEnd={handleTransitionEnd}
        onAnimationStart={handleSheetAnimationStart}
      >
        <div
          data-sheet-handle
          className="flex w-full cursor-grab items-center justify-center py-2.5 active:cursor-grabbing"
          style={{ touchAction: 'none' }}
        >
          <span data-sheet-handle className="h-1 w-10 rounded-full bg-gold/30" />
        </div>
        <div className="px-4 pb-2">{children}</div>
      </div>
    </div>
  )
}
