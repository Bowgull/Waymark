import { useTour } from "./tourContext";

export function TourButton() {
  const { openPrompt, enabled } = useTour();
  if (!enabled) return null;

  return (
    <button
      type="button"
      onClick={openPrompt}
      title="Replay tour"
      className="fixed top-3 right-3 z-30 flex h-8 w-8 items-center justify-center rounded-full border border-gold/30 bg-card/90 text-[13px] font-mono text-gold backdrop-blur-md transition-colors hover:border-gold/60"
    >
      ?
    </button>
  );
}
