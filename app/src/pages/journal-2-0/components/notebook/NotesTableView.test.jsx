import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import NotesTableView from './NotesTableView'

const defs = [
  { id: 'builtin:ticker', name: 'Ticker', type: 'text', source: 'financial_derived' },
  {
    id: 'p1', name: 'Thesis Status', type: 'select', source: 'user_set',
    options: [{ id: 'active', label: 'Active' }, { id: 'closed', label: 'Closed' }],
  },
  { id: 'p2', name: 'Unused Prop', type: 'text', source: 'user_set' },
]

const notes = [
  { id: 'n1', title: 'NVDA Thesis', updatedAt: '2026-09-01T00:00:00Z', propertiesJson: { p1: 'active' } },
  { id: 'n2', title: 'AMD Watch', updatedAt: '2026-09-02T00:00:00Z', propertiesJson: { p1: 'closed' } },
]

function setup(overrides = {}) {
  const onSortChange = vi.fn()
  const onPropertySortChange = vi.fn()
  const onQuickFilter = vi.fn()
  const onOpenNote = vi.fn()
  render(
    <NotesTableView
      notes={notes}
      propertyDefs={defs}
      sort="updated"
      onSortChange={onSortChange}
      propertySort={null}
      onPropertySortChange={onPropertySortChange}
      onQuickFilter={onQuickFilter}
      onOpenNote={onOpenNote}
      {...overrides}
    />,
  )
  return { onSortChange, onPropertySortChange, onQuickFilter, onOpenNote }
}

describe('NotesTableView', () => {
  it('renders a row per note with the title and a resolved select-option label', () => {
    setup()
    expect(screen.getByText('NVDA Thesis')).toBeTruthy()
    expect(screen.getByText('Active')).toBeTruthy()
    expect(screen.getByText('Closed')).toBeTruthy()
  })

  it('only shows a property column when at least one note actually uses it', () => {
    setup()
    expect(screen.getByText('Thesis Status')).toBeTruthy()
    expect(screen.queryByText('Unused Prop')).toBeNull()
  })

  it('never shows a financial-derived property as its own column (it is not a value column here)', () => {
    setup()
    expect(screen.queryByText('Ticker')).toBeNull()
  })

  it('clicking a row opens that note', () => {
    const { onOpenNote } = setup()
    fireEvent.click(screen.getByText('NVDA Thesis'))
    expect(onOpenNote).toHaveBeenCalledWith('n1')
  })

  it('clicking a select-value chip applies a quick filter without opening the note', () => {
    const { onQuickFilter, onOpenNote } = setup()
    fireEvent.click(screen.getByText('Active'))
    expect(onQuickFilter).toHaveBeenCalledWith('p1', 'active')
    expect(onOpenNote).not.toHaveBeenCalled()
  })

  it('clicking a property column header requests a property sort', () => {
    const { onPropertySortChange } = setup()
    fireEvent.click(screen.getByText('Thesis Status'))
    expect(onPropertySortChange).toHaveBeenCalledWith('p1')
  })

  it('a note with no value for a shown property renders an empty dash, not a broken cell', () => {
    // The column only appears because n1/n2 use it -- n3 (no value) must
    // still render a dash for that cell rather than the column just
    // silently omitting the row's data.
    setup({
      notes: [
        ...notes,
        { id: 'n3', title: 'No Status', updatedAt: '2026-09-03T00:00:00Z', propertiesJson: {} },
      ],
    })
    expect(screen.getByText('—')).toBeTruthy()
  })
})
