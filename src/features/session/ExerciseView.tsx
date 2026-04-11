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
      <p className="mb-1 text-xs uppercase tracking-widest text-zinc-500">
        Exercise {exerciseIndex + 1} of {totalExercises}
      </p>
      <h2 className="text-2xl font-bold text-zinc-100">{name}</h2>

      {equipment && (
        <span className="mt-2 inline-block rounded-full bg-zinc-800 px-2.5 py-0.5 text-xs text-zinc-400">
          {equipment}
        </span>
      )}

      {notes && (
        <p className="mt-2 text-sm italic text-[#E8C860]/80">{notes}</p>
      )}

      {formCues && (
        <div className="mt-3">
          <button
            onClick={() => setShowCues(!showCues)}
            className="text-sm font-medium text-[#4ACAAA] active:text-[#4ACAAA]/70"
          >
            {showCues ? 'Hide form cues' : 'Show form cues'}
          </button>
          {showCues && (
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">
              {formCues}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
