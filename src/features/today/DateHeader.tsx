import { formatDateDisplay } from '@/lib/dates'

export function DateHeader({ date }: { date: Date }) {
  return (
    <div className="mb-2">
      <h2 className="text-display text-foreground">
        {formatDateDisplay(date)}
      </h2>
      <div className="mt-3 h-px bg-gradient-to-r from-transparent via-gold/20 to-transparent" />
    </div>
  )
}
