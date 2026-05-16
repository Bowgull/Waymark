interface InsightCalloutProps {
  insights: string[]
}

export function InsightCallout({ insights }: InsightCalloutProps) {
  if (insights.length === 0) return null

  // Show top 1-2 insights
  const visible = insights.slice(0, 2)

  return (
    <div className="mx-4 mb-6 animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
      <div className="border-y border-border/20 px-5 py-4">
        {visible.map((text, i) => (
          <p
            key={i}
            className={`leading-relaxed ${
              i > 0
                ? 'mt-2 text-sm text-muted-foreground'
                : 'text-base text-foreground'
            }`}
            style={{ fontFamily: i === 0 ? "'Cinzel Variable', serif" : undefined }}
          >
            {text}
          </p>
        ))}
      </div>
    </div>
  )
}
