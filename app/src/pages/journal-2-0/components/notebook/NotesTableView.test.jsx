import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
  const utils = render(
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
  return { onSortChange, onPropertySortChange, onQuickFilter, onOpenNote, rerender: utils.rerender }
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

  /**
   * ⛔⛔ D-40 — the joystick hub's cursor queries `[data-note-card-id]`
   * against the whole document, not scoped to the List grid. Without this,
   * a touch member on Table view was invisible to the hub's note-scrub
   * cursor -- silently, since a missing attribute produces zero found
   * notes, not an error. Competitive audit finding UX #11 / Accessibility
   * QW-6, 2026-09-22.
   */
  it('each row carries data-note-card-id, the same identity NoteCard.jsx already gives the hub (R-18)', () => {
    setup()
    const row = screen.getByText('NVDA Thesis').closest('[data-note-card-id]')
    expect(row).not.toBeNull()
    expect(row.getAttribute('data-note-card-id')).toBe('n1')
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

/**
 * ⛔⛔ FX2 (wave 10, proof-walk item 2): the proof walk found the "UPDATED"
 * header's re-click as one of 12 DEAD clicks because nothing on the header
 * cell told assistive tech it was already the active sort. `aria-sort` is
 * the WAI-ARIA host-language semantic for exactly this, and it goes on the
 * `<th>` (the header CELL), never on the button inside it -- a different
 * ancestor than the view-mode buttons' `aria-pressed` fix, and deliberately
 * so (a sort button isn't a toggle in the `aria-pressed` sense).
 *
 * ⚰️ This docstring twice described a client-side re-click behavior (first
 * "a genuine no-op", then "FX4 gives it a local direction toggle") that no
 * longer exists: FX4's final, server-driven form (below) computes `aria-sort`
 * from the `sort` PROP alone, same as FX2 shipped it -- a click calls
 * `onSortChange` and changes nothing until the parent re-renders with a new
 * `sort`. These tests pin exactly that: one render, one `sort` value, one
 * `aria-sort` reading.
 */
describe('⛔⛔ FX2 — sortable header cells carry aria-sort (proof-walk item 2)', () => {
  it('the default sort (updated, descending) is announced on the Updated header cell', () => {
    setup({ sort: 'updated' })
    expect(screen.getByRole('columnheader', { name: /Updated/ })).toHaveAttribute('aria-sort', 'descending')
    expect(screen.getByRole('columnheader', { name: 'Title' })).not.toHaveAttribute('aria-sort')
  })

  it('sort=title flips aria-sort to the Title header cell (ascending) and clears it off Updated', () => {
    setup({ sort: 'title' })
    expect(screen.getByRole('columnheader', { name: 'Title' })).toHaveAttribute('aria-sort', 'ascending')
    expect(screen.getByRole('columnheader', { name: /Updated/ })).not.toHaveAttribute('aria-sort')
  })

  it('a `sort` prop of undefined still reads as the Updated default (matches the chevron\'s own `!sort` fallback)', () => {
    setup({ sort: undefined })
    expect(screen.getByRole('columnheader', { name: /Updated/ })).toHaveAttribute('aria-sort', 'descending')
  })

  it('⛔ CONTROL — a non-sortable header cell (Ticker) never carries aria-sort', () => {
    setup({ sort: 'updated' })
    expect(screen.getByRole('columnheader', { name: 'Ticker' })).not.toHaveAttribute('aria-sort')
  })
})

/**
 * ⛔⛔ FX4 (wave 10, proof-walk item 1 -- coordinator round 2, SERVER-DRIVEN):
 * Title/Updated are a real two-state toggle, but the direction lives IN the
 * `sort` value itself (`updated`/`updated_asc`, `title`/`title_desc`), never
 * in local component state. A first pass reversed the currently-loaded page
 * client-side and was rejected: `list_notes` pages 100 notes at a time, so
 * reversing page 1 of `updated` would show the 100 NEWEST notes, backwards,
 * labelled oldest-first, for any member past their first page -- a lie a
 * member would act on. This component now only ever COMPUTES what to ask
 * for (`onSortChange` with the toggled value) and RENDERS what `sort` says
 * (caret + `aria-sort`) -- the actual reordering is the server's, exercised
 * separately in `tests/test_journal_two_notes_sort_directions.py`.
 * Was the no-op the L11 sweep found
 * (`docs/notebook/proof/l11-52deeb767/deadclick.json`, "UPDATED", desktop
 * nb-table: no DOM change, no request, no URL change) -- a click now always
 * calls `onSortChange`, on both the active and the inactive header.
 */
describe('⛔⛔ FX4 — Title/Updated headers ask for the toggled sort value (proof-walk item 1, server-driven)', () => {
  it('clicking Updated while it is already the active (descending) sort asks for updated_asc', () => {
    const { onSortChange } = setup({ sort: 'updated' })
    fireEvent.click(within(screen.getByRole('columnheader', { name: /Updated/ })).getByRole('button'))
    expect(onSortChange).toHaveBeenCalledWith('updated_asc')
  })

  it('clicking Updated again while sort=updated_asc asks for the natural updated (descending)', () => {
    const { onSortChange } = setup({ sort: 'updated_asc' })
    fireEvent.click(within(screen.getByRole('columnheader', { name: /Updated/ })).getByRole('button'))
    expect(onSortChange).toHaveBeenCalledWith('updated')
  })

  it('sort=updated_asc renders as the active, ASCENDING Updated sort -- aria-sort and the caret both agree', () => {
    setup({ sort: 'updated_asc' })
    const updatedHeader = screen.getByRole('columnheader', { name: /Updated/ })
    expect(updatedHeader).toHaveAttribute('aria-sort', 'ascending')
    const path = within(updatedHeader).getByRole('button').querySelector('path')
    // chevronUp = "M6 14.5l6-6 6 6" (UIcon.jsx) -- read the rendered glyph's
    // own path, not the icon registry, so this is a DOM assertion, not a
    // mock of the icon component.
    expect(path.getAttribute('d')).toBe('M6 14.5l6-6 6 6')
  })

  it('clicking Title while it is already the active (ascending) sort asks for title_desc', () => {
    const { onSortChange } = setup({ sort: 'title' })
    fireEvent.click(screen.getByRole('columnheader', { name: 'Title' }).querySelector('button'))
    expect(onSortChange).toHaveBeenCalledWith('title_desc')
  })

  it('clicking Title again while sort=title_desc asks for the natural title (ascending)', () => {
    const { onSortChange } = setup({ sort: 'title_desc' })
    fireEvent.click(screen.getByRole('columnheader', { name: 'Title' }).querySelector('button'))
    expect(onSortChange).toHaveBeenCalledWith('title')
  })

  it('sort=title_desc renders as the active, DESCENDING Title sort', () => {
    setup({ sort: 'title_desc' })
    const titleHeader = screen.getByRole('columnheader', { name: 'Title' })
    expect(titleHeader).toHaveAttribute('aria-sort', 'descending')
    const path = titleHeader.querySelector('button path')
    expect(path.getAttribute('d')).toBe('M6 9.5l6 6 6-6') // chevronDown
  })

  it('clicking the INACTIVE header asks for that field\'s NATURAL direction, never its reverse', () => {
    const { onSortChange } = setup({ sort: 'updated' })
    fireEvent.click(screen.getByRole('button', { name: 'Title' }))
    expect(onSortChange).toHaveBeenCalledWith('title')
  })

  it('a directional sort value clears aria-sort off the OTHER header, same as the plain values', () => {
    setup({ sort: 'updated_asc' })
    expect(screen.getByRole('columnheader', { name: 'Title' })).not.toHaveAttribute('aria-sort')
  })
})

describe('NotesTableView — wave 5 selection', () => {
  const selectionWith = (over = {}) => ({
    isSelected: vi.fn((id) => (over.selected || []).includes(id)),
    onToggle: vi.fn(),
    onToggleAll: vi.fn(),
    allSelected: false,
    someSelected: (over.selected || []).length > 0,
    ...over,
  })

  it('without `selection` there are no checkboxes', () => {
    setup()
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
  })

  it('one checkbox per row plus a select-all in the header', () => {
    setup({ selection: selectionWith() })
    expect(screen.getByRole('checkbox', { name: 'Select all notes in view' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select NVDA Thesis' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Select AMD Watch' })).toBeInTheDocument()
  })

  it('a row checkbox selects WITHOUT opening the note', () => {
    const selection = selectionWith()
    const { onOpenNote } = setup({ selection })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select AMD Watch' }), { shiftKey: true })
    expect(selection.onToggle).toHaveBeenCalledWith(expect.objectContaining({ id: 'n2' }), { shift: true })
    expect(onOpenNote).not.toHaveBeenCalled()
  })

  it('the header box selects all in view', () => {
    const selection = selectionWith()
    setup({ selection })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all notes in view' }))
    expect(selection.onToggleAll).toHaveBeenCalled()
  })

  it('the header box is indeterminate when some — not all — are selected', () => {
    setup({ selection: selectionWith({ selected: ['n1'] }) })
    expect(screen.getByRole('checkbox', { name: 'Select all notes in view' }).indeterminate).toBe(true)
    expect(screen.getByRole('checkbox', { name: 'Select NVDA Thesis' })).toBeChecked()
  })

  it('when all are selected the header offers to clear, by name', () => {
    setup({ selection: selectionWith({ selected: ['n1', 'n2'], allSelected: true }) })
    const box = screen.getByRole('checkbox', { name: 'Clear the selection' })
    expect(box).toBeChecked()
    expect(box.indeterminate).toBe(false)
  })
})

// F4 / A2R-02 (WCAG 2.1.1): lane 10E-2's keyboard walk could not open a note from Table
// view -- the row opened on a mouse click only. The row is now a Tab stop named for what it
// does, and Enter opens the WHOLE note object (the contract NoteCard's open uses; a bare id
// once reached openNote as `?note=undefined`). A select-value chip inside the row keeps its
// own Enter: it filters, it never opens.
describe('NotesTableView — keyboard open (F4, A2R-02)', () => {
  it('Tab reaches a row named "Open <title>", and Enter opens that note', async () => {
    const user = userEvent.setup()
    const { onOpenNote, onQuickFilter } = setup()
    const row = screen.getByRole('row', { name: 'Open NVDA Thesis' })
    // walk to it with the keyboard, from the top of the table
    for (let i = 0; i < 12 && document.activeElement !== row; i += 1) await user.tab()
    expect(document.activeElement).toBe(row)
    await user.keyboard('{Enter}')
    expect(onOpenNote).toHaveBeenCalledTimes(1)
    expect(onOpenNote).toHaveBeenCalledWith(notes[0])
    // the value chip inside the row keeps its own Enter
    const chip = within(row).getByRole('button', { name: /Active/ })
    chip.focus()
    await user.keyboard('{Enter}')
    expect(onQuickFilter).toHaveBeenCalledWith('p1', 'active')
    expect(onOpenNote).toHaveBeenCalledTimes(1)
  })
})
