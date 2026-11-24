// @vitest-environment jsdom
// THE MEMBER ON THE DEFAULT (review of #2537 head 107dea1ee1, P-2 (i), P-6 and P-7 MEDIUM 2). Default ON makes every
// desktop member with NO 'uct.deviceStore' key a store member. Such a member runs the store exactly as a tester's '1'
// does, through the real doors (the switch deciding from a desktop screen, source.deviceSource, the real client over a
// stand-in Worker), with two differences, both by design:
//   diagnostics OFF   (diag.deviceDiagOn: the switch records are for a tester, review of #2537 L2)
//   navigator.storage.persist() NEVER ASKED. Firefox shows the member a permission prompt for it, with no context; a
//                     member on the default never chose the store. Without it the browser may evict the packs under disk
//                     pressure, and the cost is one download: the leader finds no generation on its next open and the
//                     next ingest downloads the full packs again (engine.js `_scan` / `_openTf`, and #2563's room check
//                     and backoffs still apply). A tester's '1' is asked once, as before (client.persist.test.js).
// ⛔ Out of reach here: the desktop app's pop-out windows. They are portals sharing the opener's JS context, switch
// decision, client and worker (pages/charts/popout/PopoutWindow.jsx); only the desktop shell can show that.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const KEY = 'uct.deviceStore'
const PERSIST_MARKER = 'uct.storage.persistAsked'
const realMatchMedia = window.matchMedia
const realWorker = globalThis.Worker

/** A mouse desktop: a wide window whose primary pointer is fine and hovers (what the desktop default reads). */
function mouseDesktop() {
  const feature = (f) => {
    const m = /^\(\s*([a-z-]+)\s*:\s*([a-z0-9-]+)\s*\)$/.exec(f.trim())
    if (m && m[1] === 'min-width') return 1440 >= Number(m[2].replace(/px$/, ''))
    if (m && m[1] === 'max-width') return 1440 <= Number(m[2].replace(/px$/, ''))
    if (m && m[1] === 'pointer') return m[2] === 'fine'
    if (m && m[1] === 'hover') return m[2] === 'hover'
    throw new Error(`cannot evaluate ${f}`)
  }
  window.matchMedia = (q) => ({ matches: String(q).split(/\band\b/).map(feature).every(Boolean), media: q, addEventListener() {}, removeEventListener() {} })
}

/** Every Worker this page constructs: records what the client sends it; the test plays the worker's side. */
let workers = []
class StandInWorker {
  constructor(url, opts) { this.url = String(url); this.opts = opts; this.posted = []; workers.push(this) }
  postMessage(m) { this.posted.push(m) }
  terminate() { this.terminated = true }
}

function storageSpy() {
  return { persisted: vi.fn(async () => false), persist: vi.fn(async () => true), estimate: vi.fn(async () => ({ quota: 1e10, usage: 0 })) }
}
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)) }

/** One page load of a desktop member: the BarStore asks deviceSource, the chart asks for one device copy, and the
 *  leader worker reports a held seed and a new generation. Returns what happened. */
async function desktopPageLoad({ key = null } = {}) {
  localStorage.clear()
  if (key != null) localStorage.setItem(KEY, key)
  workers = []
  const storage = storageSpy()
  Object.defineProperty(navigator, 'storage', { value: storage, configurable: true })
  vi.resetModules()
  const sw = await import('./switch')
  const src = await import('./source')
  const diag = await import('./diag')
  const out = { sw, storage, enabled: sw.deviceStoreEnabled(), offReason: sw.deviceStoreOffReason(), diag: diag.deviceDiagOn() }
  const ds = src.deviceSource()
  out.source = ds != null
  await settle()
  out.workersBeforeRead = workers.length
  const read = ds?.read('AAPL', 'D')
  await settle()
  out.workers = workers.length
  const w = workers[0]
  w?.onmessage?.({ data: { type: 'status', role: 'leader', supported: true, info: { tfs: { D: { build: 'b' } } } } })
  w?.onmessage?.({ data: { type: 'event', event: { type: 'gen', tf: '5', build: 'b' } } })
  await settle()
  out.posted = (w?.posted || []).map((m) => [m.op, m.sym ?? null, m.tf ?? null])
  const client = (await import('./client')).getDeviceClient()
  out.status = client.status().storage
  out.files = localStorage.getItem('uct.deviceStore.files')
  out.stamped = localStorage.getItem('uct.deviceStore.lastRun') != null
  out.marker = localStorage.getItem(PERSIST_MARKER)
  client.shutdown()
  await read
  return out
}

beforeEach(() => { mouseDesktop(); globalThis.Worker = StandInWorker; document.cookie = 'uct_chart_speed=; max-age=0; path=/'; document.cookie = 'uct_device_store=; max-age=0; path=/' })
afterEach(() => { window.matchMedia = realMatchMedia; globalThis.Worker = realWorker; delete navigator.storage; localStorage.clear() })

describe('a desktop member on the default (no key) runs the store as a tester\'s 1 does', () => {
  it('the store is ON, and nothing of it loads before the first device read', async () => {
    const p = await desktopPageLoad()
    expect([p.enabled, p.offReason, p.source]).toEqual([true, null, true])
    expect(p.workersBeforeRead).toBe(0)
  })

  it("the first device read starts the client and ONE worker, sending exactly what a tester's '1' sends; the run is marked and stamped", async () => {
    const def = await desktopPageLoad()
    const one = await desktopPageLoad({ key: '1' })
    expect(def.workers).toBe(1)
    expect(def.posted).toEqual(one.posted)
    expect(def.posted).toContainEqual(['read', 'AAPL', 'D'])
    expect([def.files, def.stamped]).toEqual(['1', true])
    expect([one.files, one.stamped]).toEqual(['1', true])
  })

  it("diagnostics are OFF on the default and ON for a tester's '1'", async () => {
    expect((await desktopPageLoad()).diag).toBe(false)
    expect((await desktopPageLoad({ key: '1' })).diag).toBe(true)
  })

  it('navigator.storage.persist() is NEVER asked on the default: no storage call, no marker, and the status says why', async () => {
    const p = await desktopPageLoad()
    expect(p.storage.persist).not.toHaveBeenCalled()
    expect(p.storage.persisted).not.toHaveBeenCalled()
    expect(p.marker).toBeNull()                       // a member who later sets '1' is asked then, once
    expect(p.status).toMatchObject({ asked: false, skipped: 'default' })
  })

  it("CONTROL: a tester's hand-set '1' is asked once, as before", async () => {
    const p = await desktopPageLoad({ key: '1' })
    expect(p.storage.persist).toHaveBeenCalledTimes(1)
    expect(p.marker).toBe('1')
    expect(p.status).toMatchObject({ asked: true, granted: true })
  })
})
