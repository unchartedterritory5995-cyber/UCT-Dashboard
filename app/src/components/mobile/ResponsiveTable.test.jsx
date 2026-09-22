import { render, screen, fireEvent } from '@testing-library/react'
import { afterEach, vi } from 'vitest'
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
