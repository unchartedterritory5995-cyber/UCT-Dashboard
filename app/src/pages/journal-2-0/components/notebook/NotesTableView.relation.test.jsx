import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import NotesTableView from './NotesTableView'

/**
 * Wave 6 (lane E, item 5) — a relation column in the table says how many notes
 * it links (never raw ids), and its header is a label: the server refuses to
 * sort by a relation, so a sort button there would be a click that 400s.
 */
const DEFS = [
  { id: 'p1', name: 'Peers', type: 'relation', source: 'user_set' },
  { id: 'p2', name: 'Stage', type: 'text', source: 'user_set' },
]
const NOTES = [
  { id: 'n1', title: 'One', tags: [], propertiesJson: { p1: ['a', 'b'], p2: 'x' } },
  { id: 'n2', title: 'Two', tags: [], propertiesJson: { p1: ['a'] } },
]

describe('a relation column', () => {
  it('counts the linked notes and never prints their ids', () => {
    render(<NotesTableView notes={NOTES} propertyDefs={DEFS} onOpenNote={() => {}}
      onPropertySortChange={vi.fn()} onQuickFilter={vi.fn()} blockedNoteIds={new Set()} />)
    expect(screen.getByText('2 linked notes')).toBeInTheDocument()
    expect(screen.getByText('1 linked note')).toBeInTheDocument()
    expect(screen.queryByText(/\ba, b\b/)).not.toBeInTheDocument()
  })

  it('has a plain header, while an ordinary property keeps its sort button', () => {
    render(<NotesTableView notes={NOTES} propertyDefs={DEFS} onOpenNote={() => {}}
      onPropertySortChange={vi.fn()} onQuickFilter={vi.fn()} blockedNoteIds={new Set()} />)
    expect(screen.queryByRole('button', { name: /^Peers/ })).not.toBeInTheDocument()
    expect(screen.getByText('Peers')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Stage/ })).toBeInTheDocument()
  })
})
