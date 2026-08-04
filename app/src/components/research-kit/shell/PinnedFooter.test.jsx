import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import PinnedFooter from './PinnedFooter'

describe('PinnedFooter', () => {
  it('renders its actions in a labelled footer', () => {
    render(
      <PinnedFooter ariaLabel="Report actions">
        <button type="button">View Chart</button>
        <button type="button">Open full report →</button>
      </PinnedFooter>,
    )
    expect(screen.getByRole('contentinfo', { name: 'Report actions' })).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })

  it('renders nothing when it has no actions — an empty pinned bar is chrome for chrome', () => {
    const { container } = render(<PinnedFooter />)
    expect(container.firstChild).toBeNull()
  })

  it('forwards className and carries no inline styles', () => {
    const { container } = render(<PinnedFooter className="extra"><button type="button">x</button></PinnedFooter>)
    expect(container.firstChild.className).toMatch(/extra/)
    expect(container.firstChild.getAttribute('style')).toBeNull()
  })
})
