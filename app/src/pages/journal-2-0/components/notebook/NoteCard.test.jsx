import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import NoteCard from './NoteCard'
import { BLOCKED_BADGE } from '../../lib/offline/unsyncedCopy'

// No test file existed for this component before this pass (its DOM-identity
// contract is covered separately, from the hub's own side, by
// app/src/hub/noteCardIdentity.test.jsx). Scoped to what this pass touches:
// the blocked-note badge now routes through the shared BlockedBadge.jsx
// (UX #15, 2026-09-22) rather than a copy local to this file.

const note = (over = {}) => ({
  id: 'n1', title: 'NVDA thesis', updatedAt: new Date().toISOString(), ...over,
})

describe('NoteCard — blocked-note badge', () => {
  it('shows the shared BlockedBadge when blocked=true', () => {
    render(<NoteCard note={note()} onOpen={vi.fn()} blocked />)
    expect(screen.getByText(BLOCKED_BADGE)).toBeInTheDocument()
  })

  it('shows nothing when blocked=false (the default)', () => {
    render(<NoteCard note={note()} onOpen={vi.fn()} />)
    expect(screen.queryByText(BLOCKED_BADGE)).toBeNull()
  })

  it('never shows it on a trashed card, even if blocked -- a trashed note cannot be edited to un-block', () => {
    render(<NoteCard note={note()} onOpen={vi.fn()} onRestore={vi.fn()} blocked />)
    expect(screen.queryByText(BLOCKED_BADGE)).toBeNull()
  })
})
