import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import HoldingsListSkeleton from './HoldingsListSkeleton'

describe('HoldingsListSkeleton', () => {
  it('renders a busy status with ghost rows', () => {
    const { container } = render(<HoldingsListSkeleton />)
    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('Loading positions…')).toBeInTheDocument()
    // 5 ghost rows, each aria-hidden
    const rows = container.querySelectorAll('[aria-hidden="true"]')
    expect(rows.length).toBeGreaterThanOrEqual(5)
  })
})
