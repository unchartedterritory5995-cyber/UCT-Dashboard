// GRP: one sector, industry or UCT theme and its stocks, ranked. Rails:
//   * nothing typed is a pick-a-group state that asks the server for nothing;
//   * a pinned kind reads ONE group list, an unpinned name all three, and RS and the confluence
//     board are read only once a group is known;
//   * loading, a failed read (error with Retry), a slow first ranking, a paywall, a switched-off
//     route and signed out; "computing" is a working state, never an empty group;
//   * a name that fits nothing offers the nearest, one that fits several asks which, and a name
//     two kinds share opens the first and names the other;
//   * a UCT theme the ranking does not hold is looked up in the theme list: its curated stocks are
//     listed (never an engine-suggested one), and a theme with none says so instead of an empty table;
//   * the stock ranking, RS and the confluence board each fail apart: the stocks stay listed, the
//     column that failed is empty (never 0), and a sentence says why;
//   * sortable by change and by RS, a long group is counted, a range chip and a pick write the
//     command, a symbol loads into the linked panels;
//   * at phone width only the symbol, the change and RS are left.
// The fixtures are the routes' real shapes (api/services/scan_period.py, rs_ranking.py,
// confluence_screen.py, theme_performance.py), with made-up tickers.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
vi.mock('../../calendar/earningsModalRow', async (orig) => ({ ...(await orig()), todayIso: () => '2026-11-18' }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import GroupDrillPanel, { GROUP_DRILL_CODE, GROUP_MAX_ROWS, GROUP_PAGE_ROWS, GROUP_RS_URL } from './GroupDrillPanel'
import { periodChangeUrl, periodGroupsUrl } from './periodChangeModel'
import { CONFLUENCE_URL } from './confluenceModel'
import { THEMES_URL } from './imovModel'
import { groupStatsUrl } from './groupStatsModel'
import { SEMIS_DETAIL, TECH_DETAIL } from './__fixtures__/groupStatsFixture'
import { PANEL_IMPORTERS } from '../panels'
import parseCommand from '../parseCommand'
import { applyArgs } from '../args'
import { BY_CODE } from '../functions'
import marketStyles from './marketPanels.module.css'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const TODAY = '2026-11-18'
const YTD = ['2025-12-31', TODAY]
const M3 = ['2026-08-18', TODAY]
const listUrl = (kind, range = YTD) => periodGroupsUrl(range[0], range[1], kind)
const STOCKS_URL = periodChangeUrl(...YTD)
const SECTORS_URL = listUrl('sector')
const INDUSTRIES_URL = listUrl('industry')
const THEMES_LIST_URL = listUrl('theme')

const groups = (group, results) => ({ status: 'ok', group, results, count: results.length, start: 20251231, end: 20261117, as_of: '2026-11-18T09:41:00-05:00' })
const TECH = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF', 'GGG', 'HHH']
const SECTORS = groups('sector', [
  { name: 'Technology', period_change: 38.3, count: 8, members: TECH },
  { name: 'Energy', period_change: -6.1, count: 2, members: ['XOA', 'XOB'] },
])
const INDUSTRIES = groups('industry', [
  { name: 'Semiconductors', period_change: 51.0, count: 2, members: ['AAA', 'BBB'] },
  { name: 'Semiconductor Equipment & Materials', period_change: 20.0, count: 1, members: ['CCC'] },
])
const THEMES_LIST = groups('theme', [
  { name: 'Semiconductors', period_change: 44.0, count: 3, members: ['AAA', 'BBB', 'KKK'] },
  { name: 'AI / GPU Chips', period_change: 80.0, count: 2, members: ['AAA', 'KKK'] },
])
const stock = (sym, pct, industry = 'Software') => ({ sym, period_change: pct, net_change: 1, start_close: 10, end_close: 10 * (1 + pct / 100), price: 11, volume: 1, industry, sector: 'Technology' })
const STOCKS = {
  status: 'ok',
  // HHH is in the sector's list but not in the stock ranking: it must keep a row with no change
  results: [stock('AAA', 212.5, 'Semiconductors'), stock('BBB', 48.0, 'Semiconductors'), stock('CCC', 12.4), stock('DDD', 4.0, null), stock('EEE', 0.0),
    stock('FFF', -3.2), stock('GGG', -27.9), stock('KKK', 66.0, 'Semiconductors'), stock('NVDA', 30.0, 'Semiconductors'), stock('ZZZ', 500, 'Banks')],
  count: 10, start: 20251231, end: 20261117, as_of: '2026-11-18T09:41:00-05:00', partial: false,
}
// DDD is outside the ranked universe: no RS rank, which is n/a and never 0
const RS = [
  { ticker: 'AAA', rs_score: 9.9, rs_rank: 99, returns: {} }, { ticker: 'BBB', rs_rank: 91 }, { ticker: 'CCC', rs_rank: 74 },
  { ticker: 'EEE', rs_rank: 50 }, { ticker: 'FFF', rs_rank: 33 }, { ticker: 'GGG', rs_rank: 8 }, { ticker: 'HHH', rs_rank: 61 },
]
const BOARD = {
  ok: true, window: 'Oct 6 – Nov 14, 2026', days: 30,
  rows: [{ sym: 'AAA', band: 'L', dir: 'BULL', status: 'BUILDING' }, { sym: 'CCC', band: 'M', dir: 'BEAR', status: 'ESTABLISHED' }, { sym: 'QQQQ', band: 'S', dir: 'BULL', status: 'STEADY' }],
}
const THEME_PERF = {
  themes: [
    { name: 'UCT 20', ticker: 'UCT20', theme_id: '', holdings: [{ sym: 'NVDA' }, { sym: 'AAA', source: 'owner' }, { sym: 'ENGX', source: 'engine' }] },
    { name: 'Quantum Computing', ticker: 'QTUM', theme_id: 'quantum', holdings: [{ sym: 'ENGY', source: 'engine' }] },
  ],
}
// the group's own fundamentals and breadth (GroupStatsSections, GET /api/research/group-stats), read once the group is known
const TECH_STATS_URL = groupStatsUrl('sector', 'Technology')
const SEMIS_STATS_URL = groupStatsUrl('industry', 'Semiconductors')
const ALL = {
  [SECTORS_URL]: SECTORS, [INDUSTRIES_URL]: INDUSTRIES, [THEMES_LIST_URL]: THEMES_LIST, [STOCKS_URL]: STOCKS, [GROUP_RS_URL]: RS, [CONFLUENCE_URL]: BOARD,
  [THEMES_URL]: THEME_PERF, [TECH_STATS_URL]: TECH_DETAIL, [SEMIS_STATS_URL]: SEMIS_DETAIL,
}

const fail = (status, extra = {}) => Object.assign(new Error(`http ${status}`), { status }, extra)
const PENDING = Symbol('pending')
/** Serves each URL its body (an Error is thrown, PENDING never answers); anything else is a 500. */
function serve(routes) {
  jsonFetcher.mockImplementation((url) => {
    if (!(url in routes)) return Promise.reject(fail(500))
    const hit = routes[url]
    if (hit === PENDING) return new Promise(() => {})
    return hit instanceof Error ? Promise.reject(hit) : Promise.resolve(hit)
  })
}
const asked = () => [...new Set(jsonFetcher.mock.calls.map(([url]) => url))]

function renderPanel(props = {}, { run = vi.fn(), rerun = vi.fn(), open = vi.fn(), publishRows = vi.fn(), setFreshness = vi.fn(), code = null } = {}) {
  const body = <GroupDrillPanel {...props} />
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelFreshnessContext.Provider value={setFreshness}>
        <PanelListContext.Provider value={{ open, run, rerun, publish: vi.fn(), publishRows }}>
          {code ? <TerminalPanelContext.Provider value={{ code, density: 'comfortable', inset: true }}>{body}</TerminalPanelContext.Provider> : body}
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>,
  )
  return { run, rerun, open, publishRows, setFreshness }
}
const rowsOf = () => within(screen.getByTestId('terminal-grp-table')).getAllByRole('row').slice(1)
const symsOnScreen = () => rowsOf().map((r) => r.getAttribute('data-testid').replace('terminal-grp-row-', ''))
const cells = (row) => [...row.querySelectorAll('td')].map((td) => td.textContent)
/** Every read has landed: the first row (AAA in every fixture group) shows its RS rank and its flow signal. */
const settled = () => waitFor(() => expect(cells(rowsOf()[0]).slice(0, 4)).toEqual(['1AAA', '+212.5%', '99', 'Bullish, building']))
const HERE = path.dirname(fileURLToPath(import.meta.url))

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(cleanup)

describe('GRP with nothing typed', () => {
  it('offers the 11 sectors and says what can be typed, and asks the server for nothing', () => {
    serve(ALL)
    renderPanel({}, { code: 'GRPX' })
    expect(GROUP_DRILL_CODE).toBe('GRP')
    const idle = screen.getByTestId('terminal-grp-idle')
    expect(idle.getAttribute('data-kind')).toBe('input')
    expect(idle.textContent).toContain('Pick a group to see its stocks ranked.')
    expect(idle.textContent).toContain('GRPX XLK')
    expect(within(idle).getByRole('group', { name: 'Sectors' }).querySelectorAll('button')).toHaveLength(11)
    expect(screen.getByTestId('terminal-grp-range-ytd').getAttribute('aria-pressed')).toBe('true')
    expect(asked()).toEqual([])
    expect(screen.queryByTestId('terminal-grp-table')).toBeNull()
  })

  it('a kind word alone names no group either', () => {
    serve(ALL)
    renderPanel({ group: 'THEMES' })
    expect(screen.getByTestId('terminal-grp-idle')).toBeTruthy()
    expect(screen.getByTestId('terminal-grp').getAttribute('data-kind')).toBe('theme')
    expect(asked()).toEqual([])
  })

  it('a sector button opens that sector: written into the command in the shell, plain state outside it', async () => {
    serve(ALL)
    const { rerun } = renderPanel({}, { code: 'GRP' })
    fireEvent.click(screen.getByTestId('terminal-grp-sector-XLK'))
    expect(rerun).toHaveBeenLastCalledWith('GRP XLK')
    cleanup()
    // outside the shell nothing re-runs the command, so the pick is the panel's own state
    serve(ALL)
    render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}><GroupDrillPanel /></SWRConfig>)
    fireEvent.click(screen.getByTestId('terminal-grp-sector-XLK'))
    expect((await screen.findByTestId('terminal-grp-name')).textContent).toBe('Technology')
  })

  it('the lists of every group are one click away', () => {
    serve(ALL)
    const { open } = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Open every UCT theme ranked (PCHG THEMES)' }))
    expect(open).toHaveBeenLastCalledWith('PCHG THEMES')
  })
})

describe('GRP: what is read, and when', () => {
  it('a sector fund reads the sector list and the stock ranking, and nothing else until the group is known', () => {
    serve({ [SECTORS_URL]: PENDING, [STOCKS_URL]: PENDING })
    renderPanel({ group: 'XLK' })
    expect(SECTORS_URL).toBe('/api/scans/period-change-groups?start=20251231&end=20261118&group=sector')
    expect(STOCKS_URL).toBe('/api/scans/period-change?start=20251231&end=20261118')
    expect(screen.getByTestId('terminal-grp-loading').textContent).toContain('Looking up XLK')
    expect(asked().sort()).toEqual([SECTORS_URL, STOCKS_URL].sort())
    expect(screen.queryByTestId('terminal-grp-table')).toBeNull()
  })

  it('a name with no kind word reads all three lists; RS, the confluence board and the group\'s own figures follow the group', async () => {
    serve(ALL)
    renderPanel({ group: 'SEMICONDUCTORS' })
    await screen.findByTestId('terminal-grp-table')
    await waitFor(() => expect(asked().sort()).toEqual([SECTORS_URL, INDUSTRIES_URL, THEMES_LIST_URL, STOCKS_URL, GROUP_RS_URL, CONFLUENCE_URL,
      SEMIS_STATS_URL].sort()))
    // the theme list is only for a name no ranked list holds
    expect(asked()).not.toContain(THEMES_URL)
  })

  it('a typed range asks for that range\'s two dates, the same ones PCHG asks for', async () => {
    serve({ ...ALL, [listUrl('sector', M3)]: SECTORS, [periodChangeUrl(...M3)]: STOCKS })
    renderPanel({ group: 'XLK', range: 'm3' })
    await screen.findByTestId('terminal-grp-table')
    expect(screen.getByTestId('terminal-grp').getAttribute('data-range')).toBe('m3')
    expect(screen.getByTestId('terminal-grp-range-m3').getAttribute('aria-pressed')).toBe('true')
    expect(asked()).toContain('/api/scans/period-change-groups?start=20260818&end=20261118&group=sector')
    expect(asked()).not.toContain(SECTORS_URL)
  })
})

describe('GRP states', () => {
  it('a failed read (500) is an error with Retry, never a group with no stocks', async () => {
    serve({})
    renderPanel({ group: 'XLK' }, { code: 'GRPX' })
    const err = await screen.findByTestId('terminal-grp-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('The group ranking could not be read just now.')
    expect(err.textContent).toContain('That is not the same as a group with no stocks. Retry, or run GRPX again.')
    expect(screen.queryByTestId('terminal-grp-table')).toBeNull()
    serve(ALL)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-grp-table')).toBeTruthy()
  })

  it('a first ranking that ran past the deadline says the server is still working on it', async () => {
    serve({ [SECTORS_URL]: Object.assign(new Error('deadline'), { timedOut: true }) })
    renderPanel({ group: 'XLK' })
    const err = await screen.findByTestId('terminal-grp-error')
    expect(err.textContent).toContain('The group ranking did not answer within 30 seconds.')
    expect(err.textContent).toContain('The server keeps working on it, so Retry usually has it.')
  })

  it('signed out (401) and locked (402, 404) each say so, and only an error can be retried', async () => {
    for (const [status, kind, words] of [
      [401, 'error', 'You are signed out, so the group ranking cannot be read. Sign in again.'],
      [402, 'locked', 'The group ranking needs a paid plan.'],
      [404, 'locked', 'The group ranking is not switched on for this server yet.'],
    ]) {
      cleanup()
      serve({ [SECTORS_URL]: fail(status) })
      renderPanel({ group: 'XLK' })
      const state = await screen.findByTestId('terminal-grp-error')
      expect(state.getAttribute('data-kind'), String(status)).toBe(kind)
      expect(state.textContent).toContain(words)
      expect(!!screen.queryByRole('button', { name: 'Retry' }), String(status)).toBe(kind === 'error')
    }
  })

  it('"computing" says the server is still working: not empty, not an error, and no as-of', async () => {
    serve({ [SECTORS_URL]: { status: 'computing', group: 'sector', results: [], count: 0 }, [STOCKS_URL]: { status: 'computing', results: [], count: 0, as_of: null } })
    const { setFreshness } = renderPanel({ group: 'XLK' })
    const working = await screen.findByTestId('terminal-grp-computing')
    expect(working.getAttribute('data-kind')).toBe('empty')
    expect(working.getAttribute('role')).toBe('status')
    expect(working.textContent).toContain('The server is ranking the whole market for this year.')
    expect(working.textContent).toContain('That is not the same as a group with no stocks.')
    expect(setFreshness.mock.calls.map((c) => c[0]).filter(Boolean)).toEqual([])
    expect(asked()).not.toContain(GROUP_RS_URL)
  })

  it('"unavailable" and an answer in another shape are errors with Retry', async () => {
    for (const body of [{ status: 'unavailable', results: [], error: 'x' }, { hello: 'world' }]) {
      cleanup()
      serve({ [SECTORS_URL]: body, [STOCKS_URL]: STOCKS })
      renderPanel({ group: 'XLK' })
      const err = await screen.findByTestId('terminal-grp-error')
      expect(err.textContent).toContain('The group ranking could not be read just now.')
      expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    }
  })

  it('both ends of the range on one trading day is said so, never drawn as a market of 0% moves', async () => {
    serve({ ...ALL, [SECTORS_URL]: { ...SECTORS, start: 20261117 } })
    renderPanel({ group: 'XLK' })
    const same = await screen.findByTestId('terminal-grp-same-day')
    expect(same.textContent).toContain('Both ends of this year land on one trading day, 2026-11-17, so there is no change to rank yet.')
    expect(screen.queryByTestId('terminal-grp-table')).toBeNull()
  })
})

describe('GRP populated: a sector with eight stocks', () => {
  it('the header names the group, its kind, its fund, its own change and how many stocks', async () => {
    serve(ALL)
    const { setFreshness } = renderPanel({ group: 'XLK' })
    await screen.findByTestId('terminal-grp-table')
    const head = screen.getByTestId('terminal-grp-head')
    expect(head.getAttribute('data-kind')).toBe('sector')
    expect(screen.getByTestId('terminal-grp-name').textContent).toBe('Technology')
    expect(head.textContent).toContain('Sector, fund XLK')
    expect(screen.getByTestId('terminal-grp-change').textContent).toBe('+38.3%')
    expect(screen.getByTestId('terminal-grp-totals').textContent)
      .toBe('8 stocks, from the close of 2025-12-31 to the close of 2026-11-17: 4 rose, 2 fell, 1 did not move. 1 has no close on both days and no change.')
    // the as-of is the last close the changes run to
    await waitFor(() => expect(setFreshness).toHaveBeenCalledWith(expect.objectContaining({ source: 'UCT whole-market daily closes' })))
    expect(JSON.stringify(setFreshness.mock.calls.map((c) => c[0]).filter(Boolean).pop())).toContain('2026-11-17')
  })

  it('⭐ one row per stock: its change, its RS rank, its flow signal; biggest gain first; a missing number is never 0', async () => {
    serve(ALL)
    renderPanel({ group: 'XLK' })
    await screen.findByTestId('terminal-grp-table')
    await waitFor(() => expect(cells(rowsOf()[0])).toEqual(['1AAA', '+212.5%', '99', 'Bullish, building', 'Semiconductors']))
    expect(rowsOf().map(cells)).toEqual([
      ['1AAA', '+212.5%', '99', 'Bullish, building', 'Semiconductors'],
      ['2BBB', '+48.0%', '91', '', 'Semiconductors'],
      ['3CCC', '+12.4%', '74', 'Bearish, established', 'Software'],
      ['4DDD', '+4.0%', 'n/a', '', 'Not given'],
      ['5EEE', '+0.0%', '50', '', 'Software'],
      ['6FFF', '-3.2%', '33', '', 'Software'],
      ['7GGG', '-27.9%', '8', '', 'Software'],
      ['8HHH', 'n/a', '61', '', ''],
    ])
    // a stock of another group never rides in, and a name on the board but not in the group is not shown
    expect(document.body.textContent).not.toContain('ZZZ')
    expect(document.body.textContent).not.toContain('QQQQ')
    expect(screen.getByRole('table').getAttribute('aria-label'))
      .toBe('The stocks in Technology from 2025-12-31 to 2026-11-17, biggest gain first, 8 of 8')
    expect(screen.queryByTestId('terminal-grp-cut')).toBeNull()
    const method = screen.getByTestId('terminal-grp-method').textContent
    expect(method).toContain('Every stock whose company details name Technology as its sector')
    expect(method).toContain('caps its best stocks before averaging')
    expect(method).toContain('n/a means the stock is outside it')
    expect(method).toContain('Oct 6 to Nov 14, 2026')
    expect(method).toContain('an empty cell means it is not on the board')
    expect(method).toMatch(/Changes worked out at \d{1,2}:41 [AP]M ET\./)
    expect(document.body.textContent).not.toMatch(/[—–]/)
  })

  it('a symbol and the sector fund load into the linked panels; row numbers follow the rows on screen', async () => {
    serve(ALL)
    const { run, publishRows } = renderPanel({ group: 'XLK' })
    await screen.findByTestId('terminal-grp-table')
    await waitFor(() => expect(publishRows).toHaveBeenLastCalledWith(['$AAA', '$BBB', '$CCC', '$DDD', '$EEE', '$FFF', '$GGG', '$HHH']))
    fireEvent.click(within(rowsOf()[2]).getByRole('button', { name: 'Load CCC' }))
    expect(run).toHaveBeenLastCalledWith('$CCC')
    fireEvent.click(within(screen.getByTestId('terminal-grp-head')).getByRole('button', { name: 'Load XLK' }))
    expect(run).toHaveBeenLastCalledWith('$XLK')
  })

  it('sortable by change and by RS, both ways; a stock with no value stays at the end', async () => {
    serve(ALL)
    const { publishRows } = renderPanel({ group: 'XLK' })
    await screen.findByTestId('terminal-grp-table')
    await waitFor(() => expect(cells(rowsOf()[0])[2]).toBe('99'))
    const th = (name) => screen.getByRole('columnheader', { name: new RegExp(`^${name}`) })
    expect(th('Change').getAttribute('aria-sort')).toBe('descending')
    expect(th('RS').getAttribute('aria-sort')).toBe('none')
    fireEvent.click(screen.getByTestId('terminal-grp-sort-rs'))
    expect(symsOnScreen()).toEqual(['AAA', 'BBB', 'CCC', 'HHH', 'EEE', 'FFF', 'GGG', 'DDD'])
    expect(th('RS').getAttribute('aria-sort')).toBe('descending')
    expect(th('Change').getAttribute('aria-sort')).toBe('none')
    expect(screen.getByTestId('terminal-grp-table').getAttribute('aria-label')).toContain('highest RS rank first')
    await waitFor(() => expect(publishRows).toHaveBeenLastCalledWith(['$AAA', '$BBB', '$CCC', '$HHH', '$EEE', '$FFF', '$GGG', '$DDD']))
    fireEvent.click(screen.getByTestId('terminal-grp-sort-rs'))
    expect(symsOnScreen()).toEqual(['GGG', 'FFF', 'EEE', 'HHH', 'CCC', 'BBB', 'AAA', 'DDD'])
    expect(th('RS').getAttribute('aria-sort')).toBe('ascending')
    fireEvent.click(screen.getByTestId('terminal-grp-sort-pct'))
    expect(symsOnScreen()).toEqual(['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF', 'GGG', 'HHH'])
    fireEvent.click(screen.getByTestId('terminal-grp-sort-pct'))
    expect(symsOnScreen()).toEqual(['GGG', 'FFF', 'EEE', 'DDD', 'CCC', 'BBB', 'AAA', 'HHH'])
    expect(screen.getByTestId('terminal-grp-table').getAttribute('data-sort')).toBe('pct:asc')
  })

  it('at phone width only the symbol, the change and RS are left', async () => {
    serve(ALL)
    renderPanel({ group: 'XLK' })
    await screen.findByTestId('terminal-grp-table')
    const hidden = (el) => el.classList.contains(marketStyles.phoneHide)
    const heads = [...screen.getByTestId('terminal-grp-table').querySelectorAll('th')]
    expect(heads.map((h) => [h.textContent.replace(/ [▲▼]$/, ''), hidden(h)])).toEqual([
      ['Symbol', false], ['Change', false], ['RS', false], ['Flow', true], ['Industry', true],
    ])
    for (const row of rowsOf()) expect([...row.querySelectorAll('td')].map(hidden)).toEqual([false, false, false, true, true])
    // the css the class stands for really hides it where the table folds: a phone screen, or a panel
    // at most 460px wide (`narrow`; the shell marks the panel body, ../panelFit.js). GRP has no sample
    // rows to measure, so it names no step of the fold ladder and keeps every column above that.
    const css = fs.readFileSync(path.join(HERE, 'marketPanels.module.css'), 'utf8')
    expect(css).toMatch(/\n:where\(\[data-fit~='narrow'\], [^{]*\) \.phoneHide \{\s*display: none;/)
    expect(fs.readFileSync(path.join(HERE, 'GroupDrillPanel.jsx'), 'utf8')).not.toMatch(/data-fold/)
  })

  it('a group the server sent no stock list for says so, and keeps the group\'s own figure', async () => {
    serve({ ...ALL, [SECTORS_URL]: groups('sector', [{ name: 'Technology', period_change: 38.3, count: 8, members: [] }]) })
    renderPanel({ group: 'XLK' })
    const none = await screen.findByTestId('terminal-grp-no-list')
    expect(none.textContent).toContain('The server sent no stock list for Technology.')
    expect(screen.getByTestId('terminal-grp-change').textContent).toBe('+38.3%')
    expect(screen.queryByTestId('terminal-grp-table')).toBeNull()
  })

  it('a long group is drawn fifty at a time, counted, and capped', async () => {
    const members = Array.from({ length: 300 }, (_, i) => `T${String(i).padStart(3, '0')}`)
    serve({ ...ALL, [SECTORS_URL]: groups('sector', [{ name: 'Technology', period_change: 5, count: 300, members }]),
      [STOCKS_URL]: { ...STOCKS, results: members.map((sym, i) => stock(sym, 500 - i)) } })
    renderPanel({ group: 'XLK' })
    await screen.findByTestId('terminal-grp-table')
    expect(rowsOf()).toHaveLength(GROUP_PAGE_ROWS)
    expect(screen.getByTestId('terminal-grp-cut').textContent.trim()).toBe('Showing 50 of 300 stocks, biggest gain first.')
    expect(screen.getByTestId('terminal-grp-more').textContent).toBe('Show 50 more')
    for (let i = 0; i < 4; i += 1) fireEvent.click(screen.getByTestId('terminal-grp-more'))
    expect(rowsOf()).toHaveLength(GROUP_MAX_ROWS)
    expect(screen.queryByTestId('terminal-grp-more')).toBeNull()
    expect(screen.getByTestId('terminal-grp-cut').textContent.trim())
      .toBe('Showing 250 of 300 stocks, biggest gain first. This panel draws 250 at most; sort the other way to see the other end.')
    fireEvent.click(screen.getByTestId('terminal-grp-sort-pct'))
    expect(symsOnScreen()[0]).toBe('T299')
  })
})

describe('GRP: which group a name means', () => {
  it('a name no group has offers the nearest names, and a pick opens it', async () => {
    serve({ ...ALL, [listUrl('sector', M3)]: SECTORS, [listUrl('industry', M3)]: INDUSTRIES, [listUrl('theme', M3)]: THEMES_LIST, [periodChangeUrl(...M3)]: STOCKS })
    const { rerun } = renderPanel({ group: 'GPU', range: 'm3' }, { code: 'GRP' })
    const unknown = await screen.findByTestId('terminal-grp-unknown')
    expect(unknown.getAttribute('data-kind')).toBe('input')
    expect(unknown.textContent).toContain('No sector, industry or UCT theme is called "GPU".')
    expect(unknown.textContent).toContain('Did you mean one of these?')
    expect(screen.queryByTestId('terminal-grp-table')).toBeNull()
    // the UCT theme list was asked before saying so (a theme with no ranked stock is not in the ranking)
    expect(asked()).toContain(THEMES_URL)
    fireEvent.click(within(screen.getByTestId('terminal-grp-didyoumean')).getByRole('button', { name: 'AI / GPU Chips (UCT theme)' }))
    expect(rerun).toHaveBeenLastCalledWith('GRP THEME AI / GPU CHIPS 3M')
    await settled()
  })

  it('a name pinned to sectors or industries never asks the theme list, and says which kind it searched', async () => {
    serve(ALL)
    renderPanel({ group: 'INDUSTRY BANANAS' })
    const unknown = await screen.findByTestId('terminal-grp-unknown')
    expect(unknown.textContent).toContain('No industry is called "BANANAS".')
    expect(unknown.textContent).toContain('Check the name.')
    expect(screen.queryByTestId('terminal-grp-didyoumean')).toBeNull()
    expect(asked()).not.toContain(THEMES_URL)
    expect(asked()).not.toContain(SECTORS_URL)
  })

  it('a sector fund the ranking has no sector for says so', async () => {
    serve(ALL)
    renderPanel({ group: 'XLU' })
    const unknown = await screen.findByTestId('terminal-grp-unknown')
    expect(unknown.textContent).toContain('No sector in the ranking matches the fund XLU.')
    expect(within(screen.getByTestId('terminal-grp-didyoumean')).getAllByRole('button').map((b) => b.textContent)).toEqual(['Energy (sector)', 'Technology (sector)'])
    expect(asked()).not.toContain(THEMES_URL)
  })

  it('a name that starts several groups asks which, and the pick is this panel\'s own state outside the shell', async () => {
    serve(ALL)
    render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}><GroupDrillPanel group="SEMI" /></SWRConfig>)
    const which = await screen.findByTestId('terminal-grp-ambiguous')
    expect(which.textContent).toContain('"SEMI" fits 3 groups. Which one did you mean?')
    const options = within(screen.getByTestId('terminal-grp-options')).getAllByRole('button')
    expect(options.map((b) => b.textContent)).toEqual(['Semiconductor Equipment & Materials (industry)', 'Semiconductors (industry)', 'Semiconductors (UCT theme)'])
    fireEvent.click(options[2])
    expect((await screen.findByTestId('terminal-grp-head')).getAttribute('data-kind')).toBe('theme')
    expect(screen.getByTestId('terminal-grp-change').textContent).toBe('+44.0%')
    await waitFor(() => expect(symsOnScreen()).toEqual(['AAA', 'KKK', 'BBB']))
  })

  it('a name that fits more groups than are listed counts them all and says the list is cut', async () => {
    const banks = Array.from({ length: 12 }, (_, i) => ({ name: `Banks ${i}`, period_change: i, count: 1, members: ['AAA'] }))
    serve({ ...ALL, [INDUSTRIES_URL]: groups('industry', banks) })
    renderPanel({ group: 'INDUSTRY BANKS' })
    const which = await screen.findByTestId('terminal-grp-ambiguous')
    expect(which.textContent).toContain('"BANKS" fits 12 groups. Which one did you mean?')
    expect(which.textContent).toContain('Only the first 6 are listed here. Type more of the name.')
    expect(within(screen.getByTestId('terminal-grp-options')).getAllByRole('button')).toHaveLength(6)
  })

  it('⭐ a name two kinds share opens the first and names the other, which is one click away', async () => {
    serve(ALL)
    const { rerun, open } = renderPanel({ group: 'SEMICONDUCTORS' }, { code: 'GRP' })
    await screen.findByTestId('terminal-grp-table')
    expect(screen.getByTestId('terminal-grp-head').getAttribute('data-kind')).toBe('industry')
    expect(screen.getByTestId('terminal-grp-head').textContent).toContain('Industry')
    expect(screen.getByTestId('terminal-grp-change').textContent).toBe('+51.0%')
    expect(symsOnScreen()).toEqual(['AAA', 'BBB'])
    // an industry's own rows do not repeat the industry
    expect(screen.queryByRole('columnheader', { name: 'Industry' })).toBeNull()
    const also = screen.getByTestId('terminal-grp-also')
    expect(also.textContent).toContain('Semiconductors is also a UCT theme.')
    fireEvent.click(within(also).getByRole('button', { name: 'Open the UCT theme' }))
    expect(rerun).toHaveBeenLastCalledWith('GRP THEME SEMICONDUCTORS')
    expect(open).not.toHaveBeenCalled()
  })

  it('a UCT theme lists its curated stocks and links to what drives it (IMOV)', async () => {
    serve(ALL)
    const { open } = renderPanel({ group: 'THEME AI / GPU CHIPS' })
    await screen.findByTestId('terminal-grp-table')
    expect(asked()).not.toContain(SECTORS_URL)
    expect(screen.getByTestId('terminal-grp-name').textContent).toBe('AI / GPU Chips')
    expect(screen.getByTestId('terminal-grp-head').textContent).toContain('UCT theme')
    expect(symsOnScreen()).toEqual(['AAA', 'KKK'])
    expect(screen.getByTestId('terminal-grp-method').textContent).toContain('The curated stocks of UCT\'s AI / GPU Chips theme')
    fireEvent.click(screen.getByRole('button', { name: /^Open what drives AI \/ GPU Chips/ }))
    expect(open).toHaveBeenLastCalledWith('IMOV THEME AI_/_GPU_CHIPS')
    // the command IMOV is opened with names a theme IMOV can find
    expect(parseCommand('IMOV THEME AI_/_GPU_CHIPS')).toMatchObject({ ok: true, code: 'IMOV' })
  })
})

describe('GRP: a UCT theme the ranking does not hold', () => {
  it('its curated stocks are listed from the theme list, with no figure made up for the theme', async () => {
    serve(ALL)
    renderPanel({ group: 'THEME UCT 20' })
    await screen.findByTestId('terminal-grp-table')
    expect(asked()).toContain(THEMES_URL)
    expect(screen.getByTestId('terminal-grp-name').textContent).toBe('UCT 20')
    expect(screen.getByTestId('terminal-grp-change').textContent).toBe('n/a')
    expect(screen.getByTestId('terminal-grp-listed').textContent)
      .toContain('The ranking for this year has no figure for UCT 20, so the theme\'s own change is not shown.')
    await waitFor(() => expect(rowsOf().map(cells)).toEqual([
      ['1AAA', '+212.5%', '99', 'Bullish, building', 'Semiconductors'],
      ['2NVDA', '+30.0%', 'n/a', '', 'Semiconductors'],
    ]))
    // ⛔ an engine-suggested member is never listed
    expect(document.body.textContent).not.toContain('ENGX')
    expect(screen.getByTestId('terminal-grp-method').textContent).not.toContain('caps its best stocks')
  })

  it('⛔ a theme with no curated stocks says so: never an empty table, never its suggested names', async () => {
    serve(ALL)
    renderPanel({ group: 'QUANTUM COMPUTING' })
    const none = await screen.findByTestId('terminal-grp-no-members')
    expect(none.getAttribute('data-kind')).toBe('empty')
    expect(none.textContent).toContain('Quantum Computing is a UCT theme with no stocks to rank.')
    expect(none.textContent).toContain('It holds no curated stocks. Suggested members are not counted or listed.')
    expect(screen.queryByTestId('terminal-grp-table')).toBeNull()
    expect(screen.queryByTestId('terminal-grp-unknown')).toBeNull()
    expect(document.body.textContent).not.toContain('ENGY')
    expect(asked()).not.toContain(GROUP_RS_URL)
  })

  it('a theme list that cannot be read leaves the honest "no group called that"', async () => {
    serve({ ...ALL, [THEMES_URL]: fail(500) })
    renderPanel({ group: 'THEME UCT 20' })
    const unknown = await screen.findByTestId('terminal-grp-unknown')
    expect(unknown.textContent).toContain('No UCT theme is called "UCT 20".')
    expect(screen.queryByTestId('terminal-grp-no-members')).toBeNull()
  })
})

describe('GRP: each side read fails apart', () => {
  it('⛔ a failed stock ranking leaves the stocks listed with no change (never 0%), and Retry fills them in', async () => {
    serve({ ...ALL, [STOCKS_URL]: fail(500) })
    renderPanel({ group: 'XLK' })
    const failed = await screen.findByTestId('terminal-grp-stocks-failed')
    expect(failed.textContent).toContain('Each stock\'s own change could not be read just now. The stocks are listed without it; that is not a change of 0%.')
    expect(rowsOf()).toHaveLength(8)
    expect(rowsOf().map((r) => cells(r)[1])).toEqual(Array(8).fill('n/a'))
    expect(document.body.textContent).not.toContain('0.0%')
    // the sector's own figure came from the read that worked, and the count is not a breadth
    expect(screen.getByTestId('terminal-grp-change').textContent).toBe('+38.3%')
    expect(screen.getByTestId('terminal-grp-totals').textContent).toBe('8 stocks, from the close of 2025-12-31 to the close of 2026-11-17.')
    serve(ALL)
    fireEvent.click(within(failed).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(screen.queryByTestId('terminal-grp-stocks-failed')).toBeNull())
    expect(cells(rowsOf()[0])[1]).toBe('+212.5%')
  })

  it('a stock ranking still being worked out says so over the listed stocks', async () => {
    serve({ ...ALL, [STOCKS_URL]: { status: 'computing', results: [], count: 0, as_of: null } })
    renderPanel({ group: 'XLK' })
    expect((await screen.findByTestId('terminal-grp-stocks-computing')).textContent).toContain('still working out each stock\'s own change')
    expect(rowsOf().map((r) => cells(r)[1])).toEqual(Array(8).fill('n/a'))
  })

  it('⛔ a failed RS read empties the RS column and says so; it is never a rank of 0 or "outside the universe"', async () => {
    serve({ ...ALL, [GROUP_RS_URL]: fail(500) })
    renderPanel({ group: 'XLK' })
    const note = await screen.findByTestId('terminal-grp-rs-failed')
    expect(note.textContent).toContain('The RS ranking could not be read just now. The RS column is empty; that is not a rank of 0.')
    expect(rowsOf().map((r) => cells(r)[2])).toEqual(Array(8).fill(''))
    await waitFor(() => expect(cells(rowsOf()[0])).toEqual(['1AAA', '+212.5%', '', 'Bullish, building', 'Semiconductors']))
    serve(ALL)
    fireEvent.click(within(note).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(cells(rowsOf()[0])[2]).toBe('99'))
    expect(screen.queryByTestId('terminal-grp-rs-failed')).toBeNull()
  })

  it('RS behind a paywall has no Retry; a cold RS cache says it is being prepared', async () => {
    serve({ ...ALL, [GROUP_RS_URL]: fail(402) })
    renderPanel({ group: 'XLK' })
    const locked = await screen.findByTestId('terminal-grp-rs-failed')
    expect(locked.textContent).toContain('The RS ranking needs a paid plan.')
    expect(within(locked).queryByRole('button')).toBeNull()
    cleanup()
    serve({ ...ALL, [GROUP_RS_URL]: fail(503, { body: { status: 'warming' } }) })
    renderPanel({ group: 'XLK' })
    const warming = await screen.findByTestId('terminal-grp-rs-warming')
    expect(warming.textContent).toContain('The server is preparing the RS ranks, so the RS column is empty for now.')
    expect(screen.queryByTestId('terminal-grp-rs-failed')).toBeNull()
    expect(rowsOf().map((r) => cells(r)[2])).toEqual(Array(8).fill(''))
  })

  it('a failed or warming confluence board empties the Flow column and says so', async () => {
    serve({ ...ALL, [CONFLUENCE_URL]: fail(500) })
    renderPanel({ group: 'XLK' })
    const note = await screen.findByTestId('terminal-grp-flow-failed')
    expect(note.textContent).toContain('The confluence board could not be read just now. The Flow column is empty; that is not the same as no stock being on the board.')
    expect(rowsOf().map((r) => cells(r)[3])).toEqual(Array(8).fill(''))
    await waitFor(() => expect(cells(rowsOf()[0])).toEqual(['1AAA', '+212.5%', '99', '', 'Semiconductors']))
    cleanup()
    serve({ ...ALL, [CONFLUENCE_URL]: { ok: false, status: 'warming', reason: 'cold', rows: [] } })
    renderPanel({ group: 'XLK' })
    expect((await screen.findByTestId('terminal-grp-flow-warming')).textContent).toContain('putting the confluence board together')
    expect(screen.queryByTestId('terminal-grp-flow-failed')).toBeNull()
    cleanup()
    serve({ ...ALL, [CONFLUENCE_URL]: { ok: false, status: 'flow_unavailable', rows: [] } })
    renderPanel({ group: 'XLK' })
    expect(await screen.findByTestId('terminal-grp-flow-failed')).toBeTruthy()
  })
})

describe('GRP writes its picks into the command', () => {
  it('a range chip writes the resolved group and the range; the default range is the bare group', async () => {
    serve(ALL)
    const { rerun } = renderPanel({ group: 'XLK' }, { code: 'GRP' })
    await screen.findByTestId('terminal-grp-table')
    fireEvent.click(screen.getByTestId('terminal-grp-range-m3'))
    expect(rerun).toHaveBeenLastCalledWith('GRP XLK 3M')
    fireEvent.click(screen.getByTestId('terminal-grp-range-ytd'))
    expect(rerun).toHaveBeenLastCalledWith('GRP XLK')
    fireEvent.click(screen.getByTestId('terminal-grp-range-y1'))
    expect(rerun).toHaveBeenLastCalledWith('GRP XLK 1Y')
    await screen.findByTestId('terminal-grp-error')   // this fixture serves no 1 year answer
  })

  it('a half-typed name is written as the group it resolved to, with its kind word', async () => {
    serve({ ...ALL, [listUrl('sector', M3)]: SECTORS, [listUrl('industry', M3)]: INDUSTRIES, [listUrl('theme', M3)]: THEMES_LIST, [periodChangeUrl(...M3)]: STOCKS })
    const { rerun } = renderPanel({ group: 'TECH' }, { code: 'GRP' })
    await screen.findByTestId('terminal-grp-table')
    expect(screen.getByTestId('terminal-grp-name').textContent).toBe('Technology')
    fireEvent.click(screen.getByTestId('terminal-grp-range-m3'))
    expect(rerun).toHaveBeenLastCalledWith('GRP SECTOR TECHNOLOGY 3M')
    await settled()
  })

  it('before a group is known, a range chip keeps what was typed', async () => {
    serve({ [SECTORS_URL]: PENDING, [INDUSTRIES_URL]: PENDING, [THEMES_LIST_URL]: PENDING, [STOCKS_URL]: PENDING })
    const { rerun } = renderPanel({ group: 'GOLD' }, { code: 'GRP' })
    fireEvent.click(screen.getByTestId('terminal-grp-range-m6'))
    expect(rerun).toHaveBeenLastCalledWith('GRP GOLD 6M')
    await screen.findByTestId('terminal-grp-error')   // this fixture serves no 6 month answer
  })

  it('outside the shell a range chip is the panel\'s own state and asks for the new range', async () => {
    serve({ ...ALL, [listUrl('sector', M3)]: groups('sector', [{ name: 'Technology', period_change: 7.7, count: 1, members: ['AAA'] }]), [periodChangeUrl(...M3)]: STOCKS })
    render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}><GroupDrillPanel group="XLK" /></SWRConfig>)
    await screen.findByTestId('terminal-grp-table')
    expect(screen.getByTestId('terminal-grp-change').textContent).toBe('+38.3%')
    fireEvent.click(screen.getByTestId('terminal-grp-range-m3'))
    await waitFor(() => expect(screen.getByTestId('terminal-grp-change').textContent).toBe('+7.7%'))
    expect(screen.getByTestId('terminal-grp-range-m3').getAttribute('aria-pressed')).toBe('true')
    expect(symsOnScreen()).toEqual(['AAA'])
  })
})

describe('GRP is registered', () => {
  it('the registry mounts this panel and hands it the typed group and range', async () => {
    const mod = await PANEL_IMPORTERS[BY_CODE.GRP.market.panel]()
    expect(mod.default).toBe(GroupDrillPanel)
    expect(BY_CODE.GRP.ticker).toBeUndefined()
    const cmd = parseCommand('grp theme ai / gpu chips 3m')
    expect(cmd).toMatchObject({ ok: true, code: 'GRP', sym: null, args: ['THEME', 'AI', '/', 'GPU', 'CHIPS', '3M'] })
    expect(applyArgs(BY_CODE.GRP.market, cmd.args)).toMatchObject({ props: { group: 'THEME AI / GPU CHIPS', range: 'm3' }, ignored: [] })
  })
})

describe('GRP: the group\'s own fundamentals and breadth (two sections above the list)', () => {
  it('⭐ a sector shows both sections, closed, ABOVE its ranked list, and the list is exactly as before', async () => {
    serve(ALL)
    renderPanel({ group: 'XLK' })
    await settled()
    const stats = await screen.findByTestId('terminal-grp-stats')
    const table = screen.getByTestId('terminal-grp-table')
    expect(stats.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByTestId('terminal-grp-fund-line').textContent).toContain('median revenue growth 14.2% (of 46)')
    expect(screen.getByTestId('terminal-grp-breadth-line').textContent).toContain('58% above the 50-day')
    expect(screen.getAllByRole('table')).toHaveLength(1)        // closed sections draw no table of their own
    expect(rowsOf().map(cells)[0]).toEqual(['1AAA', '+212.5%', '99', 'Bullish, building', 'Semiconductors'])
    expect(asked()).toContain(TECH_STATS_URL)
  })

  it('a UCT theme reads no group figures and says they are for sectors and industries', async () => {
    serve(ALL)
    renderPanel({ group: 'THEME AI / GPU CHIPS' })
    await screen.findByTestId('terminal-grp-table')
    expect(screen.getByTestId('terminal-grp-stats-theme').textContent).toContain('not for UCT themes')
    expect(asked().some((u) => u.startsWith('/api/research/group-stats'))).toBe(false)
  })

  it('a failed read of the group figures is one line; the ranked list stands', async () => {
    serve({ ...ALL, [TECH_STATS_URL]: fail(500) })
    renderPanel({ group: 'XLK' })
    await settled()
    expect((await screen.findByTestId('terminal-grp-stats-error')).textContent).toContain('The stocks below are not affected.')
    expect(rowsOf()).toHaveLength(8)
  })
})

describe('GRP follows the member\'s theme', () => {
  it('the panel and its model hold no hard-coded color', () => {
    for (const f of ['GroupDrillPanel.jsx', 'groupDrillModel.js']) {
      const text = fs.readFileSync(path.join(HERE, f), 'utf8')
      expect(colourLiteralsIn(`pages/terminal/panels/${f}`, text).map((h) => h.lit), f).toEqual([])
    }
  })
})

describe('GRP accessibility', () => {
  it('the pick-a-group state and a populated sector pass axe (WCAG A and AA)', async () => {
    serve(ALL)
    renderPanel()
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve(ALL)
    renderPanel({ group: 'XLK' })
    await screen.findByTestId('terminal-grp-table')
    await waitFor(() => expect(cells(rowsOf()[0])[2]).toBe('99'))
    await expectNoAxeViolations(document.body.firstElementChild)
  }, 60_000)

  it('"which one?", "no group called that", the notes of failed side reads and a theme with no stocks pass axe', async () => {
    for (const [group, routes, testId] of [
      ['SEMI', ALL, 'terminal-grp-ambiguous'],
      ['GPU', ALL, 'terminal-grp-unknown'],
      ['QUANTUM COMPUTING', ALL, 'terminal-grp-no-members'],
      ['SEMICONDUCTORS', { ...ALL, [STOCKS_URL]: fail(500), [GROUP_RS_URL]: fail(500), [CONFLUENCE_URL]: fail(500) }, 'terminal-grp-flow-failed'],
    ]) {
      cleanup()
      serve(routes)
      renderPanel({ group })
      await screen.findByTestId(testId)
      await expectNoAxeViolations(document.body.firstElementChild)
    }
  }, 90_000)
})
