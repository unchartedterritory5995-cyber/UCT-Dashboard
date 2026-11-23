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
const STALE_SINCE_KEY = 'uct.deviceStore.staleSince'
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

  // (review of #2563 round 2, LOW: the 30-day rule trusts the local clock) A stale seed is deleted only when TWO off-by-
  // default loads at least 24 h apart both see it 30+ days unused, with the store not run in between: one load under a
  // clock that ran ahead is never enough.
  it('not run here for 30 days: deleted on the SECOND stale off load 24 h after the first (once, at idle after the first chart paint)', async () => {
    ranHere(30)
    const at = async (t) => {
      const src = await pageLoad({ defaultOn: false })
      const s = scheduler()
      const o = opfs()
      look(src, s, o, { now: () => t })
      await paintAndIdle(s)
      return o.root.removeEntry.mock.calls.length
    }
    expect(await at(NOW)).toBe(0)                                        // the first stale look only marks it
    expect(await at(NOW + 24 * 3_600_000 - 1)).toBe(0)
    expect(localStorage.getItem(FILES_KEY)).toBe('1')
    expect(await at(NOW + 24 * 3_600_000)).toBe(1)
    expect(localStorage.getItem(FILES_KEY)).toBe('0')
  })

  it('a clock that ran ahead for ONE load cannot delete a seed in use: the next load with the right clock clears the mark', async () => {
    ranHere(1)                                                           // the store ran yesterday
    const at = async (t) => {
      const src = await pageLoad({ defaultOn: false })
      const s = scheduler()
      const o = opfs()
      look(src, s, o, { now: () => t })
      await paintAndIdle(s)
      return o.root.removeEntry.mock.calls.length
    }
    expect(await at(NOW + 40 * DAY)).toBe(0)                             // 41 days "unused" by a wrong clock: marked only
    expect(await at(NOW + 2 * 3_600_000)).toBe(0)                        // the clock is right again: not stale, mark cleared
    expect(await at(NOW + 41 * DAY)).toBe(0)                             // wrong again a day later: a FIRST mark again
  })

  it('the store running in between (an ON load) restarts the count: a stale mark never carries over a run', async () => {
    ranHere(31)
    const off = async (t) => {
      const src = await pageLoad({ defaultOn: false })
      const s = scheduler()
      const o = opfs()
      look(src, s, o, { now: () => t })
      await paintAndIdle(s)
      return o.root.removeEntry.mock.calls.length
    }
    expect(await off(NOW)).toBe(0)
    const { createDeviceClient } = await vi.importActual('./client')    // a wide window: the store runs, and stamps
    createDeviceClient({ makeWorker: () => ({ postMessage() {}, terminate() {} }), afterPaint: () => {}, now: () => NOW + 3_600_000 }).start()
    expect(await off(NOW + 25 * 3_600_000)).toBe(0)                      // not stale any more
  })

  it('a run forgets an earlier stale mark: 30 days after it, the first stale off load marks again, it does not delete', async () => {
    ranHere(31)
    const off = async (t) => {
      const src = await pageLoad({ defaultOn: false })
      const s = scheduler()
      const o = opfs()
      look(src, s, o, { now: () => t })
      await paintAndIdle(s)
      return o.root.removeEntry.mock.calls.length
    }
    expect(await off(NOW)).toBe(0)                                       // marked
    const { createDeviceClient } = await vi.importActual('./client')
    createDeviceClient({ makeWorker: () => ({ postMessage() {}, terminate() {} }), afterPaint: () => {}, now: () => NOW + 3_600_000 }).start()
    expect(await off(NOW + 3_600_000 + 31 * DAY)).toBe(0)                // stale again, but the old mark went with the run
    expect(await off(NOW + 3_600_000 + 32 * DAY)).toBe(1)                // the new mark, confirmed a day later
  })

  it('the run stamp NEVER moves backwards within a week (a clock set back after running ahead): the newest stamp stands', async () => {
    const { createDeviceClient } = await vi.importActual('./client')
    const run = (at) => createDeviceClient({ makeWorker: () => ({ postMessage() {}, terminate() {} }), afterPaint: () => {}, now: () => at }).start()
    for (const ahead of [6 * DAY, 7 * DAY]) {
      localStorage.setItem(LAST_RUN_KEY, String(NOW + ahead))
      run(NOW)
      expect(localStorage.getItem(LAST_RUN_KEY), `${ahead / DAY} days ahead`).toBe(String(NOW + ahead))
    }
    run(NOW + 8 * DAY)
    expect(localStorage.getItem(LAST_RUN_KEY)).toBe(String(NOW + 8 * DAY))
  })

  // P-3 (a) of the review of #2537 head 107dea1ee1: a stamp written while the clock ran FAR ahead (a clock once set to
  // 2099) made the seed read "not stale" until real time passed it plus 30 days: never, for 2099. A run now treats a
  // stamp more than DEVICE_LAST_RUN_FUTURE_MAX_MS (7 days) ahead of its own clock as corrupt and overwrites it.
  it('a stamp more than 7 days ahead of the running clock is corrupt: the run overwrites it with now', async () => {
    const { createDeviceClient } = await vi.importActual('./client')
    const run = (at) => createDeviceClient({ makeWorker: () => ({ postMessage() {}, terminate() {} }), afterPaint: () => {}, now: () => at }).start()
    for (const stamp of [NOW + 7 * DAY + 1, NOW + 400 * DAY, Date.UTC(2099, 0, 1)]) {
      localStorage.setItem(LAST_RUN_KEY, String(stamp))
      run(NOW)
      expect(localStorage.getItem(LAST_RUN_KEY), new Date(stamp).toISOString()).toBe(String(NOW))
    }
    const { DEVICE_LAST_RUN_FUTURE_MAX_MS } = await import('./residue')
    expect(DEVICE_LAST_RUN_FUTURE_MAX_MS).toBe(7 * DAY)
  })

  it('so a seed stamped in 2099 and then abandoned is deleted on the usual schedule: 30 days after its last run, confirmed a day later', async () => {
    localStorage.setItem(FILES_KEY, '1')
    localStorage.setItem(LAST_RUN_KEY, String(Date.UTC(2099, 0, 1)))
    const { createDeviceClient } = await vi.importActual('./client')
    createDeviceClient({ makeWorker: () => ({ postMessage() {}, terminate() {} }), afterPaint: () => {}, now: () => NOW }).start()   // the last run here
    const off = async (at) => {
      const src = await pageLoad({ defaultOn: false })
      const s = scheduler()
      const o = opfs()
      look(src, s, o, { now: () => at })
      await paintAndIdle(s)
      return o.root.removeEntry.mock.calls.filter((c) => c[0] === DIR).length
    }
    expect(await off(NOW + 30 * DAY)).toBe(0)                            // stale: marked
    expect(await off(NOW + 31 * DAY)).toBe(1)                            // confirmed a day later: deleted
  })

  // (review of #2537 head f16a87dd98, Q-1.4: this case said "+40 days: KEPT" and pinned the residual) A stamp from the
  // future is kept only within DEVICE_LAST_RUN_FUTURE_MAX_MS (7 days): a clock set back after a run. Each stamp gets the
  // two off loads a day apart that a stale deletion needs, so "kept" means kept, not "only marked on one load".
  it('no stamp (a seed from before the stamp existed), a stamp up to 7 days ahead (a clock set back), or garbage: KEPT, never even marked', async () => {
    localStorage.setItem(FILES_KEY, '1')
    for (const stamp of [null, String(NOW + 1), String(NOW + 7 * DAY), 'garbage']) {
      if (stamp == null) localStorage.removeItem(LAST_RUN_KEY); else localStorage.setItem(LAST_RUN_KEY, stamp)
      for (const at of [NOW, NOW + DAY]) {
        const src = await pageLoad({ defaultOn: false })
        const s = scheduler()
        const o = opfs()
        look(src, s, o, { now: () => at })
        await paintAndIdle(s)
        expect(o.storage.getDirectory, `${stamp} at +${(at - NOW) / DAY} d`).not.toHaveBeenCalled()
      }
      expect(localStorage.getItem(STALE_SINCE_KEY), String(stamp)).toBeNull()
    }
    expect(localStorage.getItem(FILES_KEY)).toBe('1')
  })

  // (review of #2537 head f16a87dd98, Q-1.4, LOW) A run overwrites a stamp more than 7 days ahead of its clock, but a
  // browser whose LAST run wrote one (its clock far ahead then) and that never runs the store again had no run to do it:
  // the seed read "not stale" until real time passed the stamp. To the stale rule such a stamp is corrupt too: stale-
  // ELIGIBLE, still deleted only by two off-by-default loads at least 24 h apart.
  it('the stale rule draws the future line where the run does: up to 7 days ahead is not stale, beyond it is', async () => {
    const { deviceFilesStale, DEVICE_LAST_RUN_FUTURE_MAX_MS, DEVICE_FILES_STALE_MS } = await import('./residue')
    expect([DEVICE_LAST_RUN_FUTURE_MAX_MS, DEVICE_FILES_STALE_MS]).toEqual([7 * DAY, 30 * DAY])
    const staleWith = (stamp) => { localStorage.setItem(LAST_RUN_KEY, String(stamp)); return deviceFilesStale(NOW) }
    expect(staleWith(NOW + 1)).toBe(false)
    expect(staleWith(NOW + 7 * DAY)).toBe(false)
    expect(staleWith(NOW + 7 * DAY + 1)).toBe(true)
    expect(staleWith(Date.UTC(2099, 0, 1))).toBe(true)
    expect(staleWith(NOW - 30 * DAY + 1)).toBe(false)                  // the past side is unchanged
    expect(staleWith(NOW - 30 * DAY)).toBe(true)
    localStorage.removeItem(LAST_RUN_KEY)
    expect(deviceFilesStale(NOW)).toBe(false)
  })

  it('a stamp just past the 7-day line is MARKED on an off load (the first of the two a deletion needs)', async () => {
    localStorage.setItem(FILES_KEY, '1')
    localStorage.setItem(LAST_RUN_KEY, String(NOW + 7 * DAY + 1))
    const src = await pageLoad({ defaultOn: false })
    const s = scheduler()
    const o = opfs()
    look(src, s, o)
    await paintAndIdle(s)
    expect(o.storage.getDirectory).not.toHaveBeenCalled()                // one load never deletes
    expect(localStorage.getItem(STALE_SINCE_KEY)).toBe(String(NOW))
  })

  it('a seed whose LAST run stamped it far ahead (+40 days, 2099), then abandoned: marked, then deleted on the off load a day later', async () => {
    for (const stamp of [NOW + 40 * DAY, Date.UTC(2099, 0, 1)]) {
      localStorage.clear()
      localStorage.setItem(FILES_KEY, '1')
      localStorage.setItem(LAST_RUN_KEY, String(stamp))                  // no run comes after it to overwrite it
      const off = async (at) => {
        const src = await pageLoad({ defaultOn: false })
        const s = scheduler()
        const o = opfs()
        look(src, s, o, { now: () => at })
        await paintAndIdle(s)
        return o.root.removeEntry.mock.calls.filter((c) => c[0] === DIR).length
      }
      const label = new Date(stamp).toISOString()
      expect(await off(NOW), label).toBe(0)                              // stale-eligible: marked only
      expect(localStorage.getItem(STALE_SINCE_KEY), label).toBe(String(NOW))
      expect(await off(NOW + DAY - 1), label).toBe(0)                    // under 24 h: still only marked
      expect(await off(NOW + DAY), label).toBe(1)                        // confirmed: deleted
      expect(localStorage.getItem(FILES_KEY), label).toBe('0')
    }
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
    // (review of #2537 head 24fe13dc8f, Z-1) tab A starts BEFORE the '0' exists: one jsdom is both tabs over one
    // localStorage, and a client whose first start already reads '0' never starts at all (client.memberOff.test.js)
    localStorage.setItem(STORE_KEY, '1')
    const { createDeviceClient } = await vi.importActual('./client')     // tab A starts (its own switch read '1')
    const w = { postMessage() {}, terminate() {} }
    createDeviceClient({ makeWorker: () => w, afterPaint: () => {}, now: () => NOW }).start()
    localStorage.setItem(STORE_KEY, '0')
    const src = await pageLoad()                                         // tab B: '0', its removal scheduled
    const s = scheduler()
    const o = opfs({ fail: new DOMException('none', 'NotFoundError') }) // tab A's worker has not made the directory yet
    look(src, s, o)
    await paintAndIdle(s)                                                // B's removal settles after A started
    expect(localStorage.getItem(FILES_KEY)).toBe('0')
    w.onmessage({ data: { type: 'event', event: { type: 'gen', tf: 'D', build: 'b' } } })   // A commits a generation
    expect(localStorage.getItem(FILES_KEY)).toBe('1')
    localStorage.setItem(FILES_KEY, '0')
    w.onmessage({ data: { type: 'status', role: 'leader', supported: true, info: { tfs: { D: { build: 'b' } } } } })
    expect(localStorage.getItem(FILES_KEY)).toBe('1')                    // ...or reports a held seed
  })
})
