// app/src/components/chart/engine/runtime/__tests__/requestTimeframeReader.test.js
//
// ─── ⭐⭐ (request unit, TF-FOLD, NUMBER PENDING) — THE RUNTIME LANE READS A REQUEST'S TIMEFRAME THE SCRIPT SETTLES ───
//
// A `request.security` timeframe that the script settles before its first bar, and that the host's reader did not
// reach, was refused on the runtime lane:
//   * a ternary chain over an input's default deeper than the plot lane's 4 hops (cppivot-boss-floor-pivots:
//     `floor_pivot_resolution = tf == "1H" ? '60' : tf == "2H" ? '120' : tf == "4H" ? '240' : tf`): `pine:request`;
//   * a call to a script function that takes no argument and settles its result in an `if` chain
//     (`getAlignedTimeframe()` over `timeframe.in_seconds()`, tehthomas-aligned-timeframe-fair-value-gaps;
//     `timeframe_func()` over an input string, Saty ATR Levels): `runtime:request` (`lookahead`).
// The rule served: the reference's `request.security` reads "the result of an expression from a specified context
// (symbol and timeframe)", and Pine returns a function's last value (`if` takes the arm whose test holds). A
// timeframe settled that way IS the literal it settles to, so each rail below compares the folded request with the
// same request WRITTEN with that literal (derived, never restated), on the runtime lane's own run.
// ⛔ The reach is the runtime lane's alone (`pine.js::requestTimeframeReach`): the plot lane keeps its 4 hops and
// reads no call (C10: a plot that newly translates mints its parameters in a new order), held below by the plot
// lane's own refusals and by every request-reading corpus script's plot-lane translation, byte for byte, with the
// reach and without it.

import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { computeRuntimeColumns, probeRuntimeProgram, resetRuntimeSessions, resetRuntimeLedgers } from '../runtimeColumns.js'
import { translatePine, Resolver } from '../../ast/pine.js'

beforeEach(() => { resetRuntimeSessions(); resetRuntimeLedgers() })

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '../../../../../../..')
const LF = String.fromCharCode(10)

/** Weekday ISO dates from `from` (a Monday), `n` sessions: several weeks and months. */
function weekdays(n, from = '2026-01-05') {
  const out = []
  const d = new Date(`${from}T00:00:00Z`)
  while (out.length < n) {
    const w = d.getUTCDay()
    if (w !== 0 && w !== 6) out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}
const CHART = weekdays(70).map((t, i) => {
  const c = 100 + i + (i % 3) * 0.5 - (i % 7) * 0.25
  return { t, o: c - 0.25, h: c + 1 + (i % 4) * 0.1, l: c - 1 - (i % 5) * 0.1, c, v: 1000 + i }
})
const ctx = { tf: 'D', newestBarIsForming: false, historyFromListing: true, symbol: { ticker: 'RDDT', exchange: 'NYSE' } }
const docOf = (source, outputs = { a: 0 }) => ({
  id: 'tf-fold', meta: { runtimeHistory: 'listing' }, compute: { kind: 'runtime', fn: 'runtime:tf-fold', outputs, source },
})
const run = (source, outputs) => {
  resetRuntimeSessions()
  const out = computeRuntimeColumns(docOf(source, outputs), CHART, ctx)
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, Array.from(v)]))
}
/** The plot lane's own answer (the host translator, as the member door asks it). */
const plotLane = (source) => translatePine(source, { strict: true, paramManifest: true })
const refusedGuards = (t) => (t.refusals || []).map((r) => r.guard)

// ── the cppivot shape: a six-hop chain over an input's default ─────────────────────────────────────
const chainSource = (def, tfExpr = 'res') => [
  '//@version=4',
  'study("tf chain", overlay=true)',
  `tfi = input("${def}", options=["1H", "2H", "4H", "D", "W", "M"])`,
  'res = tfi == "1H" ? \'60\' : tfi == "2H" ? \'120\' : tfi == "4H" ? \'240\' : tfi',
  `x = security(syminfo.tickerid, ${tfExpr}, close[1], barmerge.gaps_off, barmerge.lookahead_on)`,
  'plot(x)',
].join(LF)

// ── the Saty shape: a no-argument function settling its result in an `if` chain over an input string ─
const fnSource = (def, tfExpr = 'tf_func()') => [
  '//@version=5',
  'indicator("tf fn", overlay=true)',
  `tt = input.string("${def}", "Trading Type", options=["Day", "Multiday", "Swing"])`,
  'tf_func() =>',
  "    timeframe = 'D'",
  '    if tt == "Day"',
  "        timeframe := 'D'",
  '    else if tt == "Multiday"',
  "        timeframe := 'W'",
  '    else if tt == "Swing"',
  "        timeframe := 'M'",
  '    else',
  "        timeframe := 'D'",
  `pc = request.security(syminfo.tickerid, ${tfExpr}, close[1], gaps=barmerge.gaps_off, lookahead=barmerge.lookahead_on)`,
  'plot(pc)',
].join(LF)

// ── the TehThomas shape: a no-argument function over the chart's own timeframe (`timeframe.in_seconds()`) ─
const alignedSource = (tfExpr = 'alignedTF') => [
  '//@version=6',
  'indicator("tf aligned", overlay=true)',
  'getAlignedTimeframe() =>',
  '    string result = ""',
  '    if timeframe.in_seconds() <= 3600',
  '        result := "D"',
  '    else if timeframe.in_seconds() <= 14400',
  '        result := "W"',
  '    else',
  '        result := "M"',
  '    result',
  'alignedTF = getAlignedTimeframe()',
  `[lo, hi] = request.security(syminfo.tickerid, ${tfExpr}, [low[1], high[1]], lookahead=barmerge.lookahead_on)`,
  'plot(lo)',
  'plot(hi)',
].join(LF)

describe('TF-FOLD: a timeframe settled through a chain deeper than the plot lane reads (cppivot)', () => {
  it('at the default "D" on a daily chart the request is the identity: the chain reads what `\'D\'` written out reads', () => {
    const folded = run(chainSource('D'))
    const literal = run(chainSource('D', "'D'"))
    expect(folded.a).toEqual(literal.a)
    expect(Number.isNaN(folded.a[0])).toBe(true)
    for (let i = 1; i < CHART.length; i += 1) expect(folded.a[i]).toBe(CHART[i - 1].c)
  })
  it('at "W" it is the weekly look-ahead read, exactly as `\'W\'` written out (and not the daily one)', () => {
    const folded = run(chainSource('W'))
    const literal = run(chainSource('W', "'W'"))
    expect(folded.a).toEqual(literal.a)
    expect(folded.a).not.toEqual(run(chainSource('D')).a)
    const p = probeRuntimeProgram(chainSource('W'))
    expect(p.ok, JSON.stringify(p.refusal)).toBe(true)
    expect(p.requestTargets.map((t) => t && t.code)).toEqual(['W'])
  })
  it('⛔ the plot lane keeps its reach: the same script still refuses there, by its own name', () => {
    expect(refusedGuards(plotLane(chainSource('D')))).toContain('pine:request')
    // control: the literal translates on the plot lane, so the refusal above is the chain's, not the request's
    expect(refusedGuards(plotLane(chainSource('D', "'D'")))).not.toContain('pine:request')
  })
  it('⛔ CONTROL: a chain past the bound is still refused (a binding cycle stays a refusal, never a hang)', () => {
    const deep = ['//@version=4', 'study("deep", overlay=true)', 'r0 = "W"']
    for (let k = 1; k <= 20; k += 1) deep.push(`r${k} = r${k - 1}`)
    deep.push('x = security(syminfo.tickerid, r20, close[1], barmerge.gaps_off, barmerge.lookahead_on)', 'plot(x)')
    const p = probeRuntimeProgram(deep.join(LF))
    expect(p.ok).toBe(false)
  })
})

describe('TF-FOLD: a no-argument function whose body settles the timeframe (Saty ATR Levels, TehThomas FVG)', () => {
  for (const [def, code] of [['Day', "'D'"], ['Multiday', "'W'"], ['Swing', "'M'"]]) {
    it(`input "${def}": the function reads what ${code} written out reads`, () => {
      expect(run(fnSource(def)).a).toEqual(run(fnSource(def, code)).a)
    })
  }
  it('the arms are distinct reads (the rail can tell the function\'s answers apart)', () => {
    const d = run(fnSource('Day')).a
    const w = run(fnSource('Multiday')).a
    const m = run(fnSource('Swing')).a
    expect(d).not.toEqual(w)
    expect(w).not.toEqual(m)
  })
  it('over the chart\'s own timeframe: on a daily chart `getAlignedTimeframe()` is "M", as `"M"` written out', () => {
    const folded = run(alignedSource(), { a: 0, b: 1 })
    const literal = run(alignedSource('"M"'), { a: 0, b: 1 })
    expect(folded).toEqual(literal)
    expect(folded.a).not.toEqual(run(alignedSource('"W"'), { a: 0, b: 1 }).a)
  })
  it('⛔ the plot lane reads no call: both scripts refuse there as they did', () => {
    expect(refusedGuards(plotLane(fnSource('Multiday')))).toContain('pine:request')
    expect(refusedGuards(plotLane(fnSource('Multiday', "'W'")))).not.toContain('pine:request')
  })
  it('⛔ CONTROL: a function whose answer varies per bar is not settled, and stays refused', () => {
    const perBar = fnSource('Multiday').replace('if tt == "Day"', 'if close > open')
    const p = probeRuntimeProgram(perBar)
    expect(p.ok).toBe(false)
    expect(p.refusal.guard).toMatch(/^runtime:request|^pine:request/)
  })
  it('⛔ CONTROL: a function that takes an argument is not read as a settled call', () => {
    const withArg = [
      '//@version=5', 'indicator("arg", overlay=true)',
      'tf_of(int k) =>', "    k == 1 ? 'W' : 'M'",
      "pc = request.security(syminfo.tickerid, tf_of(1), close[1], lookahead=barmerge.lookahead_on)", 'plot(pc)',
    ].join(LF)
    const p = probeRuntimeProgram(withArg)
    expect(p.ok).toBe(false)
  })
})

// ── the confinement, over the corpus: every committed script that reads `security(`, translated on the plot lane
// with the runtime lane's reach handed to every reader and without it. They must be the same bytes. ──────────────
const CORPUS = path.join(REPO, 'corpus', 'committed')
const requestScripts = () => fs.readdirSync(CORPUS).filter((f) => f.endsWith('.pine')).sort()
  .map((f) => ({ f, source: fs.readFileSync(path.join(CORPUS, f), 'utf8') }))
  .filter((s) => /\bsecurity\s*\(/.test(s.source))
const digest = (source) => {
  let t
  try { t = translatePine(source, { strict: true, paramManifest: true }) } catch (err) { return `threw:${String(err && err.message)}` }
  const view = { outputs: t.outputs, refusals: t.refusals, notes: t.notes, objects: t.objects, params: t.paramManifest }
  return createHash('sha256').update(JSON.stringify(view, (k, v) => (v instanceof Map ? [...v] : v instanceof Set ? [...v] : v))).digest('hex')
}

describe('⛔ TF-FOLD is the runtime lane\'s alone: the plot lane is byte-identical over the corpus', () => {
  it('every request-reading committed script translates to the same plot lane whether the reach exists or not', () => {
    const scripts = requestScripts()
    expect(scripts.length).toBeGreaterThan(40)
    const withReach = scripts.map((s) => digest(s.source))
    const orig = Resolver.prototype.requestTimeframeReach
    Resolver.prototype.requestTimeframeReach = function () { return undefined }
    let without
    try { without = scripts.map((s) => digest(s.source)) } finally { Resolver.prototype.requestTimeframeReach = orig }
    const moved = scripts.filter((s, i) => withReach[i] !== without[i]).map((s) => s.f)
    expect(moved, `plot-lane translation moved for ${moved.join(', ')}`).toEqual([])
  }, 600000)
  it('the control CAN fail: the reach handed to the plot lane moves the cppivot chain\'s translation', () => {
    const src = chainSource('D')
    const before = digest(src)
    const orig = Resolver.prototype.requestTimeframeReach
    Resolver.prototype.requestTimeframeReach = function () { return Object.freeze({ hops: 16, calls: true }) }
    let after
    try { after = digest(src) } finally { Resolver.prototype.requestTimeframeReach = orig }
    expect(after).not.toBe(before)
  })
})
