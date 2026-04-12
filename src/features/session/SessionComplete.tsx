import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { getMarkAsset } from '@/lib/markAssets'
import { completeHaptic } from '@/lib/haptics'

interface SessionCompleteProps {
  sessionType: string
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

export function SessionComplete({ sessionType, onFinish, submitting }: SessionCompleteProps) {
  const [rpe, setRpe] = useState(7)
  const [difficulty, setDifficulty] = useState(3)
  const [notes, setNotes] = useState('')
  const mark = getMarkAsset(sessionType)

  function handleFinish() {
    completeHaptic()
    onFinish(rpe, difficulty, notes)
  }

  return (
    <div className="space-y-6 py-4 animate-fade-in-up">
      <div className="flex flex-col items-center text-center">
        <img
          src={mark.png}
          alt={mark.label}
          className="mb-4 h-16 w-16 object-contain animate-glow-pulse"
          draggable={false}
        />
        <p className="text-display-lg text-gold">Session Closed</p>
        <p className="mt-1 text-sm text-muted-foreground">How was it?</p>
      </div>

      {/* RPE */}
      <div>
        <label className="mb-2 block text-sm font-medium text-foreground">
          RPE: {rpe} — {RPE_LABELS[rpe]}
        </label>
        <input
          type="range"
          min={1}
          max={10}
          value={rpe}
          onChange={(e) => setRpe(parseInt(e.target.value))}
          className="w-full accent-gold"
        />
        <div className="mt-1 flex justify-between text-xs text-muted-foreground">
          <span>1</span><span>5</span><span>10</span>
        </div>
      </div>

      {/* Difficulty */}
      <div>
        <label className="mb-2 block text-sm font-medium text-foreground">
          Difficulty
        </label>
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((d) => (
            <button
              key={d}
              onClick={() => setDifficulty(d)}
              className={`flex-1 py-2 text-xs font-medium transition-colors ${
                difficulty === d
                  ? 'bg-gold text-near-black'
                  : 'bg-surface-light text-muted-foreground active:bg-border'
              }`}
            >
              {DIFFICULTY_LABELS[d]}
            </button>
          ))}
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className="mb-2 block text-sm font-medium text-foreground">
          Notes (optional)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="How did it feel? Anything to remember?"
          className="w-full border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder-muted-foreground focus:border-teal focus:outline-none"
        />
      </div>

      <Button
        onClick={handleFinish}
        disabled={submitting}
        size="lg"
        className="w-full"
      >
        {submitting ? 'Saving...' : 'Close Session'}
      </Button>
    </div>
  )
}
