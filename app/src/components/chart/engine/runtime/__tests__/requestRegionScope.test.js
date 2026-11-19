// ─── ⭐⭐ PERF (Fred RS 5m profile, 2026-11-19, item c) — A REQUEST'S SUB-RUN KEEPS ONLY WHAT ITS REGION OBSERVES ───
//
// `vm.js::execute`, run from a request's entry (`runRequest`), allocates only the outputs the region EMITs and
// commits only the history rings the region can read (`requestRegionScopeOf`). Everything else it used to pay for
// at the requested series' length (the main program's rings and outputs, every call site's rings) is never read in
// a sub-run. These rails hold the scoped sub-run to the whole one BIT FOR BIT (the seam `__requestScopeOffForTests`
// runs every region whole, as before):
//   * through the product path (`computeRuntimeColumns`), on request shapes that read a ring, keep `var` state in a
//     function, merge weekly, read another symbol and hand back a tuple;
//   * region by region, on EVERY request region that builds from the in-repo population (corpus/committed, the RS
//     script, every vendor capture's script, and the shapes below) on a daily, weekly, hourly and 5-minute chart,
//     over three series each: the outputs (sha-256), every budget count, the stop and what was requested, equal.
// And the footprint itself: what it names, and that an opcode it has not reasoned about runs the region whole.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import crypto from 'node:crypto'
import { Buffer } from 'node:buffer'
import { computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers } from '../runtimeColumns.js'
import { execute, requestRegionScopeOf, __requestScopeOffForTests } from '../vm.js'
import { Budget } from '../limits.js'
import { OP } from '../program.js'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { runtimeClockOpts } from '../../ast/pineRuntimeClock.js'

const REPO = path.resolve(process.cwd(), '..')

beforeEach(() => { resetRuntimeSessions(); resetRuntimeLedgers() })
afterEach(() => { __requestScopeOffForTests(false) })

// ─── synthetic series, deterministic ──────────────────────────────────────────────────────────────────────────────
function weekdays(n, from = '2019-01-07') {
  const out = []
  const d = new Date(`${from}T00:00:00Z`)
  while (out.length < n) {
    const w = d.getUTCDay()
    if (w !== 0 && w !== 6) out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}
const priced = (times, base, k = 1) => times.map((t, i) => {
  const c = base + k * (Math.sin(i / 11) * 6 + Math.cos(i / 29) * 3 + i * 0.01)
  return { t, o: c - 0.4 * k, h: c + 1.1 * k + (i % 5) * 0.01, l: c - 1.2 * k, c, v: 1e6 + (i % 13) * 1000 }
})
function intradayTimes(step, n) {
  const out = []
  let t = Date.UTC(2026, 9, 5, 13, 30) / 1000
  while (out.length < n) {
    const d = new Date(t * 1000)
    const mins = d.getUTCHours() * 60 + d.getUTCMinutes()
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && mins >= 13 * 60 + 30 && mins < 20 * 60) out.push(t)
    t += step * 60
  }
  return out
}
const DAILY = priced(weekdays(1500), 100)
const WEEKLY = priced(weekdays(400 * 5).filter((_, i) => i % 5 === 4), 100, 2)
const HOURLY = priced(intradayTimes(60, 1200), 300, 0.5)
const FIVE = priced(intradayTimes(5, 2000), 300, 0.2)
const OTHER = priced(weekdays(2600, '2015-01-05'), 500, 1.7)
const CONTEXTS = { D: DAILY, W: WEEKLY, 60: HOURLY, 5: FIVE }
const SERIES = { own: null, week: WEEKLY.slice(-300), other: OTHER }
const SYMBOL = { ticker: 'SPY', exchange: 'NYSE Arca', securityType: 'fund', industry: 'Investment Trusts/Mutual Funds', sector: 'Miscellaneous' }

// ─── the shapes: each request reads something a scoped sub-run must keep ──────────────────────────────────────────
const HEAD = '//@version=6\nindicator("scope", overlay = false)\n'
const SHAPES = {
  'an expression with a bar field\'s history': 'plot(request.security("AMEX:SPY", timeframe.period, close[1] + high - low))',
  'a window over a bar field': 'plot(request.security("AMEX:SPY", timeframe.period, ta.sma(close, 3)))',
  'a window over a computed series (its ring)': 'plot(request.security("AMEX:SPY", timeframe.period, ta.sma(close * 2 - open, 5)))',
  'a weekly merge of a window': 'plot(request.security(syminfo.tickerid, "W", ta.sma(close, 5)))',
  'a monthly merge of a recurrence': 'plot(request.security(syminfo.tickerid, "M", ta.ema(close, 4)))',
  'a function keeping `var` state': 'cnt() =>\n    var int n = 0\n    n += 1\n    n\nplot(request.security("AMEX:SPY", timeframe.period, cnt()))',
  'a tuple of windows': '[a, b] = request.security("AMEX:SPY", timeframe.period, [ta.highest(high, 4), ta.lowest(low, 4)])\nplot(a)\nplot(b)',
  'a two-input recurrence': 'plot(request.security("AMEX:SPY", timeframe.period, ta.valuewhen(close > open, close, 1)))',
  'functions calling functions (a call site\'s ring)': 'u(x) => ta.rsi(x, 5)\nv(x) => u(x) + ta.change(x)\nplot(request.security("AMEX:SPY", timeframe.period, v(close)))',
  'a main program with rings of its own beside the request': 'x = ta.ema(close, 9)\nplot(x[1])\nplot(request.security(syminfo.tickerid, "W", ta.atr(3)))',
  'a call site\'s ring after the main program\'s own': 'z = ta.sma(close, 4) - open\nplot(z[2])\nplot(z[1])\nu(x) => ta.rsi(x, 5)\nv(x) => u(x) + ta.change(x)\nplot(request.security("AMEX:SPY", timeframe.period, v(close)))',
}

const sha = (cols) => {
  const h = crypto.createHash('sha256')
  for (const c of cols) h.update(Buffer.from(Float64Array.from(c).buffer))
  return h.digest('hex')
}

/** One region's sub-run, whole (`off`) or scoped, over `bars`: what it hands back and what it charged. */
function subRun(program, site, bars, off) {
  __requestScopeOffForTests(off)
  const budget = new Budget()
  const requested = new Set()
  const pick = (k) => Float64Array.from(bars.map((b) => b[k]))
  let res = null
  let stop = null
  try {
    res = execute(program, {
      bars: bars.length, series: [pick('o'), pick('h'), pick('l'), pick('c'), pick('v')],
      columns: program.columns, confirmed: true, barTimes: bars.map((b) => b.t),
    }, undefined, { entry: site.entry, budget, requested, requestCache: new Map(), requestDepth: 1, now: () => 0 })
  } catch (e) { stop = `${e.name}: ${e.message}` }
  __requestScopeOffForTests(false)
  const outs = res ? Array.from({ length: site.results }, (_, k) => res.outputs[k]) : []
  return {
    sha: res ? sha(outs) : null, stop, counts: { ...budget.counts }, requested: [...requested].sort(),
    finite: outs.reduce((a, c) => a + Array.from(c).filter(Number.isFinite).length, 0),
  }
}

function population() {
  const out = []
  const seen = new Set()
  const add = (key, src) => { if (/\bsecurity\s*\(/.test(src) && !seen.has(src)) { seen.add(src); out.push({ key, src }) } }
  for (const dir of ['corpus/committed', 'docs/pine/rs-rating']) {
    const abs = path.join(REPO, dir)
    for (const f of fs.readdirSync(abs).filter((x) => x.endsWith('.pine')).sort()) add(`${dir}/${f}`, fs.readFileSync(path.join(abs, f), 'utf8'))
  }
  const caps = path.join(REPO, 'tests/fixtures/vendor/harness')
  for (const f of fs.readdirSync(caps).filter((x) => x.endsWith('.json')).sort()) {
    const raw = fs.readFileSync(path.join(caps, f), 'utf8')
    if (!/security\s*\(/.test(raw)) continue
    let j = null
    try { j = JSON.parse(raw) } catch { continue }
    if (j && j.source && typeof j.source.text === 'string') add(`capture ${f}`, j.source.text)
  }
  for (const [name, body] of Object.entries(SHAPES)) add(`shape: ${name}`, HEAD + body)
  return out
}

describe('the scoped sub-run equals the whole one, region by region, over the in-repo population', () => {
  it('every request region that builds, on four chart timeframes, over three series: outputs, budget, stop', () => {
    let regions = 0
    let withRings = 0
    let withFunctions = 0
    let fewerRings = 0
    const diffs = []
    const scripts = new Set()
    for (const { key, src } of population()) {
      for (const [tf, chart] of Object.entries(CONTEXTS)) {
        let program
        try {
          const b = buildRuntimeIr(src, { bars: chart, inputs: {}, pane: true, plotColours: true, tf, basePeriod: tf, symbol: SYMBOL,
            objectsInRun: true, ...runtimeClockOpts(false, { tf }), historyFromListing: true })
          if (!b.ok) continue
          program = lowerIrProgram(b.ir, { historyFromListing: true })
        } catch { continue }
        for (const site of program.requests || []) {
          const scope = requestRegionScopeOf(program, site.entry)
          expect(scope, `${key} @${tf}: a served region is scoped`).not.toBeNull()
          // the results are among the outputs the region EMITs
          for (let k = 0; k < site.results; k += 1) expect(Array.from(scope.outs), `${key} @${tf}`).toContain(k)
          regions += 1
          scripts.add(key)
          if (scope.rings.length) withRings += 1
          if (scope.rings.length < (program.history || []).length) fewerRings += 1
          if ((program.code || []).length && Array.from({ length: program.instructions }, (_, pc) => pc)
            .some((pc) => pc >= site.entry && program.code[pc * 3] === OP.CALL)) withFunctions += 1
          for (const [name, given] of Object.entries(SERIES)) {
            const bars = given || chart
            const whole = subRun(program, site, bars, true)
            const scoped = subRun(program, site, bars, false)
            if (scoped.sha !== whole.sha || scoped.stop !== whole.stop || JSON.stringify(scoped.counts) !== JSON.stringify(whole.counts)
              || scoped.requested.join() !== whole.requested.join()) {
              diffs.push(`${key} @${tf} region ${site.entry} over ${name}`)
            }
            // a real read, not two blanks agreeing
            if (!whole.stop) expect(whole.finite, `${key} @${tf} over ${name}: draws`).toBeGreaterThan(0)
          }
        }
      }
    }
    expect(diffs).toEqual([])
    // ⛔ never vacuous: the population holds regions, regions that read rings, regions that call functions, and
    // regions that commit fewer rings than their program holds (measured 2026-11-19: 107 regions of 16 scripts, 24
    // reading rings, 8 calling functions, 35 committing fewer rings; the floors are about half, so a corpus that
    // grows or a refusal that moves does not turn this red, and a population that empties does)
    expect(regions).toBeGreaterThanOrEqual(50)
    expect(scripts.size).toBeGreaterThanOrEqual(8)
    expect(withRings).toBeGreaterThanOrEqual(10)
    expect(withFunctions).toBeGreaterThanOrEqual(2)
    expect(fewerRings).toBeGreaterThanOrEqual(15)
  }, 240000)
})

// ─── through the product path ──────────────────────────────────────────────────────────────────────────────────────
const CHART = DAILY.slice(-400)
const SPY = priced(weekdays(1500), 400, 1.3).slice(-400)
const ctxOf = () => ({
  tf: 'D', newestBarIsForming: false, historyFromListing: true,
  symbol: { ticker: 'RDDT', exchange: 'NYSE' },
  secondary: new Map([['SPY', { bars: SPY, status: 'available' }]]),
  exchangeOf: (t) => (t === 'SPY' ? 'NYSE Arca' : null),
})
const doc = (body, outputs) => ({
  id: 'scope', meta: { runtimeHistory: 'listing' },
  compute: { kind: 'runtime', fn: 'runtime:scope', outputs, source: `${HEAD}${body}` },
})
function bothWays(body, outputs) {
  __requestScopeOffForTests(true)
  resetRuntimeSessions(); resetRuntimeLedgers()
  const whole = computeRuntimeColumns(doc(body, outputs), CHART, ctxOf())
  __requestScopeOffForTests(false)
  resetRuntimeSessions(); resetRuntimeLedgers()
  const scoped = computeRuntimeColumns(doc(body, outputs), CHART, ctxOf())
  return { whole, scoped }
}
/** Bit for bit: every element `Object.is`-equal (NaN equals NaN, -0 is not 0). */
function expectIdentical(a, b, label) {
  expect(a.length, label).toBe(b.length)
  const bad = []
  for (let i = 0; i < a.length; i += 1) if (!Object.is(a[i], b[i])) bad.push(`${i}: ${a[i]} vs ${b[i]}`)
  expect(bad.slice(0, 5), label).toEqual([])
}

describe('through the product path, the scoped run draws what the whole one drew', () => {
  const PRODUCT = [
    ['a window over a computed series', SHAPES['a window over a computed series (its ring)'], { a: 0 }],
    ['a weekly merge of a window', SHAPES['a weekly merge of a window'], { a: 0 }],
    ['a function keeping `var` state', SHAPES['a function keeping `var` state'], { a: 0 }],
    ['a tuple of windows', SHAPES['a tuple of windows'], { a: 0, b: 1 }],
    ['functions calling functions', SHAPES['functions calling functions (a call site\'s ring)'], { a: 0 }],
    ['a main program with rings of its own', SHAPES['a main program with rings of its own beside the request'], { a: 0, b: 1 }],
    ['a call site\'s ring after the main program\'s own', SHAPES['a call site\'s ring after the main program\'s own'], { a: 0, b: 1, c: 2 }],
  ]
  for (const [name, body, outputs] of PRODUCT) {
    it(name, () => {
      const { whole, scoped } = bothWays(body, outputs)
      for (const k of Object.keys(outputs)) {
        expectIdentical(scoped[k], whole[k], `${name}: ${k}`)
        expect(Array.from(scoped[k]).some(Number.isFinite), `${name}: ${k} draws`).toBe(true)
      }
    })
  }
})

// ─── the footprint ─────────────────────────────────────────────────────────────────────────────────────────────────
const programOf = (body, tf = 'D', bars = DAILY) => {
  const b = buildRuntimeIr(`${HEAD}${body}`, { bars, inputs: {}, pane: true, plotColours: true, tf, basePeriod: tf, symbol: SYMBOL,
    objectsInRun: true, ...runtimeClockOpts(false, { tf }), historyFromListing: true })
  expect(b.ok, b.ok ? '' : b.refusal.message).toBe(true)
  return lowerIrProgram(b.ir, { historyFromListing: true })
}

describe('what a region can observe', () => {
  it('a bare field reads no ring; a window over a computed series reads its source ring; outputs are the results', () => {
    const bare = programOf('plot(request.security("AMEX:SPY", timeframe.period, close))')
    expect(requestRegionScopeOf(bare, bare.requests[0].entry)).toEqual({ rings: Int32Array.from([]), outs: Int32Array.from([0]) })
    const ringed = programOf(SHAPES['a window over a computed series (its ring)'])
    const scope = requestRegionScopeOf(ringed, ringed.requests[0].entry)
    expect(Array.from(scope.rings)).toHaveLength(1)
    expect(ringed.history[scope.rings[0]].site).toBe(null)
    const tuple = programOf(SHAPES['a tuple of windows'])
    expect(Array.from(requestRegionScopeOf(tuple, tuple.requests[0].entry).outs)).toEqual([0, 1])
  })

  it('a ring read inside a function is named at its CALL SITE\'s base, not the main frame\'s', () => {
    for (const shape of ['functions calling functions (a call site\'s ring)', 'a call site\'s ring after the main program\'s own']) {
      const p = programOf(SHAPES[shape])
      const scope = requestRegionScopeOf(p, p.requests[0].entry)
      expect(scope.rings.length, shape).toBeGreaterThan(0)
      for (const r of scope.rings) expect(p.history[r].site, `${shape}: a call site's ring`).not.toBe(null)
    }
    // and in the second the call site's rings sit AFTER the main program's own, at a base above 0
    const p = programOf(SHAPES['a call site\'s ring after the main program\'s own'])
    expect(p.history.findIndex((h) => h.site !== null)).toBeGreaterThan(0)
  })

  it('the main program\'s own rings are not the region\'s: fewer rings are committed than the program holds', () => {
    const p = programOf(SHAPES['a main program with rings of its own beside the request'])
    const scope = requestRegionScopeOf(p, p.requests[0].entry)
    expect(p.history.length).toBeGreaterThan(scope.rings.length)
    expect(p.outputs.length).toBeGreaterThan(scope.outs.length)
  })

  it('⛔ an opcode the footprint has not reasoned about runs the region whole (null)', () => {
    const p = programOf(SHAPES['a window over a computed series (its ring)'])
    const entry = p.requests[0].entry
    expect(requestRegionScopeOf(p, entry)).not.toBeNull()
    // the same program with a drawing op planted in the region
    const code = Int32Array.from(p.code)
    code[entry * 3] = OP.OBJECT
    expect(requestRegionScopeOf({ ...p, code }, entry)).toBeNull()
    // and the main program is never scoped
    expect(requestRegionScopeOf(p, 0)).toBeNull()
  })

  it('the RS script: its regions commit fewer rings and fill fewer outputs than the program holds', () => {
    const src = fs.readFileSync(path.join(REPO, 'docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine'), 'utf8')
    const b = buildRuntimeIr(src, { bars: DAILY, inputs: {}, pane: true, plotColours: true, tf: 'D', basePeriod: 'D', symbol: SYMBOL,
      objectsInRun: true, ...runtimeClockOpts(false, { tf: 'D' }), historyFromListing: true })
    expect(b.ok, b.ok ? '' : b.refusal.message).toBe(true)
    const p = lowerIrProgram(b.ir, { historyFromListing: true })
    expect(p.requests.length).toBeGreaterThan(0)
    for (const site of p.requests) {
      const scope = requestRegionScopeOf(p, site.entry)
      expect(scope.rings.length).toBeLessThan(p.history.length)
      expect(scope.outs.length).toBeLessThan(p.outputs.length)
    }
  })
})
