import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import FundamentalsSection from './FundamentalsSection'

// The snapshot self-fetches; this section's whole job is HOW it is configured.
vi.mock('../../FundamentalSnapshot', () => ({
  default: (props) => (
    <div data-testid="snap"
         data-sym={props.sym}
         data-research-link={String(props.showResearchLink)} />
  ),
}))

describe('FundamentalsSection', () => {
  it('suppresses the snapshot’s own "Full research →" link', () => {
    // FundamentalSnapshot renders that link by DEFAULT. Left on, this section
    // would re-introduce the exact divert it exists to remove — the reader
    // would land in the modal and still be offered a door out of it.
    const { getByTestId } = render(<FundamentalsSection sym="AAPL" />)
    expect(getByTestId('snap').getAttribute('data-research-link')).toBe('false')
  })

  it('passes the symbol through', () => {
    const { getByTestId } = render(<FundamentalsSection sym="NVDA" />)
    expect(getByTestId('snap').getAttribute('data-sym')).toBe('NVDA')
  })

  it('renders nothing without a symbol rather than an empty shell', () => {
    const { container } = render(<FundamentalsSection sym={null} />)
    expect(container.firstChild).toBeNull()
  })
})
