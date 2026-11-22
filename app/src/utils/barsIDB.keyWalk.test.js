// idbCountKeys is the Bars Pack presence probe, and each of the three packs runs it on every load.
// It used one unbounded getAllKeys() over 45-47k keys: 1.1-3.0 s measured, three times over, and
// IndexedDB work queues behind it. A chart's idbGet then outlasted StockChart's 600 ms first-paint
// wait and threw away a full local cache. The probe now reads in small pieces and yields between
// them, so a chart read can get through.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Just enough IndexedDB to read keys: sorted string keys, ranges and counts, async completion.
function installFakeIDB(allKeys, { failOnCall = 0 } = {}) {
  const log = []
  const sorted = [...allKeys].sort()
  let calls = 0
  const req = (fn) => {
    const r = {}
    setTimeout(() => {
      try { r.result = fn(); r.onsuccess?.({ target: r }) }
      catch (e) { r.error = e; r.onerror?.({ target: r }) }
    }, 0)
    return r
  }
  const store = {
    getAllKeys(query, count) {
      calls += 1
      log.push({ type: 'read', query, count })
      if (failOnCall && calls === failOnCall) return req(() => { throw new Error('read failed') })
      let keys = sorted
      if (query) keys = keys.filter((k) => (query.lowerOpen ? k > query.lower : k >= query.lower))
      if (count) keys = keys.slice(0, count)
      return req(() => keys)
    },
  }
  const db = {
    objectStoreNames: { contains: () => true },
    transaction: () => ({ objectStore: () => store }),
  }
  vi.stubGlobal('indexedDB', {
    open: () => {
      const r = {}
      setTimeout(() => { r.result = db; r.onsuccess?.({ target: r }) }, 0)
      return r
    },
  })
  vi.stubGlobal('IDBKeyRange', { lowerBound: (lower, lowerOpen) => ({ lower, lowerOpen }) })
  return { log, reads: () => log.filter((l) => l.type === 'read') }
}

const keysFor = (n, tf) => Array.from({ length: n }, (_, i) => `S${String(i).padStart(5, '0')}_${tf}`)

let idbCountKeys
beforeEach(async () => {
  vi.resetModules()
  ;({ idbCountKeys } = await import('./barsIDB'))
})
afterEach(() => { vi.unstubAllGlobals() })

describe('idbCountKeys reads in pieces', () => {
  it('counts exactly what one big read would have counted, per suffix', async () => {
    installFakeIDB([...keysFor(2500, 'D'), ...keysFor(1700, 'W'), ...keysFor(900, '5')])
    expect(await idbCountKeys('_D')).toBe(2500)
    expect(await idbCountKeys('_W')).toBe(1700)
    expect(await idbCountKeys('_5')).toBe(900)
    expect(await idbCountKeys('')).toBe(5100)
    expect(await idbCountKeys()).toBe(5100)
  })

  it('never issues an unbounded read', async () => {
    const f = installFakeIDB(keysFor(4500, 'D'))
    await idbCountKeys('_D')
    expect(f.reads().length).toBeGreaterThan(1)
    for (const r of f.reads()) expect(r.count, 'every read must carry a bound').toBeGreaterThan(0)
    expect(Math.max(...f.reads().map((r) => r.count))).toBeLessThanOrEqual(1000)
  })

  it('resumes strictly after the last key, so nothing is counted twice or skipped', async () => {
    const f = installFakeIDB(keysFor(2000, 'D'))
    expect(await idbCountKeys('_D')).toBe(2000)
    const [first, second] = f.reads()
    expect(first.query).toBeUndefined()
    expect(second.query).toEqual({ lower: 'S00999_D', lowerOpen: true })
  })

  it('lets a macrotask run between pieces, which is what a chart read needs', async () => {
    const f = installFakeIDB(keysFor(3000, 'D'))
    const order = []
    const pending = idbCountKeys('_D')
    const watch = setInterval(() => {
      if (f.reads().length !== order.filter((o) => o === 'read').length) order.push('read')
      else order.push('gap')
    }, 0)
    await pending
    clearInterval(watch)
    const firstRead = order.indexOf('read')
    const secondRead = order.indexOf('read', firstRead + 1)
    expect(secondRead, 'the walk made a second read').toBeGreaterThan(firstRead)
    expect(order.slice(firstRead + 1, secondRead), 'no macrotask ran between two pieces').toContain('gap')
  })

  it('three packs asking at once share one walk', async () => {
    // Under one piece of keys, so one shared walk is exactly one read and three walks are three.
    const f = installFakeIDB(keysFor(500, 'D'))
    const results = await Promise.all([idbCountKeys('_D'), idbCountKeys('_5'), idbCountKeys('_D')])
    expect(results).toEqual([500, 0, 500])
    expect(f.reads().length).toBe(1)
  })

  it('a later probe after the walk finished reads fresh, not a remembered answer', async () => {
    const f = installFakeIDB(keysFor(1200, 'D'))
    await idbCountKeys('_D')
    const n = f.reads().length
    await idbCountKeys('_D')
    expect(f.reads().length).toBe(n * 2)
  })

  it('a failed walk rejects, so the caller can treat the probe as unanswered, not as an empty store', async () => {
    installFakeIDB(keysFor(2500, 'D'), { failOnCall: 2 })
    await expect(idbCountKeys('_D')).rejects.toThrow('read failed')
  })

  it('through the real caller, a failed walk means "assume present", so nothing re-ingests', async () => {
    installFakeIDB(keysFor(2500, 'D'), { failOnCall: 2 })
    const { _packDataPresent } = await import('../lib/barsPackClient')
    await expect(_packDataPresent({ presenceSuffix: '_D' }, { ticker_count: 1000 })).resolves.toBe(true)
  })

  it('every pack sharing a failed walk sees the failure, and none is told the store is empty', async () => {
    installFakeIDB(keysFor(2500, 'D'), { failOnCall: 2 })
    const results = await Promise.allSettled([idbCountKeys('_D'), idbCountKeys('_5')])
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected'])
  })

  it('still resolves 0 when the database cannot open', async () => {
    vi.stubGlobal('indexedDB', { open: () => { throw new Error('no idb') } })
    await expect(idbCountKeys('_D')).resolves.toBe(0)
  })
})
