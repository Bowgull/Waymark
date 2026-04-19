interface RingTimerProps {
  totalSeconds: number
  secondsRemaining: number
  isOvertime?: boolean
  label?: string
  accentColor?: string
  size?: number
  isComplete?: boolean
  isPaused?: boolean
  onTogglePause?: () => void
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
  isPaused = false,
  onTogglePause,
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

  const timeStr = (isOvertime ? '+' : '') + formatTime(secondsRemaining)
  const interactive = Boolean(onTogglePause)
  const displayLabel = isPaused ? 'Paused' : label

  const content = (
    <>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{
          filter: glowFilter,
          transition: 'filter 0.6s ease, opacity 0.3s ease',
          opacity: isPaused ? 0.55 : 1,
        }}
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
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        {displayLabel && (
          <p
            className="text-display-sm"
            style={{
              fontSize: labelFontSize,
              color: isPaused ? '#F0EDE4' : arcColor,
              transition: 'color 0.3s ease',
              letterSpacing: isPaused ? '0.3em' : undefined,
              textTransform: isPaused ? 'uppercase' : undefined,
              opacity: isPaused ? 0.75 : 1,
            }}
          >
            {displayLabel}
          </p>
        )}
        <p
          className="text-timer leading-none"
          style={{
            fontSize: timeFontSize,
            color: timeColor,
            transition: 'color 0.3s ease, opacity 0.3s ease',
            fontVariantNumeric: 'tabular-nums',
            opacity: isPaused ? 0.6 : 1,
          }}
        >
          {timeStr}
        </p>
      </div>
    </>
  )

  const baseStyle = { width: size, height: size }

  if (!interactive) {
    return (
      <div className="relative flex items-center justify-center" style={baseStyle}>
        {content}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={onTogglePause}
      aria-label={isPaused ? 'Resume timer' : 'Pause timer'}
      className="relative flex items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/40 active:scale-[0.98] transition-transform"
      style={{ ...baseStyle, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}
    >
      {content}
    </button>
  )
}
