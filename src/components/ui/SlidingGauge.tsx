import { cn } from '@/lib/utils'

interface SlidingGaugeProps {
  labels: string[]
  value: number | null
  onChange: (value: number) => void
  fromColor?: string
  toColor?: string
  className?: string
}

export function SlidingGauge({
  labels,
  value,
  onChange,
  fromColor = '#4ACAAA',
  toColor = '#C45A3C',
  className,
}: SlidingGaugeProps) {
  const count = labels.length

  return (
    <div className={cn('relative', className)}>
      {/* Track */}
      <div className="relative mx-2 h-2 rounded-full overflow-hidden">
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: `linear-gradient(to right, ${fromColor}, ${toColor})`,
            opacity: 0.3,
          }}
        />
        {/* Fill to selected position */}
        {value != null && (
          <div
            className="absolute inset-y-0 left-0 rounded-full transition-all duration-200"
            style={{
              width: `${((value - 1) / (count - 1)) * 100}%`,
              background: `linear-gradient(to right, ${fromColor}, ${
                count > 1
                  ? `color-mix(in oklch, ${fromColor} ${100 - ((value - 1) / (count - 1)) * 100}%, ${toColor})`
                  : fromColor
              })`,
              opacity: 0.6,
            }}
          />
        )}
      </div>

      {/* Tap targets + labels */}
      <div className="mt-1 flex justify-between">
        {labels.map((label, i) => {
          const pos = i + 1
          const isSelected = value === pos
          return (
            <button
              key={pos}
              onClick={() => onChange(pos)}
              className="flex flex-col items-center gap-1 py-1"
              style={{ flex: 1 }}
            >
              {/* Diamond indicator */}
              <div
                className={cn(
                  'h-3 w-3 rotate-45 rounded-[1px] border transition-all duration-200',
                  isSelected
                    ? 'border-gold bg-gold scale-110'
                    : 'border-muted-foreground/30 bg-transparent'
                )}
              />
              <span
                className={cn(
                  'text-[10px] leading-tight transition-colors',
                  isSelected ? 'text-gold font-medium' : 'text-muted-foreground'
                )}
              >
                {label}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
