// P2 Tier 3, Task 9 — "Your <year> in trading" reads the server's REAL answers.
//
// Every response is a fixture recorded by tools/notebook_contract_fixtures.py from
// GET /api/j2/wrapped/{year} (`wrapped.year*`) and held current by tests/test_notebook_contract_fixtures.py.
// WrappedSurface.test.jsx drives the page on a hand-typed payload; this file proves the page reads what
// the server actually sends, asserted as rendered text. The fixture world's today is 2026-10-05 ET, so
// 2026 is not open yet, 2025 is the recorded available year and 2024 has no trades.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SWRConfig } from 'swr'

import WrappedSurface from './WrappedSurface'
import { latchNotebookFlags, __resetNotebookFlags } from '../lib/offline/notebookFlags'
import { WORDING } from '../lib/sampleSize'
import { YEAR_UNAVAILABLE } from '../lib/wrappedLink'
import { contractResponse } from '../__fixtures__/contract'

const BY_YEAR = {
  2025: 'wrapped.year',
  2026: 'wrapped.year.not-ready',
  2024: 'wrapped.year.no-trades',
  2027: 'wrapped.year.out-of-range',
}
let paid
let calls

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-05T14:30:00Z'))              // the fixture world's frozen now
  latchNotebookFlags({ journal_tier3_enabled: true })
  paid = true
  calls = []
  global.fetch = vi.fn(async (url) => {
    const u = String(url)
    calls.push(u)
    const m = u.match(/^\/api\/j2\/wrapped\/(\d{4})$/)
    if (m) return contractResponse(paid ? BY_YEAR[m[1]] : 'wrapped.year.free-plan')
    if (u.startsWith('/api/j2/accounts')) return { ok: true, status: 200, json: async () => ({ accounts: [] }) }
    throw new Error(`unexpected request ${u}`)
  })
})
afterEach(() => {
  __resetNotebookFlags()
  localStorage.clear()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function renderYear(year) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <MemoryRouter initialEntries={[`/journal-2-0/wrapped/${year}?account_id=_all_`]}>
        <Routes>
          <Route path="/journal-2-0/wrapped/:year" element={<WrappedSurface />} />
        </Routes>
      </MemoryRouter>
    </SWRConfig>,
  )
}

describe('Your <year> in trading reads the recorded GET /api/j2/wrapped/{year}', () => {
  it('an available year: the header names the scope and the closed-trade count', async () => {
    renderYear(2025)
    await screen.findByRole('region', { name: 'Best setups' })
    expect(calls.filter((u) => u.startsWith('/api/j2/wrapped'))).toEqual(['/api/j2/wrapped/2025'])
    expect(screen.getByRole('heading', { level: 1, name: 'Your 2025 in trading' })).toBeInTheDocument()
    expect(screen.getByTestId('wrapped-scope').textContent).toBe('All Accounts · 43 closed trades')
  })

  it('best setups: each row prints its n from sampleN, its trades in their own column', async () => {
    renderYear(2025)
    const setups = await screen.findByRole('region', { name: 'Best setups' })
    const row = (name) => within(setups).getByRole('rowheader', { name }).closest('tr')
    expect(within(setups).getAllByRole('rowheader').map((th) => th.textContent)).toEqual(['VCP', 'Breakout', 'EP'])

    const vcp = row('VCP')
    expect(within(vcp).getByText('26')).toBeInTheDocument()
    expect(within(vcp).getByText('+0.96R')).toBeInTheDocument()
    expect(within(vcp).getByText('n=26')).toBeInTheDocument()
    expect(vcp.textContent).not.toMatch(/thin sample|too few|Too few/)

    const breakout = row('Breakout')
    expect(within(breakout).getByText('14')).toBeInTheDocument()            // tradeCount
    expect(within(breakout).getByText('n=12')).toBeInTheDocument()          // sampleN: the R-bearing trades
    expect(breakout.textContent).not.toContain('n=14')
    expect(within(breakout).getByText(WORDING.thin)).toBeInTheDocument()
    expect(within(breakout).getByText('+0.25R')).toBeInTheDocument()

    const ep = row('EP')
    expect(within(ep).getByText('n=3')).toBeInTheDocument()
    expect(within(ep).getByText('Too few trades to rank')).toBeInTheDocument()
    expect(within(ep).getByText(WORDING.too_few).tagName).toBe('SUMMARY')  // the +4.00R is behind the reveal
  })

  it('tickers: member-wide (tickersScope "all"), each chip its symbol and the year\'s note count', async () => {
    renderYear(2025)
    const tickers = await screen.findByRole('region', { name: 'Most-written tickers' })
    expect(within(tickers).getByText('These counts cover all your notes, not just this account.')).toBeInTheDocument()
    const chips = within(tickers).getAllByRole('link').map((a) => a.getAttribute('aria-label'))
    expect(chips).toEqual([
      'NVDA, 3 notes in 2025. Opens all your notes on NVDA',
      'TSLA, 2 notes in 2025. Opens all your notes on TSLA',
      'AMD, 1 note in 2025. Opens all your notes on AMD',
    ])
  })

  it('discipline: twelve months; adherence only where the server has a record, "—" elsewhere', async () => {
    renderYear(2025)
    const disc = await screen.findByRole('region', { name: 'Discipline trend' })
    const items = within(disc).getAllByRole('listitem')
    expect(items.map((li) => within(li).getByText(/^[A-Z][a-z]+$/).textContent)).toEqual([
      'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
      'November', 'December'])
    // Final fix I2: each month's n is its adherence RECORDS (`sampleN`), never its trades. February's
    // six records are too few to judge, so its 58% is behind the reveal.
    expect(items[0].textContent).toBe('January—0 records')
    expect(items[1].textContent).toBe('Februarytoo few to judge58%6 records')
    expect(within(items[1]).getByText('too few to judge').tagName).toBe('SUMMARY')
    expect(items[2].textContent).toBe('Marchtoo few to judge90%5 records')
    expect(items[11].textContent).toBe('December—0 records')
    expect(disc.textContent).not.toMatch(/trade/)
    expect(within(disc).queryByText('No adherence recorded this year.')).not.toBeInTheDocument()
  })

  it('lessons: newest first, each with the ET day the server bucketed it on (changedDay)', async () => {
    renderYear(2025)
    const lessons = await screen.findByRole('region', { name: 'Lessons you wrote into your rules' })
    const items = within(lessons).getAllByRole('listitem').map((li) => li.textContent)
    expect(items).toEqual([
      'Wait 15 minutes after the openVersion 2 · 2025-12-31Thirty minutes was too late.',
      'No adds to losersVersion 1 · 2025-09-01',
      'Wait 30 minutes after the openVersion 1 · 2025-03-03',
    ])
    expect(lessons.textContent).not.toContain('2026-01-01')                 // never the UTC stamp's date
  })

  it('the current year before December 1 (unavailableReason not_ready)', async () => {
    renderYear(2026)
    expect(await screen.findByText('Your 2026 trading year opens on December 1.')).toBeInTheDocument()
    expect(screen.queryByText(/No closed trades/)).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Best setups' })).not.toBeInTheDocument()
  })

  it('a year with no closed trade (unavailableReason no_trades)', async () => {
    renderYear(2024)
    expect(await screen.findByText('No closed trades in 2024.')).toBeInTheDocument()
    expect(screen.queryByText(/opens on December 1/)).not.toBeInTheDocument()
  })

  it('a year the route refuses (400): the plain sentence, and no retry', async () => {
    renderYear(2027)
    expect(await screen.findByText(YEAR_UNAVAILABLE)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })

  it('a refused member (402): the load failure with Try again, never an empty year', async () => {
    paid = false
    renderYear(2025)
    expect(await screen.findByText(/Couldn’t load your trading year\./)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.queryByText(/No closed trades/)).not.toBeInTheDocument()
  })
})
