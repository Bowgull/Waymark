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

/* Simplified silhouette icons — derived from brand SVGs, single-color fill */
function StrengthIcon({ color }: { color: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 200 200" fill={color}>
      {/* Triangle */}
      <path d="M100,22 L168,136 L32,136 Z" opacity={0.85} />
      <path d="M100,48 L152,128 L48,128 Z" fill="#081A14" />
      {/* Barbell bar */}
      <rect x="34" y="102" width="132" height="10" rx="2" opacity={0.9} />
      {/* Left plate */}
      <rect x="10" y="90" width="10" height="34" rx="2" />
      <rect x="24" y="95" width="6" height="24" rx="1" opacity={0.7} />
      {/* Right plate */}
      <rect x="180" y="90" width="10" height="34" rx="2" />
      <rect x="170" y="95" width="6" height="24" rx="1" opacity={0.7} />
      {/* Chevron */}
      <path d="M58,130 L100,168 L142,130 L130,130 L100,156 L70,130 Z" opacity={0.7} />
    </svg>
  )
}

function ConditioningIcon({ color }: { color: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 200 200" fill={color}>
      {/* Top chevron → right arc */}
      <path d="
        M100,34 L119,47
        A56,56 0 0,1 156,100
        A6,6 0 0,1 144,100
        A48,48 0 0,0 81,47 Z
      " opacity={0.85} />
      {/* Bottom chevron → left arc */}
      <path d="
        M100,166 L81,153
        A56,56 0 0,1 44,100
        A6,6 0 0,1 56,100
        A48,48 0 0,0 119,153 Z
      " opacity={0.85} />
      {/* Center pip */}
      <circle cx="100" cy="100" r="14" opacity={0.9} />
      <circle cx="100" cy="100" r="8" fill="#081A14" />
      <circle cx="100" cy="100" r="3" opacity={0.7} />
    </svg>
  )
}

function RecoveryIcon({ color }: { color: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 220 260" fill={color}>
      {/* Outer diamond frame */}
      <path d="M110,8 L198,110 L110,252 L22,110 Z" opacity={0.35} />
      <path d="M110,38 L168,110 L110,216 L52,110 Z" fill="#081A14" />
      {/* Center petal (upward) */}
      <path d="M110,126 C104,110 101,88 103,67 C105,52 108,44 110,44 C112,44 115,52 117,67 C119,88 116,110 110,126 Z" opacity={0.85} />
      {/* Left petal */}
      <path d="M110,126 C96,114 75,98 63,78 C57,66 59,57 67,57 C77,57 91,71 103,91 C109,103 110,116 110,126 Z" opacity={0.65} />
      {/* Right petal */}
      <path d="M110,126 C124,114 145,98 157,78 C163,66 161,57 153,57 C143,57 129,71 117,91 C111,103 110,116 110,126 Z" opacity={0.65} />
      {/* Center seed */}
      <circle cx="110" cy="130" r="12" opacity={0.9} />
      <circle cx="110" cy="130" r="6" fill="#081A14" />
      {/* Stem */}
      <rect x="108" y="131" width="4" height="56" rx="1" opacity={0.6} />
      {/* Base bar */}
      <rect x="64" y="187" width="92" height="8" rx="1" opacity={0.5} />
    </svg>
  )
}

const LEGEND_ICONS: Record<CategoryKey, React.ComponentType<{ color: string }>> = {
  strength: StrengthIcon,
  conditioning: ConditioningIcon,
  recovery: RecoveryIcon,
}

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
      <div className="flex gap-4 sm:gap-6">
        {RING_ORDER.map(({ key }) => {
          const cat = TRAINING_CATEGORIES[key]
          const Icon = LEGEND_ICONS[key]
          return (
            <div key={key} className="flex items-center gap-1.5 sm:gap-2">
              <Icon color={cat.color} />
              <span className="text-[10px] sm:text-label uppercase tracking-wider text-muted-foreground">
                {cat.label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
