// The terminal opens six dark options surfaces as whole panels (IVH, VOL, POS, OHIS, TIDE, STRS).
// Every route behind them answers 404 until its own switch is set; embedded, a 404 renders nothing,
// but as a whole panel that was a titled box with an empty body. With `offNotice` (passed by the
// terminal registry) a panel whose EVERY section answered 404 says so in words -- and only then.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import IvHistoryPanel from '../research/tabs/IvHistoryPanel'
import { VolStatsPanel, OptionMonitorStrip, volumeScope } from './VolPanels'
import PositioningPanel, { positioningUrls } from './PositioningPanel'
import OptionsHistoryPanel, { optionsHistoryUrls } from './OptionsHistoryPanel'
import MarketTidePanel, { staleText } from './MarketTidePanel'
import StrategyScreensPanel, { capNote, perContract } from './StrategyScreensPanel'
import { BY_CODE } from '../terminal/functions'

let calls
function stub(map = {}) {
  calls = []
  vi.stubGlobal('fetch', vi.fn((u) => {
    calls.push(String(u))
    const hit = Object.entries(map).find(([k]) => String(u).includes(k))
    const [status, body] = hit ? hit[1] : [404, { detail: 'Not Found' }]
    return Promise.resolve({ status, ok: status === 200, json: () => Promise.resolve(body) })
  }))
}
const wrap = (el) => render(<MemoryRouter><SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{el}</SWRConfig></MemoryRouter>)
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const PANELS = [
  ['IVH', 'IV history', (p) => <IvHistoryPanel sym="TST" {...p} />],
  ['VOL', 'Volatility stats', (p) => <VolStatsPanel sym="TST" {...p} />],
  ['POS', 'Options positioning', (p) => <PositioningPanel sym="TST" {...p} />],
  ['OHIS', 'Options history', (p) => <OptionsHistoryPanel sym="TST" {...p} />],
  ['TIDE', 'Market Tide', (p) => <MarketTidePanel {...p} />],
  ['STRS', 'Options strategy screens', (p) => <StrategyScreensPanel {...p} />],
]

describe('offNotice: every section 404 -> "<feature> isn\'t switched on yet"', () => {
  it.each(PANELS)('%s says "%s isn\'t switched on yet" when every route is 404', async (_code, feature, el) => {
    stub({})
    wrap(el({ offNotice: true }))
    expect((await screen.findByTestId('feature-off')).textContent).toBe(`${feature} isn't switched on yet. That is a setting on our side, not an empty result.`)
  })

  it.each(PANELS)('%s embedded (no offNotice) still renders nothing on 404', async (_code, _f, el) => {
    stub({})
    const { container } = wrap(el({}))
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 20))
    expect(container.querySelector('[data-testid="feature-off"]')).toBeNull()
  })

  it.each(PANELS)('%s: the terminal registry passes offNotice', (code) => {
    const v = BY_CODE[code].ticker || BY_CODE[code].market
    expect(v.props).toEqual({ offNotice: true })
  })

  it('a 503 is NOT "switched off": the notice needs every section to be a 404', async () => {
    stub({ '/levels': [503, { detail: 'x' }] })
    wrap(<PositioningPanel sym="TST" offNotice />)
    await screen.findByTestId('posn-levels')
    expect(screen.queryByTestId('feature-off')).toBeNull()
  })

  it('one section up and the rest 404: no notice, the live section renders', async () => {
    stub({ '/daily-move': [200, { pairs: [], n: 0, logging_began: '2026-09-30', summary: null, summary_note: 'Too few.', method: 'm.' }] })
    wrap(<OptionsHistoryPanel sym="TST" offNotice />)
    await screen.findByTestId('daily-move')
    expect(screen.queryByTestId('feature-off')).toBeNull()
  })

  it('the notice asks exactly the routes the sections read (the URL lists are not a second copy)', async () => {
    stub({})
    wrap(<><PositioningPanel sym="TST" offNotice /><OptionsHistoryPanel sym="TST" offNotice /></>)
    await waitFor(() => expect(screen.getAllByTestId('feature-off')).toHaveLength(2))
    const fetched = new Set(calls)
    for (const u of [...positioningUrls('TST'), ...optionsHistoryUrls('TST')]) expect(fetched.has(u)).toBe(true)
    // non-vacuity: the sections fetched nothing the lists do not name
    const named = new Set([...positioningUrls('TST'), ...optionsHistoryUrls('TST')])
    expect([...fetched].filter((u) => !named.has(u))).toEqual([])
  })
})

describe('Market Tide stale stamp', () => {
  it('says when it was computed, in ET, instead of a bare "Refreshing."', () => {
    // 2026-10-02T18:31:00Z = 2:31 PM EDT
    expect(staleText({ computed_at: '2026-10-02T18:31:00+00:00', cache_age_s: 400 })).toBe('Not updated since 2:31 PM ET; a refresh is running.')
    expect(staleText({ cache_age_s: 400 })).toBe('Not updated for 7 min; a refresh is running.')
    expect(staleText({})).toBe('Not freshly computed; a refresh is running.')
  })
  it('renders it on a stale payload', async () => {
    stub({ '/api/options/market-tide?scope=all': [200, { session: '2026-10-02', minutes: [], totals: {}, filters: 'f.', prints_counted: 0, prints_unsigned: 0, method: 'm.', stale: true, computed_at: '2026-10-02T18:31:00+00:00' }] })
    wrap(<MarketTidePanel />)
    expect((await screen.findByTestId('market-tide-stale')).textContent).toContain('Not updated since 2:31 PM ET')
    expect(screen.getByTestId('market-tide-filters').textContent).not.toContain('Refreshing.')
  })
})

describe('Strategy screens units and cap', () => {
  it('per-share spread dollars are shown per contract', () => {
    expect(perContract(0.6)).toBe('$60')
    expect(perContract(2.4)).toBe('$240')
    expect(perContract(null)).toBe('—')
  })
  it('names the cap only when the read hit it', () => {
    expect(capNote({ candidates_read: 3000, candidate_cap: 3000 })).toBe('Capped at 3,000 contracts by open interest — higher-yield low-OI contracts may be missing.')
    expect(capNote({ candidates_read: 2999, candidate_cap: 3000 })).toBeNull()
    expect(capNote({ candidates_read: 3000 })).toBeNull()
  })
  it('a spread row reads per contract with the unit in the header, and a capped read says so', async () => {
    const CATALOG = { strategies: [{ id: 'covered_calls', label: 'Covered calls' }, { id: 'bull_put_spreads', label: 'Bull put spreads' }] }
    const BPS = { strategy: 'bull_put_spreads', description: 'Sell a put.', session: '2026-10-02', data_basis: 'end-of-day snapshot',
      fill: 'Short legs at the logged bid.', matches: 1, candidates_read: 3000, candidate_cap: 3000,
      rows: [{ underlying: 'TST', expiration: '2026-11-01', short: { type: 'put', strike: 95 }, long: { type: 'put', strike: 92 },
        credit: 0.6, max_profit: 0.6, max_loss: 2.4, return_on_risk_pct: 25 }] }
    stub({ '/strategies': [200, CATALOG], '/strategy/': [200, BPS] })
    wrap(<StrategyScreensPanel />)
    fireEvent.change(await screen.findByLabelText('Strategy'), { target: { value: 'bull_put_spreads' } })
    expect((await screen.findByTestId('strategy-capped')).textContent).toMatch(/Capped at 3,000/)
    const panel = screen.getByTestId('strategy-screens')
    await waitFor(() => expect(panel.textContent).toContain('+$60'))
    expect(panel.textContent).toContain('$240')
    expect(panel.textContent).toContain('Net / contract')
  })
})

describe('Option monitor P/C scope', () => {
  it('is said in visible text: the front expiry and the strike band from the server note', () => {
    expect(volumeScope({ expiration: '2026-10-09', note: 'Front expiration, the 40 strikes nearest spot; contracts ...' }))
      .toBe('front expiry 10/09, 40 strikes nearest spot')
    expect(volumeScope({ expiration: '2026-10-09', note: null })).toBe('front expiry 10/09')
    expect(volumeScope({ expiration: null })).toBeNull()
  })
  it('renders beside the P/C', async () => {
    stub({ '/monitor': [200, { hv: { hv20: 0.25, hv30: 0.24 }, hv_method: 'HV.', hv_note: null,
      events: { next_earnings: null, note: 'No scheduled earnings date on file.' },
      volume: { expiration: '2026-10-09', call_volume: 400, put_volume: 200, put_call_ratio: 0.5, note: 'Front expiration, the 40 strikes nearest spot.' } }] })
    wrap(<OptionMonitorStrip sym="TST" />)
    expect((await screen.findByTestId('option-monitor-scope')).textContent).toBe(' (front expiry 10/09, 40 strikes nearest spot)')
  })
})
