import { type HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'gold' | 'teal' | 'clay' | 'forest' | 'muted' | 'inscription-gold' | 'inscription-teal' | 'inscription-forest' | 'inscription-muted'
}

const variants = {
  default: 'bg-secondary text-secondary-foreground',
  gold: 'bg-gold/15 text-gold',
  teal: 'bg-teal/15 text-teal',
  clay: 'bg-clay/15 text-clay',
  forest: 'bg-forest/15 text-forest-light',
  muted: 'bg-secondary text-muted-foreground',
  'inscription-gold': 'border border-gold/25 text-gold/80 bg-transparent',
  'inscription-teal': 'border border-teal/25 text-teal/80 bg-transparent',
  'inscription-forest': 'border border-forest/40 text-forest-light/80 bg-transparent',
  'inscription-muted': 'border border-muted-foreground/25 text-muted-foreground bg-transparent',
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  const isInscription = variant.startsWith('inscription')
  return (
    <span
      className={cn(
        'inline-flex items-center font-medium',
        isInscription
          ? 'rounded-sm px-1.5 py-px text-[13px] font-[Cinzel] tracking-[0.2em] uppercase'
          : 'rounded-full px-2 py-0.5 text-xs',
        variants[variant],
        className
      )}
      {...props}
    />
  )
}
