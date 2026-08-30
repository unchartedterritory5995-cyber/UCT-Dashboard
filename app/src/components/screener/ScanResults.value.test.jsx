// app/src/components/screener/ScanResults.value.test.jsx
//
// ─── ⭐⭐ THE DEFINITION'S OWN ANSWER, ON THE ROW AND SORTABLE ───────────────
//
// ⛔ THE GAP TWO INDEPENDENT COMPETITIVE REGISTERS BOTH RANKED FIRST: a member could
// FILTER on their own formula and never SORT by it, and a sortable column of any
// formula is TC2000's entire product. The sweep computed the value on every hit and
// discarded it; then it was stored but read only from the LIVE row; now it is on
// screen. This file is the last hop, and without it the previous three commits are
// data nobody can see.

import { describe, it, expect } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

import ScanResults, { ScanResultRow, formatHitValue } from './ScanResults'

const DEF = { def_id: 'u_a', compute: { kind: 'ast', fn: 'f'.repeat(12), ast: { type: 'series', name: 'close' } } }

/** A payload in the shape the route sends: `tickers` plus `hits` rows. */
const payload = (rows) => ({
  status: 'evaluated',
  as_of: 20260829,
  tickers: rows.map((r) => r.symbol),
  hits: rows,
  coverage: { evaluated: rows.length, answered: rows.length, dropped: 0, not_computable: 0 },
})

const row = (symbol, value) => ({
  symbol, tier: 'nightly', in_nightly: true, live_as_of: null,
  value, src_price: null, live_cols: 0,
})

afterEach(() => cleanup())

describe('the value is rendered, and silence means "not recorded"', () => {
  it('⭐⭐ a hit shows the number its definition answered with', () => {
    render(<ScanResults definition={DEF} asOf={20260829} payload={payload([row('AAPL', 71.5)])} />)
    expect(screen.getByTestId('scan-hit-value-AAPL').textContent).toBe('71.5')
  })

  it('⛔⛔ a hit with NO recorded value renders NOTHING, never a zero', () => {
    // ⭐ THE DISTINCTION THE WHOLE CHAIN PRESERVES. A row from before the value was
    // recorded has none, and `0` is a number a member could sort by —
    // indistinguishable from a real answer. Silence is the honest render, and it is
    // the same idiom the tier chip already uses.
    render(<ScanResults definition={DEF} asOf={20260829} payload={payload([row('MSFT', null)])} />)
    expect(screen.queryByTestId('scan-hit-value-MSFT')).toBe(null)
  })

  it('⭐ a genuine ZERO is shown — it is a real answer', () => {
    render(<ScanResults definition={DEF} asOf={20260829} payload={payload([row('IBM', 0)])} />)
    expect(screen.getByTestId('scan-hit-value-IBM').textContent).toBe('0')
  })
})

describe('sorting by the definition\'s own answer', () => {
  const three = payload([row('AAA', 10), row('BBB', 90), row('CCC', 50)])
  const order = () => screen.getAllByTestId(/^scan-hit-[A-Z]+$/)
    .map((el) => el.getAttribute('data-testid').replace('scan-hit-', ''))

  it('⛔ the scan\'s OWN order is what shows first — re-ordering is the member\'s choice', () => {
    render(<ScanResults definition={DEF} asOf={20260829} payload={three} />)
    expect(order()).toEqual(['AAA', 'BBB', 'CCC'])
  })

  it('⭐⭐ one click ranks them, highest first', () => {
    render(<ScanResults definition={DEF} asOf={20260829} payload={three} />)
    fireEvent.click(screen.getByTestId('scan-sort-value'))
    expect(order()).toEqual(['BBB', 'CCC', 'AAA'])
  })

  it('⛔⛔ a row with NO value SINKS — it never sorts as zero', () => {
    // ⚰️ THE BUG THIS PREVENTS. `null` compared as 0 files every unrecorded row in
    // the MIDDLE of a member's ranking, between the negatives and the positives,
    // which reads as an answer rather than as an absence.
    render(<ScanResults definition={DEF} asOf={20260829}
      payload={payload([row('AAA', -5), row('BBB', null), row('CCC', 5)])} />)
    fireEvent.click(screen.getByTestId('scan-sort-value'))
    expect(order()).toEqual(['CCC', 'AAA', 'BBB'])
  })

  it('⛔ the control does not appear when nothing carries a value', () => {
    // ⭐ An affordance that reorders nothing is a promise this surface cannot keep.
    render(<ScanResults definition={DEF} asOf={20260829}
      payload={payload([row('AAA', null), row('BBB', null)])} />)
    expect(screen.queryByTestId('scan-sort-value')).toBe(null)
  })
})

describe('the formatter never invents or destroys information', () => {
  it('⛔⛔ a tiny value never prints as 0', () => {
    // ⚰️ A fixed two decimals renders 0.00003 as "0.00" — a plausible different
    // number, on the surface a member sorts by.
    expect(formatHitValue(0.00003)).not.toBe('0')
    expect(formatHitValue(0.00003)).not.toBe('0.00')
  })

  it('⭐ it reads at every scale a member\'s own formula can produce', () => {
    expect(formatHitValue(71.5)).toBe('71.5')
    expect(formatHitValue(0)).toBe('0')
    expect(formatHitValue(1234567890)).toMatch(/e\+/)
    expect(formatHitValue(-3.25)).toBe('-3.25')
  })

  it('⛔ a non-number is empty, not "NaN"', () => {
    for (const v of [null, undefined, NaN, Infinity, 'x']) {
      expect(formatHitValue(v)).toBe('')
    }
  })

  it('⛔ the row renders nothing for a non-finite value', () => {
    render(<ScanResultRow ticker="ZZZ" definition={DEF} onChart={() => {}}
      tier={{ tier: 'nightly', value: NaN }} />)
    expect(screen.queryByTestId('scan-hit-value-ZZZ')).toBe(null)
  })
})
