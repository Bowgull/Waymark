// Replay harness only: a settable clock. While installed, Date.now() and
// `new Date()` (no arguments) read the replay's time, so the app's "today"
// (UTC and local-day paths alike) follows the replay day. Never imported by
// the app or the Worker.

const RealDate = Date
let nowMs: number | null = null

class ReplayDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) super(nowMs ?? RealDate.now())
    else super(...(args as [string | number | Date]))
  }
  static now(): number {
    return nowMs ?? RealDate.now()
  }
}

export function installClock(startMs: number): void {
  nowMs = startMs
  globalThis.Date = ReplayDate as DateConstructor
}

export function setClock(ms: number): void {
  nowMs = ms
}

export function clockMs(): number {
  return nowMs ?? RealDate.now()
}

export function uninstallClock(): void {
  nowMs = null
  globalThis.Date = RealDate
}
