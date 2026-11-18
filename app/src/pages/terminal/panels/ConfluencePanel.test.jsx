// CONFL: the confluence board. Rails:
//   * ONE url is read: the 30-day window the server keeps warm;
//   * loading, a failed read (error with Retry), a paywall and a switched-off route (no Retry),
//     signed out;
//   * the server's "warming" answer is a status that asks again, its "could not build" answer is
//     an error with Retry and its raw reason is never printed, and neither is an empty board; an
//     answer that is not the route's shape is an error;
//   * a healthy answer with no rows says nothing lines up;
//   * the long-dated share the server sends as a fraction is drawn as a percent, once;
//   * the bands are listed large first, row numbers follow the rows on screen, a symbol loads into
//     the linked panels;
//   * the chips filter the direction and write nothing back where the registry does not take the
//     word; a direction with no rows says so and offers every direction.
// The fixture is the route's real shape (api/confluence_screen.py compute_board), with made-up
// tickers.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
// The list alert switch has its own test (ListAlertSwitch.test.jsx). Here it is a marker, so this
// file's reads stay the panel's own, and one test at the end pins that the panel mounts it.
vi.mock('./ListAlertSwitch', async () => {
  const { createElement } = await import('react')
  return { default: ({ kind }) => createElement('span', { 'data-testid': 'list-alert-stub', 'data-kind': kind, hidden: true }) }
})
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import ConfluencePanel, { CONFLUENCE_URL, MAX_ROWS, contractText } from './ConfluencePanel'
import { stampedKey } from './marketRead'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const SOURCE = 'UCT dark pool and options flow'
const DASH = String.fromCharCode(0x2013)
/** The hyphen a date is drawn with, so it never breaks a line. */
const HY = String.fromCharCode(0x2011)
const NBSP = String.fromCharCode(160)
const BOARD = {
  ok: true,
  window: `Oct 6 ${DASH} Nov 14, 2026`,
  days: 30,
  rows: [
    {
      sym: 'AAA', band: 'L', dir: 'BULL', dpn: 1200000000, acc: 'Acc', net: 12400000.0, net5: 6000000.0, bull: 13000000.0, bear: 600000.0,
      bullPct: 96, top: { cp: 'C', strike: 420, exp: '1/15/2027', dte: 60, prem: 5200000.0 }, leapPrem: 6100000.0, leapShare: 0.482,
      status: 'BUILDING', freshRatio: 0.48, bigPrint: 88000000, bigDate: '11/03', dpLo: 170.5, dpHi: 195.25, dpAvg: 182.4, dpLast: 190.06,
      bigPrice: 181.0, sector: 'Technology', score: 2.732,
    },
    {
      sym: 'CCC', band: 'S', dir: 'BEAR', dpn: 41000000, acc: 'Dist', net: -3500000.0, net5: 0, bull: 100000.0, bear: 3600000.0,
      bullPct: 3, top: { cp: 'P', strike: 27.5, exp: '3/19/2027', dte: 123, prem: 2100000.0 }, leapPrem: 800000.0, leapShare: 0.216,
      status: 'ESTABLISHED', freshRatio: 0, bigPrint: 9000000, bigDate: '10/21', dpLo: 26.0, dpHi: 33.1, dpAvg: 30.0, dpLast: 28.5,
      bigPrice: 31.2, sector: null, score: 2.1,
    },
    {
      sym: 'BBB', band: 'M', dir: 'BULL', dpn: 90000000, acc: null, net: 4000000.0, net5: 800000.0, bull: 4400000.0, bear: 400000.0,
      bullPct: 92, top: { cp: 'C', strike: 55, exp: '6/18/2027', dte: 0, prem: 0 }, leapPrem: 3200000.0, leapShare: 0.8,
      status: 'STEADY', freshRatio: 0.2, bigPrint: 0, bigDate: null, dpLo: null, dpHi: null, dpAvg: null, dpLast: 61.2,
      bigPrice: null, sector: 'Industrials', score: 1.9,
    },
  ],
  counts: { total: 3, bull: 2, bear: 1, building: 1 },
  band_meta: { L: ['Large Cap', `$10B ${DASH} $500B`], M: ['Mid Cap', `$2B ${DASH} $10B`], S: ['Small Cap', '< $2B'] },
  allowedDays: [20, 30, 60, 90],
  warnings: null,
}
const WARMING = { ok: false, status: 'warming', reason: 'board is computing, try again shortly', rows: [] }
const DEGRADED = { ok: false, status: 'flow_unavailable', rows: [], days: 30, reason: 'flow-leg large/30d: timed out' }

const fail = (status) => Object.assign(new Error(`http ${status}`), { status })
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
const asked = () => jsonFetcher.mock.calls.map(([url]) => url)

function renderPanel(props = {}, { run = vi.fn(), rerun = vi.fn(), publishRows = vi.fn(), setFreshness = vi.fn(), code = null } = {}) {
  const body = <ConfluencePanel {...props} />
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelFreshnessContext.Provider value={setFreshness}>
        <PanelListContext.Provider value={{ open: vi.fn(), run, rerun, publish: vi.fn(), publishRows }}>
          {code ? <TerminalPanelContext.Provider value={{ code, density: 'comfortable', inset: true }}>{body}</TerminalPanelContext.Provider> : body}
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>,
  )
  return { run, rerun, publishRows, setFreshness }
}
const rowsOf = (testId) => within(screen.getByTestId(testId)).getAllByRole('row').slice(1)
const allRows = () => screen.getAllByTestId(/^terminal-confl-row-/)
const syms = () => allRows().map((r) => r.getAttribute('data-testid').replace('terminal-confl-row-', ''))
const HERE = path.dirname(fileURLToPath(import.meta.url))

beforeEach(() => { jsonFetcher.mockReset() })
afterEach(cleanup)

describe('CONFL states', () => {
  it('shows a loading skeleton, and asks only for the 30-day window', () => {
    serve({ [CONFLUENCE_URL]: PENDING })
    renderPanel()
    expect(screen.getByTestId('terminal-confl-loading')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    expect(asked()).toEqual(['/api/confluence?days=30'])
    expect(stampedKey(CONFLUENCE_URL)).toEqual(['/api/confluence?days=30', 'terminal-stamped'])
  })

  it('a failed read (500) is an error with Retry, never an empty board', async () => {
    serve({})
    renderPanel({}, { code: 'CONFX' })
    const err = await screen.findByTestId('terminal-confl-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('The confluence board could not be read just now.')
    expect(err.textContent).toContain('That is not the same as an empty board. Retry, or run CONFX again.')
    expect(screen.queryByTestId('terminal-confl-empty')).toBeNull()
    serve({ [CONFLUENCE_URL]: BOARD })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-confl-band-L')).toBeTruthy()
  })

  it('signed out (401) and locked (402, 404) each say so; only a retryable failure offers Retry', async () => {
    for (const [status, kind, words] of [
      [401, 'error', 'You are signed out, so the confluence board cannot be read. Sign in again.'],
      [402, 'locked', 'The confluence board needs a paid plan.'],
      [404, 'locked', 'The confluence board is not switched on for this server yet.'],
    ]) {
      cleanup()
      serve({ [CONFLUENCE_URL]: fail(status) })
      renderPanel()
      const state = await screen.findByTestId('terminal-confl-error')
      expect(state.getAttribute('data-kind'), String(status)).toBe(kind)
      expect(state.textContent).toContain(words)
      expect(!!screen.queryByRole('button', { name: 'Retry' }), String(status)).toBe(kind === 'error')
      expect(screen.queryByTestId('terminal-confl-empty')).toBeNull()
    }
  })

  it('"warming" says the server is putting the board together: not empty, not an error', async () => {
    serve({ [CONFLUENCE_URL]: WARMING })
    const { setFreshness } = renderPanel()
    const warming = await screen.findByTestId('terminal-confl-warming')
    expect(warming.getAttribute('data-kind')).toBe('empty')
    expect(warming.getAttribute('role')).toBe('status')
    expect(warming.textContent).toContain('Loading, the server is preparing this.')
    expect(warming.textContent).toContain('This panel asks again every 20 seconds and fills in on its own.')
    expect(warming.textContent).toContain('That is not the same as nothing lining up.')
    expect(screen.queryByTestId('terminal-confl-empty')).toBeNull()
    expect(screen.queryByTestId('terminal-confl-error')).toBeNull()
    expect(setFreshness.mock.calls.every(([report]) => report == null)).toBe(true)
  })

  it('a board the server could not build is an error with Retry, and its raw reason is never printed', async () => {
    serve({ [CONFLUENCE_URL]: DEGRADED })
    renderPanel({}, { code: 'CONFX' })
    const err = await screen.findByTestId('terminal-confl-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('The server could not build the confluence board just now.')
    expect(err.textContent).toContain('That is not the same as nothing lining up. Retry, or run CONFX again.')
    expect(document.body.textContent).not.toContain('timed out')
    expect(screen.queryByTestId('terminal-confl-empty')).toBeNull()
    serve({ [CONFLUENCE_URL]: BOARD })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-confl-band-L')).toBeTruthy()
  })

  it('an answer that is not the route\'s shape is an error, not an empty board', async () => {
    serve({ [CONFLUENCE_URL]: { rows: [] } })
    renderPanel()
    const err = await screen.findByTestId('terminal-confl-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('The confluence board could not be read just now.')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(screen.queryByTestId('terminal-confl-empty')).toBeNull()
  })

  it('a healthy answer with no rows says nothing lines up, and can be checked again', async () => {
    serve({ [CONFLUENCE_URL]: { ...BOARD, rows: [], counts: { total: 0, bull: 0, bear: 0, building: 0 } } })
    const { setFreshness } = renderPanel()
    const empty = await screen.findByTestId('terminal-confl-empty')
    expect(empty.getAttribute('data-kind')).toBe('empty')
    expect(empty.textContent).toContain('No stock has both dark pool size and long-dated options flow lined up over the last 30 trading days.')
    expect(empty.textContent).toContain('That is what the server worked out, not a failed read.')
    expect(setFreshness.mock.calls.every(([report]) => report == null)).toBe(true)
    serve({ [CONFLUENCE_URL]: BOARD })
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(await screen.findByTestId('terminal-confl-band-L')).toBeTruthy()
  })
})

describe('CONFL populated', () => {
  it('lists each size band, large first, with the direction, the flow, the long-dated share and the dark pool', async () => {
    serve({ [CONFLUENCE_URL]: BOARD })
    const { setFreshness, publishRows } = renderPanel()
    await screen.findByTestId('terminal-confl-band-L')
    // the server ranks AAA, CCC, BBB; the screen lists large, mid, small
    expect(syms()).toEqual(['AAA', 'BBB', 'CCC'])
    const cells = allRows().map((r) => r.textContent)
    for (const s of ['1', 'AAA', 'Bullish, building', '+$12.4M', '$6.1M', '(48%)', '$1.20B', `avg${NBSP}$182.40`, `last${NBSP}+4.2%`, `$420 call, expires 2027${HY}01${HY}15`]) expect(cells[0]).toContain(s)
    for (const s of ['2', 'BBB', 'Bullish, steady', '+$4.0M', '$3.2M', '(80%)', '$90.0M', `$55 call, expires 2027${HY}06${HY}18`]) expect(cells[1]).toContain(s)
    // no average price was sent for BBB: nothing is drawn for it, and never a $0.00
    expect(cells[1]).not.toContain('avg')
    expect(cells[1]).not.toContain('last')
    expect(cells[1]).not.toContain('$0')
    for (const s of ['3', 'CCC', 'Bearish, established', '-$3.5M', '$800K', '(22%)', '$41.0M', `avg${NBSP}$30.00`, `last${NBSP}-5.0%`, `$27.50 put, expires 2027${HY}03${HY}19`]) expect(cells[2]).toContain(s)
    // a share the server sends as 0.482 is 48%: never 0% and never 4820%
    expect(document.body.textContent).not.toContain('(0%)')
    expect(document.body.textContent).not.toContain('4820%')
    expect(rowsOf('terminal-confl-band-L')).toHaveLength(1)
    expect(screen.getByRole('table', { name: 'Confluence board, Large cap, 1 stock' })).toBeTruthy()
    expect(screen.getByRole('table', { name: 'Confluence board, Small cap, 1 stock' })).toBeTruthy()
    expect(within(screen.getByTestId('terminal-confl-band-L')).getByText('Large cap ($10B to $500B): 1')).toBeTruthy()
    expect(within(screen.getByTestId('terminal-confl-band-S')).getByText('Small cap (under $2B): 1')).toBeTruthy()
    expect(screen.getByTestId('terminal-confl-totals').textContent)
      .toBe('3 stocks where dark pool size and long-dated options flow line up over the last 30 trading days: 2 bullish, 1 bearish, 1 building now.')
    expect(screen.queryByTestId('terminal-confl-partial')).toBeNull()
    // the header: the source and the last day of the dark pool window, as a calendar date
    await waitFor(() => expect(setFreshness).toHaveBeenCalledWith({ source: SOURCE, age: { asOfDate: '2026-11-14' } }))
    // row N is the Nth row on screen
    expect(publishRows).toHaveBeenLastCalledWith(['$AAA', '$BBB', '$CCC'])
    const method = screen.getByTestId('terminal-confl-method').textContent
    expect(method).toContain('Dark pool window: Oct 6 to Nov 14, 2026.')
    expect(method).toContain('The server rebuilds this board about every 30 minutes and does not send its build time.')
    expect(method).toContain('it is not a forecast or a recommendation.')
    expect(method).toMatch(/Read at \d{1,2}:\d{2} [AP]M ET\./)
    expect(document.body.textContent).not.toMatch(/[—–]/)
    expect(asked().every((url) => url === CONFLUENCE_URL)).toBe(true)
  })

  it('contractText says a contract in plain words, and leaves out what the row lacks', () => {
    expect(contractText({ side: 'call', strike: 420, expiry: '2027-01-15' })).toBe('$420 call, expires 2027-01-15')
    expect(contractText({ side: 'put', strike: 27.5, expiry: null })).toBe('$27.50 put')
    expect(contractText({ side: null, strike: null, expiry: null })).toBe('Not given')
    expect(contractText(null)).toBe('Not given')
  })

  it('a symbol loads into the linked panels', async () => {
    serve({ [CONFLUENCE_URL]: BOARD })
    const { run } = renderPanel()
    await screen.findByTestId('terminal-confl-band-L')
    fireEvent.click(screen.getByTestId('panel-symbol-CCC'))
    expect(run).toHaveBeenCalledWith('$CCC')
  })

  it('says when the server marked the build incomplete', async () => {
    serve({ [CONFLUENCE_URL]: { ...BOARD, warnings: ['flow-leg mid_small/30d: timed out'] } })
    renderPanel()
    await screen.findByTestId('terminal-confl-band-L')
    expect(screen.getByTestId('terminal-confl-partial').textContent)
      .toBe('The server marked this build as incomplete: part of the options flow answered late, so some stocks can be missing from this board.')
    expect(document.body.textContent).not.toContain('timed out')
  })

  it('draws a long board a hundred at a time, cut by the server\'s rank', async () => {
    const many = Array.from({ length: 120 }, (_, i) => ({
      ...BOARD.rows[0], sym: `T${String(i).padStart(3, '0')}`, band: i % 2 ? 'S' : 'L', score: 3 - i / 100,
    }))
    serve({ [CONFLUENCE_URL]: { ...BOARD, rows: many } })
    const { publishRows } = renderPanel()
    await screen.findByTestId('terminal-confl-band-L')
    expect(allRows()).toHaveLength(MAX_ROWS)
    // the first hundred by rank are T000 to T099, listed large (even) then small (odd)
    expect(syms().slice(0, 2)).toEqual(['T000', 'T002'])
    expect(syms()).not.toContain('T100')
    expect(screen.getByTestId('terminal-confl-method').textContent).toContain('Showing the 100 highest ranked of 120. ')
    expect(publishRows.mock.calls.at(-1)[0]).toHaveLength(100)
    fireEvent.click(screen.getByTestId('terminal-confl-all'))
    expect(allRows()).toHaveLength(120)
    expect(screen.getByTestId('terminal-confl-all').textContent).toBe('Show the first 100')
    expect(publishRows.mock.calls.at(-1)[0]).toHaveLength(120)
  })
})

describe('CONFL chips', () => {
  it('the chips filter the direction, and the row numbers follow the rows on screen', async () => {
    serve({ [CONFLUENCE_URL]: BOARD })
    const { rerun, publishRows } = renderPanel()
    await screen.findByTestId('terminal-confl-band-L')
    expect(screen.getByTestId('terminal-confl-lean-all').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByTestId('terminal-confl-lean-bearish'))
    expect(screen.getByTestId('terminal-confl').getAttribute('data-lean')).toBe('bearish')
    expect(screen.getByTestId('terminal-confl-lean-bearish').getAttribute('aria-pressed')).toBe('true')
    expect(syms()).toEqual(['CCC'])
    expect(allRows()[0].textContent.startsWith('1')).toBe(true)
    await waitFor(() => expect(publishRows).toHaveBeenLastCalledWith(['$CCC']))
    // the totals still describe the whole board
    expect(screen.getByTestId('terminal-confl-totals').textContent).toContain('2 bullish, 1 bearish')
    fireEvent.click(screen.getByTestId('terminal-confl-lean-bullish'))
    expect(syms()).toEqual(['AAA', 'BBB'])
    // outside a registered panel nothing is written back: the chip is plain component state
    expect(rerun).not.toHaveBeenCalled()
    // one read served all three views
    expect(asked()).toEqual([CONFLUENCE_URL])
  })

  it('the lean prop seeds the chip, and a typed word it does not know is every direction', async () => {
    serve({ [CONFLUENCE_URL]: BOARD })
    renderPanel({ lean: 'BEAR' })
    await screen.findByTestId('terminal-confl-band-S')
    expect(screen.getByTestId('terminal-confl').getAttribute('data-lean')).toBe('bearish')
    expect(syms()).toEqual(['CCC'])
    cleanup()
    renderPanel({ lean: 'sideways' })
    await screen.findByTestId('terminal-confl-band-L')
    expect(screen.getByTestId('terminal-confl').getAttribute('data-lean')).toBe('all')
  })

  it('a direction with no rows says so and offers every direction', async () => {
    serve({ [CONFLUENCE_URL]: { ...BOARD, rows: BOARD.rows.filter((r) => r.dir === 'BULL') } })
    renderPanel({ lean: 'bearish' })
    const none = await screen.findByTestId('terminal-confl-none')
    expect(none.textContent).toContain('No bearish names on the board right now.')
    expect(none.textContent).toContain('2 stocks are on the board in the other direction.')
    expect(screen.queryByRole('table')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show every direction' }))
    expect(syms()).toEqual(['AAA', 'BBB'])
  })

  it('inside a panel whose code does not take the word, the chip still filters and writes nothing', async () => {
    // MOST is a registered code whose market variant takes UP and DOWN, not BEAR.
    serve({ [CONFLUENCE_URL]: BOARD })
    const { rerun } = renderPanel({}, { code: 'MOST' })
    await screen.findByTestId('terminal-confl-band-L')
    fireEvent.click(screen.getByTestId('terminal-confl-lean-bearish'))
    expect(syms()).toEqual(['CCC'])
    expect(rerun).not.toHaveBeenCalled()
    // back to every direction is the bare command, which every code takes
    fireEvent.click(screen.getByTestId('terminal-confl-lean-all'))
    expect(rerun).toHaveBeenLastCalledWith('MOST')
  })
})

describe('CONFL follows the member\'s theme', () => {
  it('the panel and its model hold no hard-coded color', () => {
    for (const f of ['ConfluencePanel.jsx', 'confluenceModel.js']) {
      const text = fs.readFileSync(path.join(HERE, f), 'utf8')
      expect(colourLiteralsIn(`pages/terminal/panels/${f}`, text).map((h) => h.lit), f).toEqual([])
    }
  })
})

describe('CONFL accessibility', () => {
  it('the board and its empty direction pass axe (WCAG A and AA)', async () => {
    serve({ [CONFLUENCE_URL]: BOARD })
    renderPanel()
    await screen.findByTestId('terminal-confl-band-L')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    serve({ [CONFLUENCE_URL]: { ...BOARD, rows: BOARD.rows.filter((r) => r.dir === 'BULL') } })
    renderPanel({ lean: 'bearish' })
    await screen.findByTestId('terminal-confl-none')
    await expectNoAxeViolations(document.body.firstElementChild)
  }, 20_000)
})

describe('CONFL list alert', () => {
  it('mounts the "alert me" switch for the confluence board, outside the toolbar', async () => {
    serve({ [CONFLUENCE_URL]: BOARD })
    renderPanel()
    await screen.findByTestId('terminal-confl-band-L')
    const stub = screen.getByTestId('list-alert-stub')
    expect(stub.getAttribute('data-kind')).toBe('confluence')
    expect(stub.closest('[role="toolbar"]')).toBeNull()
  })
})
