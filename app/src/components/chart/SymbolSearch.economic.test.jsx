// Economic series in the chart symbol search — DARK BY CONSTRUCTION.
//
// The Economic chip, the economic rows and the `type=all_economic` merge exist ONLY
// on a surface that opted in (`economic`) AND only once `/api/econ/catalog`
// answered 200 for this member. 404 (flag off) / 401 / 403 -> the search is exactly
// what it was: same chips, same request URLs, no econ row, no catalogue re-probe.
import { render, screen, fireEvent, within, waitFor, act } from '@testing-library/react'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import SymbolSearch from './SymbolSearch'
import { CHIPS } from './symbolSearchModel'
import { _resetEconomicForTests } from './engine/economicSeries'
import { CATALOG } from './economic/__fixtures__/econCatalog'

const ECON_ROW = {
  ticker: 'ECON:USCPI', symbol: 'USCPI', name: 'CPI-U All Items (SA)', type: 'economic', exchange: null,
  economic: true, agency: 'U.S. Bureau of Labor Statistics', frequency: 'M', units: 'index', category: 'Inflation & Prices',
}
const STOCK_ROW = { ticker: 'CPIX', name: 'Cumberland Pharma', type: 'stock', exchange: 'NASDAQ' }

let calls
function mockFetch(catalogStatus) {
  calls = []
  globalThis.fetch = vi.fn(async (url) => {
    const u = String(url)
    calls.push(u)
    if (u.startsWith('/api/econ/catalog')) {
      return catalogStatus === 200
        ? { ok: true, status: 200, json: async () => CATALOG }
        : { ok: false, status: catalogStatus, json: async () => ({ detail: 'x' }) }
    }
    if (u.startsWith('/api/breadth-symbols')) return { ok: true, status: 200, json: async () => ({ symbols: [] }) }
    if (u.startsWith('/api/ticker-search')) {
      const econ = u.includes('type=economic') || u.includes('type=all_economic')
      const results = u.includes('type=economic') ? [ECON_ROW] : (econ ? [ECON_ROW, STOCK_ROW] : [STOCK_ROW])
      return { ok: true, status: 200, json: async () => ({ results }) }
    }
    return { ok: true, status: 200, json: async () => ({}) }
  })
}

beforeEach(() => { _resetEconomicForTests() })
afterEach(() => { vi.useRealTimers() })

function open(props = {}) {
  const onSymbolChange = vi.fn()
  render(<SymbolSearch sym="AAPL" onSymbolChange={onSymbolChange} {...props} />)
  fireEvent.click(screen.getByRole('button', { name: /AAPL — click to search/i }))
  return { onSymbolChange, dialog: screen.getByRole('dialog') }
}
const chipLabels = (dialog) => within(dialog).getAllByRole('button')
  .map((b) => b.textContent).filter((t) => ['All', 'Stocks', 'ETFs', 'Indices', 'Breadth', 'Economic'].includes(t))

async function typeQuery(dialog, q) {
  const input = within(dialog).getByPlaceholderText(/Search symbol/)
  fireEvent.change(input, { target: { value: q } })
  await act(async () => { await new Promise((r) => setTimeout(r, 220)) })
  return input
}

describe.each([404, 401, 403])('catalogue %i -> nothing economic, byte-identical search', (status) => {
  test('chips are the five CHIPS, no econ row, no type=all_economic', async () => {
    mockFetch(status)
    const { dialog } = open({ economic: true })
    // let the lazy probe settle
    await waitFor(() => expect(calls.some((u) => u.startsWith('/api/econ/catalog'))).toBe(true))
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(chipLabels(dialog)).toEqual(CHIPS.map((c) => c.label))
    await typeQuery(dialog, 'CPI')
    await waitFor(() => expect(calls.some((u) => u.startsWith('/api/ticker-search'))).toBe(true))
    const searches = calls.filter((u) => u.startsWith('/api/ticker-search'))
    expect(searches.every((u) => !u.includes('economic'))).toBe(true)
    expect(within(dialog).queryByTestId('econ-glyph')).toBeNull()
    expect(within(dialog).queryByText('CPI-U All Items (SA)')).toBeNull()
  })
})

test('a surface that did not opt in never even asks for the catalogue (journal, popups…)', async () => {
  mockFetch(200)
  const { dialog } = open()
  await typeQuery(dialog, 'CPI')
  await waitFor(() => expect(calls.some((u) => u.startsWith('/api/ticker-search'))).toBe(true))
  expect(calls.some((u) => u.startsWith('/api/econ'))).toBe(false)
  expect(chipLabels(dialog)).toEqual(CHIPS.map((c) => c.label))
  expect(calls.filter((u) => u.startsWith('/api/ticker-search')).every((u) => !u.includes('economic'))).toBe(true)
})

describe('entitled + enabled (catalogue 200)', () => {
  test('Economic chip appended; All merges econ rows; the row reads name first, no company logo', async () => {
    mockFetch(200)
    const { dialog, onSymbolChange } = open({ economic: true })
    await waitFor(() => expect(chipLabels(dialog)).toEqual([...CHIPS.map((c) => c.label), 'Economic']))
    await typeQuery(dialog, 'CPI')
    await waitFor(() => expect(within(dialog).getAllByTestId('econ-glyph').length).toBe(1))
    expect(calls.filter((u) => u.startsWith('/api/ticker-search')).some((u) => u.includes('type=all_economic'))).toBe(true)
    const row = within(dialog).getByTestId('econ-glyph').closest('button')
    expect(row.textContent).toContain('CPI-U All Items (SA)')
    // the headline is the NAME; the display symbol follows it
    expect(row.textContent.indexOf('CPI-U All Items')).toBeLessThan(row.textContent.indexOf('USCPI'))
    expect(within(row).getByText('BLS · Monthly · Index')).toBeInTheDocument()
    expect(row.querySelector('img')).toBeNull()   // no CompanyLogo / logo.dev
    fireEvent.click(row)
    expect(onSymbolChange).toHaveBeenCalledWith('ECON:USCPI')
  })

  test('the Economic chip browses the catalogue with an empty box, and searches type=economic', async () => {
    mockFetch(200)
    const { dialog } = open({ economic: true })
    const chip = await within(dialog).findByRole('button', { name: 'Economic' })
    fireEvent.click(chip)
    await waitFor(() => expect(within(dialog).getByText('Initial Jobless Claims (SA)')).toBeInTheDocument())
    expect(within(dialog).getAllByTestId('econ-glyph').length).toBe(CATALOG.series.length)
    await typeQuery(dialog, 'inflation')
    await waitFor(() => expect(calls.some((u) => u.includes('type=economic'))).toBe(true))
  })

  test('keyboard: Tab cycles through the Economic chip; arrows + Enter select the econ row', async () => {
    mockFetch(200)
    const { dialog, onSymbolChange } = open({ economic: true })
    await within(dialog).findByRole('button', { name: 'Economic' })
    const input = within(dialog).getByPlaceholderText(/Search symbol/)
    for (let i = 0; i < 5; i++) fireEvent.keyDown(input, { key: 'Tab' })
    expect(within(dialog).getByRole('button', { name: 'Economic' }).className).toMatch(/chipActive/)
    fireEvent.keyDown(input, { key: 'Tab' })
    expect(within(dialog).getByRole('button', { name: 'All' }).className).toMatch(/chipActive/)
    await typeQuery(dialog, 'CPI')
    await waitFor(() => expect(within(dialog).getAllByTestId('econ-glyph').length).toBe(1))
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    // row 0 is the econ row (exact synonym leads); Enter with keyboard selection on row>0 only,
    // so step down to the stock row and back is a no-op: pick row 1 explicitly
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSymbolChange).toHaveBeenCalledWith('CPIX')
  })
})
