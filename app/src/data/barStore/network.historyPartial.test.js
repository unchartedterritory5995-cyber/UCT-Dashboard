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
function world(answers) {
  const hist = []
  const request = vi.fn(async (url) => {
    if (url.startsWith('/api/bars-history/')) { hist.push(Date.now()); return (answers[hist.length - 1] || answers[answers.length - 1])() }
    const n = Number(/[?&]bars=(\d+)/.exec(url)[1])
    return { ticker: 'SIM', tf: 'D', bars: weekdays(Math.min(n, 3001), '2026-11-10').map((t) => bar(t)) }
  })
  const registry = createRegistry({ ctx: () => ({ nowMs: Date.now() }) })
  const net = createNetwork({ registry, request, isHidden: () => false, onVisible: () => () => {} })
  const key = keyOf({ sym: 'SIM', tf: 'D' })
  registry.acquire(key)
  return { registry, net, key, hist }
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
    await vi.advanceTimersByTimeAsync(3 * 60_000 + 500)
    expect(w.hist.length).toBe(6)
    const gaps = w.hist.slice(1).map((t, i) => t - w.hist[i])
    expect(gaps.every((g) => g >= PARTIAL_RETRY_MS[0])).toBe(true)
    expect(gaps.slice(2).every((g) => g >= PARTIAL_RETRY_MS[2])).toBe(true)
  })

  it('P3 control: a sealed, non-partial first answer is asked once', async () => {
    const w = world([sealed])
    w.net.fetchOnce(w.key, { depth: fullBarsFor('D') })
    await vi.advanceTimersByTimeAsync(200)
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(w.hist.length).toBe(1)
  })
})
