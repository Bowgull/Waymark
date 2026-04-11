import { type HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'gold' | 'teal' | 'clay' | 'forest' | 'muted'
}

const variants = {
  default: 'bg-secondary text-secondary-foreground',
  gold: 'bg-gold/15 text-gold',
  teal: 'bg-teal/15 text-teal',
  clay: 'bg-clay/15 text-clay',
  forest: 'bg-forest/15 text-forest-light',
  muted: 'bg-secondary text-muted-foreground',
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        variants[variant],
        className
      )}
      {...props}
    />
  )
}
