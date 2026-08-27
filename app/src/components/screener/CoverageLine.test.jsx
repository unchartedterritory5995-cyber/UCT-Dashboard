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

// ─── ⭐ THE REASON, BESIDE THE COUNT (X42) ───────────────────────────────────
//
// `dropped_symbols` has always carried `{ticker, reason, detail?}` —
// `scan_store._validated_dropped` REFUSES an entry without a reason, in those
// words — and this component printed the tickers and threw the words away. "41
// not computable" tells a member their screen is short; "41 no value for vwap"
// tells them WHY. Every case here asserts the SENTENCE a member reads, because
// a line that renders the right testid with the wrong words passes every
// state-only rail.

/** One `{ticker, reason, detail?}` entry per symbol, exactly as
 *  `scan_evaluator._unanswered` files them. ⛔ BUILT, not retyped: the counts in
 *  each case below are measured off these lists so the fixture cannot drift out
 *  of the identity `record_coverage` enforces. */
const noValue = (n, input) => Array.from({ length: n }, (_, i) => ({
  ticker: `NC${i}`, reason: 'not-computable', detail: `no value for ${input}`,
}))
const bare = (n, reason) => Array.from({ length: n }, (_, i) => ({
  ticker: `DR${i}`, reason,
}))

describe('the causes are surfaced beside the counts, in the receipt own words', () => {
  it('the line names each cause and how many symbols carried it', () => {
    const dropped_symbols = [...noValue(41, 'vwap'), ...bare(2, 'no-bars')]
    render(<CoverageLine coverage={receipt({
      answered: 3699, dropped: 2, not_computable: 41, dropped_symbols,
    })} />)
    // ⛔ THE WHOLE SENTENCE, not a substring: `toHaveTextContent` would pass on a
    // line that also said something false beside the true part.
    expect(screen.getByTestId('coverage-causes').textContent)
      .toBe('Why: 41 no value for vwap \u00b7 2 no-bars')
  })

  it('the DETAIL wins over the bucket word, because the bucket is already the count', () => {
    // `reason: 'not-computable'` restates "41 not computable", which the counts
    // line says one row up. `detail` is the sentence the evaluator wrote for a
    // human, and it is the half a member can act on.
    render(<CoverageLine coverage={receipt({
      answered: 1, dropped: 0, not_computable: 2, dropped_symbols: noValue(2, 'rs_rank'),
    })} />)
    const why = screen.getByTestId('coverage-causes')
    expect(why.textContent).toBe('Why: 2 no value for rs_rank')
    expect(why.textContent).not.toMatch(/not-computable/)
  })

  it('CONTROL: a reason with no detail is still named — the words are not invented either way', () => {
    render(<CoverageLine coverage={receipt({
      answered: 1, dropped: 2, not_computable: 0, dropped_symbols: bare(2, 'stale-bars'),
    })} />)
    expect(screen.getByTestId('coverage-causes').textContent).toBe('Why: 2 stale-bars')
  })

  it('CONTROL: an EMPTY enumeration renders no causes line at all', () => {
    // Without this, the cases above are satisfied by a component that renders
    // the line unconditionally — and every clean screen in the app would grow a
    // "Why:" with nothing after it.
    render(<CoverageLine coverage={receipt({ answered: 3742, dropped: 0, not_computable: 0 })} />)
    expect(screen.queryByTestId('coverage-causes')).toBeNull()
  })

  it('CONTROL: entries carrying no words render no causes line, and invent no bucket', () => {
    // A bare string entry states nothing. Bucketing it as "unknown" would put a
    // word in the receipt's mouth, which is the one thing this component refuses
    // everywhere else.
    render(<CoverageLine coverage={receipt({
      answered: 0, dropped: 3, not_computable: 0, dropped_symbols: ['AAA', 'BBB', 'CCC'],
    })} />)
    expect(screen.queryByTestId('coverage-causes')).toBeNull()
    // …and the enumeration itself is untouched, so the absence above is about
    // the WORDS and not about the list having gone missing.
    expect(screen.getByTestId('coverage-dropped-symbols')).toHaveTextContent('AAA, BBB, CCC')
  })
})

describe('the causes speak only for the symbols they saw', () => {
  it('a CAPPED enumeration names its own scope instead of explaining the whole count', () => {
    // `record_coverage` accepts a list SHORTER than `dropped + not_computable`
    // (a cap) and never longer. A "Why: 200 no value for vwap" printed against
    // 851 unanswered symbols would be a confident explanation of 651 symbols
    // this component never saw.
    const listed = noValue(200, 'vwap')
    render(<CoverageLine coverage={receipt({
      answered: 100, dropped: 51, not_computable: 800, dropped_symbols: listed,
    })} />)
    const why = screen.getByTestId('coverage-causes')
    expect(why.textContent).toBe('Why, across the 200 listed: 200 no value for vwap')
    // The COUNTS are untouched — 851 is still 851. A sub-count derived from a
    // capped list, printed where a true count belongs, is the defect this
    // component exists to refuse.
    const line = screen.getByTestId('coverage-line')
    expect(line).toHaveTextContent('800 not computable')
    expect(line).toHaveTextContent('51 dropped')
  })

  it('CONTROL: a COMPLETE enumeration claims no scope it does not need', () => {
    render(<CoverageLine coverage={receipt({
      answered: 1, dropped: 0, not_computable: 3, dropped_symbols: noValue(3, 'vwap'),
    })} />)
    expect(screen.getByTestId('coverage-causes').textContent).toBe('Why: 3 no value for vwap')
  })

  it('the cause list is BOUNDED and its remainder is named', () => {
    // The same bound the symbol list has, for the same reason: a screen whose
    // every short-history symbol carries its own bar count would otherwise print
    // a paragraph where a line belongs.
    const many = Array.from({ length: 9 }, (_, i) => ({
      ticker: `S${i}`, reason: 'not-computable', detail: `${i} bars of history`,
    }))
    render(<CoverageLine
      coverage={receipt({ answered: 0, dropped: 0, not_computable: 9, dropped_symbols: many })}
      maxCauses={3}
    />)
    const why = screen.getByTestId('coverage-causes')
    expect(why.textContent).toMatch(/ \u00b7 and 6 other reasons$/)
    expect(why.textContent).toMatch(/^Why: 1 0 bars of history/)
  })
})

describe('the causes stay OUT of the four counts', () => {
  it('nothing about the counts line moves when causes appear', () => {
    const clean = receipt({ answered: 3699, dropped: 2, not_computable: 41 })
    render(<CoverageLine coverage={clean} />)
    const without = screen.getByTestId('coverage-line').textContent
    cleanup()
    render(<CoverageLine coverage={{
      ...clean, dropped_symbols: [...noValue(41, 'vwap'), ...bare(2, 'no-bars')],
    }} />)
    // ⛔ BYTE-FOR-BYTE. `evaluated == answered + dropped + not_computable` is
    // E-3's identity; a component that "helpfully" re-derived a count from the
    // enumeration would move exactly this string.
    expect(screen.getByTestId('coverage-line').textContent).toBe(without)
    expect(screen.queryByTestId('coverage-broken')).toBeNull()
    // and the causes really did render, so the equality above is not vacuous.
    expect(screen.getByTestId('coverage-causes')).toBeTruthy()
  })

  it('a withheld count never becomes a cause, and a cause never becomes withheld', () => {
    // `withheld` is BESIDE the four (E-3's envelope) and it is not a failure —
    // those symbols were never looked at, so they can carry no reason at all.
    render(<CoverageLine coverage={receipt({
      answered: 5, dropped: 1, not_computable: 0, withheld: 3737,
      withheld_reason: 'toolkit:symbols', dropped_symbols: bare(1, 'no-bars'),
    })} />)
    expect(screen.getByTestId('coverage-causes').textContent).toBe('Why: 1 no-bars')
    expect(screen.getByTestId('coverage-causes')).not.toHaveTextContent('3,737')
    expect(screen.getByTestId('coverage-withheld')).not.toHaveTextContent('no-bars')
  })
})
