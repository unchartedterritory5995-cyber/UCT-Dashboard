// app/src/components/chart/engine/runtime/__tests__/runtimeWallsC23.test.js
//
// ─── ⭐⭐ C23 — THE RUNTIME LANE, SERVING A PANE, ANSWERS AS THE HOST LANE DOES ──
//
// `objects-triage-2026-09-28.md` § C21 named seven runtime compile walls — each
// exact on a from-listing 1D chart at defaults, measured there by SUBSTITUTION —
// and an eight: Pine v6's `and` evaluated eagerly. This file holds each one
// served, and holds it the way the triage demands: against a vendor capture
// where one exists, and against the HOST lane's own values on the same bars.
//
//   1. `barstate.isfirst` / the bar clock      — `pane: true` hands the columnar
//      resolver the host's pane contract (`Resolver` `strict`)
//   2. `timeframe.change`                      — same door; vendor K04/K05/K06/K16
//   3. `request.security(own, own tf, x)`      — `Resolver.requestTargetOf`, the
//      reader `securityAsNode` composes from; vendor: dual-view's HTF MA plot
//   4. `math.avg` over runtime state           — `BUILTIN_CALL_TREE.avg`, the
//      plot lane's own expansion; vendor: donchian's Basis
//   5. `input.color`                           — `inputColourDefaultNode`
//   6. `syminfo.mintick`                       — settled at BIND from
//      `symbolScope.json`'s tick table; vendor: the `vw-mintick-*` captures
//   7. `alert()`                               — a presentation no-op
//   8. v6 `and` / `or`                         — lazy for every operand
//
// ⛔ Each rail below was mutation-proved when it landed (see the commit).
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { translatePine } from '../../ast/pine.js'
import { interpret } from '../../ast/interpret.js'
import { parseFormula } from '../../ast/parse.js'
import { bindConstsFor, foldBound } from '../../ast/bind.js'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { runtimeClockOpts } from '../../ast/pineRuntimeClock.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { probeRuntimeProgram } from '../runtimeColumns.js'
import { toProductBars } from '../../__tests__/vendorHarness/ourSide.js'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../../objectColumns'
import { evaluateObjects } from '../../objectRuntime'

const REPO = path.resolve(process.cwd(), '..')
const VENDOR = path.join(REPO, 'tests', 'fixtures', 'vendor')
const load = (rel) => JSON.parse(fs.readFileSync(path.join(VENDOR, rel), 'utf8'))

const N = 40
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400,
  o: 100 + ((i * 7) % 5), h: 110 + (i % 3), l: 90 - (i % 4), c: 100 + ((i * 11) % 9) - 4, v: 1000 + i,
}))

/** The runtime lane's outputs for `source`, built as the PANE doors build it. */
function laneBuild(source, { bars = BARS, tf = 'D', forming = false, symbol, pane = true, ...extra } = {}) {
  return buildRuntimeIr(source, {
    bars, inputs: {}, objectTrees: [], ...(pane ? { pane: true } : {}), basePeriod: tf, tf,
    ...(symbol ? { symbol } : {}), ...extra, ...runtimeClockOpts(forming, { tf }),
  })
}
function lane(source, opts = {}) {
  const bars = opts.bars || BARS
  const built = laneBuild(source, opts)
  expect(built.ok, built.ok ? '' : `${built.refusal.guard}: ${built.refusal.message}`).toBe(true)
  const program = lowerIrProgram(built.ir)
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k])))
  const res = execute(program, {
    bars: bars.length, series, columns: program.columns, confirmed: opts.forming !== true,
    barTimes: bars.map((b) => b.t),
  })
  return res.outputs.map((o) => Array.from(o))
}
/** The HOST (plot) lane's columns for the same source on the same bars — its
 *  pane translation (`strict`), folded at bind with the same symbol. */
function host(source, { bars = BARS, tf = 'D', forming = false, symbol } = {}) {
  const t = translatePine(source, { strict: true, basePeriod: tf })
  const consts = bindConstsFor({ tf, inputs: {}, symbol })
  return t.outputs.map((o) => {
    if (!o.formula) return { refusal: o.refusal }
    return Array.from(interpret(foldBound(parseFormula(o.formula).ast, consts), bars, {}, undefined, undefined,
      { tf, newestBarIsForming: forming }))
  })
}
const same = (a, b) => (Number.isNaN(a) && Number.isNaN(b))
  || (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)))
const shape = (ir) => JSON.stringify(ir, (k, v) => (k === 'line' || k === 'column' || k === 'index' ? undefined : v))
const V6 = '//@version=6\nindicator("t")\n'
const V5 = '//@version=5\nindicator("t")\n'

describe('⭐ 1 — the bar clock on a PANE', () => {
  it('⛔ CONTROL — unset `pane` is the screen: `isfirst` keeps `pine:window-dependent`', () => {
    const r = laneBuild(`${V6}plot(barstate.isfirst ? 1 : 0)\n`, { pane: false })
    expect(r.ok).toBe(false)
    expect(r.refusal.guard).toBe('pine:window-dependent')
  })

  it('⭐ `isfirst`, read by a statement the run executes, is the host column bar for bar', () => {
    const src = `${V6}var float n = 0\nn := n + (barstate.isfirst ? 1 : 0)\nplot(barstate.isfirst ? 1 : 0)\nplot(n)\n`
    const [first, count] = lane(src)
    const [hostFirst] = host(`${V6}plot(barstate.isfirst ? 1 : 0)\n`)
    expect(first).toEqual(hostFirst)
    expect(first[0]).toBe(1)
    expect(first.slice(1).every((v) => v === 0)).toBe(true)
    expect(count.every((v) => v === 1)).toBe(true)
  })

  it('⭐ the forming-bar clock is the host\'s too: `isconfirmed` on a forming newest bar', () => {
    const src = `${V6}var float k = 0\nk := barstate.isconfirmed ? 1 : 0\nplot(k)\n`
    for (const forming of [false, true]) {
      const [ours] = lane(src, { forming })
      const [theirs] = host(`${V6}plot(barstate.isconfirmed ? 1 : 0)\n`, { forming })
      expect(ours, `forming ${forming}`).toEqual(theirs)
    }
    expect(lane(src, { forming: true })[0][N - 1]).toBe(0)
  })
})

describe('⭐ 2 — `timeframe.change` on a pane, against the vendor', () => {
  const PROBE = { D: 'K04', W: 'K05', M: 'K06', '1W': 'K16' }
  for (const file of ['harness/vw-clock-close-tfchange-spy-1d-2026-09-28.json',
    'harness/vw-clock-close-tfchange-spy-1w-2026-09-28.json']) {
    it(`⭐ ${path.basename(file)}: D / W / M / "1W" equal TradingView's rows and the host's column`, () => {
      const cap = load(file)
      const tf = cap.timeframe === '1W' ? 'W' : 'D'
      const bars = toProductBars(cap)
      const titles = cap.study.plots.map((p) => p.title)
      const rows = cap.plotValues.rows
      const body = Object.keys(PROBE).map((p, i) => `var float k${i} = na\nk${i} := timeframe.change("${p}") ? 1 : 0\nplot(k${i})`).join('\n')
      const ours = lane(`${V6}${body}\n`, { bars, tf, forming: cap.newestBarIsForming === true })
      const theirs = host(`${V6}${Object.keys(PROBE).map((p) => `plot(timeframe.change("${p}") ? 1 : 0)`).join('\n')}\n`,
        { bars, tf, forming: cap.newestBarIsForming === true })
      Object.values(PROBE).forEach((k, i) => {
        const c = 1 + titles.findIndex((t) => t.startsWith(`${k}_`))
        const bad = rows.map((r, j) => (same(ours[i][j], r[c]) ? -1 : j)).filter((j) => j >= 0)
        expect(bad, `${k} disagrees on ${bad.length} bars`).toEqual([])
        expect(ours[i]).toEqual(theirs[i])
      })
    })
  }

  it('⛔ CONTROL — on a screen it still refuses, by the host\'s sentence', () => {
    const r = laneBuild(`${V6}plot(timeframe.change("D") ? 1 : 0)\n`, { pane: false })
    expect(r.ok).toBe(false)
    expect(r.refusal.message).toMatch(/this is a screen, not a chart pane/)
  })
})

describe('⭐ 3 — a request for this chart at this chart\'s period is the expression', () => {
  const HTF = 'higher_timeframe = input.timeframe("D", title = "HTF")\n'
  const req = (look) => `${V6}${HTF}var float s = 0\ns := s + 1\n`
    + `plot(request.security(syminfo.tickerid, higher_timeframe, s * close${look ? `, lookahead = ${look}` : ''}))\n`
  const direct = `${V6}${HTF}var float s = 0\ns := s + 1\nplot(s * close)\n`

  it('⭐ an `input.timeframe` binding at its default, every `lookahead` spelling → the identity', () => {
    const want = shape(laneBuild(direct).ir)
    for (const look of [null, 'barmerge.lookahead_off', 'barmerge.lookahead_on']) {
      const got = laneBuild(req(look))
      expect(got.ok, got.ok ? '' : `${look}: ${got.refusal.message}`).toBe(true)
      expect(shape(got.ir), String(look)).toBe(want)
    }
  })

  it('⛔ the SAME request on an intraday chart asks for another period — refused, as the host refuses it', () => {
    const got = laneBuild(req('barmerge.lookahead_off'), { tf: '60' })
    expect(got.ok).toBe(false)
    const t = translatePine(`${V6}${HTF}plot(request.security(syminfo.tickerid, higher_timeframe, close, lookahead = barmerge.lookahead_off))\n`,
      { strict: true, basePeriod: '60' })
    expect(t.outputs[0].formula || null).toBeNull()
    // …and on daily bars the host folds it to the child, as this lane does
    const d = translatePine(`${V6}${HTF}plot(request.security(syminfo.tickerid, higher_timeframe, close, lookahead = barmerge.lookahead_off))\n`,
      { strict: true, basePeriod: 'D' })
    // ⭐ C49 — re-pinned from `'close'`: the fold carries the gate of the base it was
    // translated for (`interpret.js::requestBaseNode`); on daily bars it IS the child.
    expect(d.outputs[0].formula).toBe('86400 != periodseconds ? 0 / 0 : close')
  })

  it('⛔ a MUTABLE period or symbol is never read as the built-in', () => {
    // ⭐ `period` and `tickerid` are the v2/v3 built-in spellings the host reads as
    // THIS chart's when nothing binds them; here a `var` does, which the host
    // cannot see — so the identity must not be taken. Each is compared with the
    // same program where the request IS its expression.
    for (const [decl, sym, tf] of [['var string period = "W"', 'syminfo.tickerid', 'period'],
      ['var string tickerid = "AAPL"', 'tickerid', '"D"']]) {
      const asked = laneBuild(`${V6}${decl}\nplot(request.security(${sym}, ${tf}, close))\n`)
      const identity = laneBuild(`${V6}${decl}\nplot(close)\n`)
      expect(identity.ok).toBe(true)
      expect(asked.ok ? shape(asked.ir) : 'refused', decl).not.toBe(shape(identity.ir))
    }
  })

  it('⭐ dual-view\'s HTF MA (`request.security(syminfo.tickerid, higher_timeframe, …, lookahead=off)`) is the host\'s column', () => {
    // ⭐ VENDOR-BACKED THROUGH ITS READERS: the MA feeds `detect_pattern_at_index`'s
    // trend filters (`ma2 > ma3` …), and the run reproduces TradingView's 43
    // patterns in order (`vendorHarness.c21DualView`). Its own plot is off at the
    // author's defaults (`show_trend_visuals = false`), so it is read here directly,
    // against the host lane's column of the expression the request folds to
    // (`trend_detection_method = "EMA"`, `ma_length = 12` at defaults).
    const cap = load('harness/dual-view-htf-candlestick-patterns-theultimator5-rddt-1d-2026-09-28.json')
    expect(cap.source.text).toMatch(/trend_detection_method = input\.string\("EMA"/)
    expect(cap.source.text).toMatch(/ma_length = input\.int\(12,/)
    const bars = toProductBars(cap)
    const built = laneBuild(`${cap.source.text}\nplot(htf_ma_value, "c23 htf ma")\n`,
      { bars, symbol: { ticker: 'RDDT', exchange: 'NYSE' } })
    expect(built.ok, built.ok ? '' : built.refusal.message).toBe(true)
    expect((built.ir.requests || []).length).toBe(0)
    const program = lowerIrProgram(built.ir)
    // ⚠️ the LAST bar is over `INSTRUCTIONS_PER_BAR` (case 8); every bar before it is read
    const upTo = bars.length - 1
    const res = execute(program, {
      bars: upTo,
      series: ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.slice(0, upTo).map((b) => b[k]))),
      columns: program.columns.map((c) => c.subarray(0, upTo)),
      confirmed: true, barTimes: bars.slice(0, upTo).map((b) => b.t),
    })
    const ours = Array.from(res.outputs[res.outputs.length - 1])
    const [want] = host(`${V6}plot(ta.ema(close, 12))\n`, { bars })
    expect(ours.every((v, j) => same(v, want[j])), 'the request folded to its expression').toBe(true)
    expect(ours.filter((v) => Number.isFinite(v)).length).toBeGreaterThan(500)
  })
})

describe('⭐ 4 — `math.avg` over runtime state is the plot lane\'s expansion', () => {
  it('⭐ the SAME program as `(a + b) / 2`, and the host\'s column bar for bar', () => {
    const viaAvg = `${V6}var float a = na\nvar float b = na\na := close\nb := open\nplot(math.avg(a, b))\nplot(math.avg(a, b, high))\n`
    const byHand = `${V6}var float a = na\nvar float b = na\na := close\nb := open\nplot((a + b) / 2)\nplot((a + b + high) / 3)\n`
    expect(shape(laneBuild(viaAvg).ir)).toBe(shape(laneBuild(byHand).ir))
    const ours = lane(viaAvg)
    const theirs = host(`${V6}plot(math.avg(close, open))\nplot(math.avg(close, open, high))\n`)
    expect(ours[0]).toEqual(theirs[0])
    expect(ours[1]).toEqual(theirs[1])
  })

  it('⛔ fewer than two arguments refuses by name, in both lanes', () => {
    const r = laneBuild(`${V6}var float a = 0\na := close\nplot(math.avg(a))\n`)
    expect(r.ok).toBe(false)
    expect(r.refusal.message).toMatch(/math\.avg/)
    const t = translatePine(`${V6}plot(math.avg(close))\n`, { strict: true })
    expect(t.outputs[0].formula || null).toBeNull()
  })

  it('⭐ VENDOR — donchian\'s Basis, with its arguments carried in runtime state, is TradingView\'s', () => {
    const cap = load('harness/donchian-channels-rddt-1d-2026-09-28.json')
    const bars = toProductBars(cap)
    const src = `${V6}var float t = na\nvar float b = na\n`
      + 't := ta.ema(ta.highest(high, 100), 1)\nb := ta.ema(ta.lowest(low, 100), 1)\nplot(math.avg(t, b))\n'
    const [basis] = lane(src, { bars })
    const c = 1 + cap.study.plots.findIndex((p) => p.title === 'Basis')
    let compared = 0
    cap.plotValues.rows.forEach((r, j) => {
      if (r[c] === null || r[c] === undefined) return
      compared += 1
      expect(Math.abs(basis[j] - r[c]) <= 1e-9 * Math.abs(r[c]), `bar ${j}: ${basis[j]} vs ${r[c]}`).toBe(true)
    })
    expect(compared).toBeGreaterThan(400)
  })
})

describe('⭐ 5 — `input.color` is its default colour, and mints nothing', () => {
  it('⭐ the same program as the default written in', () => {
    const viaInput = `${V6}var color c = input.color(color.red, "C")\nc := close > open ? c : input.color(#123456, "D")\nbgcolor(c)\n`
    const written = `${V6}var color c = color.red\nc := close > open ? c : #123456\nbgcolor(c)\n`
    expect(shape(laneBuild(viaInput).ir)).toBe(shape(laneBuild(written).ir))
  })

  it('⛔ a default that is not a colour refuses by name', () => {
    const r = laneBuild(`${V6}var color c = na\nc := input.color(close)\nbgcolor(c)\n`)
    expect(r.ok).toBe(false)
  })
})

describe('⭐ 6 — `syminfo.mintick` from the tick-size table, settled at bind', () => {
  const CAPS = [
    ['vw-mintick-aapl-1d-2026-09-27.json', { ticker: 'AAPL', exchange: 'NASDAQ' }],
    ['vw-mintick-brka-1d-2026-09-27.json', { ticker: 'BRK.A', exchange: 'NYSE' }],
    ['vw-mintick-spy-1d-2026-09-27.json', { ticker: 'SPY', exchange: 'NYSE Arca' }],
  ]
  for (const [file, symbol] of CAPS) {
    it(`⭐ VENDOR ${symbol.ticker}: the run's mintick is TradingView's M01 on every bar, and the host's`, () => {
      const cap = load(file)
      const bars = toProductBars(cap)
      const [m] = lane(`${V6}var float m = na\nm := syminfo.mintick\nplot(m)\n`, { bars, symbol })
      const titles = cap.study.plots.map((p) => p.title)
      const c = 1 + titles.findIndex((t) => t.startsWith('M01'))
      expect(c).toBeGreaterThan(0)
      cap.plotValues.rows.forEach((r, j) => expect(same(m[j], r[c]), `bar ${j}`).toBe(true))
      const [h] = host(`${V6}plot(syminfo.mintick)\n`, { bars, symbol })
      expect(m).toEqual(h)
    })
  }

  it('⛔ an exchange the table does not hold refuses BY NAME, never a default', () => {
    const r = laneBuild(`${V6}var float m = na\nm := syminfo.mintick\nplot(m)\n`, { symbol: { ticker: 'AITX', exchange: 'OTC' } })
    expect(r.ok).toBe(false)
    expect(r.refusal.message).toMatch(/syminfo\.mintick/)
  })

  it('⭐ the compile-only door leaves it to the binding; a build WITH bars and no symbol still refuses', () => {
    expect(probeRuntimeProgram(`${V6}var float m = na\nm := syminfo.mintick\nplot(m)\n`)).toEqual(expect.objectContaining({ ok: true }))
    const r = laneBuild(`${V6}var float m = na\nm := syminfo.mintick\nplot(m)\n`, { symbolAtBind: true })
    expect(r.ok, 'bars in hand: the symbol is owed, not deferred').toBe(false)
    expect(r.refusal.message).toMatch(/syminfo\.mintick/)
  })
})

describe('⭐ 6b — on the product path the run settles `syminfo.mintick` from the CHART\'s symbol', () => {
  afterEach(() => { vi.unstubAllEnvs() })
  // A drawing whose value only a `while` computes (C18's shape), reading the tick.
  const SRC = '//@version=6\nindicator("t", overlay = true)\nif barstate.islast\n    int i = 0\n    float s = 0.0\n'
    + '    while i < 3\n        s += close[i] + syminfo.mintick\n        i += 1\n    if s > 0\n        label.new(bar_index, s, "sum")\n'
  const B = Array.from({ length: 12 }, (_, i) => ({
    t: `2026-01-${String(i + 2).padStart(2, '0')}`, o: 100 + i, h: 102 + i, l: 99 + i, c: 101 + i, v: 1000,
  }))
  const drawn = (symbol) => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const d = memberPaneDefinition({ source: SRC, id: 'u_c23_tick', name: 'tick' })
    expect(d.ok, d.reason).toBe(true)
    expect(d.definition.objects.runtime, 'the value is read from the runtime lane').toBeTruthy()
    const reader = objectReaderFor(d.definition, B, {
      tf: 'D', newestBarIsForming: false, historyFromListing: true, ...(symbol ? { symbol } : {}),
    })
    const run = evaluateObjects(reader.program, {
      barCount: B.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
    })
    return { runtime: reader.runtime, labels: run.live.filter((o) => o.family === 'label').map((o) => o.props.y) }
  }
  it('⭐ with the chart\'s symbol the label stands at the three closes plus three ticks', () => {
    const got = drawn({ ticker: 'RDDT', exchange: 'NYSE' })
    expect(got.runtime).toEqual({ served: true, reason: null })
    const want = B.slice(-3).reduce((a, b) => a + b.c + 0.01, 0)
    expect(got.labels).toHaveLength(1)
    expect(Math.abs(got.labels[0] - want)).toBeLessThan(1e-9)
  })
  it('⛔ with no symbol (or one the table does not hold) the value is withheld, never defaulted', () => {
    for (const symbol of [null, { ticker: 'AITX', exchange: 'OTC' }]) {
      const got = drawn(symbol)
      expect(got.runtime.served, JSON.stringify(symbol)).toBe(false)
      expect(got.labels).toEqual([])
    }
  })
})

describe('⭐ 7 — `alert()` is a presentation call: nothing drawn, arguments evaluated as Pine does', () => {
  it('⭐ a message of values is the same program as no alert at all', () => {
    const plain = shape(laneBuild(`${V6}plot(close)\n`).ir)
    expect(shape(laneBuild(`${V6}alert("hi")\nplot(close)\n`).ir)).toBe(plain)
    expect(shape(laneBuild(`${V6}alert("c " + str.tostring(close), alert.freq_once_per_bar_close)\nplot(close)\n`).ir)).toBe(plain)
    expect(shape(laneBuild(`${V6}lab(s) =>\n    string r = s\n    r := r + "!"\n    r\nalert(lab("x"))\nplot(close)\n`).ir))
      .toBe(shape(laneBuild(`${V6}lab(s) =>\n    string r = s\n    r := r + "!"\n    r\nplot(close)\n`).ir))
  })

  it('⭐ a message whose evaluation CHANGES something is evaluated where the call stands', () => {
    const src = `${V6}var a = array.new<float>()\nf() =>\n    array.push(a, 1)\n    "x"\nalert(f())\nplot(array.size(a))\n`
    const [size] = lane(src)
    expect(size).toEqual(Array.from({ length: N }, (_, i) => i + 1))
  })
})

describe('⭐ 8 — Pine v6 `and`/`or` are lazy for every operand', () => {
  const stops = (ver) => `${ver}var a = array.new<float>()\nvar bool b = false\n`
    + 'plot(b and array.get(a, -1) > 0 ? 1 : 0)\nplot(not b or array.get(a, -1) > 0 ? 1 : 0)\n'

  it('⭐ v6: the undecided side is not run — a bool SLOT on the left no longer reads index -1', () => {
    const [x, y] = lane(stops(V6))
    expect(x.every((v) => v === 0)).toBe(true)
    expect(y.every((v) => v === 1)).toBe(true)
  })

  it('⛔ CONTROL — v5 evaluates both operands, as Pine v5 does, and the run stops', () => {
    expect(() => lane(stops(V5))).toThrow(/index -1/)
  })

  it('⭐ a v6 operand this lane holds as NaN is Pine\'s false; finite operands answer as the eager form', () => {
    const src = `${V6}var bool n = na\nbool c = close > open\nvar bool p = false\np := c\n`
      + 'var bool t = true\nvar bool f = false\n'
      + 'plot(n and true ? 1 : 2)\nplot(n or false ? 1 : 2)\nplot(p and c ? 1 : 0)\nplot(p or c ? 1 : 0)\n'
      + 'plot(t and n ? 1 : 2)\nplot(f or n ? 1 : 2)\n'
    const [na1, na2, and1, or1, na3, na4] = lane(src)
    expect(na1.every((v) => v === 2)).toBe(true)
    expect(na2.every((v) => v === 2)).toBe(true)
    // the RIGHT operand held as NaN is Pine's false too, not a propagated NaN
    expect(na3.every((v) => v === 2), '`true and na`').toBe(true)
    expect(na4.every((v) => v === 2), '`false or na`').toBe(true)
    const [hAnd, hOr] = host(`${V6}plot(close > open and close > open ? 1 : 0)\nplot(close > open or close > open ? 1 : 0)\n`)
    expect(and1).toEqual(hAnd)
    expect(or1).toEqual(hOr)
  })
})
