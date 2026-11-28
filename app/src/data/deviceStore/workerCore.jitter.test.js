// @vitest-environment node
// THE DOWNLOAD START IS JITTERED (owner ruling 2026-11-28, the full-depth daily pack; workerCore DOWNLOAD_JITTER_MS):
// when the manifest names a build this browser does not hold, the leader waits a random 0..jitterMs before the first
// pack / delta byte, so 500 members opening the app together never start their downloads together. A manifest that
// names nothing new waits for nothing; reads keep serving the held generation through the wait; a seed that serves
// starts the minute feed at once instead of waiting the jitter out.
import { describe, it, expect, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { createWorkerCore } from './workerCore'
import { memoryIO } from './io'
import { seedPackOf, synthBars } from './testing/fixtures'

const sha = (b) => createHash('sha256').update(b).digest('hex')
const MANIFEST = 'https://x.test/seed/latest.json'
const settle = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)) }

const fiveMinThrough = (day, n, seed) => {
  const [y, m, d] = day.split('-').map(Number)
  const last = Date.UTC(y, m - 1, d, 20, 55) / 1000
  return synthBars(n, { step: 300, seed, t0: last - (n - 1) * 300 })
}
const packFor = (asof, build) => seedPackOf({ AAA: fiveMinThrough(asof, 400, 3) }, { tf: '5', build, asof })
const manifestOf = (build, pack) => ({ v: 1, kind: 'ffseed', build, tfs: { '5': { url: `${build}/5.ffs`, bytes: pack.length, sha256: sha(pack) } } })

function edgeOf(site) {
  const fetchFn = vi.fn(async (url) => {
    const u = String(url)
    if (u === MANIFEST) return new Response(JSON.stringify(site.manifest))
    const name = u.slice('https://x.test/seed/'.length)
    return site.packs[name] ? new Response(site.packs[name]) : new Response('nope', { status: 404 })
  })
  fetchFn.packs = () => fetchFn.mock.calls.filter((c) => String(c[0]) !== MANIFEST).length
  return fetchFn
}

/** A leader whose jitter waits are captured (resolved by hand), its random draw `r`. */
function tab(disk, fetchFn, { r = 0.5, jitterMs = 600_000, clock } = {}) {
  const posted = []
  const waits = []
  const core = createWorkerCore({
    tabId: 'A', locks: null, makeChannel: null, makeIO: async () => memoryIO(disk), fetchFn,
    post: (m) => posted.push(m), now: () => clock.t, engineOpts: { now: () => clock.t },
    jitterMs, random: () => r,
    wait: (ms) => new Promise((resolve) => { waits.push({ ms, resolve }) }),
  })
  const ask = async (msg) => {
    const id = Math.random()
    await core.onMessage({ ...msg, id })
    return posted.find((m) => m.id === id)?.res
  }
  return { core, ask, waits }
}

describe('the download start is jittered (DOWNLOAD_JITTER_MS)', () => {
  it('a build this browser does not hold: no pack byte is asked until a random 0..jitterMs wait has passed', async () => {
    const clock = { t: Date.UTC(2026, 10, 30, 14, 25) }
    const p1 = packFor('2026-11-27', '20261128T0131Z')
    const edge = edgeOf({ manifest: manifestOf('20261128T0131Z', p1), packs: { '20261128T0131Z/5.ffs': p1 } })
    const A = tab(new Map(), edge, { r: 0.37, clock })
    expect(await A.ask({ op: 'ingest', manifestUrl: MANIFEST })).toEqual({ status: 'started' })
    await settle()
    expect(A.waits.map((w) => w.ms)).toEqual([Math.floor(0.37 * 600_000)])
    expect(edge.packs()).toBe(0)                                     // nothing downloads during the wait
    expect((await A.ask({ op: 'info' })).jitter).toEqual({ waiting: true, lastMs: 222_000 })
    A.waits[0].resolve()
    await A.core.ingesting()
    expect(edge.packs()).toBe(1)
    expect((await A.ask({ op: 'info' })).tfs['5'].build).toBe('20261128T0131Z')
  })

  it('a manifest naming only builds already held waits for nothing (the 25-minute re-check costs no wait)', async () => {
    const clock = { t: Date.UTC(2026, 10, 30, 14, 25) }
    const p1 = packFor('2026-11-27', '20261128T0131Z')
    const disk = new Map()
    const edge = edgeOf({ manifest: manifestOf('20261128T0131Z', p1), packs: { '20261128T0131Z/5.ffs': p1 } })
    const A = tab(disk, edge, { r: 0.9, clock })
    await A.ask({ op: 'ingest', manifestUrl: MANIFEST })
    await settle()
    A.waits[0].resolve()
    await A.core.ingesting()
    A.core.close()                                                  // the page is gone (its file handles with it)
    // a later page load: the same build is held
    const B = tab(disk, edge, { r: 0.9, clock })
    await B.ask({ op: 'ingest', manifestUrl: MANIFEST })
    await B.core.ingesting()
    expect(B.waits).toEqual([])
    expect(edge.packs()).toBe(1)
  })

  it('the draw is bounded: 0 waits nothing, a broken random reads as 0, never past jitterMs', async () => {
    const clock = { t: Date.UTC(2026, 10, 30, 14, 25) }
    const p1 = packFor('2026-11-27', '20261128T0131Z')
    for (const [r, want] of [[0, 0], [NaN, 0], [7, 600_000], [-3, 0]]) {
      const edge = edgeOf({ manifest: manifestOf('20261128T0131Z', p1), packs: { '20261128T0131Z/5.ffs': p1 } })
      const A = tab(new Map(), edge, { r, clock })
      await A.ask({ op: 'ingest', manifestUrl: MANIFEST })
      await settle()
      expect(A.waits.map((w) => w.ms)).toEqual([want])
      A.waits[0].resolve()
      await A.core.ingesting()
    }
  })

  it('a core made without jitterMs (every other test fake) waits nothing', async () => {
    const clock = { t: Date.UTC(2026, 10, 30, 14, 25) }
    const p1 = packFor('2026-11-27', '20261128T0131Z')
    const edge = edgeOf({ manifest: manifestOf('20261128T0131Z', p1), packs: { '20261128T0131Z/5.ffs': p1 } })
    const posted = []
    const core = createWorkerCore({ tabId: 'A', locks: null, makeChannel: null, makeIO: async () => memoryIO(new Map()), fetchFn: edge,
      post: (m) => posted.push(m), now: () => clock.t, engineOpts: { now: () => clock.t } })
    await core.onMessage({ id: 1, op: 'ingest', manifestUrl: MANIFEST })
    await core.ingesting()
    expect(edge.packs()).toBe(1)
  })

  it('reads keep serving the HELD generation through the wait for the next build', async () => {
    const clock = { t: Date.UTC(2026, 10, 27, 23, 0) }
    const p1 = packFor('2026-11-27', '20261128T0131Z')
    const site = { manifest: manifestOf('20261128T0131Z', p1), packs: { '20261128T0131Z/5.ffs': p1 } }
    const edge = edgeOf(site)
    const disk = new Map()
    const A = tab(disk, edge, { r: 0, clock })
    await A.ask({ op: 'ingest', manifestUrl: MANIFEST })
    await settle()
    A.waits[0].resolve()
    await A.core.ingesting()
    A.core.close()
    const p2 = packFor('2026-11-30', '20261201T0131Z')
    site.manifest = manifestOf('20261201T0131Z', p2)
    site.packs['20261201T0131Z/5.ffs'] = p2
    const B = tab(disk, edge, { r: 0.5, clock })
    await B.ask({ op: 'ingest', manifestUrl: MANIFEST })
    await settle()
    expect(B.waits.length).toBe(1)
    const held = await B.ask({ op: 'read', sym: 'AAA', tf: '5' })
    expect(held?.build).toBe('20261128T0131Z')
    B.waits[0].resolve()
    await B.core.ingesting()
    expect((await B.ask({ op: 'read', sym: 'AAA', tf: '5' }))?.build).toBe('20261201T0131Z')
  })
})
