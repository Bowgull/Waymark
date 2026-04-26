export function TourPrompt({
  onTake,
  onSkip,
}: {
  onTake: () => void;
  onSkip: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.72)" }}
      onClick={onSkip}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-gold/20 bg-card p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-foreground">Take the tour.</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          Eleven steps. Today, sessions, library, settings. ~2 min. Skip anytime. Replay from the <span className="text-gold">?</span>.
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            onClick={onTake}
            className="w-full rounded-full border border-gold/40 bg-gold/10 px-4 py-2.5 text-sm font-semibold text-gold transition-colors hover:bg-gold/15"
          >
            Take the tour
          </button>
          <button
            type="button"
            onClick={onSkip}
            className="w-full text-center text-[12px] text-muted-foreground transition-colors hover:text-foreground"
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}
