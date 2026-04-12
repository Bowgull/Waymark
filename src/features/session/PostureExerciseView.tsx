import { Button } from '@/components/ui/button'
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
    <div className="animate-fade-in">
      <p className="text-label mb-1 text-muted-foreground">
        Exercise {exerciseIndex + 1} of {totalExercises}
      </p>
      <h2 className="text-display-lg text-foreground">
        {exercise.exercise?.name ?? 'Exercise'}
      </h2>

      {exercise.exercise?.equipment && (
        <span className="mt-2 inline-block bg-surface-light px-2.5 py-0.5 text-xs text-muted-foreground">
          {exercise.exercise.equipment}
        </span>
      )}

      {exercise.notes && (
        <p className="mt-2 text-sm italic text-teal/80">{exercise.notes}</p>
      )}

      {exercise.exercise?.formCues && (
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {exercise.exercise.formCues}
        </p>
      )}

      <p className="mt-4 text-center text-sm font-medium text-muted-foreground">
        Set {currentSet} of {totalSets}
      </p>

      {isHoldExercise ? (
        <HoldTimer
          key={`${exercise.id}-${currentSet}`}
          targetSec={exercise.holdSec!}
          onDone={onSetDone}
        />
      ) : (
        <div className="flex flex-col items-center py-8">
          <Button size="lg" onClick={onSetDone}>
            Done
          </Button>
        </div>
      )}
    </div>
  )
}
