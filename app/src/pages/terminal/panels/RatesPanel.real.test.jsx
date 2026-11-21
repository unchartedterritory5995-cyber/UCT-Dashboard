// RATES, the real yield block on the panel. Rails:
//   * real yields (TIPS) and the breakevens are their own block under the nominal yields, with
//     their own date and source on screen, and the breakevens' own date when it differs;
//   * a real yield, a nominal yield or a breakeven that is missing is words, never 0;
//   * the block being read, refused, unreadable or failed is a sentence in the block: the nominal
//     table above it still stands, there is no real table, and nothing is drawn as zeros;
//   * a look for newer real yields that did not go well is said above the last good ones, with
//     their date; an old real figure is said out loud;
//   * while the block is being read the panel asks again every 3 seconds, on its own;
//   * a server that sends no block draws none; no price color; the nominal column folds on a phone; axe.
// Every figure is invented.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
vi.mock('../../calendar/earningsModalRow', async (orig) => ({ ...(await orig()), todayIso: () => '2026-11-18' }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext } from '../../../components/terminal'
import RatesPanel, { RATES_URL, SOURCE } from './RatesPanel'
import { REAL_SOURCE } from './ratesModel'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const H = (d1, w1, m1, m3, y1) => ({ d1, w1, m1, m3, y1 })
const nom = (key, label, months, y) => ({ key, label, months, yield: y, was: H(null, null, null, null, null), change_bp: H(1, 2, 3, 4, 5) })
const mat = (key, label, months, y, d1 = null, w1 = null) => (
  { key, label, months, yield: y, was: { d1: null, w1: null }, change_bp: { d1, w1 } })
const be = (key, nominal, real, value, date = '2026-11-17') => ({ key, label: key, months: 1, date, nominal, real, value })
const REAL = (over = {}) => ({
  status: 'ok', as_of: '2026-11-17', ref_dates: { d1: '2026-11-16', w1: '2026-11-10' },
  maturities: [
    mat('5y', '5-year', 60, 1.21, -4, 10), mat('7y', '7-year', 84, 1.43, 0, 2.5), mat('10y', '10-year', 120, 1.64, 4, 14),
    mat('20y', '20-year', 240, 2.02, 1, null), mat('30y', '30-year', 360, null),
  ],
  breakevens: { as_of: '2026-11-17', rows: [be('5y', 3.85, 1.21, 2.64), be('7y', 3.99, 1.43, 2.56), be('10y', 4.12, 1.64, 2.48),
    be('20y', null, 2.02, null), be('30y', 4.61, null, null)] },
  rows: 7, read_at: '2026-11-17T23:21:10+00:00', basis: 'end_of_day', source: REAL_SOURCE, check: null, ...over,
})
const answer = (real, over = {}) => ({
  status: 'ok', as_of: '2026-11-17', ref_dates: H('2026-11-16', '2026-11-10', null, null, null),
  maturities: [nom('2y', '2-year', 24, 3.7), nom('10y', '10-year', 120, 4.12), nom('30y', '30-year', 360, 4.61)],
  spreads: [], history: { dates: [] }, rows: 40, read_at: '2026-11-17T23:20:04+00:00', basis: 'end_of_day', source: SOURCE, check: null,
  ...(real === undefined ? {} : { real }), ...over,
})

function serve(body) {
  jsonFetcher.mockImplementation((u) => (u === RATES_URL ? Promise.resolve(typeof body === 'function' ? body() : body) : Promise.reject(new Error('500'))))
}
function renderPanel() {
  const view = render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelFreshnessContext.Provider value={vi.fn()}>
        <PanelListContext.Provider value={{ open: vi.fn(), run: vi.fn(), rerun: vi.fn(), publish: vi.fn(), publishRows: vi.fn() }}>
          <RatesPanel />
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>,
  )
  return view.container
}
const block = () => screen.getByTestId('terminal-rates-real')
const realRows = () => screen.getAllByTestId('terminal-rates-real-row')
const cells = (key) => [...realRows().find((r) => r.getAttribute('data-key') === key).children].map((c) => c.textContent)

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('RATES real yields and breakevens', () => {
  it('is its own block under the nominal yields, with its own date and source on screen', async () => {
    serve(answer(REAL()))
    renderPanel()
    await screen.findByTestId('terminal-rates-real-table')
    expect(block().getAttribute('data-state')).toBe('ok')
    expect(screen.getByRole('heading', { name: 'Real yields and breakevens' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Real yields and breakevens' })).toBe(block())
    expect(screen.getByTestId('terminal-rates-real-asof').textContent).toBe(
      'End-of-day real yields for Nov 17, 2026: what Treasury inflation-protected securities yield above inflation. '
      + 'Source: US Treasury daily par real yield curve.',
    )
    expect(screen.getByTestId('terminal-rates-breakeven-asof').textContent).toContain('Breakevens are for Nov 17, 2026: the nominal yield minus the real yield')
    // the nominal table is still there, above it, with its own date
    const nominal = screen.getByTestId('terminal-rates-table')
    expect(nominal.compareDocumentPosition(block()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByTestId('terminal-rates-asof').textContent).toContain('End-of-day yields for Nov 17, 2026')
  })

  it('the table: each maturity, its real yield, its changes in basis points, the nominal yield and the breakeven', async () => {
    serve(answer(REAL()))
    renderPanel()
    const table = await screen.findByTestId('terminal-rates-real-table')
    expect([...table.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual(['Maturity', 'Real yield', '1 day', '1 week', 'Nominal', 'Breakeven'])
    expect(table.getAttribute('aria-label')).toBe('Real Treasury yields by maturity for Nov 17, 2026, with the breakeven at each maturity for Nov 17, 2026')
    expect(realRows().map((r) => r.getAttribute('data-key'))).toEqual(['5y', '7y', '10y', '20y', '30y'])
    expect(cells('10y')).toEqual(['10-year', '1.64%', '+4', '+14', '4.12%', '2.48%'])
    expect(cells('5y')).toEqual(['5-year', '1.21%', '-4', '+10', '3.85%', '2.64%'])
    expect(cells('7y')).toEqual(['7-year', '1.43%', '0', '+2.5', '3.99%', '2.56%'])
    const heads = [...table.querySelectorAll('thead th')]
    expect(heads[2].getAttribute('title')).toBe('Change in basis points against Nov 16, 2026')
    expect(heads[5].getAttribute('title')).toBe('The nominal yield minus the real yield on Nov 17, 2026, in percent')
  })

  it('a missing real yield, nominal yield or breakeven is words, never 0', async () => {
    serve(answer(REAL()))
    renderPanel()
    await screen.findByTestId('terminal-rates-real-table')
    expect(cells('20y')).toEqual(['20-year', '2.02%', '+1', 'n/a', 'No figure', 'No figure'])
    expect(cells('30y')).toEqual(['30-year', 'No figure', 'n/a', 'n/a', '4.61%', 'No figure'])
    expect(screen.getByTestId('terminal-rates-real-table').textContent).not.toMatch(/(^|[^.\d])0(\.0+)?%/)
  })

  it('the breakevens say their own date when the real curve is a day ahead of the nominal one', async () => {
    const rows = REAL().breakevens.rows.map((r) => ({ ...r, date: '2026-11-16' }))
    serve(answer(REAL({ breakevens: { as_of: '2026-11-16', rows } })))
    renderPanel()
    const table = await screen.findByTestId('terminal-rates-real-table')
    expect(screen.getByTestId('terminal-rates-real-asof').textContent).toContain('real yields for Nov 17, 2026')
    expect(screen.getByTestId('terminal-rates-breakeven-asof').textContent).toContain('Breakevens are for Nov 16, 2026, the newest day both curves have a figure')
    expect(table.getAttribute('aria-label')).toContain('with the breakeven at each maturity for Nov 16, 2026')
    expect([...table.querySelectorAll('thead th')][4].getAttribute('title')).toBe('The nominal Treasury yield on Nov 16, 2026, in percent')
  })

  it('with no day in common every breakeven is words and the reason is said', async () => {
    serve(answer(REAL({ breakevens: { as_of: null, rows: REAL().breakevens.rows.map((r) => ({ ...r, date: null, nominal: null, real: null, value: null })) } })))
    renderPanel()
    await screen.findByTestId('terminal-rates-real-table')
    expect(cells('10y')).toEqual(['10-year', '1.64%', '+4', '+14', 'No figure', 'No figure'])
    expect(screen.getByTestId('terminal-rates-breakeven-asof').textContent).toBe(
      'No breakeven can be worked out: the two curves have no day in common in what the site holds.',
    )
  })

  it('a refused, unreadable or failed real curve is a sentence in the block: no real table, no zeros, and the nominal yields stand', async () => {
    for (const [real, state, words] of [
      [{ status: 'unavailable', reason: 'refused', http_status: 403 }, 'unavailable', "the Treasury's website refused the server's request (it answered 403)"],
      [{ status: 'unavailable', reason: 'shape', http_status: 200 }, 'unavailable', 'answered, but not with figures this screen can read'],
      [{ status: 'failed', reason: 'timeout', http_status: null }, 'failed', 'Real yields and breakevens could not be read just now.'],
      [{ status: 'ok', as_of: '2026-11-17', maturities: [] }, 'failed', 'Real yields and breakevens could not be read just now.'],
    ]) {
      serve(answer(real))
      renderPanel()
      const missing = await screen.findByTestId('terminal-rates-real-missing')
      expect(block().getAttribute('data-state')).toBe(state)
      expect(missing.getAttribute('role')).toBe('status')
      expect(missing.textContent).toContain(words)
      expect(missing.textContent).toContain('That is not the same as no figures.')
      expect(screen.queryByTestId('terminal-rates-real-table')).toBeNull()
      expect(screen.queryByTestId('terminal-rates-real-row')).toBeNull()
      expect(block().textContent).not.toMatch(/\d%/)
      expect(screen.getAllByTestId('terminal-rates-row')).toHaveLength(3)
      expect(screen.getByTestId('terminal-rates').getAttribute('data-state')).toBe('ok')
      cleanup()
    }
  })

  it('a look for newer real yields that did not go well is said above the last good ones, with their date', async () => {
    serve(answer(REAL({ as_of: '2026-11-16', check: { state: 'unavailable', reason: 'refused', http_status: 403, at: '2026-11-17T23:20:00+00:00' } })))
    renderPanel()
    const note = await screen.findByTestId('terminal-rates-real-check')
    expect(note.textContent).toBe(
      "The Treasury's website refused the last look for newer real yields (it answered 403). These are the last real yields the site read, for Nov 16, 2026.",
    )
    expect(note.getAttribute('role')).toBe('status')
    expect(realRows()).toHaveLength(5)
    expect(screen.queryByTestId('terminal-rates-real-old')).toBeNull()
  })

  it('a newest real figure more than a few days old is said out loud; a fresh one is not', async () => {
    serve(answer(REAL({ as_of: '2026-11-10' })))
    renderPanel()
    expect((await screen.findByTestId('terminal-rates-real-old')).textContent).toBe(
      'The newest real yield the site has from the Treasury is 8 days old (Nov 10, 2026).',
    )
    cleanup()
    serve(answer(REAL()))
    renderPanel()
    await screen.findByTestId('terminal-rates-real-table')
    expect(screen.queryByTestId('terminal-rates-real-old')).toBeNull()
    expect(screen.queryByTestId('terminal-rates-real-check')).toBeNull()
  })

  it('while the real curve is being read the block says so and the panel asks again on its own', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let n = 0
    serve(() => { n += 1; return answer(n < 2 ? { status: 'computing' } : REAL()) })
    renderPanel()
    const missing = await screen.findByTestId('terminal-rates-real-missing')
    expect(missing.textContent).toBe("Real yields are being read from the Treasury's website. This part fills in on its own.")
    expect(block().getAttribute('data-state')).toBe('computing')
    expect(screen.getAllByTestId('terminal-rates-row')).toHaveLength(3)
    await act(async () => { await vi.advanceTimersByTimeAsync(3200) })
    await waitFor(() => expect(screen.getByTestId('terminal-rates-real-table')).toBeTruthy())
    expect(n).toBe(2)
    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    expect(n).toBe(2)                                   // held: back to the slow pace
  })

  it('a server that sends no real block draws none, and the rest of the panel is as it was', async () => {
    serve(answer(undefined))
    renderPanel()
    await screen.findByTestId('terminal-rates-table')
    expect(screen.queryByTestId('terminal-rates-real')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Real yields and breakevens' })).toBeNull()
  })

  it('wears no price color, folds only the nominal column on a phone, and has no axe violations in each state', async () => {
    serve(answer(REAL()))
    const ok = renderPanel()
    const table = await screen.findByTestId('terminal-rates-real-table')
    for (const el of table.querySelectorAll('th, td')) expect(el.className).not.toMatch(/up|down|gain|loss/i)
    expect([...table.querySelectorAll('thead th')].map((th) => /phoneHide/.test(th.className))).toEqual([false, false, false, false, true, false])
    for (const tr of realRows()) expect([...tr.children].map((c) => /phoneHide/.test(c.className))).toEqual([false, false, false, false, true, false])
    await expectNoAxeViolations(ok)
    cleanup()
    serve(answer({ status: 'unavailable', reason: 'refused', http_status: 403 }))
    const refused = renderPanel()
    await screen.findByTestId('terminal-rates-real-missing')
    await expectNoAxeViolations(refused)
  })

  it('the breakeven is never worked out in the browser', () => {
    for (const file of ['RatesPanel.jsx', 'ratesModel.js']) {
      const src = fs.readFileSync(path.join(HERE, file), 'utf8')
      expect(src, file).not.toMatch(/nominal\s*-\s*\w*real|\.nominal\s*-|-\s*\w+\.real\b/)
    }
  })
})
