export const BAND_COLORS = [
  { value: 'yellow', label: 'Yellow', color: '#E8D942' },
  { value: 'orange', label: 'Orange', color: '#E28D37' },
  { value: 'red', label: 'Red', color: '#C9473F' },
  { value: 'blue', label: 'Blue', color: '#315BC7' },
  { value: 'purple', label: 'Purple', color: '#6541A5' },
] as const

export type BandColorValue = typeof BAND_COLORS[number]['value']

export function getBandSelectionLine(selected: string | null | undefined, prescribed: string | null | undefined): string {
  const band = BAND_COLORS.find(item => item.value === selected)
  if (!band) return 'Choose band.'
  return `${band.label}. ${selected === prescribed ? 'Working band.' : 'Adjusted.'}`
}
