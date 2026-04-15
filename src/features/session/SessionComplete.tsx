import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { ScrollDrum } from '@/components/ui/ScrollDrum'
import { SlidingGauge } from '@/components/ui/SlidingGauge'
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

const DIFFICULTY_LABELS = ['Too Easy', 'Easy', 'Just Right', 'Hard', 'Too Hard']

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
    <div className="space-y-6 py-4">
      <div className="flex flex-col items-center text-center animate-fade-in-up">
        <img
          src={mark.png}
          alt={mark.label}
          width={64}
          height={64}
          className="mb-4 h-16 w-16 object-contain animate-glow-pulse"
          draggable={false}
        />
        <p className="text-display-lg text-gold">Session Closed</p>
        <p className="mt-1 text-sm text-muted-foreground">How was it?</p>
      </div>

      {/* RPE — scroll drum */}
      <div className="animate-fade-in-up animation-delay-100">
        <label className="mb-2 block text-sm font-medium text-foreground">
          RPE: {rpe} · {RPE_LABELS[rpe]}
        </label>
        <div className="rounded-md bg-deep-forest border border-gold/10 shadow-[inset_0_1px_0_rgba(232,200,96,0.06)]">
          <ScrollDrum min={1} max={10} step={1} value={rpe} onChange={setRpe} />
        </div>
      </div>

      {/* Difficulty — sliding gauge */}
      <div className="animate-fade-in-up animation-delay-200">
        <label className="mb-3 block text-sm font-medium text-foreground">
          Difficulty
        </label>
        <SlidingGauge
          labels={DIFFICULTY_LABELS}
          value={difficulty}
          onChange={setDifficulty}
        />
      </div>

      {/* Notes */}
      <div className="animate-fade-in-up animation-delay-300">
        <label className="mb-2 block text-sm font-medium text-foreground">
          Notes
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="How did it feel? Anything to remember?"
          className="w-full rounded-md border border-gold/10 bg-deep-forest px-3 py-2 text-sm text-foreground italic placeholder-muted-foreground/50 shadow-[inset_0_1px_3px_rgba(0,0,0,0.3)] focus:border-teal/40 focus:shadow-[inset_0_1px_3px_rgba(0,0,0,0.3),0_0_0_1px_rgba(74,202,170,0.15)] focus:outline-none"
        />
      </div>

      <Button
        onClick={handleFinish}
        disabled={submitting}
        size="lg"
        className="w-full animate-fade-in-up animation-delay-400"
      >
        {submitting ? 'Saving...' : 'Close Session'}
      </Button>
    </div>
  )
}
