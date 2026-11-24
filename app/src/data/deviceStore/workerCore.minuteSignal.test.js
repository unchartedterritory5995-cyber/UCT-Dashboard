// @vitest-environment node
// THE LEADER'S WORKER TELLS THE PAGES WHEN A MINUTE FILE IS IN THE BROWSER'S CACHE (2026-11-24, review of #2639 round 2;
// lib/minuteFrames/applied.js). The bar store's page-side minute feed reads that file from the cache, once, when told
// (data/barStore/minuteFeed.js). Nothing else of the device store changes: this is one message more.
//   W1 a frame the feed read as its own minute file: ONE message on the channel `uct-minute-applied`
//      ({ type, day, hhmm, seq, minute }); a frame replayed from today.bin, or one that does not say: none.
//      The channel is opened with the first minute there is to tell, never before; nothing of it goes on the
//      device store's own channel; closing the worker closes it.
//   W2 a worker with no BroadcastChannel (or one that cannot post) follows its feed exactly as before
import { describe, it, expect, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { createWorkerCore } from './workerCore'
import { CHANNEL_NAME } from './crossTab'
import { memoryIO } from './io'
import { seedPackOf, synthBars } from './testing/fixtures'

const sha = (b) => createHash('sha256').update(b).digest('hex')
const MANIFEST = 'https://x.test/seed/latest.json'
const settle = async (n = 20) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)) }

/** 5m rows ending at the last bucket of `day`'s session (15:55 ET; November is EST, UTC-5). */
const fiveMinThrough = (day, n, seed) => {
  const [y, m, d] = day.split('-').map(Number)
  const last = Date.UTC(y, m - 1, d, 20, 55) / 1000
  return synthBars(n, { step: 300, seed, t0: last - (n - 1) * 300 })
}
const PACK = seedPackOf({ AAA: fiveMinThrough('2026-11-18', 400, 3), BBB: fiveMinThrough('2026-11-18', 300, 4) }, { tf: '5', build: '20261119T0131Z', asof: '2026-11-18' })
const SITE = { manifest: { v: 1, kind: 'ffseed', build: '20261119T0131Z', tfs: { '5': { url: '20261119T0131Z/5.ffs', bytes: PACK.length, sha256: sha(PACK) } } } }
const edge = async (url) => {
  const u = String(url)
  if (u === MANIFEST) return new Response(JSON.stringify(SITE.manifest))
  return u.endsWith('20261119T0131Z/5.ffs') ? new Response(PACK) : new Response('nope', { status: 404 })
}

/** One tab's worker (it leads: no locks) with a seed held and its minute feed running on a stand-in consumer. */
async function leader(makeChannel) {
  const clock = { t: Date.UTC(2026, 10, 18, 23, 0) }               // Wed 18:00 ET: the seed's as-of day
  const posted = []
  const made = []
  const load = vi.fn(async () => ({
    createMinuteFrameConsumer: (opts) => { const c = { opts, start: vi.fn(), stop: vi.fn(), syncNow: vi.fn(async () => ({})), status: () => ({}) }; made.push(c); return c },
  }))
  const core = createWorkerCore({
    tabId: 'A', locks: null, makeChannel, makeIO: async () => memoryIO(new Map()), fetchFn: edge,
    post: (m) => posted.push(m), now: () => clock.t, liveOpts: { load }, engineOpts: { now: () => clock.t },
  })
  const ask = async (msg) => { const id = Math.random(); await core.onMessage({ ...msg, id }); return posted.find((m) => m.id === id)?.res }
  await ask({ op: 'ingest', manifestUrl: MANIFEST })
  await core.ingesting()
  await ask({ op: 'live', visible: true })
  await settle()
  return { core, ask, sink: made[0]?.opts.sink, made }
}

/** BroadcastChannel stand-ins, one per name asked for. */
function channels() {
  const all = []
  const make = (name) => { const ch = { name, posted: [], onmessage: null, closed: false, postMessage(m) { this.posted.push(m) }, close() { this.closed = true } }; all.push(ch); return ch }
  return { all, make, named: (n) => all.filter((c) => c.name === n) }
}
const MIN = Date.UTC(2026, 10, 18, 15, 0) / 60000                 // 10:00 ET
const frame = (seq, over = {}) => ({ day: '2026-11-18', seq, minute: MIN + (seq - 360), withAv: false, dailyOk: false, ...over })

describe('the leader tells the pages which minute file is in the cache', () => {
  it('W1 one message per frame read as its own minute file; none for a replayed one; on a channel of its own', async () => {
    const chs = channels()
    const A = await leader(chs.make)
    expect(A.made).toHaveLength(1)                                   // the feed runs (a seed is held and serves)
    expect(chs.all.map((c) => c.name)).toEqual([CHANNEL_NAME])       // nothing to tell yet: no second channel
    A.sink.reset({ day: '2026-11-18' })
    A.sink.frameDone(frame(358))                                     // replayed from today.bin: it does not say `file`
    A.sink.frameDone(frame(359, { file: false }))
    expect(chs.named('uct-minute-applied')).toEqual([])
    A.sink.frameDone(frame(360, { file: true }))                     // its own minute file: 1000.bin is in the cache
    A.sink.frameDone(frame(361, { file: true }))
    const told = chs.named('uct-minute-applied')
    expect(told).toHaveLength(1)                                     // one channel, opened once
    expect(told[0].posted).toEqual([
      { type: 'minute-applied', day: '2026-11-18', hhmm: '1000', seq: 360, minute: MIN },
      { type: 'minute-applied', day: '2026-11-18', hhmm: '1001', seq: 361, minute: MIN + 1 },
    ])
    expect(chs.named(CHANNEL_NAME)[0].posted.filter((m) => m?.type === 'minute-applied' || m?.event?.type === 'minute-applied')).toEqual([])
    expect((await A.ask({ op: 'info' })).live).toMatchObject({ running: true })    // the feed and its overlay are as they were
    A.core.close()
    expect(told[0].closed).toBe(true)
  })

  it('W2 with no BroadcastChannel, or one that cannot post, the feed goes on exactly as before', async () => {
    const A = await leader(null)
    expect(() => A.sink.frameDone(frame(360, { file: true }))).not.toThrow()
    expect((await A.ask({ op: 'info' })).live).toMatchObject({ running: true })
    A.core.close()
    const chs = channels()
    const broken = (name) => { const ch = chs.make(name); if (name !== CHANNEL_NAME) ch.postMessage = () => { throw new Error('closed') }; return ch }
    const B = await leader(broken)
    expect(() => B.sink.frameDone(frame(360, { file: true }))).not.toThrow()
    expect((await B.ask({ op: 'info' })).live).toMatchObject({ running: true })
    B.core.close()
  })
})
