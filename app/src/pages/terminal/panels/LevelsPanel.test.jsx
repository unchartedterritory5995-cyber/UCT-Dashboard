// LVL: the key price levels for one stock. Rails:
//   * the pure half (levelsModel.js): each read parsed to ok / failed / no-options, ONE list of
//     levels highest price first with the price marked among them, distance and side per level;
//   * the two reads fail apart: one failing keeps the other's levels and says what is missing;
//   * an `error` inside a 200 answer is a failed read (a note with Retry), never "no levels";
//   * a healthy answer with no levels says there are none, and why;
//   * both requests failing is an error with Retry; 402 and 404 are locked; 422 is a bad ticker;
//   * the price is the options read's own; the shared live pool only stands in when it gave none.
// Fixtures are the shapes api/routers/signature.py returns (gex_walls.py, darkpool_levels.py).
// Neither route has a "building" answer, so there is no warming state to test.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { SWRConfig } from 'swr'

const live = vi.hoisted(() => ({ prices: {}, asked: [] }))
vi.mock('../../../hooks/useLivePrices', () => ({
  default: (tickers) => { live.asked.push(tickers); return { prices: live.prices, isLoading: false, error: null } },
}))
vi.mock('../../../utils/jsonFetcher', () => ({ default: vi.fn() }))
import jsonFetcher from '../../../utils/jsonFetcher'
import { PanelFreshnessContext, PanelListContext, TerminalPanelContext } from '../../../components/terminal'
import LevelsPanel, {
  GEX_BAND_PCT, LEVELS_CODE, LEVEL_KINDS, REGIME_TEXT, darkPoolRead, darkpoolLevelsUrl, detailText, distancePct,
  distanceText, gexRead, gexWallsUrl, kindsIn, levelRows, sideOf,
} from './LevelsPanel'
import * as model from './levelsModel'

const secs = (iso) => Date.parse(iso) / 1000
const GEX = {
  sym: 'NVDA', version: 'gxw-v1', spot: 100, regime: 'bullish', asOf: secs('2026-11-13T19:31:00Z'),
  levels: [{ kind: 'callWall', price: 110 }, { kind: 'putWall', price: 95 }, { kind: 'zeroGamma', price: 98.5 }],
}
const DP = {
  sym: 'NVDA', version: 'dpl-v1', windowDays: 20, datesCovered: 18, asOf: secs('2026-11-13T19:25:00Z'),
  levels: [
    { price: 103.4, notional: 45_300_000, printCount: 12, lastDate: '2026-11-12', lo: 103.27, hi: 103.53, rank: 1 },
    { price: 91.4, notional: 12_000_000, printCount: 1, lastDate: '2026-11-05', lo: 91.29, hi: 91.51, rank: 2 },
  ],
}
const GEX_ERR = { sym: 'NVDA', levels: [], version: 'gxw-v1', error: 'gex walls unavailable: token refresh failed', asOf: secs('2026-11-13T19:31:00Z') }
const GEX_NO_OPTIONS = { sym: 'NVDA', levels: [], version: 'gxw-v1', error: 'No options data with greeks for NVDA', asOf: secs('2026-11-13T19:31:00Z') }
const DP_ERR = { sym: 'NVDA', version: 'dpl-v1', levels: null, error: 'dark pool levels unavailable: database is locked', asOf: secs('2026-11-13T19:25:00Z') }

const G = gexWallsUrl('NVDA')
const D = darkpoolLevelsUrl('NVDA')
const httpError = (status) => Object.assign(new Error(`http ${status}`), { status })
const PENDING = Symbol('pending')
/** Serves each URL its body (an Error is thrown, PENDING never answers); anything else is a 500. */
function serve(routes) {
  jsonFetcher.mockImplementation((url) => {
    if (!(url in routes)) return Promise.reject(httpError(500))
    const hit = routes[url]
    if (hit === PENDING) return new Promise(() => {})
    return hit instanceof Error ? Promise.reject(hit) : Promise.resolve(hit)
  })
}

function Harness({ sym, freshness, code, open }) {
  const tree = (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <PanelFreshnessContext.Provider value={freshness}>
        <PanelListContext.Provider value={{ open, run: vi.fn(), publish: vi.fn(), publishRows: vi.fn() }}>
          <LevelsPanel sym={sym} />
        </PanelListContext.Provider>
      </PanelFreshnessContext.Provider>
    </SWRConfig>
  )
  return code ? <TerminalPanelContext.Provider value={{ code, density: 'compact', inset: true }}>{tree}</TerminalPanelContext.Provider> : tree
}
function renderPanel(sym = 'NVDA', { freshness = vi.fn(), code = null, open = vi.fn() } = {}) {
  const view = render(<Harness sym={sym} freshness={freshness} code={code} open={open} />)
  return { ...view, freshness, open }
}
const tableRows = () => within(screen.getByTestId('terminal-lvl-table')).getAllByRole('row').slice(1)
const rowKinds = () => tableRows().map((r) => r.getAttribute('data-testid').replace('terminal-lvl-row-', ''))
const cells = (row) => within(row).getAllByRole('cell').map((c) => c.textContent)

beforeEach(() => { jsonFetcher.mockReset(); live.prices = {}; live.asked = [] })
afterEach(cleanup)

describe('LVL pure helpers (levelsModel)', () => {
  it('the panel re-exports the model, so a caller can import either', () => {
    expect(levelRows).toBe(model.levelRows)
    expect(gexRead).toBe(model.gexRead)
    expect(LEVELS_CODE).toBe('LVL')
    expect(GEX_BAND_PCT).toBe(15)
  })

  it('the two URLs carry the ticker, encoded', () => {
    expect(G).toBe('/api/signature/gex-walls?sym=NVDA')
    expect(D).toBe('/api/signature/darkpool-levels?sym=NVDA')
    expect(gexWallsUrl('BRK.B')).toBe('/api/signature/gex-walls?sym=BRK.B')
    expect(darkpoolLevelsUrl('A B')).toBe('/api/signature/darkpool-levels?sym=A%20B')
  })

  it('gexRead: a healthy answer keeps its levels, price, lean and as-of', () => {
    expect(gexRead(GEX)).toEqual({
      state: 'ok', spot: 100, regime: 'bullish', asOf: GEX.asOf,
      levels: [{ kind: 'callWall', price: 110 }, { kind: 'putWall', price: 95 }, { kind: 'zeroGamma', price: 98.5 }],
    })
    // an empty list with no error is healthy; junk kinds and prices are dropped; an unknown lean is null
    expect(gexRead({ ...GEX, levels: [], regime: '' })).toMatchObject({ state: 'ok', levels: [], regime: null })
    expect(gexRead({ ...GEX, levels: [{ kind: 'gammaFlip', price: 99 }, { kind: 'callWall', price: 'x' }, null, { kind: 'putWall', price: 90 }] }).levels)
      .toEqual([{ kind: 'putWall', price: 90 }])
  })

  it('gexRead: an error in a 200 body is a failed read, or "no options" when the source says so', () => {
    expect(gexRead(GEX_ERR)).toMatchObject({ state: 'failed', levels: [], spot: null, asOf: GEX_ERR.asOf })
    expect(gexRead(GEX_NO_OPTIONS).state).toBe('no-options')
    expect(gexRead({ levels: [], error: 'No spot price for ZZQXV' }).state).toBe('no-options')
    expect(gexRead({ levels: [], error: 'GEX not computable for AAA: 40 contracts came back without gamma or open interest' }).state).toBe('no-options')
    expect(gexRead({ levels: [], error: 'no data' }).state).toBe('failed')
    // no price (the service folds a missing or non-finite price to spot 0): not a healthy answer
    expect(gexRead({ sym: 'NVDA', levels: [], spot: 0, regime: '' }).state).toBe('failed')
    for (const body of [null, undefined, [], 'x', { spot: 100 }]) expect(gexRead(body).state).toBe('failed')
  })

  it('darkPoolRead: levels with their size, zone and last print; `levels: null` is a failed read', () => {
    const dp = darkPoolRead(DP)
    expect(dp).toMatchObject({ state: 'ok', windowDays: 20, datesCovered: 18, asOf: DP.asOf })
    expect(dp.levels[0]).toEqual({
      kind: 'darkPool', price: 103.4, notional: 45_300_000, printCount: 12, lastDate: '2026-11-12', lo: 103.27, hi: 103.53, rank: 1,
    })
    expect(darkPoolRead(DP_ERR)).toMatchObject({ state: 'failed', levels: [], asOf: DP_ERR.asOf })
    expect(darkPoolRead({ ...DP, levels: [] })).toMatchObject({ state: 'ok', levels: [] })
    expect(darkPoolRead({ ...DP, levels: [{ price: 0 }, { price: 50, lastDate: '9/5' }] }).levels)
      .toEqual([{ kind: 'darkPool', price: 50, notional: null, printCount: null, lastDate: null, lo: null, hi: null, rank: null }])
    for (const body of [null, undefined, [], 'x', {}]) expect(darkPoolRead(body).state).toBe('failed')
  })

  it('distance is a percent of the price, and its side is said in a word', () => {
    expect(distancePct(110, 100)).toBeCloseTo(10)
    expect(distancePct(95, 100)).toBeCloseTo(-5)
    for (const [l, p] of [[110, null], [null, 100], [110, 0], ['x', 100]]) expect(distancePct(l, p)).toBeNull()
    expect([sideOf(10), sideOf(-5), sideOf(0.01), sideOf(-0.04), sideOf(null), sideOf(NaN)]).toEqual(['above', 'below', 'at', 'at', null, null])
  })

  it('levelRows: one list, highest price first, the price marked among the levels', () => {
    const rows = levelRows({ gexLevels: gexRead(GEX).levels, darkPoolLevels: darkPoolRead(DP).levels, price: 100 })
    expect(rows.map((r) => `${r.kind}@${r.price}`)).toEqual([
      'callWall@110', 'darkPool@103.4', 'price@100', 'zeroGamma@98.5', 'putWall@95', 'darkPool@91.4',
    ])
    expect(rows.map((r) => r.side ?? null)).toEqual(['above', 'above', null, 'below', 'below', 'below'])
    expect(rows[0]).toMatchObject({ label: 'Call wall', distPct: 10 })
    expect(rows[5]).toMatchObject({ label: 'Dark pool level', notional: 12_000_000, printCount: 1 })
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length)
    // a level exactly at the price sits above the marker
    expect(levelRows({ gexLevels: [{ kind: 'putWall', price: 100 }], price: 100 }).map((r) => r.kind)).toEqual(['putWall', 'price'])
    expect(kindsIn(rows)).toEqual(['callWall', 'putWall', 'zeroGamma', 'darkPool'])
    expect(kindsIn(levelRows({ darkPoolLevels: darkPoolRead(DP).levels, price: 100 }))).toEqual(['darkPool'])
  })

  it('levelRows: with no price the levels are still listed, with no marker and no distance', () => {
    const rows = levelRows({ darkPoolLevels: darkPoolRead(DP).levels })
    expect(rows.map((r) => r.kind)).toEqual(['darkPool', 'darkPool'])
    expect(rows.every((r) => r.distPct === null && r.side === null)).toBe(true)
    expect(levelRows()).toEqual([])
  })

  it('every kind has a plain label and one sentence; every lean has a sentence', () => {
    expect(Object.keys(LEVEL_KINDS)).toEqual(['callWall', 'putWall', 'zeroGamma', 'darkPool'])
    for (const k of Object.values(LEVEL_KINDS)) {
      expect(k.label).toBeTruthy()
      expect(k.meaning.length).toBeGreaterThan(40)
      expect(k.meaning).not.toMatch(/[—–]/)
    }
    expect(Object.keys(REGIME_TEXT)).toEqual(['bullish', 'bearish', 'choppy', 'unbound'])
  })

  it('distanceText and detailText use the shared formatters', () => {
    expect(distanceText({ distPct: 10, side: 'above' })).toBe('+10.0% above')
    expect(distanceText({ distPct: -8.6, side: 'below' })).toBe('-8.6% below')
    expect(distanceText({ distPct: 0.01, side: 'at' })).toBe('at the price')
    expect(distanceText({ distPct: null, side: null })).toBe('n/a')
    expect(detailText({ kind: 'callWall' })).toBe('Options expiring within a week')
    expect(detailText(darkPoolRead(DP).levels[0])).toBe('$45.3M in 12 prints, zone $103.27 to $103.53, last print 2026-11-12')
    expect(detailText(darkPoolRead(DP).levels[1])).toContain('$12.0M in 1 print,')
    expect(detailText({ kind: 'darkPool', notional: null, lo: null, hi: null, lastDate: null })).toBe('Dark pool prints')
  })
})

describe('LVL panel', () => {
  it('needs a ticker, and says so with the code it runs under', () => {
    renderPanel('', { code: 'LVLS' })
    expect(screen.getByText('LVLS needs a ticker.')).toBeTruthy()
    expect(jsonFetcher).not.toHaveBeenCalled()
    cleanup()
    renderPanel(null)
    expect(screen.getByText('LVL needs a ticker.')).toBeTruthy()
  })

  it('shows a skeleton while both reads are out', () => {
    serve({ [G]: PENDING, [D]: PENDING })
    renderPanel('nvda')
    expect(screen.getByTestId('terminal-lvl-loading').textContent).toContain('Reading the key levels for NVDA')
    expect(jsonFetcher).toHaveBeenCalledWith(G)
    expect(jsonFetcher).toHaveBeenCalledWith(D)
    expect(screen.queryByTestId('terminal-lvl-table')).toBeNull()
  })

  it('lists every level highest first, marks the price among them, and says what each kind means', async () => {
    serve({ [G]: GEX, [D]: DP })
    const { freshness } = renderPanel()
    await screen.findByTestId('terminal-lvl-row-callWall')
    expect(rowKinds()).toEqual(['callWall', 'darkPool', 'price', 'zeroGamma', 'putWall', 'darkPool'])
    const [call, dpHigh, price, zero, put, dpLow] = tableRows()
    expect(cells(call)).toEqual(['Call wall', '110.00', '+10.0% above', 'Options expiring within a week'])
    expect(cells(dpHigh)).toEqual(['Dark pool level', '103.40', '+3.4% above', '$45.3M in 12 prints, zone $103.27 to $103.53, last print 2026-11-12'])
    expect(cells(price)).toEqual(['Price at 2:31 PM ET', '100.00', '', 'Read with the options data'])
    expect(price.getAttribute('aria-current')).toBe('true')
    expect(cells(zero).slice(0, 3)).toEqual(['Zero gamma', '98.50', '-1.5% below'])
    expect(cells(put).slice(0, 3)).toEqual(['Put wall', '95.00', '-5.0% below'])
    expect(cells(dpLow).slice(0, 3)).toEqual(['Dark pool level', '91.40', '-8.6% below'])
    expect(put.getAttribute('data-side')).toBe('below')
    expect(screen.getByTestId('terminal-lvl-regime').textContent).toBe(REGIME_TEXT.bullish)
    const meanings = screen.getByTestId('terminal-lvl-meanings')
    expect(within(meanings).getAllByRole('term').map((t) => t.textContent)).toEqual(['Call wall', 'Put wall', 'Zero gamma', 'Dark pool level'])
    expect(meanings.textContent).toContain(LEVEL_KINDS.zeroGamma.meaning)
    const method = screen.getByTestId('terminal-lvl-method').textContent
    expect(method).toContain('within 15% of the price')
    expect(method).toContain('last 20 sessions, each $10M or more')
    expect(method).toContain('Options levels worked out at 2:31 PM ET.')
    expect(method).toContain('Dark pool levels worked out at 2:25 PM ET.')
    expect(method).not.toMatch(/[—–]/)
    // the header's as-of is the OLDER of the two answers
    const report = freshness.mock.calls.map((c) => c[0]).filter(Boolean).pop()
    expect(report.source).toBe('UCT Signature levels (options chain, confirmed dark pool prints)')
    expect(report.observedAt).toBe('2026-11-13T19:25:00.000Z')
    // the options read gave a price, so the live pool was never asked for this ticker
    expect(live.asked.every((t) => t.length === 0)).toBe(true)
    // no warning or missing-data note when both reads are healthy
    for (const id of ['gex-error', 'dp-error', 'gex-none', 'dp-none', 'no-price']) expect(screen.queryByTestId(`terminal-lvl-${id}`)).toBeNull()
  })

  it('the related links open beside the panel', async () => {
    serve({ [G]: GEX, [D]: DP })
    const { open } = renderPanel()
    await screen.findByTestId('terminal-lvl-table')
    fireEvent.click(screen.getByTestId('panel-command-NVDA-GP'))
    expect(open).toHaveBeenCalledWith('NVDA GP')
  })

  it('a failed options read (an error in a 200 body) keeps the dark pool levels and can be retried', async () => {
    live.prices = { NVDA: { price: 101 } }
    serve({ [G]: GEX_ERR, [D]: DP })
    renderPanel()
    await screen.findByTestId('terminal-lvl-table')
    const note = screen.getByTestId('terminal-lvl-gex-error').textContent
    expect(note).toContain('The options data could not be read just now.')
    expect(note).toContain('not the same as having none')
    expect(screen.queryByTestId('terminal-lvl-gex-none')).toBeNull()   // never "no levels"
    // the dark pool levels are still listed, measured against the live price
    expect(rowKinds()).toEqual(['darkPool', 'price', 'darkPool'])
    expect(cells(tableRows()[1])).toEqual(['Price now', '101.00', '', 'Live price'])
    expect(cells(tableRows()[0])[2]).toBe('+2.4% above')
    expect(live.asked.some((t) => t.includes('NVDA'))).toBe(true)
    expect(screen.queryByTestId('terminal-lvl-regime')).toBeNull()

    serve({ [G]: GEX, [D]: DP })
    fireEvent.click(screen.getByRole('button', { name: 'Retry the options levels' }))
    await screen.findByTestId('terminal-lvl-row-callWall')
    expect(screen.queryByTestId('terminal-lvl-gex-error')).toBeNull()
    expect(rowKinds()).toEqual(['callWall', 'darkPool', 'price', 'zeroGamma', 'putWall', 'darkPool'])
  })

  it('a stock with no usable options says so plainly, and with no price the levels show no distance', async () => {
    serve({ [G]: GEX_NO_OPTIONS, [D]: DP })
    renderPanel()
    await screen.findByTestId('terminal-lvl-table')
    expect(screen.getByTestId('terminal-lvl-gex-none').textContent)
      .toContain('The options source has no usable options data for NVDA')
    expect(screen.queryByTestId('terminal-lvl-gex-error')).toBeNull()
    expect(rowKinds()).toEqual(['darkPool', 'darkPool'])
    expect(cells(tableRows()[0])[2]).toBe('n/a')
    expect(screen.getByTestId('terminal-lvl-no-price').textContent).toContain('No price is on hand for NVDA right now')
  })

  it('a failed dark pool read keeps the options levels, as a body error and as a 500', async () => {
    serve({ [G]: GEX, [D]: DP_ERR })
    renderPanel()
    await screen.findByTestId('terminal-lvl-table')
    expect(rowKinds()).toEqual(['callWall', 'price', 'zeroGamma', 'putWall'])
    expect(screen.getByTestId('terminal-lvl-dp-error').textContent).toContain('The dark pool data could not be read just now.')
    expect(screen.queryByTestId('terminal-lvl-dp-none')).toBeNull()
    serve({ [G]: GEX, [D]: DP })
    fireEvent.click(screen.getByRole('button', { name: 'Retry the dark pool levels' }))
    await screen.findAllByTestId('terminal-lvl-row-darkPool')
    expect(screen.queryByTestId('terminal-lvl-dp-error')).toBeNull()
    cleanup()

    serve({ [G]: GEX, [D]: httpError(500) })
    renderPanel()
    await screen.findByTestId('terminal-lvl-table')
    expect(rowKinds()).toEqual(['callWall', 'price', 'zeroGamma', 'putWall'])
    expect(screen.getByTestId('terminal-lvl-dp-error').textContent).toContain('The dark pool data could not be read just now.')
    expect(screen.getByRole('button', { name: 'Retry the dark pool levels' })).toBeTruthy()
  })

  it('one read still out does not hold back the other', async () => {
    serve({ [G]: PENDING, [D]: DP })
    renderPanel()
    await screen.findByTestId('terminal-lvl-table')
    expect(screen.getByTestId('terminal-lvl-gex-loading').textContent).toContain('Reading the options levels.')
    expect(rowKinds()).toEqual(['darkPool', 'darkPool'])
    expect(live.asked.every((t) => t.length === 0)).toBe(true)   // not until the options read has settled
    expect(screen.queryByTestId('terminal-lvl-no-price')).toBeNull()   // the price may still arrive with it
  })

  it('both requests failing (500) is an error with Retry, never "no levels"', async () => {
    serve({})
    renderPanel()
    const err = await screen.findByTestId('terminal-lvl-error')
    expect(err.textContent).toContain('The key levels for NVDA could not be read just now.')
    expect(err.textContent).toContain('That is not the same as having none.')
    expect(err.getAttribute('data-kind')).toBe('error')
    expect(screen.queryByTestId('terminal-lvl-empty')).toBeNull()
    serve({ [G]: GEX, [D]: DP })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('terminal-lvl-table')).toBeTruthy()
  })

  it('a 402 says paid plan and a 404 says not switched on: both locked, neither offers Retry', async () => {
    serve({ [G]: httpError(402), [D]: httpError(402) })
    renderPanel()
    const paid = await screen.findByTestId('terminal-lvl-error')
    expect(paid.textContent).toContain('Key levels needs a paid plan.')
    expect(paid.getAttribute('data-kind')).toBe('locked')
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    cleanup()
    serve({ [G]: httpError(404), [D]: httpError(404) })
    renderPanel()
    const off = await screen.findByTestId('terminal-lvl-error')
    expect(off.textContent).toContain('Key levels is not switched on for this server yet.')
    expect(off.getAttribute('data-kind')).toBe('locked')
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('a ticker the routes refuse (422) asks for a different ticker', async () => {
    const g = gexWallsUrl('NV$DA')
    const d = darkpoolLevelsUrl('NV$DA')
    serve({ [g]: httpError(422), [d]: httpError(422) })
    renderPanel('NV$DA')
    const bad = await screen.findByTestId('terminal-lvl-bad-ticker')
    expect(bad.textContent).toContain('NV$DA is not a ticker this panel can read.')
    expect(bad.getAttribute('data-kind')).toBe('input')
  })

  it('two healthy answers with no levels are empty, each with its reason', async () => {
    serve({ [G]: { ...GEX, levels: [] }, [D]: { ...DP, levels: [] } })
    renderPanel()
    const empty = await screen.findByTestId('terminal-lvl-empty')
    expect(empty.textContent).toContain('No key levels for NVDA right now.')
    expect(empty.textContent).toContain('No call wall, put wall or zero gamma level sits within 15% of the price.')
    expect(empty.textContent).toContain('No price gathered $10M or more of dark pool prints for NVDA in the last 20 sessions.')
    expect(screen.queryByTestId('terminal-lvl-table')).toBeNull()
    expect(screen.queryByTestId('terminal-lvl-error')).toBeNull()
    cleanup()
    serve({ [G]: { ...GEX, levels: [] }, [D]: { ...DP, levels: [], datesCovered: 0 } })
    renderPanel()
    expect((await screen.findByTestId('terminal-lvl-empty')).textContent)
      .toContain('No dark pool prints are on record for NVDA in the last 20 sessions.')
  })

  it('a failed read with nothing else to list is not called empty', async () => {
    serve({ [G]: GEX_ERR, [D]: { ...DP, levels: [] } })
    renderPanel()
    await screen.findByTestId('terminal-lvl-gex-error')
    expect(screen.queryByTestId('terminal-lvl-empty')).toBeNull()
    expect(screen.getByTestId('terminal-lvl-dp-none')).toBeTruthy()
  })

  it('a new ticker never shows the last ticker\'s levels', async () => {
    serve({ [G]: GEX, [D]: DP, [gexWallsUrl('AMD')]: PENDING, [darkpoolLevelsUrl('AMD')]: PENDING })
    const freshness = vi.fn()
    const open = vi.fn()
    const view = render(<Harness sym="NVDA" freshness={freshness} open={open} />)
    await screen.findByTestId('terminal-lvl-table')
    view.rerender(<Harness sym="AMD" freshness={freshness} open={open} />)
    expect(screen.getByTestId('terminal-lvl-loading').textContent).toContain('AMD')
    expect(screen.queryByTestId('terminal-lvl-table')).toBeNull()
  })
})
