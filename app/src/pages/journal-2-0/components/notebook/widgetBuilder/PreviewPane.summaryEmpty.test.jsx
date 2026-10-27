// W11-R81 PD-2 (the 50-user campaign, P49 / P12 at 390): the builder's phone summary bar read
// "Daily P&L bars · 0 trades · $0.00" over a range with no closed trades, while the preview body said
// "No closed trades in this range.". Plan w7-w8 :666: "An `empty` payload renders its §5.9 sentence ... never a zero
// or a blank chart." The bar now says the empty payload's own sentence, after the widget's name, and no count or
// value. Asserted by rendered text; CONTROL: a payload with data keeps "<name> · <count> · <value>".
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import PreviewPane, { summaryLine, ANNOUNCE_DELAY_MS } from './PreviewPane'
import { coverageByNeed, coverageText } from './builderCatalog'

const MEASURES = [{ key: 'netPnl', label: 'Net P&L', unit: 'trades', fmt: 'money' }]
const EMPTY = { view: 'bar', empty: 'No closed trades in this range.', count: 0, value: { v1: 0 }, measures: MEASURES,
  rows: [], summary: 'Daily P&L bars: no closed trades in this range.' }
const FULL = { view: 'bar', count: 47, value: { v1: 2140 }, measures: MEASURES, rows: [{ label: 'Mon', v1: 2140 }],
  summary: 'Net P&L: +$2,140.00 over 47 trades.' }

const phone = (payload) => render(
  <PreviewPane payload={payload} name="Daily P&L bars" unit="trades" status="ok" error={null} phone
    onRetry={() => {}} onSuggestRange={() => {}} canSuggestRange={false} />,
)

describe('the phone summary bar over an empty range (W11-R81 PD-2)', () => {
  it("says the empty payload's sentence: no zero count, no zero value", () => {
    phone(EMPTY)
    const bar = screen.getByTestId('builder-summary-bar')
    expect(bar).toHaveTextContent('Daily P&L bars · No closed trades in this range.')
    expect(bar.textContent).not.toMatch(/\b0 trades\b|\$0\.00/)
  })
  it('CONTROL: a payload with data keeps its count and its first value', () => {
    phone(FULL)
    expect(screen.getByTestId('builder-summary-bar').textContent).toMatch(/Daily P&L bars · 47 trades · \+?\$2,140\.00/)
  })
  it('a too-large payload is not "empty" (its own sentence path is unchanged)', () => {
    expect(summaryLine('W', { ...EMPTY, tooLarge: true }, 'trades')).not.toContain('No closed trades')
  })
})

// W11-R84 New-1: the same rule on the desktop preview's summary line and the live region. Over an empty source the
// summary read "...all accounts. 0 strategies." and the live region announced it. The empty sentence is what is shown
// (once: the preview body already draws it) and what is announced; never the zero.
const EMPTY_OPT = { view: 'number', empty: 'No options strategies in this range.', count: 0, value: { v1: 0 },
  measures: [{ key: 'netPnl', label: 'Net P&L', unit: 'strategies', fmt: 'money' }],
  summary: 'Net P&L for options strategies in the last 90 days, all accounts. 0 strategies.' }
const desktop = (payload) => render(
  <PreviewPane payload={payload} name="Net P&L, last 90 days" unit="strategies" status="ok" error={null}
    onRetry={() => {}} onSuggestRange={() => {}} canSuggestRange={false} />,
)
describe('the desktop summary and the live region over an empty source (W11-R84 New-1)', () => {
  afterEach(() => vi.useRealTimers())
  it('show the empty sentence, once, and never "0 strategies"', () => {
    desktop(EMPTY_OPT)
    expect(screen.getAllByText('No options strategies in this range.')).toHaveLength(1)
    expect(document.body.textContent).not.toMatch(/0 strategies/)
  })
  it('the live region announces the empty sentence, never the zero', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    desktop(EMPTY_OPT)
    await act(async () => { await vi.advanceTimersByTimeAsync(ANNOUNCE_DELAY_MS) })
    expect(screen.getByTestId('builder-live').textContent).toBe('No options strategies in this range.')
  })
  it('CONTROL: a payload with data shows and announces its summary', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    desktop(FULL)
    expect(document.body.textContent).toContain(FULL.summary)
    await act(async () => { await vi.advanceTimersByTimeAsync(ANNOUNCE_DELAY_MS) })
    expect(screen.getByTestId('builder-live').textContent).toBe(FULL.summary)
  })
})

// W11-R84 m-2: rows EXIST but none has the split value (payload.py `empty`, the result's split sentence; the payload's
// `count` still names how many rows were read: tests/test_widget_shelf.py r84_m2). The builder shows that sentence and,
// BY DESIGN, no coverage line for the same empty answer, though rows were read.
describe('a split none of the rows has a value for (W11-R84 m-2)', () => {
  const CAT = { measures: new Map([['expectancyR', { key: 'expectancyR', needs: ['r'], unit: 'trades' }]]) }
  const PLAN = { measures: [{ key: 'expectancyR' }] }
  const SPLIT_EMPTY = { view: 'bar', count: 12, empty: 'None of these trades have a value for R bucket yet.',
    coverage: [{ have: 0, total: 12 }], measures: [{ key: 'expectancyR', label: 'Expectancy (R)', unit: 'trades', fmt: 'r' }] }
  it('coverage stays hidden even though 12 rows were read, and the phone bar says the sentence', () => {
    const by = coverageByNeed(CAT, PLAN, SPLIT_EMPTY)
    expect(by.size).toBe(0)
    expect(coverageText(CAT, CAT.measures.get('expectancyR'), by)).toBe('')
    expect(summaryLine('Expectancy by R bucket', SPLIT_EMPTY, 'trades')).toBe('Expectancy by R bucket · None of these trades have a value for R bucket yet.')
  })
  it('CONTROL: the same rows with a value show their coverage', () => {
    const { empty: _e, ...withValue } = SPLIT_EMPTY
    const by = coverageByNeed(CAT, PLAN, { ...withValue, coverage: [{ have: 3, total: 12 }] })
    expect(coverageText(CAT, CAT.measures.get('expectancyR'), by)).toBe('R known on 3 of 12 trades')
  })
})
