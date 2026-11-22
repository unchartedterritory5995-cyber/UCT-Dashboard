// IDXC: index additions and removals. Rails:
//   * loading, a failed read (error with Retry), signed out, no paid plan (locked), a timeout and an answer not of
//     the route's shape: none is "no changes";
//   * "computing" is said and the panel asks again every 3 seconds on its own; the server's failed read offers Retry;
//   * an answered, empty list is an answer;
//   * each change: the day with its index, the stock added and the stock replaced (a followed symbol loads through
//     the kit; another is plain text) and the reason; an index whose list did not answer is named;
//   * the index chips write `IDXC NASDAQ100` back (or switch in state); one stock has its own read and no chips;
//   * dropped rows and a cut list are said; the source and read time in words; no hard-coded color; axe.
// Every symbol, name and date is invented.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import IndexChangesPanel from './IndexChangesPanel'
import { IDXC_SOURCE, idxcUrl } from './indexChangesModel'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const side = (sym, name, covered = true) => ({ sym, name, covered })
const chg = (index, date, added, removed, reason = 'Market capitalization change.') => ({ index, date, added, removed, reason })
const LEGS = { sp500: { state: 'ok', count: 2, dropped: 0 }, nasdaq100: { state: 'ok', count: 1, dropped: 0 }, dow: { state: 'not_in_plan', count: 0, dropped: 0 } }
const BODY = (over = {}) => ({ status: 'ok', index: 'all', sym: null, read_at: '2031-03-12T14:02:00+00:00', source: IDXC_SOURCE, check: null,
  indexes: LEGS, total: 3, cut: false, changes: [
    chg('sp500', '2031-03-03', side('QQZA', 'Quillfeather Mills'), side('QQZR', 'Rustbank Inc', false)),
    chg('nasdaq100', '2031-03-03', side('QQZC', 'Fernhollow'), side('QQZA', 'Quillfeather Mills')),
    chg('sp500', '2030-01-09', side('QQZB', 'Bramblecourt Foods'), null, null),
  ], ...over })
const ALL = idxcUrl({ index: 'all' })
const NASDAQ = idxcUrl({ index: 'nasdaq100' })
const ONE = idxcUrl({ index: 'all', sym: 'QQZA' })

const httpError = (status, extra = {}) => Object.assign(new Error(`http ${status}`), { status, ...extra })
const PENDING = Symbol('pending')
function serve(routes) {
  jsonFetcher.mockImplementation((u) => {
    const hit = typeof routes[u] === 'function' ? routes[u]() : routes[u]
    if (hit === undefined) return Promise.reject(httpError(500))
    if (hit === PENDING) return new Promise(() => {})
    return hit instanceof Error ? Promise.reject(hit) : Promise.resolve(hit)
  })
}
function renderPanel(props = {}, { code = null, run = vi.fn(), rerun = vi.fn(), setFreshness = vi.fn() } = {}) {
  const view = render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelFreshnessContext.Provider value={setFreshness}>
        <PanelListContext.Provider value={{ open: vi.fn(), run, rerun, publish: vi.fn(), publishRows: vi.fn() }}>
          {code ? <TerminalPanelContext.Provider value={{ code, density: 'comfortable', inset: true }}><IndexChangesPanel {...props} /></TerminalPanelContext.Provider>
            : <IndexChangesPanel {...props} />}
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>,
  )
  return { run, rerun, setFreshness, container: view.container }
}
const cells = (tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent)
const asked = () => [...new Set(jsonFetcher.mock.calls.map(([u]) => u))]

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('IDXC states', () => {
  it('a loading skeleton, and the read of all three', () => {
    serve({ [ALL]: PENDING })
    renderPanel()
    expect(screen.getByTestId('terminal-idxc-loading').textContent).toContain('Loading index changes')
    expect(asked()).toEqual([ALL])
  })

  it('a failed read is an error with Retry, never "no changes"', async () => {
    serve({})
    renderPanel()
    const err = await screen.findByTestId('terminal-idxc-error')
    expect(err.textContent).toContain('Index changes could not be read just now.')
    expect(err.textContent).toContain('That is not the same as no changes.')
    serve({ [ALL]: BODY() })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-idxc-changes')).toBeTruthy()
  })

  it('signed out, a timeout, no paid plan and an unreadable answer each say so; only an error can be retried', async () => {
    for (const [hit, kind, words] of [
      [httpError(401), 'error', 'You are signed out, so index changes cannot be read. Sign in again.'],
      [httpError(0, { timedOut: true }), 'error', 'Index changes did not answer within 30 seconds.'],
      [httpError(402), 'locked', 'Index changes needs a paid plan.'],
      [{ status: 'ok' }, 'error', 'Index changes came back in a shape this panel cannot read.'],
    ]) {
      serve({ [ALL]: hit })
      renderPanel()
      const box = await screen.findByTestId('terminal-idxc-error')
      expect(box.getAttribute('data-kind'), words).toBe(kind)
      expect(box.textContent, words).toContain(words)
      expect(!!screen.queryByRole('button', { name: 'Retry' }), words).toBe(kind === 'error')
      cleanup()
    }
  })

  it('"computing" is said, and the panel asks again every 3 seconds until it fills in', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let body = { status: 'computing', index: 'all' }
    serve({ [ALL]: () => body })
    renderPanel()
    expect((await screen.findByTestId('terminal-idxc-computing')).textContent).toContain('This panel asks again every 3 seconds')
    body = BODY()
    await act(async () => { await vi.advanceTimersByTimeAsync(3200) })
    await waitFor(() => expect(screen.getByTestId('terminal-idxc-changes')).toBeTruthy())
  })

  it('the server\'s failed read offers Retry; an answered, empty list is an answer', async () => {
    serve({ [ALL]: { status: 'failed', reason: 'source' } })
    renderPanel()
    expect((await screen.findByTestId('terminal-idxc-source')).textContent).toContain('That is not the same as no changes.')
    cleanup()
    serve({ [ALL]: BODY({ changes: [], total: 0 }) })
    renderPanel()
    expect((await screen.findByTestId('terminal-idxc-none')).textContent).toContain('No addition or removal is held for the S&P 500, the Nasdaq 100 and the Dow 30.')
  })
})

describe('IDXC the changes', () => {
  it('each change: the day and index, the stock added and replaced, the reason; an index that did not answer is named', async () => {
    serve({ [ALL]: BODY() })
    const { run, setFreshness } = renderPanel({}, { code: 'IDXC' })
    expect((await screen.findByTestId('terminal-idxc-count')).textContent).toBe('3 changes to the S&P 500, the Nasdaq 100 and the Dow 30, newest first.')
    const rows = within(screen.getByTestId('terminal-idxc-changes')).getAllByTestId('terminal-idxc-row')
    expect(cells(rows[0])).toEqual(['Mar 3, 2031S&P 500', 'Added QQZA Quillfeather MillsRemoved QQZR Rustbank IncMarket capitalization change.'])
    expect(cells(rows[2])).toEqual(['Jan 9, 2030S&P 500', 'Added QQZB Bramblecourt Foods'])
    expect(screen.getByTestId('terminal-idxc-legs').textContent).toBe('The Dow 30 list is not available from our data provider.')
    fireEvent.click(within(rows[0]).getByTestId('panel-symbol-QQZA'))
    expect(run).toHaveBeenCalledWith('$QQZA')
    expect(within(rows[0]).queryByTestId('panel-symbol-QQZR')).toBeNull()
    expect(setFreshness.mock.calls.map(([r]) => r).filter(Boolean).pop()).toMatchObject({ source: IDXC_SOURCE })
  })

  it('a cut list and dropped rows are said', async () => {
    serve({ [ALL]: BODY({ total: 900, cut: true, indexes: { ...LEGS, sp500: { state: 'ok', count: 2, dropped: 4 } } }) })
    renderPanel()
    expect((await screen.findByTestId('terminal-idxc-count')).textContent).toContain('(the newest 3 of 900)')
    expect(screen.getByTestId('terminal-idxc-dropped').textContent).toBe('4 rows in the provider\'s lists had no date or no symbol and are not shown.')
  })
})

describe('IDXC picks', () => {
  it('inside the shell the index chips write the command back', async () => {
    serve({ [ALL]: BODY() })
    const { rerun } = renderPanel({}, { code: 'IDXC' })
    await screen.findByTestId('terminal-idxc-changes')
    expect(screen.getByTestId('terminal-idxc-index-all').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByTestId('terminal-idxc-index-nasdaq100'))
    expect(rerun).toHaveBeenLastCalledWith('IDXC NASDAQ100')
    fireEvent.click(screen.getByTestId('terminal-idxc-index-sp500'))
    expect(rerun).toHaveBeenLastCalledWith('IDXC S&P500')
  })

  it('outside the shell a chip switches in state and reads that index', async () => {
    serve({ [ALL]: BODY(), [NASDAQ]: BODY({ index: 'nasdaq100', changes: [BODY().changes[1]], total: 1 }) })
    renderPanel()
    await screen.findByTestId('terminal-idxc-changes')
    fireEvent.click(screen.getByTestId('terminal-idxc-index-nasdaq100'))
    expect((await screen.findByTestId('terminal-idxc-count')).textContent).toBe('1 change to the Nasdaq 100, newest first.')
    expect(asked()).toEqual([ALL, NASDAQ])
    // one index: the day cell carries no index name
    expect(cells(within(screen.getByTestId('terminal-idxc-changes')).getAllByTestId('terminal-idxc-row')[0])[0]).toBe('Mar 3, 2031')
  })

  it('one stock: its own read, its own count line, no index chips, and a chip to all changes', async () => {
    serve({ [ONE]: BODY({ sym: 'QQZA', changes: BODY().changes.slice(0, 2), total: 2 }) })
    const { rerun } = renderPanel({ sym: 'qqza', index: 'dow' }, { code: 'IDXC' })
    expect((await screen.findByTestId('terminal-idxc-count')).textContent).toBe('QQZA: 2 changes in the S&P 500, the Nasdaq 100 and the Dow 30, newest first.')
    expect(screen.queryByTestId('terminal-idxc-index-all')).toBeNull()
    expect(screen.getByTestId('terminal-idxc-view-stock').getAttribute('aria-pressed')).toBe('true')
    expect(asked()).toEqual([ONE])
    fireEvent.click(screen.getByTestId('terminal-idxc-view-market'))
    expect(rerun).toHaveBeenLastCalledWith('QQZA IDXC MARKET')
  })

  it('IDXC MARKET on a panel that follows a stock: all changes, the index chips keep the word', async () => {
    serve({ [ALL]: BODY() })
    const { rerun } = renderPanel({ sym: 'QQZA', view: 'market' }, { code: 'IDXC' })
    await screen.findByTestId('terminal-idxc-changes')
    expect(screen.getByTestId('terminal-idxc-view-market').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByTestId('terminal-idxc-index-dow'))
    expect(rerun).toHaveBeenLastCalledWith('QQZA IDXC MARKET DOW30')
    fireEvent.click(screen.getByTestId('terminal-idxc-view-stock'))
    expect(rerun).toHaveBeenLastCalledWith('QQZA IDXC')
  })
})

describe('IDXC follows the member\'s theme', () => {
  it('the panel and its model hold no hard-coded color', () => {
    for (const f of ['IndexChangesPanel.jsx', 'indexChangesModel.js']) {
      const text = fs.readFileSync(path.join(HERE, f), 'utf8')
      expect(colourLiteralsIn(`pages/terminal/panels/${f}`, text).map((h) => h.lit), f).toEqual([])
    }
  })
})

describe('IDXC accessibility', () => {
  it('the changes, computing and a failed read pass axe (WCAG A and AA)', async () => {
    serve({ [ALL]: BODY() })
    const ok = renderPanel({}, { code: 'IDXC' })
    await screen.findByTestId('terminal-idxc-changes')
    await expectNoAxeViolations(ok.container)
    cleanup()
    serve({ [ALL]: { status: 'computing' } })
    const computing = renderPanel()
    await screen.findByTestId('terminal-idxc-computing')
    await expectNoAxeViolations(computing.container)
    cleanup()
    serve({})
    const failed = renderPanel()
    await screen.findByTestId('terminal-idxc-error')
    await expectNoAxeViolations(failed.container)
  })
})
