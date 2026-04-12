import { kgToLbsDisplay } from '@/lib/chartTheme'

interface PR {
  exerciseId: string
  exerciseName: string
  maxWeightKg: number
  date: string
  previousMaxKg: number | null
}

interface PRListProps {
  prs: PR[]
}

export function PRList({ prs }: PRListProps) {
  if (prs.length === 0) return null

  return (
    <div className="mb-6">
      <p className="text-display-sm mb-3 text-gold">Personal Records</p>
      <div className="space-y-2">
        {prs.map((pr) => {
          const delta = pr.previousMaxKg
            ? kgToLbsDisplay(pr.maxWeightKg) - kgToLbsDisplay(pr.previousMaxKg)
            : null
          return (
            <div
              key={pr.exerciseId}
              className="flex items-center justify-between border border-border bg-deep-forest p-3"
            >
              <div>
                <p className="text-sm font-medium text-foreground">{pr.exerciseName}</p>
                <p className="text-xs text-muted-foreground">{pr.date}</p>
              </div>
              <div className="text-right">
                <p className="text-stat text-gold">{kgToLbsDisplay(pr.maxWeightKg)}</p>
                <p className="text-xs text-muted-foreground">
                  lbs{delta != null && delta > 0 && (
                    <span className="ml-1 text-teal">+{delta}</span>
                  )}
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
