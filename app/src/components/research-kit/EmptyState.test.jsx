import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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

  it('renders the icon monochrome, never UIcon\'s gold treatment (I3, §3.1)', () => {
    const { container } = render(<EmptyState title="Nothing here" />)
    const svg = container.querySelector('svg')
    // UIcon's gold treatment sets stroke to a gradient url() + adds a
    // <linearGradient> def; gold={false} keeps stroke=currentColor and no def.
    expect(svg.getAttribute('stroke')).toBe('currentColor')
    expect(svg.querySelector('linearGradient')).toBeNull()
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

  // I5 — the built-in retry affordance.
  it('renders no retry button by default', () => {
    render(<EmptyState title="x" />)
    expect(screen.queryByTestId('rk-empty-retry')).toBeNull()
  })

  it('renders and fires an onRetry button', () => {
    const onRetry = vi.fn()
    render(<EmptyState title="Could not load estimates" onRetry={onRetry} />)
    const btn = screen.getByTestId('rk-empty-retry')
    expect(btn).toHaveTextContent('Retry')
    fireEvent.click(btn)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('accepts a custom retryLabel', () => {
    render(<EmptyState title="x" onRetry={() => {}} retryLabel="Try again" />)
    expect(screen.getByTestId('rk-empty-retry')).toHaveTextContent('Try again')
  })

  it('carries the focus-visible token-based styling class', () => {
    render(<EmptyState title="x" onRetry={() => {}} />)
    expect(screen.getByTestId('rk-empty-retry').className).toMatch(/actionButton/)
  })

  it('renders onRetry before the custom action node, both together, per documented precedence', () => {
    const onRetry = vi.fn()
    render(
      <EmptyState
        title="x"
        onRetry={onRetry}
        action={<button type="button">Custom escape hatch</button>}
      />,
    )
    const retryBtn = screen.getByTestId('rk-empty-retry')
    const customBtn = screen.getByRole('button', { name: 'Custom escape hatch' })
    expect(retryBtn).toBeInTheDocument()
    expect(customBtn).toBeInTheDocument()
    expect(retryBtn.compareDocumentPosition(customBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
