import { useState } from 'react'

import { Badge } from '@/components/ui/badge'

interface PrescriptionDisplay {
  weightLbs: number | null
  tmLbs: number | null
  setsReps: string
  plateMath: string | null
  wavePercentage: number | null
  section: string
}

interface HistoryDisplay {
  lastWeightLbs: number | null
  lastReps: number | null
  lastDate: string | null
  prWeightLbs: number | null
  prReps: number | null
  prDate: string | null
  recentTrend: { date: string; weightLbs: number; avgReps: number }[] | null
  suggestion: { message: string } | null
}

interface ExerciseViewProps {
  name: string
  formCues: string | null
  equipment: string | null
  notes: string | null
  formVideoUrl?: string | null
  section?: string | null
  exerciseIndex: number
  totalExercises: number
  prescription?: PrescriptionDisplay
  history?: HistoryDisplay
  /** Slot rendered between the prescription container and the form cues */
  children?: React.ReactNode
}

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function ExerciseView({
  name,
  formCues,
  equipment,
  notes,
  formVideoUrl,
  exerciseIndex,
  totalExercises,
  prescription,
  history,
  children,
}: ExerciseViewProps) {
  const [showCues, setShowCues] = useState(false)
  const section = prescription?.section
  const hasPrescription = (section === 'main' && prescription?.weightLbs) ||
    ((section === 'accessory' || section === 'core') && history)

  return (
    <div>
      <p className="font-cinzel text-xs uppercase tracking-wider text-gold/50">
        Exercise {exerciseIndex + 1} of {totalExercises}
      </p>
      <h2 className="text-display-lg text-foreground">{name}</h2>

      {equipment && (
        <Badge variant="muted" className="mt-2">{equipment}</Badge>
      )}

      {notes && (
        <p className="mt-2 font-cinzel text-xs leading-snug text-gold/70">{notes}</p>
      )}

      {/* Prescription / History container */}
      {hasPrescription && (
        <div className="mt-4 rounded border border-gold/15 bg-gradient-to-b from-[#1A1A10]/60 to-[#12170E]/40 p-5 shadow-[0_0_12px_rgba(0,0,0,0.3)]">
          {section === 'main' && prescription?.weightLbs && (
            <div>
              <p className="mb-1 font-cinzel text-[10px] uppercase tracking-widest text-gold/40">Prescribed</p>
              <p className="font-cinzel text-lg font-semibold text-gold">
                {prescription.setsReps} @ {prescription.weightLbs}lb
              </p>
              {prescription.plateMath && (
                <p className="text-xs text-muted-foreground">{prescription.plateMath}</p>
              )}
              {prescription.wavePercentage && prescription.tmLbs && (
                <p className="text-xs text-muted-foreground">
                  {Math.round(prescription.wavePercentage * 100)}% of TM ({prescription.tmLbs}lb)
                </p>
              )}
              {history?.prWeightLbs && history.prDate && (
                <p className="mt-1 text-xs text-gold/60">
                  PR: {history.prWeightLbs}lb × {history.prReps} ({formatShortDate(history.prDate)})
                </p>
              )}
            </div>
          )}

          {section === 'accessory' && history && (
            <div>
              <p className="mb-1 font-cinzel text-[10px] uppercase tracking-widest text-gold/40">Last Session</p>
              {history.lastWeightLbs && history.lastDate && (
                <p className="text-xs text-muted-foreground">
                  {history.lastWeightLbs}lb × {history.lastReps} ({formatShortDate(history.lastDate)})
                </p>
              )}
              {history.recentTrend && history.recentTrend.length > 1 && (
                <p className="text-xs text-muted-foreground">
                  {history.recentTrend.map(t => `${t.weightLbs}lb`).join(' → ')}
                </p>
              )}
              {history.suggestion && (
                <button className="mt-1.5 inline-block rounded-full border border-gold/30 bg-gold/10 px-2.5 py-0.5 text-xs font-medium text-gold active:bg-gold/20">
                  {history.suggestion.message}
                </button>
              )}
            </div>
          )}

          {section === 'core' && history && (
            <div>
              <p className="mb-1 font-cinzel text-[10px] uppercase tracking-widest text-gold/40">Last Session</p>
              {history.lastWeightLbs != null && history.lastDate && (
                <p className="text-xs text-muted-foreground">
                  {history.lastReps} reps ({formatShortDate(history.lastDate)})
                </p>
              )}
              {history.suggestion && (
                <button className="mt-1.5 inline-block rounded-full border border-gold/30 bg-gold/10 px-2.5 py-0.5 text-xs font-medium text-gold active:bg-gold/20">
                  {history.suggestion.message}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Set tracker slot (injected from WorkoutPage) */}
      {children}

      {/* Form cues + video below the set tracker */}
      {(formCues || formVideoUrl) && (
        <div className="mt-6 rounded border border-gold/15 bg-gradient-to-b from-[#1C1A12]/70 to-[#14120C]/50 p-4 shadow-inner">
          {formCues && (
            <div>
              <button
                onClick={() => setShowCues(!showCues)}
                className="font-cinzel text-xs font-medium tracking-wider text-teal active:text-teal/70"
              >
                {showCues ? 'Hide form cues' : 'Show form cues'}
              </button>
              {showCues && (
                <p className="mt-2 font-cinzel text-xs leading-relaxed text-teal/80">
                  {formCues}
                </p>
              )}
            </div>
          )}

          {formVideoUrl && (
            <a
              href={formVideoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex items-center gap-1.5 font-cinzel text-xs font-medium tracking-wider text-teal active:text-teal/70 ${formCues ? 'mt-2' : ''}`}
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Watch Form
            </a>
          )}
        </div>
      )}
    </div>
  )
}
