import { useEffect, useState } from 'react'

import { apiFetch } from '@/lib/api'

interface Exercise {
  id: string
  name: string
  category: string
  muscleGroups: string | null
  equipment: string | null
  formCues: string | null
}

const CATEGORY_LABELS: Record<string, string> = {
  strength: 'Strength',
  core: 'Core',
  posture: 'Foundation',
  mobility: 'Mobility',
}

const CATEGORY_ORDER = ['strength', 'core', 'posture', 'mobility']

export function LibraryPage() {
  const [exercises, setExercises] = useState<Exercise[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const data = await apiFetch<Exercise[]>('/api/exercises')
        setExercises(data)
      } catch (e) {
        console.error('Failed to load exercises:', e)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    )
  }

  const grouped = new Map<string, Exercise[]>()
  for (const ex of exercises) {
    if (!grouped.has(ex.category)) grouped.set(ex.category, [])
    grouped.get(ex.category)!.push(ex)
  }

  return (
    <div>
      <h2 className="text-display-lg mb-4 text-foreground">Exercise Library</h2>

      {CATEGORY_ORDER.map((cat) => {
        const items = grouped.get(cat)
        if (!items?.length) return null

        return (
          <div key={cat} className="mb-6">
            <p className="text-label mb-2 text-muted-foreground">
              {CATEGORY_LABELS[cat] ?? cat}
            </p>
            <div className="space-y-2">
              {items.map((ex) => {
                const isExpanded = expandedId === ex.id
                return (
                  <button
                    key={ex.id}
                    onClick={() => setExpandedId(isExpanded ? null : ex.id)}
                    className="w-full border border-border bg-card p-3 text-left"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-foreground">{ex.name}</span>
                      {ex.equipment && (
                        <span className="bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">
                          {ex.equipment}
                        </span>
                      )}
                    </div>
                    {isExpanded && (
                      <div className="mt-3 border-t border-border pt-3">
                        {ex.muscleGroups && (
                          <p className="mb-2 text-xs text-muted-foreground">
                            Muscles: {ex.muscleGroups.replace(/,/g, ', ')}
                          </p>
                        )}
                        {ex.formCues && (
                          <p className="text-sm leading-relaxed text-muted-foreground">
                            {ex.formCues}
                          </p>
                        )}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
