interface SessionBackgroundProps {
  accentColor?: string
}

export function SessionBackground({ accentColor = '#E8C860' }: SessionBackgroundProps) {
  return (
    <div className="pointer-events-none absolute inset-0 z-0 flex items-start justify-center overflow-hidden opacity-[0.04]">
      <svg
        width="400"
        height="400"
        viewBox="0 0 400 400"
        xmlns="http://www.w3.org/2000/svg"
        className="mt-8"
      >
        {/* Concentric arcs radiating from center — derived from shield/ring motif */}
        {[80, 120, 160, 200].map((r) => (
          <circle
            key={r}
            cx="200"
            cy="200"
            r={r}
            fill="none"
            stroke={accentColor}
            strokeWidth={1.5}
            opacity={1 - (r / 200) * 0.4}
          />
        ))}
        {/* Partial arcs for asymmetry */}
        <path
          d="M 200 60 A 140 140 0 0 1 340 200"
          fill="none"
          stroke={accentColor}
          strokeWidth={1}
          opacity={0.6}
        />
        <path
          d="M 60 200 A 140 140 0 0 1 200 340"
          fill="none"
          stroke={accentColor}
          strokeWidth={1}
          opacity={0.4}
        />
      </svg>
    </div>
  )
}
