export function getSessionIntent(sessionType: string): string {
  switch (sessionType) {
    case 'strength':
      return 'Build the frame. Compound lifts, clean reps.'
    case 'foundation_run':
      return 'Aerobic base. Conversational pace, nasal breathing.'
    case 'running':
      return 'Interval work. Push the edges of the pace.'
    case 'mt_class':
      return 'Live skill. Pads, drills, sparring if it happens.'
    case 'bag_work':
      return 'Solo rounds. Combos and timing on the bag.'
    case 'posture_corrective':
      return 'Undo the desk. Upper release, lower mobility.'
    case 'active_recovery':
      return 'Keep blood moving. Nothing heavy.'
    case 'skip_rope':
      return 'Footwork. Light conditioning.'
    default:
      return 'Show up and put in the work.'
  }
}
