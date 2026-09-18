/**
 * D-052 rails — the V2-2 default selection.
 *
 * ⛔ THE POINT OF THE DEFAULT IS THAT IT EXERCISES THE SPLIT. If these pass while the
 * default yields one panel, the feature is invisible on first load and the screenshots
 * prove nothing — which is the state this decision exists to end.
 */
import { describe, it, expect } from 'vitest'
import {
  CHART_PRESETS, ALL_METRICS, UNIT, unitOf, isChartable,
} from '../chartMetrics'
import {
  V1_DEFAULT_SELECTED, V2_DEFAULT_EXTRA, V2_DEFAULT_SELECTED, defaultSelectionFor,
} from './defaults'
import { panelsFor } from './panels'

/** "Most used" = appears in the most presets. The firm's own record, not an opinion. */
function presetUsage() {
  const count = {}
  for (const p of CHART_PRESETS) for (const k of (p.metrics || [])) count[k] = (count[k] || 0) + 1
  return count
}

describe('D-052 · the V2-2 default exercises the panel split', () => {
  it('⛔⛔ yields at least TWO panels — otherwise V2-2 is invisible on first load', () => {
    const panels = panelsFor(V2_DEFAULT_SELECTED)
    expect(panels.length,
      `the V2 default produced ${panels.length} panel(s); a member would see no stack`)
      .toBeGreaterThanOrEqual(2)
  })

  it('⭐ CONTROL — V1\'s default really does yield ONE panel, so the change is not cosmetic', () => {
    // If V1's default already split, D-052 would be solving nothing and this file
    // should be deleted rather than kept green.
    expect(panelsFor(V1_DEFAULT_SELECTED).length).toBe(1)
  })

  it('⛔ V1\'s default is UNTOUCHED — a flag-off member\'s first load cannot move', () => {
    expect(V1_DEFAULT_SELECTED).toEqual(['breadth_score', 'pct_above_50sma'])
    expect(defaultSelectionFor({ v22: false })).toEqual(V1_DEFAULT_SELECTED)
  })

  it('the V2 default is V1\'s plus exactly one metric, in that order', () => {
    expect(V2_DEFAULT_SELECTED).toEqual([...V1_DEFAULT_SELECTED, V2_DEFAULT_EXTRA])
    expect(defaultSelectionFor({ v22: true })).toEqual(V2_DEFAULT_SELECTED)
  })
})

describe('D-052 · the extra metric is DERIVED, and the pin still holds', () => {
  it('⛔ the pinned metric is a legitimate most-used non-percentage metric', () => {
    // Re-runs the derivation. A preset change that dethrones the pin makes this RED —
    // a reviewable decision — instead of silently moving every member's first view.
    const usage = presetUsage()
    const candidates = Object.entries(usage)
      .filter(([k]) => unitOf(k) !== UNIT.PCT && isChartable(k))
      .sort((a, b) => b[1] - a[1])
    expect(candidates.length).toBeGreaterThan(0)
    const top = candidates[0][1]
    const winners = candidates.filter(([, c]) => c === top).map(([k]) => k)
    expect(winners,
      `${V2_DEFAULT_EXTRA} is no longer a most-used non-percentage metric; winners are `
      + `${winners.join(', ')}. Re-derive and record a decision before changing the pin.`)
      .toContain(V2_DEFAULT_EXTRA)
  })

  it('⭐ the tie is REAL — recorded so the tiebreak is not mistaken for a measurement', () => {
    // D-052 states the derivation tied and names the reason the COUNT family won. If the
    // tie ever resolves on its own, that note is stale and should be corrected.
    const usage = presetUsage()
    const candidates = Object.entries(usage)
      .filter(([k]) => unitOf(k) !== UNIT.PCT && isChartable(k))
      .sort((a, b) => b[1] - a[1])
    const top = candidates[0][1]
    const winners = candidates.filter(([, c]) => c === top).map(([k]) => k)
    expect(winners.length,
      'the derivation no longer ties — D-052\'s tiebreak note is now stale').toBeGreaterThan(1)
  })

  it('⛔ the tiebreak chose a COUNT, which is what A-28 and the era note need', () => {
    // Not decoration: A-28 specifies bars for counts, and the era note attaches to count
    // panels. A default without a count family exercises neither of V2-3's headline items.
    expect(unitOf(V2_DEFAULT_EXTRA)).toBe(UNIT.COUNT)
  })

  it('the extra is a real, chartable registry metric', () => {
    expect(ALL_METRICS.map(m => m.key)).toContain(V2_DEFAULT_EXTRA)
    expect(isChartable(V2_DEFAULT_EXTRA)).toBe(true)
  })

  it('the extra is not already in V1\'s default', () => {
    expect(V1_DEFAULT_SELECTED).not.toContain(V2_DEFAULT_EXTRA)
  })
})
