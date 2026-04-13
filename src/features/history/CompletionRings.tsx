import { TRAINING_CATEGORIES, type CategoryKey } from '@/lib/trainingCategories'

interface CategoryData {
  completed: number
  target: number
}

interface CompletionRingsProps {
  data: Record<string, CategoryData> | null
}

const RING_ORDER: { key: CategoryKey; radius: number }[] = [
  { key: 'conditioning', radius: 72 },
  { key: 'strength', radius: 54 },
  { key: 'recovery', radius: 36 },
]

const SIZE = 180
const CENTER = SIZE / 2
const STROKE = 8

export function CompletionRings({ data }: CompletionRingsProps) {
  const totalCompleted = data
    ? Object.values(data).reduce((s, c) => s + c.completed, 0)
    : 0
  const totalTarget = data
    ? Object.values(data).reduce((s, c) => s + c.target, 0)
    : 0

  return (
    <div className="flex flex-col items-center gap-4 py-4">
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          {RING_ORDER.map(({ key, radius }, i) => {
            const cat = TRAINING_CATEGORIES[key]
            const d = data?.[key]
            const progress = d && d.target > 0
              ? Math.min(1, d.completed / d.target)
              : 0
            const circumference = 2 * Math.PI * radius
            const dashOffset = circumference * (1 - progress)

            return (
              <g key={key}>
                {/* Track */}
                <circle
                  cx={CENTER}
                  cy={CENTER}
                  r={radius}
                  fill="none"
                  stroke="#1A3A2E"
                  strokeWidth={STROKE}
                  opacity={0.4}
                />
                {/* Progress arc */}
                <circle
                  cx={CENTER}
                  cy={CENTER}
                  r={radius}
                  fill="none"
                  stroke={cat.color}
                  strokeWidth={STROKE}
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                  transform={`rotate(-90 ${CENTER} ${CENTER})`}
                  className="ring-fill-animate"
                  style={{
                    animationDelay: `${i * 0.15}s`,
                  }}
                />
                {/* Glow on full ring */}
                {progress >= 1 && (
                  <circle
                    cx={CENTER}
                    cy={CENTER}
                    r={radius}
                    fill="none"
                    stroke={cat.color}
                    strokeWidth={2}
                    opacity={0.3}
                    strokeDasharray={circumference}
                    strokeDashoffset={0}
                    transform={`rotate(-90 ${CENTER} ${CENTER})`}
                    style={{ filter: `drop-shadow(0 0 6px ${cat.color}60)` }}
                  />
                )}
              </g>
            )
          })}
        </svg>

        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <p className="text-display text-foreground leading-none">{totalCompleted}</p>
          <p className="text-label text-muted-foreground mt-0.5">of {totalTarget}</p>
        </div>
      </div>

      {/* Ring legend */}
      <div className="flex gap-5">
        {RING_ORDER.map(({ key }) => {
          const cat = TRAINING_CATEGORIES[key]
          const d = data?.[key]
          return (
            <div key={key} className="flex items-center gap-1.5">
              <div
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: cat.color }}
              />
              <span className="text-label text-muted-foreground">
                {cat.label}
              </span>
              {d && (
                <span className="text-xs text-foreground">
                  {d.completed}/{d.target}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
