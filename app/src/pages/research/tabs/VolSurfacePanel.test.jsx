// BRK-01 increment 3 -- the implied-vol surface, asserted on rendered text and on the chart
// options it hands ECharts (canvas is invisible to jsdom, so the option IS the drawing).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'

const charts = {}
vi.mock('echarts-for-react/lib/core', () => ({
  default: (props) => {
    const name = props.option?.series?.[0]?.name === 'ATM IV' ? 'term' : 'smile'
    charts[name] = props.option
    return <div data-testid={`echart-${name}`} />
  },
}))

import VolSurfacePanel from './VolSurfacePanel'
import OptionsChainTab from './OptionsChainTab'
import { buildSmileOption, buildTermOption, quoteSpan } from './volSurface'

const T1 = '2026-10-01T15:30:00+00:00'
const T2 = '2026-10-01T15:30:07+00:00'
const pts = (ks, iv0, t = T1) => ks.map((k, i) => ({ strike: k, iv: iv0 + i / 100, t, bid: 1, ask: 1.1 }))

const SURFACE = {
  ticker: 'SPY', spot: 764.2, iv_source: 'vendor',
  iv_source_text: "IV is the vendor's own implied volatility from the Massive (OPRA) snapshot; this page does not compute it.",
  basis: "Today's live chain only, not history: each point is the latest quote. IV history and past surfaces are not licensed yet.",
  min_strikes: 5,
  smile: {
    expiration: '2026-10-23', dte: 22,
    calls: { points: pts([750, 755, 760, 765, 770], 0.14), refused: [{ strike: 775, reason: 'no two-sided quote' }],
             refused_text: 'call 775: no two-sided quote', drawable: true, reason: null },
    puts: { points: pts([760, 765, 770], 0.16, T2), refused: [], drawable: false,
            reason: 'Only 3 put strikes with a two-sided quote and a vendor IV; a smile needs at least 5, so it is not drawn.' },
  },
  term: {
    drawable: true, reason: null,
    points: [
      { expiration: '2026-10-09', dte: 8, atm_iv: 0.15, atm_strike: 765, atm_basis: 'call and put averaged', t: T1, reason: null },
      { expiration: '2026-10-23', dte: 22, atm_iv: 0.16, atm_strike: 765, atm_basis: 'call only', t: T2, reason: null },
      { expiration: '2026-12-18', dte: 78, atm_iv: null, atm_strike: 765, atm_basis: null, t: null, reason: 'only 2 valid strikes (needs 5)' },
    ],
  },
  grid: {
    expirations: ['2026-10-09', '2026-10-23'],
    side_rule: 'out-of-the-money side: puts below spot, calls at or above',
    rows: [
      { strike: 760, cells: [{ iv: 0.16, t: T1 }, null] },
      { strike: 765, cells: [{ iv: 0.15, t: T1 }, { iv: 0.17, t: T2 }] },
    ],
  },
  expirations_listed: 32, expirations_sampled: 3,
  missing: [{ expiration: '2027-01-15', reason: 'not fetched within the time budget' }],
  served_at: '2026-10-01T15:30:09+00:00', cache_seconds: 60,
}

let surfaceStatus
beforeEach(() => {
  surfaceStatus = 200
  for (const k of Object.keys(charts)) delete charts[k]
  global.fetch = vi.fn((url) => {
    const u = String(url)
    if (u.includes('/surface')) {
      return Promise.resolve({ ok: surfaceStatus === 200, status: surfaceStatus, json: () => Promise.resolve(SURFACE) })
    }
    if (u.includes('/expirations')) {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ expirations: ['2026-10-23'] }) })
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({
      ticker: 'SPY', expiration: '2026-10-23', spot: 764.2, cache_seconds: 60,
      calls: [{ strike: 765, bid: 2.5, ask: 2.6, iv: 0.16 }], puts: [{ strike: 765, bid: 2.4, ask: 2.5, iv: 0.17 }],
    }) })
  })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const wrap = (ui) => render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{ui}</SWRConfig>)

describe('VolSurfacePanel', () => {
  it("says it is today's chain, not history, and that the IV is the vendor's", async () => {
    wrap(<VolSurfacePanel sym="spy" expiration="2026-10-23" />)
    expect((await screen.findByTestId('vol-basis')).textContent).toMatch(/^Today's live chain only, not history/)
    expect(screen.getByTestId('vol-source').textContent).toMatch(/vendor's own implied volatility.*does not compute it/)
  })

  it('asks for the selected expiration so the smile matches the chain above it', async () => {
    wrap(<VolSurfacePanel sym="spy" expiration="2026-10-23" />)
    await screen.findByTestId('vol-surface')
    expect(global.fetch).toHaveBeenCalledWith('/api/research/options/SPY/surface?expiration=2026-10-23')
  })

  it('draws only the drawable side; the thin side is a sentence, and refused strikes are named', async () => {
    wrap(<VolSurfacePanel sym="spy" expiration="2026-10-23" />)
    await screen.findByTestId('vol-surface')
    expect(charts.smile.series.map((s) => s.name)).toEqual(['Call'])
    expect(screen.getByTestId('smile-puts-not-drawn').textContent).toMatch(/Only 3 put strikes.*not drawn/)
    expect(screen.queryByTestId('smile-calls-not-drawn')).toBeNull()
    expect(screen.getByTestId('smile-calls-refused').textContent).toBe('Left out: call 775: no two-sided quote.')
  })

  it('every point carries its quote time, on the surface and in the chart data', async () => {
    wrap(<VolSurfacePanel sym="spy" expiration="2026-10-23" />)
    await screen.findByTestId('vol-surface')
    expect(screen.getByTestId('smile-quoted').textContent).toBe('Quoted 15:30:00–15:30:07 UTC')
    expect(charts.smile.series[0].data.every(([, , t]) => t === T1)).toBe(true)
    const term = screen.getByTestId('term-points').textContent
    expect(term).toContain('2026-10-09 (8d) · ATM 765.00 · 15.0% call and put averaged · quoted 15:30:00 UTC')
    expect(term).toContain('2026-10-23 (22d) · ATM 765.00 · 16.0% call only · quoted 15:30:07 UTC')
    expect(screen.getByTestId('vol-grid').querySelector('td[title="quoted 15:30:07 UTC"]').textContent).toBe('17.0%')
  })

  it('an expiration without an ATM read is named, not drawn', async () => {
    wrap(<VolSurfacePanel sym="spy" expiration="2026-10-23" />)
    await screen.findByTestId('vol-surface')
    expect(charts.term.series[0].data.map((d) => d[3])).toEqual(['2026-10-09', '2026-10-23'])
    expect(screen.getByTestId('term-left-out').textContent)
      .toBe('Not on the line: 2026-12-18 (only 2 valid strikes (needs 5)).')
  })

  it('names what it sampled and what it could not fetch', async () => {
    wrap(<VolSurfacePanel sym="spy" expiration="2026-10-23" />)
    expect((await screen.findByTestId('vol-coverage')).textContent)
      .toMatch(/^3 of 32 listed expirations sampled; not fetched: 2027-01-15 \(not fetched within the time budget\)/)
  })

  it('a failed request is unavailable, not an empty surface', async () => {
    surfaceStatus = 503
    wrap(<VolSurfacePanel sym="spy" expiration="" />)
    expect((await screen.findByTestId('vol-unavailable')).textContent).toMatch(/unavailable right now/)
  })
})

describe('OptionsChainTab with the surface switched on', () => {
  it('renders the surface under the chain only when switched on', async () => {
    wrap(<OptionsChainTab sym="spy" />)
    await screen.findByTestId('options-chain')
    expect(screen.queryByTestId('vol-surface')).toBeNull()
    cleanup()
    wrap(<OptionsChainTab sym="spy" volSurface />)
    await screen.findByTestId('vol-surface')
  })

  it('still offers no trade, run or send action', async () => {
    wrap(<OptionsChainTab sym="spy" volSurface />)
    await screen.findByTestId('vol-grid')
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('link')).toBeNull()
  })
})

describe('volSurface option builders', () => {
  it('a side the server did not mark drawable never becomes a series', () => {
    const smile = { calls: { drawable: false, points: pts([1, 2], 0.2) }, puts: { drawable: false, points: [] } }
    expect(buildSmileOption(smile, 100, '2026-10-01').series).toEqual([])
    expect(buildTermOption({ drawable: false, points: SURFACE.term.points }).series).toEqual([])
  })

  it('the tooltip states the quote time', () => {
    const opt = buildSmileOption(SURFACE.smile, 764.2, '2026-10-01')
    const tip = opt.tooltip.formatter({ seriesName: 'Call', data: [760, 15.0, T2] })
    expect(tip).toBe('Call 760.00: 15.0%<br/>quoted 15:30:07 UTC')
  })

  it('a quote from another day keeps its date', () => {
    expect(quoteSpan([{ t: '2026-09-30T19:59:59+00:00' }], '2026-10-01')).toBe('2026-09-30 19:59:59 UTC')
  })
})
