import { render, screen, fireEvent } from '@testing-library/react'
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

describe('NoteCard — wave 5 selection', () => {
  it('without `selectable` there is no checkbox (every other surface is unchanged)', () => {
    render(<NoteCard note={note()} onOpen={vi.fn()} />)
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  it('the checkbox sits BESIDE the card button, never inside it', () => {
    render(<NoteCard note={note()} onOpen={vi.fn()} selectable onToggleSelect={vi.fn()} />)
    const box = screen.getByRole('checkbox', { name: 'Select NVDA thesis' })
    const card = screen.getByRole('button', { name: /NVDA thesis/ })
    expect(card.contains(box)).toBe(false)
  })

  it('⛔ the hub identity stays on ONE element per note', () => {
    const { container } = render(<NoteCard note={note()} onOpen={vi.fn()} selectable onToggleSelect={vi.fn()} />)
    const tagged = container.querySelectorAll('[data-note-card-id]')
    expect(tagged).toHaveLength(1)
    expect(tagged[0].tagName).toBe('BUTTON')
  })

  it('checking it toggles selection and does NOT open the note', () => {
    const onOpen = vi.fn()
    const onToggleSelect = vi.fn()
    render(<NoteCard note={note()} onOpen={onOpen} selectable onToggleSelect={onToggleSelect} />)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(onToggleSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'n1' }), { shift: false })
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('Shift is carried through, so Shift+click can select a range', () => {
    const onToggleSelect = vi.fn()
    render(<NoteCard note={note()} onOpen={vi.fn()} selectable onToggleSelect={onToggleSelect} />)
    fireEvent.click(screen.getByRole('checkbox'), { shiftKey: true })
    expect(onToggleSelect).toHaveBeenCalledWith(expect.anything(), { shift: true })
  })

  it('reflects `selected`', () => {
    render(<NoteCard note={note()} onOpen={vi.fn()} selectable selected onToggleSelect={vi.fn()} />)
    expect(screen.getByRole('checkbox')).toBeChecked()
  })

  it('a trashed card is selectable too (bulk restore)', () => {
    const onToggleSelect = vi.fn()
    render(<NoteCard note={note()} onOpen={vi.fn()} onRestore={vi.fn()} selectable onToggleSelect={onToggleSelect} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select NVDA thesis' }))
    expect(onToggleSelect).toHaveBeenCalled()
  })

  it('the checkbox is a finger target at the touch tier (<=1024px), not only on a phone', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const css = readFileSync(join(process.cwd(), 'src/pages/journal-2-0/components/notebook/NoteCard.module.css'), 'utf8')
      .replace(/\r\n/g, '\n')
    const touch = /@media\s*\(max-width:\s*1024px\)\s*\{([\s\S]*?)\n\}/.exec(css)
    expect(touch, 'a max-width:1024px block must exist').not.toBeNull()
    expect(touch[1]).toMatch(/\.selectBox\s*\{[^}]*min-width:\s*var\(--tap-min\)[^}]*min-height:\s*var\(--tap-min\)/)
  })
})
