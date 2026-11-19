// ─── ⭐⭐ (2026-11-19) A SESSION'S KEPT BUILD IS REUSED ONLY WHERE A COLD BUILD WOULD DRAW THE SAME ──────────────────
//
// P3 WS-F (B5) keeps a session's build and, on its next run, re-evaluates the columns over the new bars instead of
// building again (`runtimeColumns.js::columnsOver`), carrying a column that reads no price when the bars' TIMES are
// the session's (`tickInvariant`), and resuming from a checkpoint when the bars before it are the same
// (`resumableFrom`). Two defects let a warm run draw what a cold one does not:
//   (1) a bar's time was compared as `+t`. A daily, weekly or monthly bar is keyed by its ISO date, `+'2026-11-17'`
//       is `NaN`, and `Object.is(NaN, NaN)` is true, so any two daily charts of one length had "the same times": a
//       daily window that slid one bar drew the PREVIOUS window's `dayofweek` on 1,500 of 1,500 bars, and a chart
//       with one bar moved onto a Saturday was served where a cold build refuses `runtime:chart-clock`;
//   (2) the re-evaluation checked `time-*` codes only, where the build (`columnOf`) also refuses `stoch:flat-window`,
//       the `bool`-`na` and tie witnesses, `request:other-timeframe` and a blank left-edge column, and it ignored the
//       bar count's class (a chart grown past Pine's 5,000-bar buffer builds another program).
// These rails hold a warm run to a cold one (`incremental: false`) on each, and the reuse path to the front end's own
// refusals (`columnSinkRefusal`, `columnBlankRefusal`, `buildBarCountClass`): one authority, no second list.
import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers, runtimeIncrementalOf, columnsOver, buildRecorder,
} from '../runtimeColumns.js'
import { columnSinkRefusal, columnBlankRefusal, buildBarCountClass } from '../../ast/pineRuntimeFrontend.js'
import { requestBaseNode } from '../../ast/interpret.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
beforeEach(() => { resetRuntimeSessions(); resetRuntimeLedgers() })

// ─── daily bars, keyed as the product keys them: ISO dates ─────────────────────────────────────────────────────────
function weekdays(n, from = '2016-01-04') {
  const out = []
  const d = new Date(`${from}T00:00:00Z`)
  while (out.length < n) {
    if (![0, 6].includes(d.getUTCDay())) out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}
const priced = (times) => times.map((t, i) => {
  const c = 100 + Math.sin(i / 7) * 4 + i * 0.01
  return { t, o: c - 0.3, h: c + 1.1, l: c - 1.2, c, v: 1e5 + (i % 9) * 100 }
})
const doc = (body, outputs) => ({
  id: 'b5', meta: { runtimeHistory: 'listing' },
  compute: { kind: 'runtime', fn: 'runtime:b5', outputs, source: `//@version=6\nindicator("b5")\n${body}` },
})
const DAILY = { tf: 'D', newestBarIsForming: false, historyFromListing: true, symbol: { ticker: 'RDDT', exchange: 'NYSE' } }
const sameColumns = (a, b, at) => {
  expect(Object.keys(a), at).toEqual(Object.keys(b))
  for (const k of Object.keys(b)) {
    expect(a[k].length, at).toBe(b[k].length)
    const bad = []
    for (let i = 0; i < b[k].length; i += 1) if (!Object.is(a[k][i], b[k][i])) bad.push(i)
    expect(bad.length, `${at}: ${k} differs on ${bad.length} bars (first ${bad.slice(0, 3).join(', ')})`).toBe(0)
  }
}
const outcome = (d, rows, ctx, opts) => {
  try { return { cols: computeRuntimeColumns(d, rows, ctx, opts) } } catch (e) { return { refused: `${e.guard}: ${e.message}` } }
}
// price-free clock columns beside a price one: each is `tickInvariant` (carried when the times are the session's)
const CLOCKS = doc('plot(dayofweek)\nplot(dayofmonth + month * 100)\nplot(time % 1000003)\nplot(year)\nplot(close * 2)',
  { a: 0, b: 1, c: 2, d: 3, e: 4 })

describe('(1) a daily bar\'s time is its own key: a session carries a clock column only over the same times', () => {
  it('a daily window that slides one bar at a fixed length draws, warm, exactly what a cold build draws, on every bar', () => {
    const all = priced(weekdays(1501))
    computeRuntimeColumns(CLOCKS, all.slice(0, 1500), DAILY)
    const slid = all.slice(1)
    const warm = computeRuntimeColumns(CLOCKS, slid, DAILY)
    const info = runtimeIncrementalOf(warm)
    expect(info.rebuilt, 'the session\'s build was reused (the path under test ran)').toBe(false)
    expect(info.columnsReused, 'the times moved: no clock column is carried').toBe(0)
    sameColumns(warm, computeRuntimeColumns(CLOCKS, slid, DAILY, { incremental: false }), 'slid daily window')
  })

  it('a weekly window that slides one bar: the same', () => {
    const weeks = weekdays(2600).filter((_, i) => i % 5 === 4)
    const all = priced(weeks.slice(0, 501))
    const W = { ...DAILY, tf: 'W' }
    computeRuntimeColumns(CLOCKS, all.slice(0, 500), W)
    const slid = all.slice(1)
    sameColumns(computeRuntimeColumns(CLOCKS, slid, W), computeRuntimeColumns(CLOCKS, slid, W, { incremental: false }), 'slid weekly window')
  })

  it('a chart with one bar moved onto a Saturday refuses warm exactly as it refuses cold (`runtime:chart-clock`)', () => {
    const d = doc('plot(time("W") > 0 ? 1 : 0)\nplot(close)', { a: 0, b: 1 })
    const rows = priced(weekdays(800))
    const saturday = rows.map((b, i) => {
      if (i !== 500) return b
      const day = new Date(`${b.t}T00:00:00Z`)
      day.setUTCDate(day.getUTCDate() + (6 - day.getUTCDay()))
      return { ...b, t: day.toISOString().slice(0, 10) }
    })
    expect(outcome(d, rows, DAILY).refused).toBeUndefined()
    const warm = outcome(d, saturday, DAILY)
    const cold = outcome(d, saturday, DAILY, { incremental: false })
    expect(cold.refused).toMatch(/^runtime:chart-clock/)
    expect(warm.refused).toBe(cold.refused)
  })

  // ⚠️ GUARDED TWICE, so not mutation-provable on its own: a resume also needs every column before the checkpoint to
  // be the same (`sameColumnsTo`), and the main program reads a bar's time only through columns, so a re-keyed bar
  // moves a clock column too. The snapshot's own time check (the same raw key as `sameTimes`) stands beside it.
  it('a resume needs the same times too: an old bar re-keyed to another date (same prices) is not resumed', () => {
    const rows = priced(weekdays(400))
    const forming = { ...DAILY, newestBarIsForming: true }
    computeRuntimeColumns(CLOCKS, rows, forming)
    // bar 10 re-dated to the next weekday after the last bar's (a correction of its key), prices untouched
    const moved = rows.map((b, i) => (i === 10 ? { ...b, t: weekdays(402)[401] } : b))
    const warm = computeRuntimeColumns(CLOCKS, moved, forming)
    expect(runtimeIncrementalOf(warm).resumedFrom, 'not resumed across a re-keyed bar').toBeNull()
    sameColumns(warm, computeRuntimeColumns(CLOCKS, moved, forming, { incremental: false }), 're-keyed bar')
  })

  it('⛔ CONTROL: a tick on a daily chart (same times, the newest price moved) still carries the clock columns, exactly', () => {
    let rows = priced(weekdays(600))
    const forming = { ...DAILY, newestBarIsForming: true }
    computeRuntimeColumns(CLOCKS, rows, forming)
    const last = rows[rows.length - 1]
    rows = [...rows.slice(0, -1), { ...last, c: last.c + 0.5, h: Math.max(last.h, last.c + 0.5) }]
    const warm = computeRuntimeColumns(CLOCKS, rows, forming)
    expect(runtimeIncrementalOf(warm).columnsReused, 'the clock columns are carried on a tick').toBeGreaterThan(0)
    sameColumns(warm, computeRuntimeColumns(CLOCKS, rows, forming, { incremental: false }), 'daily tick')
  })
})

// ─── (2) the reuse path asks the front end's own refusals ──────────────────────────────────────────────────────────
const s = (name) => ({ type: 'series', name })
const num = (value) => ({ type: 'num', value })
const call = (name, ...args) => ({ type: 'call', name, args })
const op = (name, ...args) => ({ type: 'op', name, args })
const keptOf = (tree, interpretOpts) => ({ ir: { columns: [] }, trees: [{ tree, inputs: {}, interpretOpts, invariant: false }] })
// an oscillating chart, and the same with a flat run at its centre (`stoch:flat-window`), with a high missing on its
// first bars (a left edge off the listing)
const osc = (flatAt = -1, holes = 0) => weekdays(300).map((t, i) => {
  const flat = i >= flatAt && i < flatAt + 10
  const c = flat ? 100 : 100 + Math.sin(i / 3) * 5
  return { t, o: c, h: i < holes ? NaN : (flat ? 100 : c + 3), l: flat ? 100 : c - 3, c, v: 1000 }
})
const SINK_CASES = [
  // [name, tree, interpretOpts, bars where it does NOT fire, bars where it does, the code]
  ['stoch:flat-window', call('stochPine', s('high'), s('low'), s('close'), num(5)), { historyFromListing: true }, osc(), osc(150), 'stoch:flat-window'],
  ['the bool-na witness', call('boolNaWithheld', op('>', s('close'), num(100)), op('>', s('close'), num(103))), { historyFromListing: true },
    osc().map((b) => ({ ...b, c: Math.min(b.c, 102) })), osc(), 'pine:bool-na-unwitnessed'],
  ['the tie witness', call('highestbars', op('*', s('close'), num(0)), num(3)), { historyFromListing: true },
    null, osc(), 'pine:tie-unwitnessed'],
  ['request:other-timeframe', requestBaseNode('D', s('close')), { tf: 'W' }, null, osc(), 'request:other-timeframe'],
]
const BLANK_CASES = [
  // (off the listing a stoch's warm-up is a left edge on any chart, so it has no quiet control)
  ['a blank stoch left edge', call('cum', call('stochPine', s('high'), s('low'), s('close'), num(5))), {}, null, osc(-1, 3), 'stoch:left-edge'],
  ['a blank rci left edge', call('cum', call('rci', s('high'), num(5))), {}, osc(), osc(-1, 3), 'rci:left-edge'],
]

describe('(2) the reuse path refuses what the build refuses: each code, one authority', () => {
  for (const [name, tree, iopts, quiet, firing, code] of SINK_CASES) {
    it(`${name}: a kept build re-evaluated over bars where \`${code}\` fires hands back to a fresh build`, () => {
      if (quiet) expect(columnsOver(keptOf(tree, iopts), quiet, null), `${name}: control, the code does not fire`).not.toBeNull()
      expect(columnsOver(keptOf(tree, iopts), firing, null), name).toBeNull()
      // and it is the front end's own refusal, by that code (what `columnOf` throws on a cold build)
      const sink = new Map()
      const rec = buildRecorder()
      rec.interpret(tree, firing, {}, { ...iopts, chartClockSink: sink })
      const why = columnSinkRefusal(sink, firing.length, null)
      expect(why && (why.guard === code || why.message.startsWith(code) || (code === 'request:other-timeframe' && why.guard === 'runtime:request'))).toBe(true)
    })
  }
  for (const [name, tree, iopts, quiet, firing, code] of BLANK_CASES) {
    it(`${name}: a column the columnar lane withheld on every bar (\`${code}\`) hands back to a fresh build`, () => {
      if (quiet) expect(columnsOver(keptOf(tree, iopts), quiet, null), `${name}: control, a finite column`).not.toBeNull()
      expect(columnsOver(keptOf(tree, iopts), firing, null), name).toBeNull()
      const sink = new Map()
      const col = buildRecorder().interpret(tree, firing, {}, { ...iopts, chartClockSink: sink })
      const why = columnBlankRefusal(sink, Float64Array.from(col), firing.length, null)
      expect(why && why.guard).toBe(code)
    })
  }

  it('the bar count\'s class: a chart grown past Pine\'s buffer in one session draws, warm, what a cold build draws', () => {
    const d = doc('plot(close[bar_index])', { a: 0 })
    const all = priced(weekdays(5010, '1990-01-01'))
    expect([buildBarCountClass(5000), buildBarCountClass(5001)]).toEqual(['within-buffer', 'past-buffer'])
    expect(outcome(d, all.slice(0, 5000), DAILY).refused).toBeUndefined()
    const warm = outcome(d, all, DAILY)
    const cold = outcome(d, all, DAILY, { incremental: false })
    expect(cold.refused, 'past the buffer a cold build stops the run by name').toMatch(/history buffer/)
    expect(warm.refused).toBe(cold.refused)
  })

  it('a session build names its class; a reuse in another class rebuilds', () => {
    const rec = buildRecorder()
    const rows = osc()
    rec.interpret(s('close'), rows, {}, {})
    const kept = rec.done({ columns: [new Float64Array(rows.length)] }, rows.length)
    expect(kept.barCountClass).toBe('within-buffer')
    expect(columnsOver(kept, rows, null)).not.toBeNull()
    expect(columnsOver({ ...kept, barCountClass: 'past-buffer' }, rows, null)).toBeNull()
  })
})

// ─── one authority, no second list ─────────────────────────────────────────────────────────────────────────────────
describe('one authority: the reuse path holds no list of refusals of its own', () => {
  const text = fs.readFileSync(path.resolve(HERE, '../runtimeColumns.js'), 'utf8').replace(/\r\n/g, '\n')
  const body = text.slice(text.indexOf('export function columnsOver('), text.indexOf('\n}\n', text.indexOf('export function columnsOver(')))
  it('`columnsOver` asks `columnSinkRefusal`, `columnBlankRefusal` and `buildBarCountClass`, and names no code itself', () => {
    expect(body).toContain('columnSinkRefusal(')
    expect(body).toContain('columnBlankRefusal(')
    expect(body).toContain('buildBarCountClass(')
    expect(body).not.toMatch(/'time-|stoch:|pine:bool|pine:tie|request:other|left-edge/)
  })
  it('the front end reads the bars only where `buildBarCountClass` says it does (and through the column seam)', () => {
    const fe = fs.readFileSync(path.resolve(HERE, '../../ast/pineRuntimeFrontend.js'), 'utf8').replace(/\r\n/g, '\n')
    const reads = []
    for (const raw of fe.split('\n')) {
      const code = raw.replace(/\/\/.*$/, '').trim()
      if (!code || code.startsWith('*') || code.startsWith('/*')) continue
      const bare = code.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''")
      if (/(^|[^.\w$])bars\b/.test(bare)) reads.push(code)
    }
    // the option, the column seam, and the count's two questions (are there bars; past Pine's buffer). A new read
    // is a question about the count (it joins `buildBarCountClass`) or a read of the values (the column seam).
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
    ]
    expect(reads.filter((r) => !KNOWN.includes(r))).toEqual([])
    for (const k of KNOWN) expect(reads, k).toContain(k)
  })
})
