import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import NotesTableView from './NotesTableView'

const defs = [
  // Sector, not Ticker -- Ticker is now its own DELIBERATE fixed pseudo-column
  // (UX #2, 2026-09-22), so it's no longer a usable example of "a
  // financial_derived def must never leak in as a dynamic property column".
  { id: 'builtin:sector', name: 'Sector', type: 'text', source: 'financial_derived' },
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

  it('never shows a financial-derived property as its own DYNAMIC column (it is not a usedDefs value column here)', () => {
    setup()
    expect(screen.queryByText('Sector')).toBeNull()
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

  /**
   * ⛔⛔ TABLE VIEW STRUCTURALLY COULD NOT SHOW TICKER — the one view built
   * explicitly for sorting/scanning a database was the single view that
   * couldn't show it. List and Board already do. Competitive audit finding
   * UX #2, 2026-09-22.
   */
  it('shows the note ticker as its own column, matching List/Board', () => {
    setup({
      notes: [
        { id: 'n1', title: 'NVDA Thesis', updatedAt: '2026-09-01T00:00:00Z', ticker: 'NVDA', propertiesJson: {} },
        { id: 'n2', title: 'No ticker note', updatedAt: '2026-09-02T00:00:00Z', ticker: null, propertiesJson: {} },
      ],
    })
    expect(screen.getByText('$NVDA')).toBeTruthy()
    expect(screen.getByText('Ticker')).toBeTruthy()
  })

  it('a note with no value for a shown property renders an empty dash, not a broken cell', () => {
    // The column only appears because n1/n2 use it -- n3 (no value) must
    // still render a dash for that cell rather than the column just
    // silently omitting the row's data. Scoped to n3's OWN row -- its
    // Ticker cell is also legitimately a dash (UX #2's fixed column, no
    // ticker on this note), so an unscoped getByText('—') is now ambiguous
    // by design, not broken.
    setup({
      notes: [
        ...notes,
        { id: 'n3', title: 'No Status', updatedAt: '2026-09-03T00:00:00Z', propertiesJson: {} },
      ],
    })
    const row = screen.getByText('No Status').closest('tr')
    // TWO dashes in this row now, by design -- the Ticker column (UX #2, no
    // ticker on this note) AND the Thesis Status column (no value) both
    // correctly render the empty state rather than a broken cell.
    expect(within(row).getAllByText('—')).toHaveLength(2)
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
