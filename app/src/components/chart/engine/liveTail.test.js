// app/src/components/chart/engine/liveTail.test.js
//
// ─── RS split, unit U2b: the live forming-bar tail of a server column ───────
//
// The pure math (`ratioTail`, `movingAverageTail`), the applier (`withLiveTail`,
// against a hand-built definition so no tenant's shape is assumed) and the
// benchmark tail store (one entry per (symbol, timeframe), re-asked only when
// due, announced when it lands). Every fail-closed branch is a case of its own:
// the whole point of the unit is that a value it cannot prove is the server's.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  ratioTail, movingAverageTail, liveBenchmarkSymbol, withLiveTail, liveTailPlots,
  definitionHasLiveTail, benchmarkTailFor, benchmarkTailUrl, benchmarkTailMaxAgeMs,
  benchmarkTailVersion, liveTailSignature, primeBenchmarkTail, tailBarsFromWire,
  subscribeBenchmarkTails, _resetBenchmarkTailsForTests, __setBenchmarkTailFetcherForTests,
  _inflightBenchmarkTails, BENCHMARK_TAIL_MAX_AGE_MS, BENCHMARK_TAIL_HARD_STALE_FACTOR,
  BENCHMARK_TAIL_BARS,
} from './liveTail'
import { barTimeKey } from './serverCompute'

const F = (xs) => Float64Array.from(xs)
const close = (a, b, eps = 1e-12) => Math.abs(a - b) < eps

// A minimal server-lane definition with a ratio line and its average. The
// benchmark input exists only so an `input:` benchmark can be shown REFUSED.
const DEF = {
  id: 'tailTest', compute: { kind: 'server', fn: 'tailTest', rev: 1 },
  inputs: [
    { key: 'benchmark', type: 'enum', default: 'SPY', options: [['SPY', 'S&P'], ['QQQ', 'Nasdaq']] },
    { key: 'maLength', type: 'int', default: 3, min: 1, max: 200 },
    { key: 'maType', type: 'enum', default: 'EMA', options: [['EMA', 'Exponential'], ['SMA', 'Simple']] },
  ],
  plots: [
    { key: 'ratio', style: 'line', liveTail: { kind: 'ratio', benchmark: 'scalar:benchmark.resolved' } },
    { key: 'avg', style: 'line', liveTail: { kind: 'ma', of: 'ratio', length: 'input:maLength', type: 'input:maType' } },
    { key: 'other', style: 'line' },
  ],
}

const BARS = [
  { t: '2026-11-04', c: 100 }, { t: '2026-11-05', c: 102 }, { t: '2026-11-06', c: 101 },
  { t: '2026-11-09', c: 104 },   // the forming bar; its close moved since the envelope was built
]
// The server's envelope was built when the forming close was 103 and SPY was 500.
const BENCH_STALE = 500
const RS = [100 / 490, 102 / 495, 101 / 498, 103 / BENCH_STALE]
const k = 2 / (3 + 1)
const EMA = [NaN, NaN, (RS[0] + RS[1] + RS[2]) / 3, NaN]
EMA[3] = EMA[2] + k * (RS[3] - EMA[2])
const SMA = [NaN, NaN, (RS[0] + RS[1] + RS[2]) / 3, (RS[1] + RS[2] + RS[3]) / 3]

const columns = (ema = true) => ({ ratio: F(RS), avg: F(ema ? EMA : SMA), other: F([1, 2, 3, 4]) })
const scalars = { benchmark: { requested: 'SPY', resolved: 'SPY', label: 'S&P 500' } }
const tailOf = (bars) => () => ({ bars })
const BENCH_LIVE = 505
const benchTail = tailOf([{ t: '2026-11-06', c: 498 }, { t: '2026-11-09', c: BENCH_LIVE }])
const opts = (over = {}) => ({
  scalars, sym: 'NVDA', tf: 'D', newestBarIsForming: true, timeKey: barTimeKey, tail: benchTail, ...over,
})
const inputs = { benchmark: 'SPY', maLength: 3, maType: 'EMA' }

describe('ratioTail — close / benchmark close', () => {
  it('is the plain ratio, scaled when asked', () => {
    expect(ratioTail(104, 505)).toBe(104 / 505)
    expect(ratioTail(104, 505, 100)).toBe((104 / 505) * 100)
    expect(ratioTail(104, 505, undefined)).toBe(104 / 505)
  })
  it('fails closed on anything that is not two positive finite closes', () => {
    for (const bad of [NaN, Infinity, 0, -1, null, undefined, '104']) {
      expect(Number.isNaN(ratioTail(bad, 505)), `close ${String(bad)}`).toBe(true)
      expect(Number.isNaN(ratioTail(104, bad)), `bench ${String(bad)}`).toBe(true)
    }
    expect(Number.isNaN(ratioTail(104, 505, 0))).toBe(true)
    expect(Number.isNaN(ratioTail(104, 505, -2))).toBe(true)
  })
})

describe('movingAverageTail — the exact one-step continuation', () => {
  const liveRs = 104 / BENCH_LIVE

  it('EMA, case A (the envelope reaches the forming bar): equals a full recompute with the live ratio', () => {
    const got = movingAverageTail({ ma: F(EMA), rs: F(RS), liveRs, length: 3, type: 'EMA' })
    const want = EMA[2] + k * (liveRs - EMA[2])
    expect(close(got, want)).toBe(true)
  })
  it('SMA, case A: equals a full recompute with the live ratio', () => {
    const got = movingAverageTail({ ma: F(SMA), rs: F(RS), liveRs, length: 3, type: 'sma' })
    expect(close(got, (RS[1] + RS[2] + liveRs) / 3)).toBe(true)
  })
  it('EMA, case B (the envelope ends one bar before the chart): one step from the sealed average', () => {
    const ma = F([NaN, NaN, EMA[2], NaN])
    const rs = F([RS[0], RS[1], RS[2], NaN])
    const got = movingAverageTail({ ma, rs, liveRs, length: 3, type: 'EMA' })
    expect(close(got, EMA[2] + k * (liveRs - EMA[2]))).toBe(true)
  })
  it('SMA, case B: drops the L-th finite value back, skipping gaps as the server does', () => {
    // a gap at index 1: the window over VALID values is [RS0, RS2, RS3-ish]; the
    // sealed SMA at index 3 is the mean of the three valid values before it.
    const rs = F([RS[0], NaN, RS[2], RS[3], NaN])
    const sealed = (RS[0] + RS[2] + RS[3]) / 3
    const ma = F([NaN, NaN, NaN, sealed, NaN])
    const got = movingAverageTail({ ma, rs, liveRs, length: 3, type: 'SMA' })
    expect(close(got, (RS[2] + RS[3] + liveRs) / 3)).toBe(true)
    // too few finite values for the window: NaN, never a shorter average
    const short = movingAverageTail({ ma: F([NaN, sealed, NaN]), rs: F([RS[0], RS[1], NaN]), liveRs, length: 3, type: 'SMA' })
    expect(Number.isNaN(short)).toBe(true)
  })
  it('fails closed: no anchor, a seed bar, a bad length, an unknown type, a non-finite live ratio', () => {
    const base = { ma: F(EMA), rs: F(RS), liveRs, length: 3, type: 'EMA' }
    expect(Number.isNaN(movingAverageTail({ ...base, ma: F([NaN, NaN, NaN, NaN]) }))).toBe(true)
    // the last finite average IS the seed (nothing finite before it): refused
    expect(Number.isNaN(movingAverageTail({ ...base, ma: F([NaN, NaN, NaN, EMA[3]]) }))).toBe(true)
    expect(Number.isNaN(movingAverageTail({ ...base, length: 0 }))).toBe(true)
    expect(Number.isNaN(movingAverageTail({ ...base, length: 2.5 }))).toBe(true)
    expect(Number.isNaN(movingAverageTail({ ...base, type: 'WMA' }))).toBe(true)
    expect(Number.isNaN(movingAverageTail({ ...base, liveRs: NaN }))).toBe(true)
    expect(Number.isNaN(movingAverageTail({ ...base, rs: F([1, 2]) }))).toBe(true)   // length mismatch
  })
})

describe('liveBenchmarkSymbol — only a ticker the bars route can serve, never the chart itself', () => {
  it('accepts a plain ticker, upper-cased and trimmed', () => {
    expect(liveBenchmarkSymbol(' spy ', 'NVDA')).toBe('SPY')
    expect(liveBenchmarkSymbol('BRK-B', 'NVDA')).toBe('BRK-B')
  })
  it('refuses a synthetic group, the chart symbol, and non-strings', () => {
    expect(liveBenchmarkSymbol('INDUSTRY:Semiconductors', 'NVDA')).toBeNull()
    expect(liveBenchmarkSymbol('nvda', 'NVDA')).toBeNull()
    expect(liveBenchmarkSymbol('', 'NVDA')).toBeNull()
    expect(liveBenchmarkSymbol(null, 'NVDA')).toBeNull()
    expect(liveBenchmarkSymbol({ resolved: 'SPY' }, 'NVDA')).toBeNull()
  })
})

describe('withLiveTail — the applier', () => {
  it('declares: ratio plots first, and only plots with a tail', () => {
    expect(liveTailPlots(DEF).map((p) => p.key)).toEqual(['ratio', 'avg'])
    expect(definitionHasLiveTail(DEF)).toBe(true)
    expect(definitionHasLiveTail({ plots: [{ key: 'x', style: 'line' }] })).toBe(false)
    expect(definitionHasLiveTail(null)).toBe(false)
  })

  it('moves ONLY the last cell of the ratio and the average; every other cell and column is byte-identical', () => {
    const cols = columns()
    const out = withLiveTail(DEF, cols, BARS, inputs, opts())
    expect(out).not.toBe(cols)
    expect(out.other).toBe(cols.other)                    // untouched column: same reference
    expect(out.ratio).not.toBe(cols.ratio)                // patched column: a copy
    expect(cols.ratio[3]).toBe(RS[3])                     // the cached one is never mutated
    expect(Array.from(out.ratio.slice(0, 3))).toEqual(RS.slice(0, 3))
    expect(out.ratio[3]).toBe(104 / BENCH_LIVE)
    expect(Array.from(out.avg.slice(0, 3)).map((v) => (Number.isNaN(v) ? 'nan' : v)))
      .toEqual(EMA.slice(0, 3).map((v) => (Number.isNaN(v) ? 'nan' : v)))
    expect(close(out.avg[3], EMA[2] + k * (104 / BENCH_LIVE - EMA[2]))).toBe(true)
  })

  it('reads the average type and length from the instance inputs (SMA)', () => {
    const out = withLiveTail(DEF, columns(false), BARS, { ...inputs, maType: 'SMA' }, opts())
    expect(close(out.avg[3], (RS[1] + RS[2] + 104 / BENCH_LIVE) / 3)).toBe(true)
  })

  it('returns the SAME object when nothing changes (memo-stable)', () => {
    const cols = columns()
    const same = tailOf([{ t: '2026-11-09', c: BENCH_STALE }])
    // the benchmark did not move and the close is the envelope's: the value is equal
    const bars = BARS.map((b, i) => (i === 3 ? { ...b, c: 103 } : b))
    expect(withLiveTail(DEF, cols, bars, inputs, opts({ tail: same }))).toBe(cols)
    expect(withLiveTail({ plots: [{ key: 'x', style: 'line' }] }, cols, BARS, inputs, opts())).toBe(cols)
  })

  it('case B: the envelope ends one bar before the chart — the tail extends ratio and average one bar', () => {
    const cols = { ratio: F([RS[0], RS[1], RS[2], NaN]), avg: F([NaN, NaN, EMA[2], NaN]) }
    const out = withLiveTail(DEF, cols, BARS, inputs, opts())
    expect(out.ratio[3]).toBe(104 / BENCH_LIVE)
    expect(close(out.avg[3], EMA[2] + k * (104 / BENCH_LIVE - EMA[2]))).toBe(true)
  })

  describe('⛔ fail closed — the server\'s value stands', () => {
    const unchanged = (o, bars = BARS, ins = inputs, cols = columns()) => {
      expect(withLiveTail(DEF, cols, bars, ins, o)).toBe(cols)
    }
    it('when the newest bar is sealed', () => unchanged(opts({ newestBarIsForming: false })))
    it('when the payload has not landed', () => unchanged(opts({ scalars: null })))
    it('when the resolved benchmark is a synthetic group', () =>
      unchanged(opts({ scalars: { benchmark: { resolved: 'INDUSTRY:Semis' } } })))
    it('when the benchmark is the chart symbol', () =>
      unchanged(opts({ scalars: { benchmark: { resolved: 'NVDA' } } })))
    it('when no benchmark tail has landed', () => unchanged(opts({ tail: () => null })))
    it('when the benchmark tail has no bar at the chart\'s last time (joined BY TIME)', () =>
      unchanged(opts({ tail: tailOf([{ t: '2026-11-06', c: 498 }]) })))
    it('when the benchmark close is not a positive number', () =>
      unchanged(opts({ tail: tailOf([{ t: '2026-11-09', c: NaN }]) })))
    it('when the chart\'s last close is not a positive number', () =>
      unchanged(opts(), BARS.map((b, i) => (i === 3 ? { ...b, c: null } : b))))
    it('when the chart has fewer than two bars', () => unchanged(opts(), BARS.slice(3), inputs, { ratio: F([RS[3]]), avg: F([EMA[3]]) }))
    it('when the column length does not match the bars', () =>
      unchanged(opts(), BARS, inputs, { ratio: F(RS.slice(0, 3)), avg: F(EMA.slice(0, 3)) }))
    it('never STARTS a line: no finite server value on the last two bars ⇒ no patch', () =>
      unchanged(opts(), BARS, inputs, { ratio: F([RS[0], NaN, NaN, NaN]), avg: F([NaN, NaN, NaN, NaN]) }))
    it('an `input:` benchmark is the REQUESTED word, not a ticker — the applier reads nothing from it', () => {
      const def = { ...DEF, plots: [{ key: 'ratio', style: 'line', liveTail: { kind: 'ratio', benchmark: 'input:benchmark' } }] }
      const cols = { ratio: F(RS) }
      // The schema refuses this form; were it to reach the applier, the input's
      // word (`SECTOR`) is asked for as a symbol and no such tail exists, so the
      // store answers null and the server's value stands. The tail reader here is
      // symbol-aware, as the store is.
      const spyOnly = (sym) => (sym === 'SPY' ? benchTail() : null)
      const out = withLiveTail(def, cols, BARS, { benchmark: 'SECTOR' }, opts({ tail: spyOnly }))
      expect(out).toBe(cols)
    })
    it('the average alone fails closed when its type or length does not resolve', () => {
      const cols = columns()
      const out = withLiveTail(DEF, cols, BARS, { ...inputs, maType: 'WMA' }, opts())
      expect(out.ratio[3]).toBe(104 / BENCH_LIVE)      // the ratio still moves
      expect(out.avg).toBe(cols.avg)                   // the average does not
      const out2 = withLiveTail(DEF, cols, BARS, { ...inputs, maLength: 'abc' }, opts())
      expect(out2.avg).toBe(cols.avg)
    })
    it('without a time join or a tail reader there is nothing to prove — untouched', () => {
      unchanged({ ...opts(), timeKey: undefined })
      unchanged({ ...opts(), tail: undefined })
    })
  })
})

describe('the benchmark tail store', () => {
  beforeEach(() => { _resetBenchmarkTailsForTests(); __setBenchmarkTailFetcherForTests(null) })

  it('the URL is the chart\'s own bars route, a handful of bars, the chart\'s timeframe', () => {
    expect(benchmarkTailUrl('SPY', 'D')).toBe(`/api/bars/SPY?tf=D&bars=${BENCHMARK_TAIL_BARS}`)
    expect(benchmarkTailUrl('BRK-B', 5)).toBe(`/api/bars/BRK-B?tf=5&bars=${BENCHMARK_TAIL_BARS}`)
    expect(benchmarkTailUrl('SPY', null)).toBe(`/api/bars/SPY?tf=D&bars=${BENCHMARK_TAIL_BARS}`)
    expect(benchmarkTailUrl('', 'D')).toBeNull()
  })

  it('the max age is HALF the chart\'s own bars poll per timeframe family', () => {
    expect(benchmarkTailMaxAgeMs('D')).toBe(BENCHMARK_TAIL_MAX_AGE_MS.session)
    expect(benchmarkTailMaxAgeMs('W')).toBe(BENCHMARK_TAIL_MAX_AGE_MS.session)
    expect(benchmarkTailMaxAgeMs('5')).toBe(BENCHMARK_TAIL_MAX_AGE_MS.intraday)
    expect(benchmarkTailMaxAgeMs(60)).toBe(BENCHMARK_TAIL_MAX_AGE_MS.intraday)
    // StockChart polls intraday ~30 s and D/W/M 300 s: never faster than the stock
    expect(BENCHMARK_TAIL_MAX_AGE_MS.intraday).toBe(15_000)
    expect(BENCHMARK_TAIL_MAX_AGE_MS.session).toBe(60_000)
  })

  it('parses the bars payload to the newest tail, and refuses a body that is not one', () => {
    expect(tailBarsFromWire({ bars: [{ t: '2026-11-05', c: 1 }, { t: '2026-11-06', c: 2 }, { t: '2026-11-09', c: 3 }, { t: '2026-11-10', c: 4 }] }))
      .toEqual([{ t: '2026-11-06', c: 2 }, { t: '2026-11-09', c: 3 }, { t: '2026-11-10', c: 4 }])
    expect(tailBarsFromWire({ bars: [{ t: 1700000000, c: '5.5' }] })).toEqual([{ t: 1700000000, c: 5.5 }])
    expect(tailBarsFromWire({ bars: [{ t: 1, c: null }] })[0].c).toBeNaN()
    expect(tailBarsFromWire({ ticker: 'SPY' })).toBeNull()
    expect(tailBarsFromWire(null)).toBeNull()
    expect(tailBarsFromWire({ bars: 'nope' })).toBeNull()
  })

  it('asks once per (symbol, timeframe), shares the in-flight request, lands, announces, versions', async () => {
    const calls = []
    const fetcher = (url) => { calls.push(url); return Promise.resolve({ bars: [{ t: '2026-11-09', c: 505 }] }) }
    const landed = []
    const unsub = subscribeBenchmarkTails((key) => landed.push(key))
    expect(benchmarkTailFor('SPY', 'D', { fetcher, now: 1000 })).toBeNull()   // nothing yet, the ask is in flight
    expect(benchmarkTailFor('spy', 'D', { fetcher, now: 1000 })).toBeNull()   // same key, no second request
    expect(benchmarkTailFor('SPY', '5', { fetcher, now: 1000 })).toBeNull()   // another timeframe: its own request
    expect(calls).toEqual([benchmarkTailUrl('SPY', 'D'), benchmarkTailUrl('SPY', '5')])
    expect(benchmarkTailVersion('SPY', 'D')).toBe('0')
    await Promise.all(_inflightBenchmarkTails())
    const hit = benchmarkTailFor('SPY', 'D', { fetcher, now: 1000 })
    expect(hit.bars).toEqual([{ t: '2026-11-09', c: 505 }])
    expect(landed).toEqual(['SPY:D', 'SPY:5'])
    expect(benchmarkTailVersion('SPY', 'D')).not.toBe('0')
    expect(calls.length, 'a fresh entry is not re-asked').toBe(2)
    unsub()
  })

  it('re-asks only when due, serves the newest landed tail meanwhile, and never past the hard-stale cap', async () => {
    const calls = []
    let c = 500
    const fetcher = (url) => { calls.push(url); c += 1; return Promise.resolve({ bars: [{ t: '2026-11-09', c }] }) }
    benchmarkTailFor('SPY', 'D', { fetcher, now: 0 })
    await Promise.all(_inflightBenchmarkTails())
    const v1 = benchmarkTailVersion('SPY', 'D')
    const max = benchmarkTailMaxAgeMs('D')
    // not due: served, not re-asked
    expect(benchmarkTailFor('SPY', 'D', { fetcher, now: max - 1 }).bars[0].c).toBe(501)
    expect(calls.length).toBe(1)
    // due: the stale tail is still served (the newest truth held) and the ask goes out
    expect(benchmarkTailFor('SPY', 'D', { fetcher, now: max }).bars[0].c).toBe(501)
    expect(calls.length).toBe(2)
    await Promise.all(_inflightBenchmarkTails())
    expect(benchmarkTailVersion('SPY', 'D')).not.toBe(v1)
    expect(benchmarkTailFor('SPY', 'D', { fetcher, now: max }).bars[0].c).toBe(502)
    // hard-stale (a tab asleep): nothing is served; the ask goes out
    const later = max + max * BENCHMARK_TAIL_HARD_STALE_FACTOR
    expect(benchmarkTailFor('SPY', 'D', { fetcher, now: later })).toBeNull()
    expect(calls.length).toBe(3)
  })

  it('a failed ask is remembered as "no tail" for one max-age window — no retry storm, nothing served', async () => {
    const calls = []
    const fetcher = (url) => { calls.push(url); return Promise.reject(new Error('HTTP 402')) }
    expect(benchmarkTailFor('SPY', 'D', { fetcher, now: 0 })).toBeNull()
    await Promise.all(_inflightBenchmarkTails())
    expect(benchmarkTailFor('SPY', 'D', { fetcher, now: 1 })).toBeNull()
    expect(benchmarkTailFor('SPY', 'D', { fetcher, now: 2 })).toBeNull()
    expect(calls.length).toBe(1)
    expect(benchmarkTailFor('SPY', 'D', { fetcher, now: benchmarkTailMaxAgeMs('D') })).toBeNull()
    expect(calls.length).toBe(2)
    // a malformed body is a failure too
    const bad = (u) => Promise.resolve({ nope: true })
    _resetBenchmarkTailsForTests()
    benchmarkTailFor('QQQ', 'D', { fetcher: bad, now: 0 })
    await Promise.all(_inflightBenchmarkTails())
    expect(benchmarkTailFor('QQQ', 'D', { fetcher: bad, now: 1 })).toBeNull()
  })

  it('⛔ the store holds no request of its own: UNREGISTERED IS OFF, and the host\'s registration arms it', () => {
    // `test-setup.js` took the door's request away before this test; nothing is asked
    expect(benchmarkTailFor('SPY', 'D', { now: 0 })).toBeNull()
    expect(_inflightBenchmarkTails()).toEqual([])
    // the host registers one (the test host's spelling of `registerBenchmarkTailRequest`)
    const calls = []
    __setBenchmarkTailFetcherForTests((u) => { calls.push(u); return Promise.resolve({ bars: [] }) })
    benchmarkTailFor('SPY', 'D', { now: 0 })
    expect(calls).toEqual([benchmarkTailUrl('SPY', 'D')])
    // ...and takes it away again: a due entry is not re-asked, the server's value stands
    __setBenchmarkTailFetcherForTests(null)
    _resetBenchmarkTailsForTests()
    expect(benchmarkTailFor('SPY', 'D', { now: 0 })).toBeNull()
    expect(_inflightBenchmarkTails()).toEqual([])
    expect(calls).toHaveLength(1)
    // a non-function registration is a disarm, never a throw on the paint path
    __setBenchmarkTailFetcherForTests('fetch')
    expect(benchmarkTailFor('SPY', 'D', { now: 0 })).toBeNull()
    expect(_inflightBenchmarkTails()).toEqual([])
  })

  it('⭐ the chart door (`serverCompute.js`) registers the browser\'s request on import — the same fetch its envelopes use', async () => {
    // A fresh module graph, as the browser loads one: the door imports the store and arms it before any compute.
    vi.resetModules()
    const seen = []
    const realFetch = globalThis.fetch
    globalThis.fetch = (url, init) => { seen.push([url, init]); return Promise.resolve({ ok: true, json: () => Promise.resolve({ bars: [{ t: '2026-11-09', c: 505 }] }) }) }
    try {
      const store = await import('./liveTail')
      expect(store.benchmarkTailFor('SPY', 'D', { now: 0 }), 'before the door: nothing asked').toBeNull()
      expect(seen).toEqual([])
      await import('./serverCompute')
      expect(store.benchmarkTailFor('SPY', 'D', { now: 0 })).toBeNull()   // the ask is in flight
      expect(seen).toEqual([[store.benchmarkTailUrl('SPY', 'D'), { credentials: 'include' }]])
      await Promise.all(store._inflightBenchmarkTails())
      expect(store.benchmarkTailFor('SPY', 'D', { now: 1 }).bars).toEqual([{ t: '2026-11-09', c: 505 }])
      // a non-2xx answer is a failed ask: remembered as "no tail", never served
      store._resetBenchmarkTailsForTests()
      globalThis.fetch = () => Promise.resolve({ ok: false, status: 402, json: () => Promise.resolve({ bars: [] }) })
      store.benchmarkTailFor('QQQ', 'D', { now: 0 })
      await Promise.all(store._inflightBenchmarkTails())
      expect(store.benchmarkTailFor('QQQ', 'D', { now: 1 })).toBeNull()
      expect(store.benchmarkTailVersion('QQQ', 'D')).not.toBe('0')
    } finally {
      globalThis.fetch = realFetch
      vi.resetModules()
    }
  })

  it('`primeBenchmarkTail` seeds an entry; the signature names the resolved benchmark and its version', () => {
    expect(liveTailSignature(DEF, scalars, inputs, 'NVDA', 'D')).toBe('SPY:D@0')
    primeBenchmarkTail('SPY', 'D', [{ t: '2026-11-09', c: 505 }], 0)
    expect(liveTailSignature(DEF, scalars, inputs, 'NVDA', 'D')).toBe('SPY:D@1')
    // no payload yet, a synthetic benchmark, the chart's own symbol, no tail declared: ''
    expect(liveTailSignature(DEF, null, inputs, 'NVDA', 'D')).toBe('')
    expect(liveTailSignature(DEF, { benchmark: { resolved: 'INDUSTRY:x' } }, inputs, 'NVDA', 'D')).toBe('')
    expect(liveTailSignature(DEF, scalars, inputs, 'SPY', 'D')).toBe('')
    expect(liveTailSignature({ plots: [{ key: 'x' }] }, scalars, inputs, 'NVDA', 'D')).toBe('')
  })
})
