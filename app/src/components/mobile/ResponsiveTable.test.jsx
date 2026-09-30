import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, vi } from 'vitest'
import ResponsiveTable from './ResponsiveTable'

// Control useIsPhone() by making matchMedia match the phone query when asked.
function setViewport(isPhone) {
  window.matchMedia = (query) => ({
    matches: isPhone && /max-width:\s*640px/.test(query),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })
}

afterEach(() => { vi.restoreAllMocks() })

const columns = [
  { key: 'sym', header: 'Symbol', primary: true },
  { key: 'price', header: 'Price', render: (r) => `$${r.price}` },
  { key: 'vol', header: 'Volume', hideOnPhone: true },
]
const rows = [
  { id: 'AAPL', sym: 'AAPL', price: 190, vol: '50M' },
  { id: 'MSFT', sym: 'MSFT', price: 410, vol: '20M' },
]

test('desktop renders a real table with headers and all cells', () => {
  setViewport(false)
  const { container } = render(<ResponsiveTable columns={columns} rows={rows} />)
  expect(container.querySelector('table')).toBeTruthy()
  expect(screen.getByText('Symbol')).toBeInTheDocument()
  expect(screen.getByText('AAPL')).toBeInTheDocument()
  expect(screen.getByText('$190')).toBeInTheDocument()
  expect(screen.getByText('50M')).toBeInTheDocument() // hideOnPhone has no effect on desktop
})

test('phone card mode drops a <table>, keeps headline + labels, hides hideOnPhone cols', () => {
  setViewport(true)
  const { container } = render(<ResponsiveTable columns={columns} rows={rows} mode="card" />)
  expect(container.querySelector('table')).toBeNull()
  expect(screen.getByText('AAPL')).toBeInTheDocument()
  // secondary column renders its header as an inline label (one per card)
  expect(screen.getAllByText('Price').length).toBe(2)
  // hideOnPhone column value is gone in card mode
  expect(screen.queryByText('50M')).toBeNull()
})

test('phone scroll mode keeps a real table', () => {
  setViewport(true)
  const { container } = render(<ResponsiveTable columns={columns} rows={rows} mode="scroll" />)
  expect(container.querySelector('table')).toBeTruthy()
  expect(screen.getByText('AAPL')).toBeInTheDocument()
})

/**
 * ⛔⛔ FX2 (wave 10, proof-walk item 2): `aria-sort` is a generic, OPTIONAL
 * per-column field -- same "undefined for every pre-existing caller" shape
 * as `rowDataAttrs` -- so every column above (none of which sets it) must
 * stay byte-identical (no `aria-sort` attribute at all, not even `"none"`).
 * It belongs on the `<th>` itself, WAI-ARIA's own host-language semantic for
 * a sortable header cell, never on a control inside it.
 */
describe('ariaSort — an optional per-column field on the header <th> (FX2)', () => {
  const sortCols = [
    { key: 'sym', header: 'Symbol', primary: true, ariaSort: 'ascending' },
    { key: 'price', header: 'Price', render: (r) => `$${r.price}` },
  ]

  test('a column with ariaSort sets aria-sort on its <th>', () => {
    setViewport(false)
    render(<ResponsiveTable columns={sortCols} rows={rows} />)
    expect(screen.getByRole('columnheader', { name: 'Symbol' })).toHaveAttribute('aria-sort', 'ascending')
  })

  test('a column with no ariaSort carries no aria-sort attribute at all', () => {
    setViewport(false)
    render(<ResponsiveTable columns={sortCols} rows={rows} />)
    expect(screen.getByRole('columnheader', { name: 'Price' })).not.toHaveAttribute('aria-sort')
  })

  test('⛔ CONTROL — every pre-existing caller (no column here sets ariaSort) gets no aria-sort anywhere', () => {
    setViewport(false)
    const { container } = render(<ResponsiveTable columns={columns} rows={rows} />)
    expect(container.querySelectorAll('[aria-sort]')).toHaveLength(0)
  })
})

test('onRowClick fires with the row', () => {
  setViewport(false)
  const onRowClick = vi.fn()
  render(<ResponsiveTable columns={columns} rows={rows} onRowClick={onRowClick} />)
  fireEvent.click(screen.getByText('AAPL'))
  expect(onRowClick).toHaveBeenCalledWith(rows[0], 0)
})

test('empty rows shows emptyText', () => {
  setViewport(false)
  render(<ResponsiveTable columns={columns} rows={[]} emptyText="Nothing here" />)
  expect(screen.getByText('Nothing here')).toBeInTheDocument()
})

/**
 * ⛔⛔ D-40 — a caller-supplied `data-*` attribute on the ROW ROOT, in BOTH
 * renderings. Generic on purpose: this shared primitive should not hardcode
 * any one caller's attribute name (e.g. the Notebook hub's own
 * `data-note-card-id` contract, R-18) -- `rowDataAttrs` lets any caller
 * attach whatever a consumer outside React needs to find a row by, without
 * ResponsiveTable knowing what that consumer is. Competitive audit finding
 * UX #11 / Accessibility QW-6, 2026-09-22.
 */
test('rowDataAttrs applies a caller-supplied data-* attribute to the DESKTOP row root', () => {
  setViewport(false)
  const { container } = render(
    <ResponsiveTable columns={columns} rows={rows} rowDataAttrs={(r) => ({ 'data-note-card-id': r.id })} />,
  )
  const tr = screen.getByText('AAPL').closest('tr')
  expect(tr).toHaveAttribute('data-note-card-id', 'AAPL')
  // Not on a descendant -- the id must be on the row root the same as R-18
  // requires for the grid card, or an external cursor overlay would land
  // inside the row instead of around it.
  expect(container.querySelectorAll('[data-note-card-id]')).toHaveLength(rows.length)
})

test('rowDataAttrs applies to the PHONE CARD row root too', () => {
  setViewport(true)
  render(
    <ResponsiveTable columns={columns} rows={rows} mode="card" rowDataAttrs={(r) => ({ 'data-note-card-id': r.id })} />,
  )
  const card = screen.getByText('AAPL').closest('[data-note-card-id]')
  expect(card).not.toBeNull()
  expect(card.getAttribute('data-note-card-id')).toBe('AAPL')
})

test('⛔ CONTROL — omitting rowDataAttrs adds no such attribute (every pre-existing caller)', () => {
  setViewport(false)
  const { container } = render(<ResponsiveTable columns={columns} rows={rows} />)
  expect(container.querySelectorAll('[data-note-card-id]')).toHaveLength(0)
})

/**
 * ⛔⛔ F4 / A2R-02 (WCAG 2.1.1) — a row that opens on click opens on the keyboard.
 * Lane 10E-2's keyboard walk found a Notebook Table-view row opened on a mouse click
 * only: no tabindex, no key handler. Asserted with the keyboard itself (user-event Tab,
 * Enter and Space), in BOTH renderings, plus the two things the fix must not do: grow a
 * Tab stop on a table nobody can activate, and steal a key from a control inside a row.
 */
describe('keyboard rows (F4, A2R-02)', () => {
  const inner = [
    ...columns,
    { key: 'act', header: 'Act', render: (r) => <button type="button" onClick={(e) => e.stopPropagation()}>{`Filter ${r.sym}`}</button> },
  ]

  test('desktop: Tab reaches the row and Enter / Space call onRowClick with the row', async () => {
    setViewport(false)
    const user = userEvent.setup()
    const onRowClick = vi.fn()
    render(<ResponsiveTable columns={columns} rows={rows} onRowClick={onRowClick} />)
    await user.tab()
    const tr = screen.getByText('AAPL').closest('tr')
    expect(document.activeElement).toBe(tr)
    await user.keyboard('{Enter}')
    expect(onRowClick).toHaveBeenLastCalledWith(rows[0], 0)
    await user.tab()
    expect(document.activeElement).toBe(screen.getByText('MSFT').closest('tr'))
    await user.keyboard(' ')
    expect(onRowClick).toHaveBeenLastCalledWith(rows[1], 1)
    expect(onRowClick).toHaveBeenCalledTimes(2)
  })

  test('phone card: the card is the Tab stop and Enter calls onRowClick', async () => {
    setViewport(true)
    const user = userEvent.setup()
    const onRowClick = vi.fn()
    render(<ResponsiveTable columns={columns} rows={rows} mode="card" onRowClick={onRowClick} />)
    await user.tab()
    const card = screen.getByText('AAPL').closest('[tabindex]')
    expect(card).not.toBeNull()
    expect(document.activeElement).toBe(card)
    await user.keyboard('{Enter}')
    expect(onRowClick).toHaveBeenCalledWith(rows[0], 0)
  })

  test('rowLabel names the row (a <tr> keeps its row role; a card becomes a named group)', () => {
    setViewport(false)
    const label = (r) => `Open ${r.sym}`
    const { unmount } = render(<ResponsiveTable columns={columns} rows={rows} onRowClick={vi.fn()} rowLabel={label} />)
    const tr = screen.getByText('AAPL').closest('tr')
    expect(tr).toHaveAttribute('aria-label', 'Open AAPL')
    expect(tr.getAttribute('role')).toBeNull()
    unmount()
    setViewport(true)
    render(<ResponsiveTable columns={columns} rows={rows} mode="card" onRowClick={vi.fn()} rowLabel={label} />)
    expect(screen.getByRole('group', { name: 'Open AAPL' })).toBeInTheDocument()
  })

  test('a key pressed on a control INSIDE the row belongs to that control', async () => {
    setViewport(false)
    const user = userEvent.setup()
    const onRowClick = vi.fn()
    render(<ResponsiveTable columns={inner} rows={rows} onRowClick={onRowClick} />)
    const btn = screen.getByRole('button', { name: 'Filter AAPL' })
    btn.focus()
    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    expect(onRowClick).not.toHaveBeenCalled()
  })

  test('⛔ CONTROL — without onRowClick no row is a Tab stop and no key does anything', async () => {
    setViewport(false)
    const user = userEvent.setup()
    const { container } = render(<ResponsiveTable columns={columns} rows={rows} rowLabel={(r) => r.sym} />)
    expect(container.querySelectorAll('[tabindex]')).toHaveLength(0)
    expect(container.querySelectorAll('[aria-label]')).toHaveLength(0)
    await user.tab()
    expect(document.activeElement).toBe(document.body)
  })
})
