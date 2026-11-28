// ⭐ (review of #3038, HIGH) historyComplete on D/W/M: the deep history is WHOLE only after a SEALED, NON-PARTIAL answer
// joined. The web's shallow fallback (the worker's deep origin did not answer) answers sealed: true AND partial: true;
// its rows are shown, but the key's history is not proved whole.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRegistry } from './registry'
import { createNetwork } from './network'
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
function world(history) {
  const request = vi.fn(async (url) => {
    if (url.startsWith('/api/bars-history/')) return history()
    const n = Number(/[?&]bars=(\d+)/.exec(url)[1])
    return { ticker: 'SIM', tf: 'D', bars: weekdays(Math.min(n, 3001), '2026-11-10').map((t) => bar(t)) }
  })
  const registry = createRegistry({ ctx: () => ({ nowMs: Date.now() }) })
  const net = createNetwork({ registry, request, isHidden: () => false, onVisible: () => () => {} })
  const key = keyOf({ sym: 'SIM', tf: 'D' })
  registry.acquire(key)
  return { registry, net, key }
}
async function loaded(history) {
  const w = world(history)
  w.net.fetchOnce(w.key, { depth: fullBarsFor('D') })
  await vi.advanceTimersByTimeAsync(200)
  return w
}

describe('historyComplete on D/W/M', () => {
  it('D1 a sealed, non-partial deep answer joined: complete', async () => {
    const w = await loaded(() => ({ ticker: 'SIM', tf: 'D', sealed: true, last_sealed: '2026-11-09', bars: weekdays(3000, '2026-11-09').map((t) => bar(t)) }))
    expect(w.registry.peek(w.key).bars.length).toBeGreaterThan(2000)
    expect(w.net.historyComplete(w.key)).toBe(true)
  })
  it('D2 the shallow fallback (sealed AND partial): its rows are shown, the history is NOT complete', async () => {
    const w = await loaded(() => ({ ticker: 'SIM', tf: 'D', sealed: true, partial: true, last_sealed: '2026-11-09', bars: weekdays(400, '2026-11-09').map((t) => bar(t)) }))
    expect(w.registry.peek(w.key).bars.length).toBeGreaterThan(300)
    expect(w.net.historyComplete(w.key)).toBe(false)
  })
  it('D3 an unsealed answer (the split off for the key): not complete', async () => {
    const w = await loaded(() => ({ ticker: 'SIM', tf: 'D', sealed: false, bars: [] }))
    expect(w.net.historyComplete(w.key)).toBe(false)
  })
  it('D4 a deep answer that failed: not complete', async () => {
    const w = await loaded(() => { throw Object.assign(new Error('edge down'), { status: 502 }) })
    expect(w.net.historyComplete(w.key)).toBe(false)
  })
})
