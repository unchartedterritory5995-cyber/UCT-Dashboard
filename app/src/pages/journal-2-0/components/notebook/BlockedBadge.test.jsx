import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import BlockedBadge from './BlockedBadge'
import { BLOCKED_BADGE, BLOCKED_TITLE } from '../../lib/offline/unsyncedCopy'

/**
 * ⛔⛔ ONE COMPONENT, FOUR VIEWS — competitive audit finding UX #15,
 * 2026-09-22. Before this file existed, Card/Table/Board/Calendar each
 * rendered their own guess at "this note has unsent words" -- three
 * different visual treatments, one view (Calendar) rendering nothing
 * visible at all.
 */
describe('BlockedBadge', () => {
  it('the default (non-compact) form shows the icon and the visible text', () => {
    render(<BlockedBadge />)
    expect(screen.getByText(BLOCKED_BADGE)).toBeInTheDocument()
  })

  it('the default form carries the full sentence as a hover title', () => {
    render(<BlockedBadge />)
    expect(screen.getByText(BLOCKED_BADGE).closest('span')).toHaveAttribute('title', BLOCKED_TITLE)
  })

  it('compact hides the visible text but keeps a real accessible name (icon-only has none otherwise)', () => {
    render(<BlockedBadge compact />)
    expect(screen.queryByText(BLOCKED_BADGE)).toBeNull()
    expect(screen.getByRole('img', { name: BLOCKED_TITLE })).toBeInTheDocument()
  })

  it('a caller-supplied className is applied for positioning, alongside the badge\'s own styling', () => {
    render(<BlockedBadge className="callerSpacing" />)
    const el = screen.getByText(BLOCKED_BADGE).closest('span')
    expect(el.className).toContain('callerSpacing')
  })
})
