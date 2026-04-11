import { formatDateDisplay, getDayName } from '@/lib/dates'

export function DateHeader({ date }: { date: Date }) {
  return (
    <div className="mb-6">
      <p className="text-xs uppercase tracking-widest text-zinc-500">
        {getDayName(date)}
      </p>
      <h2 className="text-2xl font-bold text-zinc-100">
        {formatDateDisplay(date)}
      </h2>
    </div>
  )
}
