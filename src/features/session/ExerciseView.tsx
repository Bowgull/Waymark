import { useState } from 'react'

interface ExerciseViewProps {
  name: string
  formCues: string | null
  equipment: string | null
  notes: string | null
  exerciseIndex: number
  totalExercises: number
}

export function ExerciseView({
  name,
  formCues,
  equipment,
  notes,
  exerciseIndex,
  totalExercises,
}: ExerciseViewProps) {
  const [showCues, setShowCues] = useState(false)

  return (
    <div>
      <p className="text-label mb-1 text-muted-foreground">
        Exercise {exerciseIndex + 1} of {totalExercises}
      </p>
      <h2 className="text-display-lg text-foreground">{name}</h2>

      {equipment && (
        <span className="mt-2 inline-block bg-surface-light px-2.5 py-0.5 text-xs text-muted-foreground">
          {equipment}
        </span>
      )}

      {notes && (
        <p className="mt-2 text-sm italic text-gold/80">{notes}</p>
      )}

      {formCues && (
        <div className="mt-3">
          <button
            onClick={() => setShowCues(!showCues)}
            className="text-sm font-medium text-teal active:text-teal/70"
          >
            {showCues ? 'Hide form cues' : 'Show form cues'}
          </button>
          {showCues && (
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {formCues}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
