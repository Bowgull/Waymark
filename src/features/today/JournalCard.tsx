// A Waybook entry as the Library shows it (the large first letter against its word).
// Today's Waybook is the one-line board in TodayBoards.tsx (page 35, C).

export function JournalEntry({ content }: { content: string }) {
  // Split on double newline to get separate entries (each "Save" / "Add More")
  const entries = content.split(/\n\n+/).filter((s) => s.trim())
  if (entries.length === 0) return null

  return (
    <div className="space-y-5">
      {entries.map((entry, ei) => {
        const lines = entry.split('\n').filter((l) => l.trim())
        return (
          <div key={ei} className="space-y-2">
            {lines.map((line, li) => {
              const capitalized = line.charAt(0).toUpperCase() + line.slice(1)
              return (
                <p key={li} className="font-[Cinzel] text-base leading-relaxed text-foreground">
                  {li === 0 ? (
                    <>
                      <span className="text-2xl leading-none text-gold">
                        {capitalized.charAt(0)}
                      </span>
                      {capitalized.slice(1)}
                    </>
                  ) : (
                    capitalized
                  )}
                </p>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
