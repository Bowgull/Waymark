import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { GoldDivider } from '@/components/ui/GoldDivider'
import { HoldTimer } from './HoldTimer'
import { POSTURE_SECTION_LABELS } from '@/lib/postureTemplate'
import type { PostureSection } from '@/lib/postureTemplate'

interface PostureExercise {
  id: string
  exerciseId: string
  orderIndex: number
  holdSec: number | null
  sets: number | null
  completed: number
  section?: string | null
  exercise: { name: string; formCues: string | null; equipment: string | null; formVideoUrl?: string | null } | null
  notes: string | null
}

interface PostureExerciseViewProps {
  exercise: PostureExercise
  exerciseIndex: number
  totalExercises: number
  currentSet: number
  showSectionHeader: boolean
  onSetDone: () => void
}

export function PostureExerciseView({
  exercise,
  exerciseIndex,
  totalExercises,
  currentSet,
  showSectionHeader,
  onSetDone,
}: PostureExerciseViewProps) {
  const totalSets = exercise.sets ?? 1
  const isHoldExercise = exercise.holdSec != null && exercise.holdSec > 0
  const sectionLabel = exercise.section
    ? POSTURE_SECTION_LABELS[exercise.section as PostureSection]
    : null

  return (
    <div className="animate-fade-in">
      {showSectionHeader && sectionLabel && (
        <div className="mb-6 pb-3">
          <h3 className="font-cinzel text-lg font-semibold tracking-wide text-gold">
            {sectionLabel}
          </h3>
          <GoldDivider className="mt-2" />
        </div>
      )}

      <p className="font-cinzel text-xs uppercase tracking-wider text-gold/50">
        Exercise {exerciseIndex + 1} of {totalExercises}
      </p>
      <h2 className="text-display-lg text-foreground">
        {exercise.exercise?.name ?? 'Exercise'}
      </h2>

      {exercise.exercise?.equipment && (
        <Badge variant="muted" className="mt-2">{exercise.exercise.equipment}</Badge>
      )}

      {exercise.notes && (
        <p className="mt-3 text-sm leading-relaxed text-gold/80">
          {exercise.notes}
        </p>
      )}

      {exercise.exercise?.formCues && (
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {exercise.exercise.formCues}
        </p>
      )}

      {exercise.exercise?.formVideoUrl && (
        <a
          href={exercise.exercise.formVideoUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-teal active:text-teal/70"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Watch Form
        </a>
      )}

      <p className="mt-4 text-center font-cinzel text-xs uppercase tracking-wider text-gold/50">
        Set {currentSet} of {totalSets}
      </p>

      {isHoldExercise ? (
        <HoldTimer
          key={`${exercise.id}-${currentSet}`}
          targetSec={exercise.holdSec!}
          onDone={onSetDone}
        />
      ) : (
        <div className="mt-4 flex flex-col items-center rounded-md border border-gold/20 bg-deep-forest/40 p-6 shadow-[inset_0_1px_0_rgba(232,200,96,0.06)]">
          <Button size="lg" onClick={onSetDone}>
            Done
          </Button>
        </div>
      )}
    </div>
  )
}
