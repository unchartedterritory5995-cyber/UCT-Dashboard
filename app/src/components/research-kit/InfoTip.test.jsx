import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import InfoTip from './InfoTip'

describe('InfoTip', () => {
  it('renders nothing without text', () => {
    const { container } = render(<InfoTip label="About X" />)
    expect(container.firstChild).toBeNull()
  })

  it('renders a UIcon svg trigger, not an emoji character', () => {
    const { container } = render(<InfoTip label="About Setup Grade" text="Explains it." />)
    const btn = screen.getByRole('button', { name: 'About Setup Grade' })
    expect(btn.querySelector('svg')).not.toBeNull()
    expect(container.textContent).not.toMatch(/[\u{1F300}-\u{1FAFF}ℹⓘ]/u)
  })

  it('is closed at rest and opens on click', () => {
    render(<InfoTip label="About X" text="Priced through Fri Aug 8." />)
    const btn = screen.getByRole('button', { name: 'About X' })
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('tooltip')).toBeNull()

    fireEvent.click(btn)
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('tooltip')).toHaveTextContent('Priced through Fri Aug 8.')
  })

  it('describes the trigger while open', () => {
    render(<InfoTip label="About X" text="Body copy." />)
    const btn = screen.getByRole('button', { name: 'About X' })
    fireEvent.click(btn)
    expect(btn.getAttribute('aria-describedby')).toBe(screen.getByRole('tooltip').id)
  })

  it('renders the methodology link only when href is given', () => {
    const { rerender } = render(<InfoTip label="A" text="Body." />)
    fireEvent.click(screen.getByRole('button', { name: 'A' }))
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    expect(screen.queryByRole('link')).toBeNull()

    // Same component at the same position, so React preserves the open state —
    // do NOT click again here or the tip toggles shut.
    rerender(<InfoTip label="A" text="Body." href="/methodology#setup-grade" />)
    const link = screen.getByRole('link', { name: 'How this is computed →' })
    expect(link.getAttribute('href')).toBe('/methodology#setup-grade')
  })

  it('closes on Escape and on an outside click', () => {
    render(
      <div>
        <InfoTip label="A" text="Body." />
        <button type="button">elsewhere</button>
      </div>,
    )
    const btn = screen.getByRole('button', { name: 'A' })

    fireEvent.click(btn)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()

    fireEvent.click(btn)
    fireEvent.mouseDown(screen.getByRole('button', { name: 'elsewhere' }))
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})
