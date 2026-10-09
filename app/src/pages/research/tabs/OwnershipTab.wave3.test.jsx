// Wave 3 (OWN P2 #12, #24): a 13F block with no quarter printed a dangling "· " and an aria-label
// ending in "undefined"; a vendor 0/1 is_new flag rendered a stray "0" beside the holder; and on a
// phone the 5-column holder tables scrolled the holder name away.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

let data
vi.mock('../hooks/useOwnership', () => ({ default: () => ({ data, isLoading: false }) }))
import OwnershipTab from './OwnershipTab'

const base = (tf) => ({
  sym: 'NVDA', entity: { status: 'resolved' },
  institutional: { pct_held: 65.9, holders: [] },
  short: { shares_short: 2.5e8, short_pct_float: 1.1, days_to_cover: 1.2 },
  share_counts: { float_shares: 2.3e10, shares_outstanding: 2.4e10, _meta: null },
  insider: [],
  thirteen_f: tf,
})

describe('OwnershipTab 13F block, wave 3', () => {
  it('no quarter: no dangling separator and no "undefined" in the table name', () => {
    data = base({ quarter: null, summary: {}, holders: [{ name: 'Vanguard', shares: 1e9, change_shares: 0, ownership: 8, market_value: 1e11, is_new: 0, is_sold_out: 0 }] })
    render(<OwnershipTab sym="NVDA" />)
    const title = screen.getByText(/Form 13F · institutional activity/)
    expect(title.textContent).toBe('Form 13F · institutional activity')
    const table = screen.getByRole('table', { name: 'Form 13F top holders' })
    // a vendor 0 flag must not print "0" beside the holder's name
    expect(table.querySelector('tbody td').textContent).toBe('Vanguard')
  })

  it('with a quarter, it is named in the title and the table', () => {
    data = base({ quarter: '2026 Q2', summary: {}, holders: [{ name: 'Vanguard', shares: 1e9, ownership: 8, market_value: 1e11, is_new: 1 }] })
    render(<OwnershipTab sym="NVDA" />)
    expect(screen.getByRole('table', { name: 'Form 13F top holders, 2026 Q2' })).toBeTruthy()
    expect(document.querySelector('[data-holder-badge="new"]')).toBeTruthy()
  })

  it('on a phone the holder column is pinned while the table scrolls', () => {
    const css = readFileSync(join(process.cwd(), 'src/pages/research/ResearchPage.module.css'), 'utf8')
    expect(css).toMatch(/@media \(max-width: 640px\) \{\s*[^}]*\.ownHolders th:first-child, \.ownHolders td:first-child \{[^}]*position: sticky; left: 0/)
  })
})
