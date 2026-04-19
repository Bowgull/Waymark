import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { ScrollDrum } from '@/components/ui/ScrollDrum'
import { SlidingGauge } from '@/components/ui/SlidingGauge'
import { getMarkAsset } from '@/lib/markAssets'
import { completeHaptic } from '@/lib/haptics'
import { getItem as storageGet, setItem as storageSet } from '@/lib/safeStorage'

const DRIVE_EXPLAINER_KEY = 'waymark.drive_explainer_seen'

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
  const [showDriveExplainer, setShowDriveExplainer] = useState(false)
  const mark = getMarkAsset(sessionType)

  useEffect(() => {
    if (!storageGet(DRIVE_EXPLAINER_KEY)) {
      setShowDriveExplainer(true)
    }
  }, [])

  function dismissDriveExplainer() {
    setShowDriveExplainer(false)
    storageSet(DRIVE_EXPLAINER_KEY, '1')
  }

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

      {/* Drive — scroll drum */}
      <div className="animate-fade-in-up animation-delay-100">
        <label className="mb-2 block text-sm font-medium text-foreground">
          Drive: {rpe} · {RPE_LABELS[rpe]}
        </label>
        {showDriveExplainer && (
          <div className="mb-2 rounded-md border border-gold/20 bg-gold/5 px-3 py-2 text-xs text-muted-foreground leading-relaxed animate-fade-in">
            <p className="text-foreground">How hard you drove. 1 is a warm-up. 10 is all you had.</p>
            <p className="mt-1 text-muted-foreground/70">Honest numbers make the next week fit. Guess high and the load stays stuck.</p>
            <button
              onClick={dismissDriveExplainer}
              className="mt-2 text-[13px] text-gold/70 active:text-gold"
            >
              Got it
            </button>
          </div>
        )}
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
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !submitting) {
              e.preventDefault()
              handleFinish()
            }
          }}
          rows={3}
          placeholder="How did it feel? Anything to remember? (Cmd+Enter to close)"
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
