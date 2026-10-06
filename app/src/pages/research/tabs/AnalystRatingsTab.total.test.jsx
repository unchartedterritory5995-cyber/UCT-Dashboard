// ANR: a consensus with no total never renders "undefined analysts" (quality pass 2026-10-05).
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('./AnalystRevisions', () => ({ default: () => null }))
vi.mock('../../../hooks/useLivePrices', () => ({ default: () => ({ prices: {}, isLoading: false, error: null, refresh: () => {} }) }))
let data
vi.mock('../hooks/useAnalystRatings', () => ({ default: () => ({ data, isLoading: false }) }))
import AnalystRatingsTab from './AnalystRatingsTab'

describe('ANR consensus count', () => {
  it('a missing total renders no count; one analyst is singular', () => {
    data = { sym: 'XYZ', entity: { status: 'resolved' }, consensus: { buy: 1, label: 'Buy' }, price_target: null, recent_actions: null }
    const { unmount } = render(<AnalystRatingsTab sym="XYZ" />)
    expect(screen.getByText('Analyst consensus')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/undefined|NaN/)
    unmount()
    data = { ...data, consensus: { buy: 1, label: 'Buy', total: 1 } }
    render(<AnalystRatingsTab sym="XYZ" />)
    expect(screen.getByText('1 analyst')).toBeInTheDocument()
  })
})
