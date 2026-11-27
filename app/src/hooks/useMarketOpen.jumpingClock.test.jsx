// useMarketOpen under a clock that moves between calls (2026-11-27). agentChartReplayPlan mocks Date.now to jump 2 s per
// call (its 10 s read-back wait passes at once), and ChartMarketClock, a reader of this hook, died with "Maximum update
// depth exceeded": the snapshot followed Date.now itself, so two reads React makes for one render (and the commit's)
// fell in different minutes, every render looked like a store change, and React forced another without end.
//   J1 (red first) with subscribers, every read returns the state the store last announced, whatever Date.now says;
//      readers whose renders call Date.now many times (a chart does) mount and re-render without a loop (a read with
//      no subscriber still follows the live clock: React's double read at mount may warn once under this clock)
//   J2 the minute tick still announces a new state (the hook's every-minute contract)
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, act, cleanup } from '@testing-library/react'
import { useState } from 'react'
import useMarketOpen, { _resetMarketStateCacheForTests } from './useMarketOpen'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); _resetMarketStateCacheForTests() })

let bump = null
function Reader({ id, onState }) {
  const s = useMarketOpen()
  const [, set] = useState(0)
  if (id === 0) bump = set
  for (let i = 0; i < 40; i++) Date.now()          // a chart's render reads the clock many times
  onState?.(s)
  return <span>{String(s.isOpen)}</span>
}

describe('useMarketOpen under a clock that moves between calls', () => {
  it('J1 (red first) readers mount and re-render with no update loop', () => {
    _resetMarketStateCacheForTests()
    const real = Date.now.bind(Date)
    let t = real()
    vi.spyOn(Date, 'now').mockImplementation(() => { t += 2000; return t })
    const errors = []
    vi.spyOn(console, 'error').mockImplementation((...a) => { errors.push(a.map(String).join(' ')) })
    const seen = []
    expect(() => {
      render(<>{[0, 1, 2].map((i) => <Reader key={i} id={i} onState={i === 0 ? (s) => seen.push(s) : null} />)}</>)
      for (let k = 0; k < 5; k++) act(() => { bump((n) => n + 1) })
    }).not.toThrow()
    expect(errors.filter((e) => /Maximum update depth/.test(e)), 'an update loop').toEqual([])
    // before the first subscriber a read follows the live clock by design, so React's own double read at mount may
    // see two minutes under this clock and warn once; never more (a loop warns on every render)
    expect(errors.filter((e) => /getSnapshot should be cached/.test(e)).length, 'the snapshot changed render after render').toBeLessThanOrEqual(1)
    expect(new Set(seen.slice(1)).size, 'a reader saw the state change with no announcement').toBe(1)
  })

  it('J2 the minute tick still announces a new state', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T14:29:30Z'))   // 09:29:30 ET, pre-market
    _resetMarketStateCacheForTests()
    const seen = []
    render(<Reader id={0} onState={(s) => seen.push(s)} />)
    expect(seen.at(-1)).toMatchObject({ isOpen: false, isPremarket: true })
    act(() => { vi.advanceTimersByTime(31_000) })        // the 09:30 tick
    expect(seen.at(-1), 'the minute tick did not announce the open').toMatchObject({ isOpen: true, isPremarket: false })
  })
})
