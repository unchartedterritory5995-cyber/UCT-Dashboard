// Study landing — the pure geometry of the hero chart (docs/study/landing_redesign.md).
// No React: StudyLanding.jsx draws what this returns, and the test reads it directly.
import { trackSummary } from './studyMap'

export const METHOD_ID = 'method'
export const FOUNDATIONS_ID = 'foundations'
export const TAGLINE = 'Ten questions a day. The whole method, one trail.'

export const CHART_W = 640
export const CHART_H = 220
export const CHART_BASE = 176          // the chart floor
export const CHART_TOP = 36            // the tallest body top
export const CHART_PAD_X = 44

/** share of units mastered in a track, 0..1 (an empty track is 0). */
export function trackShare(track, byId) {
  const sum = trackSummary(track, byId)
  return sum.units ? sum.mastered / sum.units : 0
}

/** One candle per track: x, body top/bottom, state (mastered | started | open),
 *  the counts, and whether it carries the "you are here" marker. */
export function candles(tracks, byId, recommendedTrackId) {
  const n = Math.max(tracks.length, 1)
  const step = (CHART_W - CHART_PAD_X * 2) / Math.max(n - 1, 1)
  return tracks.map((track, i) => {
    const sum = trackSummary(track, byId)
    const share = sum.units ? sum.mastered / sum.units : 0
    const bodyH = 14 + share * (CHART_BASE - CHART_TOP - 14)
    const x = n === 1 ? CHART_W / 2 : CHART_PAD_X + i * step
    const state = share >= 1 ? 'mastered' : share > 0 ? 'started' : 'open'
    return {
      id: track.id, title: track.title, x, top: CHART_BASE - bodyH, bottom: CHART_BASE, share, state,
      mastered: sum.mastered, units: sum.units, recommended: track.id === recommendedTrackId,
    }
  })
}
