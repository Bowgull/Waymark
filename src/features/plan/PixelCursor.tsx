// The game-menu highlight (page 73): a crisp pixel arrow, gold with a dark
// core, at the left of the chosen line. It jumps to a new line (no glide) and
// bobs 2 px; under Reduce Motion it holds still (plan.css).
const ROWS = ['G......', 'GG.....', 'GYG....', 'GYYG...', 'GYYYG..', 'GYYYYG.', 'GYYYG..', 'GYYG...', 'GYG....', 'GG.....', 'G......']
const COL: Readonly<Record<string, string>> = { G: '#f0d27a', Y: '#a87e2c' }

export function PixelCursor({ className = '' }: { className?: string }) {
  return (
    <svg className={`pl-cur ${className}`.trim()} viewBox="0 0 7 11" shapeRendering="crispEdges" aria-hidden>
      {ROWS.flatMap((row, y) => [...row].map((c, x) => (c === '.' ? null : <rect key={`${x}-${y}`} x={x} y={y} width="1.02" height="1.02" fill={COL[c]} />)))}
    </svg>
  )
}
