import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import BrokerImportingBanner from './BrokerImportingBanner'

describe('BrokerImportingBanner', () => {
  it('renders branded importing copy with the broker name', () => {
    render(<BrokerImportingBanner broker="Robinhood" />)
    expect(screen.getByText(/importing your full robinhood history/i)).toBeInTheDocument()
  })

  it('uses no generic emoji', () => {
    const { container } = render(<BrokerImportingBanner broker="Robinhood" />)
    // No emoji codepoints in the rendered text.
    expect(/\p{Extended_Pictographic}/u.test(container.textContent)).toBe(false)
  })
})
