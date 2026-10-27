// W11-R81 PD-2 (the 50-user campaign, P49 / P12 at 390): the builder's phone summary bar read
// "Daily P&L bars · 0 trades · $0.00" over a range with no closed trades, while the preview body said
// "No closed trades in this range.". Plan w7-w8 :666: "An `empty` payload renders its §5.9 sentence ... never a zero
// or a blank chart." The bar now says the empty payload's own sentence, after the widget's name, and no count or
// value. Asserted by rendered text; CONTROL: a payload with data keeps "<name> · <count> · <value>".
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import PreviewPane, { summaryLine } from './PreviewPane'

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
