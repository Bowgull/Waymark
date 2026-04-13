// Generates encouraging coach-style insights from dashboard data.
// Pure logic, no AI. Returns ranked insight strings.

import { kgToLbsDisplay, paceToMinSec } from './chartTheme'

interface InsightData {
  dashboard: {
    currentStreak: number
    prsThisMonth: number
    completionRate: number
    topLift: { name: string; weightLbs: number } | null
    thisWeek: { volume: number; sessions: number; avgRpe: number | null; avgSleep: number | null }
    lastWeek: { volume: number; sessions: number; avgRpe: number | null; avgSleep: number | null }
  } | null
  consistency: {
    currentStreak: number
    longestStreak: number
    weeks: { sessionsCompleted: number; sessionsPlanned: number }[]
  } | null
  prs: { exerciseName: string; maxWeightKg: number; date: string; previousMaxKg: number | null }[]
  correlations: { sleepHours: number | null; avgRpe: number | null; sessionCount: number }[]
  runSummary: { totalRuns: number; totalDistanceKm: number; avgPaceSecKm: number | null; bestPaceSecKm: number | null } | null
  categoryCompletion: Record<string, { completed: number; target: number }> | null
}

interface Insight {
  text: string
  priority: number // higher = more important
}

export function generateInsights(data: InsightData): string[] {
  const insights: Insight[] = []

  const { dashboard, consistency, prs, correlations, runSummary, categoryCompletion } = data

  // Streak insights
  if (consistency) {
    if (consistency.currentStreak >= 7) {
      insights.push({
        text: `${consistency.currentStreak}-day streak. Consistency is doing the work.`,
        priority: 8,
      })
    } else if (consistency.currentStreak >= 3) {
      insights.push({
        text: `${consistency.currentStreak} days in a row. Keep it going.`,
        priority: 5,
      })
    }

    if (consistency.longestStreak > 0 && consistency.currentStreak >= consistency.longestStreak) {
      insights.push({
        text: `New longest streak at ${consistency.currentStreak} days. Well earned.`,
        priority: 9,
      })
    }
  }

  // PR insights
  if (prs.length > 0) {
    const recentPrs = prs
      .filter(p => {
        const daysAgo = (Date.now() - new Date(p.date).getTime()) / (1000 * 60 * 60 * 24)
        return daysAgo <= 14
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

    if (recentPrs.length > 0) {
      const best = recentPrs[0]
      const lbs = kgToLbsDisplay(best.maxWeightKg)
      insights.push({
        text: `New PR on ${best.exerciseName}, ${lbs} lbs. Keep building.`,
        priority: 9,
      })

      if (best.previousMaxKg) {
        const gain = kgToLbsDisplay(best.maxWeightKg - best.previousMaxKg)
        if (gain > 0) {
          insights.push({
            text: `${best.exerciseName} up ${gain} lbs from your last best. Solid progress.`,
            priority: 7,
          })
        }
      }
    }
  }

  // Volume comparison
  if (dashboard) {
    const thisVol = dashboard.thisWeek.volume
    const lastVol = dashboard.lastWeek.volume
    if (lastVol > 0 && thisVol > 0) {
      const pctChange = Math.round(((thisVol - lastVol) / lastVol) * 100)
      if (pctChange >= 15) {
        insights.push({
          text: `Volume up ${pctChange}% this week. Solid momentum.`,
          priority: 6,
        })
      } else if (pctChange <= -20) {
        insights.push({
          text: `Lighter volume this week. Good time to recover or push next week.`,
          priority: 4,
        })
      }
    }

    // Session count momentum
    const thisSessions = dashboard.thisWeek.sessions
    const lastSessions = dashboard.lastWeek.sessions
    if (thisSessions > lastSessions && lastSessions > 0) {
      insights.push({
        text: `${thisSessions} sessions this week, up from ${lastSessions}. Building momentum.`,
        priority: 5,
      })
    }
  }

  // Sleep correlation
  if (correlations.length >= 5) {
    const withSleep = correlations.filter(c => c.sleepHours != null && c.avgRpe != null)
    if (withSleep.length >= 5) {
      const goodSleep = withSleep.filter(c => c.sleepHours! >= 7)
      const poorSleep = withSleep.filter(c => c.sleepHours! < 6)
      if (goodSleep.length >= 3 && poorSleep.length >= 2) {
        const goodAvgRpe = goodSleep.reduce((s, c) => s + c.avgRpe!, 0) / goodSleep.length
        const poorAvgRpe = poorSleep.reduce((s, c) => s + c.avgRpe!, 0) / poorSleep.length
        if (poorAvgRpe - goodAvgRpe > 0.5) {
          insights.push({
            text: `Your strongest sessions follow 7+ hours of sleep. Worth protecting.`,
            priority: 7,
          })
        }
      }
    }
  }

  // Running insights
  if (runSummary && runSummary.totalRuns > 0) {
    if (runSummary.bestPaceSecKm) {
      insights.push({
        text: `Best pace: ${paceToMinSec(runSummary.bestPaceSecKm)}/km. Getting faster.`,
        priority: 5,
      })
    }
    if (runSummary.totalDistanceKm >= 10) {
      insights.push({
        text: `${runSummary.totalDistanceKm.toFixed(1)} km covered. Putting in the miles.`,
        priority: 4,
      })
    }
  }

  // Category completion (weekly progress toward rings)
  if (categoryCompletion) {
    const total = Object.values(categoryCompletion)
    const allDone = total.every(c => c.completed >= c.target)
    const totalCompleted = total.reduce((s, c) => s + c.completed, 0)
    const totalTarget = total.reduce((s, c) => s + c.target, 0)
    const remaining = totalTarget - totalCompleted

    if (allDone) {
      insights.push({
        text: `All rings closed. Full week complete.`,
        priority: 10,
      })
    } else if (remaining <= 2 && remaining > 0) {
      insights.push({
        text: `${remaining} session${remaining === 1 ? '' : 's'} left to close the rings. Almost there.`,
        priority: 7,
      })
    }
  }

  // Completion rate
  if (dashboard && dashboard.completionRate >= 90) {
    insights.push({
      text: `${dashboard.completionRate}% completion. Staying locked in.`,
      priority: 6,
    })
  }

  // Sort by priority descending, return text only
  return insights
    .sort((a, b) => b.priority - a.priority)
    .map(i => i.text)
}
