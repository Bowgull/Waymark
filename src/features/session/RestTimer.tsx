import { RingTimer } from '@/components/RingTimer'
import { Button } from '@/components/ui/button'

interface RestTimerProps {
  totalSeconds: number
  secondsRemaining: number
  isOvertime: boolean
  onNext: () => void
  accentColor?: string
}

export function RestTimer({ totalSeconds, secondsRemaining, isOvertime, onNext, accentColor = '#E8C860' }: RestTimerProps) {
  return (
    <div className="flex flex-col items-center py-8">
      <RingTimer
        totalSeconds={totalSeconds}
        secondsRemaining={secondsRemaining}
        isOvertime={isOvertime}
        label={isOvertime ? 'Over' : 'Rest'}
        accentColor={accentColor}
      />
      <Button
        onClick={onNext}
        size="lg"
        className="mt-6"
        style={{ backgroundColor: accentColor }}
      >
        Next Set
      </Button>
    </div>
  )
}
