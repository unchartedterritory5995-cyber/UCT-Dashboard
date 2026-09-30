// @vitest-environment jsdom
// The phone symbol sheet's Economic category — parity with the desktop dropdown,
// DARK BY CONSTRUCTION (catalogue 404/401/403 -> the five chips, no econ row).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import MobileSymbolSheet from './MobileSymbolSheet'
import { pushRecent, listRecents } from './mobileRecents'
import { _resetEconomicForTests } from '../../../components/chart/engine/economicSeries'
import { CATALOG } from '../../../components/chart/economic/__fixtures__/econCatalog'

vi.mock('../../../components/mobile/haptics', () => ({ default: { tap: () => {} } }))
vi.mock('../../../components/CompanyLogo', () => ({ default: () => <span data-testid="logo" /> }))

let urls
function stub(catalogStatus) {
  urls = []
  globalThis.fetch = vi.fn((url) => {
    const u = String(url)
    urls.push(u)
    if (u.startsWith('/api/econ/catalog')) {
      return Promise.resolve(catalogStatus === 200
        ? { ok: true, status: 200, json: () => Promise.resolve(CATALOG) }
        : { ok: false, status: catalogStatus, json: () => Promise.resolve({}) })
    }
    if (u.includes('/api/breadth-symbols')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ symbols: [] }) })
    const econ = u.includes('economic')
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ results: econ
      ? [{ ticker: 'ECON:USCPI', symbol: 'USCPI', name: 'CPI-U All Items (SA)', type: 'economic', economic: true }]
      : [{ ticker: 'AAPL', name: 'Apple Inc.', type: 'stock' }] }) })
  })
}
const chipNames = () => screen.getAllByRole('tab').map((t) => t.textContent)

beforeEach(() => { cleanup(); _resetEconomicForTests(); try { localStorage.clear() } catch { /* */ } })

describe.each([404, 401, 403])('catalogue %i', (status) => {
  it('five chips, no type=all_economic', async () => {
    stub(status)
    render(<MobileSymbolSheet open onClose={() => {}} onPick={() => {}} economic />)
    await waitFor(() => expect(urls.some((u) => u.startsWith('/api/econ/catalog'))).toBe(true))
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(chipNames()).toEqual(['All', 'Stocks', 'ETFs', 'Indices', 'Breadth'])
    fireEvent.change(screen.getByLabelText('Search symbol'), { target: { value: 'CPI' } })
    await waitFor(() => expect(urls.some((u) => u.startsWith('/api/ticker-search'))).toBe(true))
    expect(urls.filter((u) => u.startsWith('/api/ticker-search')).every((u) => !u.includes('economic'))).toBe(true)
  })
})

describe('catalogue 200', () => {
  it('Economic chip; econ row has the glyph (no company logo) and picks ECON:USCPI', async () => {
    stub(200)
    const onPick = vi.fn()
    render(<MobileSymbolSheet open onClose={() => {}} onPick={onPick} economic />)
    await waitFor(() => expect(chipNames()).toContain('Economic'))
    fireEvent.click(screen.getByRole('tab', { name: 'Economic' }))
    await waitFor(() => expect(screen.getAllByTestId('econ-glyph').length).toBe(CATALOG.series.length))
    expect(screen.queryAllByTestId('logo')).toHaveLength(0)
    fireEvent.change(screen.getByLabelText('Search symbol'), { target: { value: 'CPI' } })
    await waitFor(() => expect(urls.some((u) => u.includes('type=economic'))).toBe(true))
    const name = await screen.findByText('CPI-U All Items (SA)')
    fireEvent.click(name.closest('button'))
    expect(onPick).toHaveBeenCalledWith('ECON:USCPI')
  })

  it('a host that did not opt in never asks for the catalogue', async () => {
    stub(200)
    render(<MobileSymbolSheet open onClose={() => {}} onPick={() => {}} />)
    await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
    expect(urls.some((u) => u.startsWith('/api/econ'))).toBe(false)
  })
})

it('recents never hold an economic series (no logo fetch for a non-ticker)', () => {
  pushRecent('AAPL')
  pushRecent('ECON:USCPI')
  expect(listRecents()).toEqual(['AAPL'])
})
