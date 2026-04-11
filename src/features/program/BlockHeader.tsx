interface Block {
  id: string
  name: string
  totalWeeks: number
  status: string
}

interface BlockHeaderProps {
  block: Block
  currentWeek: number
}

export function BlockHeader({ block, currentWeek }: BlockHeaderProps) {
  return (
    <div className="mb-6">
      <p className="text-xs uppercase tracking-widest text-zinc-500">Training Block</p>
      <h2 className="text-2xl font-bold text-zinc-100">{block.name}</h2>
      <p className="mt-1 text-sm text-zinc-400">
        Week {currentWeek} of {block.totalWeeks}
      </p>
      {/* Progress bar */}
      <div className="mt-2 h-1.5 rounded-full bg-zinc-800">
        <div
          className="h-full rounded-full bg-[#E8C860] transition-all"
          style={{ width: `${(currentWeek / block.totalWeeks) * 100}%` }}
        />
      </div>
    </div>
  )
}
