import { cn } from '@/lib/utils'
import { getMarkAsset } from '@/lib/markAssets'

type MarkState = 'ghosted' | 'active' | 'completed' | 'skipped'
type MarkSize = 'sm' | 'md' | 'lg' | 'hero'

interface SessionMarkProps {
  sessionType: string
  state: MarkState
  size?: MarkSize
  className?: string
  onClick?: () => void
}

const SIZE_CLASSES: Record<MarkSize, string> = {
  sm: 'w-10 h-10',
  md: 'w-16 h-16',
  lg: 'w-24 h-24',
  hero: 'w-48 h-48',
}

const STATE_CLASSES: Record<MarkState, string> = {
  ghosted: 'opacity-15 saturate-0 brightness-50',
  active: 'opacity-100',
  completed: 'opacity-100 animate-glow-pulse',
  skipped: 'opacity-[0.08] saturate-0 brightness-[0.3]',
}

export function SessionMark({ sessionType, state, size = 'md', className, onClick }: SessionMarkProps) {
  const mark = getMarkAsset(sessionType)

  return (
    <div
      className={cn('flex shrink-0 items-center justify-center', SIZE_CLASSES[size], className)}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
    >
      <img
        src={mark.png}
        alt={mark.label}
        draggable={false}
        className={cn('h-full w-full object-contain transition-all duration-500', STATE_CLASSES[state])}
      />
    </div>
  )
}
