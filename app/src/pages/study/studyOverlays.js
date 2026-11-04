/**
 * studyOverlays — ONE question for the chart layer of a Study item: which
 * drawings does this item carry? High Volume Edge: the HVC ray + AVWAP
 * (hveOverlay.js). Gap Support: the gap top + gap-day low rays
 * (gapSupportOverlay.js). Go Signal on hourly bars: the flag high + flag low
 * rays (goSignalOverlay.js). Bear Gap off the Highs: the gap-day high + the
 * gap-fill level rays (bearGapOverlay.js). Anything else: none. Both SpotDrill (the member's
 * reveal) and StudyReview (the reviewer's card) ask here, so the two screens
 * cannot drift. Pure.
 */
import { hveAnnotations, isHveItem } from './hveOverlay'
import { gapAnnotations, isGapSupportItem } from './gapSupportOverlay'
import { goSignalAnnotations, goSignalOpenBarTimes, isGoSignalHourlyItem } from './goSignalOverlay'
import { bearGapAnnotations, isBearGapItem } from './bearGapOverlay'
import { toChartTime } from '../../components/chart/patternTime'

export function studyAnnotations(item, bars) {
  if (!item) return null
  if (isHveItem(item)) return hveAnnotations(item, bars)
  if (isGapSupportItem(item)) return gapAnnotations(item, bars)
  if (isGoSignalHourlyItem(item)) return goSignalAnnotations(item, bars)
  if (isBearGapItem(item)) return bearGapAnnotations(item, bars)
  return null
}

/** The colour of the open marks on every Study chart: white, so it never reads as the gold setup level. */
export const STUDY_OPEN_MARK_COLOR = '#ffffff'

/**
 * The bars an item wants the reader to look at, as StockChart markers: a white dot UNDER each of an hourly Go
 * Signal's first three bars of the ruled session (the open). The candles keep their own red/green: painting
 * them white hid the one thing the reader has to see (owner 2026-11-01: "Can't see with them all white
 * honestly"). Marker times ride StockChart's intraday shift (toChartTime) like every other hourly marker.
 * Anything else: null. Same on the member's reveal and the reviewer's card.
 */
export function studyOpenMarkers(item, bars) {
  if (!item || !isGoSignalHourlyItem(item)) return null
  const times = goSignalOpenBarTimes(item, bars)
  if (!times) return null
  return times.map((t, i) => ({
    time: toChartTime(Number(t), '60'), position: 'belowBar', color: STUDY_OPEN_MARK_COLOR, shape: 'circle',
    text: '', id: `study-open-${i + 1}`,
  }))
}

export function hasStudyOverlay(item) {
  return isHveItem(item) || isGapSupportItem(item) || isGoSignalHourlyItem(item) || isBearGapItem(item)
}
