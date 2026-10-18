// P2 Tier 3, Task 8 — the year page's rails ("Your <year> in trading").
//
//  1. Switch off: nothing is fetched and the route goes to the Journal (fix round 1, M3).
//  2. A payload in the server's shape renders all four sections, by their text. Each best-setup row
//     prints its n from `sampleN`, never `tradeCount` (trades sit in their own column); the sample
//     words are sampleSize.js's, and a too-few row also says R-T3-9's "Too few trades to rank"; ticker
//     chips open the Notebook's ticker filter and say so; the tickers section says its counts cover
//     all your notes; a lesson prints the ET day the server bucketed it on.
//  3. The not-ready, no-trades and nothing-here sentences, by text. Not-ready vs no-trades is the
//     PAYLOAD's call (`available`, `tradeCount`), never the device clock (M2).
//  4. A month with no adherence record reads "—"; a year with none says Review Focus 6's sentence.
//  6. Every heading, link and region has an accessible name, and every state carries a landing named
//     by the page's title (M1).
//  R-T3-T8-R2: the page reads the account its URL names (`_all_` = All Accounts), else the Journal pick,
//     and names it in the header.
//  M8: a year that is not a year, or one the route refuses, shows the plain sentence and no retry.
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
    { ruleId: 'r3', label: 'Edited late on New Year’s Eve', version: 2, changeNote: null,
      changedAt: '2026-01-01T01:30:00Z', changedDay: '2025-12-31' },
    { ruleId: 'r2', label: 'No adds to losers', version: 1, changeNote: null, changedAt: '2025-09-01T15:00:00Z',
      changedDay: '2025-09-01' },
    { ruleId: 'r1', label: 'Wait 30 minutes after the open', version: 3, changeNote: 'still early',
      changedAt: '2025-06-01T15:00:00Z', changedDay: '2025-06-01' },
  ],
  available: true,
}
const ACCOUNTS = [{ id: 'acct-1', name: 'Main' }, { id: 'acct-2', name: 'Roth IRA' }]

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
    if (u.startsWith('/api/j2/accounts')) return json({ accounts: ACCOUNTS })
    if (u.startsWith('/api/j2/wrapped/')) return answer(u)
    return json({})
  })
}

function renderPage(year = '2025', search = '') {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <MemoryRouter initialEntries={[`/journal-2-0/wrapped/${year}${search}`]}>
        <Routes>
          <Route path="/journal-2-0/wrapped/:year" element={<WrappedSurface />} />
          <Route path="/journal" element={<p>journal page</p>} />
          <Route path="/journal-2-0/report" element={<p>report page</p>} />
        </Routes>
      </MemoryRouter>
    </SWRConfig>,
  )
}

const wrappedCalls = () => calls.filter((u) => u.startsWith('/api/j2/wrapped'))
const landing = () => document.body.querySelector('[data-route-landing]')

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

  it('switch off: nothing is fetched and the route goes to the Journal', async () => {
    __resetNotebookFlags()
    latchNotebookFlags({ journal_tier3_enabled: false })
    renderPage()
    expect(await screen.findByText('journal page')).toBeTruthy()
    await settle()
    expect(wrappedCalls()).toEqual([])
    expect(calls.filter((u) => u.startsWith('/api/j2/accounts'))).toEqual([])   // the account read is off too
  })

  it('with no account on the URL it reads the Journal\'s pick, and names it', async () => {
    renderPage()
    await screen.findByRole('region', { name: 'Best setups' })
    expect(wrappedCalls()).toEqual(['/api/j2/wrapped/2025?account_id=acct-1'])
    expect(screen.getByTestId('wrapped-scope').textContent).toBe('Main · 63 closed trades')
  })

  it('the account the URL names wins over the Journal\'s pick (R-T3-T8-R2)', async () => {
    renderPage('2025', '?account_id=acct-2')
    await screen.findByRole('region', { name: 'Best setups' })
    expect(wrappedCalls()).toEqual(['/api/j2/wrapped/2025?account_id=acct-2'])
    expect((await screen.findByText(/^Roth IRA/)).textContent).toBe('Roth IRA · 63 closed trades')
  })

  it('`_all_` on the URL is All Accounts: no account is sent, and the header says so', async () => {
    renderPage('2025', '?account_id=_all_')
    await screen.findByRole('region', { name: 'Best setups' })
    expect(wrappedCalls()).toEqual(['/api/j2/wrapped/2025'])
    expect(screen.getByTestId('wrapped-scope').textContent).toBe('All Accounts · 63 closed trades')
  })

  it('renders all four sections, by their text', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { level: 1, name: 'Your 2025 in trading' })).toBeTruthy()

    const setups = screen.getByRole('region', { name: 'Best setups' })
    const row = (name) => within(setups).getByRole('rowheader', { name }).closest('tr')
    const vcp = row('VCP')
    expect(within(vcp).getByText('25')).toBeTruthy()                 // trades
    expect(within(vcp).getByText('+1.20R')).toBeTruthy()
    expect(within(vcp).getByText('n=25')).toBeTruthy()
    expect(vcp.textContent).not.toMatch(/thin sample|too few|Too few/)   // normal: shown plainly
    const thin = row('Breakout')
    expect(within(thin).getByText('18')).toBeTruthy()                // trades = tradeCount, own column
    expect(within(thin).getByText('n=12')).toBeTruthy()              // n = sampleN, never tradeCount
    expect(thin.textContent).not.toContain('n=18')
    expect(within(thin).getByText(WORDING.thin)).toBeTruthy()
    expect(within(thin).getByText('+0.85R')).toBeTruthy()
    expect(thin.textContent).not.toContain('Too few trades to rank')
    const few = row('EP')
    expect(within(few).getByText('n=2')).toBeTruthy()
    expect(few.textContent).not.toContain('n=30')
    expect(within(few).getByText('Too few trades to rank')).toBeTruthy()   // R-T3-9, verbatim
    const summary = within(few).getByText(WORDING.too_few)
    expect(summary.tagName).toBe('SUMMARY')                          // the number is behind the reveal
    expect(summary.closest('details').open).toBe(false)

    const tickers = screen.getByRole('region', { name: 'Most-written tickers' })
    expect(within(tickers).getByText('These counts cover all your notes, not just this account.')).toBeTruthy()
    const nvda = within(tickers).getByRole('link', { name: 'NVDA, 3 notes in 2025. Opens all your notes on NVDA' })
    expect(nvda.getAttribute('href')).toBe('/journal/notebook?view=all&ticker=NVDA')
    expect(nvda.getAttribute('title')).toBe('NVDA, 3 notes in 2025. Opens all your notes on NVDA')
    const amd = within(tickers).getByRole('link', { name: 'AMD, 1 note in 2025. Opens all your notes on AMD' })
    expect(amd.getAttribute('href')).toBe('/journal/notebook?view=all&ticker=AMD')

    const disc = screen.getByRole('region', { name: 'Discipline trend' })
    const items = within(disc).getAllByRole('listitem')
    expect(items.map((li) => li.getAttribute('data-month'))).toEqual(PAYLOAD.discipline.map((d) => d.month))
    const march = items[2]
    expect(within(march).getByText('March')).toBeTruthy()
    expect(within(march).getByText('75%')).toBeTruthy()
    expect(within(march).getByText('2 trades')).toBeTruthy()
    expect(within(items[4]).getByText('1 trade')).toBeTruthy()
    expect(within(disc).queryByText('No adherence recorded this year.')).toBeNull()   // some months have one

    const lessons = screen.getByRole('region', { name: 'Lessons you wrote into your rules' })
    expect(within(lessons).getByText('Wait 30 minutes after the open')).toBeTruthy()
    expect(within(lessons).getByText('Version 3 · 2025-06-01')).toBeTruthy()
    expect(within(lessons).getByText('still early')).toBeTruthy()
    expect(within(lessons).getByText('No adds to losers')).toBeTruthy()
    // M4: the ET day the server bucketed on, never the UTC date of the stamp.
    expect(within(lessons).getByText('Version 2 · 2025-12-31')).toBeTruthy()
    expect(lessons.textContent).not.toContain('2026-01-01')
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

  it('a year with no adherence record says so above twelve "—" months (Review Focus 6)', async () => {
    answer = () => json({ ...PAYLOAD, discipline: PAYLOAD.discipline.map((d) => ({ ...d, adherence: null })) })
    renderPage()
    const disc = await screen.findByRole('region', { name: 'Discipline trend' })
    expect(within(disc).getByText('No adherence recorded this year.')).toBeTruthy()
    const items = within(disc).getAllByRole('listitem')
    expect(items).toHaveLength(12)
    for (const li of items) expect(within(li).getByText('—')).toBeTruthy()
  })

  it('not ready comes from the payload: trades and not available, even with this clock in December', async () => {
    vi.setSystemTime(new Date('2026-12-15T16:00:00Z'))             // the device says December
    answer = () => json({ ...PAYLOAD, year: 2026, tradeCount: 40, bestSetups: [], tickers: [], discipline: [],
      lessons: [], available: false })
    renderPage('2026')
    expect(await screen.findByText('Your 2026 trading year opens on December 1.')).toBeTruthy()
    expect(screen.queryByText(/No closed trades/)).toBeNull()
    expect(screen.queryByRole('region', { name: 'Best setups' })).toBeNull()
    expect(landing().textContent).toBe('Your 2026 in trading')
  })

  it('no trades comes from the payload too: the current year before December with none says so', async () => {
    answer = () => json({ ...PAYLOAD, year: 2026, tradeCount: 0, bestSetups: [], tickers: [], discipline: [],
      lessons: [], available: false })
    renderPage('2026')
    expect(await screen.findByText('No closed trades in 2026.')).toBeTruthy()
    expect(screen.queryByText(/opens on December 1/)).toBeNull()
    expect(landing().textContent).toBe('Your 2026 in trading')
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

  it('a year that is not a year: the plain sentence, a way back, no request and no retry', async () => {
    renderPage('abc')
    expect((await screen.findByRole('alert')).textContent).toBe("That year isn't available.")
    expect(screen.getByRole('link', { name: 'Back to the Journal' }).getAttribute('href')).toBe('/journal')
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
    await settle()
    expect(wrappedCalls()).toEqual([])
    expect(landing().textContent).toBe('Your abc in trading')
  })

  it('a year the server refuses (400 or 422): the same sentence and no retry', async () => {
    for (const [status, detail] of [[400, "That year isn't available."], [422, [{ msg: 'int' }]]]) {
      answer = () => json({ detail }, status)
      const view = renderPage('1999')
      expect((await screen.findByRole('alert')).textContent).toBe("That year isn't available.")
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
      view.unmount()
    }
  })

  it('any other failure offers a retry, and the page is still announced by its title', async () => {
    answer = () => json({ detail: 'boom' }, 500)
    renderPage()
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy()
    expect(landing().textContent).toBe('Your 2025 in trading')
  })

  it('every heading, link and region has an accessible name, and the landing names the page', async () => {
    renderPage()
    await screen.findByRole('region', { name: 'Best setups' })
    expect(landing().textContent).toBe('Your 2025 in trading, four sections')
    expect(document.body.querySelectorAll('[data-route-landing]')).toHaveLength(1)
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
