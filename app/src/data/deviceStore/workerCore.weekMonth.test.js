// @vitest-environment node
// P2-L2 (review of #2549): THE WORKER ANSWERS NO W OR M READ. #2549 stopped the page asking the device for W / M
// (tfs.SERVED_TFS), but the leader's worker still derived and served them to whichever tab asked: a tab still running
// the previous client (the deploy overlap) asks the NEW leader. The leader now refuses a timeframe the device does not
// serve, for a read, a many-read and the diagnostics' why ('tf'), and still serves D.
import { describe, it, expect, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { createWorkerCore } from './workerCore'
import { createDeviceEngine } from './engine'
import { memoryIO } from './io'
import { seedPackOf, synthBars } from './testing/fixtures'

const AT_ASOF = () => Date.UTC(2026, 10, 18, 23, 0)          // 18:00 ET on the pack's as-of day
const D0 = Date.UTC(2025, 0, 6) / 1000
const daily = (n, seed) => synthBars(n, { seed }).map((r, i) => ({ ...r, t: D0 + i * 86400 }))

async function disk() {
  const pack = seedPackOf({ AAA: daily(350, 1), BBB: daily(350, 2) }, { build: '20261119T2200Z' })
  const d = new Map()
  const eng = createDeviceEngine({ now: AT_ASOF, io: memoryIO(d), fetchFn: async () => new Response(pack) })
  await eng.ingest({ tf: 'D', url: 'u', bytes: pack.length, sha256: createHash('sha256').update(pack).digest('hex'), build: '20261119T2200Z' })
  eng.close()
  return d
}

describe('P2-L2 the leader worker never serves W or M', () => {
  it('a read, a many-read and the diagnostics of W / M: null, nulls and "tf"; D is still served', async () => {
    const d = await disk()
    const posted = []
    const core = createWorkerCore({
      tabId: 'T', locks: null, makeChannel: null, makeIO: async () => memoryIO(d), fetchFn: vi.fn(),
      engineOpts: { now: AT_ASOF }, post: (m) => posted.push(m),
    })
    let id = 0
    const ask = async (msg) => { const my = ++id; await core.onMessage({ ...msg, id: my }); return posted.find((p) => p.id === my) }
    await core.whenReady()
    const dRead = await ask({ op: 'read', sym: 'AAA', tf: 'D' })
    expect(dRead.ok).toBe(true)
    expect(dRead.res.t.length).toBe(350)
    for (const tf of ['W', 'M']) {
      expect((await ask({ op: 'read', sym: 'AAA', tf })).res, tf).toBeNull()
      expect((await ask({ op: 'readMany', syms: ['AAA', 'BBB'], tf })).res, tf).toEqual([null, null])
      expect((await ask({ op: 'why', sym: 'AAA', tf })).res, tf).toBe('tf')
    }
    expect((await ask({ op: 'why', sym: 'AAA', tf: 'D' })).res).toBe('seed-only:no-overlay')
    expect((await ask({ op: 'readMany', syms: ['AAA', 'BBB'], tf: 'D' })).res.map((c) => c?.t.length)).toEqual([350, 350])
    core.close()
  })
})
