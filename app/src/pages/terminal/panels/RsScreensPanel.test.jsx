// RSS: the five UCT RS screens. Rails:
//   * the pure half (rsScreensModel.js): which starters are the RS screens (by what the server
//     sent, never by id), the typed words, the scan body (the starter's OWN spec, pinned against
//     the requests the Screener page itself sends), the columns and rows per screen;
//   * the gate: when the server serves none of the five the panel says the screens are not
//     switched on and runs NO scan; while the lists are not built it shows the server's sentence;
//   * loading; a failed read (500) is an error with Retry; 402 and 404 are locked with no Retry;
//   * an answer with no rows is the one empty state, with the screen's own sentence when it has one;
//   * a populated screen: the ticker, RS Rating and that screen's own fields, the ratings date in
//     the header, the coverage receipt when the route sends one;
//   * one chip per screen: its own scan, its own columns, and its word written into the command.
// Fixtures are the server's own (tests/fixtures/rs_screens_starters.json, rs_screens_rows.json and
// rs_screens_scan_requests.json, each pinned by the server's suite), over a synthetic market.
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
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import RsScreensPanel, {
  DEFAULT_RS_SCREEN, RS_PAGE_SIZE, RS_SCAN_URL, RS_SCREENS_CODE, RS_SCREENS_URL, RS_SCREEN_TOKENS, RS_SCREEN_WORDS, parseRsScreen,
  pickRsScreen, rsScanBody, rsScanView, rsScreenCell, rsScreenColumns, rsScreensCommandArgs, rsScreensOf,
} from './RsScreensPanel'
import * as model from './rsScreensModel'
import { colourLiteralsIn } from '../__tests__/themeScope'
import { expectNoAxeViolations } from '../../journal-2-0/a11y/axeHarness'

const HERE = path.dirname(fileURLToPath(import.meta.url))
// `app/src/pages/terminal/panels/` is FIVE levels below the repo root.
const serverFixture = (name) => JSON.parse(fs.readFileSync(path.join(HERE, '..', '..', '..', '..', '..', 'tests', 'fixtures', name), 'utf8'))
const STARTERS = serverFixture('rs_screens_starters.json')
const SERVED_ROWS = serverFixture('rs_screens_rows.json').screens
const SCREENER_REQUESTS = serverFixture('rs_screens_scan_requests.json').requests

const TOP = 'starter_rs_top_rating'
const NH = 'starter_rs_new_high'
const NHBP = 'starter_rs_nh_before_price'
const LEADERS = 'starter_rs_leaders'
const EXIT = 'starter_rs_exit_warning_5'

// What a member the screens are NOT shown to is served: the older single-rule RS lists (no `row`),
// three of them under an id one of the five also uses (saved_screens.rs_starters `previous`).
const OLD_RS_LISTS = [
  { id: NH, name: 'RS new highs (52-week)', group: 'Relative strength', description: 'An older single-rule list',
    spec: { filters: [{ key: 'rs_new_high', op: 'eq', value: 1 }], view: 'relative_strength', sort: { key: 'rs_rank', dir: 'desc' } } },
  { id: EXIT, name: 'RS exit warning in the last 5 sessions', group: 'Relative strength', description: 'An older single-rule list',
    spec: { filters: [{ key: 'rs_exit_bars_ago', op: 'between', min: 0, max: 4 }], view: 'relative_strength', sort: { key: 'rs_exit_bars_ago', dir: 'asc' } } },
]
const PLAIN = { id: 'starter_tight_base', name: 'Tight base', group: 'Bases & chart patterns', description: 'A plain starter',
  spec: { filters: [{ key: 'close_cv_pct', op: 'lt', max: 4 }], view: 'overview', sort: { key: 'rs_rank', dir: 'desc' } } }
const HIDDEN = { ...STARTERS[0], id: 'starter_rs_retired', name: 'A retired list', hidden: true }

const SAVED = { saved: [], starters: [PLAIN, ...STARTERS, HIDDEN], rs_market: null }
const SAVED_OFF = { saved: [], starters: [PLAIN, ...OLD_RS_LISTS] }
const SAVED_PENDING = { ...SAVED, rs_pending: { text: 'This list is not ready yet. It fills after the overnight rating run, at about 4:15 AM Eastern.' } }
const SAVED_CAUTION = { ...SAVED, rs_market: { state: 'pressure', text: 'Market under pressure. Build the watchlist; breakouts fail more often.', asof: '2026-02-27' } }
const COVERAGE = {
  evaluated: 3000, answered: 2990, dropped: 2, not_computable: 8,
  dropped_symbols: [{ ticker: 'ZZZ', reason: 'not-computable', detail: 'no RS Rating' }],
}

const scanAnswer = (id, extra = {}) => ({
  total: SERVED_ROWS[id].total, rows: SERVED_ROWS[id].rows, view: SERVED_ROWS[id].view, view_columns: [],
  snapshot_date: '2026-02-28', snapshot: { snapshot_date: '2026-02-28', rows: SERVED_ROWS[id].total }, ...extra,
})
const idOfView = Object.fromEntries(STARTERS.map((s) => [s.spec.view, s.id]))
const fail = (status) => Object.assign(new Error(`http ${status}`), { status })
const PENDING = Symbol('pending')
/**
 * Serves the saved-screens GET and one scan answer per screen id (matched by the POSTed body's
 * view, which is unique per screen). An Error is thrown, PENDING never answers; a screen with no
 * entry is a 500.
 */
function serve({ saved = SAVED, scans = {} } = {}) {
  jsonFetcher.mockImplementation((url, init) => {
    const answer = (hit) => (hit === PENDING ? new Promise(() => {}) : hit instanceof Error ? Promise.reject(hit) : Promise.resolve(hit))
    if (url === RS_SCREENS_URL && !init) return answer(saved)
    if (url === RS_SCAN_URL && init?.method === 'POST') {
      const id = idOfView[JSON.parse(init.body).view]
      return id in scans ? answer(scans[id]) : Promise.reject(fail(500))
    }
    return Promise.reject(fail(500))
  })
}
const scanCalls = () => jsonFetcher.mock.calls.filter(([url]) => url === RS_SCAN_URL).map(([, init]) => JSON.parse(init.body))
const ALL_SCANS = Object.fromEntries(STARTERS.map((s) => [s.id, scanAnswer(s.id)]))

function renderPanel(props = {}, { run = vi.fn(), open = vi.fn(), publishRows = vi.fn(), setFreshness = vi.fn(), code = null } = {}) {
  const tree = (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelFreshnessContext.Provider value={setFreshness}>
        <PanelListContext.Provider value={{ open, run, rerun: vi.fn(), publish: vi.fn(), publishRows }}>
          <RsScreensPanel {...props} />
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>
  )
  render(code ? <TerminalPanelContext.Provider value={{ code, density: 'compact', inset: true }}>{tree}</TerminalPanelContext.Provider> : tree)
  return { run, open, publishRows, setFreshness }
}
const table = () => screen.getByTestId('terminal-rss-table')
const symsInTable = () => within(table()).getAllByRole('row').slice(1).map((r) => r.getAttribute('data-testid').replace('terminal-rss-row-', ''))
const headers = () => within(table()).getAllByRole('columnheader').map((h) => h.textContent.trim())
const served = () => rsScreensOf(SAVED).screens
const screenOf = (id) => served().find((s) => s.id === id)
// The earnings note counts from a day; the fixture rows carry no report date, so any day reads the same.
const NOW = Date.parse('2026-02-28T15:00:00Z')

beforeEach(() => { jsonFetcher.mockReset(); wire.writeBack = vi.fn(() => false) })
afterEach(cleanup)

describe('RSS pure helpers (rsScreensModel)', () => {
  it('the panel re-exports the model, and names the two doors itself', () => {
    expect(rsScreensOf).toBe(model.rsScreensOf)
    expect(rsScanView).toBe(model.rsScanView)
    expect(RS_SCREENS_CODE).toBe('RSS')
    expect(RS_SCREENS_URL).toBe('/api/screener/saved-screens')
    expect(RS_SCAN_URL).toBe('/api/screener/scan')
    expect(RS_PAGE_SIZE).toBe(100)
  })

  it('rsScreensOf: the five the server serves, in its order; plain and hidden starters are not RS screens', () => {
    const got = rsScreensOf(SAVED)
    expect(got.ok).toBe(true)
    expect(got.screens.map((s) => s.id)).toEqual([TOP, NH, NHBP, LEADERS, EXIT])
    expect(got.screens.map((s) => s.name)).toEqual(['Top RS Rating', 'RS New Highs', 'RS New High Before Price', 'UCT RS Leaders', 'RS exit warnings'])
    expect(got.screens.map((s) => s.token)).toEqual(['TOP', 'NH', 'NHBP', 'LEADERS', 'EXIT'])
    // the one-line description is the server's, with its full stop
    expect(got.screens[3].description).toBe('The strongest liquid stocks in real uptrends, each labelled extended or near a buy point.')
    expect(got.screens[2].emptyText).toBe('No RS line made a 52-week high ahead of price this week. That is normal in a weak market.')
    expect(got.screens[0].emptyText).toBeNull()
    expect(got.screens[0].spec).toBe(STARTERS[0].spec)   // the starter's own spec, not a copy that could drift
    expect(got.market).toBeNull()
    expect(got.pending).toBeNull()
  })

  it('rsScreensOf: a member the screens are not shown to gets NO screens, even where an id is shared', () => {
    const off = rsScreensOf(SAVED_OFF)
    expect(off.ok).toBe(true)                 // a healthy answer...
    expect(off.screens).toEqual([])           // ...that serves none of the five: switched off, not empty
    expect(pickRsScreen(off.screens, NH)).toBeNull()
    // a body that is not a saved-screens answer is a failed read, which is a different thing
    for (const body of [null, undefined, [], 'x', {}, { detail: 'x' }, { starters: 'no' }]) expect(rsScreensOf(body).ok).toBe(false)
    // junk entries are skipped, and a repeated id is served once
    expect(rsScreensOf({ starters: [null, 'x', { id: TOP }, STARTERS[0], STARTERS[0]] }).screens.map((s) => s.id)).toEqual([TOP])
  })

  it('rsScreensOf: the caution line and the "not built yet" sentence are the server\'s own', () => {
    expect(rsScreensOf(SAVED_CAUTION).market).toEqual({
      state: 'pressure', text: 'Market under pressure. Build the watchlist; breakouts fail more often.', asOf: '2026-02-27',
    })
    // a state with no words (a normal market) is no line at all
    expect(rsScreensOf({ ...SAVED, rs_market: { state: 'normal', text: '', asof: '2026-02-27' } }).market).toBeNull()
    expect(rsScreensOf(SAVED_PENDING).pending).toBe('This list is not ready yet. It fills after the overnight rating run, at about 4:15 AM Eastern.')
    expect(rsScreensOf({ ...SAVED, rs_pending: {} }).pending).toBeNull()
  })

  it('the typed words, the default screen and the command arguments', () => {
    expect(DEFAULT_RS_SCREEN).toBe(LEADERS)
    expect(['leaders', 'LDR', 'top', 'RATING', 'nh', 'HIGHS', 'nhbp', 'before', 'EXIT', 'warn', 'WARNINGS'].map(parseRsScreen))
      .toEqual([LEADERS, LEADERS, TOP, TOP, NH, NH, NHBP, NHBP, EXIT, EXIT, EXIT])
    for (const t of ['', null, 'NVDA', 'toString', 'RS', LEADERS]) expect(parseRsScreen(t)).toBeNull()
    expect(rsScreensCommandArgs()).toEqual([])
    expect(rsScreensCommandArgs({ screen: LEADERS })).toEqual([])        // the default screen is the bare command
    expect(rsScreensCommandArgs({ screen: NHBP })).toEqual(['NHBP'])
    expect(rsScreensCommandArgs({ screen: 'starter_rs_some_new_one' })).toEqual([])
    // every word a chip writes is read back to the same screen, and every word names a served screen
    for (const [id, token] of Object.entries(RS_SCREEN_TOKENS)) expect(parseRsScreen(token)).toBe(id)
    const ids = new Set(STARTERS.map((s) => s.id))
    for (const id of Object.values(RS_SCREEN_WORDS)) expect(ids.has(id), id).toBe(true)
    expect(Object.keys(RS_SCREEN_TOKENS).sort()).toEqual([...ids].sort())
  })

  it('pickRsScreen: the one asked for, else the default, else the first served', () => {
    expect(pickRsScreen(served(), NHBP).id).toBe(NHBP)
    expect(pickRsScreen(served(), null).id).toBe(LEADERS)
    expect(pickRsScreen(served(), 'nope').id).toBe(LEADERS)
    expect(pickRsScreen(served().filter((s) => s.id !== LEADERS), null).id).toBe(TOP)
    expect(pickRsScreen([], LEADERS)).toBeNull()
    expect(pickRsScreen(null)).toBeNull()
  })

  it('rsScanBody is the starter\'s own spec: the same rules, order and view the Screener page posts', () => {
    for (const s of served()) {
      const body = rsScanBody(s)
      const theirs = SCREENER_REQUESTS.find((r) => r.starter === s.id && Object.keys(r.choices).length === 0).body
      expect(body.filters, s.id).toEqual(theirs.filters)
      expect(body.sort, s.id).toEqual(theirs.sort)
      expect(body.view, s.id).toBe(theirs.view)
      expect(body.page).toBe(1)
      expect(body.page_size).toBe(RS_PAGE_SIZE)
      expect(body.rank).toBeUndefined()
      // every column asked for is one the Screener asks that screen for, so the server has it
      for (const c of body.columns) expect(theirs.columns, `${s.id} ${c}`).toContain(c)
      expect(new Set(body.columns).size).toBe(body.columns.length)
      for (const c of ['ticker', 'price', 'chg_pct_1d', 'rs_rank', 'rs_rating_session']) expect(body.columns).toContain(c)
    }
    // a rank or a logic tree a starter carries rides along untouched
    const ranked = { ...screenOf(LEADERS), spec: { ...screenOf(LEADERS).spec, rank: { criteria: [{ key: 'rs_rank', weight: 1 }], top_n: 50 }, logic: { all: [] } } }
    expect(rsScanBody(ranked)).toMatchObject({ rank: { top_n: 50 }, logic: { all: [] } })
    expect(rsScanBody(null)).toMatchObject({ filters: [], page: 1 })
  })

  it('each screen shows the ticker, the RS Rating and the things that screen is about', () => {
    const labels = (id) => rsScreenColumns(screenOf(id)).map((c) => c.label)
    expect(labels(TOP)).toEqual(['Symbol', 'RS Rating', 'Place', 'Setup', 'Rating trend', 'Price', 'Day change', 'Note'])
    expect(labels(NH)).toEqual(['Symbol', 'RS Rating', 'RS line high', 'Price', 'Day change', 'Industry', 'Note'])
    expect(labels(NHBP)).toEqual(['Symbol', 'RS Rating', 'Price vs its high', 'Price', 'Day change', 'Industry', 'Note'])
    expect(labels(LEADERS)).toEqual(['Symbol', 'RS Rating', 'Setup', 'Days on list', 'Price', 'Day change', 'Industry', 'Note'])
    expect(labels(EXIT)).toEqual(['Symbol', 'RS Rating', 'Warning', 'Price', 'Day change', 'Industry'])
    // a table five or more columns wide folds at least one away on a phone
    for (const s of served()) expect(rsScreenColumns(s).some((c) => c.phoneHide), s.id).toBe(true)
    expect(rsScreenColumns(null).map((c) => c.key)).toEqual(['sym', 'rs', 'price', 'chgPct'])
  })

  it('rsScanView: rows in the server\'s order, each with its screen\'s words; the total and the ratings date', () => {
    const top = rsScanView(scanAnswer(TOP), screenOf(TOP), { now: NOW })
    expect(top.ok).toBe(true)
    expect(top.total).toBe(61)                         // the rows are one page of the 61 that matched
    expect(top.session).toBe('2026-02-27')
    expect(top.snapshotDate).toBe('2026-02-28')
    expect(top.rows.slice(0, 3).map((r) => r.sym)).toEqual(['RISE5', 'RISE4', 'RUN1'])
    expect(top.rows[0]).toMatchObject({ rs: 99, price: 215.29, chgPct: 0.4, place: 1, group: 'Retail', order: 0 })
    expect(top.rows[0].parts).toEqual({ setup: 'Tight range', moving: '' })      // nothing to say is nothing said
    expect(top.rows[1].parts.moving).toBe('was #6 a month ago')
    expect(top.rows[2].parts).toEqual({ setup: 'Extended', moving: 'was #28 a month ago' })

    const nh = rsScanView(scanAnswer(NH), screenOf(NH), { now: NOW })
    expect(nh.rows[0]).toMatchObject({ sym: 'RISE5', place: null, tag: 'Weekly RS high' })
    expect(nh.rows[0].parts).toEqual({ rs_high_age: 'RS high today' })
    const before = rsScanView(scanAnswer(NHBP), screenOf(NHBP), { now: NOW })
    expect(before.rows[0].parts).toEqual({ below_high: '3% below its high' })
    const leaders = rsScanView(scanAnswer(LEADERS), screenOf(LEADERS), { now: NOW })
    expect(leaders.rows[0]).toMatchObject({ sym: 'RISE5', days: 21, place: null })   // its place is its row number
    const exit = rsScanView(scanAnswer(EXIT), screenOf(EXIT), { now: NOW })
    expect(exit.rows.slice(0, 3).map((r) => r.parts.exit_warning)).toEqual(['Quick Break today', 'Quick Break today', 'Grateful Dead Break yesterday'])
    expect(exit.rows[0].tag).toBe('')
  })

  it('rsScanView: a body that is not a scan answer is a failed read; an empty page is an empty list', () => {
    for (const body of [null, undefined, [], 'x', {}, { detail: 'bad column' }, { rows: 'no' }]) expect(rsScanView(body, screenOf(TOP)).ok).toBe(false)
    expect(rsScanView({ total: 0, rows: [], snapshot_date: '20260228' }, screenOf(TOP))).toEqual({
      ok: true, rows: [], total: 0, session: null, snapshotDate: '2026-02-28', coverage: null,
    })
    // a repeated or ticker-less row is dropped, and the receipt rides along as sent
    const messy = rsScanView({ total: 2, coverage: COVERAGE, rows: [{ ticker: 'aaa', rs_rank: 90 }, { ticker: 'AAA', rs_rank: 1 }, { rs_rank: 5 }, null] }, screenOf(TOP))
    expect(messy.rows.map((r) => [r.sym, r.rs])).toEqual([['AAA', 90]])
    expect(messy.coverage).toBe(COVERAGE)
    // a rating that is missing is "not known", never 0
    expect(rsScanView({ rows: [{ ticker: 'BBB', rs_rank: null, price: '12' }] }, screenOf(TOP)).rows[0]).toMatchObject({ rs: null, price: null })
  })

  it('cells are formatted by the shared primitives, and a missing value reads n/a', () => {
    const [r5, , run1] = rsScanView(scanAnswer(TOP), screenOf(TOP), { now: NOW }).rows
    expect(rsScreenCell('rs', r5).text).toBe('99')
    expect(rsScreenCell('place', r5).text).toBe('#1')
    expect(rsScreenCell('price', r5).text).toBe('$215.29')
    expect(rsScreenCell('chgPct', run1)).toEqual({ text: '+3.01%', toneOf: 3.01 })
    expect(rsScreenCell('setup', run1).text).toBe('Extended')
    expect(rsScreenCell('moving', r5).text).toBe('n/a')
    expect(rsScreenCell('tag', r5).text).toBe('')
    expect(rsScreenCell('days', { days: 1234 }).text).toBe('1,234')
    for (const key of ['rs', 'place', 'days', 'price', 'chgPct', 'group']) expect(rsScreenCell(key, {}).text, key).toBe('n/a')
  })
})

describe('RSS panel states', () => {
  it('shows a skeleton while the screens are read', () => {
    jsonFetcher.mockReturnValue(new Promise(() => {}))
    renderPanel()
    expect(screen.getByTestId('terminal-rss-loading').textContent).toContain('Loading the RS screens')
    expect(jsonFetcher).toHaveBeenCalledWith(RS_SCREENS_URL)
    expect(scanCalls()).toEqual([])
  })

  it('the screens switched off says so, runs NO scan, and is never an empty list', async () => {
    serve({ saved: SAVED_OFF, scans: ALL_SCANS })
    renderPanel({ screen: NH })
    const off = await screen.findByTestId('terminal-rss-off')
    expect(off.getAttribute('data-kind')).toBe('locked')
    expect(off.textContent).toContain('The RS screens are not switched on for your account on this server yet.')
    expect(off.textContent).toContain('That is not the same as an empty list.')
    expect(screen.queryByTestId('terminal-rss-empty')).toBeNull()
    expect(screen.queryByTestId('terminal-rss-table')).toBeNull()
    expect(scanCalls()).toEqual([])
  })

  it('lists not built yet: the server\'s own sentence, no scan, and a way to check again', async () => {
    serve({ saved: SAVED_PENDING, scans: ALL_SCANS })
    renderPanel()
    const wait = await screen.findByTestId('terminal-rss-pending')
    expect(wait.textContent).toContain('The RS screens are not ready yet.')
    expect(wait.textContent).toContain('It fills after the overnight rating run, at about 4:15 AM Eastern.')
    expect(wait.textContent).toContain('That is not the same as no stock qualifying.')
    expect(screen.queryByTestId('terminal-rss-empty')).toBeNull()
    expect(scanCalls()).toEqual([])
    serve({ saved: SAVED, scans: ALL_SCANS })
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(await screen.findByTestId('terminal-rss-table')).toBeTruthy()
  })

  it('the screens failing to load (500) is an error with Retry; 402 and 404 are locked with none', async () => {
    serve({ saved: fail(500) })
    renderPanel({}, { code: 'RSCR' })
    const err = await screen.findByTestId('terminal-rss-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('The RS screens could not be read just now.')
    expect(err.textContent).toContain('That is not the same as an empty list. Retry, or run RSCR again.')
    serve({ saved: SAVED, scans: ALL_SCANS })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-rss-table')).toBeTruthy()
    cleanup()
    jsonFetcher.mockReset()
    serve({ saved: fail(402) })
    renderPanel()
    const paid = await screen.findByTestId('terminal-rss-error')
    expect(paid.getAttribute('data-kind')).toBe('locked')
    expect(paid.textContent).toContain('The RS screens needs a paid plan.')
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    cleanup()
    jsonFetcher.mockReset()
    serve({ saved: fail(404) })
    renderPanel()
    const dark = await screen.findByTestId('terminal-rss-error')
    expect(dark.getAttribute('data-kind')).toBe('locked')
    expect(dark.textContent).toContain('The RS screens is not switched on for this server yet.')
  })

  it('an answer that is not a saved-screens payload is a failed read, not "switched off"', async () => {
    serve({ saved: { detail: 'unexpected' } })
    renderPanel()
    const err = await screen.findByTestId('terminal-rss-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(screen.queryByTestId('terminal-rss-off')).toBeNull()
  })

  it('a scan that fails (500) is an error with Retry, with the chips still there; never an empty list', async () => {
    serve({ scans: {} })
    renderPanel()
    const err = await screen.findByTestId('terminal-rss-error')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(err.textContent).toContain('The UCT RS Leaders screen could not be read just now.')
    expect(err.textContent).toContain('That is not the same as an empty list.')
    expect(screen.queryByTestId('terminal-rss-empty')).toBeNull()
    expect(screen.getByTestId('terminal-rss-screen-TOP')).toBeTruthy()
    serve({ scans: ALL_SCANS })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-rss-table')).toBeTruthy()
  })

  it('a scan the server refuses (400), a paywall (402) and a dark route (404) each say what they are', async () => {
    serve({ scans: { [LEADERS]: fail(400), [TOP]: fail(402), [NH]: fail(404) } })
    renderPanel()
    const bad = await screen.findByTestId('terminal-rss-error')
    expect(bad.textContent).toContain('The UCT RS Leaders screen cannot run on this server yet. The screener snapshot is missing a column it needs.')
    fireEvent.click(screen.getByTestId('terminal-rss-screen-TOP'))
    await waitFor(() => expect(screen.getByTestId('terminal-rss-error').textContent).toContain('The Top RS Rating screen needs a paid plan.'))
    expect(screen.getByTestId('terminal-rss-error').getAttribute('data-kind')).toBe('locked')
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    fireEvent.click(screen.getByTestId('terminal-rss-screen-NH'))
    await waitFor(() => expect(screen.getByTestId('terminal-rss-error').textContent).toContain('The RS New Highs screen is not switched on for this server yet.'))
  })

  it('a scan answer that is not one is a failed read', async () => {
    serve({ scans: { [LEADERS]: { detail: 'unexpected' } } })
    renderPanel()
    const err = await screen.findByTestId('terminal-rss-error')
    expect(err.textContent).toContain('The UCT RS Leaders screen could not be read just now.')
    expect(screen.queryByTestId('terminal-rss-empty')).toBeNull()
  })

  it('no rows is the one empty state: the screen\'s own sentence when it has one, and the receipt', async () => {
    serve({ scans: { [NHBP]: scanAnswer(NHBP, { total: 0, rows: [], coverage: COVERAGE }), [LEADERS]: scanAnswer(LEADERS, { total: 0, rows: [] }) } })
    const { publishRows, setFreshness } = renderPanel({ screen: 'NHBP' })
    const empty = await screen.findByTestId('terminal-rss-empty')
    expect(empty.getAttribute('data-kind')).toBe('empty')
    expect(empty.textContent).toContain('No RS line made a 52-week high ahead of price this week. That is normal in a weak market.')
    expect(screen.getByTestId('coverage-line').textContent).toContain('3,000 evaluated')
    expect(publishRows).toHaveBeenLastCalledWith([])
    // an empty list is still a dated answer: the snapshot it was run over
    await waitFor(() => expect(setFreshness).toHaveBeenCalledWith({
      source: 'UCT screener snapshot and RS ratings (nightly build)', age: { asOfDate: '2026-02-28' },
    }))
    fireEvent.click(screen.getByTestId('terminal-rss-screen-LEADERS'))
    await waitFor(() => expect(screen.getByTestId('terminal-rss-empty').textContent).toContain('No stock is on UCT RS Leaders in the latest snapshot.'))
    expect(screen.queryByTestId('coverage-line')).toBeNull()
  })
})

describe('RSS panel, populated', () => {
  it('opens UCT RS Leaders: its description, rows with RS Rating and its own fields, the ratings date', async () => {
    serve({ scans: ALL_SCANS })
    const { run, publishRows, setFreshness } = renderPanel()
    await screen.findByTestId('terminal-rss-table')
    expect(screen.getByTestId('terminal-rss').getAttribute('data-screen')).toBe(LEADERS)
    expect(screen.getByTestId('terminal-rss-screen-LEADERS').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('terminal-rss-about').textContent)
      .toBe('The strongest liquid stocks in real uptrends, each labelled extended or near a buy point.')
    // one scan, with the starter's own spec
    expect(scanCalls()).toHaveLength(1)
    expect(scanCalls()[0]).toEqual(rsScanBody(screenOf(LEADERS)))
    expect(headers()).toEqual(['Symbol', 'RS Rating', 'Setup', 'Days on list', 'Price', 'Day change', 'Industry', 'Note'])
    expect(symsInTable().slice(0, 3)).toEqual(['RISE5', 'RISE4', 'RUN1'])
    const first = screen.getByTestId('terminal-rss-row-RISE5').textContent
    for (const s of ['1', 'RISE5', '99', 'Tight range', '21', '$215.29', '+0.40%', 'Retail']) expect(first).toContain(s)
    expect(screen.getByTestId('terminal-rss-row-RUN1').textContent).toContain('Extended')
    expect(screen.getByRole('table', { name: 'UCT RS Leaders, 8 stocks' })).toBeTruthy()
    fireEvent.click(screen.getByTestId('panel-symbol-RISE4'))
    expect(run).toHaveBeenCalledWith('$RISE4')
    expect(publishRows.mock.calls.at(-1)[0].slice(0, 3)).toEqual(['$RISE5', '$RISE4', '$RUN1'])
    // the header's as-of is the session the ratings describe
    await waitFor(() => expect(setFreshness).toHaveBeenCalledWith({
      source: 'UCT screener snapshot and RS ratings (nightly build)', age: { asOfDate: '2026-02-27' },
    }))
    const method = screen.getByTestId('terminal-rss-method').textContent
    expect(method).toContain('Showing the first 8 of 12 in the screen\'s own order.')
    expect(method).toContain('(ratings as of 2026-02-27)')
    expect(method).toContain('it is not a forecast or a recommendation')
    expect(screen.queryByTestId('terminal-rss-market')).toBeNull()
    expect(screen.queryByTestId('coverage-line')).toBeNull()   // no receipt sent (the flag is dark)
    expect(document.body.textContent).not.toMatch(/[—–]/)
  })

  it('draws the scan\'s coverage receipt and the market caution line when the server sends them', async () => {
    serve({ saved: SAVED_CAUTION, scans: { [LEADERS]: scanAnswer(LEADERS, { coverage: COVERAGE }) } })
    renderPanel()
    await screen.findByTestId('terminal-rss-table')
    expect(screen.getByTestId('coverage-line').textContent).toContain('3,000 evaluated')
    expect(screen.getByTestId('terminal-rss-market').textContent)
      .toBe('Market under pressure. Build the watchlist; breakouts fail more often. Market read as of 2026-02-27.')
  })

  it('the Screener link opens the Screener in the terminal', async () => {
    serve({ scans: ALL_SCANS })
    const { open } = renderPanel()
    await screen.findByTestId('terminal-rss-table')
    fireEvent.click(screen.getByRole('button', { name: 'Open the Screener (SCR)' }))
    expect(open).toHaveBeenCalledWith('SCR')
  })
})

describe('RSS chips', () => {
  it('one chip per screen: its own scan, its own columns, and its word written into the command', async () => {
    serve({ scans: ALL_SCANS })
    const { publishRows } = renderPanel()
    await screen.findByTestId('terminal-rss-table')
    expect(within(screen.getByRole('group', { name: 'Screen' })).getAllByRole('button').map((b) => b.textContent))
      .toEqual(['Top RS Rating', 'RS New Highs', 'RS New High Before Price', 'UCT RS Leaders', 'RS exit warnings'])

    fireEvent.click(screen.getByTestId('terminal-rss-screen-TOP'))
    expect(wire.writeBack).toHaveBeenLastCalledWith(['TOP'])
    await waitFor(() => expect(headers()).toEqual(['Symbol', 'RS Rating', 'Place', 'Setup', 'Rating trend', 'Price', 'Day change', 'Note']))
    expect(screen.getByTestId('terminal-rss-about').textContent).toContain('Every liquid stock ranked by RS Rating')
    expect(scanCalls().at(-1).view).toBe('rs_top_rating')
    const r4 = screen.getByTestId('terminal-rss-row-RISE4').textContent
    for (const s of ['#2', '96', 'Tight range', 'was #6 a month ago']) expect(r4).toContain(s)
    expect(screen.getByTestId('terminal-rss-method').textContent).toContain('Showing the first 8 of 61')

    fireEvent.click(screen.getByTestId('terminal-rss-screen-NHBP'))
    expect(wire.writeBack).toHaveBeenLastCalledWith(['NHBP'])
    await screen.findByTestId('terminal-rss-row-WALK20')
    expect(headers()).toEqual(['Symbol', 'RS Rating', 'Price vs its high', 'Price', 'Day change', 'Industry', 'Note'])
    const walk = screen.getByTestId('terminal-rss-row-WALK20').textContent
    for (const s of ['55', '3% below its high', '-0.70%', 'Machinery', 'Weekly RS high']) expect(walk).toContain(s)
    expect(screen.queryByTestId('terminal-rss-row-RISE5')).toBeNull()   // never the last screen's rows
    expect(publishRows.mock.calls.at(-1)[0][0]).toBe('$WALK20')

    fireEvent.click(screen.getByTestId('terminal-rss-screen-EXIT'))
    expect(wire.writeBack).toHaveBeenLastCalledWith(['EXIT'])
    await screen.findByTestId('terminal-rss-row-SLIP2')
    expect(headers()).toEqual(['Symbol', 'RS Rating', 'Warning', 'Price', 'Day change', 'Industry'])
    expect(screen.getByTestId('terminal-rss-row-FALL3').textContent).toContain('Grateful Dead Break yesterday')
    expect(screen.getByTestId('terminal-rss-about').textContent).toContain('A prompt to review a position, not an order to sell.')
    expect(screen.getByTestId('terminal-rss-method').textContent).toContain('4 stocks, in the screen\'s own order.')

    fireEvent.click(screen.getByTestId('terminal-rss-screen-LEADERS'))
    expect(wire.writeBack).toHaveBeenLastCalledWith([])   // the default screen is the bare command
  })

  it('a typed word or a starter id seeds the screen; one the server does not serve opens the default', async () => {
    serve({ scans: ALL_SCANS })
    renderPanel({ screen: 'nh' })
    await screen.findByTestId('terminal-rss-table')
    expect(screen.getByTestId('terminal-rss').getAttribute('data-screen')).toBe(NH)
    expect(screen.getByTestId('terminal-rss-row-RISE5').textContent).toContain('RS high today')
    cleanup()
    renderPanel({ screen: EXIT })
    await screen.findByTestId('terminal-rss-row-SLIP2')
    expect(screen.getByTestId('terminal-rss-screen-EXIT').getAttribute('aria-pressed')).toBe('true')
    cleanup()
    renderPanel({ screen: 'NOPE' })
    await screen.findByTestId('terminal-rss-table')
    expect(screen.getByTestId('terminal-rss').getAttribute('data-screen')).toBe(LEADERS)
  })
})

describe('RSS follows the member\'s theme', () => {
  it('the panel and its model hold no hard-coded color', () => {
    for (const file of ['RsScreensPanel.jsx', 'rsScreensModel.js']) {
      const text = fs.readFileSync(path.join(HERE, file), 'utf8')
      expect(colourLiteralsIn(`pages/terminal/panels/${file}`, text).map((h) => h.lit), file).toEqual([])
    }
  })
})

describe('RSS accessibility', () => {
  it('a populated screen, an empty one and the switched-off state pass axe (WCAG A and AA)', async () => {
    serve({ saved: SAVED_CAUTION, scans: { ...ALL_SCANS, [NHBP]: scanAnswer(NHBP, { total: 0, rows: [], coverage: COVERAGE }) } })
    renderPanel()
    await screen.findByTestId('terminal-rss-table')
    await expectNoAxeViolations(document.body.firstElementChild)
    fireEvent.click(screen.getByTestId('terminal-rss-screen-NHBP'))
    await screen.findByTestId('terminal-rss-empty')
    await expectNoAxeViolations(document.body.firstElementChild)
    cleanup()
    jsonFetcher.mockReset()
    serve({ saved: SAVED_OFF })
    renderPanel()
    await screen.findByTestId('terminal-rss-off')
    await expectNoAxeViolations(document.body.firstElementChild)
  }, 20_000)
})
