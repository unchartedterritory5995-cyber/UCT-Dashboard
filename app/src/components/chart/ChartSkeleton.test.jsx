import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import ChartSkeleton from './ChartSkeleton'

describe('ChartSkeleton', () => {
  it('renders an accessible busy status carrying the label', () => {
    render(<ChartSkeleton label="Loading TSLA…" />)
    const el = screen.getByRole('status')
    expect(el).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('Loading TSLA…')).toBeInTheDocument()
  })

  it('falls back to a default label', () => {
    render(<ChartSkeleton />)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })
})
