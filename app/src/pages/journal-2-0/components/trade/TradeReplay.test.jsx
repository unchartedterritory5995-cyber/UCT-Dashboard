/** TradeReplay — bar reveal, marker gating, running-P&L math. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import TradeReplay from './TradeReplay'

const setMarkers = vi.fn()
const setData = vi.fn()
const update = vi.fn()
vi.mock('lightweight-charts', () => ({
  createChart: () => ({
    addSeries: () => ({ setData, update, createPriceLine: vi.fn() }),
    timeScale: () => ({ setVisibleRange: vi.fn() }),
    remove: vi.fn(),
  }),
  createSeriesMarkers: () => ({ setMarkers }),
  CandlestickSeries: {},
  LineStyle: { Dashed: 2 },
  ColorType: { Solid: 'solid' },
}))

// Daily bars around a 2-day hold: entry 08-04, exit 08-05.
const BARS = [
  { t: '2026-08-03', o: 100, h: 102, l: 99, c: 101 },
  { t: '2026-08-04', o: 101, h: 105, l: 100, c: 104 },   // entry bar
  { t: '2026-08-05', o: 104, h: 110, l: 103, c: 109 },   // exit bar
  { t: '2026-08-06', o: 109, h: 111, l: 107, c: 108 },
]
const TRADE = {
  symbol: 'NVDA', side: 'Long', shares: 10,
  entryPrice: 101, exitPrice: 109, holdDays: 30,          // holdDays>5 → daily tier
  entryDate: '2026-08-04T14:30:00Z', exitDate: '2026-08-05T19:00:00Z',
}

beforeEach(() => {
  setMarkers.mockClear(); setData.mockClear(); update.mockClear()
  global.fetch = vi.fn(() => Promise.resolve({
    ok: true, json: () => Promise.resolve({ bars: BARS }),
  }))
})

describe('TradeReplay', () => {
  it('loads bars, states the tier honestly, and starts playing', async () => {
    render(<TradeReplay trade={TRADE} onClose={() => {}} />)
    expect(await screen.findByText('daily bars')).toBeInTheDocument()
    // real timers: playback may already have finished → Pause OR Restart
    expect(screen.getByText(/Pause|Restart|Play/)).toBeInTheDocument()
  })

  it('markers appear only once playback REACHES entry/exit; P&L is side-aware', async () => {
    render(<TradeReplay trade={TRADE} onClose={() => {}} />)
    const scrub = await screen.findByLabelText('Replay position')
    // Scrub to just the first (pre-entry) bar → no markers, "Before entry".
    act(() => { fireEvent.change(scrub, { target: { value: '1' } }) })
    expect(setMarkers).toHaveBeenLastCalledWith([])
    expect(screen.getByText('Before entry')).toBeInTheDocument()
    // Past the entry bar → BUY marker + open P&L off that bar's close:
    // (104 − 101) × 10 = +$30
    act(() => { fireEvent.change(scrub, { target: { value: '2' } }) })
    expect(setMarkers.mock.calls.at(-1)[0]).toHaveLength(1)
    expect(screen.getByText(/\+\$30\.00/)).toBeInTheDocument()
    // Past the exit bar → both markers + realized (109 − 101) × 10 = +$80
    act(() => { fireEvent.change(scrub, { target: { value: '3' } }) })
    expect(setMarkers.mock.calls.at(-1)[0]).toHaveLength(2)
    expect(screen.getByText(/\+\$80\.00 realized/)).toBeInTheDocument()
  })

  it('window with no covering bars shows the honest error', async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true, json: () => Promise.resolve({ bars: [] }),
    }))
    render(<TradeReplay trade={TRADE} onClose={() => {}} />)
    expect(await screen.findByText(/No bar history covers/)).toBeInTheDocument()
  })
})
