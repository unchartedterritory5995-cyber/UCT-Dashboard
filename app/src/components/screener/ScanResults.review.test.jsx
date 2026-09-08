// app/src/components/screener/ScanResults.review.test.jsx
//
// ─── 🔴 THE WIRE — A SCAN'S ORDER REACHES THE REVIEW ────────────────────────
//
// ⛔ WHAT THIS CATCHES THAT `reviewEntry.test.jsx` CANNOT. That file proves the
// button, given a list, publishes that list. It renders the button directly, so
// it stays green if this surface never mounts one — or mounts one holding the
// WRONG list. A scan's whole contribution to a review is its ORDER, and the
// order lives here, behind a sort control and a two-block layout.
//
// ⛔ AND THE ORDER IS READ OFF THE SCREEN, not off the payload. Every case below
// asserts the published symbols against what the DOM is showing, because "the
// review walks the list you just read" is the product claim, and a test that
// compared the session to the fixture would agree with a surface that had
// stopped rendering what it publishes.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

const navigated = []
vi.mock('react-router-dom', () => ({
  useNavigate: () => (to) => { navigated.push(to) },
}))
vi.mock('../chart/pane/ChartPane', () => ({ default: () => null }))

import ScanResults from './ScanResults'
import { read } from '../../pages/charts/review/reviewSession'

const DEF = {
  id: 'u_a',
  meta: { name: 'Momentum' },
  compute: { kind: 'ast', fn: 'f'.repeat(12), ast: { type: 'series', name: 'close' } },
}

const nightly = (symbol, value) => ({
  symbol, tier: 'nightly', in_nightly: true, live_as_of: null, value, src_price: null, live_cols: 0,
})
const liveOnly = (symbol) => ({
  symbol, tier: 'live', in_nightly: false, live_as_of: 1756400000, value: null, src_price: null, live_cols: 1,
})

const payload = (rows) => ({
  status: 'evaluated',
  as_of: 20260829,
  // The route derives `tickers` from the NIGHTLY half alone — mirrored here so
  // the live-only tail is genuinely absent from it, as it is in production.
  tickers: rows.filter((r) => r.in_nightly).map((r) => r.symbol),
  hits: rows,
  coverage: { evaluated: rows.length, answered: rows.length, dropped: 0, not_computable: 0 },
})

/** The tickers this surface is SHOWING, top to bottom, across both blocks. */
const onScreen = () => screen.getAllByTestId(/^scan-hit-[A-Z]+$/)
  .map((el) => el.getAttribute('data-testid').replace('scan-hit-', ''))

beforeEach(() => { sessionStorage.clear(); navigated.length = 0 })
afterEach(cleanup)

describe('a scan hands its ORDER to the review', () => {
  const three = payload([nightly('AAA', 10), nightly('BBB', 90), nightly('CCC', 50)])

  it('🔴 the review door is ON this surface, and it publishes the sweep order', () => {
    render(<ScanResults definition={DEF} asOf={20260829} payload={three} />)
    fireEvent.click(screen.getByTestId('review-charts'))

    const s = read()
    expect(s.symbols).toEqual(onScreen())
    expect(s.symbols).toEqual(['AAA', 'BBB', 'CCC'])
    expect(s.index).toBe(0)
    expect(s.source).toBe('scan')
    // The screen's name and the definition's hash travel with it, so a review
    // can be traced back to the exact tree that produced the list.
    expect(s.label).toBe('Momentum')
    expect(s.sourceId).toBe(DEF.compute.fn)
    expect(navigated).toEqual(['/charts?sym=AAA&tf=D'])
  })

  it('⛔⛔ SORTED BY VALUE, THE REVIEW WALKS THE SORTED LIST', () => {
    // The defect this exists against: publishing the sweep's order while the
    // member is looking at their own ranking. Both lists are "the scan's
    // results", both are plausible, and "3 / 3" would name a symbol that is not
    // third on screen.
    render(<ScanResults definition={DEF} asOf={20260829} payload={three} />)
    fireEvent.click(screen.getByTestId('scan-sort-value'))
    expect(onScreen()).toEqual(['BBB', 'CCC', 'AAA'])

    fireEvent.click(screen.getByTestId('review-charts'))
    expect(read().symbols).toEqual(['BBB', 'CCC', 'AAA'])
    // ⭐ AND THE ORDERING IS NAMED. "next" only means something under the order
    // that produced the list, so the session records which one it captured.
    expect(read().sort).toBe('value')
    expect(navigated).toEqual(['/charts?sym=BBB&tf=D'])
  })

  it('CONTROL: unsorted, the session records no ordering rather than inventing one', () => {
    render(<ScanResults definition={DEF} asOf={20260829} payload={three} />)
    fireEvent.click(screen.getByTestId('review-charts'))
    expect(read().sort).toBe(null)
  })

  it('⭐ THE LIVE-ONLY TAIL IS REVIEWED TOO — it is on screen, so it is in the list', () => {
    // A review that stopped at the end of the nightly block would report
    // "2 / 2" with two more rows still below the fold.
    render(<ScanResults definition={DEF} asOf={20260829}
      payload={payload([nightly('AAA', 1), nightly('BBB', 2), liveOnly('ZZZ'), liveOnly('YYY')])} />)
    expect(onScreen()).toEqual(['AAA', 'BBB', 'ZZZ', 'YYY'])

    fireEvent.click(screen.getByTestId('review-charts'))
    expect(read().symbols).toEqual(['AAA', 'BBB', 'ZZZ', 'YYY'])
  })

  it('⛔ a screen that MATCHED NOTHING offers a disabled door, not a missing one', () => {
    // An empty result is a RESULT. Hiding the control would read as "this
    // surface does not do reviews", and a member would go looking for it.
    render(<ScanResults definition={DEF} asOf={20260829} payload={payload([])} />)
    const btn = screen.getByTestId('review-charts')
    expect(btn).toBeDisabled()
    fireEvent.click(btn)
    expect(read()).toBeNull()
    expect(navigated).toEqual([])
  })

  it('⛔ AN UNRUN SCREEN OFFERS NO REVIEW AT ALL — there is no list to walk', () => {
    // `not-run` is "nobody looked", not "nothing matched". A disabled review
    // button here would imply a list exists and is empty.
    render(<ScanResults definition={DEF} asOf={20260829}
      payload={{ status: 'not-run', as_of: 20260829, coverage: null }} />)
    expect(screen.queryByTestId('review-charts')).toBe(null)
    expect(screen.getByTestId('scan-results-not-run')).toBeInTheDocument()
  })

  it('CONTROL: the Evidence door still opens on a saved, hashed definition', () => {
    // The toolbar's render condition widened to let Review appear on any
    // evaluated screen. This is the case that would go red if that widening had
    // swallowed the button the toolbar already had.
    render(<ScanResults definition={DEF} asOf={20260829} payload={three} />)
    expect(screen.getByTestId('scan-evidence-open')).toBeInTheDocument()
  })
})
