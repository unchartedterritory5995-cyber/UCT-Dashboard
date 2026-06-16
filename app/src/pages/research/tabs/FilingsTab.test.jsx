import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../../hooks/useFilings', () => ({
  default: () => ({ data: { filings: [{ form: '10-K', filed: '2026-01-29', url: 'https://sec.gov/x' }] }, isLoading: false }),
}))

import FilingsTab from './FilingsTab'

describe('FilingsTab', () => {
  it('renders SEC filings with a link', () => {
    render(<FilingsTab sym="AAPL" />)
    expect(screen.getByText('10-K')).toBeInTheDocument()
    expect(screen.getByText('2026-01-29')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /View/ })).toHaveAttribute('href', 'https://sec.gov/x')
  })
})
