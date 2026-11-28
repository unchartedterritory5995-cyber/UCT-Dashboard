// ⛔⛔ (2026-11-28) A PARTIAL /api/bars-history ANSWER IS NOT THE DEEP HISTORY. When the worker's deep origin does not
// answer, the route serves the web's own shallow store marked sealed: true AND partial: true. Its rows are joined for
// display, but the key is not settled as joined: the deep history is asked again after 5 s, 15 s, then every 60 s, until
// a sealed, non-partial answer comes, so a worker outage cannot leave a member on a short D/W/M chart for the key's life.
//   P1 a partial answer's rows are shown; the history is asked again on the backoff; the sealed answer then joins and
//      ends the asks
//   P2 a deep origin that stays down: the asks keep coming, 60 s apart, never faster
//   P3 control: a sealed, non-partial first answer is asked once (no retry)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRegistry } from './registry'
import { createNetwork, PARTIAL_RETRY_MS } from './network'
import { keyOf } from './types'
import { fullBarsFor } from '../../utils/barsBackfill'

const T0 = Date.UTC(2026, 10, 10, 15, 0)   // Tue 2026-11-10 10:00 ET
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); localStorage.removeItem('uct.barsHistory.enabled'); localStorage.setItem('uct.barsHistory.bucket', '5') })
afterEach(() => { vi.useRealTimers(); localStorage.removeItem('uct.barsHistory.enabled'); localStorage.removeItem('uct.barsHistory.bucket') })

function weekdays(n, last) {
  const out = []
  const d = new Date(`${last}T00:00:00Z`)
  while (out.length < n) {
    const wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() - 1)
  }
  return out.reverse()
}
const bar = (t, c = 100) => ({ t, o: c, h: c + 1, l: c - 1, c, v: 10 })
const partial = () => ({ ticker: 'SIM', tf: 'D', sealed: true, partial: true, last_sealed: '2026-11-09', bars: weekdays(400, '2026-11-09').map((t) => bar(t)) })
const sealed = () => ({ ticker: 'SIM', tf: 'D', sealed: true, last_sealed: '2026-11-09', bars: weekdays(3000, '2026-11-09').map((t) => bar(t)) })
function world(answers, { pin = true, maxKeys, hidden = () => false } = {}) {
  const hist = []
  const vis = []
  const request = vi.fn(async (url) => {
    const sym = /\/api\/bars(?:-history)?\/([A-Z]+)/.exec(url)[1]
    if (url.startsWith('/api/bars-history/')) {
      if (sym === 'SIM') hist.push(Date.now())
      return { ...(answers[Math.max(0, hist.length - 1)] || answers[answers.length - 1])(), ticker: sym }
    }
    const n = Number(/[?&]bars=(\d+)/.exec(url)[1])
    return { ticker: sym, tf: 'D', bars: weekdays(Math.min(n, 3001), '2026-11-10').map((t) => bar(t)) }
  })
  const registry = createRegistry({ ctx: () => ({ nowMs: Date.now() }), ...(maxKeys ? { maxKeys } : {}) })
  const net = createNetwork({ registry, request, isHidden: () => hidden(), onVisible: (cb) => { vis.push(cb); return () => {} } })
  const key = keyOf({ sym: 'SIM', tf: 'D' })
  if (pin) registry.acquire(key)
  return { registry, net, key, hist, visible: () => vis.forEach((cb) => cb()) }
}

describe('a partial deep D/W/M answer', () => {
  it('P1 its rows are shown, the history is asked again on the backoff, and the sealed answer ends the asks', async () => {
    const w = world([partial, partial, sealed])
    w.net.fetchOnce(w.key, { depth: fullBarsFor('D') })
    await vi.advanceTimersByTimeAsync(200)
    expect(w.hist.length).toBe(1)
    const shown = w.registry.peek(w.key).bars.length
    expect(shown).toBeGreaterThan(300)                                    // the partial rows are on screen
    await vi.advanceTimersByTimeAsync(PARTIAL_RETRY_MS[0] + 100)
    expect(w.hist.length).toBe(2)                                         // asked again at 5 s
    await vi.advanceTimersByTimeAsync(PARTIAL_RETRY_MS[1] + 100)
    expect(w.hist.length).toBe(3)                                         // and at 15 s: the sealed answer
    expect(w.registry.peek(w.key).bars.length).toBeGreaterThan(2900)      // the deep history joined
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(w.hist.length).toBe(3)                                         // settled: no more asks
  })

  it('P2 a deep origin that stays down is asked every 60 s after the backoff, never faster', async () => {
    const w = world([partial])
    w.net.fetchOnce(w.key, { depth: fullBarsFor('D') })
    await vi.advanceTimersByTimeAsync(200)
    await vi.advanceTimersByTimeAsync(PARTIAL_RETRY_MS[0] + PARTIAL_RETRY_MS[1] + 200)
    expect(w.hist.length).toBe(3)
    await vi.advanceTimersByTimeAsync(4 * 60_000)
    // the 60 s step is jittered (+-15%): 3 to 4 more asks in 4 minutes, none sooner than 51 s apart
    expect(w.hist.length).toBeGreaterThanOrEqual(6)
    expect(w.hist.length).toBeLessThanOrEqual(7)
    const gaps = w.hist.slice(1).map((t, i) => t - w.hist[i])
    expect(gaps.every((g) => g >= PARTIAL_RETRY_MS[0])).toBe(true)
    expect(gaps.slice(2).every((g) => g >= 0.85 * PARTIAL_RETRY_MS[2])).toBe(true)
  })

  it('P3 control: a sealed, non-partial first answer is asked once', async () => {
    const w = world([sealed])
    w.net.fetchOnce(w.key, { depth: fullBarsFor('D') })
    await vi.advanceTimersByTimeAsync(200)
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(w.hist.length).toBe(1)
  })

  // ── review of #3050 ──
  it('P4 a key nothing holds (no chart, no pin, no waiting display) is not asked again', async () => {
    const w = world([partial], { pin: false })
    w.net.fetchOnce(w.key, { depth: fullBarsFor('D') })
    await vi.advanceTimersByTimeAsync(200)
    expect(w.hist.length).toBe(1)
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(w.hist.length).toBe(1)
  })

  it('P5 an evicted key is not asked again, and the retry never recreates its entry', async () => {
    const w = world([partial], { maxKeys: 1 })
    w.net.fetchOnce(w.key, { depth: fullBarsFor('D') })
    await vi.advanceTimersByTimeAsync(200)
    w.registry.release(w.key)
    const other = keyOf({ sym: 'OTH', tf: 'D' })
    w.registry.acquire(other)
    w.net.fetchOnce(other, { depth: fullBarsFor('D') })
    await vi.advanceTimersByTimeAsync(200)
    expect(w.registry.has(w.key)).toBe(false)                     // evicted for OTH
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(w.hist.length).toBe(1)
    expect(w.registry.has(w.key)).toBe(false)                     // never resurrected
  })

  it('P6 while the page is hidden nothing is asked; shown again, the due retry asks at once', async () => {
    let hidden = false
    const w = world([partial, sealed], { hidden: () => hidden })
    w.net.fetchOnce(w.key, { depth: fullBarsFor('D') })
    await vi.advanceTimersByTimeAsync(200)
    hidden = true
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(w.hist.length).toBe(1)
    hidden = false
    w.visible()
    await vi.advanceTimersByTimeAsync(200)
    expect(w.hist.length).toBe(2)
  })

  it('P7 stop() of the last chart leaves no retry pending', async () => {
    const w = world([partial], { pin: false })
    w.net.start(w.key, { depth: fullBarsFor('D') })
    await vi.advanceTimersByTimeAsync(200)
    const n = w.hist.length
    w.net.stop(w.key)
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(w.hist.length).toBe(n)
  })

  it('P8 after a partial answer nothing more is coming NOW: deepPending is false and a waiting display is not held 5 s', async () => {
    const w = world([partial])
    w.net.fetchOnce(w.key, { depth: fullBarsFor('D') })
    await vi.advanceTimersByTimeAsync(200)
    expect(w.net.deepPending(w.key)).toBe(false)
    let joined = null
    w.net.deepJoined(w.key).then((v) => { joined = v })
    await vi.advanceTimersByTimeAsync(0)
    expect(joined).toBe(true)                                      // at once, not after DEEP_WANT_MS
  })

  // (review of #3050, HIGH) a dropped retry forgets the partial answer: the key's next life asks its deep history again
  it('P9 partial, the retry dropped (nothing held it), then a chart opens the key: the history is asked again and joins', async () => {
    const w = world([partial, sealed], { pin: false })
    w.net.fetchOnce(w.key, { depth: fullBarsFor('D') })
    await vi.advanceTimersByTimeAsync(200)
    await vi.advanceTimersByTimeAsync(PARTIAL_RETRY_MS[0] + 100)      // the retry finds nothing holding the key: dropped
    expect(w.hist.length).toBe(1)
    w.registry.acquire(w.key)
    w.net.start(w.key, { depth: fullBarsFor('D') })                   // a chart opens it
    await vi.advanceTimersByTimeAsync(500)
    expect(w.hist.length).toBe(2)                                      // asked again
    expect(w.registry.peek(w.key).bars.length).toBeGreaterThan(2900)   // the sealed answer joined
    expect(w.net.deepPending(w.key)).toBe(false)
  })

  it('P10 partial, then evicted, then rebuilt by a tail answer: the deep history is due and asked again', async () => {
    const w = world([partial, sealed], { maxKeys: 1 })
    w.net.fetchOnce(w.key, { depth: fullBarsFor('D') })
    await vi.advanceTimersByTimeAsync(200)
    w.registry.release(w.key)
    const other = keyOf({ sym: 'OTH', tf: 'D' })
    w.registry.acquire(other)
    w.net.fetchOnce(other, { depth: fullBarsFor('D') })
    await vi.advanceTimersByTimeAsync(200)
    expect(w.registry.has(w.key)).toBe(false)
    w.registry.release(other)
    w.registry.acquire(w.key)
    w.net.fetchOnce(w.key, { depth: fullBarsFor('D') })               // rebuilt by a tail answer
    await vi.advanceTimersByTimeAsync(500)
    expect(w.hist.length).toBe(2)                                      // the deep history asked again
    expect(w.registry.peek(w.key).bars.length).toBeGreaterThan(2900)
  })

  it('P11 partial, the page hidden (the retry paused), the key unheld, then shown and opened: the history is asked again', async () => {
    let hidden = false
    const w = world([partial, sealed], { hidden: () => hidden })
    w.net.fetchOnce(w.key, { depth: fullBarsFor('D') })
    await vi.advanceTimersByTimeAsync(200)
    hidden = true
    await vi.advanceTimersByTimeAsync(PARTIAL_RETRY_MS[0] + 100)      // the retry comes due while hidden: paused
    w.registry.release(w.key)                                          // nothing holds the key any more
    hidden = false
    w.visible()
    await vi.advanceTimersByTimeAsync(200)
    expect(w.hist.length).toBe(1)                                      // not held: not asked on visible
    w.registry.acquire(w.key)
    w.net.start(w.key, { depth: fullBarsFor('D') })                   // a chart opens it later
    await vi.advanceTimersByTimeAsync(500)
    expect(w.hist.length).toBe(2)                                      // its deep history is asked again
    expect(w.registry.peek(w.key).bars.length).toBeGreaterThan(2900)
  })
})
