// @vitest-environment node
// ⭐ (2026-11-21, the cold switch) THE DEVICE STORE OPENS EVERY TIMEFRAME AT ONCE, AND A READ WAITS ONLY FOR ITS OWN.
// The engine read each timeframe's marker, pack and trailer one after another (D, 5, 60, 15, 30, 1m), and the
// worker answered a page's first read only once all six were open. Here one timeframe's files are held back
// (a slow disk): a read of another timeframe answers anyway, from the engine and through the worker.
import { describe, it, expect, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { createDeviceEngine } from './engine'
import { createWorkerCore } from './workerCore'
import { memoryIO } from './io'
import { seedPackOf, synthBars } from './testing/fixtures'

const AT_ASOF = () => Date.UTC(2026, 10, 18, 23, 0)
const DAY = 86400
const D0 = Date.UTC(2025, 0, 6) / 1000
const daily = (n, seed) => synthBars(n, { seed }).map((r, i) => ({ ...r, t: D0 + i * DAY }))
const ROWS = { AAA: daily(300, 1), BBB: daily(300, 2) }
const sha = (b) => createHash('sha256').update(b).digest('hex')

/** A disk holding a D file and a 1m file. */
async function disk() {
  const d = new Map()
  const packs = { D: seedPackOf(ROWS, { tf: 'D', build: 'b1' }), 1: seedPackOf(ROWS, { tf: '1', build: 'b1' }) }
  const eng = createDeviceEngine({ now: AT_ASOF, io: memoryIO(d), fetchFn: async (u) => new Response(packs[u]) })
  for (const tf of ['D', '1']) await eng.ingest({ tf, url: tf, bytes: packs[tf].length, sha256: sha(packs[tf]), build: 'b1' })
  eng.close()
  return d
}
/** The memory disk, with every file of timeframe `slow` held back until release(). */
function slowDisk(d, slow) {
  let release
  const gate = new Promise((r) => { release = r })
  const base = memoryIO(d)
  const io = { ...base, open: (name, o) => (name.startsWith(`${slow}.`) ? gate.then(() => base.open(name, o)) : base.open(name, o)) }
  return { io, release }
}
const settled = async (p) => { let done = false; p.then(() => { done = true }, () => { done = true }); for (let i = 0; i < 20; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 5)); return done }

describe('the device engine opens every timeframe at once', () => {
  it('a 1m read is served while D (opened FIRST in the old order) is still opening; open() waits for both', async () => {
    const { io, release } = slowDisk(await disk(), 'D')
    const eng = createDeviceEngine({ now: AT_ASOF, io, fetchFn: vi.fn() })
    const all = eng.open()
    await eng.openTf('1')
    expect(eng.read('AAA', '1')?.c?.length).toBe(300)
    expect(eng.read('AAA', 'D')).toBeNull()            // D is not open yet
    expect(await settled(all)).toBe(false)              // the whole open waits for D
    release()
    await all
    expect(eng.read('AAA', 'D')?.c?.length).toBe(300)
  })

  it('a derived timeframe (W) waits for its D', async () => {
    const { io, release } = slowDisk(await disk(), 'D')
    const eng = createDeviceEngine({ now: AT_ASOF, io, fetchFn: vi.fn() })
    const w = eng.openTf('W')
    expect(await settled(w)).toBe(false)
    release()
    await w
    expect(eng.read('AAA', 'W')?.c?.length).toBeGreaterThan(0)
  })
})

describe('the worker answers a read once ITS timeframe is open', () => {
  it('a 1m read is answered while D is still opening', async () => {
    const { io, release } = slowDisk(await disk(), 'D')
    const posted = []
    const core = createWorkerCore({
      tabId: 'T', locks: null, makeChannel: null, makeIO: async () => io, fetchFn: vi.fn(), engineOpts: { now: AT_ASOF },
      post: (m) => posted.push(m),
    })
    const read1 = core.onMessage({ id: 1, op: 'read', sym: 'AAA', tf: '1' })
    await read1
    const res = posted.find((m) => m.id === 1)
    expect(res?.ok).toBe(true)
    expect(res.res?.c?.length).toBe(300)
    release()
    await core.onMessage({ id: 2, op: 'read', sym: 'AAA', tf: 'D' })
    expect(posted.find((m) => m.id === 2)?.res?.c?.length).toBe(300)
  })
})
