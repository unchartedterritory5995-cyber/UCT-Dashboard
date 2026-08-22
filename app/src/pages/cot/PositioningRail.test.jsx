import { render, screen, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRef } from 'react'
import PositioningRail from './PositioningRail'
import { narrativeFacts } from './cotFacts'

// Friday closes, one per report week, trending up so precedents have outcomes.
function mkBars(n = 200) {
  const out = []
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(2022, 0, 7 + i * 7))
    out.push({ t: d.toISOString().slice(0, 10), o: 0, h: 0, l: 0, c: 100 + i * 0.5 + (i % 9), v: 0 })
  }
  return out
}

// Cyclical positioning (40-week cycle) so the same extreme recurs: with n=290
// the latest week sits on a commercial peak / large-spec trough, and the three
// prior peaks inside the 3-year window are precedents with full forward returns.
function mkCycleRows(n = 290) {
  const out = []
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(2022, 0, 4 + i * 7))
    const w = Math.sin((2 * Math.PI * i) / 40)
    out.push({
      date: d.toISOString().slice(0, 10),
      commercial_net: Math.round(-100_000 + 80_000 * w),
      large_spec_net: Math.round( 100_000 - 80_000 * w),
      small_spec_net: 10_000,
      open_interest:  1_800_000 + i * 1_000,
    })
  }
  return out
}

// 200 weeks; commercials climb to a 3-year max long on the last week, large
// specs fall to a max short, so the latest read is strongly contrarian bullish.
function mkRows(n = 200) {
  const out = []
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(2022, 0, 4 + i * 7))
    out.push({
      date: d.toISOString().slice(0, 10),
      commercial_net: -200_000 + i * 1_000,
      large_spec_net:  150_000 - i * 800,
      small_spec_net:  20_000 + (i % 7) * 1_000,
      open_interest:   1_800_000 + i * 1_500,
    })
  }
  return out
}

describe('PositioningRail', () => {
  it('shows the latest report by default with every group and open interest in the table', () => {
    const rows = mkRows()
    render(<PositioningRail rows={rows} symbol="ES" name="S&P 500 E-Mini" />)
    expect(screen.getByText('Latest report')).toBeInTheDocument()
    expect(rows[199].date).toBe('2025-10-28')
    expect(screen.getByText('10/28/2025')).toBeInTheDocument()
    expect(screen.getByText('Commercials')).toBeInTheDocument()
    expect(screen.getByText('Large Specs')).toBeInTheDocument()
    expect(screen.getByText('Small Specs')).toBeInTheDocument()
    expect(screen.getByText('Open Interest')).toBeInTheDocument()
    // latest commercial net = -200000 + 199*1000 = -1000 → "(1,000)"
    expect(screen.getByText('(1,000)')).toBeInTheDocument()
  })

  it('renders the bias and crowding read for the latest week', () => {
    render(<PositioningRail rows={mkRows()} symbol="ES" name="S&P 500 E-Mini" />)
    expect(screen.getByText('Contrarian Bullish')).toBeInTheDocument()
    expect(screen.getByText('Crowded Short')).toBeInTheDocument()
    expect(screen.getByText(/What to watch/i)).toBeInTheDocument()
  })

  it('follows an imperative setIndex and resets to latest on null', () => {
    const rows = mkRows()
    const ref = createRef()
    render(<PositioningRail ref={ref} rows={rows} symbol="ES" name="S&P 500 E-Mini" />)

    act(() => ref.current.setIndex(100))
    expect(screen.getByText('Week of')).toBeInTheDocument()
    expect(screen.getByText('12/5/2023')).toBeInTheDocument()    // rows[100].date
    // commercial net at 100 = -200000 + 100000 = -100000
    expect(screen.getByText('(100,000)')).toBeInTheDocument()

    act(() => ref.current.setIndex(null))
    expect(screen.getByText('Latest report')).toBeInTheDocument()
    expect(screen.getByText('(1,000)')).toBeInTheDocument()
  })

  it('snaps back to the latest week when the rows change', () => {
    const ref = createRef()
    const { rerender } = render(
      <PositioningRail ref={ref} rows={mkRows()} symbol="ES" name="S&P 500 E-Mini" />,
    )
    act(() => ref.current.setIndex(50))
    expect(screen.getByText('Week of')).toBeInTheDocument()
    rerender(<PositioningRail ref={ref} rows={mkRows(120)} symbol="NQ" name="Nasdaq-100 E-Mini" />)
    expect(screen.getByText('Latest report')).toBeInTheDocument()
  })

  it('shows the VIX caveat only for VI', () => {
    const { rerender } = render(<PositioningRail rows={mkRows()} symbol="ES" name="S&P 500 E-Mini" />)
    expect(screen.queryByText(/structurally short volatility/)).toBeNull()
    rerender(<PositioningRail rows={mkRows()} symbol="VI" name="VIX" />)
    // VI carries both the symbol note and the vol-class framing; at least one must render.
    expect(screen.getAllByText(/structurally short volatility/).length).toBeGreaterThanOrEqual(1)
  })

  it('renders nothing without rows', () => {
    const { container } = render(<PositioningRail rows={[]} symbol="ES" name="S&P 500 E-Mini" />)
    expect(container.firstChild).toBeNull()
  })
})

// Narrative POST → the given reply; archive GET → the given rows.
function mockApi({ narrative = { status: 'disabled', text: null }, archive = [] } = {}) {
  return vi.fn((url, init) => {
    const u = String(url)
    if (u.includes('/narratives')) return Promise.resolve({ ok: true, json: () => Promise.resolve({ rows: archive }) })
    if (u.endsWith('/narrative') && init?.method === 'POST') return Promise.resolve({ ok: true, json: () => Promise.resolve(narrative) })
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) })
  })
}
const posts = m => m.mock.calls.filter(c => c[1]?.method === 'POST')

describe('PositioningRail — v2 sections', () => {
  let fetchMock
  beforeEach(() => {
    fetchMock = mockApi()
    globalThis.fetch = fetchMock
  })
  afterEach(() => vi.restoreAllMocks())

  it('shows a precedents section with the proxy named once price bars are supplied', async () => {
    const rows = mkCycleRows()
    render(
      <PositioningRail rows={rows} symbol="ES" name="S&P 500 E-Mini" bars={mkBars(300)}
        proxy={{ ticker: 'SPY', note: 'via SPY' }} />,
    )
    expect(screen.getByText('Precedents')).toBeInTheDocument()
    expect(screen.getByText(/prior episodes since/)).toBeInTheDocument()
    expect(screen.getByText(/what SPY did next/)).toBeInTheDocument()
    expect(screen.getByText('4 wks')).toBeInTheDocument()
    expect(screen.getByText('8 wks')).toBeInTheDocument()
    expect(screen.getByText('13 wks')).toBeInTheDocument()
    expect(screen.getAllByText(/higher \d of 3/).length).toBeGreaterThanOrEqual(1)
  })

  it('tells the reader when this setup has no prior episode', () => {
    // Monotonic series → the only matching run is the current one.
    render(<PositioningRail rows={mkRows()} symbol="ES" name="S&P 500 E-Mini" bars={mkBars()}
      proxy={{ ticker: 'SPY', note: 'via SPY' }} />)
    expect(screen.getByText(/first time in the available history/)).toBeInTheDocument()
  })

  it('explains the absence of precedents instead of hiding the section', () => {
    // Flat series → both zones neutral → reason 'neutral'
    const rows = mkRows().map(r => ({ ...r, commercial_net: 5, large_spec_net: 5 }))
    render(<PositioningRail rows={rows} symbol="ZR" name="Rough Rice" />)
    expect(screen.getByText(/No extreme to compare/)).toBeInTheDocument()
  })

  it('requests the written read for the latest week only, and shows it when it arrives', async () => {
    fetchMock = mockApi({ narrative: { status: 'ok', text: 'First paragraph.\n\nSecond paragraph.', cached: true } })
    globalThis.fetch = fetchMock
    const rows = mkRows()
    const ref = createRef()
    render(<PositioningRail ref={ref} rows={rows} symbol="ES" name="S&P 500 E-Mini" />)
    await waitFor(() => expect(screen.getByText("This week's read")).toBeInTheDocument())
    expect(screen.getByText('First paragraph.')).toBeInTheDocument()
    expect(screen.getByText('Group by group')).toBeInTheDocument()
    expect(posts(fetchMock)).toHaveLength(1)
    expect(JSON.parse(posts(fetchMock)[0][1].body).report_date).toBe(rows[199].date)

    // Scrubbing to a past week falls back to the templated read and never re-posts.
    act(() => ref.current.setIndex(100))
    expect(screen.getByText('What this means')).toBeInTheDocument()
    expect(posts(fetchMock)).toHaveLength(1)
  })

  it('falls back to the templated read when the service is unavailable', async () => {
    render(<PositioningRail rows={mkRows()} symbol="ES" name="S&P 500 E-Mini" />)
    await waitFor(() => expect(posts(fetchMock)).toHaveLength(1))
    await waitFor(() => expect(screen.getByText('What this means')).toBeInTheDocument())
    expect(screen.queryByText("This week's read")).toBeNull()
  })

  it('shows the archived read for a past week when one was written at the time', async () => {
    const rows = mkRows()
    fetchMock = mockApi({ archive: [{ report_date: rows[100].date, text: 'Back then, hedgers were buying.', created_at: 'x' }] })
    globalThis.fetch = fetchMock
    const ref = createRef()
    render(<PositioningRail ref={ref} rows={rows} symbol="ES" name="S&P 500 E-Mini" />)
    await waitFor(() => expect(fetchMock.mock.calls.some(c => String(c[0]).includes('/narratives'))).toBe(true))
    act(() => ref.current.setIndex(100))
    await waitFor(() => expect(screen.getByText('The read that week')).toBeInTheDocument())
    expect(screen.getByText('Back then, hedgers were buying.')).toBeInTheDocument()
    // A week with no archived read keeps the templated read.
    act(() => ref.current.setIndex(90))
    expect(screen.getByText('What this means')).toBeInTheDocument()
  })

  it('names the hedgers-only match when the strict pairing was too rare', () => {
    // Commercials cycle every 40 weeks, large specs every 23 — the pair rarely repeats.
    const rows = []
    for (let i = 0; i < 291; i++) {
      const d = new Date(Date.UTC(2019, 0, 8 + i * 7))
      rows.push({ date: d.toISOString().slice(0, 10),
        commercial_net: Math.round(-100000 + 80000 * Math.sin((2 * Math.PI * i) / 40)),
        large_spec_net: Math.round(100000 - 80000 * Math.sin((2 * Math.PI * i) / 23 + 1.1)),
        small_spec_net: 1000, open_interest: 1000000 + i })
    }
    render(<PositioningRail rows={rows} symbol="ES" name="S&P 500 E-Mini" bars={mkBars(300)} proxy={{ ticker: 'SPY', note: 'via SPY' }} />)
    expect(screen.getByText(/matched on the hedgers/)).toBeInTheDocument()
  })

  it('renders the who-is-who note for the asset class', () => {
    render(<PositioningRail rows={mkRows()} symbol="GC" name="Gold" />)
    expect(screen.getByText(/producers|refiners|miners|physical/i)).toBeInTheDocument()
  })
})

describe('narrativeFacts', () => {
  it('carries only rounded, citable numbers and the labels the read used', () => {
    const snap = {
      date: '2026-08-18', windowWeeks: 156,
      oi: { value: 2_000_000, wow: 1234, index: 77.7, streak: 2 },
      groups: {
        commercials: { net: -113553, wow: -5210, pctOi: -5.48, index: 3.2, index26: 10.4, zone: 'extreme-short', streak: -4, weeksInZone: 5, move6: -41.2 },
        largeSpecs:  { net: 10560, wow: 900, pctOi: 0.51, index: 95.5, index26: 80, zone: 'extreme-long', streak: 3, weeksInZone: 2, move6: 12 },
        smallSpecs:  { net: 500, wow: 0, pctOi: 0.02, index: 50, index26: 50, zone: 'neutral', streak: 0, weeksInZone: 1, move6: 0 },
      },
    }
    const read = {
      bias: { label: 'Contrarian Bearish', strength: 'strong', tone: 'bear' },
      crowding: { label: 'Crowded Long', index: 96, tone: 'bear' },
      signals: [{ key: 'x', label: 'Movement Index −41 · Commercials', tone: 'bear', text: '' }],
      classNote: 'who is who',
    }
    const analogs = { n: 4, direction: 'bear', stats: { 4: { n: 4, hits: 3, hitRate: 75, median: -2.15, best: 1.2, worst: -6.04 }, 8: { n: 0 }, 13: { n: 0 } } }
    const f = narrativeFacts({ symbol: 'ES', name: 'S&P 500 E-Mini', snap, read, analogs, divergences: [{ label: 'Price high, specs fading' }], proxy: { ticker: 'SPY' } })
    expect(f.groups.commercials.pct_of_oi).toBe(-5.5)
    expect(f.groups.commercials.index_3y).toBe(3)
    expect(f.groups.commercials.move_6w).toBe(-41)
    expect(f.precedents.proxy).toBe('SPY')
    expect(f.precedents.horizons['4w'].median_pct).toBe(-2.2)
    expect(f.precedents.horizons['4w'].hit_rate).toBe(75)
    expect(f.price_check).toEqual(['Price high, specs fading'])
    expect(f.signals).toEqual(['Movement Index −41 · Commercials'])
    expect(f.who_is_who).toBe('who is who')
  })

  it('omits precedents below the minimum episode count', () => {
    const snap = { date: '2026-08-18', windowWeeks: 156, oi: { value: 1, wow: 0, index: 50, streak: 0 },
      groups: Object.fromEntries(['commercials','largeSpecs','smallSpecs'].map(k => [k, { net: 0, wow: 0, pctOi: 0, index: 50, index26: 50, zone: 'neutral', streak: 0, weeksInZone: 1, move6: 0 }])) }
    const read = { bias: { label: 'Neutral', strength: null, tone: 'neutral' }, crowding: { label: 'Balanced', index: 50, tone: 'neutral' }, signals: [], classNote: null }
    const f = narrativeFacts({ symbol: 'ES', name: '', snap, read, analogs: { n: 2, direction: 'neutral', stats: {} }, divergences: [], proxy: null })
    expect(f.precedents).toBeNull()
  })
})
