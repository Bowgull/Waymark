interface InsightCalloutProps {
  insights: string[]
}

export function InsightCallout({ insights }: InsightCalloutProps) {
  if (insights.length === 0) return null

  // Show top 1-2 insights
  const visible = insights.slice(0, 2)

  return (
    <div className="mx-4 mb-6 animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
      <div className="rounded-md border-l-2 border-gold/30 bg-card/60 px-4 py-3">
        {visible.map((text, i) => (
          <p
            key={i}
            className={`text-sm leading-relaxed ${i > 0 ? 'mt-2 text-muted-foreground' : 'text-foreground'}`}
            style={{ fontFamily: i === 0 ? "'Cinzel Variable', serif" : undefined }}
          >
            {text}
          </p>
        ))}
      </div>
    </div>
  )
}
