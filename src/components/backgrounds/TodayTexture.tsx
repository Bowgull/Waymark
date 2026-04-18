/**
 * Topographic contour texture for the Today page.
 * Five gently arcing ridgelines confined to the lower third of the viewport —
 * survey-map atmosphere that recedes behind content instead of cutting across
 * it. Fixed to viewport, non-interactive.
 */
export function TodayTexture() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 1000 1000"
        preserveAspectRatio="xMidYMax slice"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        stroke="#E8C860"
        strokeWidth="0.9"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <g opacity="0.04">
          <path d="M -100 760 C 200 690, 440 680, 620 720 C 800 760, 940 790, 1100 775" />
        </g>
        <g opacity="0.05">
          <path d="M -100 830 C 230 770, 470 760, 650 795 C 820 830, 950 855, 1100 845" />
        </g>
        <g opacity="0.06">
          <path d="M -100 895 C 260 840, 500 830, 680 860 C 860 890, 965 910, 1100 905" />
        </g>
        <g opacity="0.07">
          <path d="M -100 950 C 290 910, 530 900, 710 920 C 880 940, 980 955, 1100 955" />
        </g>
        <g opacity="0.08">
          <path d="M -100 990 C 320 970, 560 965, 740 975 C 900 985, 990 990, 1100 990" />
        </g>
      </svg>
    </div>
  )
}
