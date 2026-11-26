// app/src/components/chart/engine/__tests__/rsCustomTfDeep.test.js
//
// ─── A CUSTOM TIMEFRAME'S RS LINE AS DEEP AS THE CHART (2026-11-26, option B, stacked on #2790) ───────────────────
//
// #2790 folds the lane's base window (400 intraday rows): ~46 bars on a regular 4h, ~12 on 65m and 195m, where the
// definition's 21-bar average is never valued. A ratio line (`close / benchmarkClose`) is the ratio of the two series'
// closes at each bar, and a bucket's close is its last base row's close: so with a TICKER benchmark it is built from the
// chart's own bars and the benchmark's bars on the same custom timeframe (the other-symbol lane), as deep as both reach.
// On the REAL slim definition through `serverColumnsFor`, synthetic prices, the benchmark's page served by a stubbed
// `fetch` (the other-symbol lane's own request):
//   B1 equality with #2790's fold on the overlap: every bar the fold values keeps the fold's (the server's) value
//   B2 depth beyond 400: a regular 4h chart of 600+ bars is valued on every bar
//   B3 195m and 65m regular charts: every bar valued, and the definition's 21-bar average populated
//   B4 null where the benchmark has no bar at that time
//   B5 a composite benchmark (an industry group) keeps the fold, and asks for nothing
//   B6 a benchmark the lane cannot serve (refused, or answered with no bars) keeps the fold
//   B7 the forming cell is unchanged: the live tail's close / benchmark close on the chart's own last bar
//   B8 native timeframes unchanged: no benchmark request, the envelope aligned as it is
//   B9 never on the switch's key path: the first paint draws the fold and requests nothing in its own task or its
//      microtasks; the request
//      runs in a later one, its landing moves the memo signature, and the next paint upgrades IN PLACE (the overlap
//      identical, so nothing visible moves where the line was already drawn)
//   B10 shared: a second symbol on the same benchmark makes no second request
//   B11 the compute is one pass: measured on 5,000 bars
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { registerDefinitions, resolveInputs, RS_LINE_SLIM_RAW, computeSignature } from '../nativeRegistry'
import {
  primeServerColumns, clearServerColumns, serverColumnsFor, pickServerInputs, serverAskOf, deepenCustomTf, foldToCustomTf,
  customTfDepthVersion,
} from '../serverCompute'
import { clearSecondaryBars } from '../secondaryBars'
import { primeBenchmarkTail, _resetBenchmarkTailsForTests, __setBenchmarkTailFetcherForTests } from '../liveTail'
import { resampleForSpec } from '../../../../utils/resampleBars'
import { resampleSpec } from '../../timeframes'

const SLIM = (() => {
  const r = registerDefinitions([RS_LINE_SLIM_RAW])
  if (r.errors.length) throw new Error(`the slim rsLine does not register:\n  ${r.errors.join('\n  ')}`)
  return r.defs[0]
})()
const INPUTS = resolveInputs(SLIM, { showAverage: true, maLength: 21, maType: 'EMA' })
const SENT = pickServerInputs(SLIM, INPUTS)

// weekdays from 2025-09-01 (EST/EDT handled by the stamps: ET midnight = UTC 04:00 or 05:00)
function weekdays(n, from = Date.UTC(2025, 8, 1)) {
  const out = []
  for (let d = from; out.length < n; d += 86400000) {
    const wd = new Date(d).getUTCDay()
    if (wd !== 0 && wd !== 6) out.push(new Date(d).toISOString().slice(0, 10))
  }
  return out
}
function etOffsetH(day) {           // US DST: second Sunday of March .. first Sunday of November
  const y = Number(day.slice(0, 4))
  const nth = (m, k) => { const d = new Date(Date.UTC(y, m, 1)); const first = (7 - d.getUTCDay()) % 7; return Date.UTC(y, m, 1 + first + 7 * (k - 1)) }
  const t = Date.parse(`${day}T12:00:00Z`)
  return t >= nth(2, 2) && t < nth(10, 1) ? 4 : 5
}
const at = (day, min) => Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000) + etOffsetH(day) * 3600 + min * 60
const SESSION60 = [240, 300, 360, 420, 480, 540, 570, 630, 690, 750, 810, 870, 930, 960, 1020, 1080, 1140]
const stepMins = (step) => Array.from({ length: Math.floor((1200 - 240) / step) }, (_, i) => 240 + i * step)

/** The stock's and the benchmark's base rows on `days`, and the server's ratio at each base row. */
function pages(days, mins, { dropBench = () => false } = {}) {
  const stock = []
  const bench = []
  let k = 0
  for (const d of days) {
    for (const m of mins) {
      const t = at(d, m)
      const p = 100 + k * 0.01
      const q = 400 + (k % 97) * 0.05
      stock.push({ t, o: p, h: p + 1, l: p - 1, c: p, v: 10 })
      if (!dropBench(d, m)) bench.push({ t, o: q, h: q + 1, l: q - 1, c: q, v: 10 })
      k += 1
    }
  }
  return { stock, bench }
}
const round6 = (v) => Math.round(v * 1e6) / 1e6
/** The server's envelope for the lane's window: the newest `window` base rows, rsLine = round6(close / benchClose). */
function envelope(stock, bench, window = 400, resolved = 'SPY') {
  const rows = stock.slice(-window)
  const bAt = new Map(bench.map((b) => [b.t, b.c]))
  // the server's own cells: the same ratio, a hair apart (its rounding), so a rail can tell whose cell is drawn
  const rs = rows.map((r) => (bAt.has(r.t) ? round6(r.c / bAt.get(r.t)) + 1e-7 : null))
  return {
    times: rows.map((r) => r.t), rev: SLIM.compute.rev,
    columns: { rsLine: rs, rsMa: rs.map(() => null), rsAbove: rs.map(() => null), dotNH: rs.map(() => null),
      dotNHbeforePx: rs.map(() => null), dotNHred: rs.map(() => null) },
    payload: { benchmark: { requested: resolved, resolved, label: resolved } },
  }
}
/** A `fetch` serving the benchmark's base page for the URL's tf and bars; every URL recorded. */
function stubFetch(benchByTf, { status = 200, body = null } = {}) {
  const asked = []
  vi.stubGlobal('fetch', (url) => {
    asked.push(String(url))
    const q = new URL(String(url), 'http://x').searchParams
    const rows = (benchByTf[q.get('tf')] || []).slice(-Number(q.get('bars')))
    return Promise.resolve({ ok: status === 200, status, json: () => Promise.resolve(body || { bars: rows }) })
  })
  return asked
}
const settle = async () => { for (let i = 0; i < 4; i++) { await new Promise((r) => setTimeout(r, 0)); await Promise.resolve() } }
const finiteAll = (col) => Array.from(col).every((v) => Number.isFinite(v))
const ctx = (over = {}) => ({ sym: 'TGTX', tf: '240', extended: false, newestBarIsForming: false, ...over })

beforeEach(() => { clearServerColumns(); clearSecondaryBars(); _resetBenchmarkTailsForTests(); __setBenchmarkTailFetcherForTests(null) })
afterEach(() => { vi.unstubAllGlobals(); __setBenchmarkTailFetcherForTests(null) })

/** Prime the fold, paint once (the fold), let the benchmark's page land, paint again (deep). */
async function paintTwice({ days, mins, base, tf = '240', extended = false, sym = 'TGTX', dropBench, resolved = 'SPY', fetchOpts } = {}) {
  const { stock, bench } = pages(days, mins, { dropBench })
  const spec = resampleSpec(tf, { extended })
  const bars = resampleForSpec(stock, spec)
  const asked = stubFetch({ [base]: bench }, fetchOpts)
  primeServerColumns(SLIM.id, sym, serverAskOf(tf, extended).tf, SENT, envelope(stock, bench, 400, resolved))
  const first = serverColumnsFor(SLIM, bars, INPUTS, ctx({ sym, tf, extended }))
  const firstAsked = asked.length
  await settle()
  const second = serverColumnsFor(SLIM, bars, INPUTS, ctx({ sym, tf, extended }))
  return { stock, bench, bars, first, second, asked, firstAsked, spec }
}

describe('a custom timeframe\'s RS line as deep as the chart', () => {
  it('B1 + B2 a regular 4h chart of 600+ bars: every bar valued; the fold\'s value on every bar it covers', async () => {
    const days = weekdays(320)
    const r = await paintTwice({ days, mins: SESSION60, base: '60' })
    expect(r.bars.length).toBeGreaterThanOrEqual(600)
    expect(finiteAll(r.second.rsLine)).toBe(true)                                   // B2
    const foldValued = Array.from(r.first.rsLine).map((v, i) => [v, i]).filter(([v]) => Number.isFinite(v))
    expect(foldValued.length).toBeGreaterThan(20)
    expect(foldValued.length).toBeLessThan(60)                                       // the fold: ~46 bars
    for (const [v, i] of foldValued) expect(r.second.rsLine[i]).toBe(v)              // B1: every overlap bar
    // beyond it: the ratio of the two custom bars' closes, at six places
    const bench = resampleForSpec(r.bench, r.spec)
    const bAt = new Map(bench.map((b) => [b.t, b.c]))
    expect(r.second.rsLine[0]).toBe(round6(r.bars[0].c / bAt.get(r.bars[0].t)))
  })

  it.each([['195', '15', 60], ['65', '5', 25]])('B3 %sm regular: every bar valued, and the 21-bar average populated', async (tf, base, nDays) => {
    const r = await paintTwice({ days: weekdays(nDays), mins: stepMins(Number(base)), base, tf })
    expect(r.bars.length).toBeGreaterThan(60)
    expect(Array.from(r.first.rsMa).every((v) => Number.isNaN(v))).toBe(true)      // the fold alone: too short for 21
    expect(finiteAll(r.second.rsLine)).toBe(true)
    expect(Array.from(r.second.rsMa).slice(20).every((v) => Number.isFinite(v))).toBe(true)
  })

  it('B4 null where the benchmark has no bar at that time', async () => {
    const days = weekdays(320)
    const gap = days[10]
    const r = await paintTwice({ days, mins: SESSION60, base: '60', dropBench: (d) => d === gap })
    const atGap = r.bars.map((b, i) => [b, i]).filter(([b]) => new Date((b.t - 5 * 3600) * 1000).toISOString().slice(0, 10) === gap)
    expect(atGap.length).toBe(2)
    for (const [, i] of atGap) expect(r.second.rsLine[i]).toBeNaN()
    expect(Number.isFinite(r.second.rsLine[atGap[0][1] - 1])).toBe(true)
  })

  it('B5 a composite benchmark keeps the fold, and asks for nothing', async () => {
    const r = await paintTwice({ days: weekdays(320), mins: SESSION60, base: '60', resolved: 'INDUSTRY:Semiconductors' })
    expect(r.asked.length).toBe(0)
    expect(Array.from(r.second.rsLine)).toEqual(Array.from(r.first.rsLine))
    expect(Number.isNaN(r.second.rsLine[0])).toBe(true)
  })

  it.each([['refused', { status: 403 }], ['no bars', { body: { bars: [], note: 'not served' } }]])(
    'B6 a benchmark the lane cannot serve (%s) keeps the fold', async (_name, fetchOpts) => {
      const r = await paintTwice({ days: weekdays(320), mins: SESSION60, base: '60', fetchOpts })
      expect(r.asked.length).toBe(1)
      expect(Array.from(r.second.rsLine)).toEqual(Array.from(r.first.rsLine))
    })

  it('B7 the forming cell is unchanged: close / benchmark close on the chart\'s own last bar', async () => {
    const r = await paintTwice({ days: weekdays(320), mins: SESSION60, base: '60' })
    const last = r.bars[r.bars.length - 1]
    primeBenchmarkTail('SPY', '240', [{ t: r.bars[r.bars.length - 2].t, c: 400 }, { t: last.t, c: 500 }])
    const live = serverColumnsFor(SLIM, r.bars, INPUTS, ctx({ newestBarIsForming: true }))
    expect(live.rsLine[r.bars.length - 1]).toBeCloseTo(last.c / 500, 12)
    expect(live.rsLine[r.bars.length - 2]).toBe(r.second.rsLine[r.bars.length - 2])
  })

  it('B8 native timeframes are unchanged: no benchmark request', async () => {
    const { stock, bench } = pages(weekdays(30), SESSION60)
    const asked = stubFetch({ 60: bench })
    primeServerColumns(SLIM.id, 'TGTX', '60', SENT, envelope(stock, bench, 400))
    const cols = serverColumnsFor(SLIM, stock, INPUTS, ctx({ tf: '60' }))
    await settle()
    expect(asked.length).toBe(0)
    expect(Array.from(cols.rsLine).filter((v) => Number.isFinite(v)).length).toBe(400)
    expect(computeSignature(SLIM, INPUTS, { sym: 'TGTX', tf: '60' })).not.toContain('deep:')
  })

  it('B9 never on the key path: the fold first, the request in a later task, the upgrade in place', async () => {
    const { stock, bench } = pages(weekdays(320), SESSION60)
    const spec = resampleSpec('240')
    const bars = resampleForSpec(stock, spec)
    const asked = stubFetch({ 60: bench })
    primeServerColumns(SLIM.id, 'TGTX', '60', SENT, envelope(stock, bench, 400))
    const before = customTfDepthVersion()
    const first = serverColumnsFor(SLIM, bars, INPUTS, ctx())
    expect(asked.length).toBe(0)                                                     // nothing in the paint's own task
    for (let i = 0; i < 5; i++) await Promise.resolve()                              // ... nor in its microtasks (the
    expect(asked.length).toBe(0)                                                     //  lane's fetch starts one later)
    const sig1 = computeSignature(SLIM, INPUTS, { sym: 'TGTX', tf: '240' })
    await settle()
    expect(asked.length).toBe(1)                                                     // ... one request, a task later
    expect(customTfDepthVersion()).toBe(before + 1)                                  // its landing moved the version
    expect(computeSignature(SLIM, INPUTS, { sym: 'TGTX', tf: '240' })).not.toBe(sig1)   // a memo miss: the repaint computes
    const second = serverColumnsFor(SLIM, bars, INPUTS, ctx())
    Array.from(first.rsLine).forEach((v, i) => { if (Number.isFinite(v)) expect(second.rsLine[i]).toBe(v) })   // in place
    expect(finiteAll(second.rsLine)).toBe(true)
  })

  it('B10 shared: a second symbol on the same benchmark makes no second request', async () => {
    const days = weekdays(320)
    const r = await paintTwice({ days, mins: SESSION60, base: '60' })
    expect(r.asked.length).toBe(1)
    primeServerColumns(SLIM.id, 'OTHER', '60', SENT, envelope(r.stock, r.bench, 400))
    const cols = serverColumnsFor(SLIM, r.bars, INPUTS, ctx({ sym: 'OTHER' }))
    await settle()
    expect(r.asked.length).toBe(1)
    expect(finiteAll(cols.rsLine)).toBe(true)                                         // deep at once: the page is held
  })

  it('B11 the compute is one pass: 5,000 bars', async () => {
    const r = await paintTwice({ days: weekdays(320), mins: SESSION60, base: '60' })
    const many = []
    for (let i = 0; i < 5000; i++) many.push(r.bars[i % r.bars.length])
    serverColumnsFor(SLIM, many, INPUTS, ctx())                                      // a deeper chart: its rung asked
    await settle()
    const raw = envelope(r.stock, r.bench, 400)
    const folded = foldToCustomTf(SLIM, raw, r.spec, INPUTS)
    const t0 = performance.now()
    const out = deepenCustomTf(SLIM, raw, folded, many, r.spec, ctx(), INPUTS)
    const ms = performance.now() - t0
    // eslint-disable-next-line no-console
    console.log(`[deepenCustomTf] 5,000 bars: ${ms.toFixed(2)} ms`)
    expect(out.times.length).toBe(5000)
    expect(ms).toBeLessThan(50)
  })
})
