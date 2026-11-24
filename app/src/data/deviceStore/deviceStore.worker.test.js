// @vitest-environment node
// THE WORKER ENTRY (deviceStore.worker.js) wires the worker's globals to workerCore. What it gives the engine (review of
// #2537 head 107dea1ee1, P-5): `codeId`, the worker chunk's own path. The build names that chunk by its content hash
// (`assets/deviceStore.worker-<hash>.js`, one self-contained file), so a deploy that changes the engine changes it, and
// the bad-pack record names it (engine.js M7): "never again for this build" never holds a fixed client to a broken
// one's failures. No new global: a worker's own location.
import { describe, it, expect, vi, afterEach } from 'vitest'

const h = vi.hoisted(() => ({ args: null }))
vi.mock('./workerCore', () => ({ createWorkerCore: (a) => { h.args = a; return { onMessage() {} } } }))
vi.mock('./io', () => ({ opfsIO: () => null }))

const hadSelf = Object.getOwnPropertyDescriptor(globalThis, 'self')
function setSelf(v) { Object.defineProperty(globalThis, 'self', { value: v, configurable: true, writable: true }) }
afterEach(() => {
  if (hadSelf) Object.defineProperty(globalThis, 'self', hadSelf); else delete globalThis.self
  h.args = null
})

async function loadEntry() {
  vi.resetModules()
  await import('./deviceStore.worker.js')
  return h.args
}

describe('deviceStore.worker.js gives the engine its code id', () => {
  it("the worker chunk's own path, without its query string", async () => {
    setSelf({ location: { href: 'https://uct.test/assets/deviceStore.worker-C_srH_n6.js?v=2', pathname: '/assets/deviceStore.worker-C_srH_n6.js' }, postMessage() {} })
    const args = await loadEntry()
    expect(args.engineOpts).toEqual({ codeId: '/assets/deviceStore.worker-C_srH_n6.js' })
  })

  it("a worker that cannot say where it was loaded from: '' (the bad-pack rule as it was)", async () => {
    setSelf({ postMessage() {} })
    expect((await loadEntry()).engineOpts).toEqual({ codeId: '' })
    setSelf({ get location() { throw new Error('no') }, postMessage() {} })
    expect((await loadEntry()).engineOpts).toEqual({ codeId: '' })
  })
})
