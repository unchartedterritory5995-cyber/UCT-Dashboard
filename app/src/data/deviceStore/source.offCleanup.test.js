// @vitest-environment jsdom
// M9 (review of #2537), WITH THE DELETION POLICY OF THE REVIEW OF #2563 (MEDIUM-1, MEDIUM-2, LOW-1). A page whose store
// is OFF deletes a seed this browser downloaded ONLY when someone asked for that:
//   the member's own key is exactly '0'                  -> deleted (once, at idle after the first chart paint)
//   the DEVICE kill says purge (`uct_device_store=purge`) -> deleted
//   OFF BY DEFAULT (no key; after #2537 a narrow window, a metered connection)
//                                                        -> KEPT, unused; deleted only when the store has not run in
//                                                           this browser for 30 days (`uct.deviceStore.lastRun`; no
//                                                           stamp: kept)
//   the CHART-SPEED kill, the DEVICE kill (`=0`), a stored value that is not a choice -> KEPT
// Every case below sets up the REAL reason (the key, the cookie, the switch's default): nothing injects "off".
// The removal runs from the page (async OPFS, no client, no worker). A browser that never ran the store pays ONE
// document.cookie read (both kills, latched) and ONE localStorage read beyond the switch's own key: nothing scheduled,
// nothing imported, OPFS never asked.
//   'uct.deviceStore.files'  '1' the store ran here (client.start, and every generation / held-seed status after it)
//                            '0' removed (or nothing could be there); absent: never ran (unless a key is stored)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import { createDeviceEngine } from './engine'
import { memoryIO } from './io'
import { seedPackOf, synthBars } from './testing/fixtures'

const getDeviceClient = vi.fn(() => ({ start() { return this } }))
vi.mock('./client', () => ({ getDeviceClient }))

const FILES_KEY = 'uct.deviceStore.files'
const LAST_RUN_KEY = 'uct.deviceStore.lastRun'
const STORE_KEY = 'uct.deviceStore'
const DIR = 'uct-device-store'
const DAY = 86_400_000
const NOW = Date.UTC(2026, 10, 23, 15, 0)

const setCookie = (name, value) => { document.cookie = `${name}=${value}; path=/` }
const clearCookie = (name) => { document.cookie = `${name}=; max-age=0; path=/` }
const clearKills = () => { clearCookie('uct_chart_speed'); clearCookie('uct_device_store') }

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
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)) }
/** A new page load: the switch, the kills and source.js's once-per-page look evaluated afresh. `defaultOn`: what the
 *  switch's default reads on this load (#2537 computes it from the window and the connection). */
async function pageLoad({ defaultOn = null } = {}) {
  vi.resetModules()
  const src = await import('./source')
  const sw = await import('./switch')
  if (defaultOn != null) sw.__setDeviceStoreDefaultForTests(defaultOn)
  return src
}
/** The BarStore made on this page: deviceSource, the switch decides why (nothing injected but the scheduler, OPFS
 *  and the clock). */
const look = (src, s, o, extra = {}) => src.deviceSource({ afterPaint: s.afterPaint, idle: s.idle, storage: o.storage, now: () => NOW, ...extra })
/** The page reached its first chart paint and went idle. */
const paintAndIdle = async (s) => { s.paint(); s.idleNow(); await settle() }
/** A browser where the store ran (its client wrote the marker and the stamp `ranDaysAgo` days ago). */
const ranHere = (ranDaysAgo = 1) => { localStorage.setItem(FILES_KEY, '1'); localStorage.setItem(LAST_RUN_KEY, String(NOW - ranDaysAgo * DAY)) }

beforeEach(() => { localStorage.clear(); clearKills(); getDeviceClient.mockClear() })
afterEach(() => { localStorage.clear(); clearKills(); delete navigator.storage })

describe('OFF BY DEFAULT: the packs are kept, unused', () => {
  it('never ran here: one document.cookie read and one more localStorage read, nothing scheduled, loaded or asked', async () => {
    const src = await pageLoad()                                         // no key: the default (OFF today)
    const s = scheduler()
    const o = opfs()
    const reads = vi.spyOn(Storage.prototype, 'getItem')
    const jar = vi.spyOn(Document.prototype, 'cookie', 'get')
    try {
      expect(look(src, s, o)).toBeNull()
      expect(reads.mock.calls.map((c) => c[0])).toEqual([STORE_KEY, FILES_KEY])   // the switch's own key, then the marker
      expect(jar).toHaveBeenCalledTimes(1)                                           // both kills, from one read
      look(src, s, o)                                                                // the BarStore made again
      expect(reads).toHaveBeenCalledTimes(2)
      expect(jar).toHaveBeenCalledTimes(1)
    } finally { reads.mockRestore(); jar.mockRestore() }
    expect(s.painted).toHaveLength(0)
    await settle()
    expect(o.storage.getDirectory).not.toHaveBeenCalled()
    expect(getDeviceClient).not.toHaveBeenCalled()
  })

  it('the store ran here 29 days ago (a narrow window today, a metered connection): KEPT', async () => {
    ranHere(29)
    const src = await pageLoad({ defaultOn: false })
    const s = scheduler()
    const o = opfs()
    expect(look(src, s, o)).toBeNull()
    await paintAndIdle(s)
    expect(o.storage.getDirectory).not.toHaveBeenCalled()
    expect(localStorage.getItem(FILES_KEY)).toBe('1')
  })

  it('not run here for 30 days: the stale seed is deleted (once, at idle after the first chart paint)', async () => {
    ranHere(30)
    const src = await pageLoad({ defaultOn: false })
    const s = scheduler()
    const o = opfs()
    look(src, s, o)
    expect(s.painted).toHaveLength(1)
    await paintAndIdle(s)
    expect(o.root.removeEntry).toHaveBeenCalledWith(DIR, { recursive: true })
    expect(localStorage.getItem(FILES_KEY)).toBe('0')
  })

  it('no stamp (a seed from before the stamp existed), or a stamp from the future (a clock set back): KEPT', async () => {
    localStorage.setItem(FILES_KEY, '1')
    for (const stamp of [null, String(NOW + 40 * DAY), 'garbage']) {
      if (stamp == null) localStorage.removeItem(LAST_RUN_KEY); else localStorage.setItem(LAST_RUN_KEY, stamp)
      const src = await pageLoad({ defaultOn: false })
      const s = scheduler()
      const o = opfs()
      look(src, s, o)
      await paintAndIdle(s)
      expect(o.storage.getDirectory, String(stamp)).not.toHaveBeenCalled()
    }
    expect(localStorage.getItem(FILES_KEY)).toBe('1')
  })

  it('a stored value that is not a choice ("off") is OFF and keeps the packs, even long unused', async () => {
    ranHere(90)
    localStorage.setItem(STORE_KEY, 'off')
    const src = await pageLoad({ defaultOn: true })
    const s = scheduler()
    const o = opfs()
    expect(look(src, s, o)).toBeNull()
    await paintAndIdle(s)
    expect(o.storage.getDirectory).not.toHaveBeenCalled()
  })
})

describe("the member's own '0' deletes", () => {
  it("'0': deleted once, at idle after the first chart paint, without the client or a worker; then never again", async () => {
    ranHere(1)
    localStorage.setItem(STORE_KEY, '0')
    const src = await pageLoad({ defaultOn: true })
    const s = scheduler()
    const o = opfs()
    expect(look(src, s, o)).toBeNull()
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
    const next = await pageLoad()
    look(next, s, o)
    expect(s.painted).toHaveLength(0)                                    // removed: nothing more to do
  })

  it("'0' from a tester before the marker existed: cleaned the same way; no OPFS here: nothing to delete", async () => {
    localStorage.setItem(STORE_KEY, '0')
    let src = await pageLoad()
    const s = scheduler()
    const o = opfs()
    look(src, s, o)
    await paintAndIdle(s)
    expect(o.root.removeEntry).toHaveBeenCalledWith(DIR, { recursive: true })
    expect(localStorage.getItem(FILES_KEY)).toBe('0')
    localStorage.removeItem(FILES_KEY)
    src = await pageLoad()
    look(src, s, { storage: null })
    await paintAndIdle(s)
    expect(localStorage.getItem(FILES_KEY)).toBe('0')
  })
})

describe('the server kills: only PURGE deletes', () => {
  it('the CHART-SPEED kill turns the store off and KEEPS the packs (over a member\'s 1)', async () => {
    ranHere(90)
    localStorage.setItem(STORE_KEY, '1')
    setCookie('uct_chart_speed', '0')
    const src = await pageLoad()
    const s = scheduler()
    const o = opfs()
    expect(look(src, s, o)).toBeNull()
    await paintAndIdle(s)
    expect(o.storage.getDirectory).not.toHaveBeenCalled()
    expect(localStorage.getItem(FILES_KEY)).toBe('1')
  })

  it('the DEVICE kill (uct_device_store=0) turns the store off and KEEPS the packs', async () => {
    ranHere(90)
    localStorage.setItem(STORE_KEY, '1')
    setCookie('uct_device_store', '0')
    const src = await pageLoad()
    const s = scheduler()
    const o = opfs()
    expect(look(src, s, o)).toBeNull()
    await paintAndIdle(s)
    expect(o.storage.getDirectory).not.toHaveBeenCalled()
  })

  it('the DEVICE PURGE (uct_device_store=purge) turns the store off and DELETES, through navigator.storage', async () => {
    ranHere(1)
    localStorage.setItem(STORE_KEY, '1')
    setCookie('uct_device_store', 'purge')
    const o = opfs()
    Object.defineProperty(navigator, 'storage', { value: o.storage, configurable: true, writable: true })
    const src = await pageLoad()
    const s = scheduler()
    expect(src.deviceSource({ afterPaint: s.afterPaint, idle: s.idle, now: () => NOW })).toBeNull()   // the production storage
    await paintAndIdle(s)
    expect(o.root.removeEntry).toHaveBeenCalledWith(DIR, { recursive: true })
    expect(localStorage.getItem(FILES_KEY)).toBe('0')
  })
})

describe('ON: nothing is deleted, and the client marks and stamps', () => {
  it('ON by default (no key): no removal; starting the client marks that files may exist and stamps the run', async () => {
    ranHere(90)
    const src = await pageLoad({ defaultOn: true })
    const s = scheduler()
    const o = opfs()
    expect(look(src, s, o)).not.toBeNull()
    expect(s.painted).toHaveLength(0)
    localStorage.clear()
    const { createDeviceClient } = await vi.importActual('./client')
    const w = { postMessage() {}, terminate() {} }
    createDeviceClient({ makeWorker: () => w, afterPaint: () => {}, now: () => NOW }).start()
    expect(localStorage.getItem(FILES_KEY)).toBe('1')
    expect(localStorage.getItem(LAST_RUN_KEY)).toBe(String(NOW))
  })
})

describe('races with another tab', () => {
  /** OPFS over the memoryIO disk the engine writes: removing the store's directory is refused while any of its files
   *  is held open (what Chromium and Firefox do for a sync access handle under it; INFERRED for the browsers), and
   *  clears the disk otherwise. */
  function opfsOver(disk) {
    const root = {
      removeEntry: vi.fn(async (name, opts) => {
        if (name !== DIR || !opts?.recursive) throw new DOMException('unexpected', 'InvalidModificationError')
        for (const f of disk.values()) if (f.open) throw new DOMException('a file is in use', 'NoModificationAllowedError')
        if (!disk.size) throw new DOMException('none', 'NotFoundError')
        disk.clear()
      }),
    }
    return { storage: { getDirectory: vi.fn(async () => root) }, root }
  }
  const DAY_S = 86400
  const D0 = Date.UTC(2025, 0, 6) / 1000
  const rows = synthBars(120, { seed: 5 }).map((r, i) => ({ ...r, t: D0 + i * DAY_S }))

  it("ANOTHER TAB'S LEADER HOLDS THE SEED: the removal is refused and the seed keeps serving; once it closes, the next load removes it", async () => {
    // tab A (the store on, the leader): a real engine holding the D pack open, as it does while it serves
    const disk = new Map()
    const pack = seedPackOf({ AAA: rows })
    const body = () => new ReadableStream({ start(c) { c.enqueue(pack); c.close() } })
    const leader = createDeviceEngine({ io: memoryIO(disk), now: () => NOW, fetchFn: async () => ({ ok: true, status: 200, headers: { get: () => null }, body: body() }) })
    expect(await leader.ingest({ tf: 'D', url: 'u', bytes: pack.length, sha256: createHash('sha256').update(pack).digest('hex'), build: '20261119T0131Z' })).toMatchObject({ status: 'ingested' })
    ranHere(1)
    localStorage.setItem(STORE_KEY, '0')                                 // tab B loads after the member's '0'
    const o = opfsOver(disk)
    let src = await pageLoad()
    const s = scheduler()
    look(src, s, o)
    await paintAndIdle(s)
    expect(o.root.removeEntry).toHaveBeenCalledTimes(1)
    expect(disk.has('D.1.pack')).toBe(true)
    expect(localStorage.getItem(FILES_KEY)).toBe('1')                    // still there: try again on a later load
    look(src, s, o)
    expect(s.painted).toHaveLength(0)                                    // ...never twice on one page
    leader.close()                                                       // tab A closed
    src = await pageLoad()
    look(src, s, o)
    await paintAndIdle(s)
    expect(o.root.removeEntry).toHaveBeenCalledTimes(2)
    expect(disk.size).toBe(0)
    expect(localStorage.getItem(FILES_KEY)).toBe('0')
  })

  it("LOW-1: an off tab's removal settling after an on tab started does not leave the marker saying 'nothing here'", async () => {
    ranHere(1)
    localStorage.setItem(STORE_KEY, '0')
    const src = await pageLoad()                                         // tab B: '0', its removal scheduled
    const s = scheduler()
    const o = opfs({ fail: new DOMException('none', 'NotFoundError') }) // tab A's worker has not made the directory yet
    look(src, s, o)
    const { createDeviceClient } = await vi.importActual('./client')     // tab A starts (its own switch read '1')
    const w = { postMessage() {}, terminate() {} }
    createDeviceClient({ makeWorker: () => w, afterPaint: () => {}, now: () => NOW }).start()
    await paintAndIdle(s)                                                // B's removal settles after A started
    expect(localStorage.getItem(FILES_KEY)).toBe('0')
    w.onmessage({ data: { type: 'event', event: { type: 'gen', tf: 'D', build: 'b' } } })   // A commits a generation
    expect(localStorage.getItem(FILES_KEY)).toBe('1')
    localStorage.setItem(FILES_KEY, '0')
    w.onmessage({ data: { type: 'status', role: 'leader', supported: true, info: { tfs: { D: { build: 'b' } } } } })
    expect(localStorage.getItem(FILES_KEY)).toBe('1')                    // ...or reports a held seed
  })
})
