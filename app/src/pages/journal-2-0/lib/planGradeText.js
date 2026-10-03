/**
 * Wave 13 lane 13A — the WORDS for a plan grade, shared by the trade page's card and the
 * review note (`planReview.js`), so the two can never describe one grade two ways. Pure: no
 * React, no network. Every number is the server's (`plan_grading.py`); nothing is recomputed.
 */

export const LABEL_TEXT = {
  date_only: 'Entry time unknown, so it is judged by day',
  edited_after_entry: 'Plan edited after entry',
  stop_from_plan: 'Your broker sent no stop, so the stop is your plan’s',
  size_from_closes: 'Size counts every close of this entry',
  side_mismatch: 'The plan’s stop sits on the other side of entry for this trade’s direction',
}

export const TIER_TEXT = {
  explicit: 'linked to this trade', verdict: 'Compass verdict before entry',
  window: 'written before entry', member: 'chosen by you',
}

export const px = (v) => (typeof v === 'number' && Number.isFinite(v)
  ? (Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(4)) : '—')
const pct = (v) => (typeof v === 'number' ? `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}%` : '')
const rr = (v) => (typeof v === 'number' ? `${v > 0 ? '+' : ''}${v.toFixed(2)}R` : '')
const shares = (v) => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : '—')

/** The verdict word and its tone for one check. */
export function checkVerdict(key, c) {
  const s = c?.state
  if (s === 'unreadable') return { word: 'Unreadable', tone: 'warn' }
  if (s === 'none' || !s) return { word: '—', tone: 'muted' }
  if (key === 'target') {
    if (s === 'hit') return { word: 'Hit', tone: 'good' }
    if (s === 'reached_not_taken') return { word: 'Reached, not taken', tone: 'warn' }
    if (s === 'not_reached') return { word: 'Not reached', tone: 'muted' }
    return { word: '—', tone: 'muted' }   // unknown: excursion not computed yet
  }
  if (key === 'stop') return s === 'kept' ? { word: 'Honoured', tone: 'good' } : { word: 'Not honoured', tone: 'bad' }
  if (key === 'size' && s === 'missed') {
    return { word: (c.deltaPct || 0) > 0 ? 'Oversized' : 'Undersized', tone: 'bad' }
  }
  return s === 'kept' ? { word: 'Kept', tone: 'good' } : { word: 'Missed', tone: 'bad' }
}

/** The one line under a check: planned vs actual, in the member's units. */
export function checkDetail(key, c, plan) {
  const s = c?.state
  if (s === 'unreadable') return `Your plan names more than one ${key === 'size' ? 'share count' : key}.`
  if (s === 'none' || !s) {
    if (c?.reason === 'side_mismatch') return 'Not graded: the plan points the other way.'
    return key === 'size' ? 'No planned shares.' : `No planned ${key}${key === 'target' ? '' : ' with a stop'}.`
  }
  if (key === 'entry') return `Planned ${px(c.planned)} · filled ${px(c.actual)} (${rr(c.chaseR)})`
  if (key === 'stop') return `Stop ${px(c.planned)} · exit ${px(c.exit)} · line ${px(c.limit)}`
  if (key === 'size') return `Planned ${shares(c.planned)} · entered ${shares(c.actual)} (${pct(c.deltaPct)})`
  if (s === 'unknown') return `Target ${px(c.planned)} · the best price reached is computed overnight.`
  return `Target ${px(c.planned)} · exit ${px(c.exit)}${c.mfePrice != null ? ` · best ${px(c.mfePrice)}` : ''}`
}
