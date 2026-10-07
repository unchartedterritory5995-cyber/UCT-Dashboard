// Live sweep 2026-10-05: SPY OWN read "Float 0" beside "Shares outstanding 1.07B". A vendor zero
// for a float / short count / days to cover is "not reported", never a measured 0.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

let data
vi.mock('../hooks/useOwnership', () => ({ default: () => ({ data, isLoading: false }) }))
import OwnershipTab from './OwnershipTab'

const row = (label) => screen.getByText(label).closest('div').querySelector('b').textContent

describe('OwnershipTab — vendor zeros read as not reported', () => {
  it('a fund with a zero float, zero short and zero days to cover shows dashes, not 0', () => {
    data = {
      sym: 'SPY', entity: { status: 'resolved' },
      institutional: { pct_held: 41.234567, holders: [] },
      short: { shares_short: 0, short_pct_float: 0, days_to_cover: 0 },
      share_counts: { float_shares: 0, shares_outstanding: 1.07e9, _meta: null },
      insider: [],
    }
    render(<OwnershipTab sym="SPY" />)
    expect(row('Float')).toBe('—')
    expect(row('Shares short')).toBe('—')
    expect(row('Days to cover')).toBe('—')
    expect(row('Short % of float')).toBe('—')
    expect(row('Shares outstanding')).toBe('1.07B')
    expect(row('% of shares outstanding')).toBe('41.23%')
  })

  it('real non-zero values still render, days to cover to one decimal', () => {
    data = {
      sym: 'NVDA', entity: { status: 'resolved' },
      institutional: { pct_held: 65.9, holders: [] },
      short: { shares_short: 2.5e8, short_pct_float: 1.1, days_to_cover: 1.2345 },
      share_counts: { float_shares: 2.3e10, shares_outstanding: 2.4e10, _meta: null },
      insider: [],
    }
    render(<OwnershipTab sym="NVDA" />)
    expect(row('Float')).toBe('23.00B')
    expect(row('Shares short')).toBe('250.0M')
    expect(row('Days to cover')).toBe('1.2')
  })

  it('an unlinked symbol is explained in plain English, not by an enum', () => {
    data = { sym: 'XYZ', entity: { status: 'unresolved_ambiguous' }, institutional: {}, short: {}, share_counts: {}, insider: [] }
    render(<OwnershipTab sym="XYZ" />)
    expect(screen.getByTestId('entity-unresolved-note').textContent).not.toMatch(/unresolved_ambiguous|canonical/)
  })
})
