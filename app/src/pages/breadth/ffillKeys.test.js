/**
 * `FFILL_KEYS` decides which metrics get carried across days they have no
 * reading for. That is a display decision that can silently contradict a data
 * decision made in the collector.
 *
 * It did. `cboe_putcall` sat in this list even though it is a DAILY series that
 * prints every session. The only time the carry could fire was a session CBOE
 * had not published — which is exactly the case the collector was changed to
 * store as an honest gap, after 86 of 150 stored rows turned out to be holding
 * the PREVIOUS session's ratio. So the API said "absent" and two separate
 * surfaces (BreadthViews and BreadthWidget, each with their own copy of the
 * fill loop) rendered yesterday's number as today's.
 *
 * The rule these tests encode: a key may be forward-filled only if it is a
 * genuinely WEEKLY survey, where carrying the reading between surveys is what
 * the number means.
 */
import { describe, it, expect } from 'vitest'
import { FFILL_KEYS, HM_METRICS_BY_KEY } from './heatmapMetrics'
import { METRIC_UNITS } from './chartMetrics'

// Metrics published once a week. Carrying these forward is correct.
const WEEKLY = new Set([
  'aaii_bulls', 'aaii_neutral', 'aaii_bears', 'aaii_spread', 'naaim',
])

// Metrics that print every trading session. Carrying these forward turns a
// missing session into a duplicate of the one before it.
const DAILY = [
  'cboe_putcall', 'cnn_fear_greed', 'vix', 'vxmt', 'vix_term_structure',
  'uct_exposure', 'adv_decline', 'up_4pct_today', 'down_4pct_today',
  'new_52w_highs', 'new_52w_lows', 'stage2_count', 'stage4_count',
  'breadth_score', 'mcclellan_osc', 'atr_ext_7', 'hvc_52w',
]

describe('FFILL_KEYS', () => {
  it('only carries metrics that are genuinely weekly', () => {
    const notWeekly = FFILL_KEYS.filter(k => !WEEKLY.has(k))
    expect(notWeekly).toEqual([])
  })

  it('never carries a daily metric', () => {
    const carried = DAILY.filter(k => FFILL_KEYS.includes(k))
    expect(carried).toEqual([])
  })

  it('does not carry cboe_putcall, which is daily and re-dated at the source', () => {
    expect(FFILL_KEYS).not.toContain('cboe_putcall')
  })

  it('still carries the weekly sentiment surveys', () => {
    for (const k of ['aaii_spread', 'naaim']) expect(FFILL_KEYS).toContain(k)
  })

  it('every carried key is a real metric somewhere', () => {
    // Union of both registries on purpose: `aaii_bulls`/`neutral`/`bears` and
    // `naaim` are charted but have no heatmap tile, so checking only the
    // heatmap would reject four legitimate keys.
    for (const k of FFILL_KEYS) {
      const known = Boolean(HM_METRICS_BY_KEY[k]) || k in METRIC_UNITS
      expect(known, `${k} is forward-filled but is not a known metric`).toBe(true)
    }
  })
})

describe('the fill loop itself', () => {
  // Both surfaces run this exact loop over FFILL_KEYS.
  const fill = (rowsNewestFirst) => {
    const asc = [...rowsNewestFirst].reverse()
    const carry = {}
    const out = []
    for (const row of asc) {
      const filled = { ...row }
      for (const k of FFILL_KEYS) {
        if (filled[k] == null && carry[k] != null) filled[k] = carry[k]
        else if (filled[k] != null) carry[k] = filled[k]
      }
      out.push(filled)
    }
    return out.reverse()
  }

  it('leaves an unpublished put/call session absent', () => {
    const rows = [
      { date: '2026-08-07', cboe_putcall: null, aaii_spread: null },
      { date: '2026-08-06', cboe_putcall: 0.86, aaii_spread: -12 },
    ]
    const [today] = fill(rows)
    expect(today.cboe_putcall).toBeNull()
    expect(today.aaii_spread).toBe(-12)   // weekly: carried, correctly
  })
})
