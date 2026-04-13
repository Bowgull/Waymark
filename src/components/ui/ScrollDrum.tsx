import { useRef, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'

interface ScrollDrumProps {
  min: number
  max: number
  step: number
  value: number
  onChange: (value: number) => void
  suffix?: string
  className?: string
}

const ITEM_HEIGHT = 40
const VISIBLE_ITEMS = 5

export function ScrollDrum({
  min,
  max,
  step,
  value,
  onChange,
  suffix,
  className,
}: ScrollDrumProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const isScrollingRef = useRef(false)
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout>>()
  const mountedRef = useRef(false)

  // Build values array
  const values: number[] = []
  for (let v = min; v <= max; v = Math.round((v + step) * 1000) / 1000) {
    values.push(v)
  }

  const selectedIndex = values.indexOf(value)
  const centerOffset = Math.floor(VISIBLE_ITEMS / 2)

  // Scroll to selected value on mount (instant) and when value changes externally (smooth)
  useEffect(() => {
    const el = containerRef.current
    if (!el || isScrollingRef.current) return
    const targetScroll = selectedIndex * ITEM_HEIGHT
    if (!mountedRef.current) {
      el.scrollTop = targetScroll
      mountedRef.current = true
    } else {
      el.scrollTo({ top: targetScroll, behavior: 'smooth' })
    }
  }, [selectedIndex])

  const handleScroll = useCallback(() => {
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current)
    isScrollingRef.current = true

    scrollTimeoutRef.current = setTimeout(() => {
      const el = containerRef.current
      if (!el) return
      const scrollTop = el.scrollTop
      const index = Math.round(scrollTop / ITEM_HEIGHT)
      const clampedIndex = Math.max(0, Math.min(values.length - 1, index))

      // Snap to nearest
      el.scrollTo({ top: clampedIndex * ITEM_HEIGHT, behavior: 'smooth' })

      if (values[clampedIndex] !== value) {
        onChange(values[clampedIndex])
      }

      setTimeout(() => {
        isScrollingRef.current = false
      }, 100)
    }, 80)
  }, [values, value, onChange])

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current)
    }
  }, [])

  function handleTap(index: number) {
    const el = containerRef.current
    if (!el) return
    el.scrollTo({ top: index * ITEM_HEIGHT, behavior: 'smooth' })
    onChange(values[index])
  }

  const containerHeight = VISIBLE_ITEMS * ITEM_HEIGHT
  const paddingItems = centerOffset

  return (
    <div className={cn('relative', className)} style={{ height: containerHeight }}>
      {/* Gold highlight bar */}
      <div
        className="pointer-events-none absolute left-0 right-0 z-10"
        style={{ top: centerOffset * ITEM_HEIGHT }}
      >
        <div className="h-px bg-gold/30" />
        <div style={{ height: ITEM_HEIGHT }} />
        <div className="h-px bg-gold/30" />
      </div>

      {/* Scroll container */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto scrollbar-none"
        style={{
          scrollSnapType: 'y mandatory',
          WebkitOverflowScrolling: 'touch',
          msOverflowStyle: 'none',
          scrollbarWidth: 'none',
        }}
      >
        {/* Top padding */}
        {Array.from({ length: paddingItems }).map((_, i) => (
          <div key={`pad-top-${i}`} style={{ height: ITEM_HEIGHT }} />
        ))}

        {values.map((v, index) => {
          const distance = Math.abs(index - selectedIndex)
          const isSelected = index === selectedIndex
          const opacity = isSelected ? 1 : distance === 1 ? 0.4 : 0.2
          const scale = isSelected ? 1 : distance === 1 ? 0.9 : 0.8

          const displayValue = step % 1 === 0 ? String(v) : v.toFixed(1)

          return (
            <div
              key={v}
              onClick={() => handleTap(index)}
              className="flex cursor-pointer items-center justify-center select-none"
              style={{
                height: ITEM_HEIGHT,
                scrollSnapAlign: 'start',
                opacity,
                transform: `scale(${scale})`,
                transition: 'opacity 0.15s, transform 0.15s',
              }}
            >
              <span
                className={cn(
                  'text-lg tabular-nums',
                  isSelected ? 'text-gold font-semibold' : 'text-muted-foreground'
                )}
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {displayValue}
                {suffix && (
                  <span className="ml-1 text-xs text-muted-foreground font-normal" style={{ fontFamily: 'var(--font-body)' }}>
                    {suffix}
                  </span>
                )}
              </span>
            </div>
          )
        })}

        {/* Bottom padding */}
        {Array.from({ length: paddingItems }).map((_, i) => (
          <div key={`pad-bot-${i}`} style={{ height: ITEM_HEIGHT }} />
        ))}
      </div>

      {/* Fade edges */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-deep-forest to-transparent z-20" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-deep-forest to-transparent z-20" />
    </div>
  )
}
