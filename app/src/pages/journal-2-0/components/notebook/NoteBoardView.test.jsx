import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

/**
 * ⛔ THE LOAD-BEARING TEST IN THIS FILE IS `a move RECORDS its revision`.
 *
 * A board drag is a `PUT /notes/{id}` that advances `updatedAt`. Wave Q1's
 * measured defect was that five of six such doors told the durable layer
 * nothing, so guard 2 answered "not ours" about this browser's own write and
 * FORKED the member's note. Every other assertion here is about a board being
 * a board; that one is about not destroying work.
 */

const settleSpy = vi.fn()
vi.mock('../../lib/offline/settleNoteWrite', () => ({
  settleNoteWrite: (...a) => settleSpy(...a),
}))

import NoteBoardView, { groupableDefs, columnsFor, columnIdFor } from './NoteBoardView'

const STATUS = {
  id: 'builtin:thesis_status',
  name: 'Thesis Status',
  type: 'select',
  source: 'user_set',
  options: [
    { id: 'watching', label: 'Watching', color: 'blue' },
    { id: 'active', label: 'Active', color: 'green' },
    { id: 'closed', label: 'Closed', color: 'gray' },
  ],
}
const CONF = {
  id: 'builtin:confidence',
  name: 'Confidence',
  type: 'select',
  source: 'user_set',
  options: [{ id: 'high', label: 'High', color: 'green' }],
}
const NOTES = [
  { id: 'n1', title: 'NVDA thesis', propertiesJson: { 'builtin:thesis_status': 'watching' } },
  { id: 'n2', title: 'AMD thesis', propertiesJson: { 'builtin:thesis_status': 'active' } },
  { id: 'n3', title: 'Untriaged note', propertiesJson: {} },
]

let onChanged
beforeEach(() => {
  settleSpy.mockReset().mockResolvedValue('2026-09-19T00:00:00Z')
  onChanged = vi.fn()
  global.fetch = vi.fn(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ note: { id: 'n1', updatedAt: '2026-09-19T00:00:00Z' } }),
  }))
})
afterEach(() => { vi.restoreAllMocks() })

const renderBoard = (props = {}) => render(
  <NoteBoardView
    notes={NOTES}
    propertyDefs={[STATUS, CONF]}
    onOpenNote={vi.fn()}
    blockedNoteIds={new Set()}
    onChanged={onChanged}
    {...props}
  />,
)

// ⛔ Address a column by its LABELLED REGION, never by getByText. Every column
// label also appears inside every card's move <select>, so a text query matches
// N+1 nodes and the failure reads like a missing column rather than an
// ambiguous query.
const columnNamed = (name) => screen.getByRole('region', { name })

// ── the pure grouping rules ──────────────────────────────────────────────

describe('grouping rules', () => {
  it('ONLY a select property can group a board', () => {
    const defs = groupableDefs([
      STATUS,
      { id: 'p:t', name: 'Notes', type: 'text' },
      { id: 'p:n', name: 'Size', type: 'number' },
      { id: 'p:d', name: 'Review', type: 'date' },
      { id: 'p:c', name: 'Done', type: 'checkbox' },
      { id: 'p:m', name: 'Tags', type: 'multi_select', options: [{ id: 'a', label: 'A' }] },
      { id: 'p:u', name: 'Link', type: 'url' },
    ])
    // multi_select would put one note in several columns and make a drop
    // ambiguous; text/number/date have unbounded values -> unbounded columns.
    expect(defs.map((d) => d.id)).toEqual(['builtin:thesis_status'])
  })

  it('a select with no options cannot group a board', () => {
    expect(groupableDefs([{ id: 'x', name: 'X', type: 'select', options: [] }])).toEqual([])
  })

  it('columns keep DECLARED order and always end with the un-set column', () => {
    expect(columnsFor(STATUS).map((c) => c.label))
      .toEqual(['Watching', 'Active', 'Closed', 'No value'])
  })

  it('a note with no value, an empty value, or an UNKNOWN option lands in No value', () => {
    expect(columnIdFor({ propertiesJson: {} }, STATUS)).toBe('__unset__')
    expect(columnIdFor({ propertiesJson: { 'builtin:thesis_status': null } }, STATUS)).toBe('__unset__')
    expect(columnIdFor({ propertiesJson: { 'builtin:thesis_status': '' } }, STATUS)).toBe('__unset__')
    // An option deleted from the def must not make the note vanish.
    expect(columnIdFor({ propertiesJson: { 'builtin:thesis_status': 'gone' } }, STATUS)).toBe('__unset__')
  })
})

// ── the board ────────────────────────────────────────────────────────────

describe('NoteBoardView', () => {
  it('renders a column per option plus a real No value column', () => {
    renderBoard()
    for (const label of ['Watching', 'Active', 'Closed', 'No value']) {
      expect(columnNamed(label)).toBeInTheDocument()
    }
  })

  it('an untriaged note is VISIBLE, not hidden', () => {
    renderBoard()
    // The board exists to triage; a note with no value is the one that most
    // needs to be on it.
    expect(within(columnNamed('No value')).getByText('Untriaged note')).toBeInTheDocument()
  })

  it('puts each note under its own value', () => {
    renderBoard()
    expect(within(columnNamed('Watching')).getByText('NVDA thesis')).toBeInTheDocument()
    expect(within(columnNamed('Active')).getByText('AMD thesis')).toBeInTheDocument()
  })

  it('defaults to a property the notes actually use', () => {
    // Confidence is a valid board property but nothing uses it; opening on it
    // would show four empty columns.
    renderBoard()
    expect(screen.getByLabelText('Group by')).toHaveValue('builtin:thesis_status')
  })

  it('says what to do when the notebook has no select property at all', () => {
    renderBoard({ propertyDefs: [{ id: 'p:t', name: 'Notes', type: 'text' }] })
    expect(screen.getByText(/groups notes by a/i)).toBeInTheDocument()
  })

  // ⛔ THE ONE THAT PROTECTS MEMBER WORK
  it('a move RECORDS its revision — otherwise the drain forks the note', async () => {
    renderBoard()
    const card = screen.getByText('NVDA thesis').closest('article')
    fireEvent.change(within(card).getByRole('combobox'), { target: { value: 'closed' } })

    await waitFor(() => expect(settleSpy).toHaveBeenCalledTimes(1))
    expect(settleSpy.mock.calls[0][0]).toBe('n1')
  })

  it('a move MERGES the one property, never replacing the note properties', async () => {
    renderBoard()
    const card = screen.getByText('NVDA thesis').closest('article')
    fireEvent.change(within(card).getByRole('combobox'), { target: { value: 'closed' } })

    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    const [url, opts] = global.fetch.mock.calls[0]
    expect(url).toBe('/api/j2/notes/n1')
    expect(opts.method).toBe('PUT')
    const body = JSON.parse(opts.body)
    // `properties` merges server-side; `propertiesReplace` would wipe every
    // property this board never displayed.
    expect(body).toEqual({ properties: { 'builtin:thesis_status': 'closed' } })
    expect(body.propertiesReplace).toBeUndefined()
  })

  it('dropping on No value CLEARS the property (sends null, not the string)', async () => {
    renderBoard()
    const card = screen.getByText('NVDA thesis').closest('article')
    fireEvent.change(within(card).getByRole('combobox'), { target: { value: '__unset__' } })

    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    const body = JSON.parse(global.fetch.mock.calls[0][1].body)
    expect(body.properties['builtin:thesis_status']).toBeNull()
  })

  it('a failed move puts the card BACK where it came from, not into No value', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 500 }))
    renderBoard()
    const card = screen.getByText('NVDA thesis').closest('article')
    fireEvent.change(within(card).getByRole('combobox'), { target: { value: 'closed' } })

    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument())
    // Back under Watching — landing it in No value would be a property the
    // member never cleared.
    expect(within(columnNamed('Watching')).getByText('NVDA thesis')).toBeInTheDocument()
    expect(settleSpy).not.toHaveBeenCalled()
  })

  it('refuses to move a note whose words have not reached the server, and says why', async () => {
    renderBoard({ blockedNoteIds: new Set(['n1']) })
    const card = screen.getByText('NVDA thesis').closest('article')
    // No move control at all on a blocked card — and the badge explains it.
    expect(within(card).queryByRole('combobox')).toBeNull()
    expect(within(card).getByText(/edit again to sync/i)).toBeInTheDocument()
    expect(card).toHaveAttribute('draggable', 'false')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('a DROP carrying a blocked note is refused by move() itself', async () => {
    // ⛔ THE RENDER GUARD AND THE move() GUARD ARE TWO DIFFERENT GUARDS, and
    // the test above only reaches the first: a blocked card renders a badge
    // instead of a <select>, so it proves nothing about move(). The drop
    // handler does NOT consult `blocked` -- it looks the note up by the id in
    // dataTransfer and calls move() directly -- so move()'s own check is the
    // only thing standing between a dropped blocked note and a write on top of
    // words that have not reached the server. Mutation-proved: without it this
    // goes red while every other test here stays green.
    renderBoard({ blockedNoteIds: new Set(['n1']) })
    fireEvent.drop(columnNamed('Closed'), {
      dataTransfer: { getData: () => 'n1' },
    })
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument())
    expect(screen.getByRole('status').textContent).toMatch(/not reached the server/i)
    expect(global.fetch).not.toHaveBeenCalled()
    expect(settleSpy).not.toHaveBeenCalled()
  })

  it('every card is movable WITHOUT dragging — touch never fires HTML5 drag', () => {
    renderBoard()
    // One real <select> per unblocked card. A drag-only board is unusable on
    // the touch tier and fails WCAG 2.1.1.
    expect(screen.getAllByRole('combobox')).toHaveLength(NOTES.length + 1) // +1 = Group by
  })

  it('a successful move tells the parent so the list can re-fetch', async () => {
    renderBoard()
    const card = screen.getByText('AMD thesis').closest('article')
    fireEvent.change(within(card).getByRole('combobox'), { target: { value: 'closed' } })
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it('the optimistic override EXPIRES once the server speaks', async () => {
    // ⛔ THE DEFECT THIS EXISTS FOR: the override map was never cleared, so the
    // board kept showing its own value for the life of the mount. Change the
    // property in the EDITOR, come back, and the board still showed the old
    // one -- a second authority over a value the server owns.
    const { rerender } = renderBoard()
    const card = screen.getByText('NVDA thesis').closest('article')
    fireEvent.change(within(card).getByRole('combobox'), { target: { value: 'closed' } })
    await waitFor(() => expect(settleSpy).toHaveBeenCalled())
    expect(within(columnNamed('Closed')).getByText('NVDA thesis')).toBeInTheDocument()

    // The server now reports something ELSE for that note (someone edited it
    // in the editor). The revision advanced, so the override must retire and
    // the server's value must win -- dropping only on AGREEMENT would keep the
    // stale value in precisely this case.
    const serverSaid = [
      { ...NOTES[0], updatedAt: '2026-09-20T09:00:00Z', propertiesJson: { 'builtin:thesis_status': 'active' } },
      NOTES[1], NOTES[2],
    ]
    rerender(
      <NoteBoardView
        notes={serverSaid}
        propertyDefs={[STATUS, CONF]}
        onOpenNote={vi.fn()}
        blockedNoteIds={new Set()}
        onChanged={onChanged}
      />,
    )
    await waitFor(() => {
      expect(within(columnNamed('Active')).getByText('NVDA thesis')).toBeInTheDocument()
    })
    expect(within(columnNamed('Closed')).queryByText('NVDA thesis')).toBeNull()
  })

  it('regrouping to another property redraws the columns', () => {
    renderBoard()
    fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'builtin:confidence' } })
    expect(columnNamed('High')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Watching' })).toBeNull()
  })
})
