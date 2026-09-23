import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import HeroImagePicker from './HeroImagePicker'

// No test file existed for this component before this pass. Scoped to the
// one thing this pass touches — the filled-state container's accessible
// name — not a full behavioral suite for upload/drag/paste.

/**
 * ⛔⛔ THE FOCUSABLE PASTE TARGET NEEDS AN ACCESSIBLE NAME.
 *
 * The filled-state container is `tabIndex={0}` (meant to receive a pasted
 * image via Ctrl+V) and previously carried only a native `title` attribute
 * — most screen readers either ignore that entirely or announce it only as
 * an unreliable hover tooltip, never reliably on keyboard focus for a
 * `<div>`. Competitive audit finding Accessibility QW-3, 2026-09-22.
 */
describe('HeroImagePicker — filled-state accessible name', () => {
  it('the focusable container has an aria-label describing the paste/replace action', () => {
    render(<HeroImagePicker noteId="n1" value="https://example.com/hero.jpg" onChange={vi.fn()} />)
    const container = screen.getByLabelText(
      'Current hero image. Press Ctrl+V to replace it, or use the buttons below.',
    )
    expect(container).toBeInTheDocument()
    expect(container).toHaveAttribute('tabIndex', '0')
  })

  it('⛔ CONTROL — the empty (no hero yet) state renders no such container', () => {
    render(<HeroImagePicker noteId="n1" value={null} onChange={vi.fn()} />)
    expect(screen.queryByLabelText(
      'Current hero image. Press Ctrl+V to replace it, or use the buttons below.',
    )).toBeNull()
  })
})
