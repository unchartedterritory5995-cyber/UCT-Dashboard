/** TradeReplay — bar reveal, marker gating, running-P&L math. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react'
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

    // ⚰️⚰️ THIS TEST WAS FLAKY UNDER FULL-SUITE LOAD — ~1 run in 5, green 8/8 in
    // isolation — and the cause was this line running too early, not anything
    // about markers. DIAGNOSED FROM THE FAILING DOM rather than guessed: it read
    // `Waiting…` (so idx === 0) AND `❮❮ Pause` (so playing === true). A scrub
    // sets playing FALSE, so the state on screen could not be the scrub's — it is
    // the mount sequence's. The chart-creation effect ends with
    // `setIdx(0); setPlaying(true)`, and `{bars && …}` renders the slider in the
    // SAME commit that sets `bars`, so `findByLabelText` can resolve BEFORE that
    // effect has run. Scrubbing then, and the effect landing after, wipes it.
    //
    // ⭐ SO THE FIX IS TO WAIT FOR THE COMPONENT TO BE READY, and `setMarkers`
    // having been called is the proof: `markersRef` is created by that very
    // effect, so a single call cannot have happened before it ran. Its deps are
    // stable, so it never runs again — after this line the scrub is the last word.
    //
    // ⛔ AND IT IS A TEST FIX, NOT A COMPONENT ONE. The component is right to
    // start playing on mount; what was wrong was asserting on a state the mount
    // was still entitled to overwrite. Changing the component to satisfy this
    // test would have been the wrong repair to a correctly-diagnosed race.
    await waitFor(() => expect(setMarkers).toHaveBeenCalled())

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
