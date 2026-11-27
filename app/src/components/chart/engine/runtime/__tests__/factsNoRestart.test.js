// app/src/components/chart/engine/runtime/__tests__/factsNoRestart.test.js
//
// ⭐⭐ (e101 S1) — A SYMBOL FACT LANDING NEVER RESTARTS A RUN (`runtimeAsync.js::supersede`), AND THE RUN ASKED UNDER
// THE NEW FACTS RESUMES FROM THE ONE THAT RAN (`runtimeColumns.js::factsSessionFor`), PROVED BY `resumableFrom`.
//
// Measured on production (608bd20bf1, kernel-channel-backquant, cold ticker switches): PEP posted the same run at
// 18.8 / 174 / 561 ms and KO at 14 / 733 / 896 ms, each right after the listing date (`/api/ticker-ipo`) or the
// exchange (`/api/ticker-meta`) landed. The worker was terminated twice per switch, for facts the script never reads.
import { describe, it, expect, afterEach } from 'vitest'
import { workerRunner, resetRuntimeAsync, runtimeWorkerStats } from '../runtimeAsync.js'
import {
  computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers, runtimeIncrementalOf, setRuntimeRunner,
  __factsResumeOffForTests,
} from '../runtimeColumns.js'

const H = ['//@version=6', 'indicator("facts")']
const src = (...lines) => [...H, ...lines].join('\n')
// a history-dependent script that reads no symbol fact (the kernel channel's shape: state over bars)
const PLAIN = src('var float s = 0.0', 's := s + close * 0.5', 'plot(s + ta.ema(close, 5))')
let n = 0
const doc = (source) => {
  n += 1
  const id = `u_facts${n}`
  return { id, meta: { runtimeHistory: 'listing' }, compute: { kind: 'runtime', fn: `runtime:${id}`, outputs: { a: 0 }, source } }
}
const DAYS = Array.from({ length: 60 }, (_, i) => new Date(Date.UTC(2025, 0, 6) + i * 86400000).toISOString().slice(0, 10))
const BARS = DAYS.map((t, i) => ({ t, o: 100 + i, h: 103 + i, l: 98 + i, c: 101 + i + (i % 7) * 0.25, v: 1000 + 13 * i }))
const sym = (facts) => ({ ticker: 'PEP', ...facts })
const ctxOf = (facts, extra = {}) => ({ tf: 'D', historyFromListing: true, newestBarIsForming: false, symbol: sym(facts), ...extra })
// the three asks one cold switch made, in order
const PENDING = { exchange: null, firstTradeDatePending: true }
const DATED = { exchange: null, firstTradeDate: '1972-06-01' }
const SETTLED = { exchange: 'NASDAQ', firstTradeDate: '1972-06-01' }

afterEach(() => {
  resetRuntimeAsync(); setRuntimeRunner(null); resetRuntimeSessions(); resetRuntimeLedgers(); __factsResumeOffForTests(false)
})

const cold = (d, rows, ctx) => {
  resetRuntimeSessions()
  __factsResumeOffForTests(true)
  try { return Array.from(computeRuntimeColumns(d, rows, ctx).a) } finally { __factsResumeOffForTests(false) }
}

describe('the run asked under the new facts resumes from the run that ran', () => {
  it('⭐ PENDING -> DATED -> SETTLED: each later ask resumes (one bar re-run) and equals a cold run bit for bit', () => {
    const d = doc(PLAIN)
    const a = computeRuntimeColumns(d, BARS, ctxOf(PENDING))
    expect(runtimeIncrementalOf(a).ranBars).toBe(BARS.length)
    for (const facts of [DATED, SETTLED]) {
      const b = computeRuntimeColumns(d, BARS, ctxOf(facts))
      const inc = runtimeIncrementalOf(b)
      expect(inc.resumedFrom).toBe(BARS.length - 1)
      expect(inc.ranBars).toBe(0)
      const got = Array.from(b.a)
      expect(got).toEqual(cold(d, BARS, ctxOf(facts)))
      // non-vacuity: the script is history-dependent and draws (the EMA's first 4 bars are na)
      expect(got.filter(Number.isFinite).length).toBe(BARS.length - 4)
    }
  })

  it('⛔ CONTROL: with the facts resume off, the later ask is a full run (what every switch paid)', () => {
    const d = doc(PLAIN)
    computeRuntimeColumns(d, BARS, ctxOf(PENDING))
    __factsResumeOffForTests(true)
    expect(runtimeIncrementalOf(computeRuntimeColumns(d, BARS, ctxOf(SETTLED))).ranBars).toBe(BARS.length)
  })

  it('⛔ a script that READS a symbol fact is never served across it: a full run, its own (different) values', () => {
    // `syminfo.prefix` reads the exchange (erased by the facts key; both are witnessed, `symbolScope.json`): folded
    // into the program, so `sameProgram` refuses the other session
    const d = doc(src('plot(syminfo.prefix == "NASDAQ" ? close : -close)'))
    const a = Array.from(computeRuntimeColumns(d, BARS, ctxOf({ exchange: 'NASDAQ' })).a)
    const bCols = computeRuntimeColumns(d, BARS, ctxOf({ exchange: 'NYSE' }))
    expect(runtimeIncrementalOf(bCols).ranBars).toBe(BARS.length)
    const b = Array.from(bCols.a)
    expect(b).toEqual(cold(d, BARS, ctxOf({ exchange: 'NYSE' })))
    expect(b).not.toEqual(a) // non-vacuity: the fact changes the answer
  })

  it('⛔ a fact folded into the PROGRAM (a function body, a `var` seed, a loop), not a column: `sameProgram` refuses it', () => {
    // MEASURED (remote run, 2026-11-27): a NUMERIC read of a fact is lifted into a precomputed column wherever it is
    // written (a function body, a `var` seed, a loop: all three refused by `sameColumnsTo`, "a column before the
    // checkpoint changed"). A STRING fact cannot live in a Float64 column: it is a program constant, so ONLY
    // `sameProgram` can refuse the other session (mutant F2)
    const candidates = {
      varString: ['var string p = syminfo.prefix', 'plot(str.length(p) + close)'],
      concat: ['string q = syminfo.prefix + ":x"', 'plot(str.length(q) + close)'],
      fnBody: ['f(x) => syminfo.prefix == "NASDAQ" ? x + 1 : x - 1', 'var float s = 0.0', 's := f(s)', 'plot(s + close)'],
    }
    const whys = {}
    for (const [name, body] of Object.entries(candidates)) {
      const d = doc(src(...body))
      const a = Array.from(computeRuntimeColumns(d, BARS, ctxOf({ exchange: 'NASDAQ' })).a)
      const bCols = computeRuntimeColumns(d, BARS, ctxOf({ exchange: 'NYSE' }))
      const inc = runtimeIncrementalOf(bCols)
      whys[name] = inc.why
      expect(inc.ranBars, name).toBe(BARS.length)
      const b = Array.from(bCols.a)
      expect(b, name).toEqual(cold(d, BARS, ctxOf({ exchange: 'NYSE' })))
      expect(b, name).not.toEqual(a)
    }
    // non-vacuity: at least one candidate is refused by the PROGRAM check, not the columns one
    expect(Object.values(whys), JSON.stringify(whys)).toContain('the program changed')
  })

  it('⛔ a run with request sites is never served across facts (the listing date and the bind are read outside the program)', () => {
    const SPY = DAYS.map((t, i) => ({ t, o: 500, h: 505, l: 495, c: 500 + 2 * i, v: 9000 }))
    const extra = { exchangeOf: (t) => (t === 'SPY' ? 'NYSE Arca' : null),
      secondary: new Map([['SPY', { status: 'available', exchange: 'NYSE Arca', bars: SPY }]]) }
    const d = doc(src('plot(nz(request.security("AMEX:SPY", timeframe.period, close), -1))'))
    const a = computeRuntimeColumns(d, BARS, ctxOf({ exchange: null }, extra))
    expect(Array.from(a.a)).toEqual(SPY.map((b) => b.c)) // non-vacuity: the request is served
    const b = computeRuntimeColumns(d, BARS, ctxOf({ exchange: 'NASDAQ' }, extra))
    expect(runtimeIncrementalOf(b).ranBars).toBe(BARS.length)
  })

  it('⛔ a run that keeps a realtime ledger (a `varip`) is never served across facts', () => {
    const d = doc(src('varip float k = 0.0', 'k := k + 1', 'plot(k + close)'))
    computeRuntimeColumns(d, BARS, ctxOf(PENDING))
    expect(runtimeIncrementalOf(computeRuntimeColumns(d, BARS, ctxOf(SETTLED))).ranBars).toBe(BARS.length)
  })

  it('⛔ another timeframe, forming state or listing fact is another run: never served across', () => {
    const d = doc(PLAIN)
    computeRuntimeColumns(d, BARS, ctxOf(PENDING))
    for (const extra of [{ tf: 'W' }, { newestBarIsForming: true }]) {
      const b = computeRuntimeColumns(d, BARS, ctxOf(SETTLED, extra))
      expect(runtimeIncrementalOf(b).resumedFrom, JSON.stringify(extra)).toBe(null)
    }
  })
})

/** Workers that hold every message until `flush()`, and record a terminate. */
function manualWorkers() {
  const made = []
  const factory = () => {
    const w = {
      posted: [], queue: [], terminated: false,
      postMessage(msg) { this.posted.push(msg); this.queue.push(msg) },
      flush() {
        const q = this.queue
        this.queue = []
        for (const msg of q) {
          if (!this.onmessage) continue
          const columns = computeRuntimeColumns(msg.def, msg.rows, msg.ctx)
          this.onmessage({ data: { id: msg.id, ok: true, columns } })
        }
      },
      terminate() { this.terminated = true },
    }
    made.push(w)
    return w
  }
  return { factory, made }
}
const paneCtx = (facts, extra = {}) => ({ ...ctxOf(facts, extra), hostPane: 'pane-1' })

describe('a symbol fact landing never stops the running job', () => {
  it('⭐ the measured switch: PENDING, DATED, SETTLED asked while the first runs: one worker, never terminated, the newest asked next', () => {
    const w = manualWorkers()
    const run = workerRunner(w.factory)
    const d = doc(PLAIN)
    const answered = []
    run(d, BARS, paneCtx(PENDING), (err) => answered.push(['pending', err]))
    run(d, BARS, paneCtx(DATED), () => answered.push(['dated']))
    run(d, BARS, paneCtx(SETTLED), (err, cols) => answered.push(['settled', err, runtimeIncrementalOf(cols).ranBars]))
    expect(w.made.length).toBe(1)
    expect(w.made[0].terminated).toBe(false)
    expect(runtimeWorkerStats()).toMatchObject({ factsKept: 2, cancelled: 0, superseded: 0 })
    w.made[0].flush()
    w.made[0].flush()
    // the first run answers under its own key; the dated ask was replaced while waiting; the settled one resumed
    expect(answered).toEqual([['pending', null], ['settled', null, 0]])
    expect(w.made.length).toBe(1)
  })

  it('⛔ a script that names a symbol fact keeps today\'s stop (syminfo, request., ticker., import)', () => {
    const bodies = [
      ['plot(syminfo.prefix == "NASDAQ" ? close : 0)'],
      ['plot(nz(request.security("AMEX:SPY", "D", close)))'],
      ['t = ticker.new("NASDAQ", "AAPL")', 'plot(close)'],
      ['import TradingView/ta/7 as tvta', 'plot(close)'],
    ]
    for (const body of bodies) {
      resetRuntimeAsync()
      const w = manualWorkers()
      const run = workerRunner(w.factory)
      const d = doc(src(...body))
      run(d, BARS, paneCtx(PENDING), () => {})
      run(d, BARS, paneCtx(SETTLED), () => {})
      expect(w.made[0].terminated, body.join(' / ')).toBe(true)
      expect(runtimeWorkerStats().factsKept).toBe(0)
    }
  })

  it('⭐ a mention in a comment or a string is not a read', () => {
    const w = manualWorkers()
    const run = workerRunner(w.factory)
    const d = doc(src('// syminfo.ticker and request.security are not used here', 'plot(close, "syminfo.prefix")'))
    run(d, BARS, paneCtx(PENDING), () => {})
    run(d, BARS, paneCtx(SETTLED), () => {})
    expect(w.made[0].terminated).toBe(false)
  })

  it('⛔ facts AND another picture (timeframe, ticker, listing flag): stopped as today', () => {
    for (const newer of [paneCtx(SETTLED, { tf: '60' }), { ...paneCtx(SETTLED), symbol: { ticker: 'KO', ...SETTLED } },
      paneCtx(SETTLED, { historyFromListing: false })]) {
      resetRuntimeAsync()
      const w = manualWorkers()
      const run = workerRunner(w.factory)
      const d = doc(PLAIN)
      run(d, BARS, paneCtx(PENDING), () => {})
      run(d, BARS, newer, () => {})
      expect(w.made[0].terminated).toBe(true)
    }
  })
})
