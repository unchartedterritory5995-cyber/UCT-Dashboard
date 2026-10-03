// D-5 — the call replay panel, asserted on rendered text through the real DepthTab.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { SWRConfig } from 'swr'
import DepthTab from './DepthTab'
import { lastAtOrBefore } from './CallReplayPanel'

const T0 = Date.UTC(2026, 6, 30, 21, 0) / 1000     // 17:00 ET
const ALIGNED = {
  symbol: 'AAPL', year: 2026, quarter: 3, state: 'aligned',
  transcript_source: 'earningscall.biz timed transcript (word-level timings)',
  tape_source: 'Massive 1-minute aggregates (extended hours included)',
  tape_state: 'ok',
  window: { from: T0 - 900, to: T0 + 2400, pre_minutes: 15, post_minutes: 30 },
  alignment: { basis: 'listed_start', call_start: '2026-07-30T21:00:00+00:00',
    note: 'A call that began late shifts every turn by the same amount.' },
  bars: [{ t: T0 - 60, c: 200 }, { t: T0 + 60, c: 202 }, { t: T0 + 600, c: 210 }],
  turns: [
    { speaker: 'Tim Cook', title: 'CEO', start_s: 0, end_s: 1, text: 'Good afternoon', at: T0 },
    { speaker: 'Amy Analyst', title: '', start_s: 600, end_s: 601, text: 'What about China?', at: T0 + 600 },
  ],
}
let body
beforeEach(() => {
  body = ALIGNED
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers() })

const renderTab = (flags = { call_replay_enabled: true }) => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <DepthTab sym="aapl" flags={flags} />
  </SWRConfig>,
)

describe('CallReplayPanel', () => {
  it('is not rendered when its flag is off', () => {
    renderTab({})
    expect(screen.queryByTestId('call-replay-panel')).not.toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('states its alignment basis and draws the tape', async () => {
    renderTab()
    expect((await screen.findByTestId('replay-basis')).textContent).toMatch(/Aligned at the listed start, 5:00 PM ET/)
    expect(screen.getByTestId('replay-tape')).toBeInTheDocument()
  })

  it('a turn click moves the clock to that turn, highlights it, and prices it against the call start', async () => {
    renderTab()
    await screen.findByTestId('replay-basis')
    fireEvent.click(screen.getByRole('button', { name: '5:10 PM' }))
    expect(screen.getByTestId('replay-clock').textContent).toBe('5:10 PM ET · 210.00 (+5.00% vs the call start)')
    const rows = screen.getAllByTestId('replay-turn')
    expect(rows[1].getAttribute('data-active')).toBe('true')
    expect(rows[0].getAttribute('data-active')).toBeNull()
  })

  it('play advances the clock', async () => {
    renderTab()
    await screen.findByTestId('replay-basis')
    vi.useFakeTimers()
    fireEvent.click(screen.getByTestId('replay-play'))
    act(() => { vi.advanceTimersByTime(15_000) })      // 15 s x 60x = 15 call-minutes
    expect(screen.getByTestId('replay-clock').textContent).toMatch(/^5:00 PM ET/)
  })

  it('unaligned: turns by recording time, no tape, the reason in words', async () => {
    body = { ...ALIGNED, state: 'unaligned', reason: 'No usable start time is on file for this call.',
      bars: [], tape_state: 'not_read', alignment: null, window: undefined,
      turns: ALIGNED.turns.map(({ at, ...t }) => t) }
    renderTab()
    expect((await screen.findByTestId('replay-unaligned')).textContent).toMatch(/No usable start time/)
    expect(screen.queryByTestId('replay-tape')).toBeNull()
    expect(screen.getAllByTestId('replay-turn')[1].textContent).toMatch(/10:00 into the recording/)
  })

  it('an empty tape is said, never drawn flat', async () => {
    body = { ...ALIGNED, bars: [], tape_state: 'empty' }
    renderTab()
    expect((await screen.findByTestId('replay-tape-empty')).textContent).toMatch(/could not be read or held no bars/)
    expect(screen.queryByTestId('replay-tape')).toBeNull()
  })

  it('no timed transcript says so', async () => {
    body = { symbol: 'XYZ', state: 'no_timed_transcript', reason: 'No timed transcript is on file for this call.', turns: [], bars: [] }
    renderTab()
    expect((await screen.findByTestId('replay-none')).textContent).toMatch(/No timed transcript/)
  })

  it('a failed read is a gap, not a finding', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) }))
    renderTab()
    expect((await screen.findByTestId('replay-unavailable')).textContent).toMatch(/not a finding about AAPL/)
  })

  it('lastAtOrBefore', () => {
    const xs = [{ t: 1 }, { t: 5 }, { t: 9 }]
    expect([0, 1, 5, 6, 9, 10].map(v => lastAtOrBefore(xs, v, 't'))).toEqual([-1, 0, 1, 1, 2, 2])
  })
})
