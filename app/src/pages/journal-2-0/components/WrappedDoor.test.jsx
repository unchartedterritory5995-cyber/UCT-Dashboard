// P2 Tier 3, Task 8 — the Report page's door to "Your <year> in trading" (ruling R-T3-V6).
//
//  1. Switch off: no door, and nothing is fetched.
//  5. The current year's door shows from December 1 ET and not in October (the clock is pinned),
//     and the earlier-years picker comes from GET /api/j2/wrapped/years for the report's account.
//  6. Every link has an accessible name, and the picker is labelled.
//  R-T3-T8-R2: every link carries the account the report shows (`_all_` for All Accounts), and the
//     page it opens reads THAT account, not the Journal's stored pick.
//
// The door is mounted through the REAL Report page, so a door that is built but never placed reds.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { computeAccessibleName } from 'dom-accessibility-api'
import ReportPage from './ReportPage'
import WrappedSurface from '../surfaces/WrappedSurface'
import { latchNotebookFlags, __resetNotebookFlags } from '../lib/offline/notebookFlags'

const ANALYTICS = { tradeCount: 0 }
const json = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
const settle = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })

let calls
let years
function installFetch() {
  calls = []
  global.fetch = vi.fn((url) => {
    const u = String(url)
    calls.push(u)
    if (u.startsWith('/api/j2/analytics')) return json(ANALYTICS)
    if (u.startsWith('/api/j2/accounts')) return json({ accounts: [{ id: 'acct-1', name: 'Main' }] })
    if (u.startsWith('/api/j2/wrapped/years')) return json({ years })
    if (u.startsWith('/api/j2/wrapped/')) return json({ year: 2025, tradeCount: 0, bestSetups: [], tickers: [],
      tickersScope: 'all', discipline: [], lessons: [], available: false, unavailableReason: 'no_trades' })
    return json({})
  })
}

function renderReport(search = '?account_id=acct-1&period=ytd', page = <p>wrapped page</p>) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <MemoryRouter initialEntries={[`/journal-2-0/report${search}`]}>
        <Routes>
          <Route path="/journal-2-0/report" element={<ReportPage />} />
          <Route path="/journal-2-0/wrapped/:year" element={page} />
        </Routes>
      </MemoryRouter>
    </SWRConfig>,
  )
}

const pin = (iso) => vi.setSystemTime(new Date(iso))
const yearsCalls = () => calls.filter((u) => u.startsWith('/api/j2/wrapped'))

describe('the Report page door to Your <year> in trading', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    latchNotebookFlags({ journal_tier3_enabled: true })
    years = [2026, 2025, 2023]
    installFetch()
  })
  afterEach(() => {
    __resetNotebookFlags()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('switch off: no door, and nothing is fetched', async () => {
    __resetNotebookFlags()
    latchNotebookFlags({ journal_tier3_enabled: false })
    pin('2026-12-15T16:00:00Z')
    renderReport()
    expect(await screen.findByRole('heading', { name: 'Trading Report' })).toBeTruthy()
    await settle()
    expect(screen.queryByRole('navigation', { name: 'Your trading year' })).toBeNull()
    expect(screen.queryByText(/in trading/)).toBeNull()
    expect(yearsCalls()).toEqual([])
  })

  it('in December the current year has a door, beside the earlier years', async () => {
    pin('2026-12-01T16:00:00Z')                                     // December 1, ET
    renderReport()
    const door = await screen.findByRole('navigation', { name: 'Your trading year' })
    const current = within(door).getByRole('link', { name: 'Your 2026 in trading' })
    expect(current.getAttribute('href')).toBe('/journal-2-0/wrapped/2026?account_id=acct-1')
    const picker = await within(door).findByRole('combobox', { name: 'Earlier years' })
    expect([...picker.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['2025', '2023'])
    expect(yearsCalls()).toEqual(['/api/j2/wrapped/years?account_id=acct-1'])
  })

  it('in October the current year has no door, and the earlier years still do', async () => {
    pin('2026-10-17T16:00:00Z')
    renderReport()
    const door = await screen.findByRole('navigation', { name: 'Your trading year' })
    await within(door).findByRole('combobox', { name: 'Earlier years' })
    expect(within(door).queryByRole('link', { name: 'Your 2026 in trading' })).toBeNull()
    expect(door.textContent).not.toContain('2026')                  // the picker lists earlier years only
    const open = within(door).getByRole('link', { name: 'Your 2025 in trading' })
    expect(open.getAttribute('href')).toBe('/journal-2-0/wrapped/2025?account_id=acct-1')
  })

  it('November 30 at 11 pm ET is still not December', async () => {
    pin('2026-12-01T04:00:00Z')                                     // 23:00 ET on November 30
    renderReport()
    await screen.findByRole('navigation', { name: 'Your trading year' })
    expect(screen.queryByRole('link', { name: 'Your 2026 in trading' })).toBeNull()
  })

  it('picking a year moves the link, and the link opens that year', async () => {
    pin('2026-10-17T16:00:00Z')
    renderReport()
    const picker = await screen.findByRole('combobox', { name: 'Earlier years' })
    await userEvent.selectOptions(picker, '2023')
    const open = screen.getByRole('link', { name: 'Your 2023 in trading' })
    expect(open.getAttribute('href')).toBe('/journal-2-0/wrapped/2023?account_id=acct-1')
    await userEvent.click(open)
    expect(await screen.findByText('wrapped page')).toBeTruthy()
  })

  it('no earlier year and not yet December: no door at all', async () => {
    years = [2026]
    pin('2026-10-17T16:00:00Z')
    renderReport('')
    await screen.findByRole('heading', { name: 'Trading Report' })
    await settle()
    expect(yearsCalls()).toEqual(['/api/j2/wrapped/years'])        // All Accounts: no account_id
    expect(screen.queryByRole('navigation', { name: 'Your trading year' })).toBeNull()
  })

  it('an All Accounts report writes `_all_` on every link', async () => {
    years = [2026, 2025]
    pin('2026-12-15T16:00:00Z')
    renderReport('?period=ytd')
    const door = await screen.findByRole('navigation', { name: 'Your trading year' })
    await within(door).findByRole('combobox', { name: 'Earlier years' })
    expect(within(door).getByRole('link', { name: 'Your 2026 in trading' }).getAttribute('href'))
      .toBe('/journal-2-0/wrapped/2026?account_id=_all_')
    expect(within(door).getByRole('link', { name: 'Your 2025 in trading' }).getAttribute('href'))
      .toBe('/journal-2-0/wrapped/2025?account_id=_all_')
  })

  it('door to page: an acct-2 report opens the page on acct-2 while the Journal pick is acct-1', async () => {
    localStorage.setItem('uct.j2.selectedAccountId', 'acct-1')
    years = [2026, 2025]
    pin('2026-10-17T16:00:00Z')
    renderReport('?account_id=acct-2&period=ytd', <WrappedSurface />)
    const open = await screen.findByRole('link', { name: 'Your 2025 in trading' })
    expect(yearsCalls()).toEqual(['/api/j2/wrapped/years?account_id=acct-2'])
    await userEvent.click(open)
    expect(await screen.findByRole('heading', { level: 1, name: 'Your 2025 in trading' })).toBeTruthy()
    await screen.findByText('No closed trades in 2025.')
    expect(yearsCalls().filter((u) => !u.includes('/years'))).toEqual(['/api/j2/wrapped/2025?account_id=acct-2'])
    localStorage.clear()
  })

  it('every link has an accessible name, and the picker is labelled', async () => {
    pin('2026-12-15T16:00:00Z')
    renderReport()
    const door = await screen.findByRole('navigation', { name: 'Your trading year' })
    await within(door).findByRole('combobox', { name: 'Earlier years' })
    const links = within(door).getAllByRole('link')
    expect(links.length).toBe(2)                                    // non-vacuity: current + earlier
    for (const el of [...links, within(door).getByRole('combobox')]) {
      expect(computeAccessibleName(el).trim()).not.toBe('')
    }
  })
})
