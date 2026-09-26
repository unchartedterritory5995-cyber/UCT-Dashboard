import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'

/**
 * Wave 6 (lane E, item 2) — a LOCKED note carries the lock glyph on its card,
 * its table row and its board card, and an unlocked one carries none. Asserted
 * by the accessible name a screen reader hears, never by a class.
 */
import NoteCard from './NoteCard'
import NotesTableView from './NotesTableView'
import NoteBoardView from './NoteBoardView'
import LockedGlyph from './LockedGlyph'

const STATUS = {
  id: 'builtin:thesis_status', name: 'Thesis Status', type: 'select', source: 'user_set',
  options: [{ id: 'watching', label: 'Watching', color: 'blue' }],
}
const LOCKED = { id: 'n1', title: 'Locked note', tags: [], locked: true, propertiesJson: { 'builtin:thesis_status': 'watching' } }
const OPEN = { id: 'n2', title: 'Open note', tags: [], locked: false, propertiesJson: { 'builtin:thesis_status': 'watching' } }

describe('the lock glyph', () => {
  it('only an explicit true shows it', () => {
    const { container, rerender } = render(<LockedGlyph note={{ locked: 'true' }} />)
    expect(container).toBeEmptyDOMElement()
    rerender(<LockedGlyph note={{ locked: true }} />)
    expect(screen.getByRole('img', { name: 'Locked' })).toBeInTheDocument()
  })

  it('is on a locked card and not on an unlocked one', () => {
    render(<><NoteCard note={LOCKED} onOpen={() => {}} /><NoteCard note={OPEN} onOpen={() => {}} /></>)
    const [locked, open] = screen.getAllByRole('button')
    expect(within(locked).getByRole('img', { name: 'Locked' })).toBeInTheDocument()
    expect(within(open).queryByRole('img', { name: 'Locked' })).not.toBeInTheDocument()
  })

  it('is on a locked table row and not on an unlocked one', () => {
    render(<NotesTableView notes={[LOCKED, OPEN]} propertyDefs={[]} onOpenNote={() => {}} blockedNoteIds={new Set()} />)
    expect(screen.getAllByRole('img', { name: 'Locked' })).toHaveLength(1)
    const row = screen.getByText('Locked note').closest('tr') || screen.getByText('Locked note').parentElement
    expect(within(row).getByRole('img', { name: 'Locked' })).toBeInTheDocument()
  })

  it('is on a locked board card and not on an unlocked one', () => {
    render(<NoteBoardView notes={[LOCKED, OPEN]} propertyDefs={[STATUS]} onOpenNote={() => {}}
      blockedNoteIds={new Set()} onChanged={() => {}} />)
    expect(screen.getAllByRole('img', { name: 'Locked' })).toHaveLength(1)
  })
})
