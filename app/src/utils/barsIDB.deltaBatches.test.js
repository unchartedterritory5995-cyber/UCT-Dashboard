// The daily delta writes in small batches and gives the page a turn between them (2026-11-14).
//
// Measured on production: 154 readwrite transactions of 250 series each, ~0.4 s apiece, back to
// back for 36 s; every chart read over 100 ms in that scan waited behind one (up to 273 ms). A read
// waits for at most the one transaction in progress, so the batch size is its worst wait.
//
// A small in-memory IndexedDB stands in for the browser's (no dependency): it records every
// transaction and runs requests asynchronously, completing a transaction once its requests settle.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

function fakeIndexedDB() {
  const data = new Map()
  const log = { tx: [], order: [] }
  const later = (fn) => Promise.resolve().then(fn)
  const db = {
    objectStoreNames: { contains: () => true },
    transaction(store, mode) {
      const rec = { mode, gets: 0, puts: 0, done: false }
      log.tx.push(rec)
      log.order.push(`tx${log.tx.length - 1}:${mode}`)
      let pending = 0
      const tx = { oncomplete: null, onerror: null, onabort: null }
      const settle = () => { if (--pending === 0) later(() => { rec.done = true; tx.oncomplete && tx.oncomplete() }) }
      const req = (fn) => {
        pending++
        const r = { result: undefined, onsuccess: null, onerror: null }
        later(() => { r.result = fn(); r.onsuccess && r.onsuccess({ target: r }); settle() })
        return r
      }
      tx.objectStore = () => ({
        get: (k) => { rec.gets++; return req(() => data.get(k)) },
        put: (v) => { rec.puts++; return req(() => { data.set(v.key, v); return v.key }) },
      })
      return tx
    },
    close() {},
  }
  return {
    data, log,
    api: {
      open: () => {
        const r = { onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null }
        later(() => r.onsuccess && r.onsuccess({ target: { result: db } }))
        return r
      },
    },
  }
}

let fake
let mod
beforeEach(async () => {
  vi.resetModules()
  fake = fakeIndexedDB()
  vi.stubGlobal('indexedDB', fake.api)
  mod = await import('./barsIDB')
})
afterEach(() => { vi.unstubAllGlobals() })

const V = () => mod._CACHE_LOGIC_VERSION
const seed = (n) => {
  for (let i = 0; i < n; i++) {
    const key = `S${i}_D`
    fake.data.set(key, { key, v: V(), bars: [{ t: '2026-11-12', c: 1 }, { t: '2026-11-13', c: 2 }], lastT: '2026-11-13', savedAt: 1 })
  }
}
const delta = (n) => Array.from({ length: n }, (_, i) => ({ sym: `S${i}`, tf: 'D', bars: [{ t: '2026-11-14', c: 3 }] }))

describe('idbApplyDelta', () => {
  it('writes in batches of DELTA_BATCH_SIZE, never 250', async () => {
    expect(mod.DELTA_BATCH_SIZE).toBeLessThanOrEqual(30)
    seed(260)
    const res = await mod.idbApplyDelta(delta(260))
    expect(res).toEqual({ updated: 260, skipped: 0, aborted: false })
    const rw = fake.log.tx.filter((t) => t.mode === 'readwrite')
    expect(rw).toHaveLength(Math.ceil(260 / mod.DELTA_BATCH_SIZE))
    expect(Math.max(...rw.map((t) => t.puts))).toBeLessThanOrEqual(mod.DELTA_BATCH_SIZE)
    // what is written is the same merge as before: every series gains the new bar
    expect(fake.data.get('S0_D').bars.map((b) => b.t)).toEqual(['2026-11-12', '2026-11-13', '2026-11-14'])
    expect(fake.data.get('S259_D').lastT).toBe('2026-11-14')
  })

  it('gives the page a turn between batches: work queued during a batch runs before the next one starts', async () => {
    seed(3 * mod.DELTA_BATCH_SIZE)
    const seen = []
    const real = fake.api
    // every time a readwrite transaction starts, queue a macrotask; it must run before the NEXT one starts
    const db0 = await new Promise((r) => { const q = real.open(); q.onsuccess = (e) => r(e.target.result) })
    const tx0 = db0.transaction.bind(db0)
    db0.transaction = (s, m) => {
      seen.push(`start ${m}`)
      setTimeout(() => seen.push('page turn'), 0)
      return tx0(s, m)
    }
    vi.stubGlobal('indexedDB', { open: () => { const r = {}; Promise.resolve().then(() => r.onsuccess({ target: { result: db0 } })); return r } })
    vi.resetModules()
    mod = await import('./barsIDB')
    await mod.idbApplyDelta(delta(3 * mod.DELTA_BATCH_SIZE))
    const starts = seen.map((s, i) => (s.startsWith('start') ? i : -1)).filter((i) => i >= 0)
    expect(starts).toHaveLength(3)
    for (let k = 1; k < starts.length; k++) {
      expect(seen.slice(starts[k - 1] + 1, starts[k])).toContain('page turn')
    }
  })

  it('CONTROL: at the old size it is one long transaction', async () => {
    seed(260)
    await mod.idbApplyDelta(delta(260), { batchSize: 250 })
    const rw = fake.log.tx.filter((t) => t.mode === 'readwrite')
    expect(rw.map((t) => t.puts)).toEqual([250, 10])
  })

  it('still skips a series it never seeded', async () => {
    seed(10)
    const res = await mod.idbApplyDelta([...delta(10), { sym: 'NEW', tf: 'D', bars: [{ t: '2026-11-14', c: 9 }] }])
    expect(res).toEqual({ updated: 10, skipped: 1, aborted: false })
    expect(fake.data.has('NEW_D')).toBe(false)
  })
})
