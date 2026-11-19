// HILO: new highs and new lows of the day. Rails:
//   * the pure shaping: stock rows and group rows, the totals, the session, the scanner's own
//     "running" word, and which answer belongs to which view;
//   * loading, a failed read (error with Retry), a paywall and a switched-off route (no Retry);
//   * a closed market says closed and a scanner that is not running says so: neither is drawn as
//     "nothing made a new high", and neither shows a stale list as live;
//   * a quiet session (running, nothing yet) is the only "empty";
//   * a populated board: totals, both lists busiest first, the scanner's read time in the header,
//     and a plain statement that these are highs and lows of the day, not 52-week ones;
//   * a symbol loads into the linked panels; the numbered rows are the rows on screen;
//   * the chips: Highs / Lows cut the lists; Sectors / Industries / Themes rank groups, a group
//     opens its stocks, and the last view's rows are never shown as the next view's.
// The fixtures are the route's real shape (api/services/nhnl_live.py get_live), with made-up tickers.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const wire = vi.hoisted(() => ({ writeBack: null }))
vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
// The registry half of the write-back has its own test (commandWriteBack.test.jsx); here the panel's
// half is pinned: which words it hands over, and when.
vi.mock('./commandWriteBack', () => ({ usePanelWriteBack: () => wire.writeBack }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext } from '../../../components/terminal'
import HighsLowsPanel, {
  HILO_GROUPS, HILO_LIMIT, HILO_SESSIONS, HILO_SIDES, NHNL_LIVE_URL, highsLowsBoard, highsLowsCommandArgs, highsLowsUrl,
  isAnswerFor, normGroup, normSide,
} from './HighsLowsPanel'
import { stampedKey } from './marketRead'
import { NHNL_SERIES_URL, PULSE_MIN_POINTS } from './highsLowsPulseModel'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const ASOF = '2026-11-16T10:31:02.123456-05:00'
const high = (sym, price, pct, count, ts) => ({ sym, price, pct, count, ts, dir: 'high', pick: sym })
const low = (sym, price, pct, count, ts) => ({ sym, price, pct, count, ts, dir: 'low', pick: sym })
const base = { window: 'rth', date: '2026-11-16', asof: ASOF, ticks: 412, active: true, group: null, value: null, categories: {} }
const LIVE = {
  ...base,
  highs_total: 124,
  lows_total: 76,
  highs: [
    high('AAA', 391.62, 4.21, 222, '2026-11-16T10:30:58.000001-05:00'),
    high('BBB', 113.98, 1.05, 105, '2026-11-16T10:29:10.500000-05:00'),
    high('CCC', 18.11, null, 3, null),
  ],
  lows: [
    low('DDD', 104.54, -2.9, 193, '2026-11-16T10:31:00.250000-05:00'),
    low('EEE', 2.1, -11.4, 89, '2026-11-16T10:12:44.000000-05:00'),
  ],
}
const grp = (sym, count, dir, pick) => ({ sym, price: null, count, ts: ASOF, dir, group: true, pick })
const SECTORS = {
  ...base,
  group: 'sector',
  categories: { Technology: 14, Energy: 6, '—': 2 },
  highs_total: 2,
  lows_total: 2,
  highs: [grp('Technology', 12, 'high', 'XLK'), grp('Energy', 2, 'high', 'XLE')],
  lows: [grp('Energy', 4, 'low', 'XLE'), grp('—', 2, 'low', null)],
}
const TECH = {
  ...base,
  group: 'sector',
  value: 'Technology',
  categories: SECTORS.categories,
  highs_total: 2,
  lows_total: 0,
  highs: [LIVE.highs[0], LIVE.highs[1]],
  lows: [],
}
// After 8:00 PM the scanner keeps the last session's counters in memory and still sends them.
const CLOSED = { ...LIVE, window: 'closed', date: '2026-11-13', asof: '2026-11-14T09:00:00.000000-05:00', active: false }
// NHNL_SCANNER_ENABLED off during the session: nothing was ever counted.
const OFF = { ...base, date: null, asof: null, ticks: 0, active: false, highs_total: 0, lows_total: 0, highs: [], lows: [] }
const QUIET = { ...base, window: 'pre', ticks: 1, highs_total: 0, lows_total: 0, highs: [], lows: [] }

const URL_STOCKS = '/api/nhnl/live?limit=50'
const URL_SECTORS = '/api/nhnl/live?limit=50&group=sector'
const URL_TECH = '/api/nhnl/live?limit=50&group=sector&value=Technology'
const byUrl = (map) => async (url) => {
  if (url in map) return map[url]
  throw Object.assign(new Error(`unserved ${url}`), { status: 500 })
}

function renderPanel(props = {}, { run = vi.fn(), publishRows = vi.fn(), setFreshness = vi.fn() } = {}) {
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelFreshnessContext.Provider value={setFreshness}>
        <PanelListContext.Provider value={{ open: vi.fn(), run, rerun: vi.fn(), publish: vi.fn(), publishRows }}>
          <HighsLowsPanel {...props} />
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>,
  )
  return { run, publishRows, setFreshness }
}
const rowsOf = (testId) => within(screen.getByTestId(testId)).getAllByRole('row').slice(1)
const symsOf = (side) => rowsOf(`terminal-hilo-${side}`).map((r) => r.getAttribute('data-testid').replace(`terminal-hilo-${side}-row-`, ''))
const fail = (status) => Object.assign(new Error('x'), { status })
const HERE = path.dirname(fileURLToPath(import.meta.url))

beforeEach(() => { jsonFetcher.mockReset(); wire.writeBack = vi.fn(() => false) })
afterEach(cleanup)

describe('HILO pure shaping', () => {
  it('normSide, normGroup and the command arguments', () => {
    expect(Object.keys(HILO_SIDES)).toEqual(['both', 'highs', 'lows'])
    expect(Object.keys(HILO_GROUPS)).toEqual(['stocks', 'sector', 'industry', 'theme'])
    for (const [raw, want] of [['HIGHS', 'highs'], ['high', 'highs'], ['NH', 'highs'], ['lows', 'lows'], ['LOW', 'lows'], ['NL', 'lows'],
      ['both', 'both'], [null, 'both'], ['', 'both'], ['SECTOR', 'both']]) expect(normSide(raw), String(raw)).toBe(want)
    for (const [raw, want] of [['SECTOR', 'sector'], ['sectors', 'sector'], ['Industry', 'industry'], ['INDUSTRIES', 'industry'],
      ['theme', 'theme'], ['THEMES', 'theme'], ['stocks', 'stocks'], [null, 'stocks'], ['LOWS', 'stocks']]) expect(normGroup(raw), String(raw)).toBe(want)
    expect(highsLowsCommandArgs()).toEqual([])
    expect(highsLowsCommandArgs({ side: 'both', group: 'stocks' })).toEqual([])
    expect(highsLowsCommandArgs({ side: 'lows' })).toEqual(['LOWS'])
    expect(highsLowsCommandArgs({ side: 'highs', group: 'industry' })).toEqual(['HIGHS', 'INDUSTRY'])
    expect(highsLowsCommandArgs({ group: 'theme' })).toEqual(['THEME'])
    // every word the chips write is read back to the same choice
    for (const [key, s] of Object.entries(HILO_SIDES)) if (s.token) expect(normSide(s.token)).toBe(key)
    for (const [key, g] of Object.entries(HILO_GROUPS)) {
      if (g.token) expect(normGroup(g.token)).toBe(key)
      expect(g.param).toBe(key === 'stocks' ? null : key)   // the route's own `group` values
    }
  })

  it('the URL follows the view', () => {
    expect(NHNL_LIVE_URL).toBe('/api/nhnl/live')
    expect(HILO_LIMIT).toBe(50)
    expect(highsLowsUrl()).toBe(URL_STOCKS)
    expect(highsLowsUrl({ group: 'sector' })).toBe(URL_SECTORS)
    expect(highsLowsUrl({ group: 'SECTOR', value: 'Technology' })).toBe(URL_TECH)
    expect(highsLowsUrl({ group: 'industry', value: 'Banks - Regional' })).toBe('/api/nhnl/live?limit=50&group=industry&value=Banks+-+Regional')
    // a value means nothing without a group, and a price floor is sent only when there is one
    expect(highsLowsUrl({ value: 'Technology' })).toBe(URL_STOCKS)
    expect(highsLowsUrl({ limit: 10, minPrice: 5 })).toBe('/api/nhnl/live?limit=10&min_price=5')
    expect(stampedKey(highsLowsUrl())).toEqual([URL_STOCKS, 'terminal-stamped'])
  })

  it('isAnswerFor matches an answer to its view by the route\'s own echo', () => {
    expect(isAnswerFor(LIVE, {})).toBe(true)
    expect(isAnswerFor(LIVE, { group: 'stocks', value: 'ignored' })).toBe(true)
    expect(isAnswerFor(LIVE, { group: 'sector' })).toBe(false)
    expect(isAnswerFor(SECTORS, { group: 'sector' })).toBe(true)
    expect(isAnswerFor(SECTORS, { group: 'sector', value: 'Technology' })).toBe(false)
    expect(isAnswerFor(SECTORS, { group: 'theme' })).toBe(false)
    expect(isAnswerFor(TECH, { group: 'sector', value: 'Technology' })).toBe(true)
    expect(isAnswerFor(TECH, { group: 'sector', value: 'Energy' })).toBe(false)
    expect(isAnswerFor(TECH, {})).toBe(false)
    for (const bad of [undefined, null, [], 'x']) expect(isAnswerFor(bad, {})).toBe(false)
  })

  it('highsLowsBoard: stocks, busiest first as sent, with the totals of the whole view', () => {
    const board = highsLowsBoard(LIVE)
    expect(board).toMatchObject({
      window: 'rth', active: true, date: '2026-11-16', group: 'stocks', value: null, grouped: false, highsTotal: 124, lowsTotal: 76,
    })
    // microseconds are cut to milliseconds so every browser reads the instant
    expect(board.asOf).toBe('2026-11-16T10:31:02.123-05:00')
    expect(board.highs).toEqual([
      { key: 'highs-AAA', order: 0, count: 222, at: '2026-11-16T10:30:58.000-05:00', sym: 'AAA', price: 391.62, pct: 4.21 },
      { key: 'highs-BBB', order: 1, count: 105, at: '2026-11-16T10:29:10.500-05:00', sym: 'BBB', price: 113.98, pct: 1.05 },
      { key: 'highs-CCC', order: 2, count: 3, at: null, sym: 'CCC', price: 18.11, pct: null },
    ])
    expect(board.lows.map((r) => [r.sym, r.pct, r.count])).toEqual([['DDD', -2.9, 193], ['EEE', -11.4, 89]])
  })

  it('highsLowsBoard: a group overview is groups, a drill is that group\'s stocks', () => {
    const over = highsLowsBoard(SECTORS)
    expect(over).toMatchObject({ group: 'sector', value: null, grouped: true, highsTotal: 2, lowsTotal: 2 })
    expect(over.highs.map((r) => [r.name, r.label, r.count, r.fund])).toEqual([['Technology', 'Technology', 12, 'XLK'], ['Energy', 'Energy', 2, 'XLE']])
    // the server names an unplaced stock's group with a dash: it is shown in words, and kept as sent for the drill
    expect(over.lows[1]).toMatchObject({ name: '—', label: 'Not classified', count: 2, fund: null })
    expect(over.highs[0].sym).toBeUndefined()
    const drill = highsLowsBoard(TECH)
    expect(drill).toMatchObject({ group: 'sector', value: 'Technology', grouped: false, highsTotal: 2, lowsTotal: 0 })
    expect(drill.highs.map((r) => r.sym)).toEqual(['AAA', 'BBB'])
    expect(drill.lows).toEqual([])
  })

  it('highsLowsBoard: closed and not-running are carried as sent, never turned into "active"', () => {
    expect(highsLowsBoard(CLOSED)).toMatchObject({ window: 'closed', active: false, date: '2026-11-13' })
    expect(highsLowsBoard(CLOSED).highs).toHaveLength(3)
    expect(highsLowsBoard(OFF)).toMatchObject({ window: 'rth', active: false, asOf: null, date: null, highsTotal: 0, lowsTotal: 0 })
    expect(highsLowsBoard({ ...LIVE, active: 'yes' }).active).toBe(false)
    expect(highsLowsBoard({ ...LIVE, window: 'lunch' }).window).toBeNull()
    expect(Object.keys(HILO_SESSIONS)).toEqual(['rth', 'pre', 'post', 'closed'])
  })

  it('highsLowsBoard: an empty or malformed body is an empty board; a repeated or nameless row is dropped', () => {
    for (const body of [undefined, null, [], 'x', {}, { detail: 'The NH-NL scanner requires a paid plan' }]) {
      expect(highsLowsBoard(body)).toMatchObject({ window: null, active: false, highs: [], lows: [], highsTotal: 0, lowsTotal: 0, grouped: false })
    }
    const board = highsLowsBoard({ ...base, highs_total: 1, lows_total: 'many', highs: [high('aaa', 1, 1, 2, null), high('aaa', 1, 1, 1, null), { price: 5 }, null], lows: 'no' })
    expect(board.highs.map((r) => r.sym)).toEqual(['AAA'])
    expect(board.lows).toEqual([])
    expect(board.lowsTotal).toBe(0)
    // the total is never below the rows actually held
    expect(highsLowsBoard({ ...LIVE, highs_total: 1 }).highsTotal).toBe(3)
  })
})

describe('HILO panel states', () => {
  it('shows a loading skeleton, with the chips already there', () => {
    jsonFetcher.mockReturnValue(new Promise(() => {}))
    renderPanel()
    expect(screen.getByTestId('terminal-hilo-loading')).toBeTruthy()
    expect(screen.getByTestId('terminal-hilo-side-both').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('terminal-hilo-group-stocks').getAttribute('aria-pressed')).toBe('true')
    expect(jsonFetcher).toHaveBeenCalledWith(URL_STOCKS)
  })

  it('a failed read is an error with Retry, and says it is not a quiet market', async () => {
    jsonFetcher.mockRejectedValueOnce(fail(500))
    renderPanel()
    const err = await screen.findByTestId('terminal-hilo-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('New highs and lows could not be read just now.')
    expect(err.textContent).toContain('not the same as a quiet market')
    expect(screen.queryByTestId('terminal-hilo-empty')).toBeNull()
    jsonFetcher.mockResolvedValueOnce(LIVE)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-hilo-highs')).toBeTruthy()
  })

  it('a 402 says paid plan and a 404 says not switched on, both locked with no Retry', async () => {
    jsonFetcher.mockRejectedValueOnce(fail(402))
    renderPanel()
    const paid = await screen.findByTestId('terminal-hilo-error')
    expect(paid.getAttribute('data-kind')).toBe('locked')
    expect(paid.textContent).toContain('New highs and lows needs a paid plan.')
    expect(screen.queryByRole('button')).toBeNull()
    cleanup()
    jsonFetcher.mockRejectedValueOnce(fail(404))
    renderPanel()
    const off = await screen.findByTestId('terminal-hilo-error')
    expect(off.getAttribute('data-kind')).toBe('locked')
    expect(off.textContent).toContain('New highs and lows is not switched on for this server yet.')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('a closed market says closed and does not show the last session\'s list as live', async () => {
    jsonFetcher.mockResolvedValue(CLOSED)
    const { setFreshness, publishRows } = renderPanel()
    const closed = await screen.findByTestId('terminal-hilo-closed')
    expect(closed.textContent).toContain('The market is closed.')
    expect(closed.textContent).toContain('4:00 AM to 8:00 PM Eastern')
    expect(screen.queryByTestId('terminal-hilo-highs')).toBeNull()
    expect(screen.queryByTestId('panel-symbol-AAA')).toBeNull()
    expect(setFreshness.mock.calls.every(([report]) => report == null)).toBe(true)
    expect(publishRows).toHaveBeenLastCalledWith([])
  })

  it('a scanner that is not running says so, never "nothing made a new high"', async () => {
    jsonFetcher.mockResolvedValue(OFF)
    renderPanel()
    const off = await screen.findByTestId('terminal-hilo-off')
    expect(off.getAttribute('data-kind')).toBe('locked')
    expect(off.textContent).toContain('The new highs and lows scanner is not running on this server right now.')
    expect(off.textContent).toContain('not the same as no stock making a new high or low')
    expect(screen.queryByTestId('terminal-hilo-empty')).toBeNull()
    expect(screen.queryByTestId('terminal-hilo-totals')).toBeNull()
  })

  it('a running scanner with nothing yet is the one empty state, and keeps the chips', async () => {
    jsonFetcher.mockResolvedValue(QUIET)
    renderPanel()
    const empty = await screen.findByTestId('terminal-hilo-empty')
    expect(empty.getAttribute('data-kind')).toBe('empty')
    expect(empty.textContent).toContain('Nothing has made a new high or low yet this session.')
    expect(screen.getByTestId('terminal-hilo').getAttribute('data-session')).toBe('pre')
    fireEvent.click(screen.getByTestId('terminal-hilo-side-lows'))
    expect(screen.getByTestId('terminal-hilo-empty').textContent).toContain('Nothing has made a new low yet this session.')
  })
})

describe('HILO panel, populated', () => {
  it('shows the totals, both lists busiest first, and the scanner\'s read time in the header', async () => {
    jsonFetcher.mockResolvedValue(LIVE)
    const { setFreshness } = renderPanel()
    await screen.findByTestId('terminal-hilo-highs')
    expect(screen.getByTestId('terminal-hilo-session').textContent).toBe('Regular session')
    expect(screen.getByTestId('terminal-hilo-totals').textContent).toBe('124 stocks at a new high of the day, 76 at a new low.')
    const [up, down] = screen.getByTestId('terminal-hilo-split').children
    expect(up.style.width).toBe('62%')
    expect(down.style.width).toBe('38%')
    expect(screen.getByRole('table', { name: 'New highs (124)' })).toBeTruthy()
    expect(screen.getByRole('table', { name: 'New lows (76)' })).toBeTruthy()
    expect(symsOf('highs')).toEqual(['AAA', 'BBB', 'CCC'])
    expect(symsOf('lows')).toEqual(['DDD', 'EEE'])
    const aaa = screen.getByTestId('terminal-hilo-highs-row-AAA').textContent
    for (const s of ['1', 'AAA', '$391.62', '+4.21%', '222', '10:30 AM']) expect(aaa).toContain(s)
    // a missing change or time is said in words, never drawn as 0 or a dash
    const ccc = screen.getByTestId('terminal-hilo-highs-row-CCC').textContent
    expect(ccc).toContain('$18.11')
    expect(ccc.match(/Not given/g)).toHaveLength(2)
    // the lows carry on the numbering: DDD is row 4
    const ddd = screen.getByTestId('terminal-hilo-lows-row-DDD').textContent
    for (const s of ['4', 'DDD', '$104.54', '-2.90%', '193', '10:31 AM']) expect(ddd).toContain(s)
    await waitFor(() => expect(setFreshness).toHaveBeenCalledWith({
      source: 'UCT new highs and lows scanner',
      observedAt: '2026-11-16T15:31:02.123Z',
      age: { asOfDate: 'Nov 16, 10:31 AM ET' },
    }))
    const method = screen.getByTestId('terminal-hilo-method').textContent
    expect(method).toContain('Showing the busiest 3 of 124 new highs. Showing the busiest 2 of 76 new lows.')
    expect(method).toContain('These are new highs and lows of the day, not 52-week highs and lows.')
    expect(method).toContain('Scanner read at 10:31 AM ET.')
    expect(document.body.textContent).not.toMatch(/[—–]/)
  })

  it('names the session it is counting: a pre-market high is not a high of the day', async () => {
    jsonFetcher.mockResolvedValue({ ...LIVE, window: 'pre', highs_total: 1, lows_total: 0, highs: [LIVE.highs[0]], lows: [] })
    renderPanel()
    await screen.findByTestId('terminal-hilo-highs')
    expect(screen.getByTestId('terminal-hilo-session').textContent).toBe('Pre-market')
    expect(screen.getByTestId('terminal-hilo-totals').textContent).toBe('1 stock at a new high of the pre-market session, 0 at a new low.')
    expect(screen.queryByTestId('terminal-hilo-lows')).toBeNull()
    expect(screen.getByTestId('terminal-hilo-no-lows').textContent).toBe('No new lows yet this session.')
    expect(screen.getByTestId('terminal-hilo-method').textContent).not.toContain('Showing the busiest')
  })

  it('a symbol loads into the linked panels, and the numbered rows are the rows on screen', async () => {
    jsonFetcher.mockResolvedValue(LIVE)
    const { run, publishRows } = renderPanel()
    await screen.findByTestId('terminal-hilo-highs')
    fireEvent.click(screen.getByTestId('panel-symbol-EEE'))
    expect(run).toHaveBeenCalledWith('$EEE')
    expect(publishRows).toHaveBeenLastCalledWith(['$AAA', '$BBB', '$CCC', '$DDD', '$EEE'])
  })
})

describe('HILO chips', () => {
  it('Highs and Lows cut the lists, renumber the rows, and hand their word to the command', async () => {
    jsonFetcher.mockResolvedValue(LIVE)
    const { publishRows } = renderPanel()
    await screen.findByTestId('terminal-hilo-highs')
    fireEvent.click(screen.getByTestId('terminal-hilo-side-lows'))
    expect(screen.getByTestId('terminal-hilo').getAttribute('data-side')).toBe('lows')
    expect(screen.queryByTestId('terminal-hilo-highs')).toBeNull()
    expect(symsOf('lows')).toEqual(['DDD', 'EEE'])
    expect(screen.getByTestId('terminal-hilo-lows-row-DDD').textContent.startsWith('1')).toBe(true)
    expect(publishRows).toHaveBeenLastCalledWith(['$DDD', '$EEE'])
    expect(wire.writeBack).toHaveBeenLastCalledWith(['LOWS'])
    fireEvent.click(screen.getByTestId('terminal-hilo-side-highs'))
    expect(screen.queryByTestId('terminal-hilo-lows')).toBeNull()
    expect(symsOf('highs')).toEqual(['AAA', 'BBB', 'CCC'])
    expect(wire.writeBack).toHaveBeenLastCalledWith(['HIGHS'])
    fireEvent.click(screen.getByTestId('terminal-hilo-side-both'))
    expect(wire.writeBack).toHaveBeenLastCalledWith([])
    // the totals still describe the whole market, whichever list shows
    expect(screen.getByTestId('terminal-hilo-totals').textContent).toContain('124 stocks at a new high')
  })

  it('the side and group props seed the chips and the read', async () => {
    jsonFetcher.mockImplementation(byUrl({ [URL_STOCKS]: LIVE, [URL_SECTORS]: SECTORS }))
    renderPanel({ side: 'LOWS' })
    await screen.findByTestId('terminal-hilo-lows')
    expect(screen.getByTestId('terminal-hilo-side-lows').getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByTestId('terminal-hilo-highs')).toBeNull()
    cleanup()
    renderPanel({ group: 'SECTOR' })
    await screen.findByTestId('terminal-hilo-highs')
    expect(screen.getByTestId('terminal-hilo-group-sector').getAttribute('aria-pressed')).toBe('true')
    expect(jsonFetcher).toHaveBeenCalledWith(URL_SECTORS)
  })

  it('Sectors ranks groups, never shows stock rows as sectors, and a sector opens its stocks', async () => {
    let releaseSectors
    jsonFetcher.mockImplementation((url) => {
      if (url === URL_SECTORS) return new Promise((resolve) => { releaseSectors = () => resolve(SECTORS) })
      return byUrl({ [URL_STOCKS]: LIVE, [URL_TECH]: TECH })(url)
    })
    const { publishRows, run } = renderPanel()
    await screen.findByTestId('terminal-hilo-highs')
    fireEvent.click(screen.getByTestId('terminal-hilo-group-sector'))
    expect(wire.writeBack).toHaveBeenLastCalledWith(['SECTOR'])
    // the sector read is still out: the stock rows are gone and the skeleton is up
    expect(await screen.findByTestId('terminal-hilo-loading')).toBeTruthy()
    expect(screen.queryByTestId('panel-symbol-AAA')).toBeNull()
    releaseSectors()
    await screen.findByTestId('terminal-hilo-highs')
    expect(screen.getByRole('table', { name: 'Sectors with stocks at new highs (2)' })).toBeTruthy()
    expect(screen.getByRole('table', { name: 'Sectors with stocks at new lows (2)' })).toBeTruthy()
    expect(rowsOf('terminal-hilo-highs').map((r) => r.textContent)).toEqual([expect.stringContaining('Technology12'), expect.stringContaining('Energy2')])
    expect(rowsOf('terminal-hilo-lows')[1].textContent).toContain('Not classified')
    expect(screen.getByTestId('terminal-hilo-totals').textContent).toBe('2 sectors have a stock at a new high of the day, 2 at a new low.')
    expect(screen.getByTestId('terminal-hilo-method').textContent).toContain('Each sector is ranked by how many of its stocks have done so.')
    // a group overview has no ticker rows to number
    expect(publishRows).toHaveBeenLastCalledWith([])
    expect(screen.queryByTestId('terminal-hilo-back')).toBeNull()

    fireEvent.click(within(screen.getByTestId('terminal-hilo-highs')).getByRole('button', { name: 'Technology' }))
    await screen.findByTestId('terminal-hilo-highs-row-AAA')
    expect(jsonFetcher).toHaveBeenCalledWith(URL_TECH)
    expect(screen.getByTestId('terminal-hilo-totals').textContent).toBe('Technology: 2 stocks at a new high of the day, 0 at a new low.')
    expect(symsOf('highs')).toEqual(['AAA', 'BBB'])
    expect(publishRows).toHaveBeenLastCalledWith(['$AAA', '$BBB'])
    fireEvent.click(screen.getByTestId('panel-symbol-BBB'))
    expect(run).toHaveBeenCalledWith('$BBB')
    // inside one sector the side stays local (the command does not carry the sector), so it is not lost
    const calls = wire.writeBack.mock.calls.length
    fireEvent.click(screen.getByTestId('terminal-hilo-side-highs'))
    expect(wire.writeBack.mock.calls.length).toBe(calls)
    expect(symsOf('highs')).toEqual(['AAA', 'BBB'])

    fireEvent.click(screen.getByTestId('terminal-hilo-back'))
    await screen.findByRole('table', { name: 'Sectors with stocks at new highs (2)' })
    expect(screen.queryByTestId('terminal-hilo-back')).toBeNull()
    fireEvent.click(screen.getByTestId('terminal-hilo-group-stocks'))
    await screen.findByTestId('terminal-hilo-highs-row-CCC')
    expect(wire.writeBack).toHaveBeenLastCalledWith(['HIGHS'])
  })

  it('a view that fails says so and keeps the chips, so the member can go back', async () => {
    jsonFetcher.mockImplementation(byUrl({ [URL_STOCKS]: LIVE }))
    renderPanel()
    await screen.findByTestId('terminal-hilo-highs')
    fireEvent.click(screen.getByTestId('terminal-hilo-group-theme'))
    expect((await screen.findByTestId('terminal-hilo-error')).textContent).toContain('could not be read just now')
    expect(screen.queryByTestId('terminal-hilo-highs')).toBeNull()
    fireEvent.click(screen.getByTestId('terminal-hilo-group-stocks'))
    await screen.findByTestId('terminal-hilo-highs')
    expect(symsOf('highs')).toEqual(['AAA', 'BBB', 'CCC'])
  })
})

describe('HILO follows the member\'s theme', () => {
  it('the panel holds no hard-coded color', () => {
    const text = fs.readFileSync(path.join(HERE, 'HighsLowsPanel.jsx'), 'utf8')
    expect(colourLiteralsIn('pages/terminal/panels/HighsLowsPanel.jsx', text).map((h) => h.lit)).toEqual([])
  })
})

describe('HILO accessibility', () => {
  it('the stock lists and the sector overview pass axe (WCAG A and AA)', async () => {
    jsonFetcher.mockImplementation(byUrl({ [URL_STOCKS]: LIVE, [URL_SECTORS]: SECTORS }))
    renderPanel()
    await screen.findByTestId('terminal-hilo-highs-row-AAA')
    await expectNoAxeViolations(document.body.firstElementChild)
    fireEvent.click(screen.getByTestId('terminal-hilo-group-sector'))
    await screen.findByRole('table', { name: 'Sectors with stocks at new highs (2)' })
    await expectNoAxeViolations(document.body.firstElementChild)
  }, 20_000)
})

// ── data wave 4: the small chart above the lists (HighsLowsPulse.jsx over GET /api/nhnl/series) ──
// The series is a RATE (new highs and new lows set per second), one point every couple of seconds;
// the fixture is the route's real shape (api/services/nhnl_live.py get_series).
const pt = (hms, hi, lo) => ({ t: `2026-11-16T${hms}.123456-05:00`, hi, lo })
const SERIES = {
  window: 'rth', asof: ASOF, date: '2026-11-16', active: true, sample_secs: 2.0, highs_total: 124, lows_total: 76,
  series: [pt('09:45:00', 0.4, 1.2), pt('10:00:00', 1.1, 0.9), pt('10:15:00', 2.4, 0.5), pt('10:31:00', 1.8, 0.35)],
}
const withSeries = (map, series = SERIES) => byUrl({ ...map, [NHNL_SERIES_URL]: series })

describe('HILO chart of highs against lows through the session', () => {
  it('draws both lines above the lists, each ending in its own label, with the numbers in its text alternative', async () => {
    jsonFetcher.mockImplementation(withSeries({ [URL_STOCKS]: LIVE }))
    renderPanel()
    const svg = await screen.findByTestId('terminal-hilo-pulse-svg')
    expect(jsonFetcher.mock.calls.map((c) => c[0]).sort()).toEqual([URL_STOCKS, NHNL_SERIES_URL].sort())
    // an inline SVG image whose name states the span, the latest rates and the session's counts
    expect(svg.tagName.toLowerCase()).toBe('svg')
    expect(svg.getAttribute('role')).toBe('img')
    const alt = svg.getAttribute('aria-label')
    expect(alt).toBe('New highs and new lows being set each second across the market, 9:45 AM to 10:31 AM Eastern. '
      + 'Latest reading: 1.8 new highs a second and 0.35 new lows a second. '
      + 'So far this session 124 stocks have made a new high and 76 stocks have made a new low.')
    expect(svg.querySelector('title').textContent).toBe(alt)
    // two lines, oldest reading at the left edge and the latest at the right
    for (const side of ['highs', 'lows']) {
      const d = screen.getByTestId(`terminal-hilo-pulse-${side}`).getAttribute('d')
      expect(d.startsWith('M0 '), side).toBe(true)
      expect(d.split('L')).toHaveLength(4)
      expect(d.split('L').pop().startsWith('600 '), side).toBe(true)
    }
    expect(screen.getByTestId('terminal-hilo-pulse-highs').getAttribute('d')).not.toBe(screen.getByTestId('terminal-hilo-pulse-lows').getAttribute('d'))
    // told apart by more than color: a text label at the end of each line, and the caption names the dashed one
    expect(screen.getByTestId('terminal-hilo-pulse-label-highs').textContent).toBe('Highs 1.8/s')
    expect(screen.getByTestId('terminal-hilo-pulse-label-lows').textContent).toBe('Lows 0.35/s')
    const caption = screen.getByTestId('terminal-hilo-pulse-caption').textContent
    expect(caption).toContain('New highs (solid line) and new lows (dashed line)')
    expect(caption).toContain('from 9:45 AM to 10:31 AM ET')
    expect(caption).toContain('The scale runs from 0 to 5 a second.')
    expect(caption).not.toContain('not only the view below')
    // above the lists, and the lists are as before
    const pulse = screen.getByTestId('terminal-hilo-pulse')
    const highs = screen.getByTestId('terminal-hilo-highs')
    expect(pulse.compareDocumentPosition(highs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(symsOf('highs')).toEqual(['AAA', 'BBB', 'CCC'])
    expect(symsOf('lows')).toEqual(['DDD', 'EEE'])
  })

  it('its own read failing never fails the lists: one line says so, and Retry asks for the chart alone', async () => {
    let seriesCalls = 0
    jsonFetcher.mockImplementation(async (url) => {
      if (url === URL_STOCKS) return LIVE
      seriesCalls += 1
      if (seriesCalls === 1) throw fail(500)
      return SERIES
    })
    renderPanel()
    const note = await screen.findByTestId('terminal-hilo-pulse-error')
    expect(note.textContent).toContain('The highs and lows chart could not be read just now. The lists below are not affected.')
    expect(screen.queryByTestId('terminal-hilo-pulse-svg')).toBeNull()
    expect(screen.queryByTestId('terminal-hilo-error')).toBeNull()
    expect(symsOf('highs')).toEqual(['AAA', 'BBB', 'CCC'])
    expect(screen.getByTestId('terminal-hilo-totals').textContent).toContain('124 stocks at a new high')
    const liveCalls = jsonFetcher.mock.calls.filter((c) => c[0] === URL_STOCKS).length
    fireEvent.click(within(note).getByRole('button', { name: 'Retry the chart' }))
    await screen.findByTestId('terminal-hilo-pulse-svg')
    expect(jsonFetcher.mock.calls.filter((c) => c[0] === URL_STOCKS)).toHaveLength(liveCalls)
  })

  it('a paywalled or unreadable chart says so with the lists intact, and never draws a flat line', async () => {
    jsonFetcher.mockImplementation(async (url) => { if (url === URL_STOCKS) return LIVE; throw fail(402) })
    renderPanel()
    const locked = await screen.findByTestId('terminal-hilo-pulse-error')
    expect(locked.textContent).toContain('needs a paid plan')
    expect(within(locked).queryByRole('button')).toBeNull()
    expect(symsOf('lows')).toEqual(['DDD', 'EEE'])
    cleanup()
    jsonFetcher.mockImplementation(withSeries({ [URL_STOCKS]: LIVE }, { detail: 'unexpected' }))
    renderPanel()
    const odd = await screen.findByTestId('terminal-hilo-pulse-error')
    expect(odd.textContent).toContain('came back in a form this panel cannot read')
    expect(screen.queryByTestId('terminal-hilo-pulse-svg')).toBeNull()
  })

  it('too few readings says so instead of drawing', async () => {
    const few = { ...SERIES, series: SERIES.series.slice(0, PULSE_MIN_POINTS - 1) }
    jsonFetcher.mockImplementation(withSeries({ [URL_STOCKS]: LIVE }, few))
    renderPanel()
    const note = await screen.findByTestId('terminal-hilo-pulse-few')
    expect(note.textContent).toContain(`Too few readings to draw the highs and lows chart yet (${PULSE_MIN_POINTS - 1} so far, and it needs ${PULSE_MIN_POINTS}).`)
    expect(screen.queryByTestId('terminal-hilo-pulse-svg')).toBeNull()
    cleanup()
    jsonFetcher.mockImplementation(withSeries({ [URL_STOCKS]: LIVE }, { ...SERIES, series: [] }))
    renderPanel()
    expect((await screen.findByTestId('terminal-hilo-pulse-few')).textContent).toContain('(0 so far')
  })

  it('outside market hours and with the scanner off the chart is not mounted and its route is never asked', async () => {
    const closedSeries = { ...SERIES, window: 'closed', active: false }
    for (const [body, state] of [[CLOSED, 'terminal-hilo-closed'], [OFF, 'terminal-hilo-off']]) {
      jsonFetcher.mockReset()
      jsonFetcher.mockImplementation(withSeries({ [URL_STOCKS]: body }, closedSeries))
      renderPanel()
      await screen.findByTestId(state)
      expect(screen.queryByTestId('terminal-hilo-pulse')).toBeNull()
      expect(jsonFetcher.mock.calls.map((c) => c[0])).toEqual([URL_STOCKS])
      cleanup()
    }
  })

  it('a series the server marks as not running is never drawn as a live line', async () => {
    jsonFetcher.mockImplementation(withSeries({ [URL_STOCKS]: LIVE }, { ...SERIES, window: 'closed', active: false }))
    renderPanel()
    expect((await screen.findByTestId('terminal-hilo-pulse-idle')).textContent).toContain('The scanner is not running right now')
    expect(screen.queryByTestId('terminal-hilo-pulse-svg')).toBeNull()
  })

  it('even a fault while drawing the chart leaves the lists standing', async () => {
    // No JSON answer can do this; the getter stands in for any bug inside the chart.
    const bomb = { ...SERIES, series: [{ get t() { throw new Error('boom') }, hi: 1, lo: 1 }] }
    jsonFetcher.mockImplementation(withSeries({ [URL_STOCKS]: LIVE }, bomb))
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      renderPanel()
      const note = await screen.findByTestId('terminal-hilo-pulse-crashed')
      expect(note.textContent).toContain('The highs and lows chart could not be drawn. The lists below are not affected.')
      expect(symsOf('highs')).toEqual(['AAA', 'BBB', 'CCC'])
      expect(symsOf('lows')).toEqual(['DDD', 'EEE'])
      expect(screen.getByTestId('terminal-hilo-totals').textContent).toContain('124 stocks at a new high')
    } finally {
      quiet.mockRestore()
    }
  })

  it('under a sector view the chart says it is still the whole market', async () => {
    jsonFetcher.mockImplementation(withSeries({ [URL_STOCKS]: LIVE, [URL_SECTORS]: SECTORS }))
    renderPanel({ group: 'sector' })
    await screen.findByTestId('terminal-hilo-pulse-svg')
    expect(screen.getByTestId('terminal-hilo-pulse-caption').textContent).toContain('The chart is every stock the scanner watches, not only the view below.')
  })

  it('the chart, its model and its stylesheet hold no hard-coded color, and the lines use the theme tokens', () => {
    for (const f of ['HighsLowsPulse.jsx', 'highsLowsPulseModel.js', 'highsLowsPulse.module.css']) {
      const text = fs.readFileSync(path.join(HERE, f), 'utf8')
      expect(colourLiteralsIn(`pages/terminal/panels/${f}`, text).map((h) => h.lit), f).toEqual([])
    }
    const css = fs.readFileSync(path.join(HERE, 'highsLowsPulse.module.css'), 'utf8')
    expect(css).toMatch(/\.highs\s*\{[^}]*stroke:\s*var\(--ut-green-bright\)/)
    expect(css).toMatch(/\.lows\s*\{[^}]*stroke:\s*var\(--ut-red-bright\)[^}]*stroke-dasharray/)
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })

  it('the panel with the chart drawn passes axe (WCAG A and AA)', async () => {
    jsonFetcher.mockImplementation(withSeries({ [URL_STOCKS]: LIVE }))
    renderPanel()
    await screen.findByTestId('terminal-hilo-pulse-svg')
    await screen.findByTestId('terminal-hilo-highs-row-AAA')
    await expectNoAxeViolations(document.body.firstElementChild)
  }, 20_000)
})
