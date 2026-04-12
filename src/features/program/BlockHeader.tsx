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
      <p className="text-label text-muted-foreground">Training Block</p>
      <h2 className="text-display text-foreground">{block.name}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Week {currentWeek} of {block.totalWeeks}
      </p>
      {/* Progress bar */}
      <div className="mt-2 h-1.5 bg-border">
        <div
          className="h-full bg-[#E8C860] transition-all"
          style={{ width: `${(currentWeek / block.totalWeeks) * 100}%` }}
        />
      </div>
    </div>
  )
}
