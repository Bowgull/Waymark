import { Button } from '@/components/ui/button'
import { logoPng } from '@/lib/markAssets'

interface GeneratePlanButtonProps {
  onGenerate: () => void
  loading: boolean
  onAddSession?: () => void
}

export function GeneratePlanButton({ onGenerate, loading, onAddSession }: GeneratePlanButtonProps) {
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
      {onAddSession && (
        <button
          onClick={onAddSession}
          className="relative mt-5 flex items-center gap-1.5 text-xs text-gold/60 active:text-gold transition-colors"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 4v12M4 10h12" strokeLinecap="round" /></svg>
          Add Session
        </button>
      )}
    </div>
  )
}
