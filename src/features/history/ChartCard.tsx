import { useState } from 'react'

import { Sparkline } from './Sparkline'

interface ChartCardProps {
  title: string
  headline?: string
  sparklineData?: number[]
  sparklineColor?: string
  children: React.ReactNode
  defaultOpen?: boolean
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  )
}

export function ChartCard({
  title,
  headline,
  sparklineData,
  sparklineColor = '#E8C860',
  children,
  defaultOpen = false,
}: ChartCardProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="rounded-md border border-border bg-card overflow-hidden animate-fade-in-up">
      {/* Compact header */}
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 px-4 py-3 active:bg-surface-light/30 transition-colors"
      >
        <span className="text-display-sm text-gold flex-shrink-0">{title}</span>

        <div className="flex-1 flex items-center justify-end gap-3">
          {!open && sparklineData && sparklineData.length >= 2 && (
            <Sparkline data={sparklineData} color={sparklineColor} width={64} height={22} />
          )}
          {headline && (
            <span className="text-xs text-muted-foreground whitespace-nowrap">{headline}</span>
          )}
          <ChevronIcon open={open} />
        </div>
      </button>

      {/* Expandable content */}
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-out"
        style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="px-4 pb-4 pt-1">
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
