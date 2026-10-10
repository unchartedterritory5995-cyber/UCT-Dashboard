// TERM-045 (dark, SEC_13F_LIST_ENABLED): the SEC 13(f) list line in the Form 13F card.
// Asserts RENDERED TEXT: "on the list", "not on the list" and "could not check" are
// three different sentences, and an absent block renders nothing at all.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

let current = null
vi.mock('../hooks/useOwnership', () => ({ default: () => ({ data: current, isLoading: false, mutate: vi.fn() }) }))

import OwnershipTab from './OwnershipTab'

const TF = { quarter: '2026Q2', summary: { ownership_pct: 61.2 }, holders: [{ name: 'VANGUARD', shares: 1e9 }] }
const base = { sym: 'AAPL', entity: { status: 'resolved' }, institutional: { holders: [] }, short: {},
  share_counts: {}, insider: [], thirteen_f: TF }
const SRC = 'SEC Official List of Section 13(f) Securities'
const OK = {
  state: 'ok', source: SRC, quarter: '2026Q3', cusip: '037833100', on_list: true,
  security: { cusip: '037833100', description: 'COM', has_listed_options: true },
  issuer_securities: [{ cusip: '037833100' }, { cusip: '037833900' }, { cusip: '037833950' }],
}

describe('OwnershipTab: SEC 13(f) list line', () => {
  it('renders nothing when the server sent no block (flag off)', () => {
    current = base
    render(<OwnershipTab sym="AAPL" />)
    expect(screen.queryByTestId('thirteenf-list')).toBeNull()
  })

  it('on the list: names the security, the quarter, options and the issuer siblings', () => {
    current = { ...base, thirteen_f_list: OK }
    render(<OwnershipTab sym="AAPL" />)
    const line = screen.getByTestId('thirteenf-list')
    expect(line.textContent).toContain("AAPL's COM, CUSIP 037833100 is on the SEC's 13(f) list (2026Q3)")
    expect(line.textContent).toContain('Listed options exist on it.')
    expect(line.textContent).toContain('2 other securities of this issuer are on the list too.')
    expect(line.textContent).toContain(SRC)
    expect(line.textContent).not.toMatch(/—/)
  })

  it('not on the list is said as such, never as unavailable', () => {
    current = { ...base, thirteen_f_list: { state: 'not_on_list', source: SRC, quarter: '2026Q3', cusip: '999999999' } }
    render(<OwnershipTab sym="AAPL" />)
    expect(screen.getByTestId('thirteenf-list').textContent).toContain('CUSIP 999999999 is not on the SEC')
  })

  it('a check that could not run says so with its reason', () => {
    current = { ...base, thirteen_f_list: { state: 'not_ingested', source: SRC, reason: 'the SEC 13(f) list has not been downloaded on this server yet' } }
    render(<OwnershipTab sym="AAPL" />)
    expect(screen.getByTestId('thirteenf-list').textContent).toContain('13(f) list check unavailable: the SEC 13(f) list has not been downloaded')
  })

  it('without a 13F card the line still renders in its own card', () => {
    current = { ...base, thirteen_f: null, thirteen_f_list: OK }
    render(<OwnershipTab sym="AAPL" />)
    expect(screen.getByTestId('thirteenf-list').getAttribute('data-state')).toBe('ok')
  })
})
