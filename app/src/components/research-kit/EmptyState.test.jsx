import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import EmptyState from './EmptyState'

describe('EmptyState', () => {
  it('renders the title', () => {
    render(<EmptyState title="No transcript yet" />)
    expect(screen.getByText('No transcript yet')).toBeInTheDocument()
  })

  it('renders the hint only when given', () => {
    const { rerender } = render(<EmptyState title="No transcript yet" />)
    expect(screen.queryByTestId('rk-empty-hint')).toBeNull()
    rerender(
      <EmptyState title="No transcript yet" hint="Typically posts within 2h of the call." />,
    )
    expect(screen.getByTestId('rk-empty-hint')).toHaveTextContent(
      'Typically posts within 2h of the call.',
    )
  })

  it('draws a UIcon svg and never an emoji', () => {
    const { container } = render(<EmptyState title="Nothing here" />)
    expect(container.querySelector('svg')).not.toBeNull()
    expect(container.textContent).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u)
  })

  it('accepts an explicit UIcon name', () => {
    const { container } = render(<EmptyState icon="search" title="No matches" />)
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('adds the compact class only when compact is set', () => {
    const { container, rerender } = render(<EmptyState title="x" />)
    expect(container.firstChild.className).not.toMatch(/compact/)
    rerender(<EmptyState title="x" compact />)
    expect(container.firstChild.className).toMatch(/compact/)
  })

  it('renders an action node when given (e.g. a retry link)', () => {
    render(
      <EmptyState
        title="Could not load estimates"
        action={<button type="button">Retry</button>}
      />,
    )
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('forwards className and carries no inline styles', () => {
    const { container } = render(<EmptyState title="x" className="extra" />)
    expect(container.firstChild.className).toMatch(/extra/)
    expect(container.firstChild.getAttribute('style')).toBeNull()
  })
})
