// lane/o-options-remainders — every Lane O surface, asserted on rendered text against payloads in the
// shape the routes return (tests/test_options_lane_o.py builds the same shapes from recorded fixtures).
// Each surface: its route 404 (switch off) renders NOTHING; a 200 renders its numbers and its words.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { EdgePanel, SpreadBookPanel, StrategyFinder, spreadBody, candidateKey } from './ChainModelPanels'
import { RrBfTable, Surface3D, meshQuads } from './VolSkewPanels'
import MarketTidePanel, { minuteAt } from './MarketTidePanel'
import StrategyScreensPanel from './StrategyScreensPanel'
import PositioningPanel from './PositioningPanel'
import PayoffPanel from '../research/tabs/PayoffPanel'
import OptionsChainTab from '../research/tabs/OptionsChainTab'

const ok = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
const off = () => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ detail: 'Not Found' }) })
let calls
function route(table) {
  calls = []
  global.fetch = vi.fn((url, init) => {
    calls.push([String(url), init?.method || 'GET'])
    for (const [re, body] of table) if (re.test(String(url))) return typeof body === 'function' ? body(url, init) : ok(body)
    return off()
  })
}
const mount = (ui) => render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>)
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const q = (type, strike, bid, ask, iv = 0.3) => ({ contract: `O:TST${type[0]}${strike}`, type, strike, bid, ask, iv, expiration: '2026-11-20', delta: type === 'call' ? 0.5 : -0.5 })
const ROWS = [95, 100, 105].map((k) => ({
  strike: k,
  call: q('call', k, Math.max(0.5, 100 - k + 2), Math.max(0.7, 100 - k + 2.4)),
  put: q('put', k, Math.max(0.5, k - 100 + 2), Math.max(0.7, k - 100 + 2.4)),
}))

// ── FT-001 ──
const PAYOFF_MODEL = {
  label: 'computed', risk_free_rate: 0, assumptions: 'Black-Scholes, European exercise, a zero interest rate and no dividends.',
  today_method: "The 'today' curve values every leg by Black-Scholes at the vendor's own implied volatility.",
  pop_method: 'Probability of profit = the chance the underlying finishes in a profitable range.', slice_method: 'x',
}

describe('FT-001 payoff today at IV', () => {
  it('off: exactly the old panel, no today line, no PoP', async () => {
    route([])
    mount(<PayoffPanel rows={ROWS} spot={100} sym="TST" expiration="2099-01-01" atmIv={0.3} />)
    await screen.findByTestId('payoff-facts')
    await waitFor(() => expect(calls.some(([u]) => u.includes('/payoff-model'))).toBe(true))
    expect(screen.queryByTestId('payoff-today')).toBeNull()
    expect(screen.queryByTestId('payoff-today-line')).toBeNull()
  })

  it('on: draws the today curve, states PoP at the ATM IV and the slice table, in the server words', async () => {
    route([[/payoff-model/, PAYOFF_MODEL]])
    mount(<PayoffPanel rows={ROWS} spot={100} sym="TST" expiration="2099-01-01" atmIv={0.3} />)
    const pop = await screen.findByTestId('payoff-pop')
    expect(pop.textContent).toMatch(/Probability of profit at expiration \d+\.\d%/)
    expect(pop.textContent).toContain('at ATM IV 30.0%')
    expect(screen.getByTestId('payoff-today-line')).toBeTruthy()
    expect(screen.getByTestId('payoff-slices').querySelectorAll('tbody tr')).toHaveLength(7)
    expect(screen.getByTestId('payoff-today-basis').textContent).toContain("vendor's own implied volatility")
  })
})

// ── FT-015 ──
const GREEKS_MODEL = { label: 'computed', assumptions: 'Zero rate, no dividends.', rho: 'Rho = per 1 point.', lambda: 'Lambda = leverage.', epsilon: 'Epsilon = dividend.', streaming: 'Not streamed: the chain refreshes every 60 s.' }
const CHAIN = {
  ticker: 'TST', expiration: '2099-01-01', spot: 100, cache_seconds: 60,
  calls: ROWS.map((r) => r.call), puts: ROWS.map((r) => r.put),
}

describe('FT-015 chain greeks + calls/puts view', () => {
  const base = [[/\/expirations/, { expirations: ['2099-01-01'] }], [/\/chain\?/, CHAIN]]

  it('off: the ten greek columns per side, no mode switch', async () => {
    route(base)
    mount(<OptionsChainTab sym="tst" />)
    await screen.findByTestId('options-chain')
    expect(screen.queryByTestId('chain-mode')).toBeNull()
    expect(screen.queryByText('ρ')).toBeNull()
  })

  it('on: rho / lambda / epsilon columns, computed, and Calls hides the put side', async () => {
    route([...base, [/chain-greeks/, GREEKS_MODEL]])
    mount(<OptionsChainTab sym="tst" />)
    await screen.findByTestId('chain-mode')
    expect(screen.getAllByText('ρ')).toHaveLength(2)
    expect(screen.getByTestId('chain-greeks-basis').textContent).toContain('Not streamed')
    fireEvent.click(screen.getByRole('button', { name: 'Calls' }))
    expect(screen.getAllByText('ρ')).toHaveLength(1)
    expect(screen.queryByText('Puts')).toBeTruthy()          // the button, not a header
    expect(screen.getAllByRole('columnheader').some((h) => h.textContent === 'Puts')).toBe(false)
  })
})

// ── FT-012 ──
const EDGE = {
  symbol: 'TST', expiration: '2026-11-20', spot: 100, label: 'computed', method: 'Theoretical value = Black-Scholes at the 20-session realized volatility.',
  inputs: 'vendor (bid, ask, IV) and computed (realized volatility)', realized_vol: { hv20: 0.25, through: '2026-10-01' },
  history: { sessions_logged: 2, win_rate_note: 'our options log holds 2 sessions since 2026-09-30, and this ranks by edge only until it holds 60.' },
  buyer_edge: [{ contract: 'O:A', type: 'call', strike: 105, mid: 1.0, theoretical: 1.4, edge: 0.4, edge_pct: 40, vendor_iv: 0.2 }],
  seller_edge: [{ contract: 'O:B', type: 'put', strike: 95, mid: 2.0, theoretical: 1.5, edge: -0.5, edge_pct: -25, vendor_iv: 0.4 }],
  days_to_expiry: 49, evaluated: 2, skipped: 1, note: '1 contract had no two-sided quote and was not valued.',
}

describe('FT-012 edge', () => {
  it('off renders nothing', async () => {
    route([])
    const { container } = mount(<EdgePanel sym="TST" expiration="" />)
    await waitFor(() => expect(calls.length).toBeGreaterThan(0))
    expect(container.querySelector('[data-testid="edge"]')).toBeNull()
  })

  it('on: buyer and seller tables, the realized vol, the skip count and the thin history (n)', async () => {
    route([[/\/edge/, EDGE]])
    mount(<EdgePanel sym="TST" expiration="" />)
    expect((await screen.findByTestId('edge-buyer')).textContent).toContain('+0.40')
    expect(screen.getByTestId('edge-seller').textContent).toContain('-25.0%')
    expect(screen.getByTestId('edge-inputs').textContent).toContain('25.0%')
    expect(screen.getByTestId('edge-note').textContent).toContain('no two-sided quote')
    expect(screen.getByTestId('edge-history').textContent).toContain('holds 2 sessions')
  })
})

// ── FT-014 + FT-072 ──
const FINDER = { label: 'computed', assumptions: 'Zero rate.', method: 'Candidates, not advice: nothing here places an order.', views: { bullish: 'Long call, bull spreads.', bearish: 'b', neutral: 'n', volatile: 'v' } }
const BOOK = { spreads: [], count: 0, max: 200, basis: 'A record of the spreads you saved. Not an order and not a position.' }

describe('FT-014 strategy finder / FT-072 Spread Book', () => {
  it('finder off renders nothing; book off hides the Save column', async () => {
    route([[/strategy-finder/, FINDER]])
    mount(<StrategyFinder sym="TST" rows={ROWS} spot={100} expiration="2099-01-01" atmIv={0.3} />)
    const t = await screen.findByTestId('finder-candidates')
    expect(t.textContent).toContain('Long call')
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    cleanup()
    route([])
    const { container } = mount(<StrategyFinder sym="TST" rows={ROWS} spot={100} expiration="2099-01-01" atmIv={0.3} />)
    await waitFor(() => expect(calls.length).toBeGreaterThan(0))
    expect(container.querySelector('[data-testid="strategy-finder"]')).toBeNull()
  })

  it('a view switch rebuilds candidates; Save posts the record of what was seen', async () => {
    let posted = null
    route([[/strategy-finder/, FINDER], [/spread-book$/, (u, init) => {
      if (init?.method === 'POST') { posted = JSON.parse(init.body); return ok({ id: 'x', ...posted }) }
      return ok(BOOK)
    }]])
    mount(<StrategyFinder sym="TST" rows={ROWS} spot={100} expiration="2099-01-01" atmIv={0.3} />)
    await screen.findByTestId('finder-candidates')
    fireEvent.click(screen.getByRole('button', { name: 'volatile' }))
    await waitFor(() => expect(screen.getByTestId('finder-candidates').textContent).toContain('Long straddle'))
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0])
    await screen.findByText('Saved to the Spread Book.')
    expect(posted.underlying).toBe('TST')
    expect(posted.legs.every((l) => [-2, -1, 1, 2].includes(l.side) && l.expiration === '2026-11-20')).toBe(true)
  })

  it('"Saved" follows the SAVED structure through a re-sort, never the row index it was clicked at', async () => {
    route([[/strategy-finder/, FINDER], [/spread-book$/, (u, init) => (init?.method === 'POST' ? ok({ id: 'x' }) : ok(BOOK))]])
    mount(<StrategyFinder sym="TST" rows={ROWS} spot={100} expiration="2099-01-01" atmIv={0.3} />)
    const table = await screen.findByTestId('finder-candidates')
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Save' }).length).toBeGreaterThan(1))
    const rowText = (tr) => [...tr.querySelectorAll('th, td')].slice(0, 2).map((c) => c.textContent).join(' ')
    const before = [...table.querySelectorAll('tbody tr')].map(rowText)
    const savedRow = before[0]
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0])
    await screen.findByText('Saved to the Spread Book.')
    fireEvent.change(screen.getByLabelText('Sort candidates'), { target: { value: 'reward' } })
    const after = [...screen.getByTestId('finder-candidates').querySelectorAll('tbody tr')]
    // the re-sort must actually move the saved row, or this case proves nothing about index keying
    expect(rowText(after[0])).not.toBe(savedRow)
    const tagged = after.filter((tr) => tr.textContent.includes('Saved to the Spread Book.'))
    expect(tagged.map(rowText)).toEqual([savedRow])
  })

  it('candidateKey is the legs identity: same legs same key; a different strike, side, view or expiry differs', () => {
    const c = { name: 'Bull call spread', legs: [{ type: 'call', side: 1, strike: 100 }, { type: 'call', side: -1, strike: 105 }] }
    expect(candidateKey('bullish', '2026-11-20', c)).toBe(candidateKey('bullish', '2026-11-20', { ...c, legs: c.legs.map((l) => ({ ...l, premium: 9 })) }))
    expect(candidateKey('bullish', '2026-11-20', c)).not.toBe(candidateKey('bullish', '2026-11-20', { ...c, legs: [c.legs[0], { ...c.legs[1], strike: 110 }] }))
    expect(candidateKey('bullish', '2026-11-20', c)).not.toBe(candidateKey('bullish', '2026-11-20', { ...c, legs: [c.legs[0], { ...c.legs[1], side: 1 }] }))
    expect(candidateKey('bullish', '2026-11-20', c)).not.toBe(candidateKey('neutral', '2026-11-20', c))
    expect(candidateKey('bullish', '2026-11-20', c)).not.toBe(candidateKey('bullish', '2026-12-18', c))
  })

  it('the book lists saved spreads and says it is not a position; off renders nothing', async () => {
    route([[/spread-book$/, { ...BOOK, count: 1, spreads: [{ id: 's1', created_at: '2026-10-02T15:00:00+00:00', label: 'TST Bull call spread', underlying: 'TST', strategy: 'Bull call spread', legs: [{ type: 'call', side: 1, strike: 100, expiration: '2026-11-20', price: 2.2 }, { type: 'call', side: -1, strike: 105, expiration: '2026-11-20', price: 0.6 }], entry: { net: 1.6, kind: 'debit', session: '2026-10-02' } }] }]])
    mount(<SpreadBookPanel />)
    const row = await screen.findByTestId('spread-book-row')
    expect(row.textContent).toContain('buy 100.00 call 2026-11-20 @ 2.20')
    expect(row.textContent).toContain('debit 1.60')
    expect(screen.getByText(/Not an order and not a position/)).toBeTruthy()
  })

  it('spreadBody carries per-share net (a credit is negative)', () => {
    const c = { name: 'Bull put spread', cost: -150, legs: [{ type: 'put', side: -1, strike: 100, premium: 2.2, expiration: '2026-11-20' }, { type: 'put', side: 1, strike: 95, premium: 0.7 }] }
    const b = spreadBody('TST', c, '2026-11-20')
    expect(b.entry.net).toBe(-1.5)
    expect(b.legs[1].expiration).toBe('2026-11-20')
  })
})

// ── FT-018 ──
const RRBF = {
  symbol: 'TST', label: 'computed', method: 'RR = call IV - put IV at the same |delta|.', iv_source_text: 'Vendor IV.', strikes_note: 'Each tenor reads the 20 strikes nearest spot.',
  tenors: [
    { expiration: '2026-10-16', dte: 14, atm_iv: 0.3, rr_25d: -0.04, bf_25d: 0.01, rr_10d: null, bf_10d: null, reason_25d: null, reason_10d: 'calls: the quoted strikes span |delta| 0.15 to 0.85; 0.10 is not reached' },
  ],
}
const MESH = { symbol: 'TST', label: 'vendor', iv_source_text: 'Vendor IV.', side_rule: 'OTM side.', note: 'A blank cell is left open, never interpolated.', expirations: [{ expiration: 'a', dte: 7 }, { expiration: 'b', dte: 30 }], strikes: [95, 100, 105], z: [[0.3, 0.28], [0.25, null], [0.27, 0.26]], cells_filled: 5, cells_total: 6 }

describe('FT-018 RR/BF + 3D', () => {
  it('the RR/BF table in vol points, the unreached delta a dash with its reason', async () => {
    route([[/rr-bf/, RRBF]])
    mount(<RrBfTable sym="TST" />)
    const t = await screen.findByTestId('rr-bf-table')
    expect(t.textContent).toContain('-4.00')
    expect(t.textContent).toContain('+1.00')
    expect(screen.getByTestId('rr-bf-reason').textContent).toContain('0.10 is not reached')
  })

  it('the mesh leaves a blank cell a hole: only fully quoted quads are drawn', () => {
    const m = meshQuads(MESH.strikes, MESH.expirations, MESH.z)
    expect(m.quads).toHaveLength(0)       // every 2x2 quad touches the blank (100, b)
    const full = meshQuads(MESH.strikes, MESH.expirations, [[0.3, 0.28], [0.25, 0.24], [0.27, 0.26]])
    expect(full.quads).toHaveLength(2)
    expect(full.zMin).toBe(0.24)
  })

  it('3D on states the cells quoted; off renders nothing', async () => {
    route([[/surface-3d/, { ...MESH, z: [[0.3, 0.28], [0.25, 0.24], [0.27, 0.26]], cells_filled: 6 }]])
    mount(<Surface3D sym="TST" />)
    expect((await screen.findByTestId('surface-3d-facts')).textContent).toContain('6 of 6 cells quoted')
    expect(screen.getByTestId('surface-3d-mesh').querySelectorAll('path')).toHaveLength(2)
    cleanup()
    route([])
    const { container } = mount(<Surface3D sym="TST" />)
    await waitFor(() => expect(calls.length).toBeGreaterThan(0))
    expect(container.querySelector('[data-testid="surface-3d"]')).toBeNull()
  })
})

// ── FT-049 ──
const HEAT = (measure) => ({ measure, expirations: ['2026-10-16'], strikes: [95, 100], cells: [[1500000, null]], max_abs: 1500000, unit: '$ of delta', note: 'A blank cell is never zero.', method: `${measure} method.`, not_built: 'A forward projection and a 1-minute refresh are not built.', contracts_without_defined_charm: measure === 'charm' ? 3 : undefined })

describe('FT-049 delta-pressure + charm', () => {
  it('each heatmap is its own switch: arming delta never shows charm', async () => {
    route([[/delta-heatmap/, HEAT('delta')]])
    mount(<PositioningPanel sym="TST" />)
    expect((await screen.findByTestId('posn-delta-heatmap')).textContent).toContain('+$1.5M')
    expect(screen.queryByTestId('posn-charm-heatmap')).toBeNull()
    expect(screen.queryByTestId('posn-heatmap')).toBeNull()
  })

  it('charm says how many contracts had no defined charm and what is not built', async () => {
    route([[/charm-heatmap/, HEAT('charm')]])
    mount(<PositioningPanel sym="TST" />)
    expect((await screen.findByTestId('posn-charm-heatmap-undefined')).textContent).toContain('3 contracts had no defined charm')
    expect(screen.getByTestId('posn-charm-heatmap').textContent).toContain('not built')
  })
})

// ── FT-056 / FT-057 ──
const SECTORS = { session: '2026-10-02', scope: 'all', label: 'computed', method: 'm', filters: 'The flow tape records 50+ contract prints.', sectors: [{ sector: 'Technology', prints: 4, prints_unsigned: 1, totals: { net_call_premium: 40000, net_put_premium: 10000, net_premium: 30000 }, minutes: [] }, { sector: 'Unclassified', prints: 1, prints_unsigned: 0, totals: { net_call_premium: 0, net_put_premium: 12000, net_premium: -12000 }, minutes: [] }], partial: false, note: "Sectors are the flow tape's own Sector field." }
const MINUTES = { session: '2026-10-02', scope: 'all', filters: 'tape filters', cap: 15, minutes: ['09:30', '12:05'] }
const MINUTE = { ...MINUTES, t: '09:30', count: 20, shown: 1, prints: [{ symbol: 'NVDA', type: 'call', strike: 200, expiration: '2026-10-16', side: 'ASK', premium: 50000, contracts: 100, trade_type: 'SWEEP', time: '09:30:12' }], note: 'The 1 largest of 20 prints in this minute, by premium.' }
const TIDE = { session: '2026-10-02', minutes: [{ t: '09:30', cum_net_call_premium: 1, cum_net_put_premium: 2 }, { t: '12:05', cum_net_call_premium: 3, cum_net_put_premium: 1 }], totals: {}, filters: 'f', method: 'm', prints_counted: 2, prints_unsigned: 0 }

describe('FT-056 sector tide / FT-057 click-through', () => {
  it('both off: the tide alone, exactly as before', async () => {
    route([[/market-tide\?scope/, TIDE]])
    mount(<MarketTidePanel />)
    await screen.findByTestId('market-tide-chart')
    await waitFor(() => expect(calls.filter(([u]) => /sectors|minute/.test(u)).length).toBeGreaterThan(0))
    expect(screen.queryByTestId('sector-tide')).toBeNull()
    expect(screen.queryByTestId('tide-minute')).toBeNull()
  })

  it('sector tide names Unclassified and signs the net, with the tide itself off', async () => {
    route([[/market-tide\/sectors/, SECTORS]])
    mount(<MarketTidePanel />)
    const t = await screen.findByTestId('sector-tide-table')
    expect(t.textContent).toContain('Technology')
    expect(t.textContent).toContain('Unclassified')
    expect(t.textContent).toContain('+$30K')
    expect(t.textContent).toContain('(1 unsigned)')
    expect(screen.queryByTestId('market-tide')).toBeNull()
  })

  it('a click on the tide opens that minute, and the cap is stated with its count', async () => {
    route([[/market-tide\?scope/, TIDE], [/minute\?scope=all&t=/, MINUTE], [/minute\?scope=all$/, MINUTES]])
    mount(<MarketTidePanel />)
    await screen.findByTestId('tide-minute')
    const svg = await screen.findByTestId('market-tide-chart')
    svg.getBoundingClientRect = () => ({ left: 0, width: 720, top: 0, height: 200 })
    fireEvent.click(svg, { clientX: 28 })
    const count = await screen.findByTestId('tide-minute-count')
    expect(count.textContent).toContain('09:30 ET: 20 prints')
    expect(count.textContent).toContain('The 1 largest of 20')
    expect(screen.getByTestId('tide-minute-prints').textContent).toContain('NVDA')
    // quality pass 2026-10-05: plain words, never the tape's raw enums
    const row = screen.getByTestId('tide-minute-prints').querySelector('tbody tr').textContent
    expect(row).toContain('Call 200 2026-10-16')
    expect(row).toContain('At ask')
    expect(row).toContain('Sweep')
    expect(row).not.toMatch(/ASK|SWEEP/)
  })

  it('minuteAt maps the chart x onto the minute list, clamped', () => {
    const m = [{ t: 'a' }, { t: 'b' }, { t: 'c' }]
    expect(minuteAt(m, 0)).toBe('a')
    expect(minuteAt(m, 0.5)).toBe('b')
    expect(minuteAt(m, 1)).toBe('c')
  })
})

// ── FT-073 / FT-075 ──
const MORE_CAT = { strategies: [{ id: 'call_butterflies', label: 'Call butterflies', source: 'screen' }, { id: 'block_trades', label: 'Option block trades', source: 'tape' }], not_built: { multi_leg_trades: 'Multi-leg option trades are not screened: the flow tape carries no multi-leg flag.' } }
const FLY = { strategy: 'call_butterflies', description: 'Buy the call one strike below.', session: '2026-10-01', data_basis: 'end-of-day snapshot', fill: 'buy at the ask, sell at the bid.', candidates_read: 9, matches: 1, rows: [{ underlying: 'TST', expiration: '2026-11-20', lower: { strike: 95 }, center: { strike: 100 }, upper: { strike: 105 }, debit: 1.2, max_profit: 3.8, reward_to_risk: 3.17, breakevens: [96.2, 103.8] }] }
const SIZZLE = { method: 'Sizzle = volume / the mean of its own prior 5 logged sessions.', volume_rule: 'the log volume', data_basis: 'end-of-day snapshot', session: '2026-10-02', prior_sessions: 2, ranked: [], not_ranked: [{ underlying: 'TST', note: '2 sessions, needs 5' }], not_ranked_total: 1, available_on: '2026-10-07', note: '2 prior sessions held; the ratio needs 5.', coverage: { evaluated: 1, answered: 0, dropped: 0, not_computable: 1, dropped_symbols: [{ ticker: 'TST', reason: 'not-computable', detail: '2 sessions, needs 5' }] } }

describe('FT-073 more screens / FT-075 Sizzle', () => {
  it('each is dark on its own: the first screens off does not hide them', async () => {
    route([[/more-strategies/, MORE_CAT], [/more\/call_butterflies/, FLY]])
    mount(<StrategyScreensPanel />)
    expect((await screen.findByTestId('more-rows')).textContent).toContain('95.00 / 100.00 x2 / 105.00')
    expect(screen.getByTestId('more-basis').textContent).toContain('1 match from 9 read')
    expect(screen.getByTestId('more-not-built').textContent).toContain('no multi-leg flag')
    expect(screen.queryByTestId('strategy-screens')).toBeNull()
    expect(screen.queryByTestId('sizzle')).toBeNull()
  })

  it('block trades print the side and contract type in words, not tape codes (quality pass 2026-10-05)', async () => {
    const BLOCKS = { strategy: 'block_trades', description: 'Prints the tape types BLOCK.', session: '2026-10-02', data_basis: "today's flow tape", fill: null, candidates_read: 1, candidate_cap: 1, matches: 1,
      rows: [{ symbol: 'NVDA', type: 'put', strike: 180, expiration: '2026-10-16', side: 'BB', premium: 250000, contracts: 500, time: '10:01:02' }] }
    route([[/more-strategies/, MORE_CAT], [/more\/call_butterflies/, FLY], [/more\/block_trades/, BLOCKS]])
    mount(<StrategyScreensPanel />)
    await screen.findByTestId('more-rows')
    fireEvent.change(screen.getByLabelText('More strategies'), { target: { value: 'block_trades' } })
    await waitFor(() => expect(screen.getByTestId('more-rows').textContent).toContain('NVDA'))
    const row = screen.getByTestId('more-rows').querySelector('tbody tr').textContent
    expect(row).toContain('Put 180.00 2026-10-16')
    expect(row).toContain('Below bid')
    expect(row).not.toMatch(/\bBB\b|\bput\b/)
  })

  it('Sizzle states the sessions it holds (n) and the first date a ratio can exist', async () => {
    route([[/sizzle/, SIZZLE]])
    mount(<StrategyScreensPanel />)
    expect((await screen.findByTestId('sizzle-history')).textContent).toContain('2 prior sessions held')
    expect(screen.getByTestId('sizzle-history').textContent).toContain('2026-10-07')
    expect(screen.getByTestId('sizzle-not-ranked').textContent).toContain('TST (2 sessions, needs 5)')
    expect(screen.queryByTestId('sizzle-ranked')).toBeNull()
  })
})
