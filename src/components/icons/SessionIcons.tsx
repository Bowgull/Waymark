const iconProps = { width: 18, height: 18, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

/** Spine/stretch — posture correctives */
export function PostureIcon() {
  return (
    <svg {...iconProps} viewBox="0 0 24 24">
      <path d="M12 2v8M12 14v8M8 6l4-2 4 2M8 18l4 2 4-2M9 10l3 2 3-2" />
    </svg>
  )
}

/** Dumbbell — strength */
export function StrengthIcon() {
  return (
    <svg {...iconProps} viewBox="0 0 24 24">
      <path d="M6.5 6.5h11M6.5 17.5h11" />
      <rect x="3" y="8" width="4" height="8" rx="1" />
      <rect x="17" y="8" width="4" height="8" rx="1" />
      <path d="M7 12h10" />
    </svg>
  )
}

/** Glove — MT class */
export function MtClassIcon() {
  return (
    <svg {...iconProps} viewBox="0 0 24 24">
      <path d="M18 11c0-4-2.5-7-6-7S6 7 6 11v2c0 2 1 3 2 4l2 3h4l2-3c1-1 2-2 2-4v-2z" />
      <path d="M9 11h6M9 14h6" />
    </svg>
  )
}

/** Punching bag — bag work */
export function BagWorkIcon() {
  return (
    <svg {...iconProps} viewBox="0 0 24 24">
      <path d="M12 2v3M9 5h6" />
      <rect x="8" y="5" width="8" height="14" rx="3" />
      <path d="M10 21h4" />
    </svg>
  )
}

/** Runner — running */
export function RunningIcon() {
  return (
    <svg {...iconProps} viewBox="0 0 24 24">
      <circle cx="14" cy="4" r="2" />
      <path d="M6 20l3-5 3 1 4-6 2 3M10 16l-2 4" />
    </svg>
  )
}

/** Jump rope — skip rope */
export function SkipRopeIcon() {
  return (
    <svg {...iconProps} viewBox="0 0 24 24">
      <path d="M7 20c-2 0-3-2-3-4s1-4 3-4h10c2 0 3 2 3 4s-1 4-3 4" />
      <path d="M7 12V4M17 12V4" />
    </svg>
  )
}

/** Leaf — active recovery */
export function RecoveryIcon() {
  return (
    <svg {...iconProps} viewBox="0 0 24 24">
      <path d="M17 8C8 10 5.9 16.17 3.82 21.34M17 8A9 9 0 003 17M17 8c3-1 5 0 5 0s-1 3-3 5" />
    </svg>
  )
}

/** Get icon component for a session type */
export function SessionTypeIcon({ type }: { type: string }) {
  switch (type) {
    case 'posture_corrective': return <PostureIcon />
    case 'strength': return <StrengthIcon />
    case 'mt_class': return <MtClassIcon />
    case 'bag_work': return <BagWorkIcon />
    case 'running': return <RunningIcon />
    case 'skip_rope': return <SkipRopeIcon />
    case 'active_recovery': return <RecoveryIcon />
    default: return null
  }
}
