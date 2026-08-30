/**
 * A window-depth refusal has to say what to DO about it.
 *
 * 🔴 Only the Regime Clock did. The Divergence lens refuses for exactly the
 * same reason — the loaded window is shorter than the lens needs — and left the
 * reader at a dead end, with the day pills that fix it sitting off-screen above.
 *
 * ⛔ THE ROSTER IS DERIVED, NOT TYPED. A hand-listed pair goes stale the day a
 * ninth view lands with a "Needs N sessions" refusal of its own — the same
 * shape as the hand-typed event families this feature already had to fix. This
 * renders EVERY registered lens against a one-row window and asks the rendered
 * output which of them refused on depth: any refusal whose sentence states a
 * session requirement must carry the shared hint.
 */
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'

// Both server-backed lenses call useSWR; no server behind this rail, and their
// refusal branches are not depth refusals, so the no-data shape is correct here.
vi.mock('swr', () => ({ default: () => ({ data: null, isLoading: false, error: null }) }))

import { STYLES, VIEW_CONFIG, optionDefaults } from './viewMetricConfig'
import { VIEW_COMPONENTS } from './viewRegistry'
import { WIDEN_WINDOW_HINT } from './breadthViewShared'

const LENSES = STYLES.filter(s => VIEW_CONFIG[s].kind === 'lens')

// One session. Every field a lens reads is present, so a lens that refuses here
// is refusing on DEPTH and not on a missing series.
const oneRow = [{
  date: '2026-08-28', pct_above_50sma: 55, pct_above_200sma: 60, breadth_score: 62,
  sp500_close: 5000, qqq_close: 400, rsp_spy_ratio: 0.62, iwm_qqq_ratio: 0.55,
  vix: 15, vxn: 20, advancing: 3000, declining: 1500, up_vol_ratio: 1.8,
  mcclellan_osc: 30, hvc_52w: 30, atr_ext_7: 12, new_52w_highs: 40, new_52w_lows: 9,
  is_ftd: 0,
}]

// "Needs 21 sessions of % above 50 SMA…", "Needs 20 sessions to z-score…" —
// the sentence a depth refusal writes, whichever lens wrote it.
const DEPTH_REFUSAL = /needs \d+ sessions/i

describe('every lens that refuses on window depth says how to fix it', () => {
  const refusedOnDepth = []

  for (const style of LENSES) {
    it(`${style}`, () => {
      const Component = VIEW_COMPONENTS[style]
      const { container } = render(<Component rows={oneRow} currentRow={oneRow[0]}
        prevRow={undefined} rowIdx={0} onDrill={() => {}} options={optionDefaults(style)} />)
      const text = container.textContent ?? ''
      if (!DEPTH_REFUSAL.test(text)) return
      refusedOnDepth.push(style)
      expect(text, `"${style}" refuses on window depth without the shared hint`)
        .toContain(WIDEN_WINDOW_HINT)
    })
  }

  it('found depth refusals to check — otherwise every case above is vacuous', () => {
    expect(refusedOnDepth.sort()).toEqual(['clock', 'divergence'])
  })

  it('the hint is one sentence with one author', () => {
    // Two lenses render it; a hand-copied third would drift from this string
    // without ever going red, which is why they import it instead.
    expect(WIDEN_WINDOW_HINT).toMatch(/day pills/i)
  })
})
