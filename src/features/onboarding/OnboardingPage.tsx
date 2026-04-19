import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { PageBackground } from '@/components/backgrounds/PageBackground'
import { cn } from '@/lib/utils'

type Goal = 'fitness' | 'mt' | 'body'

const GOAL_OPTIONS: { value: Goal; label: string }[] = [
  { value: 'fitness', label: 'Fitness' },
  { value: 'mt', label: 'MT' },
  { value: 'body', label: 'Body' },
]

const TRAINING_OPTIONS = [
  { value: 'this_week', label: 'This week' },
  { value: 'last_month', label: 'Last month' },
  { value: 'few_months', label: 'A few months back' },
  { value: 'six_plus', label: 'Six months or more' },
  { value: 'not_seriously', label: 'Not seriously' },
]

export function OnboardingPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [goals, setGoals] = useState<Goal[]>([])
  const [physical, setPhysical] = useState('')
  const [trainingHistory, setTrainingHistory] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(false)

  function toggleGoal(g: Goal) {
    setGoals(prev => prev.includes(g) ? prev.filter(x => x !== g) : [...prev, g])
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      const inTextarea = target?.tagName === 'TEXTAREA'
      if (inTextarea && !(e.metaKey || e.ctrlKey)) return
      if (e.key !== 'Enter') return
      e.preventDefault()
      if (step === 1 && goals.length > 0) setStep(2)
      else if (step === 2) setStep(3)
      else if (step === 3 && trainingHistory && !submitting) commit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, goals, trainingHistory, submitting])

  async function commit() {
    if (!trainingHistory || submitting) return
    setSubmitting(true)
    setError(false)
    try {
      await apiFetch('/api/user-profile', {
        method: 'POST',
        body: JSON.stringify({
          goals,
          injuries: physical.trim() || null,
          trainingHistory,
        }),
      })
      navigate('/program', { replace: true })
    } catch {
      setSubmitting(false)
      setError(true)
    }
  }

  return (
    <div className="relative flex min-h-screen flex-col bg-background text-foreground">
      <PageBackground />

      <div className="relative z-10 flex justify-center gap-2 pt-10">
        {[1, 2, 3].map(n => (
          <div
            key={n}
            className={cn(
              'h-1 w-8 rounded-full transition-colors',
              step >= n ? 'bg-gold/70' : 'bg-border'
            )}
          />
        ))}
      </div>

      <div className="relative z-10 flex flex-1 flex-col justify-center px-6 pb-16">
        {step === 1 && (
          <div className="flex flex-col gap-8">
            <div className="space-y-2">
              <p className="text-2xl leading-snug">Why are you here.</p>
              <p className="text-muted-foreground text-sm">Fitness, MT, body, all three. Pick what's honest.</p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {GOAL_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => toggleGoal(value)}
                  className={cn(
                    'rounded-md border py-5 text-sm font-medium transition-colors',
                    goals.includes(value)
                      ? 'border-gold/60 bg-secondary text-foreground'
                      : 'border-border bg-secondary/50 text-muted-foreground'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <Button disabled={goals.length === 0} onClick={() => setStep(2)} className="w-full">
              Enter
            </Button>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-8">
            <div className="space-y-2">
              <p className="text-2xl leading-snug">Any pain, injuries, postural issues.</p>
              <p className="text-muted-foreground text-sm">The app works better when it knows.</p>
            </div>
            <textarea
              value={physical}
              onChange={e => setPhysical(e.target.value)}
              placeholder="Lower back stiffness. Right shoulder occasionally."
              rows={4}
              className="w-full resize-none rounded-md border border-border bg-secondary/50 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 focus:border-gold/60 focus:outline-none"
            />
            <div className="flex gap-3">
              <Button variant="ghost" onClick={() => setStep(3)} className="flex-1">
                Pass
              </Button>
              <Button onClick={() => setStep(3)} className="flex-1">
                Enter
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="flex flex-col gap-8">
            <div className="space-y-2">
              <p className="text-2xl leading-snug">When did you last train seriously.</p>
              <p className="text-muted-foreground text-sm">Rough estimate is fine.</p>
            </div>
            <div className="flex flex-col gap-2">
              {TRAINING_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setTrainingHistory(value)}
                  className={cn(
                    'rounded-md border px-4 py-3.5 text-left text-sm font-medium transition-colors',
                    trainingHistory === value
                      ? 'border-gold/60 bg-secondary text-foreground'
                      : 'border-border bg-secondary/50 text-muted-foreground'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {error && (
              <p className="text-sm text-destructive">Save failed. Try again.</p>
            )}
            <Button disabled={!trainingHistory || submitting} onClick={commit} className="w-full">
              {submitting ? 'Saving.' : 'Commit'}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
