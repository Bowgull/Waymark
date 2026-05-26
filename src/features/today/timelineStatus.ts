export function isActionableTodaySession(status: string, isAutoPending: boolean): boolean {
  if (isAutoPending) return false
  return status === 'planned' || status === 'in_progress' || status === 'missed'
}

export function canReplaceOrSkipTodaySession(status: string): boolean {
  return status === 'planned' || status === 'missed'
}
