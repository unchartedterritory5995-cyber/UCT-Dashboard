// LEAD: the long-run leader lists. Rails:
//   * the pure half (longRunModel.js): lens words, URLs, the write-back command, rows per kind;
//   * one read per lens, and the columns change with it (gain / volume record / first traded);
//   * a chip switches the lens, reads that lens's route and writes the lens into the command;
//   * loading, building ("computing"), empty and populated are four different states;
//   * a failed read is an error with Retry, never an empty list; 402 and 404 have no Retry;
//   * the as-of is the route's own `as_of`, and its coverage receipt is drawn when sent.
// Fixtures are the shapes api/services/scan_gainers.py, scan_volume.py and scan_ipo.py return.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { SWRConfig } from 'swr'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import LongRunPanel, {
  DEFAULT_LENS, LONG_RUN_LENSES, LONG_RUN_LENS_KEYS, LONG_RUN_ROUTES, MAX_ROWS, defaultLongRunSort, listedDate, longRunCell,
  longRunColumns, longRunCommand, longRunMethod, longRunRows, longRunUrl, longRunView, parseLongRunLens,
} from './LongRunPanel'
import * as model from './longRunModel'

const GAINERS = {
  status: 'ok', count: 3, as_of: '2026-11-13T14:31:07.120000-05:00',
  results: [
    { sym: 'AAA', change_nd: 142.36, ref_close: 10, price: 24.24, prev_close: 23, change_pct: 5.39 },
    { sym: 'BBB', change_nd: 88.1, ref_close: 50, price: 94.05, prev_close: 95, change_pct: -1 },
    { sym: 'CCC', change_nd: 61.02, ref_close: 4, price: 6.44, prev_close: null, change_pct: null },
  ],
}
const VOLUME = {
  status: 'ok', count: 2, as_of: '2026-11-13T11:02:00-05:00',
  results: [
    { sym: 'DDD', volume: 48_500_000, ref_max: 20_000_000, ratio: 2.43, price: 31.5, prev_close: 25, change_pct: 26 },
    { sym: 'EEE', volume: 1_250_000, ref_max: 1_000_000, ratio: 1.25, price: 8.1, prev_close: 8.5, change_pct: -4.71 },
  ],
}
const IPOS = {
  status: 'ok', count: 2, as_of: '2026-11-13T10:00:00-05:00',
  results: [
    { sym: 'FFF', ipo_date: 20261104, price: 41.2, prev_close: 40, change_pct: 3 },
    { sym: 'GGG', ipo_date: 20260212, price: 12, prev_close: 12.5, change_pct: -4 },
  ],
}
const BUILDING = { status: 'computing', results: [], count: 0, as_of: null }
const COVERAGE = {
  evaluated: 3000, answered: 2990, dropped: 2, not_computable: 8,
  dropped_symbols: [{ ticker: 'ZZZ', reason: 'not-computable', detail: 'no live quote' }],
}

/** Serves each scan route its own body; anything else is a 404. */
function serve(routes) {
  jsonFetcher.mockImplementation(async (url) => {
    if (url in routes) {
      const hit = routes[url]
      if (hit instanceof Error) throw hit
      return hit
    }
    throw Object.assign(new Error(`unserved ${url}`), { status: 404 })
  })
}
const httpError = (status) => Object.assign(new Error(`http ${status}`), { status })

function renderPanel(props = {}, { run = vi.fn(), rerun = vi.fn(), publishRows = vi.fn(), freshness = vi.fn(), code = null } = {}) {
  const tree = (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelFreshnessContext.Provider value={freshness}>
        <PanelListContext.Provider value={{ open: vi.fn(), run, rerun, publish: vi.fn(), publishRows }}>
          <LongRunPanel {...props} />
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>
  )
  render(code ? <TerminalPanelContext.Provider value={{ code, density: 'compact', inset: true }}>{tree}</TerminalPanelContext.Provider> : tree)
  return { run, rerun, publishRows, freshness }
}
const symsInTable = () => within(screen.getByTestId('terminal-lead-table')).getAllByRole('row').slice(1)
  .map((r) => r.getAttribute('data-testid').replace('terminal-lead-row-', ''))
const headers = () => within(screen.getByTestId('terminal-lead-table')).getAllByRole('columnheader').map((h) => h.textContent.trim())

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(cleanup)

describe('LEAD pure helpers (longRunModel)', () => {
  it('the panel re-exports the model, so a caller can import either', () => {
    expect(longRunRows).toBe(model.longRunRows)
    expect(longRunView).toBe(model.longRunView)
    expect(parseLongRunLens).toBe(model.parseLongRunLens)
    // every lens has a route, and nothing else does (the routes live in the panel module)
    expect(Object.keys(LONG_RUN_ROUTES)).toEqual(model.LONG_RUN_LENS_KEYS)
  })

  it('six lenses, each with its own route; 30D is the default', () => {
    expect(LONG_RUN_LENS_KEYS).toEqual(['30D', '60D', '90D', 'VOL1Y', 'VOLMAX', 'IPO'])
    expect(DEFAULT_LENS).toBe('30D')
    expect(LONG_RUN_LENS_KEYS.map(longRunUrl)).toEqual([
      '/api/scans/top-gainers-30d', '/api/scans/top-gainers-60d', '/api/scans/top-gainers-90d',
      '/api/scans/highest-volume-1y', '/api/scans/highest-volume-ever', '/api/scans/ipo-1y',
    ])
    expect(longRunUrl('1Y')).toBeNull()
    expect(model.lensOrDefault('nope')).toBe('30D')
  })

  it('reads a typed lens word, and writes the lens back as a command', () => {
    expect(['30d', '60', '90D', 'vol1y', 'VOLEVER', 'alltime', 'ipos'].map(parseLongRunLens))
      .toEqual(['30D', '60D', '90D', 'VOL1Y', 'VOLMAX', 'VOLMAX', 'IPO'])
    for (const t of ['', null, 'VOL', '1Y', 'NVDA', 'toString', '45D']) expect(parseLongRunLens(t)).toBeNull()
    expect(longRunCommand('30D')).toBe('LEAD')
    expect(longRunCommand('VOLMAX')).toBe('LEAD VOLMAX')
    expect(longRunCommand('IPO', 'LDRS')).toBe('LDRS IPO')
    expect(longRunCommand('nope')).toBe('LEAD')
  })

  it('gainers rows: the window gain and its reference close; other lenses\' fields stay null', () => {
    const rows = longRunRows({ ...GAINERS, results: [...GAINERS.results, { sym: 'aaa', change_nd: 1 }, { change_nd: 5 }, null] }, '60D')
    expect(rows.map((r) => r.sym)).toEqual(['AAA', 'BBB', 'CCC'])   // duplicate and symbol-less rows dropped
    expect(rows[0]).toEqual({
      sym: 'AAA', order: 0, last: 24.24, todayPct: 5.39, gainPct: 142.36, refClose: 10,
      volume: null, record: null, timesRecord: null, listed: null,
    })
    expect(rows[2].todayPct).toBeNull()   // a missing previous close is "not known", never 0
  })

  it('volume rows carry the old record and how far past it; listings carry the first trading day', () => {
    expect(longRunRows(VOLUME, 'VOL1Y')[0]).toMatchObject({ sym: 'DDD', volume: 48_500_000, record: 20_000_000, timesRecord: 2.43, gainPct: null })
    expect(longRunRows(IPOS, 'IPO').map((r) => r.listed)).toEqual(['2026-11-04', '2026-02-12'])
    expect(listedDate(20261104)).toBe('2026-11-04')
    for (const bad of [null, '', 2026, '20261304', 'abcdefgh']) expect(listedDate(bad)).toBeNull()
  })

  it('a body that is not a scan answer is no rows, and an unknown lens is no rows', () => {
    for (const body of [null, undefined, [], { detail: 'x' }, { results: 'no' }]) expect(longRunRows(body, '30D')).toEqual([])
    expect(longRunRows(GAINERS, 'nope')).toEqual([])
  })

  it('longRunView tells "building" from "empty", and keeps the route\'s as-of and coverage', () => {
    expect(longRunView(BUILDING, '30D')).toEqual({ building: true, rows: [], asOf: null, coverage: null })
    expect(longRunView({ status: 'ok', results: [], count: 0, as_of: '2026-11-13T09:00:00-05:00' }, '30D'))
      .toMatchObject({ building: false, rows: [], asOf: '2026-11-13T09:00:00-05:00' })
    const full = longRunView({ ...GAINERS, coverage: COVERAGE }, '30D')
    expect(full.rows).toHaveLength(3)
    expect(full.coverage).toBe(COVERAGE)
    expect(full.building).toBe(false)
  })

  it('each kind opens in its own order and shows its own columns', () => {
    expect(defaultLongRunSort('90D')).toEqual({ key: 'gainPct', dir: 'desc' })
    expect(defaultLongRunSort('VOLMAX')).toEqual({ key: 'timesRecord', dir: 'desc' })
    expect(defaultLongRunSort('IPO')).toEqual({ key: 'listed', dir: 'desc' })
    expect(longRunColumns('60D').map((c) => c.key)).toEqual(['sym', 'last', 'todayPct', 'gainPct', 'refClose'])
    expect(longRunColumns('60D')[3].label).toBe('60-day gain')
    expect(longRunColumns('VOL1Y').map((c) => c.key)).toEqual(['sym', 'last', 'todayPct', 'volume', 'record', 'timesRecord'])
    expect(longRunColumns('IPO').map((c) => c.key)).toEqual(['sym', 'last', 'todayPct', 'listed'])
    // a table five or more columns wide folds at least one away on a phone
    for (const lens of LONG_RUN_LENS_KEYS) {
      const cols = longRunColumns(lens)
      if (cols.length >= 5) expect(cols.some((c) => c.phoneHide)).toBe(true)
    }
  })

  it('cells are formatted by the shared primitives, and a missing value reads n/a', () => {
    const [aaa, , ccc] = longRunRows(GAINERS, '30D')
    expect(longRunCell('gainPct', aaa)).toEqual({ text: '+142.4%', toneOf: 142.36 })
    expect(longRunCell('last', aaa).text).toBe('24.24')
    expect(longRunCell('todayPct', ccc).text).toBe('n/a')
    const ddd = longRunRows(VOLUME, 'VOLMAX')[0]
    expect(longRunCell('volume', ddd).text).toBe('48.5M')
    expect(longRunCell('record', ddd).text).toBe('20.0M')
    expect(longRunCell('timesRecord', ddd).text).toBe('2.43×')
    expect(longRunCell('listed', { listed: null }).text).toBe('n/a')
  })

  it('the method sentence names what each list is', () => {
    expect(longRunMethod('90D')).toContain('top 5% of US common stocks by percent change over 90 trading sessions')
    expect(longRunMethod('VOL1Y')).toContain('than on any day in the last year')
    expect(longRunMethod('VOLMAX')).toContain('than on any day in its whole history')
    expect(longRunMethod('IPO')).toContain('first traded in the last year')
    for (const lens of LONG_RUN_LENS_KEYS) expect(longRunMethod(lens)).not.toMatch(/[—–]/)
  })
})

describe('LEAD panel', () => {
  it('shows a skeleton while the read is out, with the chips already there', () => {
    jsonFetcher.mockReturnValue(new Promise(() => {}))
    renderPanel()
    expect(screen.getByTestId('terminal-lead-loading').textContent).toContain('Loading the 30-day gainers')
    expect(screen.getByTestId('terminal-lead-lens-30D').getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByTestId('terminal-lead-table')).toBeNull()
    expect(screen.queryByTestId('terminal-lead-empty')).toBeNull()
  })

  it('lists the 30-day gainers biggest first with every field, the as-of, and loads a clicked symbol', async () => {
    serve({ [longRunUrl('30D')]: GAINERS })
    const { run, publishRows, freshness } = renderPanel()
    await screen.findByTestId('terminal-lead-table')
    expect(jsonFetcher).toHaveBeenCalledWith('/api/scans/top-gainers-30d')
    expect(symsInTable()).toEqual(['AAA', 'BBB', 'CCC'])
    expect(headers()).toEqual(['Symbol', 'Last ($)', 'Today', '30-day gain ▼', 'Close 30 sessions ago ($)'])
    const aaa = screen.getByTestId('terminal-lead-row-AAA').textContent
    for (const s of ['1', 'AAA', '24.24', '+5.39%', '+142.4%', '10.00']) expect(aaa).toContain(s)
    expect(screen.getByTestId('terminal-lead-row-BBB').textContent).toContain('-1.00%')
    expect(screen.getByTestId('terminal-lead-row-CCC').textContent).toContain('n/a')
    fireEvent.click(screen.getByTestId('panel-symbol-BBB'))
    expect(run).toHaveBeenCalledWith('$BBB')
    expect(publishRows).toHaveBeenLastCalledWith(['$AAA', '$BBB', '$CCC'])
    const method = screen.getByTestId('terminal-lead-method').textContent
    expect(method).toContain('top 5% of US common stocks by percent change over 30 trading sessions')
    expect(method).toContain('3 stocks.')
    expect(method).toContain('List worked out at 2:31 PM ET.')
    // the header's as-of is the route's own as_of, with its source
    const report = freshness.mock.calls.map((c) => c[0]).filter(Boolean).pop()
    expect(report.source).toBe('UCT market scans (live prices against daily history)')
    expect(report.observedAt).toBe('2026-11-13T19:31:07.120Z')
    expect(report.age.asOfDate).toContain('2:31 PM ET')
    // no receipt sent (the flag is dark): no coverage line
    expect(screen.queryByTestId('coverage-line')).toBeNull()
  })

  it('draws the route\'s coverage receipt when it sends one', async () => {
    serve({ [longRunUrl('30D')]: { ...GAINERS, coverage: COVERAGE } })
    renderPanel()
    await screen.findByTestId('terminal-lead-table')
    expect(screen.getByTestId('coverage-line').textContent).toContain('3,000 evaluated')
  })

  it('sorts by a column and says which way', async () => {
    serve({ [longRunUrl('30D')]: GAINERS })
    renderPanel()
    await screen.findByTestId('terminal-lead-table')
    expect(screen.getByTestId('terminal-lead-sort-gainPct').closest('th').getAttribute('aria-sort')).toBe('descending')
    fireEvent.click(screen.getByTestId('terminal-lead-sort-gainPct'))
    expect(symsInTable()).toEqual(['CCC', 'BBB', 'AAA'])
    expect(screen.getByTestId('terminal-lead-sort-gainPct').closest('th').getAttribute('aria-sort')).toBe('ascending')
    fireEvent.click(screen.getByTestId('terminal-lead-sort-todayPct'))
    expect(symsInTable()).toEqual(['AAA', 'BBB', 'CCC'])   // the row with no change sinks last either way
    fireEvent.click(screen.getByTestId('terminal-lead-sort-sym'))
    expect(symsInTable()).toEqual(['AAA', 'BBB', 'CCC'])
    expect(screen.getByTestId('terminal-lead-sort-sym').closest('th').getAttribute('aria-sort')).toBe('ascending')
  })

  it('a chip switches the lens: its own route, its own columns, and the lens written into the command', async () => {
    serve({ [longRunUrl('30D')]: GAINERS, [longRunUrl('VOL1Y')]: VOLUME, [longRunUrl('IPO')]: IPOS })
    const { rerun, publishRows } = renderPanel()
    await screen.findByTestId('terminal-lead-table')

    fireEvent.click(screen.getByTestId('terminal-lead-lens-VOL1Y'))
    expect(rerun).toHaveBeenLastCalledWith('LEAD VOL1Y')
    await screen.findByTestId('terminal-lead-row-DDD')
    expect(jsonFetcher).toHaveBeenCalledWith('/api/scans/highest-volume-1y')
    expect(screen.getByTestId('terminal-lead-lens-VOL1Y').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('terminal-lead-lens-30D').getAttribute('aria-pressed')).toBe('false')
    expect(headers()).toEqual(['Symbol', 'Last ($)', 'Today', 'Volume today', 'Old record', 'Times the record ▼'])
    const ddd = screen.getByTestId('terminal-lead-row-DDD').textContent
    for (const s of ['31.50', '+26.00%', '48.5M', '20.0M', '2.43×']) expect(ddd).toContain(s)
    expect(screen.queryByTestId('terminal-lead-row-AAA')).toBeNull()   // never the last lens's rows
    expect(publishRows).toHaveBeenLastCalledWith(['$DDD', '$EEE'])

    fireEvent.click(screen.getByTestId('terminal-lead-lens-IPO'))
    expect(rerun).toHaveBeenLastCalledWith('LEAD IPO')
    await screen.findByTestId('terminal-lead-row-FFF')
    expect(headers()).toEqual(['Symbol', 'Last ($)', 'Today', 'First traded ▼'])
    expect(symsInTable()).toEqual(['FFF', 'GGG'])
    expect(screen.getByTestId('terminal-lead-row-GGG').textContent).toContain('2026-02-12')

    fireEvent.click(screen.getByTestId('terminal-lead-lens-30D'))
    expect(rerun).toHaveBeenLastCalledWith('LEAD')   // the default lens is the bare code
    rerun.mockClear()
    fireEvent.click(screen.getByTestId('terminal-lead-lens-30D'))
    expect(rerun).not.toHaveBeenCalled()             // the lens already showing re-runs nothing
  })

  it('a typed lens seeds the panel, and the write-back uses the code the panel runs under', async () => {
    serve({ [longRunUrl('90D')]: GAINERS, [longRunUrl('60D')]: GAINERS })
    const { rerun } = renderPanel({ lens: '90D' }, { code: 'LDRS' })
    await screen.findByTestId('terminal-lead-table')
    expect(jsonFetcher).toHaveBeenCalledWith('/api/scans/top-gainers-90d')
    expect(screen.getByTestId('terminal-lead').getAttribute('data-lens')).toBe('90D')
    expect(headers()).toContain('90-day gain ▼')
    fireEvent.click(screen.getByTestId('terminal-lead-lens-60D'))
    expect(rerun).toHaveBeenLastCalledWith('LDRS 60D')
    expect(await screen.findByRole('table', { name: '60-day gainers, sortable' })).toBeTruthy()
  })

  it('a lens that does not exist opens the default list', async () => {
    serve({ [longRunUrl('30D')]: GAINERS })
    renderPanel({ lens: 'NOPE' })
    await screen.findByTestId('terminal-lead-table')
    expect(jsonFetcher).toHaveBeenCalledWith('/api/scans/top-gainers-30d')
  })

  it('"computing" says the server is preparing the list: not empty, not an error', async () => {
    serve({ [longRunUrl('30D')]: BUILDING })
    renderPanel()
    const warm = await screen.findByTestId('terminal-lead-building')
    expect(warm.textContent).toContain('Loading, the server is preparing this.')
    expect(warm.textContent).toContain('the 30-day gainers')
    expect(screen.queryByTestId('terminal-lead-empty')).toBeNull()
    expect(screen.queryByTestId('terminal-lead-error')).toBeNull()
    expect(screen.queryByTestId('terminal-lead-table')).toBeNull()
  })

  it('an ok answer with no rows is empty, says it can mean no live prices yet, and offers Retry', async () => {
    jsonFetcher.mockResolvedValueOnce({ status: 'ok', results: [], count: 0, as_of: '2026-11-13T08:00:00-05:00' })
    renderPanel({ lens: 'VOLMAX' })
    const empty = await screen.findByTestId('terminal-lead-empty')
    expect(empty.textContent).toContain('No stock is past its volume record for its whole history yet today.')
    expect(empty.textContent).toContain('before the open or when the price feed has not answered')
    expect(screen.queryByTestId('terminal-lead-building')).toBeNull()
    jsonFetcher.mockResolvedValueOnce(VOLUME)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-lead-table')).toBeTruthy()
  })

  it('a failed read (500) is an error with Retry, never an empty list', async () => {
    jsonFetcher.mockRejectedValueOnce(httpError(500))
    renderPanel()
    const err = await screen.findByTestId('terminal-lead-error')
    expect(err.textContent).toContain('The 30-day gainers list could not be read just now.')
    expect(err.textContent).toContain('That is not the same as an empty list.')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(screen.queryByTestId('terminal-lead-empty')).toBeNull()
    jsonFetcher.mockResolvedValueOnce(GAINERS)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-lead-table')).toBeTruthy()
  })

  it('a 402 says paid plan and a 404 says not switched on: both locked, neither offers Retry', async () => {
    jsonFetcher.mockRejectedValueOnce(httpError(402))
    renderPanel()
    const paid = await screen.findByTestId('terminal-lead-error')
    expect(paid.textContent).toContain('The 30-day gainers list needs a paid plan.')
    expect(paid.getAttribute('data-kind')).toBe('locked')
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    cleanup()
    jsonFetcher.mockRejectedValueOnce(httpError(404))
    renderPanel({ lens: 'IPO' })
    const off = await screen.findByTestId('terminal-lead-error')
    expect(off.textContent).toContain('The new listings list is not switched on for this server yet.')
    expect(off.getAttribute('data-kind')).toBe('locked')
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    // the chips stay, so a member can leave a locked or failed list
    expect(screen.getByTestId('terminal-lead-lens-30D')).toBeTruthy()
  })

  it('a long list draws the first 100 in the sorted order and says how many there are', async () => {
    const results = Array.from({ length: 104 }, (_, i) => ({
      sym: `S${String(i).padStart(3, '0')}`, change_nd: 300 - i, ref_close: 10, price: 20, prev_close: 19, change_pct: 1,
    }))
    serve({ [longRunUrl('30D')]: { status: 'ok', results, count: 104, as_of: '2026-11-13T12:00:00-05:00' } })
    const { publishRows } = renderPanel()
    await screen.findByTestId('terminal-lead-table')
    expect(MAX_ROWS).toBe(100)
    expect(symsInTable()).toHaveLength(100)
    expect(symsInTable()[0]).toBe('S000')
    expect(screen.getByTestId('terminal-lead-method').textContent).toContain('Showing the first 100 of 104 in this order.')
    expect(publishRows.mock.calls.at(-1)[0]).toHaveLength(100)
  })
})
