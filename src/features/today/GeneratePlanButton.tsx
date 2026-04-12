import { Button } from '@/components/ui/button'
import { logoPng } from '@/lib/markAssets'

interface GeneratePlanButtonProps {
  onGenerate: () => void
  loading: boolean
}

export function GeneratePlanButton({ onGenerate, loading }: GeneratePlanButtonProps) {
  return (
    <div className="relative flex flex-col items-center justify-center py-16">
      <img
        src={logoPng}
        alt=""
        draggable={false}
        className="absolute inset-0 m-auto h-48 w-48 object-contain opacity-[0.06] pointer-events-none"
      />
      <p className="relative mb-4 text-sm text-muted-foreground">No sessions planned for today.</p>
      <Button
        size="lg"
        onClick={onGenerate}
        disabled={loading}
        className="relative"
      >
        {loading ? 'Preparing...' : 'Prepare the Day'}
      </Button>
    </div>
  )
}
