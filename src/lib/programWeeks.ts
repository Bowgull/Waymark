// The Program's week window, pure (the server's one-request /api/program and the page share it).

/** The six weeks the tiles and the road show: the 6-week cycle (Fighter) or six around the viewed week (Block Zero, with any extra weeks). */
export function cycleWeeks(viewWeek: number, totalWeeks: number, blockType: string): number[] {
  const total = Math.max(1, totalWeeks)
  let start: number
  if (blockType === 'block_zero') start = Math.max(1, Math.min(viewWeek, total) - 5)
  else start = Math.floor((Math.max(1, viewWeek) - 1) / 6) * 6 + 1
  if (blockType === 'block_zero' && total <= 6) start = 1
  const out: number[] = []
  for (let w = start; w < start + 6 && w <= total; w++) out.push(w)
  return out
}

/** Program's one request (page 59 §6 item 5); the tab prefetch asks for the same path. */
export function programPath(todayISO: string): string {
  return `/api/program?date=${todayISO}`
}
