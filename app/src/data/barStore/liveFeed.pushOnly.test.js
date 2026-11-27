// ⭐ A ROW AHEAD RIDES THE PUSH STREAM ONLY (2026-11-25). The watchlist keeps the next rows current through a minute roll
// with the server's own push frames (`attach(key, { pushOnly: true })`); it adds no tick fallback (no trade feed, no
// price-stream subscription: those are the chart's, and a row ahead is not on screen).
//   P1  a push-only attach subscribes the bars stream as an AHEAD pair, and nothing else
//   P2  beside a chart's full attach of the same key, each frame reaches the store ONCE
//   P3  pushLiveSince(key): the stream's liveSince while it delivers the pair; null when it does not, or push is off
import { describe, it, expect } from 'vitest'
import { createRegistry } from './registry'
import { createLiveFeed } from './liveFeed'
import { fakeStream, fakeCandle, fakePrices } from './testing/fakeFeeds'
import { keyOf } from './types'

const KEY = keyOf({ sym: 'AAPL', tf: '1' })
function world({ pushEnabled = () => true } = {}) {
  const registry = createRegistry({ ctx: () => ({ nowMs: Date.now() }) })
  const stream = fakeStream(), candle = fakeCandle(), prices = fakePrices()
  const live = createLiveFeed({ registry, pushEnabled, stream, candle, prices, now: () => Date.now() })
  return { registry, stream, candle, prices, live }
}
const frame = (t, c, rev) => ({ sym: 'AAPL', tf: '1', t_s: t, rev, final: false, bar: { t: t * 1000, o: 10, h: 11, l: 9, c, v: 5 } })

describe('liveFeed push-only attach (a row ahead of the member)', () => {
  it('P1 subscribes the bars stream as an AHEAD pair, and nothing else', () => {
    const w = world()
    const off = w.live.attach(KEY, { pushOnly: true })
    expect(w.stream.ahead()).toEqual(['AAPL:1'])
    expect(w.candle.count()).toBe(0)
    expect(w.prices.count()).toBe(0)
    off()
    expect(w.stream.count()).toBe(0)
  })

  it('P1 push off: a push-only attach subscribes nothing', () => {
    const w = world({ pushEnabled: () => false })
    const off = w.live.attach(KEY, { pushOnly: true })
    expect(w.stream.count() + w.candle.count() + w.prices.count()).toBe(0)
    off()
  })

  it('P2 beside a full attach of the same key, each frame reaches the store once', () => {
    const w = world()
    const seen = []
    const real = w.registry.dispatch.bind(w.registry)
    w.registry.dispatch = (key, action, ctx) => { if (key === KEY) seen.push(action.type); return real(key, action, ctx) }
    const offFull = w.live.attach(KEY)
    const offAhead = w.live.attach(KEY, { pushOnly: true })
    w.stream.emit('AAPL', '1', frame(1_800_000_000 - (1_800_000_000 % 60), 10.5, 1))
    expect(seen.filter((t) => t === 'push-bar').length).toBe(1)
    offFull()
    w.stream.emit('AAPL', '1', frame(1_800_000_000 - (1_800_000_000 % 60), 10.6, 2))   // the chart left; the row ahead stays
    expect(seen.filter((t) => t === 'push-bar').length).toBe(2)
    offAhead()
  })

  it('P3 pushLiveSince: the stream\'s liveSince while it delivers the pair, else null', () => {
    const w = world()
    expect(w.live.pushLiveSince(KEY)).toBeNull()
    w.stream.st.live.set('AAPL:1', 1234)
    expect(w.live.pushLiveSince(KEY)).toBe(1234)
    w.stream.st.delivering = false
    expect(w.live.pushLiveSince(KEY)).toBeNull()
    const off = world({ pushEnabled: () => false })
    off.stream.st.live.set('AAPL:1', 1234)
    expect(off.live.pushLiveSince(KEY)).toBeNull()
  })
})
