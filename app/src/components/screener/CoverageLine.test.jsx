// ─── THE SENTENCE A MEMBER READS UNDER A SCREEN'S RESULTS ───────────────────
//
// ⛔ FOUR COUNTS, NEVER TWO. "We could not compute it" and "something broke" are
// different facts to a trader (controller resolution 5), and a screen that
// collapses them silently loses symbols and looks like a quiet market.
//
// ⭐ AND THE COUNT IS NOT THE WHOLE ANSWER. On the real 3,742-symbol universe
// this phase's own acceptance formula answers `answered=0,
// not_computable=2615` — a receipt a "0 matches" line would render as a calm
// tape when the truth is we hold no `rs_rank`.

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import CoverageLine from './CoverageLine'

afterEach(cleanup)

/** The receipt shape E-3's `evaluate_one` returns, with its own arithmetic
 *  closing. ⛔ DERIVED, not four literals: the identity
 *  `evaluated == answered + dropped + not_computable` is E-3's, and a fixture
 *  that restated all four could drift out of it silently. */
function receipt({ answered, dropped, not_computable: nc, ...rest }) {
  return {
    evaluated: answered + dropped + nc,
    answered,
    dropped,
    not_computable: nc,
    dropped_symbols: [],
    ...rest,
  }
}

describe('the coverage line reports all four outcomes', () => {
  it('the coverage line reports NOT COMPUTABLE separately from DROPPED', () => {
    render(<CoverageLine coverage={receipt({ answered: 3699, dropped: 2, not_computable: 41 })} />)
    const line = screen.getByTestId('coverage-line')
    expect(line).toHaveTextContent(/3,699 answered/)
    expect(line).toHaveTextContent(/41 .*not comput/i)
    // ⛔ 43 dropped would tell a trader the screen is broken. 2 dropped and 41
    // short of history tells them what is true.
    expect(line).not.toHaveTextContent(/43/)
  })

  it('and it names EVALUATED too, so the three parts can be checked against the whole', () => {
    render(<CoverageLine coverage={receipt({ answered: 3699, dropped: 2, not_computable: 41 })} />)
    const line = screen.getByTestId('coverage-line')
    expect(line).toHaveTextContent(/3,742 evaluated/)
    expect(line).toHaveTextContent(/2 dropped/)
  })

  it('nothing at all renders NOTHING — an absent receipt is not a receipt of zeroes', () => {
    // ⛔ "Nobody looked" and "we looked and found none" are E6-A2's two facts,
    // and `scan_store.coverage` answers `None` for the first. A line that drew
    // `0 evaluated · 0 answered` for a scan that never ran would be inventing a
    // measurement.
    const { container } = render(<CoverageLine coverage={null} />)
    expect(container.textContent).toBe('')
    expect(screen.queryByTestId('coverage-line')).toBeNull()
  })
})

describe('⭐ THE SHAPE OF THE ANSWER, NOT JUST THE COUNT', () => {
  it('answered=0 with a not-computable pile says MISSING DATA, not "no matches"', () => {
    // The measured case: `rs_rank > 80 && adr_pct > 4 && close > sma(close, 50)`
    // over the real universe on 2026-08-09.
    render(<CoverageLine coverage={receipt({ answered: 0, dropped: 1127, not_computable: 2615 })} />)
    const note = screen.getByTestId('coverage-nodata')
    expect(note).toHaveTextContent(/2,615/)
    expect(note).toHaveTextContent(/not a quiet market/i)
    // and the counts are still there, unchanged.
    expect(screen.getByTestId('coverage-line')).toHaveTextContent(/0 answered/)
  })

  it('but a genuinely empty screen with FULL coverage says no such thing', () => {
    // The control. Without it the note above is satisfied by a component that
    // renders the warning unconditionally, and "no matches today" — a real,
    // useful answer — would be branded a data outage on every quiet day.
    render(<CoverageLine coverage={receipt({ answered: 3742, dropped: 0, not_computable: 0 })} />)
    expect(screen.queryByTestId('coverage-nodata')).toBeNull()
    expect(screen.getByTestId('coverage-line')).toHaveTextContent(/0 not computable/)
  })
})

describe('the receipt has to close, and a broken one is SAID so', () => {
  it('arithmetic that does not add up is reported instead of presented', () => {
    // `scan_evaluator._assert_coverage_closes` refuses to WRITE a receipt whose
    // arithmetic is broken. Presenting one as sound is the same defect one
    // layer up.
    render(<CoverageLine coverage={{
      evaluated: 3742, answered: 3699, dropped: 2, not_computable: 0, dropped_symbols: [],
    }} />)
    expect(screen.getByTestId('coverage-broken')).toBeTruthy()
  })

  it('and a closing receipt is NOT reported as broken', () => {
    render(<CoverageLine coverage={receipt({ answered: 3699, dropped: 2, not_computable: 41 })} />)
    expect(screen.queryByTestId('coverage-broken')).toBeNull()
  })
})

describe('withheld sits BESIDE the four and never inside them', () => {
  it('a capped scan says how many were not looked at, on its own line', () => {
    render(<CoverageLine coverage={receipt({
      answered: 5, dropped: 0, not_computable: 0, withheld: 3737, withheld_reason: 'toolkit:symbols',
    })} />)
    expect(screen.getByTestId('coverage-withheld')).toHaveTextContent(/3,737/)
    // ⛔ NOT folded in. `evaluated` is what was looked at; a withheld symbol was
    // not, so counting it would claim work that did not happen.
    expect(screen.getByTestId('coverage-line')).toHaveTextContent(/5 evaluated/)
    expect(screen.getByTestId('coverage-line')).not.toHaveTextContent(/3,737/)
    expect(screen.queryByTestId('coverage-broken')).toBeNull()
  })

  it('and no withheld count renders no withheld line', () => {
    render(<CoverageLine coverage={receipt({ answered: 3699, dropped: 2, not_computable: 41 })} />)
    expect(screen.queryByTestId('coverage-withheld')).toBeNull()
  })
})

describe('the dropped symbols are shown, bounded', () => {
  it('the enumeration is listed and truncated with its remainder named', () => {
    const syms = Array.from({ length: 30 }, (_, i) => `SYM${i}`)
    render(<CoverageLine
      coverage={receipt({ answered: 0, dropped: 30, not_computable: 0, dropped_symbols: syms })}
      max={5}
    />)
    const block = screen.getByTestId('coverage-dropped-symbols')
    expect(block).toHaveTextContent('SYM0, SYM1, SYM2, SYM3, SYM4')
    expect(block).toHaveTextContent(/25 more/)
    expect(block).not.toHaveTextContent('SYM6')
  })
})
