export const CHART_COLORS = {
  gold: '#E8C860',
  goldDark: '#C8A030',
  teal: '#3BB5CC',
  muted: '#4A7A6A',
  grid: '#1A3A2E',
  bg: '#081A14',
  surface: '#0A2018',
  text: '#6A9A8A',
  foreground: '#F0EDE4',
}

export const AXIS_STYLE = {
  stroke: '#4A7A6A',
  fontSize: 10,
  fontFamily: "'Geist Variable', sans-serif",
  tickLine: false as const,
  axisLine: false as const,
}

export const TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: '#0A2018',
    border: '1px solid #1A3A2E',
    color: '#F0EDE4',
    borderRadius: 0,
    fontSize: 12,
  },
  cursor: { stroke: '#E8C860', strokeWidth: 1 },
}

export function kgToLbsDisplay(kg: number): number {
  return Math.round(kg * 2.20462)
}

export function paceToMinSec(paceSecKm: number): string {
  const min = Math.floor(paceSecKm / 60)
  const sec = Math.round(paceSecKm % 60)
  return `${min}:${String(sec).padStart(2, '0')}`
}
