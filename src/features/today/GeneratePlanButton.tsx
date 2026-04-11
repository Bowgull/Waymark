interface GeneratePlanButtonProps {
  onGenerate: () => void
  loading: boolean
}

export function GeneratePlanButton({ onGenerate, loading }: GeneratePlanButtonProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16">
      <p className="mb-4 text-sm text-zinc-500">No sessions planned for today.</p>
      <button
        onClick={onGenerate}
        disabled={loading}
        className="min-h-[48px] rounded-xl bg-[#E8C860] px-8 py-3 text-base font-bold text-zinc-950 active:bg-[#C8A030] disabled:opacity-50"
      >
        {loading ? 'Generating...' : "Generate Today's Plan"}
      </button>
    </div>
  )
}
