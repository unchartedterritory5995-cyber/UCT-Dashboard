// @vitest-environment jsdom
// M9 (review of #2537): WHEN THE STORE IS OFF FOR THIS BROWSER (the member's '0', a kill, or the default), A SEED IT
// DOWNLOADED BEFORE IS DELETED FROM OPFS: once, at idle after the page's first chart paint, from the page (the async
// OPFS API: no worker, no client). A browser that never ran the store pays ONE cheap check (two localStorage reads
// when the BarStore is created, deviceSource) and nothing else: nothing scheduled, nothing imported, OPFS never asked.
//   'uct.deviceStore.files'  '1' the store ran here (client.start wrote it: its worker may have written files)
//                            '0' cleaned (or nothing could be there)
//                            absent: never ran, unless a switch key is stored (a tester from before this marker)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const getDeviceClient = vi.fn(() => ({ start() { return this } }))
vi.mock('./client', () => ({ getDeviceClient }))

const FILES_KEY = 'uct.deviceStore.files'
const STORE_KEY = 'uct.deviceStore'
const DIR = 'uct-device-store'

function opfs({ fail = null } = {}) {
  const root = { removeEntry: vi.fn(async () => { if (fail) throw fail }) }
  return { storage: { getDirectory: vi.fn(async () => root) }, root }
}
function scheduler() {
  const s = { painted: [], idled: [] }
  s.afterPaint = (fn) => { s.painted.push(fn) }
  s.idle = (fn) => { s.idled.push(fn) }
  s.paint = () => { for (const fn of s.painted.splice(0)) fn() }
  s.idleNow = () => { for (const fn of s.idled.splice(0)) fn() }
  return s
}
/** A new page load: source.js (and its once-per-page check) evaluated afresh. */
async function pageLoad() { vi.resetModules(); return import('./source') }
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)) }
const off = (s, o) => ({ enabled: () => false, afterPaint: s.afterPaint, idle: s.idle, storage: o.storage })

beforeEach(() => { localStorage.clear(); getDeviceClient.mockClear() })
afterEach(() => { localStorage.clear() })

describe('M9 the seed of a browser the store is off for', () => {
  it('never ran here: ONE look at two keys, nothing scheduled, nothing loaded, OPFS never asked', async () => {
    const src = await pageLoad()
    const s = scheduler()
    const o = opfs()
    const reads = vi.spyOn(Storage.prototype, 'getItem')
    expect(src.deviceSource(off(s, o))).toBeNull()
    expect(reads.mock.calls.map((c) => c[0])).toEqual([FILES_KEY, STORE_KEY])
    expect(s.painted).toHaveLength(0)
    expect(src.deviceSource(off(s, o))).toBeNull()                       // the BarStore made again: no second look
    expect(reads).toHaveBeenCalledTimes(2)
    reads.mockRestore()
    await settle()
    expect(o.storage.getDirectory).not.toHaveBeenCalled()
    expect(getDeviceClient).not.toHaveBeenCalled()
  })

  it('the store ran here ("1"): deleted once, at idle after the first chart paint, without the client or a worker', async () => {
    localStorage.setItem(FILES_KEY, '1')
    const src = await pageLoad()
    const s = scheduler()
    const o = opfs()
    expect(src.deviceSource(off(s, o))).toBeNull()
    expect(s.painted).toHaveLength(1)
    await settle()
    expect(o.storage.getDirectory).not.toHaveBeenCalled()                // not before the first chart paint...
    s.paint()
    expect(s.idled).toHaveLength(1)
    await settle()
    expect(o.storage.getDirectory).not.toHaveBeenCalled()                // ...and not before idle
    s.idleNow()
    await settle()
    expect(o.root.removeEntry).toHaveBeenCalledTimes(1)
    expect(o.root.removeEntry).toHaveBeenCalledWith(DIR, { recursive: true })
    expect(localStorage.getItem(FILES_KEY)).toBe('0')
    expect(getDeviceClient).not.toHaveBeenCalled()
    src.deviceSource(off(s, o))                                           // the same page: never twice
    expect(s.painted).toHaveLength(0)
    const next = await pageLoad()                                        // the next load: clean, nothing to do
    next.deviceSource(off(s, o))
    expect(s.painted).toHaveLength(0)
  })

  it("the member's own '0' from before this marker existed (a tester): cleaned the same way, then never again", async () => {
    localStorage.setItem(STORE_KEY, '0')
    const src = await pageLoad()
    const s = scheduler()
    const o = opfs()
    src.deviceSource(off(s, o))
    s.paint(); s.idleNow()
    await settle()
    expect(o.root.removeEntry).toHaveBeenCalledWith(DIR, { recursive: true })
    expect(localStorage.getItem(FILES_KEY)).toBe('0')
    const next = await pageLoad()
    next.deviceSource(off(s, o))
    expect(s.painted).toHaveLength(0)
  })

  it('no directory (NotFoundError) is clean; a removal another tab blocks is tried again on the NEXT load only', async () => {
    localStorage.setItem(FILES_KEY, '1')
    let src = await pageLoad()
    const s = scheduler()
    const busy = opfs({ fail: new DOMException('in use', 'NoModificationAllowedError') })
    src.deviceSource(off(s, busy))
    s.paint(); s.idleNow()
    await settle()
    expect(busy.root.removeEntry).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(FILES_KEY)).toBe('1')                    // still there: try again later
    src.deviceSource(off(s, busy))
    expect(s.painted).toHaveLength(0)                                      // ...not on this page
    src = await pageLoad()
    const gone = opfs({ fail: new DOMException('none', 'NotFoundError') })
    src.deviceSource(off(s, gone))
    s.paint(); s.idleNow()
    await settle()
    expect(gone.root.removeEntry).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(FILES_KEY)).toBe('0')
  })

  it('a browser without OPFS has nothing to delete', async () => {
    localStorage.setItem(FILES_KEY, '1')
    const src = await pageLoad()
    const s = scheduler()
    src.deviceSource({ enabled: () => false, afterPaint: s.afterPaint, idle: s.idle, storage: null })
    s.paint(); s.idleNow()
    await settle()
    expect(localStorage.getItem(FILES_KEY)).toBe('0')
  })

  it('ON: nothing is deleted; and starting the client is what marks that files may exist', async () => {
    localStorage.setItem(FILES_KEY, '1')
    const src = await pageLoad()
    const s = scheduler()
    const o = opfs()
    expect(src.deviceSource({ enabled: () => true, afterPaint: s.afterPaint, idle: s.idle, storage: o.storage })).not.toBeNull()
    expect(s.painted).toHaveLength(0)
    localStorage.clear()
    const { createDeviceClient } = await vi.importActual('./client')
    const w = { postMessage() {}, terminate() {} }
    createDeviceClient({ makeWorker: () => w, afterPaint: () => {} }).start()
    expect(localStorage.getItem(FILES_KEY)).toBe('1')
  })
})
