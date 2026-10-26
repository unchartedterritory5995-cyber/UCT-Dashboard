/**
 * studyOverlays — ONE question for the chart layer of a Study item: which
 * drawings does this item carry? High Volume Edge: the HVC ray + AVWAP
 * (hveOverlay.js). Gap Support: the gap top + gap-day low rays
 * (gapSupportOverlay.js). Anything else: none. Both SpotDrill (the member's
 * reveal) and StudyReview (the reviewer's card) ask here, so the two screens
 * cannot drift. Pure.
 */
import { hveAnnotations, isHveItem } from './hveOverlay'
import { gapAnnotations, isGapSupportItem } from './gapSupportOverlay'

export function studyAnnotations(item, bars) {
  if (!item) return null
  if (isHveItem(item)) return hveAnnotations(item, bars)
  if (isGapSupportItem(item)) return gapAnnotations(item, bars)
  return null
}

export function hasStudyOverlay(item) {
  return isHveItem(item) || isGapSupportItem(item)
}
