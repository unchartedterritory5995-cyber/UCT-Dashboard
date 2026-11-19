// ─── ⭐⭐ PERF (Fred RS 5m profile, 2026-11-19, item d) — A BUILD KEPT ACROSS SYMBOL AND TIMEFRAME SWITCHES ──────
//
// `runtimeColumns.js` keeps a run's cold build (`buildRecorder`) in a bounded memo keyed on every build option but
// the bars and the symbol (`buildMemoKey`), the bar count's class (`buildBarCountClass`) and, checked on each hit,
// the value of every binding constant the build READ (`bindConstsReporting`). A hit re-evaluates the recorded columns
// over the new bars with every check the build makes (`columnsOver`, with no session). These rails hold a memoised build to a
// fresh one:
//   * over the in-repo population (corpus/committed, the RS script, the shapes below), across a symbol switch to
//     another industry, a symbol switch within one, and a timeframe switch away and back: every hit's IR, columns
//     included, and its lowered program are DEEP-EQUAL to a fresh build's for the new chart, and a hit never serves
//     what a fresh build refuses;
//   * through the product path (`computeRuntimeColumns`), memo on and off, over a chart's life of switches, off the
//     listing (the curtain's two runs share one build): every column bit for bit;
//   * what the key must hold: the timeframe, the symbol facts read, the bar count's class, the column checks;
//   * bounded, and cleared with the sessions;
//   * the front end reads the bars only where `buildBarCountClass` says it does (a source rail).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import util from 'node:util'
import { fileURLToPath } from 'node:url'
import {
  computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers, runtimeIncrementalOf, buildRecorder,
  runtimeIrOptions, keepBuildMemo, buildMemoHit, buildMemoKey, runtimeBuildMemoStats, __buildMemoOffForTests,
} from '../runtimeColumns.js'
import { buildRuntimeIr, buildBarCountClass } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'

const REPO = path.resolve(process.cwd(), '..')
const HERE = path.dirname(fileURLToPath(import.meta.url))

beforeEach(() => { resetRuntimeSessions(); resetRuntimeLedgers() })
afterEach(() => { __buildMemoOffForTests(false); resetRuntimeSessions() })

// ─── charts ────────────────────────────────────────────────────────────────────────────────────────────────────────
function weekdays(n, from = '2016-01-04') {
  const out = []
  const d = new Date(`${from}T00:00:00Z`)
  while (out.length < n) {
    if (![0, 6].includes(d.getUTCDay())) out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}
const priced = (times, base, k = 1) => times.map((t, i) => {
  const c = base + k * (Math.sin(i / 9) * 5 + Math.cos(i / 31) * 2 + i * 0.02)
  return { t, o: c - 0.3 * k, h: c + 1.2 * k, l: c - 1.1 * k, c, v: 2e5 + (i % 11) * 1000 }
})
function hours(n) {
  const out = []
  let t = Date.UTC(2026, 3, 6, 13, 30) / 1000
  while (out.length < n) {
    const d = new Date(t * 1000)
    const m = d.getUTCHours() * 60 + d.getUTCMinutes()
    if (![0, 6].includes(d.getUTCDay()) && m >= 810 && m < 1200) out.push(t)
    t += 3600
  }
  return out
}
const S1 = { ticker: 'RDDT', exchange: 'NYSE', securityType: 'stock', industry: 'Internet Content & Information', sector: 'Communication Services' }
const S2 = { ticker: 'ALAB', exchange: 'NASDAQ', securityType: 'stock', industry: 'Semiconductors', sector: 'Technology' }
const S3 = { ticker: 'PINS', exchange: 'NYSE', securityType: 'stock', industry: 'Internet Content & Information', sector: 'Communication Services' }
const listed = (tf, symbol) => ({ tf, newestBarIsForming: false, historyFromListing: true, symbol })
const X1 = { name: 'the first chart', rows: priced(weekdays(1500), 100), ctx: listed('D', S1) }
const SWITCHES = [
  { kind: 'symbol, another industry', rows: priced(weekdays(1200, '2017-03-06'), 40, 0.6), ctx: listed('D', S2) },
  { kind: 'symbol, the same industry', rows: priced(weekdays(1350, '2016-06-06'), 30, 0.4), ctx: listed('D', S3) },
  { kind: 'timeframe away', rows: priced(hours(900), 100, 0.3), ctx: listed('60', S1) },
  { kind: 'timeframe back', rows: priced(weekdays(1700, '2015-05-04'), 100, 1.1), ctx: listed('D', S1) },
]

// ─── what each switch must notice ──────────────────────────────────────────────────────────────────────────────────
const HEAD = '//@version=6\nindicator("memo", overlay = false)\n'
const SHAPES = {
  'plain windows and a recurrence': 'plot(ta.sma(close, 9))\nplot(ta.ema(close, 12) - ta.ema(close, 26))\nvar float s = 0.0\ns := 0.9 * s + 0.1 * close\nplot(s)',
  'the exchange, folded into a value': 'plot(syminfo.prefix == "NYSE" ? close : open)',
  'the timeframe, folded': 'plot(timeframe.isdaily ? ta.sma(close, 5) : ta.sma(close, 20))',
  'the ticker in a request\'s symbol': 'plot(close)\nplot(syminfo.ticker == "RDDT" ? 1 : 0)',
  'a weekly clock': 'plot(time("W") > 0 ? 1 : 0)',
}
function population() {
  const out = []
  for (const dir of ['corpus/committed', 'docs/pine/rs-rating']) {
    const abs = path.join(REPO, dir)
    for (const f of fs.readdirSync(abs).filter((x) => x.endsWith('.pine')).sort()) out.push({ key: `${dir}/${f}`, src: fs.readFileSync(path.join(abs, f), 'utf8') })
  }
  for (const [name, body] of Object.entries(SHAPES)) out.push({ key: `shape: ${name}`, src: HEAD + body })
  return out
}
const docOf = (src) => ({ id: 'memo', compute: { kind: 'runtime', fn: 'runtime:memo', source: src, objects: true, outputs: {} }, meta: {} })
const LOWER = { historyFromListing: true }
/** a cold build, recorded and kept, as a run with a session does it; false when it refuses */
function seed(def, rows, ctx) {
  const opts = runtimeIrOptions(def, rows, ctx, { sessionKey: 'rail' })
  const rec = buildRecorder()
  let built
  try { built = buildRuntimeIr(def.compute.source, { ...opts, columnInterpret: rec.interpret, onBindRead: rec.bindRead }) } catch { return false }
  if (!built.ok) return false
  keepBuildMemo(def, opts, rec.done(built.ir))
  return true
}

describe('a memoised build is the fresh build, over the in-repo population and four switches', () => {
  it('every hit: IR (columns included) and lowered program deep-equal a fresh build; a hit never serves a refusal', () => {
    const hits = Object.fromEntries(SWITCHES.map((s) => [s.kind, 0]))
    const misses = Object.fromEntries(SWITCHES.map((s) => [s.kind, 0]))
    const bad = []
    let scripts = 0
    for (const { key, src } of population()) {
      resetRuntimeSessions()
      const def = docOf(src)
      if (!seed(def, X1.rows, X1.ctx)) continue
      scripts += 1
      for (const sw of SWITCHES) {
        const opts = runtimeIrOptions(def, sw.rows, sw.ctx, { sessionKey: 'rail' })
        const hit = buildMemoHit(def, opts, sw.rows)
        let fresh
        try { fresh = buildRuntimeIr(src, opts) } catch (e) { fresh = { ok: false, refusal: { guard: `threw: ${e.message}` } } }
        if (!hit) {
          misses[sw.kind] += 1
          // the run builds cold here, recorded: as a run with a session does
          if (fresh.ok && sw.kind === 'timeframe away') seed(def, sw.rows, sw.ctx)
          continue
        }
        hits[sw.kind] += 1
        if (!fresh.ok) { bad.push(`${key} (${sw.kind}): the memo served what a fresh build refuses (${fresh.refusal.guard})`); continue }
        const memoIr = { ...hit.build.ir, columns: hit.columns }
        if (!util.isDeepStrictEqual(memoIr, fresh.ir)) {
          const keys = Object.keys(fresh.ir).filter((k) => !util.isDeepStrictEqual(memoIr[k], fresh.ir[k]))
          bad.push(`${key} (${sw.kind}): IR differs at ${keys.join(', ')}`)
          continue
        }
        if (!util.isDeepStrictEqual(lowerIrProgram(memoIr, LOWER), lowerIrProgram(fresh.ir, LOWER))) bad.push(`${key} (${sw.kind}): program differs`)
      }
    }
    expect(bad).toEqual([])
    // ⛔ never vacuous (measured 2026-11-19: 86 scripts build; hits 83 / 85 / 0 / 86 on the four switches, the
    // timeframe away keyed apart, and misses only where a script read a symbol fact that moved: the RS script's
    // industry, the shapes' exchange and ticker). The floors are about half, so a corpus that grows or a refusal that
    // moves does not turn this red, and a population that empties does.
    expect(scripts).toBeGreaterThanOrEqual(40)
    expect(hits['symbol, another industry']).toBeGreaterThanOrEqual(40)
    expect(hits['symbol, the same industry']).toBeGreaterThanOrEqual(40)
    expect(hits['timeframe back']).toBeGreaterThanOrEqual(40)
    expect(hits['timeframe away'], 'a timeframe is in the key').toBe(0)
    expect(misses['symbol, another industry'], 'a script that read a fact of the symbol that moved misses').toBeGreaterThan(0)
  }, 240000)
})

// ─── the key ───────────────────────────────────────────────────────────────────────────────────────────────────────
describe('what the key holds', () => {
  const def = (body) => docOf(HEAD + body)
  it('the symbol facts a build READ: the RS script\'s industry misses on another industry and hits within one', () => {
    const d = docOf(fs.readFileSync(path.join(REPO, 'docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine'), 'utf8'))
    expect(seed(d, X1.rows, X1.ctx)).toBe(true)
    expect(buildMemoHit(d, runtimeIrOptions(d, X1.rows, X1.ctx, { sessionKey: 'k' }), X1.rows).build.bindReads).toContain('syminfo.industry')
    const at = (sw) => buildMemoHit(d, runtimeIrOptions(d, sw.rows, sw.ctx, { sessionKey: 'k' }), sw.rows)
    expect(at(SWITCHES[0]), 'another industry').toBeNull()
    expect(at(SWITCHES[1]), 'the same industry').not.toBeNull()
    // a build that read the exchange keeps one build per exchange, and a chart flipping between two finds each
    const ex = def(SHAPES['the exchange, folded into a value'])
    expect(seed(ex, X1.rows, X1.ctx)).toBe(true)
    expect(seed(ex, SWITCHES[0].rows, SWITCHES[0].ctx)).toBe(true)
    for (const [rows, ctx] of [[X1.rows, X1.ctx], [SWITCHES[0].rows, SWITCHES[0].ctx], [SWITCHES[1].rows, SWITCHES[1].ctx]]) {
      expect(buildMemoHit(ex, runtimeIrOptions(ex, rows, ctx, { sessionKey: 'k' }), rows), ctx.symbol.ticker).not.toBeNull()
    }
    // and a build that read no symbol fact hits on any symbol
    const plain = def(SHAPES['plain windows and a recurrence'])
    expect(seed(plain, X1.rows, X1.ctx)).toBe(true)
    expect(buildMemoHit(plain, runtimeIrOptions(plain, SWITCHES[0].rows, SWITCHES[0].ctx, { sessionKey: 'k' }), SWITCHES[0].rows)).not.toBeNull()
  })

  it('the timeframe: a daily build is not an hourly one', () => {
    const d = def(SHAPES['the timeframe, folded'])
    expect(seed(d, X1.rows, X1.ctx)).toBe(true)
    const hourly = SWITCHES[2]
    expect(buildMemoHit(d, runtimeIrOptions(d, hourly.rows, hourly.ctx, { sessionKey: 'k' }), hourly.rows)).toBeNull()
    expect(buildMemoKey(d, runtimeIrOptions(d, X1.rows, X1.ctx, { sessionKey: 'k' })))
      .not.toBe(buildMemoKey(d, runtimeIrOptions(d, X1.rows, { ...X1.ctx, tf: '60' }, { sessionKey: 'k' })))
  })

  it('the bar count\'s class: a dynamic offset over more bars than Pine\'s buffer builds another program', () => {
    expect([buildBarCountClass(0), buildBarCountClass(1), buildBarCountClass(5000), buildBarCountClass(5001)])
      .toEqual(['none', 'within-buffer', 'within-buffer', 'past-buffer'])
    const d = def('plot(close[bar_index % 30])')
    const short = priced(weekdays(4000, '2000-01-03'), 50)
    const long = priced(weekdays(6000, '1995-01-02'), 50)
    expect(seed(d, short, X1.ctx)).toBe(true)
    const opts = runtimeIrOptions(d, long, X1.ctx, { sessionKey: 'k' })
    expect(buildMemoHit(d, opts, long), 'past the buffer: built cold').toBeNull()
    const fresh = buildRuntimeIr(d.compute.source, opts)
    const within = buildRuntimeIr(d.compute.source, runtimeIrOptions(d, short, X1.ctx, { sessionKey: 'k' }))
    expect(fresh.ir.columns.length, 'the two counts build two programs').not.toBe(within.ir.columns.length)
  })

  it('the columns\' own checks: a clock the new bars cannot answer is a fresh build\'s refusal, never the memo\'s answer', () => {
    const d = def(SHAPES['a weekly clock'])
    const weekdaysOnly = X1.rows
    // the same chart with one bar moved to a Saturday: `time("W")` is withheld by name there
    const saturday = weekdaysOnly.map((b, i) => {
      if (i !== 700) return b
      const day = new Date(`${b.t}T00:00:00Z`)
      day.setUTCDate(day.getUTCDate() + (6 - day.getUTCDay()))
      return { ...b, t: day.toISOString().slice(0, 10) }
    })
    expect(seed(d, weekdaysOnly, X1.ctx)).toBe(true)
    const opts = runtimeIrOptions(d, saturday, X1.ctx, { sessionKey: 'k' })
    const fresh = buildRuntimeIr(d.compute.source, opts)
    expect(fresh.ok).toBe(false)
    expect(fresh.refusal.guard).toBe('runtime:chart-clock')
    expect(buildMemoHit(d, opts, saturday)).toBeNull()
    // and through the run: the same refusal, memo on and off
    // (another document id for the Saturday run: a B5 session is not this rail's subject; the memo is keyed on content)
    const run = () => {
      try { computeRuntimeColumns({ ...d, id: 'memo-clock-b', compute: { ...d.compute, outputs: { a: 0 } } }, saturday, X1.ctx); return 'served' } catch (e) { return `${e.guard}: ${e.message}` }
    }
    resetRuntimeSessions()
    computeRuntimeColumns({ ...d, id: 'memo-clock-a', compute: { ...d.compute, outputs: { a: 0 } } }, weekdaysOnly, X1.ctx)
    const withMemo = run()
    resetRuntimeSessions(); __buildMemoOffForTests(true)
    expect(withMemo).toBe(run())
    expect(withMemo).toMatch(/^runtime:chart-clock/)
  })
})

// ─── through the product path ──────────────────────────────────────────────────────────────────────────────────────
const sameColumns = (a, b, at) => {
  expect(Object.keys(a), at).toEqual(Object.keys(b))
  for (const k of Object.keys(b)) {
    expect(a[k].length, at).toBe(b[k].length)
    for (let i = 0; i < b[k].length; i += 1) if (!Object.is(a[k][i], b[k][i])) expect.fail(`${at}: ${k}[${i}] ${a[k][i]} vs ${b[k][i]}`)
  }
}
describe('through the product path, a chart\'s life of switches draws the same columns with the memo on and off', () => {
  const offListing = (tf, symbol) => ({ tf, newestBarIsForming: false, historyFromListing: false, symbol })
  const LIFE = [
    ['RDDT daily', X1.rows, offListing('D', S1)],
    ['ALAB daily', SWITCHES[0].rows, offListing('D', S2)],
    ['PINS daily', SWITCHES[1].rows, offListing('D', S3)],
    ['RDDT hourly', SWITCHES[2].rows, offListing('60', S1)],
    ['RDDT daily again', SWITCHES[3].rows, offListing('D', S1)],
  ]
  const DOCS = {
    'windows and a recurrence (off the listing: the curtain runs twice)': ['plot(ta.sma(close, 9))\nplot(ta.ema(close, 12) - ta.ema(close, 26))', { a: 0, b: 1 }],
    'the exchange folded into a value': [SHAPES['the exchange, folded into a value'], { a: 0 }],
    'the timeframe folded': [SHAPES['the timeframe, folded'], { a: 0 }],
  }
  for (const [name, [body, outputs]] of Object.entries(DOCS)) {
    it(name, () => {
      const doc = { id: 'memo-life', meta: { runtimeHistory: 'listing' }, compute: { kind: 'runtime', fn: 'runtime:memo-life', source: HEAD + body, outputs } }
      const runLife = () => LIFE.map(([label, rows, ctx]) => {
        try { const out = computeRuntimeColumns(doc, rows, ctx); return { label, out, memo: (runtimeIncrementalOf(out) || {}).buildMemo === true } } catch (e) { return { label, refused: `${e.guard}: ${e.message}` } }
      })
      resetRuntimeSessions(); __buildMemoOffForTests(false)
      const on = runLife()
      resetRuntimeSessions(); __buildMemoOffForTests(true)
      const off = runLife()
      for (let i = 0; i < LIFE.length; i += 1) {
        expect(on[i].refused, on[i].label).toBe(off[i].refused)
        if (!on[i].refused) sameColumns(on[i].out, off[i].out, `${name}: ${on[i].label}`)
        expect(off[i].memo, `${off[i].label}: the memo is off`).toBe(false)
      }
      expect(on.some((r) => r.memo), `${name}: the memo served at least one run`).toBe(true)
    })
  }
})

// ─── bounded, and gone with the sessions ───────────────────────────────────────────────────────────────────────────
describe('the memo is bounded and cleared with the sessions', () => {
  it('twenty documents keep at most the cap; a reset holds none', () => {
    for (let i = 0; i < 20; i += 1) {
      const d = docOf(`${HEAD}plot(ta.sma(close, ${i + 2}))`)
      expect(seed(d, X1.rows, X1.ctx)).toBe(true)
    }
    const stats = runtimeBuildMemoStats()
    expect(stats.builds).toBeLessThanOrEqual(stats.cap)
    expect(stats.builds).toBeGreaterThan(0)
    resetRuntimeSessions()
    expect(runtimeBuildMemoStats().builds).toBe(0)
  })
})

// ─── ⛔ the front end reads the bars where `buildBarCountClass` says it does, and nowhere else ────────────────────────
describe('the front end\'s reads of the bars', () => {
  it('every read of `bars` outside comments is one of the known ones (the column seam and the count\'s two questions)', () => {
    const text = fs.readFileSync(path.resolve(HERE, '../../ast/pineRuntimeFrontend.js'), 'utf8').replace(/\r\n/g, '\n')
    const reads = []
    for (const raw of text.split('\n')) {
      const code = raw.replace(/\/\/.*$/, '').trim()
      if (!code || code.startsWith('*') || code.startsWith('/*')) continue
      // a string or template literal holds a sentence, not a read
      const bare = code.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''")
      if (/(^|[^.\w$])bars\b/.test(bare)) reads.push(code)
    }
    // the known reads: the binding of the option, the two column-seam calls, and the count's questions
    // (`bars.length === 0`, `> 0`, the column's length, past Pine's buffer). A new one is either a question about the
    // count (add it to `buildBarCountClass`) or a read of the bars' values (route it through the column seam).
    const KNOWN = [
      'const bars = opts.bars || []',
      '? opts.columnInterpret(folded, bars, inputs, columnOpts)',
      ': interpret(folded, bars, inputs, undefined, undefined, columnOpts)',
      'if (!(opts.symbolAtBind === true && bars.length === 0',
      'const sinkRefusal = columnSinkRefusal(clockSink, bars.length, at)',
      "if (typeof value === 'number') arr = new Float64Array(bars.length).fill(value)",
      'if (arr.length !== bars.length) {',
      'const blankRefusal = columnBlankRefusal(clockSink, arr, bars.length, at)',
      'if (bars.length === 0) return',
      'if (!(Array.isArray(bars) && bars.length > MAX_BARS_BACK_CEILING)) return false',
      // engine 83/84: "are there bars at all" (the count's class: `none`), with the symbol's timezone read through
      // `bindConsts` (reported, so the memo checks it); sessionReuseIdentity.test.js lists the same line
      "const exchangeZone = bars.length > 0 && bindConsts['syminfo.timezone'] === 'America/New_York' ? 'America/New_York' : null",
    ]
    const unknown = reads.filter((r) => !KNOWN.includes(r))
    expect(unknown).toEqual([])
    for (const k of KNOWN) expect(reads, k).toContain(k)
  })
})
