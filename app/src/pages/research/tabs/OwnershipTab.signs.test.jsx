// app/src/pages/research/tabs/OwnershipTab.signs.test.jsx
//
// The 13F changes (a holder's share change, the quarter's total-invested change) were told
// apart by COLOUR alone: a rise printed "1.2M" in green and the dollar change dropped the "+"
// the other change chips carry. A colour-blind member saw no direction on a rise. Every
// change now carries its own sign (audit 2026-10-08, point 27: colour is never the only signal).
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const data = {
  sym: 'NVDA',
  entity: { status: 'resolved', entityId: 'em_nvda' },
  institutional: { pct_held: 65, holders: [] },
  short: {},
  share_counts: { _meta: null },
  insider: [],
  thirteen_f: {
    quarter: '2026Q2',
    summary: { ownership_pct: 6.4, investors_holding: 900, total_invested: 2.5e9, total_invested_change: 1.25e8 },
    holders: [
      { name: 'Buyer Fund', shares: 5e6, change_shares: 1.2e6, ownership: 1.1, market_value: 9e8 },
      { name: 'Seller Fund', shares: 4e6, change_shares: -8e5, ownership: 0.9, market_value: 7e8 },
      { name: 'Flat Fund', shares: 3e6, change_shares: null, ownership: 0.7, market_value: 5e8 },
    ],
    _meta: null,
  },
}

vi.mock('../hooks/useOwnership', () => ({ default: () => ({ data, isLoading: false }) }))

import OwnershipTab, { signed } from './OwnershipTab'

describe('OwnershipTab — a change states its direction in text, not only in colour', () => {
  it('a holder that added shares reads "+", one that cut reads "-", an unknown change a dash', () => {
    render(<OwnershipTab sym="NVDA" />)
    const cell = (name) => screen.getByText(name).closest('tr').querySelectorAll('td')[2].textContent
    expect(cell('Buyer Fund')).toBe('+1.2M')
    expect(cell('Seller Fund')).toBe('-800K')
    expect(cell('Flat Fund')).toBe('—')
  })

  it('the total-invested change carries a "+" like the other change chips', () => {
    render(<OwnershipTab sym="NVDA" />)
    expect(screen.getByText('Total invested (USD)').parentElement.textContent).toContain('+$125')
  })

  it('signed() is the one rule', () => {
    expect(signed(null, String)).toBeNull()
    expect(signed(NaN, String)).toBeNull()
    expect(signed(0, String)).toBe('0')
    expect(signed(3, String)).toBe('+3')
    expect(signed(-3, String)).toBe('-3')
  })
})
