import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

let mockData = {
  entity: { status: 'resolved', entityId: 'em_aapl' },
  filings: [{ form: '10-K', filed: '2026-01-29', period: '2025-12-31', accession: '0000320193-26-000010', url: 'https://sec.gov/x' }],
}

let mockError = null
const mockMutate = vi.fn()
vi.mock('../../../hooks/useFilings', () => ({
  default: () => ({ data: mockData, error: mockError, isLoading: false, mutate: mockMutate }),
}))

import FilingsTab from './FilingsTab'

describe('FilingsTab', () => {
  it('renders SEC filings with a link, period, and accession', () => {
    render(<FilingsTab sym="AAPL" />)
    expect(screen.getByText('10-K')).toBeInTheDocument()
    expect(screen.getByText('2026-01-29')).toBeInTheDocument()
    expect(screen.getByText(/2025-12-31/)).toBeInTheDocument()
    expect(screen.getByText('0000320193-26-000010')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /View/ })).toHaveAttribute('href', 'https://sec.gov/x')
    // A resolved entity shows no unresolved-identity note.
    expect(screen.queryByTestId('entity-unresolved-note')).toBeNull()
  })

  it('discloses the source honestly, never a fabricated freshness badge', () => {
    render(<FilingsTab sym="AAPL" />)
    expect(screen.getByText(/Source: SEC EDGAR/)).toBeInTheDocument()
    expect(screen.getByText(/may lag up to 30 min/)).toBeInTheDocument()
  })

  it('shows an entity-unresolved note when Entity Master has not linked the symbol', () => {
    mockData = { ...mockData, entity: { status: 'not_found', entityId: null } }
    render(<FilingsTab sym="AAPL" />)
    expect(screen.getByTestId('entity-unresolved-note')).toHaveTextContent('not_found')
    mockData = { ...mockData, entity: { status: 'resolved', entityId: 'em_aapl' } }
  })

  it('an SEC outage reads as unavailable with a retry, never as "no filings"', () => {
    const saved = mockData
    mockData = null
    mockError = { httpStatus: 200, reason: 'SEC fetch failed: timeout', kind: 'unavailable' }
    render(<FilingsTab sym="AAPL" />)
    expect(screen.getByTestId('filings-unavailable')).toHaveTextContent(/SEC EDGAR couldn.t be read right now/)
    expect(screen.queryByText('No SEC filings found for this ticker.')).toBeNull()
    screen.getByRole('button', { name: 'Retry' }).click()
    expect(mockMutate).toHaveBeenCalled()
    mockData = saved
    mockError = null
  })

  it('a CIK-map miss says no filer matched, distinct from an outage', () => {
    const saved = mockData
    mockData = null
    mockError = { httpStatus: 200, reason: "ticker 'XYZ' not found in SEC CIK map", kind: 'no_filer' }
    render(<FilingsTab sym="XYZ" />)
    expect(screen.getByTestId('filings-no-filer')).toHaveTextContent('No SEC filer matched this ticker.')
    expect(screen.queryByTestId('filings-unavailable')).toBeNull()
    mockData = saved
    mockError = null
  })

  it('a genuine empty answer still says no filings found', () => {
    const saved = mockData
    mockData = { ticker: 'AAPL', filings: [] }
    render(<FilingsTab sym="AAPL" />)
    expect(screen.getByText('No SEC filings found for this ticker.')).toBeInTheDocument()
    mockData = saved
  })
})
