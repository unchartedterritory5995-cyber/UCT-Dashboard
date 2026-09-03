import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

let mockData = {
  entity: { status: 'resolved', entityId: 'em_aapl' },
  filings: [{ form: '10-K', filed: '2026-01-29', period: '2025-12-31', accession: '0000320193-26-000010', url: 'https://sec.gov/x' }],
}

vi.mock('../../../hooks/useFilings', () => ({
  default: () => ({ data: mockData, isLoading: false }),
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
})
