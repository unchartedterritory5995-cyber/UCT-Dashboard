// Example gallery helpers (no React): the list key, the subject of an item,
// and the grade words. Kept out of StudyGallery.jsx so that file exports only
// a component (react-refresh/only-export-components).
import { REVIEW_URL } from './StudyReview'

export const GRADES = ['okay', 'good', 'great']

export function galleryKey(skill) {
  const p = new URLSearchParams()
  if (skill) p.set('skill', skill)
  p.set('status', 'any')
  p.set('light', '1')
  p.set('limit', '5000')
  return `${REVIEW_URL}?${p.toString()}`
}

/** A candle name, a chart word, a detector: whatever the prompt names. */
export function subjectOf(item) {
  const p = item?.prompt_json || {}
  const r = item?.reveal_json || {}
  return p.subject || r.label || r.detector || item?.type || '?'
}
