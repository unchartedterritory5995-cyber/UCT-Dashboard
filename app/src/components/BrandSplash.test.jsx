import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import BrandSplash from './BrandSplash'

describe('BrandSplash', () => {
  it('renders the brand mark, wordmark and a status label', () => {
    render(<BrandSplash label="Signing you in" />)
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('UCT INTELLIGENCE')).toBeInTheDocument()
    expect(screen.getByText('Signing you in')).toBeInTheDocument()
    expect(document.querySelector('img')).not.toBeNull()
  })
})
