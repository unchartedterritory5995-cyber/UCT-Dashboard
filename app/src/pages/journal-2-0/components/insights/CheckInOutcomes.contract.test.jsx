// P2 Tier 3, Task 9 — the "By check-in" view reads the server's REAL answer.
//
// The payload is the `psychology.checkIns` slice of GET /api/j2/analytics, recorded by
// tools/notebook_contract_fixtures.py (`analytics.check-ins`, `analytics.check-ins.empty`) and held
// current by tests/test_notebook_contract_fixtures.py. The hand-typed shape in CheckInOutcomes.test.jsx
// says what the view does; this file says the view understands what the server actually sends.
// Everything is asserted as rendered text.
//
// The recorded book: six check-in days. Mood 2 ("Low") and focus 1 ("Scattered") hold twelve trades,
// eleven of them breakevens, so their win rate rests on ONE trade (`decisiveCount` 1, `tradeCount` 12):
// the view must say "Too few trades", never "thin sample" (ruling R-T3-T5-R4).
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

import CheckInOutcomes, { EMPTY_TEXT, TOO_FEW_TEXT } from './CheckInOutcomes'
import { WORDING } from '../../lib/sampleSize'
import { contractBody } from '../../__fixtures__/contract'

const checkIns = (name) => contractBody(name).psychology.checkIns
const row = (word) => screen.getByRole('rowheader', { name: new RegExp(`^${word}`) }).closest('tr')
const cells = (tr) => within(tr).getAllByRole('cell').map((td) => td.textContent)

describe('CheckInOutcomes reads the recorded analytics.psychology.checkIns', () => {
  it('says how many days and trades it read, and the trade with no trading day', () => {
    render(<CheckInOutcomes checkIns={checkIns('analytics.check-ins')} />)
    expect(screen.getByText(/6 check-in days, 19 trades on them\./)).toBeInTheDocument()
    expect(screen.getByText('1 trade has no trading day, so it is left out.')).toBeInTheDocument()
  })

  it('lists every mood level 1..5 the server sent, by its word, with days, trades, win rate and P&L', () => {
    render(<CheckInOutcomes checkIns={checkIns('analytics.check-ins')} />)
    const words = within(screen.getByRole('tabpanel')).getAllByRole('rowheader').map((th) => th.textContent)
    expect(words.map((w) => w.replace(TOO_FEW_TEXT, ''))).toEqual(['Rough', 'Low', 'Okay', 'Good', 'Great'])
    // [days, trades, win rate, avg P&L]
    expect(cells(row('Rough'))).toEqual(['1', '1', '0%', '-$200.00'])
    expect(cells(row('Good'))).toEqual(['2', '4', '67%', '+$112.50'])
    // Breakevens only: no win rate (null, never 0%), and an average of exactly zero.
    expect(cells(row('Okay'))).toEqual(['1', '2', '—', '$0'])
    // A check-in day with no trades: both numbers are absent, never a measured 0.
    expect(cells(row('Great'))).toEqual(['1', '0', '—', '—'])
  })

  it('a level of twelve trades with one decisive is "Too few trades", not a thin sample', () => {
    render(<CheckInOutcomes checkIns={checkIns('analytics.check-ins')} />)
    const low = row('Low')
    expect(cells(low)).toEqual(['1', '12', '100%', '+$8.33'])
    expect(within(low).getByText(TOO_FEW_TEXT)).toBeInTheDocument()
    expect(low.textContent).not.toContain(WORDING.thin)
  })

  it('the Focus tab reads the focus levels', () => {
    render(<CheckInOutcomes checkIns={checkIns('analytics.check-ins')} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Focus' }))
    const words = within(screen.getByRole('tabpanel')).getAllByRole('rowheader').map((th) => th.textContent)
    expect(words.map((w) => w.replace(TOO_FEW_TEXT, ''))).toEqual(['Scattered', 'Distracted', 'Steady', 'Focused', 'Locked in'])
    expect(cells(row('Steady'))).toEqual(['1', '1', '100%', '+$300.00'])
    expect(cells(row('Focused'))).toEqual(['1', '3', '50%', '+$50.00'])
    expect(cells(row('Locked in'))).toEqual(['1', '2', '—', '$0'])
    expect(within(row('Scattered')).getByText(TOO_FEW_TEXT)).toBeInTheDocument()
  })

  it('a member with no check-in gets the empty sentence, though every level is in the payload', () => {
    const empty = checkIns('analytics.check-ins.empty')
    expect(empty.mood.map((r) => r.level)).toEqual([1, 2, 3, 4, 5])          // non-vacuity: the levels are there
    render(<CheckInOutcomes checkIns={empty} />)
    expect(screen.getByText(EMPTY_TEXT)).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})
