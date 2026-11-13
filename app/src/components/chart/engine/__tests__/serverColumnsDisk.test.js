// app/src/components/chart/engine/__tests__/serverColumnsDisk.test.js
//
// ─── WHAT THIS BROWSER LAST HAD FOR A SYMBOL: THE STORE ITSELF ───────────────
//
// The store keeps landed server-lane envelopes across page loads so the first chart of a
// page load (and every pop-out) has something to draw at once. These rails pin what it
// keeps, what it refuses to hand back, its bounds, and that it fails to "nothing".
// How the lane uses what it reads (provisional, always re-asked) is `serverLaneProvisional.test.js`.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  DISK_LOGIC_VERSION, DISK_MAX_AGE_MS, DISK_MAX_CELLS, DISK_ENTRY_MAX_CELLS, DISK_QUEUE_MAX, DISK_FLUSH_CHUNK, DISK_OFF_KEY,
  readDisk, writeDisk, forgetDisk, flushDiskNow, diskStats, memoryDiskBackend,
  __setDiskBackendForTests, __setDiskLimitsForTests,
} from '../serverColumnsDisk'
import { columnsFromWire } from '../serverCompute'

const NOW = 1_800_000_000_000
const wire = (v, n = 3) => ({
  times: Array.from({ length: n }, (_, i) => 20260102 + i),
  columns: { a: Array.from({ length: n }, (_, i) => (i === 0 ? null : v + i)), b: Array.from({ length: n }, (_, i) => v * 2 + i) },
  payload: { state: 'ok', benchmark: { resolved: 'SPY' } },
  rev: 3,
})
const parsed = (v, n) => columnsFromWire(wire(v, n))
const cellsOf = (n) => n * 3 // times + two columns

let store
beforeEach(() => {
  store = memoryDiskBackend()
  __setDiskBackendForTests(store)
  __setDiskLimitsForTests()
  try { localStorage.removeItem(DISK_OFF_KEY) } catch { /* no storage */ }
})
afterEach(() => {
  __setDiskBackendForTests(null)
  __setDiskLimitsForTests()
  try { localStorage.removeItem(DISK_OFF_KEY) } catch { /* no storage */ }
})

describe('what is written is what is read back', () => {
  it('⭐ an envelope comes back cell for cell, in the shape the lane\'s parser produces', async () => {
    const sent = parsed(5)
    expect(writeDisk('k1', 'NVDA', 'D', sent, NOW)).toBe(true)
    expect(store.rows.size, 'a write is queued, not done inside the caller').toBe(0)
    await flushDiskNow(NOW)
    const got = await readDisk('NVDA', 'D', NOW + 1000)
    expect(got.length).toBe(1)
    expect(got[0].key).toBe('k1')
    expect(got[0].savedAt).toBe(NOW)
    expect(got[0].parsed).toEqual(sent)
    expect(Array.isArray(got[0].parsed.times)).toBe(true)
    expect(got[0].parsed.columns.a).toBeInstanceOf(Float64Array)
    expect(Number.isNaN(got[0].parsed.columns.a[0]), 'a gap stays a gap').toBe(true)
    expect(Object.keys(got[0].parsed)).toEqual(Object.keys(sent))
  })

  it('an envelope with no payload and no rev comes back with neither key', async () => {
    const bare = columnsFromWire({ times: [1, 2], columns: { a: [1, 2] } })
    writeDisk('k', 'NVDA', 'D', bare, NOW)
    await flushDiskNow(NOW)
    const [got] = await readDisk('NVDA', 'D', NOW)
    expect(got.parsed).toEqual(bare)
    expect('payload' in got.parsed).toBe(false)
    expect('rev' in got.parsed).toBe(false)
  })

  it('a read is for ONE symbol and ONE timeframe', async () => {
    writeDisk('nvda-d-1', 'NVDA', 'D', parsed(1), NOW)
    writeDisk('nvda-d-2', 'NVDA', 'D', parsed(2), NOW)
    writeDisk('nvda-w', 'NVDA', 'W', parsed(3), NOW)
    writeDisk('aapl-d', 'AAPL', 'D', parsed(4), NOW)
    writeDisk('nvda-5', 'NVDA', 5, parsed(6), NOW)
    await flushDiskNow(NOW)
    expect((await readDisk('NVDA', 'D', NOW)).map((r) => r.key).sort()).toEqual(['nvda-d-1', 'nvda-d-2'])
    expect((await readDisk('NVDA', 'W', NOW)).map((r) => r.key)).toEqual(['nvda-w'])
    expect((await readDisk('NVDA', '5', NOW)).map((r) => r.key), 'a numeric timeframe and its string are one').toEqual(['nvda-5'])
    expect(await readDisk('MSFT', 'D', NOW)).toEqual([])
    expect(await readDisk('', 'D', NOW)).toEqual([])
  })

  it('the newest write for a key wins, and the store holds copies', async () => {
    const first = parsed(1)
    writeDisk('k', 'NVDA', 'D', first, NOW)
    writeDisk('k', 'NVDA', 'D', parsed(9), NOW + 5)
    await flushDiskNow(NOW + 5)
    expect(store.rows.size).toBe(1)
    const [got] = await readDisk('NVDA', 'D', NOW + 10)
    expect(got.parsed).toEqual(parsed(9))
    got.parsed.columns.b[1] = -1                          // a reader scribbling on its copy
    expect((await readDisk('NVDA', 'D', NOW + 10))[0].parsed).toEqual(parsed(9))
  })
})

describe('⛔ what is not worth keeping is not written', () => {
  it('nothing positional, malformed, or too large: refused at the door', async () => {
    const good = parsed(1)
    expect(writeDisk('', 'NVDA', 'D', good, NOW)).toBe(false)
    expect(writeDisk('k', 'NVDA', 'D', null, NOW)).toBe(false)
    expect(writeDisk('k', 'NVDA', 'D', columnsFromWire({}), NOW), 'no columns: nothing to draw early').toBe(false)
    expect(writeDisk('k', 'NVDA', 'D', { times: [], columns: { a: new Float64Array(0) } }, NOW)).toBe(false)
    expect(writeDisk('k', 'NVDA', 'D', { times: [1, 2], columns: {} }, NOW)).toBe(false)
    expect(writeDisk('k', 'NVDA', 'D', { times: [1, 2], columns: { a: new Float64Array(3) } }, NOW), 'a column off its times').toBe(false)
    expect(writeDisk('k', 'NVDA', 'D', { times: [1, 2], columns: { a: [1, 2] } }, NOW), 'not the parser\'s column type').toBe(false)
    __setDiskLimitsForTests({ entryMaxCells: cellsOf(3) - 1 })
    expect(writeDisk('k', 'NVDA', 'D', good, NOW), 'larger than one record may be').toBe(false)
    __setDiskLimitsForTests({ entryMaxCells: cellsOf(3) })
    expect(writeDisk('k', 'NVDA', 'D', good, NOW)).toBe(true)
    await flushDiskNow(NOW)
    expect(store.rows.size).toBe(1)
  })

  it('the real bounds are the documented ones', () => {
    expect(DISK_MAX_AGE_MS).toBe(5 * 24 * 60 * 60_000)
    expect(DISK_MAX_CELLS).toBe(8_000_000)
    expect(DISK_ENTRY_MAX_CELLS).toBe(400_000)
    expect(DISK_QUEUE_MAX).toBe(400)
    expect(DISK_FLUSH_CHUNK).toBe(6)
  })

  it('⭐ a write happens when the page is idle, a few records at a time, oldest first', async () => {
    vi.useFakeTimers()
    try {
      const idle = []
      vi.stubGlobal('requestIdleCallback', (cb, opts) => { idle.push({ cb, opts }) })
      const writes = []
      const write = store.write
      store.write = async (records) => { writes.push(records.map((r) => r.key)); return write(records) }
      const total = DISK_FLUSH_CHUNK * 2 + 1
      for (let i = 0; i < total; i++) writeDisk(`k${i}`, 'NVDA', 'D', parsed(i), NOW + i)
      expect(idle.length, 'one idle callback for any number of queued writes').toBe(1)
      expect(idle[0].opts, 'and it may not wait for ever').toEqual({ timeout: 4000 })
      expect(writes).toEqual([])
      for (let slice = 0; slice < 3; slice++) {
        idle.shift().cb()
        for (let k = 0; k < 30; k++) await Promise.resolve()
      }
      expect(writes.map((w) => w.length)).toEqual([DISK_FLUSH_CHUNK, DISK_FLUSH_CHUNK, 1])
      expect(writes[0][0]).toBe('k0')
      expect(writes[2]).toEqual([`k${total - 1}`])
      expect(idle.length, 'nothing left: no further callback').toBe(0)
      expect(store.rows.size).toBe(total)
    } finally {
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })

  it('a flush asked for by hand writes EVERYTHING queued, however many slices that is', async () => {
    const total = DISK_FLUSH_CHUNK * 3 + 2
    for (let i = 0; i < total; i++) writeDisk(`k${i}`, 'NVDA', 'D', parsed(i), NOW + i)
    await flushDiskNow(NOW + total)
    expect(store.rows.size).toBe(total)
    expect(diskStats().queued).toBe(0)
    expect(diskStats().written).toBe(total)
  })

  it('without an idle callback (an older browser) the write still happens, a little later', async () => {
    vi.useFakeTimers()
    try {
      vi.stubGlobal('requestIdleCallback', undefined)
      writeDisk('k', 'NVDA', 'D', parsed(1), NOW)
      await vi.advanceTimersByTimeAsync(799)
      expect(store.rows.size).toBe(0)
      await vi.advanceTimersByTimeAsync(1)
      for (let k = 0; k < 30; k++) await Promise.resolve()
      expect(store.rows.size).toBe(1)
    } finally {
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })

  it('at most the queue limit waits to be written; the oldest waiting one is dropped', async () => {
    __setDiskLimitsForTests({ queueMax: 3 })
    for (let i = 0; i < 5; i++) writeDisk(`k${i}`, 'NVDA', 'D', parsed(i), NOW + i)
    expect(diskStats().queued).toBe(3)
    expect(diskStats().dropped).toBe(2)
    await flushDiskNow(NOW + 5)
    expect([...store.rows.keys()].sort()).toEqual(['k2', 'k3', 'k4'])
  })
})

describe('⛔ what is not safe to believe is not read', () => {
  const put = async (over = {}) => {
    writeDisk('k', 'NVDA', 'D', parsed(1), NOW)
    await flushDiskNow(NOW)
    Object.assign(store.rows.get('k'), over)
  }

  it('a record older than the age limit is gone, not read; one inside it is read', async () => {
    await put()
    expect((await readDisk('NVDA', 'D', NOW + DISK_MAX_AGE_MS)).length).toBe(1)
    expect(await readDisk('NVDA', 'D', NOW + DISK_MAX_AGE_MS + 1)).toEqual([])
    await Promise.resolve()
    expect(store.rows.has('k'), 'an expired record is removed, not re-read forever').toBe(false)
  })

  it('a record dated in the future (a clock that moved) is not read', async () => {
    await put({ savedAt: NOW + 61_000 })
    expect(await readDisk('NVDA', 'D', NOW)).toEqual([])
    await put({ savedAt: NOW + 59_000 })
    expect((await readDisk('NVDA', 'D', NOW)).length, 'a minute of skew is tolerated').toBe(1)
  })

  it('a record written by another logic version is not read', async () => {
    await put({ logic: DISK_LOGIC_VERSION + 1 })
    expect(await readDisk('NVDA', 'D', NOW)).toEqual([])
    expect(store.rows.has('k')).toBe(false)
  })

  it('a record that is not the parser\'s shape is not read', async () => {
    for (const bad of [
      { times: [20260102, 20260103, 20260104] },                                   // a plain array is not what was written
      { times: new Float64Array(0) },
      { columns: { a: new Float64Array(2), b: new Float64Array(3) } },             // a column off its times
      { columns: { a: [1, 2, 3], b: new Float64Array(3) } },
      { columns: {} },
      { columns: null },
      { savedAt: 'yesterday' },
    ]) {
      await put(bad)
      expect(await readDisk('NVDA', 'D', NOW), JSON.stringify(Object.keys(bad))).toEqual([])
    }
  })

  it('one bad record does not hide a good one beside it', async () => {
    writeDisk('good', 'NVDA', 'D', parsed(1), NOW)
    writeDisk('bad', 'NVDA', 'D', parsed(2), NOW)
    await flushDiskNow(NOW)
    store.rows.get('bad').logic = -1
    expect((await readDisk('NVDA', 'D', NOW)).map((r) => r.key)).toEqual(['good'])
  })
})

describe('bounded: the oldest records go first', () => {
  it('⭐ past the cell limit the oldest are removed until it fits, and no younger one is touched', async () => {
    __setDiskLimitsForTests({ maxCells: cellsOf(3) * 3 })
    for (let i = 0; i < 3; i++) writeDisk(`k${i}`, 'NVDA', 'D', parsed(i), NOW + i)
    await flushDiskNow(NOW + 3)
    expect(store.rows.size, 'exactly at the limit: nothing goes').toBe(3)
    writeDisk('k3', 'AAPL', 'D', parsed(3), NOW + 10)
    writeDisk('k4', 'AAPL', 'D', parsed(4), NOW + 11)
    await flushDiskNow(NOW + 11)
    expect([...store.rows.keys()].sort()).toEqual(['k2', 'k3', 'k4'])
    expect(diskStats().evicted).toBe(2)
    // "oldest" is by when a record was SAVED, not by where the store happens to list it
    writeDisk('late-but-old', 'MSFT', 'D', parsed(5), NOW - 1000)
    await flushDiskNow(NOW + 12)
    expect([...store.rows.keys()].sort(), 'the record saved earliest goes, though it was written last').toEqual(['k2', 'k3', 'k4'])
  })

  it('expired records are removed at a write even when the store fits', async () => {
    writeDisk('old', 'NVDA', 'D', parsed(1), NOW)
    await flushDiskNow(NOW)
    writeDisk('new', 'AAPL', 'D', parsed(2), NOW + DISK_MAX_AGE_MS + 5)
    await flushDiskNow(NOW + DISK_MAX_AGE_MS + 5)
    expect([...store.rows.keys()]).toEqual(['new'])
  })

  it('forgetting removes the record and a write still waiting for it', async () => {
    writeDisk('a', 'NVDA', 'D', parsed(1), NOW)
    await flushDiskNow(NOW)
    writeDisk('b', 'NVDA', 'D', parsed(2), NOW)
    await forgetDisk(['a', 'b'])
    await flushDiskNow(NOW)
    expect(store.rows.size).toBe(0)
    await forgetDisk('nothing-there')                      // a single key, and one that is absent
    await forgetDisk([])
  })
})

describe('⛔ it fails to "nothing"', () => {
  it('switched off in this browser: no read, no write', async () => {
    writeDisk('k', 'NVDA', 'D', parsed(1), NOW)
    await flushDiskNow(NOW)
    localStorage.setItem(DISK_OFF_KEY, '1')
    expect(await readDisk('NVDA', 'D', NOW)).toEqual([])
    expect(writeDisk('k2', 'NVDA', 'D', parsed(2), NOW)).toBe(false)
    expect(diskStats().off).toBe(true)
    localStorage.setItem(DISK_OFF_KEY, '0')
    expect((await readDisk('NVDA', 'D', NOW)).length, 'only the exact value switches it off').toBe(1)
  })

  it('no store at all (a test, a browser without one): reads are empty and writes are dropped', async () => {
    __setDiskBackendForTests(null)
    expect(await readDisk('NVDA', 'D', NOW)).toEqual([])
    expect(writeDisk('k', 'NVDA', 'D', parsed(1), NOW)).toBe(false)
    await flushDiskNow(NOW)
    await forgetDisk('k')
    expect(diskStats().off).toBe(true)
  })

  it('a store that throws on everything never rejects and never throws', async () => {
    const boom = () => { throw new Error('disk full') }
    __setDiskBackendForTests({ read: boom, write: boom, remove: boom, sizes: boom })
    expect(await readDisk('NVDA', 'D', NOW)).toEqual([])
    expect(writeDisk('k', 'NVDA', 'D', parsed(1), NOW)).toBe(true)
    await expect(flushDiskNow(NOW)).resolves.toBeUndefined()
    await expect(forgetDisk('k')).resolves.toBeUndefined()
    const rejecting = { read: () => Promise.reject(new Error('x')), write: () => Promise.reject(new Error('x')), remove: () => Promise.reject(new Error('x')), sizes: () => Promise.reject(new Error('x')) }
    __setDiskBackendForTests(rejecting)
    expect(await readDisk('NVDA', 'D', NOW)).toEqual([])
    writeDisk('k', 'NVDA', 'D', parsed(1), NOW)
    await expect(flushDiskNow(NOW)).resolves.toBeUndefined()
  })

  it('a store that answers rubbish is read as empty', async () => {
    __setDiskBackendForTests({ read: async () => 'nope', write: async () => {}, remove: async () => {}, sizes: async () => null })
    expect(await readDisk('NVDA', 'D', NOW)).toEqual([])
    __setDiskBackendForTests({ read: async () => [null, 7, {}, { key: 5 }], write: async () => {}, remove: async () => {}, sizes: async () => [] })
    expect(await readDisk('NVDA', 'D', NOW)).toEqual([])
  })
})
