// app/src/components/chart/engine/runtime/__tests__/requests.test.js
//
// ─── `request.security` — ANOTHER SYMBOL, AND HOW ITS BARS LINE UP ──────────
//
// ⛔⛔ THE ALIGNMENT IS A MEASURED VENDOR FACT, NOT A CHOICE. Taken on a real
// TradingView chart on 2026-09-19 (NASDAQ:NVDA, 5-minute chart, vendor packet
// M1): on a HISTORICAL bar, a `"D"` request returns the PREVIOUS COMPLETED
// daily bar — bar 09-18 12:35 ET saw 09-17's close (219.34), not the forming
// day's (222.27). Only the live bar sees the forming one, and that half is
// still owed (the market was closed).
//
// So this lane serves the measured half and REFUSES the rest by name. Reading
// a forming bar's value on a historical bar is lookahead: it would make a
// backtest and a dashboard show a number nobody could have traded on, and it
// is the single most valuable-looking wrong answer this engine could give.
//
// ⛔ A SYMBOL THIS LANE HAS NO BARS FOR IS `na` AND IS RECORDED, never invented.
// The script's symbols come out of a pasted watchlist, so they are not known
// until it runs — the run REPORTS what it asked for and the host fetches it,
// which is the fixed-point discovery the spec calls for.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'

// The chart: five daily bars.
const N = 5
const DAY = 86400
const T0 = 1700000000
const BARS = Array.from({ length: N }, (_, i) => (
  { t: T0 + i * DAY, o: 100 + i, h: 102 + i, l: 99 + i, c: 101 + i, v: 1000 + i }))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const head = '//@version=6\nindicator("t", overlay = true)\n'

/** Another symbol's bars, on the same daily grid but with distinct values. */
const OTHER = Array.from({ length: N }, (_, i) => (
  { t: T0 + i * DAY, o: 200 + i, h: 202 + i, l: 199 + i, c: 201 + i, v: 5000 + i }))

function build(src, opts) {
  const built = buildRuntimeIr(head + src, { bars: BARS, inputs: {}, ...(opts || {}) })
  if (!built.ok) throw new Error(`refused: ${built.refusal.message}`)
  return lowerIrProgram(built.ir)
}

function run(src, requestBars, opts) {
  // ⛔ LIMITS GO TO `execute`, NOT TO THE BUILD. A first version passed them to
  // `buildRuntimeIr`, where nothing reads them, and the ceiling case reported
  // "expected a throw" — a test failing because of the harness rather than the
  // code, which is the one failure mode a ceiling test must not have.
  const program = build(src)
  const res = execute(program, {
    bars: N,
    series: SERIES,
    columns: program.columns,
    confirmed: true,
    barTimes: BARS.map((b) => b.t),
    requestBars: requestBars || {},
  }, opts && opts.limits)
  return { out: Array.from(res.outputs[0]), requested: res.requested }
}

const refusalOf = (src) => {
  const built = buildRuntimeIr(head + src, { bars: BARS, inputs: {} })
  expect(built.ok, 'expected a refusal, got a program').toBe(false)
  return built.refusal
}

describe('request.security', () => {
  it('reads another symbol on the same grid on the SAME bar (its own session date)', () => {
    // ⭐⭐ RS RATING L5 — the alignment is the host lane's (`interpret.js::requestAlignment`,
    // read by `vm.js::runRequest`): a series at the chart's own timeframe is read on the bar
    // of the same `t`, as Pine's look-ahead-off `request.security` reads a same-timeframe
    // symbol (C29: bare "SPY" == "AMEX:SPY" bar for bar on RDDT 1D). ⚰️ This rail said "one
    // bar behind": the strictly-before rule, right for M1's `"D"` read on a 5-minute bar
    // (the merge's mid-session answer), applied to a same-timeframe series it reads
    // yesterday. That merge is served for weekly / monthly reads by the supplied path.
    const { out } = run(
      'x = request.security("OTHER", "D", close)\nplot(x)\n',
      { 'OTHER|D': OTHER })
    for (let i = 0; i < N; i += 1) expect(out[i]).toBe(OTHER[i].c)
  })

  it('⛔ a symbol with no bars is `na`, and the run REPORTS it', () => {
    const { out, requested } = run(
      // ⭐ ENGINE 55 — a US-listing-shaped ticker no store holds: a bare `"MISSING"` (seven
      // letters, no US listing's shape) is now refused at translate by name, every door.
      'x = request.security("ZZZZ", "D", close)\nplot(x)\n', {})
    expect(out.every(Number.isNaN)).toBe(true)
    // ⭐ The report is what makes the second pass possible — the host fetches
    // exactly what the script asked for and runs it again.
    expect(requested).toContain('ZZZZ|D')
  })

  it('a symbol only known while the script RUNS is still discovered', () => {
    // The acceptance script reads its symbols out of a pasted watchlist, so
    // nothing knows them before the bar runs.
    const { requested } = run(
      'p = str.split("AAA,BBB", ",")\n'
      + 'float s = 0.0\n'
      + 'for i = 0 to array.size(p) - 1\n'
      + '    s := s + request.security(array.get(p, i), "D", close)\n'
      + 'plot(s)\n', {})
    expect(requested).toContain('AAA|D')
    expect(requested).toContain('BBB|D')
  })

  it('the SECOND pass, with the bars supplied, produces real numbers', () => {
    const src = 'x = request.security("OTHER", "D", close)\nplot(x)\n'
    const first = run(src, {})
    expect(first.out.every(Number.isNaN)).toBe(true)
    const second = run(src, { 'OTHER|D': OTHER })
    expect(second.out[1]).toBe(OTHER[1].c)
  })

  it('an EXPRESSION is evaluated in the requested symbol\'s context', () => {
    // `high - low` must be the OTHER symbol's range, not this chart's.
    const { out } = run(
      'x = request.security("OTHER", "D", high - low)\nplot(x)\n',
      { 'OTHER|D': OTHER })
    expect(out[2]).toBe(OTHER[2].h - OTHER[2].l)
  })

  it('history inside the request is the requested symbol\'s history', () => {
    const { out } = run(
      'x = request.security("OTHER", "D", close[1])\nplot(x)\n',
      { 'OTHER|D': OTHER })
    // bar 2 sees the requested series' bar 2, whose `close[1]` is its bar 1
    expect(out[2]).toBe(OTHER[1].c)
  })

  it('a TUPLE request unpacks in order', () => {
    const { out } = run(
      '[a, b] = request.security("OTHER", "D", [close, volume])\nplot(a * 100000 + b)\n',
      { 'OTHER|D': OTHER })
    expect(out[1]).toBe(OTHER[1].c * 100000 + OTHER[1].v)
  })

  it('⛔ lookahead_on at W/M is served (witnessed); a look-ahead the host cannot read is refused BY NAME', () => {
    // ⚠️ The vendor packet's M1 measured the HISTORICAL half only; the realtime
    // half needs an open market. Serving lookahead on a guess would put a
    // number on screen that nobody could have traded on, which is the most
    // valuable-LOOKING wrong answer available.
    // ⭐ RS RATING L5 — asked of a WEEKLY read: look-ahead decides something only above the
    // chart's own timeframe. The host reads `lookahead_on` at the chart's own period as the
    // same read as `lookahead_off` (`pine.js::requestTargetOf`: "nothing to model"), so the
    // daily spelling this rail used is now that ordinary read, and builds.
    // ⭐⭐ REQ (coverage unit, 2026-11-16) — a WEEKLY look-ahead read now builds: its pick is witnessed
    // (`vw-request-htf-alignment-spy-1d-2026-10-02` A01 / A04 / A06, `vendorHarness.reqLookaheadAlignment`),
    // and the supply serves it (`requestSupply.js`). A look-ahead spelling the host cannot read still refuses.
    const weekly = buildRuntimeIr(`${head}x = request.security(syminfo.tickerid, "W", close, lookahead = barmerge.lookahead_on)\nplot(x)\n`,
      { bars: BARS, inputs: {} })
    expect(weekly.ok, weekly.ok ? '' : weekly.refusal.message).toBe(true)
    expect(weekly.ir.requests[0].target).toMatchObject({ own: true, code: 'W', live: true })
    const r = refusalOf(
      'la = input.bool(true)\nx = request.security(syminfo.tickerid, "W", close, lookahead = la)\nplot(x)\n')
    expect(r.message).toMatch(/lookahead/i)
    const sameTf = buildRuntimeIr(`${head}x = request.security("OTHER", "D", close, lookahead = barmerge.lookahead_on)\nplot(x)\n`,
      { bars: BARS, inputs: {} })
    expect(sameTf.ok, sameTf.ok ? '' : sameTf.refusal.message).toBe(true)
    expect(sameTf.ir.requests[0].target).toMatchObject({ ticker: 'OTHER', live: false })
  })

  it('⛔ REQUEST_COUNT is bounded by name', () => {
    expect(() => run(
      'p = str.split("A,B,C,D", ",")\n'
      + 'float s = 0.0\n'
      + 'for i = 0 to array.size(p) - 1\n'
      + '    s := s + request.security(array.get(p, i), "D", close)\n'
      + 'plot(s)\n', {}, { limits: { REQUEST_COUNT: 2 } })).toThrow(/REQUEST_COUNT/)
  })

  it("⛔ a request over THIS script's own state is refused BY NAME", () => {
    // ⛔⛔ The expression runs in ANOTHER symbol's context, where a `var`
    // belonging to this chart's run has no meaning. Carrying its value across
    // would answer with one symbol's state under another symbol's heading —
    // and every number would look entirely reasonable.
    //
    // ⚠️ Found unproven here by a mutation run: the rule was railed in
    // `pointwise.test.js` and nothing in THIS file could see it, so the file
    // that owns requests could not show its own guard firing.
    const r = refusalOf(
      'var float x = 0.0\n'
      + 'x := close\n'
      + 'y = request.security("OTHER", "D", x)\n'
      + 'plot(y)\n')
    expect(r.guard).toBe('runtime:request-with-state')
  })

  it("⭐⭐ a request whose value CALLS a function is now SERVED, per requested symbol", () => {
    // ⚰️ THIS ASSERTED A REFUSAL UNTIL 2026-09-20, and the refusal was right for
    // the build that had it. A user function's body was lowered ONCE, at its
    // definition, against THIS chart's bars — so `ta.sma(volume, 3)` inside it
    // was a column holding this symbol's numbers. Called inside a request, every
    // number would have been this chart's while the row it landed in wore the
    // requested symbol's name: plausible, well-formed, and wrong.
    //
    // ⭐ The refusal named its own successor — "serving it needs the columnar
    // lane run per requested symbol, a capability, not a patch" — and that is
    // what landed. The body is lowered AT THE CALL SITE, inside the request,
    // where the columnar lane is barred and `volume` is the REQUESTED symbol's.
    //
    // ⛔ SO THE GUARD IS NOT GONE, IT IS NO LONGER REACHED BY THIS SHAPE. The
    // non-call half below still fires, and so does a body this reader cannot
    // substitute — both kept, because the wrong-symbol defect is only absent
    // while the body really is re-lowered.
    const built = buildRuntimeIr(
      `${head}f() =>\n`
      + '    ta.sma(volume, 3)\n'
      + 'y = request.security("OTHER", "D", f())\n'
      + 'plot(y)\n', { bars: BARS, inputs: {} })
    expect(built.ok, built.ok ? '' : `${built.refusal.guard}: ${built.refusal.message}`).toBe(true)
    // ⭐ AND THE WINDOW RUNS INSIDE THE REQUEST. A build that quietly kept the
    // shared frame would also be `ok` — the hoisted binding is what shows the
    // source was given its own series in the requested symbol's region.
    expect(built.ir.requests[0].statements.length).toBeGreaterThan(0)
  })

  it("⭐⭐ a body with STATE and CONTROL FLOW is now lowered into the region", () => {
    // ⚰️ THIS ASSERTED A REFUSAL UNTIL 2026-09-20. Its reasoning was right about
    // substitution — "a `var` is frame state; inlining it would make each use
    // its own fresh binding" — and that is precisely why the body is no longer
    // substituted. A request's region is a STATEMENT SEQUENCE, so the body is
    // lowered into it: the `var` becomes a real persistent slot and
    // `ta.sma(volume, 3)` runs over the REQUESTED symbol's volume, which is the
    // wrong-symbol defect the old refusal was protecting against.
    //
    // ⭐ The lifetime is right BY CONSTRUCTION rather than by a guard:
    // `runRequest` builds a fresh `execute` per requested symbol and `execute`
    // allocates the persistent block per run, so each symbol accumulates its
    // own `acc` and none of them sees this chart's.
    const built = buildRuntimeIr(
      `${head}f() =>\n`
      + '    var float acc = 0.0\n'
      + '    acc := acc + ta.sma(volume, 3)\n'
      + '    acc\n'
      + 'y = request.security("OTHER", "D", f())\n'
      + 'plot(y)\n', { bars: BARS, inputs: {} })
    expect(built.ok, built.ok ? '' : `${built.refusal.guard}: ${built.refusal.message}`).toBe(true)
    expect(built.ir.requests[0].statements.length,
      'the body did not reach the region').toBeGreaterThan(0)
  })

  it("⛔ and a body that ends on a BLOCK rather than a value is still refused", () => {
    // ⭐ The statement path did not become a blanket yes. A body whose last line
    // is an `if` has no value to hand back, and inventing one — `na`, or the
    // last assignment — would answer a number the author never wrote.
    const r = refusalOf(
      'f() =>\n'
      + '    var float acc = 0.0\n'
      + '    if close > 0\n'
      + '        acc := 1.0\n'
      + 'y = request.security("OTHER", "D", f())\n'
      + 'plot(y)\n')
    expect(r).toBeTruthy()
  })

  it("⭐ a pure expression's past inside a request is the REQUESTED symbol's past, never a column", () => {
    // `(close * 2)[1]` inside a request is not a bare series read. It used to lower through the columnar seam and
    // refuse here (a column holds THIS chart's bars). Since the U-REQ-HOIST-COLUMN lowering it is the request
    // region's own committed series, read through its ring: the OTHER symbol's previous close, doubled.
    const { out } = run('y = request.security("OTHER", "D", (close * 2)[1])\nplot(y)\n', { 'OTHER|D': OTHER })
    expect(Number.isNaN(out[0])).toBe(true)
    for (let i = 1; i < N; i += 1) expect(out[i]).toBe(OTHER[i - 1].c * 2)
  })

  it('CONTROL: a script with no request is unaffected', () => {
    const { out, requested } = run('plot(close)\n', {})
    expect(out).toEqual(BARS.map((b) => b.c))
    expect(requested).toEqual([])
  })
})
