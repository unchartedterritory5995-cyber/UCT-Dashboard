// @vitest-environment jsdom
// L5 (review of #2537): THE DEVICE STORE ASKS navigator.storage.persist() AT MOST ONCE PER BROWSER PROFILE. Firefox
// asks the member (a permission prompt); the client used to ask on every page load while the origin was not
// persistent, so a member who refused or dismissed the prompt was asked again on each load. Now one marker in
// localStorage ('uct.storage.persistAsked', lib/storagePersist.js): once asked, whatever the answer, never again;
// already persistent, never asked.
// ⛔ The bars pack's own ask (lib/barsPackClient.js `_run`) is NOT changed here: it runs for every member with the store
// off, in first-open code, and the brief allows a store-off member no change but the seed-cleanup check. See the PR.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const MARKER = 'uct.storage.persistAsked'

function storageWith({ persisted = false, grant = false, throws = false } = {}) {
  return {
    persisted: vi.fn(async () => persisted),
    persist: vi.fn(async () => { if (throws) throw new Error('not allowed here'); return grant }),
  }
}
/** A new page load: the client and the persist helper evaluated afresh; localStorage is the browser's. */
async function pageLoad() { vi.resetModules(); return import('./client') }
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)) }
/** A client on this page whose worker reports a held seed (what makes it ask). */
async function clientHoldingASeed(m, storage) {
  const w = { postMessage() {}, terminate() {} }
  const c = m.createDeviceClient({ makeWorker: () => w, afterPaint: () => {}, storage })
  c.start()
  w.onmessage({ data: { type: 'status', role: 'leader', supported: true, info: { tfs: { D: { build: 'b' } } } } })
  w.onmessage({ data: { type: 'event', event: { type: 'gen', tf: '5', build: 'b' } } })
  await settle()
  return c
}

beforeEach(() => { localStorage.clear() })
afterEach(() => { localStorage.clear() })

describe('persistent storage: the device store asks once per browser profile', () => {
  it('a refusal (or a dismissal) stands: the next page loads never ask again', async () => {
    const s = storageWith({ grant: false })
    const c1 = await clientHoldingASeed(await pageLoad(), s)
    expect(s.persist).toHaveBeenCalledTimes(1)
    expect(c1.status().storage).toMatchObject({ asked: true, persisted: false, granted: false })
    expect(localStorage.getItem(MARKER)).toBe('1')
    const c2 = await clientHoldingASeed(await pageLoad(), s)
    await clientHoldingASeed(await pageLoad(), s)
    expect(s.persist).toHaveBeenCalledTimes(1)
    expect(c2.status().storage).toMatchObject({ asked: false, persisted: false })
  })

  it('an ask that threw is not repeated either; a granted one is never needed again', async () => {
    const broken = storageWith({ throws: true })
    const c = await clientHoldingASeed(await pageLoad(), broken)
    expect(c.status().storage.error).toMatch(/not allowed/)
    await clientHoldingASeed(await pageLoad(), broken)
    expect(broken.persist).toHaveBeenCalledTimes(1)
  })

  it('CONTROL: already persistent, never asked and nothing marked; a browser never asked is asked', async () => {
    const already = storageWith({ persisted: true })
    const c = await clientHoldingASeed(await pageLoad(), already)
    expect(already.persist).not.toHaveBeenCalled()
    expect(c.status().storage.persisted).toBe(true)
    expect(localStorage.getItem(MARKER)).toBeNull()
    const fresh = storageWith({ grant: true })
    const c2 = await clientHoldingASeed(await pageLoad(), fresh)
    expect(fresh.persist).toHaveBeenCalledTimes(1)
    expect(c2.status().storage).toMatchObject({ asked: true, persisted: true, granted: true })
  })
})
