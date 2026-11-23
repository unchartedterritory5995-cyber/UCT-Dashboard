// L5 (review of #2537): navigator.storage.persist() IS ASKED AT MOST ONCE PER BROWSER PROFILE. Firefox asks the member
// (a permission prompt); a member who refused or dismissed it must not be asked again on every pack run, every page
// load, or by the device store's client after the bars pack asked. ONE marker for the app ('uct.storage.persistAsked',
// lib/storagePersist.js), shared by both callers: once asked, whatever the answer, never again; already persistent,
// never asked.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { idbImportPack, idbApplyDelta, idbCountKeys } = vi.hoisted(() => ({
  idbImportPack: vi.fn(), idbApplyDelta: vi.fn(), idbCountKeys: vi.fn(),
}))
vi.mock('../utils/barsIDB', () => ({ idbImportPack, idbApplyDelta, idbCountKeys }))

const CFG = { base: '/api/barspack', ingestBatchSize: 60, ingestYield: true, versionKey: 'barspack.ptest.version', seedKey: 'barspack.ptest.seed' }

function storageWith({ persisted = false, grant = false } = {}) {
  return { persisted: vi.fn(async () => persisted), persist: vi.fn(async () => grant) }
}
const useStorage = (s) => { Object.defineProperty(navigator, 'storage', { value: s, configurable: true, writable: true }) }
/** A new page load: the pack client (and whatever it loads) evaluated afresh; localStorage is the browser's. */
async function pageLoad() { vi.resetModules(); return import('./barsPackClient') }
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)) }

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem(CFG.versionKey, '2026-11-13')
  // a newer version with a delta that is not there yet: the run ends unstamped, so every run is a real pack run
  globalThis.fetch = vi.fn(async (url) => (String(url).endsWith('/manifest')
    ? { ok: true, json: async () => ({ version: '2026-11-14', shards: [{ idx: 0 }], delta: true }) }
    : { ok: false, json: async () => ({}) }))
})
afterEach(() => { localStorage.clear(); delete navigator.storage })

describe('persistent storage: asked once per browser profile', () => {
  it('the bars pack asks ONCE: not on its next run, not on the next page load (a refusal or a dismissal stands)', async () => {
    const s = storageWith({ grant: false })
    useStorage(s)
    let m = await pageLoad()
    await m._run(CFG)
    await m._run(CFG)
    expect(s.persist).toHaveBeenCalledTimes(1)
    m = await pageLoad()
    await m._run(CFG)
    expect(s.persist).toHaveBeenCalledTimes(1)
  })

  it('already persistent: never asked at all', async () => {
    const s = storageWith({ persisted: true })
    useStorage(s)
    const m = await pageLoad()
    await m._run(CFG)
    expect(s.persisted).toHaveBeenCalled()
    expect(s.persist).not.toHaveBeenCalled()
  })

  it("ONE marker for the app: the device store's client never asks after the bars pack did", async () => {
    const s = storageWith({ grant: false })
    useStorage(s)
    const m = await pageLoad()
    await m._run(CFG)
    expect(s.persist).toHaveBeenCalledTimes(1)
    const { createDeviceClient } = await import('../data/deviceStore/client')
    const w = { postMessage() {}, terminate() {} }
    const c = createDeviceClient({ makeWorker: () => w, afterPaint: () => {}, storage: s })
    c.start()
    w.onmessage({ data: { type: 'status', role: 'leader', supported: true, info: { tfs: { D: { build: 'b' } } } } })
    await settle()
    expect(s.persist).toHaveBeenCalledTimes(1)
    c.dispose()
  })

  it('...and the bars pack never asks after the device store did', async () => {
    const s = storageWith({ grant: false })
    useStorage(s)
    vi.resetModules()
    const { createDeviceClient } = await import('../data/deviceStore/client')
    const w = { postMessage() {}, terminate() {} }
    const c = createDeviceClient({ makeWorker: () => w, afterPaint: () => {}, storage: s })
    c.start()
    w.onmessage({ data: { type: 'event', event: { type: 'gen', tf: 'D', build: 'b' } } })
    await settle()
    expect(s.persist).toHaveBeenCalledTimes(1)
    expect(c.status().storage).toMatchObject({ asked: true, granted: false })
    c.dispose()
    const m = await import('./barsPackClient')
    await m._run(CFG)
    expect(s.persist).toHaveBeenCalledTimes(1)
  })
})
