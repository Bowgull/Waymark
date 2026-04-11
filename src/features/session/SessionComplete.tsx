import { useState } from 'react'

interface SessionCompleteProps {
  onFinish: (rpe: number, difficulty: number, notes: string) => void
  submitting: boolean
}

const RPE_LABELS: Record<number, string> = {
  1: 'Very Light', 2: 'Light', 3: 'Light-Moderate', 4: 'Moderate',
  5: 'Moderate', 6: 'Moderate-Hard', 7: 'Hard', 8: 'Very Hard',
  9: 'Near Max', 10: 'Max Effort',
}

const DIFFICULTY_LABELS: Record<number, string> = {
  1: 'Too Easy', 2: 'Easy', 3: 'Just Right', 4: 'Hard', 5: 'Too Hard',
}

export function SessionComplete({ onFinish, submitting }: SessionCompleteProps) {
  const [rpe, setRpe] = useState(7)
  const [difficulty, setDifficulty] = useState(3)
  const [notes, setNotes] = useState('')

  return (
    <div className="space-y-6 py-4">
      <div className="text-center">
        <p className="text-3xl font-bold text-[#E8C860]">Session Complete</p>
        <p className="mt-1 text-sm text-zinc-400">How was it?</p>
      </div>

      {/* RPE */}
      <div>
        <label className="mb-2 block text-sm font-medium text-zinc-300">
          RPE: {rpe} — {RPE_LABELS[rpe]}
        </label>
        <input
          type="range"
          min={1}
          max={10}
          value={rpe}
          onChange={(e) => setRpe(parseInt(e.target.value))}
          className="w-full accent-[#E8C860]"
        />
        <div className="mt-1 flex justify-between text-xs text-zinc-600">
          <span>1</span><span>5</span><span>10</span>
        </div>
      </div>

      {/* Difficulty */}
      <div>
        <label className="mb-2 block text-sm font-medium text-zinc-300">
          Difficulty
        </label>
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((d) => (
            <button
              key={d}
              onClick={() => setDifficulty(d)}
              className={`flex-1 rounded-lg py-2 text-xs font-medium transition-colors ${
                difficulty === d
                  ? 'bg-[#E8C860] text-zinc-950'
                  : 'bg-zinc-800 text-zinc-400 active:bg-zinc-700'
              }`}
            >
              {DIFFICULTY_LABELS[d]}
            </button>
          ))}
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className="mb-2 block text-sm font-medium text-zinc-300">
          Notes (optional)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="How did it feel? Anything to remember?"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-[#4ACAAA] focus:outline-none"
        />
      </div>

      <button
        onClick={() => onFinish(rpe, difficulty, notes)}
        disabled={submitting}
        className="min-h-[48px] w-full rounded-xl bg-[#E8C860] py-3 text-base font-bold text-zinc-950 active:bg-[#C8A030] disabled:opacity-50"
      >
        {submitting ? 'Saving...' : 'Finish Workout'}
      </button>
    </div>
  )
}
