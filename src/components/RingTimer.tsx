interface RingTimerProps {
  totalSeconds: number
  secondsRemaining: number
  isOvertime?: boolean
  label?: string
  accentColor?: string
  size?: number
  isComplete?: boolean
}

function formatTime(sec: number): string {
  const abs = Math.abs(sec)
  const m = Math.floor(abs / 60)
  const s = abs % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function RingTimer({
  totalSeconds,
  secondsRemaining,
  isOvertime = false,
  label,
  accentColor = '#E8C860',
  size = 240,
  isComplete = false,
}: RingTimerProps) {
  const strokeWidth = 10
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const center = size / 2

  const progress = totalSeconds > 0
    ? Math.max(0, Math.min(1, 1 - secondsRemaining / totalSeconds))
    : 0

  const dashOffset = circumference * (1 - progress)

  const arcColor = isOvertime ? '#C45A3C' : accentColor
  const timeColor = isOvertime ? '#C45A3C' : '#F0EDE4'
  const glowFilter = isComplete
    ? `drop-shadow(0 0 20px ${accentColor}80) drop-shadow(0 0 40px ${accentColor}40)`
    : 'none'

  const labelFontSize = size * 0.055
  const timeFontSize = size * 0.22

  // Split time into individual characters for fixed-width digit rendering
  const timeStr = (isOvertime ? '+' : '') + formatTime(secondsRemaining)

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ filter: glowFilter, transition: 'filter 0.6s ease' }}
      >
        {/* Background track */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="#1A3A2E"
          strokeWidth={strokeWidth}
          opacity={0.5}
        />

        {/* Progress arc */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={arcColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${center} ${center})`}
          style={{ transition: 'stroke-dashoffset 0.3s linear, stroke 0.3s ease' }}
        />

        {/* Outer glow ring */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={arcColor}
          strokeWidth={2}
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${center} ${center})`}
          opacity={0.2}
          style={{ transition: 'stroke-dashoffset 0.3s linear' }}
        />
      </svg>

      {/* Center text */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {label && (
          <p
            className="text-display-sm"
            style={{ fontSize: labelFontSize, color: arcColor, transition: 'color 0.3s ease' }}
          >
            {label}
          </p>
        )}
        <p
          className="text-timer leading-none"
          style={{
            fontSize: timeFontSize,
            color: timeColor,
            transition: 'color 0.3s ease',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {timeStr}
        </p>
      </div>
    </div>
  )
}
