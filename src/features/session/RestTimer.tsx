interface RestTimerProps {
  secondsRemaining: number
  isOvertime: boolean
  onNext: () => void
}

function formatTime(sec: number): string {
  const abs = Math.abs(sec)
  const m = Math.floor(abs / 60)
  const s = abs % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function RestTimer({ secondsRemaining, isOvertime, onNext }: RestTimerProps) {
  return (
    <div className="flex flex-col items-center py-12">
      <p className="mb-2 text-sm uppercase tracking-widest text-zinc-500">
        {isOvertime ? 'Over by' : 'Rest'}
      </p>
      <p
        className={`text-8xl font-bold tabular-nums ${
          isOvertime ? 'text-[#C45A3C]' : 'text-zinc-100'
        }`}
      >
        {isOvertime && '+'}
        {formatTime(secondsRemaining)}
      </p>
      <button
        onClick={onNext}
        className="mt-8 min-h-[48px] rounded-xl bg-[#E8C860] px-8 py-3 text-base font-bold text-zinc-950 active:bg-[#C8A030]"
      >
        Next Set
      </button>
    </div>
  )
}
