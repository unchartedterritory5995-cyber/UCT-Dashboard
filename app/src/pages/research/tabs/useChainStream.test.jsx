import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, act, cleanup } from '@testing-library/react'
import useChainStream, { overlayQuote, chainQuotesUrl } from './useChainStream'

// FT-015 / BRK-01: the streamed chain overlay (api/live_chain_stream.py serves it from flow-worker).
const C = 'O:TST261016C00100000'
const SERVED = Date.parse('2026-10-09T14:00:00Z')

describe('overlayQuote', () => {
  const q = { contract: C, bid: 1.0, ask: 1.2, last: 1.1 }

  it('lays streamed fields over the polled ones only when they are newer than the chain read', () => {
    const newer = { [C]: { last: 1.3, last_ts: SERVED + 1, bid: 1.25, ask: 1.35, quote_ts: SERVED + 5 } }
    expect(overlayQuote(q, newer, SERVED)).toMatchObject({ last: 1.3, bid: 1.25, ask: 1.35, live_last: true, live_quote: true })
    const older = { [C]: { last: 1.3, last_ts: SERVED - 1, bid: 1.25, ask: 1.35, quote_ts: SERVED - 1 } }
    expect(overlayQuote(q, older, SERVED)).toBe(q)
  })

  it('a contract with only a streamed print keeps its polled quote', () => {
    const out = overlayQuote(q, { [C]: { last: 1.4, last_ts: SERVED + 1 } }, SERVED)
    expect(out).toMatchObject({ last: 1.4, bid: 1.0, ask: 1.2 })
    expect(out.live_quote).toBeUndefined()
  })

  it('no contract id or no streamed row is the polled quote, untouched', () => {
    expect(overlayQuote({ bid: 1 }, { [C]: { last: 2, last_ts: SERVED + 1 } }, SERVED)).toEqual({ bid: 1 })
    expect(overlayQuote(q, {}, SERVED)).toBe(q)
  })
})

class FakeES {
  static last = null
  constructor(url) { this.url = url; this.closed = false; FakeES.last = this }
  close() { this.closed = true }
}

function Probe({ sym, exp }) {
  const s = useChainStream(sym, exp)
  return <div data-testid="probe">{JSON.stringify(s)}</div>
}
const read = () => JSON.parse(screen.getByTestId('probe').textContent)

describe('useChainStream', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); FakeES.last = null })

  it('switched off (404): no stream is opened and nothing changes', async () => {
    vi.stubGlobal('EventSource', FakeES)
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ status: 404, json: () => Promise.resolve({}) })))
    render(<Probe sym="TST" exp="2026-10-16" />)
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(chainQuotesUrl('TST', '2026-10-16'), expect.anything()))
    await new Promise((r) => setTimeout(r, 10))
    expect(FakeES.last).toBeNull()
    expect(read().on).toBe(false)
  })

  it('armed (200): seeds from the probe, opens the stream, merges each message, closes on unmount', async () => {
    vi.stubGlobal('EventSource', FakeES)
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      status: 200, json: () => Promise.resolve({ quotes: { [C]: { last: 1.1, last_ts: 5 } }, coverage: 'Coverage words.' }),
    })))
    const { unmount } = render(<Probe sym="TST" exp="2026-10-16" />)
    await waitFor(() => expect(read().on).toBe(true))
    expect(FakeES.last.url).toContain('/api/live/massive/chain-stream/TST?expiration=2026-10-16')
    act(() => FakeES.last.onmessage({ data: JSON.stringify({ quotes: { [C]: { bid: 1.0, ask: 1.2, quote_ts: 9 } } }) }))
    expect(read().quotes[C]).toEqual({ last: 1.1, last_ts: 5, bid: 1.0, ask: 1.2, quote_ts: 9 })
    expect(read().coverage).toBe('Coverage words.')
    const es = FakeES.last
    unmount()
    expect(es.closed).toBe(true)
  })

  it('no expiration yet: asks nothing', async () => {
    vi.stubGlobal('fetch', vi.fn())
    render(<Probe sym="TST" exp={null} />)
    await new Promise((r) => setTimeout(r, 10))
    expect(fetch).not.toHaveBeenCalled()
  })
})
