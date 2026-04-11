import { HoldTimer } from './HoldTimer'

interface PostureExercise {
  id: string
  exerciseId: string
  orderIndex: number
  holdSec: number | null
  sets: number | null
  completed: number
  exercise: { name: string; formCues: string | null; equipment: string | null } | null
  notes: string | null
}

interface PostureExerciseViewProps {
  exercise: PostureExercise
  exerciseIndex: number
  totalExercises: number
  currentSet: number
  onSetDone: () => void
}

export function PostureExerciseView({
  exercise,
  exerciseIndex,
  totalExercises,
  currentSet,
  onSetDone,
}: PostureExerciseViewProps) {
  const totalSets = exercise.sets ?? 1
  const isHoldExercise = exercise.holdSec != null && exercise.holdSec > 0

  return (
    <div>
      <p className="mb-1 text-xs uppercase tracking-widest text-zinc-500">
        Exercise {exerciseIndex + 1} of {totalExercises}
      </p>
      <h2 className="text-2xl font-bold text-zinc-100">
        {exercise.exercise?.name ?? 'Exercise'}
      </h2>

      {exercise.exercise?.equipment && (
        <span className="mt-2 inline-block rounded-full bg-zinc-800 px-2.5 py-0.5 text-xs text-zinc-400">
          {exercise.exercise.equipment}
        </span>
      )}

      {exercise.notes && (
        <p className="mt-2 text-sm italic text-[#4ACAAA]/80">{exercise.notes}</p>
      )}

      {/* Form cues — always visible for posture (this is learning) */}
      {exercise.exercise?.formCues && (
        <p className="mt-3 text-sm leading-relaxed text-zinc-400">
          {exercise.exercise.formCues}
        </p>
      )}

      {/* Set indicator */}
      <p className="mt-4 text-center text-sm font-medium text-zinc-500">
        Set {currentSet} of {totalSets}
      </p>

      {/* Hold timer or rep-based done button */}
      {isHoldExercise ? (
        <HoldTimer
          key={`${exercise.id}-${currentSet}`}
          targetSec={exercise.holdSec!}
          onDone={onSetDone}
        />
      ) : (
        <div className="flex flex-col items-center py-8">
          <button
            onClick={onSetDone}
            className="min-h-[48px] rounded-xl bg-[#E8C860] px-8 py-3 text-base font-bold text-zinc-950 active:bg-[#C8A030]"
          >
            Done
          </button>
        </div>
      )}
    </div>
  )
}
