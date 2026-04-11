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
  posture: 'Posture Correctives',
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
        <p className="text-sm text-zinc-500">Loading...</p>
      </div>
    )
  }

  // Group by category
  const grouped = new Map<string, Exercise[]>()
  for (const ex of exercises) {
    if (!grouped.has(ex.category)) grouped.set(ex.category, [])
    grouped.get(ex.category)!.push(ex)
  }

  return (
    <div>
      <h2 className="mb-4 text-xl font-semibold text-zinc-100">Exercise Library</h2>

      {CATEGORY_ORDER.map((cat) => {
        const items = grouped.get(cat)
        if (!items?.length) return null

        return (
          <div key={cat} className="mb-6">
            <p className="mb-2 text-xs uppercase tracking-widest text-zinc-500">
              {CATEGORY_LABELS[cat] ?? cat}
            </p>
            <div className="space-y-2">
              {items.map((ex) => {
                const isExpanded = expandedId === ex.id
                return (
                  <button
                    key={ex.id}
                    onClick={() => setExpandedId(isExpanded ? null : ex.id)}
                    className="w-full rounded-xl border border-zinc-800 bg-zinc-900 p-3 text-left"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-zinc-100">{ex.name}</span>
                      {ex.equipment && (
                        <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-500">
                          {ex.equipment}
                        </span>
                      )}
                    </div>
                    {isExpanded && (
                      <div className="mt-3 border-t border-zinc-800 pt-3">
                        {ex.muscleGroups && (
                          <p className="mb-2 text-xs text-zinc-500">
                            Muscles: {ex.muscleGroups.replace(/,/g, ', ')}
                          </p>
                        )}
                        {ex.formCues && (
                          <p className="text-sm leading-relaxed text-zinc-400">
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
