// app/src/components/chart/engine/__tests__/serverLaneCadence.test.js
//
// ─── A MEMBER HOLDING THE KEY THROUGH A LIST NOBODY HAS OPENED ───────────────
//
// Measured on production 2026-11-13 (the key held through 40 deep charts of a list never
// opened, then released): the landing chart drew its RS lines 5.2 s after its candles. The
// steps came 201 ms apart at the median but unevenly (a deep chart takes 100 to 290 ms to
// draw), each cold request took 1.0 to 1.9 s, and eight requests for charts already passed
// were in flight when the key was released. Two readings of the cadence were wrong:
//
//   · a step slower than RAPID_MS read as "resting", so that chart sent its ask at once;
//   · "flying" was a fixed 120 ms a chart, so at 201 ms the rows ahead kept being asked
//     for although nothing asked could land within five rows.
//
// A chart's pace is now the faster of its last two steps, and "flying" follows how long
// the lane's own requests are taking. These rails pin both.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  RAPID_MS, SETTLE_FACTOR, SETTLE_MAX_MS, FLYING_MS, FLYING_MAX_MS, FLY_LEAD_ROWS, LANE_MS_TTL,
  clearServerColumns, ensureColumns, fetchColumns, fetchColumnsBatch, serverColumnsFor, chartShows, chartGone,
  chartsNeedTheLane, flyingMs, __setServerBatchFetcherForTests,
} from '../serverCompute'
import { warmSymbols, __resetServerWarm, YIELD_MS } from '../serverWarm'

const TF = 'D'
const wire = (v) => ({ times: [20260102, 20260105], columns: { a: [v, v + 1] }, payload: { state: 'ok' } })
const symOf = (url) => new URL(url, 'http://x').searchParams.get('sym')
const tick = async (ms = 0) => { for (let k = 0; k < 8; k++) await Promise.resolve(); await vi.advanceTimersByTimeAsync(ms); for (let k = 0; k < 8; k++) await Promise.resolve() }

let sent
/** the batch route answers every request after `ms` (a number, or (sym) => number | Error | null for "never") */
const server = (ms) => __setServerBatchFetcherForTests((url) => {
  const sym = symOf(url)
  sent.push(sym)
  const took = typeof ms === 'function' ? ms(sym) : ms
  if (took === null) return new Promise(() => {})
  return new Promise((resolve, reject) => setTimeout(() => {
    if (took instanceof Error) reject(took)
    else resolve({ results: JSON.parse(new URL(url, 'http://x').searchParams.get('asks')).map(() => ({ status: 200, envelope: wire(1) })) })
  }, took instanceof Error ? 5 : took))
})
/** the chart on `slot` paints `sym`: two definitions, so its ask goes through the batch door */
const paint = (slot, sym) => {
  chartShows(slot, sym, TF)
  ensureColumns('defA', sym, TF, { benchmark: 'SPY' })
  ensureColumns('defB', sym, TF, null)
}
/** one answered request that took `ms`, so the lane knows how long the server is taking */
const timeTheLane = async (ms, sym = `T${ms}`) => {
  server(ms)
  const p = fetchColumnsBatch(sym, TF, [{ defId: 'defA', inputs: null }], { quiet: true })
  await tick(ms)
  await p
}

beforeEach(() => {
  vi.useFakeTimers()
  clearServerColumns()
  __resetServerWarm({ painted: true })
  sent = []
  try { localStorage.removeItem('uct.indwarm.off'); localStorage.removeItem('uct.rslane.tfs'); localStorage.setItem('barspack.version', 'x') } catch { /* */ }
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('no network in this suite') }))
})
afterEach(() => {
  __setServerBatchFetcherForTests(null)
  clearServerColumns()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('a chart\'s pace is the faster of its last two steps', () => {
  it('⭐ one slow step in a run of fast ones is still a run: that chart\'s ask is held, and dropped when the run goes on', async () => {
    server(null)
    const slot = {}
    paint(slot, 'S0')
    await tick()
    expect(sent, 'a chart that was resting asks at once').toEqual(['S0'])
    await tick(100); paint(slot, 'S1')                  // 100 ms steps: racing
    await tick(100); paint(slot, 'S2')
    await tick(100); paint(slot, 'S3')
    await tick(300); paint(slot, 'S4')                  // a 300 ms step (S3 drew slowly), then the run goes on
    await tick()
    expect(sent.includes('S4'), 'not sent at once, as a "resting" chart would be').toBe(false)
    await tick(100); paint(slot, 'S5')
    await tick(100); paint(slot, 'S6')
    await tick()
    expect(sent.includes('S4'), 'and never sent: the member was past it before its hold ended').toBe(false)
  })

  it('two slow steps in a row are a member reading: the ask goes at once', async () => {
    server(null)
    const slot = {}
    paint(slot, 'S0')
    await tick(100)
    paint(slot, 'S1')
    await tick(RAPID_MS)
    paint(slot, 'S2')                                   // slow, but the step before it was fast
    await tick(RAPID_MS)
    paint(slot, 'S3')                                   // the second slow step
    await tick()
    expect(sent[sent.length - 1], 'sent in the same tick, no hold').toBe('S3')
  })

  it('⭐ "has the member stopped?" is asked of the SLOWER of the last two steps', async () => {
    server(null)
    const slot = {}
    paint(slot, 'S0')
    await tick(290); paint(slot, 'S1')                  // not racing yet (first step, 290 ms)
    await tick(180); paint(slot, 'S2')                  // steps of 290 then 180: racing, stride 290
    await tick()
    const before = sent.length
    await tick(180 * SETTLE_FACTOR + 5)                 // 1.3 x the FASTER step has gone by
    expect(sent.length, 'still held: a 290 ms step is how long this member takes').toBe(before)
    await tick(290 * SETTLE_FACTOR - 180 * SETTLE_FACTOR)
    expect(sent[sent.length - 1], 'sent 1.3 x the slower step after the chart appeared').toBe('S2')
  })

  it('the hold has a ceiling: a pause after a run does not hold the next chart for seconds', async () => {
    expect(SETTLE_MAX_MS).toBe(500)
    server(null)
    const slot = {}
    paint(slot, 'S0')
    await tick(100); paint(slot, 'S1')
    await tick(2000); paint(slot, 'S2')                 // 2 s on S1, then a step: pace 100 (still "a run"), stride 2,000
    await tick()
    const before = sent.length
    await tick(SETTLE_MAX_MS - 2)
    expect(sent.length).toBe(before)
    await tick(4)
    expect(sent[sent.length - 1]).toBe('S2')
  })

  it('⭐ the production run: uneven steps around 200 ms cost one ask at the start and ONE at the end', async () => {
    server(null)
    const slot = {}
    paint(slot, 'S0')
    await tick()
    const gaps = [201, 290, 180, 260, 210, 300, 190, 280, 170, 295]
    for (let i = 0; i < gaps.length; i++) { await tick(gaps[i]); paint(slot, `S${i + 1}`) }
    await tick()
    // S1: the run's first step looked like a member who stopped (290 ms on a chart reached
    // 201 ms after the last). From then on nothing the member passed was asked for.
    expect(sent).toEqual(['S0', 'S1'])
    await tick(295 * SETTLE_FACTOR - 2)
    expect(sent).toEqual(['S0', 'S1'])
    await tick(4)
    expect(sent, 'the landing chart, 1.3 x its slower step after it appeared').toEqual(['S0', 'S1', `S${gaps.length}`])
  })

  it('a slow server makes a slower run a run: at 300 ms a step, with answers taking 1.6 s, asks are held', async () => {
    await timeTheLane(1600)                             // flying under 400 ms a step
    server(null)
    sent.length = 0
    const slot = {}
    paint(slot, 'S0')
    for (let i = 1; i <= 5; i++) { await tick(300); paint(slot, `S${i}`) }
    await tick()
    expect(sent, 'only the chart that was resting, and the run\'s first step').toEqual(['S0'])
    await tick(300 * SETTLE_FACTOR + 5)
    expect(sent).toEqual(['S0', 'S5'])
    // CONTROL: the same steps on a fast server are a member reading; every chart asks at once
    clearServerColumns()
    await timeTheLane(60)
    server(null)
    sent.length = 0
    const calm = {}
    paint(calm, 'R0')
    for (let i = 1; i <= 3; i++) { await tick(300); paint(calm, `R${i}`); await tick() }
    expect(sent).toEqual(['R0', 'R1', 'R2', 'R3'])
  })

  it('a chart that is gone is not waited for', async () => {
    server(null)
    const slot = {}
    paint(slot, 'S0')
    await tick(100)
    paint(slot, 'S1')
    await tick()                                        // its ask is held
    chartGone(slot)
    await tick(RAPID_MS * 4)
    expect(sent).toEqual(['S0'])
  })
})

describe('"flying" follows how long the lane is taking right now', () => {
  it('nothing timed yet: the floor', () => {
    expect(FLYING_MS).toBe(120)
    expect(flyingMs()).toBe(FLYING_MS)
  })

  it('⭐ a chart is flying when a request started now would come back more than FLY_LEAD_ROWS steps later', async () => {
    expect(FLY_LEAD_ROWS).toBe(4)
    await timeTheLane(1600)
    expect(flyingMs()).toBe(1600 / FLY_LEAD_ROWS)
    await timeTheLane(800)
    expect(flyingMs(), 'the average of the last two answers').toBe((1600 + 800) / 2 / FLY_LEAD_ROWS)
  })

  it('never under the floor, never over the ceiling', async () => {
    await timeTheLane(80)
    expect(flyingMs(), 'a fast server: 120 ms, as before').toBe(FLYING_MS)
    clearServerColumns()
    await timeTheLane(10_000)
    expect(FLYING_MAX_MS).toBe(600)
    expect(flyingMs(), 'a member reading for over half a second is not flying, whatever the server does').toBe(FLYING_MAX_MS)
  })

  it('a single ask is timed like a batch; a failed request says nothing about how long an answer takes', async () => {
    const p = fetchColumns('defA', 'ONE', TF, null, () => new Promise((r) => setTimeout(() => r(wire(1)), 1200)))
    await tick(1200)
    await p
    expect(flyingMs()).toBe(1200 / FLY_LEAD_ROWS)
    server(new Error('down'))
    const bad = fetchColumnsBatch('BAD', TF, [{ defId: 'defA', inputs: null }], { quiet: true })
    await tick(50)
    expect(await bad, 'the batch request itself failed').toBe(-1)
    const q = fetchColumns('defA', 'TWO', TF, null, () => new Promise((_r, no) => setTimeout(() => no(new Error('down')), 4000)))
    await tick(4000)
    await q
    expect(flyingMs(), 'unchanged by the two failures').toBe(1200 / FLY_LEAD_ROWS)
  })

  it('a latency is forgotten after LANE_MS_TTL, and the next one starts fresh', async () => {
    await timeTheLane(2000)
    expect(flyingMs()).toBe(500)
    await tick(LANE_MS_TTL - 1)
    expect(flyingMs()).toBe(500)
    await tick(1)
    expect(flyingMs(), 'too old to say anything about the server now').toBe(FLYING_MS)
    await timeTheLane(800)
    expect(flyingMs(), 'not averaged with the stale one').toBe(200)
  })

  it('a new page load knows nothing about the old one', async () => {
    await timeTheLane(2000)
    clearServerColumns()
    expect(flyingMs()).toBe(FLYING_MS)
  })
})

describe('⭐ the pre-load starts nothing for a chart that is flying at the server\'s present speed', () => {
  const drawing = () => serverColumnsFor({ id: 'defA', compute: { kind: 'server' }, plots: [], meta: {} }, [{ t: '2026-01-02' }], { benchmark: 'SPY' },
    { sym: 'DRAWN', tf: TF, fetcher: () => new Promise(() => {}) })
  const steps = async (slot, n, gap, tell) => {
    for (let i = 1; i <= n; i++) {
      await tick(gap)
      chartShows(slot, `S${i}`, TF)
      if (tell) warmSymbols([`A${i}`, `B${i}`], TF, { priority: true })
    }
  }

  it('a slow server (1.6 s an answer): a chart stepping every 300 ms is flying, one stepping every 450 ms is not', async () => {
    await timeTheLane(1600)                             // threshold 400 ms
    const slot = {}
    chartShows(slot, 'S0', TF)
    await steps(slot, 2, 300)
    expect(chartsNeedTheLane()).toBe(true)
    const calm = {}
    clearServerColumns()
    await timeTheLane(1600)
    chartShows(calm, 'S0', TF)
    await steps(calm, 2, 450)
    expect(chartsNeedTheLane()).toBe(false)
  })

  it('CONTROL: on a fast server the same 300 ms stepping keeps its pre-load', async () => {
    await timeTheLane(60)
    const slot = {}
    chartShows(slot, 'S0', TF)
    await steps(slot, 2, 300)
    expect(chartsNeedTheLane()).toBe(false)
  })

  it('flying is judged by the pace too: one slow step in a fast run does not release the pre-load', async () => {
    const slot = {}
    chartShows(slot, 'S0', TF)
    await tick(FLYING_MS - 20); chartShows(slot, 'S1', TF)
    await tick(FLYING_MS - 20); chartShows(slot, 'S2', TF)
    await tick(RAPID_MS + 200); chartShows(slot, 'S3', TF)   // a slow step, then...
    expect(chartsNeedTheLane(), 'the step before it was a flying one').toBe(true)
    await tick(RAPID_MS + 200); chartShows(slot, 'S4', TF)   // ...a second slow step: the member is reading
    expect(chartsNeedTheLane()).toBe(false)
  })

  it('flying lasts until the chart has rested for a whole step at that threshold', async () => {
    await timeTheLane(1600)                             // threshold 400 ms, longer than RAPID_MS
    const slot = {}
    chartShows(slot, 'S0', TF)
    await steps(slot, 2, 300)
    await tick(399)
    expect(chartsNeedTheLane(), 'one step at that pace has not yet gone by').toBe(true)
    await tick(1)
    expect(chartsNeedTheLane()).toBe(false)
    // on the floor (nothing timed) the window is RAPID_MS, as it was
    clearServerColumns()
    const fast = {}
    chartShows(fast, 'S0', TF)
    await steps(fast, 2, FLYING_MS - 20)
    await tick(RAPID_MS - 1)
    expect(chartsNeedTheLane()).toBe(true)
    await tick(1)
    expect(chartsNeedTheLane()).toBe(false)
  })

  it('⭐ the production run: a cold server, steps around 200 ms, the rows ahead announced at every step', async () => {
    drawing()
    await timeTheLane(1500)                             // what the list's first requests took
    server(1500)
    sent.length = 0
    const slot = {}
    chartShows(slot, 'S0', TF)
    const gaps = [201, 290, 180, 260, 210, 300, 190, 280]
    for (let i = 0; i < gaps.length; i++) {
      await tick(gaps[i])
      chartShows(slot, `S${i + 1}`, TF)
      warmSymbols([`A${i}`, `B${i}`], TF, { priority: true })
    }
    expect(sent, 'nothing was started for rows the member would be past before it landed').toEqual([])
    // the member stops: once the chart has rested, the rows ahead of where it STOPPED go
    await tick(Math.max(RAPID_MS, flyingMs()) + YIELD_MS + 10)
    expect(sent.slice(0, 2)).toEqual([`A${gaps.length - 1}`, `B${gaps.length - 1}`])
  })
})
