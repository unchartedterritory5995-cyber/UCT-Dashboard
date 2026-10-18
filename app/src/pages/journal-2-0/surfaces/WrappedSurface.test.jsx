// P2 Tier 3, Task 8 — the year page's rails ("Your <year> in trading").
//
//  1. Switch off: nothing is fetched and the route goes back to the Report page (the My Playbook
//     precedent; ruling R-T3-V6).
//  2. A payload in the server's shape renders all four sections, by their text. Each best-setup row
//     prints its n from `sampleN`, never `tradeCount` (trades sit in their own column); the sample
//     words are sampleSize.js's; ticker chips open the Notebook's ticker filter; the tickers section
//     says its counts cover all your notes.
//  3. The not-ready, no-trades and nothing-here sentences, by text.
//  4. A month with no adherence record reads "—".
//  6. Every heading, link and region has an accessible name.
//
// The payload keys are the server's (tests/test_wrapped.py pins the same set on the route).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within, act } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { computeAccessibleName } from 'dom-accessibility-api'
import WrappedSurface from './WrappedSurface'
import { latchNotebookFlags, __resetNotebookFlags } from '../lib/offline/notebookFlags'
import { WORDING } from '../lib/sampleSize'

const month = (m, adherence, tradeCount) => ({ month: `2025-${String(m).padStart(2, '0')}`, adherence, tradeCount })
const PAYLOAD = {
  year: 2025,
  tradeCount: 63,
  bestSetups: [
    { setup: 'VCP', tradeCount: 25, expectancyR: 1.2, sample: 'normal', sampleN: 25 },
    { setup: 'Breakout', tradeCount: 18, expectancyR: 0.85, sample: 'thin', sampleN: 12 },
    { setup: 'EP', tradeCount: 30, expectancyR: 4, sample: 'too_few', sampleN: 2 },
  ],
  tickers: [{ symbol: 'NVDA', noteCount: 3 }, { symbol: 'AMD', noteCount: 1 }],
  tickersScope: 'all',
  discipline: [
    month(1, null, 0), month(2, 0.5, 4), month(3, 0.75, 2), month(4, null, 3), month(5, 1, 1), month(6, null, 0),
    month(7, null, 0), month(8, null, 0), month(9, null, 0), month(10, null, 0), month(11, null, 0), month(12, 0.9, 5),
  ],
  lessons: [
    { ruleId: 'r2', label: 'No adds to losers', version: 1, changeNote: null, changedAt: '2025-09-01T15:00:00Z' },
    { ruleId: 'r1', label: 'Wait 30 minutes after the open', version: 3, changeNote: 'still early',
      changedAt: '2025-06-01T15:00:00Z' },
  ],
  available: true,
}

const json = (body, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) })
const settle = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })

let calls
let answer
function installFetch() {
  calls = []
  global.fetch = vi.fn((url) => {
    const u = String(url)
    calls.push(u)
    if (u.startsWith('/api/j2/accounts')) return json({ accounts: [{ id: 'acct-1', name: 'Main' }] })
    if (u.startsWith('/api/j2/wrapped/')) return answer(u)
    return json({})
  })
}

function renderPage(year = '2025') {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <MemoryRouter initialEntries={[`/journal-2-0/wrapped/${year}`]}>
        <Routes>
          <Route path="/journal-2-0/wrapped/:year" element={<WrappedSurface />} />
          <Route path="/journal-2-0/report" element={<p>report page</p>} />
        </Routes>
      </MemoryRouter>
    </SWRConfig>,
  )
}

const wrappedCalls = () => calls.filter((u) => u.startsWith('/api/j2/wrapped'))

describe('Your <year> in trading (P2 Tier 3, Task 8)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-17T16:00:00Z'))         // mid-October 2026, ET
    localStorage.setItem('uct.j2.selectedAccountId', 'acct-1')
    latchNotebookFlags({ journal_tier3_enabled: true })
    answer = () => json(PAYLOAD)
    installFetch()
  })
  afterEach(() => {
    __resetNotebookFlags()
    localStorage.clear()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('switch off: nothing is fetched and the route goes back to the Report page', async () => {
    __resetNotebookFlags()
    latchNotebookFlags({ journal_tier3_enabled: false })
    renderPage()
    expect(await screen.findByText('report page')).toBeTruthy()
    await settle()
    expect(wrappedCalls()).toEqual([])
    expect(calls.filter((u) => u.startsWith('/api/j2/accounts'))).toEqual([])   // the account read is off too
  })

  it('reads the year for the Journal\'s picked account', async () => {
    renderPage()
    await screen.findByRole('region', { name: 'Best setups' })
    expect(wrappedCalls()).toEqual(['/api/j2/wrapped/2025?account_id=acct-1'])
  })

  it('renders all four sections, by their text', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { level: 1, name: 'Your 2025 in trading' })).toBeTruthy()
    expect(screen.getByText('63 closed trades')).toBeTruthy()

    const setups = screen.getByRole('region', { name: 'Best setups' })
    const row = (name) => within(setups).getByRole('rowheader', { name }).closest('tr')
    const vcp = row('VCP')
    expect(within(vcp).getByText('25')).toBeTruthy()                 // trades
    expect(within(vcp).getByText('+1.20R')).toBeTruthy()
    expect(within(vcp).getByText('n=25')).toBeTruthy()
    expect(vcp.textContent).not.toMatch(/thin sample|too few/)       // normal: shown plainly
    const thin = row('Breakout')
    expect(within(thin).getByText('18')).toBeTruthy()                // trades = tradeCount, own column
    expect(within(thin).getByText('n=12')).toBeTruthy()              // n = sampleN, never tradeCount
    expect(thin.textContent).not.toContain('n=18')
    expect(within(thin).getByText(WORDING.thin)).toBeTruthy()
    expect(within(thin).getByText('+0.85R')).toBeTruthy()
    const few = row('EP')
    expect(within(few).getByText('n=2')).toBeTruthy()
    expect(few.textContent).not.toContain('n=30')
    const summary = within(few).getByText(WORDING.too_few)
    expect(summary.tagName).toBe('SUMMARY')                          // the number is behind the reveal
    expect(summary.closest('details').open).toBe(false)

    const tickers = screen.getByRole('region', { name: 'Most-written tickers' })
    expect(within(tickers).getByText('These counts cover all your notes, not just this account.')).toBeTruthy()
    const nvda = within(tickers).getByRole('link', { name: 'NVDA, 3 notes, open in the Notebook' })
    expect(nvda.getAttribute('href')).toBe('/journal/notebook?view=all&ticker=NVDA')
    const amd = within(tickers).getByRole('link', { name: 'AMD, 1 note, open in the Notebook' })
    expect(amd.getAttribute('href')).toBe('/journal/notebook?view=all&ticker=AMD')

    const disc = screen.getByRole('region', { name: 'Discipline trend' })
    const items = within(disc).getAllByRole('listitem')
    expect(items.map((li) => li.getAttribute('data-month'))).toEqual(PAYLOAD.discipline.map((d) => d.month))
    const march = items[2]
    expect(within(march).getByText('March')).toBeTruthy()
    expect(within(march).getByText('75%')).toBeTruthy()
    expect(within(march).getByText('2 trades')).toBeTruthy()
    expect(within(items[4]).getByText('1 trade')).toBeTruthy()

    const lessons = screen.getByRole('region', { name: 'Lessons you wrote into your rules' })
    expect(within(lessons).getByText('Wait 30 minutes after the open')).toBeTruthy()
    expect(within(lessons).getByText('Version 3 · 2025-06-01')).toBeTruthy()
    expect(within(lessons).getByText('still early')).toBeTruthy()
    expect(within(lessons).getByText('No adds to losers')).toBeTruthy()
  })

  it('a month with no adherence record reads "—", with its trade count', async () => {
    renderPage()
    const disc = await screen.findByRole('region', { name: 'Discipline trend' })
    const april = within(disc).getAllByRole('listitem')[3]
    expect(april.getAttribute('data-month')).toBe('2025-04')
    expect(within(april).getByText('—')).toBeTruthy()
    expect(within(april).getByText('3 trades')).toBeTruthy()
    expect(april.textContent).not.toContain('0%')                    // None is never 0
  })

  it('the current year before December 1: the not-ready sentence', async () => {
    answer = () => json({ ...PAYLOAD, year: 2026, tradeCount: 4, bestSetups: [], tickers: [], discipline: [],
      lessons: [], available: false })
    renderPage('2026')
    expect(await screen.findByText('Your 2026 trading year opens on December 1.')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Best setups' })).toBeNull()
  })

  it('a year with no closed trade: the no-trades sentence', async () => {
    answer = () => json({ ...PAYLOAD, tradeCount: 0, bestSetups: [], tickers: [], discipline: [], lessons: [],
      available: false })
    renderPage()
    expect(await screen.findByText('No closed trades in 2025.')).toBeTruthy()
    expect(screen.queryByText(/opens on December 1/)).toBeNull()
  })

  it('a section with nothing says so, and the others still render', async () => {
    answer = () => json({ ...PAYLOAD, tickers: [], lessons: [] })
    renderPage()
    const tickers = await screen.findByRole('region', { name: 'Most-written tickers' })
    expect(within(tickers).getByText('Nothing here yet.')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Lessons you wrote into your rules' }))
      .getByText('Nothing here yet.')).toBeTruthy()
    expect(within(screen.getByRole('region', { name: 'Best setups' })).queryByText('Nothing here yet.')).toBeNull()
  })

  it('a year the server refuses shows the server\'s own sentence', async () => {
    answer = () => json({ detail: "That year isn't available." }, 400)
    renderPage('1999')
    expect((await screen.findByRole('alert')).textContent).toBe("That year isn't available.")
  })

  it('every heading, link and region has an accessible name', async () => {
    renderPage()
    await screen.findByRole('region', { name: 'Best setups' })
    const headings = screen.getAllByRole('heading')
    const links = screen.getAllByRole('link')
    const regions = screen.getAllByRole('region')
    expect(headings.length).toBeGreaterThan(0)                       // non-vacuity
    expect(links.length).toBeGreaterThanOrEqual(3)                   // back + two chips
    expect(regions.length).toBe(5)                                   // the page and its four sections
    for (const el of [...headings, ...links, ...regions]) {
      expect(computeAccessibleName(el).trim(), el.outerHTML.slice(0, 80)).not.toBe('')
    }
  })
})
