// Chart IQ client rails: the drawing plan (chartIqPlan.buildPlan), the gate, the daily-only fetch key and the panel.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { buildPlan, defaultLayers, LAYERS } from './chartIqPlan'
import { chartIqAllowed } from './chartIqGate'
import { chartIqKey, chartIqRetry } from '../../../hooks/useChartIq'
import ChartIqPanel, { firstSentence, ChartIqFeedback, errorText } from './ChartIqPanel'

const BARS = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']
const PAYLOAD = {
  ticker: 'CVLT', asof: '2026-10-30',
  thesis: 'CVLT is an uptrend over its rising MAs. Plan: buy the oops reversal.',
  context: 'Context: the RS line is rising.',
  card: [['Trend', 'Uptrend'], ['Setup', 'Oops reversal']],
  clean: [
    { kind: 'hline', ptype: 'Resistance', role: 'Resistance', price: 180, start: '2026-01-02' },
    { kind: 'zone', ptype: 'Support zone', top: 150, bot: 148, start: '2026-10-27' },
    { kind: 'trendline', d1: '2026-10-26', p1: 170, d2: '2026-10-28', p2: 166, extend: true, src: 'tv_tl_auto_dojiemoji' },
    { kind: 'base', ptype: 'Bull flag', start: '2026-10-26', end: '2026-10-30', line: 174.25, buy_point: 174.25, low: 153.6 },
    { kind: 'candle', ptype: 'Oops reversal', at: 'low', pts: [{ d: '2026-10-29', p: 161 }], why: 'opened under the prior low' },
    { kind: 'candle', ptype: 'Inside day', at: 'high', dot: true, text: '', pts: [{ d: '2026-10-28', p: 165 }] },
    { kind: 'candle', ptype: 'Off chart', at: 'low', pts: [{ d: '2025-01-02', p: 1 }] },
  ],
  cycle: [{ d: '2026-10-27', stage: 'EMA crossback', shown: true, bear: false, why: 'held the 20EMA' }, { d: '2026-10-28', stage: 'Hidden', shown: false }],
  buydays: [{ d: '2026-10-29', name: 'Oops reversal · Higher low', held: true, best: true, run: 7.1 }, { d: '2026-10-26', name: 'UnR', held: false, best: false }],
  watches: [{ kind: 'Slingshot watch', text: 'a close over 172', trigger: 172.02, stop: 161.34, risk_pct: 6.2, dist_atr: 0.4 }],
  gaps: [{ d: '2026-10-27', up: true, top: 155, bot: 152, state: 'support' }],
}

describe('buildPlan', () => {
  it('draws every default layer and clips dates to the loaded bars', () => {
    const p = buildPlan(PAYLOAD, BARS)
    const lvl = p.segments.find((s) => s.kind === 'level')
    expect(lvl).toMatchObject({ t1: BARS[0], t2: BARS[4], p1: 180, color: '#f87171', label: 'Resistance' })
    expect(p.segments.filter((s) => s.kind === 'zone')).toHaveLength(2)
    const tl = p.segments.find((s) => s.kind === 'trendline')
    expect(tl.color).toBe('#60a5fa')                       // the auto-trendline port draws blue
    expect(tl.t2).toBe(BARS[4])                            // extended to the last bar
    expect(tl.p2).toBeCloseTo(162, 5)                      // along its own slope, -2 a bar
    expect(p.segments.find((s) => s.kind === 'buypoint').label).toBe('Buy 174.25')
    expect(p.segments.some((s) => s.kind === 'gap')).toBe(false)     // gaps are off by default
    expect(p.hlines.map((h) => h.kind)).toEqual(['trigger', 'stop'])
  })

  it('markers: drawn candles, shown cycle stages, held / best buy days; nothing off-chart', () => {
    const p = buildPlan(PAYLOAD, BARS)
    const texts = p.markers.map((m) => m.text)
    expect(texts).toContain('Oops reversal')
    expect(texts).toContain('EMA crossback')
    expect(texts).toContain('BEST BUY · Oops reversal')
    expect(texts).not.toContain('Off chart')
    expect(p.markers.some((m) => m.text === 'Hidden')).toBe(false)
    expect(p.markers.some((m) => m.t === '2026-10-26' && m.kind === 'buy')).toBe(false)   // a failed buy day is not an arrow
    const dot = p.markers.find((m) => m.t === '2026-10-28' && m.kind === 'candle')
    expect(dot.size).toBe(1)
    const old = buildPlan({ buydays: [{ d: '2026-09-02', name: 'UnR', held: true, best: false }] }, [...Array(20).keys()].map((k) => `2026-09-${String(k + 1).padStart(2, '0')}`).concat(BARS))
    expect(old.markers[0].text).toBe('')                    // a plain buy day more than 10 bars back is an arrow, not a label
    expect([...p.markers].map((m) => m.t)).toEqual([...p.markers].map((m) => m.t).sort())
  })

  it('every layer switch removes exactly its own drawings', () => {
    const all = buildPlan(PAYLOAD, BARS, { ...defaultLayers(), gaps: true })
    expect(all.segments.some((s) => s.kind === 'gap')).toBe(true)
    const off = (id) => buildPlan(PAYLOAD, BARS, { ...defaultLayers(), gaps: true, [id]: false })
    expect(off('levels').segments.some((s) => s.kind === 'level' || s.kind === 'zone')).toBe(false)
    expect(off('lines').segments.some((s) => s.kind === 'trendline')).toBe(false)
    expect(off('bases').segments.some((s) => s.kind === 'base' || s.kind === 'buypoint')).toBe(false)
    expect(off('candles').markers.some((m) => m.kind === 'candle')).toBe(false)
    expect(off('cycle').markers.some((m) => m.kind === 'cycle')).toBe(false)
    expect(off('buys').markers.some((m) => m.kind === 'buy')).toBe(false)
    expect(off('watch').hlines).toHaveLength(0)
    expect(LAYERS.map((l) => l.id)).toEqual(Object.keys(defaultLayers()))
  })

  it('no bars or no payload draws nothing', () => {
    expect(buildPlan(PAYLOAD, [])).toEqual({ segments: [], markers: [], hlines: [] })
    expect(buildPlan(null, BARS)).toEqual({ segments: [], markers: [], hlines: [] })
  })
})

describe('gate and fetch key', () => {
  it('only the server flag on a signed-in viewer opens it', () => {
    expect(chartIqAllowed(null)).toBe(false)
    expect(chartIqAllowed({ user: { id: 1 }, chartIqEnabled: false })).toBe(false)
    expect(chartIqAllowed({ user: null, chartIqEnabled: true })).toBe(false)
    expect(chartIqAllowed({ user: { id: 1 }, chartIqEnabled: true })).toBe(true)
  })
  it('fetches on the daily timeframe only, and only when enabled', () => {
    expect(chartIqKey('cvlt', 'D', true)).toBe('/api/chart-iq/CVLT')
    expect(chartIqKey('CVLT', 'W', true)).toBeNull()
    expect(chartIqKey('CVLT', '5', true)).toBeNull()
    expect(chartIqKey('CVLT', 'D', false)).toBeNull()
  })
})

describe('ChartIqPanel', () => {
  it('collapsed shows the first sentence; open shows thesis, context, watches, read box and the layer switches', () => {
    const layers = defaultLayers()
    const seen = []
    render(<ChartIqPanel data={PAYLOAD} layers={layers} onLayer={(id, on) => seen.push([id, on])} />)
    expect(screen.getByText('CVLT is an uptrend over its rising MAs.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByTestId('chart-iq-thesis').textContent).toBe(PAYLOAD.thesis)
    expect(screen.getByText('Context: the RS line is rising.')).toBeTruthy()
    expect(screen.getByText('Slingshot watch')).toBeTruthy()
    expect(screen.getByText('Uptrend')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Trendlines'))
    expect(seen).toEqual([['lines', false]])
  })
  it('says so while loading or on an error', () => {
    const { rerender } = render(<ChartIqPanel data={null} loading layers={defaultLayers()} onLayer={() => {}} />)
    expect(screen.getByText('Chart IQ is reading the chart...')).toBeTruthy()
    rerender(<ChartIqPanel data={null} error={new Error('x')} layers={defaultLayers()} onLayer={() => {}} />)
    expect(screen.getByText('Chart IQ could not read this chart')).toBeTruthy()
  })
  it('firstSentence', () => {
    expect(firstSentence('A b. C d.')).toBe('A b.')
    expect(firstSentence('no stop')).toBe('no stop')
  })
})


describe('no performance numbers on the chart (tracked privately, not displayed)', () => {
  it('a buy day marker never shows a run, a percent or a return', () => {
    const p = buildPlan(PAYLOAD, BARS)
    const buys = p.markers.filter((m) => m.kind === 'buy')
    expect(buys.length).toBeGreaterThan(0)
    for (const m of buys) expect(`${m.text} ${m.why}`).not.toMatch(/%|\brun\b|since \+/)
  })
})

describe('ChartIqFeedback', () => {
  afterEach(() => { vi.restoreAllMocks() })
  const DATA = { ticker: 'CVLT', asof: '2026-10-30', version: 'v4.38', my_feedback: null }

  it('a vote posts the chart, the day, the vote and the note, then says saved', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => ({ vote: 'noise', note: 'too busy' }) })
    render(<ChartIqFeedback data={DATA} />)
    fireEvent.change(screen.getByLabelText(/get wrong or miss/i), { target: { value: 'too busy' } })
    fireEvent.click(screen.getByRole('button', { name: 'Noise' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Saved/))
    const [url, opts] = f.mock.calls[0]
    expect(url).toBe('/api/chart-iq/CVLT/feedback')
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body)).toEqual({ asof: '2026-10-30', vote: 'noise', note: 'too busy', version: 'v4.38' })
    expect(screen.getByRole('button', { name: 'Noise' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('shows the saved vote and note, asks for a vote before saving a bare note, and reports a failure', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 429, json: async () => ({}) })
    const { unmount } = render(<ChartIqFeedback data={DATA} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }))
    expect(screen.getByRole('status').textContent).toMatch(/Pick Useful/)
    expect(f).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Useful' }))
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Not saved: Daily limit/))
    unmount()
    render(<ChartIqFeedback data={{ ...DATA, my_feedback: { vote: 'partly', note: 'missed the gap' } }} />)
    expect(screen.getByRole('button', { name: 'Partly' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByLabelText(/get wrong or miss/i).value).toBe('missed the gap')
  })
})

describe('errorText: says why a read failed', () => {
  it('maps the engine reasons and keeps everything else generic', () => {
    expect(errorText({ status: 404, detail: 'NEWCO: not enough daily bars as of 2026-10-30 (40)' })).toMatch(/6 months of daily history/)
    expect(errorText({ status: 404, detail: 'no daily bars available' })).toMatch(/no daily bars/)
    expect(errorText({ status: 503, detail: 'Chart IQ is busy, try again' })).toMatch(/still reading/)
    expect(errorText({ status: 404, detail: 'ABC: KeyError' })).toBe('Chart IQ could not read this chart')
    expect(errorText(null)).toBe('')
  })
})

describe('chartIqRetry: only a busy (503) read is retried, at most twice', () => {
  it('retries 503 after a pause and gives up after two retries; never retries another failure', () => {
    vi.useFakeTimers()
    const rv = vi.fn()
    chartIqRetry({ status: 503 }, 'k', {}, rv, { retryCount: 1 }); vi.advanceTimersByTime(4000)
    expect(rv).toHaveBeenCalledTimes(1)
    chartIqRetry({ status: 503 }, 'k', {}, rv, { retryCount: 3 }); vi.advanceTimersByTime(4000)
    chartIqRetry({ status: 404, detail: 'not enough daily bars' }, 'k', {}, rv, { retryCount: 1 }); vi.advanceTimersByTime(4000)
    expect(rv).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})

describe('found on the live site 2026-11-02', () => {
  it('the toolbar button sizes to its label (the toolbar .btn class fixes 24px, which overlapped Patterns / Team)', async () => {
    const { default: ChartIqToolbarButton } = await import('./ChartIqToolbarButton')
    render(<ChartIqToolbarButton active={false} onToggle={() => {}} />)
    const b = screen.getByTestId('chart-iq-toggle')
    expect(b.style.width).toBe('auto')
    expect(b.style.whiteSpace).toBe('nowrap')
  })

  it('on a non-daily chart the panel says Chart IQ reads daily charts and offers the switch', () => {
    const show = vi.fn(); const close = vi.fn()
    render(<ChartIqPanel notDaily onShowDaily={show} onClose={close} />)
    expect(screen.getByTestId('chart-iq-not-daily').textContent).toMatch(/daily/)
    fireEvent.click(screen.getByRole('button', { name: 'Show daily' }))
    expect(show).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Turn Chart IQ off' }))
    expect(close).toHaveBeenCalledTimes(1)
  })
})
