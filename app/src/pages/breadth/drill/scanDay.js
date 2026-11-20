import { luminance, parseColor } from '../../../utils/dividerColor'

/** Mark day's color from the chart canvas's own luminance (not the theme name, so a custom
 *  canvas works too): white on a dark canvas, black on a light one. Unknown → dark default. */
export function markColorFor(canvas) {
  const rgb = canvas ? parseColor(canvas) : null
  return rgb && luminance(rgb) > 0.5 ? '#000000' : '#ffffff'
}

/** What the drill's charts are told: the day to mark and the replay cutoff (or null each).
 *  Replay needs a past session: a live drill (today) is never cut. */
export function scanDayView({ markDay = true, replay = false, date = null, live = false } = {}) {
  return {
    markDay: markDay !== false && date ? date : null,
    replayCutoff: replay && date && !live ? date : null,
  }
}
