import { cn } from '@/lib/utils'

export function GoldDivider({ className }: { className?: string }) {
  return (
    <div className={cn('h-px bg-gradient-to-r from-transparent via-gold/20 to-transparent', className)} />
  )
}
