// RS screens, unit U6: the client's row code run on rows the SERVER REALLY SENT.
//
// tests/fixtures/rs_screens_rows.json is written by tests/test_rs_screens_u6_e2e.py: the real
// nightly build and the real rating pass over a synthetic market, asked through the real scan
// route with this client's own requests (rs_screens_scan_requests.json). So every value below
// arrived typed and named as production sends it, and what this file pins is what a member
// would read: the place, the lead number, the caption, the tag and the header line.
//
// ⚰️ Found here, not by either half's own tests:
//   * on Top RS Rating's 1-month board the rows were numbered by their OVERALL place (20, 3, 7,
//     31, 1 ...) beside a list ordered by the 1-month place. The option now names its own place
//     column and the caption stops saying "was #N a month ago" beside a number it is not about;
//   * that board can list a stock too young to have any rating: its RS number is blank.
//
// When the server changes what it serves, this moves in the same commit as the fixture
// (UPDATE_RS_SCREENS_GOLDEN=1 on the Python side), and the tables below are read again by a person.
import { screen, waitFor, fireEvent, within, act } from '@testing-library/react'
import { vi, beforeEach, describe, expect, test } from 'vitest'
vi.mock('../../../../components/StockChart', () => ({ default: p => <div data-testid="stockchart" data-sym={p.sym} /> }))
vi.mock('../ScreenerChartWidget', () => ({ default: p => <div data-testid="stockchart" data-sym={p.sym} /> }))
vi.mock('../../shell/ScannerShell', () => ({ default: () => <div data-testid="table-mode" /> }))
vi.mock('../../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {} }) }))
vi.mock('../../../../hooks/useNeighborWarm', () => ({ useNeighborWarm: () => {} }))
vi.mock('../../../../utils/prefetchBars', () => ({ prefetchBars: () => {}, prefetchBarsToIDB: () => {}, warmMemFromIDB: () => {}, prewarmVisibleList: () => {} }))
import { __resetCountCache } from '../useLazyCounts'
import { __resetRevisionStateForTests } from '../../../../hooks/usePreferences'
import { rowConfigOf, rowColumns, rowDisplay, leadOf, ratingsAsOf, rowFacts, movingWords, OVERALL_PLACE } from '../rsRows'
import { controlsOf, placeOverride, specWithOption, activeOption, RS_CONTROLS_PREF, RS_NOTE_PREF } from '../rsScreens'
import { net, resetNet, installFetch, mount, scanBodies, pin } from './rsHarness'
import { RS_STARTERS, TOP_RATING, NEW_HIGHS, BEFORE_PRICE, LEADERS, EXIT_WARNINGS, RS_ROWS, SERVED, readServerFixture } from './rsScreensFixture'

const ROWS = readServerFixture('rs_screens_rows.json')
const REQUESTS = readServerFixture('rs_screens_scan_requests.json').requests
const rowsOf = st => ROWS.screens[st.id].rows
const keyed = spec => ({ filters: Object.fromEntries(spec.filters.map(({ key, ...r }) => [key, r])), sort: spec.sort || null, rank: spec.rank || null })
// One row as a member reads it: [ticker, place, lead number ("*" = gold, 90 and up), caption, tag].
const line = (r, cfg, i) => {
  const d = rowDisplay(r, cfg, { index: i })
  const lead = leadOf(r)
  return [r.ticker, d.place, lead ? `RS ${lead.value}${lead.top ? '*' : ''}` : null, d.caption, d.tag]
}
const read = (st, rows = rowsOf(st), cfg = rowConfigOf(st)) => rows.map((r, i) => line(r, cfg, i))

describe('the server answered what the row reads', () => {
  test('every screen opens with rows, on the rating session the header names', () => {
    expect(Object.keys(ROWS.screens)).toEqual(RS_STARTERS.map(s => s.id))
    for (const st of RS_STARTERS) {
      expect(rowsOf(st).length, st.id).toBeGreaterThanOrEqual(3)
      expect(ratingsAsOf(rowsOf(st)), st.id).toBe('Ratings as of Feb 27')
      expect(ROWS.screens[st.id].view).toBe(st.spec.view)
    }
    expect(ROWS.session).toBe('2026-02-27')
  })
  test('every column the row, the caption, the tags and the header read is on every row', () => {
    for (const st of RS_STARTERS) {
      for (const r of rowsOf(st)) for (const col of rowColumns(rowConfigOf(st))) expect(col in r, `${st.id} ${r.ticker} ${col}`).toBe(true)
    }
  })
  test('the values are typed the way the client tests them', () => {
    const all = [...RS_STARTERS.flatMap(rowsOf), ...ROWS.top_rating_one_month.rows]
    const whole = v => v === null || Number.isInteger(v)
    for (const r of all) {
      // `=== 1` in setupWords: a JSON true would never be 1
      expect([0, 1, null], `${r.ticker} rs_tight`).toContain(r.rs_tight)
      for (const k of ['rs_rank', 'rs_rating_pos', 'rs_rating_pos_n', 'rs_nh_bars_ago', 'rs_nh_red_bars_ago', 'rs_nhbp_age', 'rs_rating_pos_prev20', 'rs_rating_chg_5']) {
        if (k in r) expect(whole(r[k]), `${r.ticker} ${k}`).toBe(true)
      }
      if (r.px_below_high_pct !== null) { expect(r.px_below_high_pct).toBeLessThanOrEqual(0); expect(Object.is(r.px_below_high_pct, -0)).toBe(false) }
      expect(r.rs_rating_session === null || /^\d{4}-\d{2}-\d{2}$/.test(r.rs_rating_session), r.ticker).toBe(true)
      expect([null, ...Object.keys(SERVED.words.setup)], `${r.ticker} rs_setup`).toContain(r.rs_setup)
      if ('rs_flag' in r) expect([null, ...Object.keys(SERVED.words.flags)], `${r.ticker} rs_flag`).toContain(r.rs_flag)
    }
  })
  test('the hand-written sample rows use only columns the server has', () => {
    // RS_ROWS (rsScreensFixture) stay hand-written, one per caption and tag rule. Each key is a
    // column a served row carries, or a filter key the registry serves.
    const real = new Set([...RS_STARTERS.flatMap(rowsOf), ...ROWS.top_rating_one_month.rows].flatMap(r => Object.keys(r)))
    for (const f of SERVED.meta.filters) real.add(f.key)
    for (const r of RS_ROWS) for (const k of Object.keys(r)) expect(real.has(k), k).toBe(true)
  })
  test('the capture holds one request per screen and per option, and the place column is always asked for', () => {
    const options = RS_STARTERS.flatMap(st => controlsOf(st).flatMap(c => c.options.filter(o => !o.default)))
    expect(REQUESTS).toHaveLength(RS_STARTERS.length + options.length)
    for (const req of REQUESTS) {
      const st = RS_STARTERS.find(s => s.id === req.starter)
      const cfg = rowConfigOf(st, placeOverride(controlsOf(st), keyed(req.body)))
      for (const col of rowColumns(cfg)) expect(req.body.columns, `${req.starter} ${JSON.stringify(req.choices)} ${col}`).toContain(col)
    }
  })
})

describe('what a member reads on each screen as it opens', () => {
  test('Top RS Rating: the exact place, the Setup words, and where the place was a month ago', () => {
    expect(read(TOP_RATING)).toEqual([
      ['RISE5', 1, 'RS 99*', 'Pullback to the 8-day, tight range', ''],
      ['RISE4', 2, 'RS 96*', 'Pullback to the 8-day, tight range · was #6 a month ago', ''],
      ['RUN1', 3, 'RS 93*', 'Extended · was #28 a month ago', ''],
      ['WALK23', 4, 'RS 92*', 'Pullback to the 8-day, tight range · was #8 a month ago', ''],
      ['SLIP0', 5, 'RS 90*', 'Pullback to the 21-day, tight range · was #7 a month ago', ''],
      ['WALK17', 6, 'RS 89', 'Pullback to the 8-day, tight range · was #13 a month ago', ''],
      ['RUN0', 7, 'RS 87', 'Extended · was #43 a month ago', ''],
      ['RISE3', 8, 'RS 86', 'Pullback to the 8-day, tight range · was #10 a month ago', ''],
    ])
    expect(rowFacts(rowsOf(TOP_RATING)[0]).map(f => f.label)).toEqual(['Pullback to the 8-day, tight range', 'RS high today', 'At its high', 'RS Rating place 1 of 62'])
  })
  test('RS New Highs: how old the RS high is, the group, and "Before price" on the one that leads price', () => {
    expect(read(NEW_HIGHS)).toEqual([
      ['RISE5', null, 'RS 99*', 'RS high today · Retail', ''],
      ['RISE4', null, 'RS 96*', 'RS high today · Banks', ''],
      ['RUN1', null, 'RS 93*', 'RS high today · Drug makers', ''],
      ['WALK23', null, 'RS 92*', 'RS high today · Retail', ''],
      ['WALK17', null, 'RS 89', 'RS high today · Retail', ''],
      ['RUN0', null, 'RS 87', 'RS high today · Semiconductors', ''],
      ['SLIP3', null, 'RS 81', 'RS high today · Retail', ''],
      ['UPDAY1', null, 'RS 80', 'RS high today · Oil and gas', 'Before price'],
    ])
    // newest RS high first; the names that share an age fall in rating order (the second sort key)
    const ages = rowsOf(NEW_HIGHS).map(r => r.rs_nh_bars_ago)
    expect(ages).toEqual([...ages].sort((a, b) => a - b))
    const scores = rowsOf(NEW_HIGHS).filter(r => r.rs_nh_bars_ago === ages[0]).map(r => r.rs_rating_score)
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
  })
  test('RS New High Before Price: how far under its high, and the market down day tag only where the RS high fell on one', () => {
    expect(read(BEFORE_PRICE)).toEqual([
      ['WALK20', null, 'RS 55', '3% below its high · Machinery', 'Market down day'],
      ['HOLD0', null, 'RS 40', '3% below its high · Machinery', 'Market down day'],
      ['WALK06', null, 'RS 26', '4% below its high · Semiconductors', 'Market down day'],
      ['WALK05', null, 'RS 19', '4% below its high · Retail', 'Market down day'],
      ['HOLD1', null, 'RS 52', '4% below its high · Oil and gas', 'Market down day'],
      ['WALK14', null, 'RS 28', '5% below its high · Machinery', 'Market down day'],
      ['WALK26', null, 'RS 46', '5% below its high · Machinery', ''],
      ['WALK11', null, 'RS 23', '6% below its high · Retail', ''],
    ])
    for (const r of rowsOf(BEFORE_PRICE)) {
      expect(r.rs_nhbp_age).toBe(r.rs_nh_bars_ago)            // a before-price age IS the newest RS high's age
      expect(r.px_below_high_pct).toBeLessThanOrEqual(-3)     // the default "Below its high by 3%"
    }
  })
  test('UCT RS Leaders: numbered by position, the Setup words, the group', () => {
    expect(read(LEADERS)).toEqual([
      ['RISE5', 1, 'RS 99*', 'Pullback to the 8-day, tight range · Retail', ''],
      ['RISE4', 2, 'RS 96*', 'Pullback to the 8-day, tight range · Banks', ''],
      ['RUN1', 3, 'RS 93*', 'Extended · Drug makers', ''],
      ['WALK23', 4, 'RS 92*', 'Pullback to the 8-day, tight range · Retail', ''],
      ['SLIP0', 5, 'RS 90*', 'Pullback to the 21-day, tight range · Machinery', ''],
      ['WALK17', 6, 'RS 89', 'Pullback to the 8-day, tight range · Retail', ''],
      ['RUN0', 7, 'RS 87', 'Extended · Semiconductors', ''],
      ['RISE3', 8, 'RS 86', 'Pullback to the 8-day, tight range · Oil and gas', ''],
    ])
    for (const r of rowsOf(LEADERS)) expect(r.rs_rank).toBeGreaterThanOrEqual(80)
  })
  test('RS exit warnings: the RS number and the group', () => {
    expect(read(EXIT_WARNINGS)).toEqual([
      ['SLIP2', null, 'RS 58', 'Banks', ''],
      ['SLIP5', null, 'RS 17', 'Drug makers', ''],
      ['FALL3', null, 'RS 14', 'Drug makers', ''],
      ['SLIP4', null, 'RS 13', 'Semiconductors', ''],
    ])
  })
})

// ── the 1-month board of Top RS Rating ───────────────────────────────────────────────────────
const rankBy = controlsOf(TOP_RATING).find(c => c.id === 'rank_by')
const monthSpec = keyed(specWithOption(TOP_RATING.spec, rankBy, rankBy.options.find(o => o.id === 'm1')))
const MONTH = ROWS.top_rating_one_month.rows

describe('Top RS Rating on its 1-month board', () => {
  test('the option names its own place column, and only the four period options do', () => {
    const withPlace = RS_STARTERS.flatMap(st => controlsOf(st).flatMap(c => c.options.filter(o => o.place).map(o => [st.id, c.id, o.id, o.place])))
    expect(withPlace).toEqual([
      ['starter_rs_top_rating', 'rank_by', 'm1', 'rs_pos_1m'], ['starter_rs_top_rating', 'rank_by', 'm3', 'rs_pos_3m'],
      ['starter_rs_top_rating', 'rank_by', 'm6', 'rs_pos_6m'], ['starter_rs_top_rating', 'rank_by', 'm12', 'rs_pos_12m'],
    ])
    for (const o of rankBy.options.filter(x => x.place)) { expect(o.sort.key).toBe(o.place); expect(rankBy.keys).toContain(o.place) }
    expect(activeOption(rankBy, monthSpec).id).toBe('m1')
    expect(placeOverride(controlsOf(TOP_RATING), monthSpec)).toBe('rs_pos_1m')
    // every other reading keeps the starter's own place
    expect(placeOverride(controlsOf(TOP_RATING), keyed(TOP_RATING.spec))).toBeNull()
    expect(placeOverride(controlsOf(TOP_RATING), { ...monthSpec, sort: { key: 'price', dir: 'desc' } })).toBeNull()
    expect(rowConfigOf(TOP_RATING).place).toBe(OVERALL_PLACE)
    // a screen numbered by position, or with no place at all, never takes a column
    expect(rowConfigOf(LEADERS, 'rs_pos_1m').place).toBe('index')
    expect(rowConfigOf(NEW_HIGHS, 'rs_pos_1m').place).toBeNull()
  })
  test('the rows are numbered by the 1-month place, climbing down the list', () => {
    const cfg = rowConfigOf(TOP_RATING, placeOverride(controlsOf(TOP_RATING), monthSpec))
    expect(cfg.place).toBe('rs_pos_1m')
    expect(read(TOP_RATING, MONTH, cfg)).toEqual([
      // #1 on this board is the buyout name, which the screen leaves out: the list starts at 2
      ['ONEDAY', 2, 'RS 68', 'Extended · RS Rating up 57 this week', 'One-day move'],
      ['RUN1', 3, 'RS 93*', 'Extended · RS Rating up 18 this week', ''],
      ['RUN0', 4, 'RS 87', 'Extended · RS Rating up 16 this week', ''],
      ['WALK21', 5, 'RS 51', 'Pullback to the 8-day, tight range · RS Rating up 6 this week', ''],
      ['RISE5', 6, 'RS 99*', 'Pullback to the 8-day, tight range', ''],
      ['WALK08', 7, 'RS 37', 'Pullback to the 8-day, tight range · RS Rating up 5 this week', ''],
      ['WALK04', 8, 'RS 32', 'Pullback to the 8-day, tight range · RS Rating up 9 this week', ''],
      ['WALK13', 9, 'RS 49', 'Pullback to the 8-day, tight range · RS Rating up 12 this week', ''],
      // listed forty sessions ago: on the 1-month board before it has any rating
      ['BABY', 12, null, '', 'New issue'],
    ])
    const places = MONTH.map(r => r.rs_pos_1m)
    expect(places).toEqual([...places].sort((a, b) => a - b))
  })
  test('⚰️ numbered by the starter\'s own column the same rows read out of order, with a blank', () => {
    // What the page drew before unit U6. Kept so the reason for `place` on an option stays visible.
    const before = read(TOP_RATING, MONTH, rowConfigOf(TOP_RATING)).map(l => l[1])
    expect(before).toEqual([20, 3, 7, 31, 1, 39, 42, 32, null])
    // and the caption beside the 1-month number would be about the overall place a month ago
    expect(read(TOP_RATING, MONTH, rowConfigOf(TOP_RATING))[0][3]).toBe('Extended · was #57 a month ago')
  })
  test('"was #N a month ago" is said only beside the overall place', () => {
    const r = MONTH.find(x => x.ticker === 'RUN1')
    expect(movingWords(r)).toBe('was #28 a month ago')
    expect(movingWords(r, { overall: false })).toBe('RS Rating up 18 this week')
    expect(movingWords({ ...r, rs_rating_chg_5: 0 }, { overall: false })).toBe('')
  })
})

describe('the page, on rows the server sent', () => {
  beforeEach(() => {
    __resetCountCache()
    __resetRevisionStateForTests()
    localStorage.clear()
    sessionStorage.clear()
    window.history.replaceState(null, '', '/')
    resetNet()
    net.meta = { filters: SERVED.meta.filters, categories: [{ key: 'relative_strength', label: 'Relative strength' }], views: SERVED.meta.views }
    installFetch()
  })
  const places = () => screen.getAllByTestId('rs-place').map(el => el.textContent.replace(/[^0-9]/g, ''))

  test('Top RS Rating opens numbered by the overall place; its 1-month board by the 1-month place', async () => {
    net.prefs = { [RS_NOTE_PREF]: '1' }
    net.rows = rowsOf(TOP_RATING)
    pin([TOP_RATING.id])
    const view = mount()
    await waitFor(() => expect(screen.getByTestId('focus-row-RISE5')).toBeInTheDocument())
    expect(places()).toEqual(['1', '2', '3', '4', '5', '6', '7', '8'])
    expect(screen.getAllByTestId('rs-lead')[0].textContent).toContain('RS 99')
    expect(screen.getByTestId('rs-asof').textContent).toBe('Ratings as of Feb 27')
    view.unmount()

    // a returning member who chose "1M": one scan, the board's own numbers, a blank RS for BABY
    localStorage.clear(); sessionStorage.clear(); __resetCountCache(); __resetRevisionStateForTests()
    resetNet()
    net.meta = { filters: SERVED.meta.filters, categories: [], views: SERVED.meta.views }
    installFetch()
    net.prefs = { [RS_NOTE_PREF]: '1', [RS_CONTROLS_PREF]: JSON.stringify({ [TOP_RATING.id]: { rank_by: 'm1' } }) }
    net.rows = MONTH
    pin([TOP_RATING.id])
    mount()
    await waitFor(() => expect(screen.getByTestId('focus-row-BABY')).toBeInTheDocument())
    expect(scanBodies().at(-1).sort).toEqual({ key: 'rs_pos_1m', dir: 'asc' })
    expect(scanBodies().at(-1).columns).toContain('rs_pos_1m')
    expect(places()).toEqual(['2', '3', '4', '5', '6', '7', '8', '9', '12'])
    const baby = screen.getByTestId('focus-row-BABY')
    expect(baby.querySelector('[data-testid="rs-lead"]').textContent).toBe('')
    expect(baby.querySelector('[data-testid="rs-tag"]').textContent).toContain('New issue')
    // and no caption on this board is about a place the numeral does not show
    for (const el of screen.getAllByTestId('rs-caption')) expect(el.textContent).not.toMatch(/a month ago/)
  })

  test('while the 1-month board is still on its way, the rows on view keep the numbers of the board they answer', async () => {
    net.prefs = { [RS_NOTE_PREF]: '1' }
    net.rows = MONTH                       // every row carries both place columns
    pin([TOP_RATING.id])
    // the 1-month scan is held until released
    const base = globalThis.fetch
    let release = null
    globalThis.fetch = vi.fn((u, o) => {
      if (String(u) === '/api/screener/scan' && JSON.parse(o.body).sort?.key === 'rs_pos_1m') return new Promise(resolve => { release = () => resolve(base(u, o)) })
      return base(u, o)
    })
    mount()
    await waitFor(() => expect(screen.getByTestId('focus-row-RUN1')).toBeInTheDocument())
    const overall = MONTH.map(r => (r.rs_rating_pos == null ? '' : String(r.rs_rating_pos)))
    expect(places()).toEqual(overall)
    fireEvent.click(within(screen.getByTestId('rs-controls')).getByRole('radio', { name: '1M' }))
    await waitFor(() => expect(release).toBeTypeOf('function'))
    // asked, not answered: the list is the overall board's, dimmed, and still numbered as that board
    expect(screen.getByTestId('rs-head')).toHaveAttribute('data-pending')
    expect(places()).toEqual(overall)
    await act(async () => { release() })
    await waitFor(() => expect(places()).toEqual(MONTH.map(r => String(r.rs_pos_1m))))
  })
})
