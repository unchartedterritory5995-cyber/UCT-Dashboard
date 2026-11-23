// @vitest-environment node
// THE LEADER'S OPERATIONS (review of #2537, M2 and M5): a page left open for days (a tab, the desktop app) re-checks
// the seed's manifest on a bounded cadence and takes the next build; the minute feed stops when the seed it serves is
// refused for good (no more polling for nothing, no overlay growing for nothing) and starts again on a new seed; a
// browser without room asks nothing at all on its next loads.
import { describe, it, expect, vi } from 'vitest'
import { createHash } from 'node:crypto'
import * as W from './workerCore'
import { memoryIO } from './io'
import { seedPackOf, synthBars } from './testing/fixtures'

const { createWorkerCore } = W
const sha = (b) => createHash('sha256').update(b).digest('hex')
const MIN = 60_000
const MB = 1024 * 1024
const MANIFEST = 'https://x.test/seed/latest.json'
const settle = async (n = 20) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)) }

/** 5m rows ending at the last bucket of `day`'s session (15:55 ET; November is EST, UTC-5). */
const fiveMinThrough = (day, n, seed) => {
  const [y, m, d] = day.split('-').map(Number)
  const last = Date.UTC(y, m - 1, d, 20, 55) / 1000
  return synthBars(n, { step: 300, seed, t0: last - (n - 1) * 300 })
}
const packFor = (asof, build) => seedPackOf({ AAA: fiveMinThrough(asof, 400, 3), BBB: fiveMinThrough(asof, 300, 4) }, { tf: '5', build, asof })
const manifestOf = (build, pack) => ({ v: 1, kind: 'ffseed', build, tfs: { '5': { url: `${build}/5.ffs`, bytes: pack.length, sha256: sha(pack) } } })

/** An edge serving whatever `site.manifest` names and `site.packs` holds; counts manifest asks. */
function edgeOf(site) {
  const fetchFn = vi.fn(async (url) => {
    const u = String(url)
    if (u === MANIFEST) return new Response(JSON.stringify(site.manifest))
    const name = u.slice('https://x.test/seed/'.length)
    return site.packs[name] ? new Response(site.packs[name]) : new Response('nope', { status: 404 })
  })
  fetchFn.manifests = () => fetchFn.mock.calls.filter((c) => String(c[0]) === MANIFEST).length
  fetchFn.packs = () => fetchFn.mock.calls.filter((c) => String(c[0]) !== MANIFEST).length
  return fetchFn
}

/** One tab's worker (it leads: no locks), on the shared `disk`, its clock `clock.t`. */
function tab(disk, fetchFn, clock, { liveOpts, engineOpts = {} } = {}) {
  const posted = []
  const core = createWorkerCore({
    tabId: 'A', locks: null, makeChannel: null, makeIO: async () => memoryIO(disk), fetchFn,
    post: (m) => posted.push(m), now: () => clock.t, liveOpts, engineOpts: { now: () => clock.t, ...engineOpts },
  })
  const ask = async (msg) => {
    const id = Math.random()
    await core.onMessage({ ...msg, id })
    return posted.find((m) => m.id === id)?.res
  }
  return { core, ask }
}

function fakeConsumers() {
  const made = []
  const load = vi.fn(async () => ({ createMinuteFrameConsumer: (opts) => { const c = { opts, start: vi.fn(), stop: vi.fn(), syncNow: vi.fn(async () => ({})), status: () => ({}) }; made.push(c); return c } }))
  return { made, load }
}

describe('M2 the manifest re-check of a long-lived page', () => {
  it('the number: 25 minutes between two re-checks of the manifest (the page asks every 30 while visible)', () => {
    expect(W.MANIFEST_RECHECK_MIN_MS).toBe(25 * MIN)
  })

  it('the leader asks the manifest for a RE-CHECK at most once per 25 minutes, whichever tab asks; a page load always asks', async () => {
    const clock = { t: Date.UTC(2026, 10, 18, 23, 0) }
    const p1 = packFor('2026-11-18', '20261119T0131Z')
    const site = { manifest: manifestOf('20261119T0131Z', p1), packs: { '20261119T0131Z/5.ffs': p1 } }
    const edge = edgeOf(site)
    const A = tab(new Map(), edge, clock)
    expect(await A.ask({ op: 'ingest', manifestUrl: MANIFEST })).toEqual({ status: 'started' })
    await A.core.ingesting()
    expect([edge.manifests(), edge.packs()]).toEqual([1, 1])
    clock.t += 10 * MIN
    expect(await A.ask({ op: 'ingest', manifestUrl: MANIFEST, recheck: true })).toEqual({ status: 'fresh' })
    expect(edge.manifests()).toBe(1)
    // another tab's page load is not a re-check: it asks (as before this change)
    expect(await A.ask({ op: 'ingest', manifestUrl: MANIFEST })).toEqual({ status: 'started' })
    await A.core.ingesting()
    expect([edge.manifests(), edge.packs()]).toEqual([2, 1])              // current: nothing downloaded
    clock.t += 25 * MIN - 1
    expect(await A.ask({ op: 'ingest', manifestUrl: MANIFEST, recheck: true })).toEqual({ status: 'fresh' })
    clock.t += 1
    expect(await A.ask({ op: 'ingest', manifestUrl: MANIFEST, recheck: true })).toEqual({ status: 'started' })
    await A.core.ingesting()
    expect(edge.manifests()).toBe(3)
    A.core.close()
  })

  it('a re-check that finds the next build ingests it; never two ingests at once', async () => {
    const clock = { t: Date.UTC(2026, 10, 18, 23, 0) }
    const p1 = packFor('2026-11-18', '20261119T0131Z')
    const p2 = packFor('2026-11-19', '20261120T0131Z')
    const site = { manifest: manifestOf('20261119T0131Z', p1), packs: { '20261119T0131Z/5.ffs': p1, '20261120T0131Z/5.ffs': p2 } }
    const edge = edgeOf(site)
    const A = tab(new Map(), edge, clock)
    await A.ask({ op: 'ingest', manifestUrl: MANIFEST })
    await A.core.ingesting()
    site.manifest = manifestOf('20261120T0131Z', p2)
    clock.t = Date.UTC(2026, 10, 20, 2, 0)                                // the next evening, after the build
    expect(await A.ask({ op: 'ingest', manifestUrl: MANIFEST, recheck: true })).toEqual({ status: 'started' })
    expect(await A.ask({ op: 'ingest', manifestUrl: MANIFEST })).toEqual({ status: 'running' })
    await A.core.ingesting()
    expect((await A.ask({ op: 'info' })).tfs['5'].build).toBe('20261120T0131Z')
    A.core.close()
  })
})

describe('M2 no minute feed for a seed the split guard refuses', () => {
  it('stops the feed and drops today when the seed is refused for good; a new seed starts it again', async () => {
    const clock = { t: Date.UTC(2026, 10, 18, 23, 0) }                    // Wed 18:00 ET: the seed's as-of day
    const p1 = packFor('2026-11-18', '20261119T0131Z')
    const p3 = packFor('2026-11-20', '20261121T0131Z')
    const site = { manifest: manifestOf('20261119T0131Z', p1), packs: { '20261119T0131Z/5.ffs': p1, '20261121T0131Z/5.ffs': p3 } }
    const edge = edgeOf(site)
    const { made, load } = fakeConsumers()
    const A = tab(new Map(), edge, clock, { liveOpts: { load } })
    await A.ask({ op: 'ingest', manifestUrl: MANIFEST })
    await A.core.ingesting()
    await A.ask({ op: 'live', visible: true })
    await settle()
    expect(made).toHaveLength(1)
    const sink = made[0].opts.sink
    sink.reset({ day: '2026-11-18' })
    sink.upsert('AAA', '5', { t: Date.UTC(2026, 10, 18, 15, 0) / 1000, o: 1, h: 1, l: 1, c: 1, v: 1 }, true)
    expect((await A.ask({ op: 'info' })).live).toMatchObject({ running: true, overlay: { series: 1 } })
    // Friday: the Wednesday seed is two sessions old (no split list could vouch for it): refused for every symbol
    clock.t = Date.UTC(2026, 10, 20, 15, 0)
    expect(await A.ask({ op: 'live', visible: true })).toEqual({ status: 'seed-refused' })
    expect(made[0].stop).toHaveBeenCalled()
    expect((await A.ask({ op: 'info' })).live).toMatchObject({ running: false, overlay: { series: 0 } })
    await A.ask({ op: 'live', visible: true })
    await settle()
    expect(made).toHaveLength(1)                                          // not started again for nothing
    // the next build lands (Friday's seed): the feed follows today again
    site.manifest = manifestOf('20261121T0131Z', p3)
    clock.t = Date.UTC(2026, 10, 21, 2, 0)                                // Fri 21:00 ET, after the build
    await A.ask({ op: 'ingest', manifestUrl: MANIFEST, recheck: true })
    await A.core.ingesting()
    await settle()
    expect(made).toHaveLength(2)
    expect((await A.ask({ op: 'info' })).live.running).toBe(true)
    A.core.close()
  })
})

describe('M5 a browser without room for the seed', () => {
  it('the ingest says no-room without downloading; the next page load and every re-check ask nothing, not even the manifest', async () => {
    const clock = { t: Date.UTC(2026, 10, 18, 23, 0) }
    const p1 = packFor('2026-11-18', '20261119T0131Z')
    const site = { manifest: manifestOf('20261119T0131Z', p1), packs: { '20261119T0131Z/5.ffs': p1 } }
    const edge = edgeOf(site)
    const disk = new Map()
    const estimate = async () => ({ quota: 120 * MB, usage: 20 * MB })   // a private window's quota
    const A = tab(disk, edge, clock, { engineOpts: { estimate } })
    await A.ask({ op: 'ingest', manifestUrl: MANIFEST })
    await A.core.ingesting()
    expect([edge.manifests(), edge.packs()]).toEqual([1, 0])
    expect((await A.ask({ op: 'info' })).lastIngest).toEqual([expect.objectContaining({ tf: '5', status: 'no-room', why: 'headroom' })])
    clock.t += 40 * MIN
    expect(await A.ask({ op: 'ingest', manifestUrl: MANIFEST, recheck: true })).toMatchObject({ status: 'no-room' })
    A.core.close()
    // the next page load
    const B = tab(disk, edge, clock, { engineOpts: { estimate } })
    expect(await B.ask({ op: 'ingest', manifestUrl: MANIFEST })).toMatchObject({ status: 'no-room' })
    expect([edge.manifests(), edge.packs()]).toEqual([1, 0])
    B.core.close()
  })
})
