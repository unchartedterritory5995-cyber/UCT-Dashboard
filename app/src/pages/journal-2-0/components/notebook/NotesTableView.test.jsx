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

  it('clicking a row opens that note with the WHOLE note object (openNote reads note.id itself -- passing a bare id string here previously produced ?note=undefined, caught live via browser E2E)', () => {
    const { onOpenNote } = setup()
    fireEvent.click(screen.getByText('NVDA Thesis'))
    expect(onOpenNote).toHaveBeenCalledWith(notes[0])
    expect(onOpenNote.mock.calls[0][0].id).toBe('n1')
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

/**
 * ⛔⛔ SELECT/MULTI-SELECT COLOR MUST REACH THE TABLE CELL.
 *
 * `note_properties.py` computes a real color per option
 * (thesis_status: active -> green, etc.) and Board view's column HEADER
 * already renders it via a dot -- but the table's own value chip, the one
 * place a member actually scans a database, rendered plain text with no
 * color anywhere. Competitive audit finding UX #3, 2026-09-22. Reuses
 * Board's own dot+color-class idiom rather than inventing a new one.
 */
describe('NotesTableView — select/multi_select option color', () => {
  const coloredDefs = [
    {
      id: 'p1', name: 'Thesis Status', type: 'select', source: 'user_set',
      options: [
        { id: 'active', label: 'Active', color: 'green' },
        { id: 'closed', label: 'Closed', color: 'gray' },
      ],
    },
    {
      id: 'p2', name: 'Tags', type: 'multi_select', source: 'user_set',
      options: [
        { id: 'earnings', label: 'Earnings', color: 'amber' },
        { id: 'macro', label: 'Macro', color: 'blue' },
      ],
    },
  ]
  const coloredNotes = [
    {
      id: 'n1', title: 'NVDA Thesis', updatedAt: '2026-09-01T00:00:00Z',
      propertiesJson: { p1: 'active', p2: ['earnings', 'macro'] },
    },
  ]

  // Each pill's label text lives directly inside that pill's own span
  // (sibling to its dot) -- NOT scoped via the shared outer button, which
  // would return the FIRST pill in the cell regardless of which label this
  // helper was asked about.
  const dotColorFor = (label) => screen.getByText(label)
    .querySelector('[data-option-color]')
    .getAttribute('data-option-color')

  it('a select value carries its configured color', () => {
    render(
      <NotesTableView
        notes={coloredNotes} propertyDefs={coloredDefs} sort="updated"
        onSortChange={vi.fn()} propertySort={null} onPropertySortChange={vi.fn()}
        onQuickFilter={vi.fn()} onOpenNote={vi.fn()}
      />,
    )
    expect(dotColorFor('Active')).toBe('green')
  })

  it('EACH value of a multi_select carries its OWN color, not one shared color', () => {
    render(
      <NotesTableView
        notes={coloredNotes} propertyDefs={coloredDefs} sort="updated"
        onSortChange={vi.fn()} propertySort={null} onPropertySortChange={vi.fn()}
        onQuickFilter={vi.fn()} onOpenNote={vi.fn()}
      />,
    )
    expect(dotColorFor('Earnings')).toBe('amber')
    expect(dotColorFor('Macro')).toBe('blue')
  })

  it('⛔ CONTROL — an option with no configured color renders no color attribute (falls back to the neutral dot, same as Board)', () => {
    render(
      <NotesTableView
        notes={notes} propertyDefs={defs} sort="updated"
        onSortChange={vi.fn()} propertySort={null} onPropertySortChange={vi.fn()}
        onQuickFilter={vi.fn()} onOpenNote={vi.fn()}
      />,
    )
    const dot = screen.getByText('Active').querySelector('[data-option-color]')
    expect(dot.getAttribute('data-option-color')).toBe('')
  })

  it('clicking anywhere in a multi_select chip still applies the SAME quick filter as before (no behavior change, visual only)', () => {
    const onQuickFilter = vi.fn()
    render(
      <NotesTableView
        notes={coloredNotes} propertyDefs={coloredDefs} sort="updated"
        onSortChange={vi.fn()} propertySort={null} onPropertySortChange={vi.fn()}
        onQuickFilter={onQuickFilter} onOpenNote={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByText('Earnings'))
    expect(onQuickFilter).toHaveBeenCalledWith('p2', ['earnings', 'macro'])
  })
})
