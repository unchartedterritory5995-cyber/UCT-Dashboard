// app/src/components/chart/engine/ast/pineBuiltinsUnit.test.js
//
// ─── U-BUILTIN (2026-11-19) — BUILT-IN NAMES, EACH HELD TO A CAPTURE OR TO THE REFERENCE'S OWN SENTENCE ──
//
// `docs/pine/PARITY-ROADMAP-2026-11-18.md` U-BUILTIN; queue `docs/pine/capture-queue-2026-11-19-builtins.md`.
// Every block says what holds it:
//
//   T-D  `time("D")` and `time("D", session)` — VENDOR: `vw-bt-time-1440-spy-{1d,60}-2026-11-16` (Q-BT2),
//        through the member door on both lanes, every bar. Withholding off the regular session is railed in
//        both lanes by `periodAnchorParity.test.js` + `tests/test_ast_period_anchor_parity.py`.
//   B1   `timeframe.in_seconds("1440")` — VENDOR: the same captures, R7.
//   B2   `math.toradians` / `math.todegrees` — VENDOR: `vw-bt-toradians-spy-1d-2026-11-16` (Q-BT3).
//   B3   `math.asin` (v4 bare `asin`) — REFERENCE: "the arcsine ... in the range [-Pi/2, Pi/2], or na if y is
//        outside of range [-1, 1]", as `Math.asin`, exactly (no epsilon). The last bit owes Q-BI-ASIN.
//   B4   `color(na)` — REFERENCE: "Casts na to color": the cast IS `na` (the program is the same program).
//   B5   `ta.kc` with a computed flag — REFERENCE: its own "the same on pine" body,
//        `span = (useTrueRange) ? ta.tr : (high - low)`.
//   B6   `extend.*` bound to a name — REFERENCE: a named constant; the binding is the inline ternary.
//   B7   `text.format_bold + text.format_italic` — REFERENCE: `text_format` adds; one canonical value, the
//        host object pass's own (`canonicalTextFormat`).
//   B8   `math.e` — REFERENCE: "It is equal to 2.7182818284590452".
import { describe, it, expect, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { translatePine, canonicalTextFormat } from './pine'
import { parseFormula } from './parse'
import { interpret, isDayAnchor, isSessionDayGate } from './interpret'
import { buildRuntimeIr } from './pineRuntimeFrontend'
import { lowerIrProgram } from '../runtime/lowerIr'
import { execute } from '../runtime/vm'
import * as registry from '../nativeRegistry'
import { runOurSide, HARNESS_DEF_ID } from '../__tests__/vendorHarness/ourSide'
import { __permitRuntimePaneForTests, __resetRuntimePanePermission } from '../runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, __resetRuntimeAllowList } from '../runtimeKill'

const REPO = path.resolve(process.cwd(), '..')
const HARNESS = path.join(REPO, 'tests', 'fixtures', 'vendor', 'harness')
const capture = (id) => JSON.parse(fs.readFileSync(path.join(HARNESS, `${id}.json`), 'utf8'))
const GATE = (rel) => fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
const flagOf = (src) => (src.match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
const OBJECTS_ONLY_FLAG = flagOf(GATE('src/components/chart/engine/objectsOnlyPaneGate.js'))
const RUNTIME_FLAG = flagOf(GATE('src/components/chart/engine/runtimePaneGate.js'))
const NL = String.fromCharCode(10)
const V = (v, body) => `//@version=${v}${NL}${v >= 5 ? 'indicator' : 'study'}("t")${NL}${body}`

afterEach(() => {
  registry.uninstallUserDefinition(HARNESS_DEF_ID)
  vi.unstubAllEnvs()
  __resetRuntimePanePermission()
  __resetRuntimeAllowList()
})

/** The member door on a capture's own bars, on one lane: title → {column, withheldBy}. */
function door(cap, lane, text = cap.source.text) {
  vi.stubEnv(OBJECTS_ONLY_FLAG, '1')
  vi.stubEnv(RUNTIME_FLAG, lane === 'runtime' ? '1' : '')
  if (lane === 'runtime') { __permitRuntimePaneForTests(); __allowEveryRuntimeScriptForTests() }
  const side = runOurSide({ ...cap, source: { ...cap.source, text } })
  expect(side.ok, side.refusal).toBe(true)
  return { side, plot: (title) => side.plots.find((p) => p.title === title) }
}
/** Bars where our column differs from TradingView's, and how many we drew. */
function grade(cap, plot, title) {
  const j = 1 + cap.study.plots.map((p) => p.title).indexOf(title)
  expect(j, `${title} is not in the capture`).toBeGreaterThan(0)
  const byTime = new Map(cap.plotValues.rows.map((r) => [r[0], r[j]]))
  let bad = 0
  let drawn = 0
  let first = null
  cap.bars.rows.forEach(([t], i) => {
    if (!byTime.has(t)) return
    const got = plot.column[i]
    if (got === null || (typeof got === 'number' && Number.isNaN(got))) return
    drawn += 1
    if (got !== byTime.get(t)) { bad += 1; if (!first) first = { t, want: byTime.get(t), got } }
  })
  return { bad, drawn, first, n: byTime.size }
}
const without = (text, re) => text.split(NL).filter((l) => !re.test(l)).join(NL)

// ─── T-D ──────────────────────────────────────────────────────────────────────────────────────────

describe('T-D — time("D") is the 09:30 session open; time("D", "0930-1600") reads it inside the window (Q-BT2)', () => {
  // The probe's "1440" session / anchor rows (R1, R3, R5) are refused by name (B1 reads "1440" only in
  // `timeframe.in_seconds`), and in strict mode one refused output refuses the whole script, so they are
  // taken out; TradingView reads them equal to R2 / R4 / R6 on every bar.
  const TEXT = (cap) => without(cap.source.text, /time\("1440"/)
  const DAILY = 'vw-bt-time-1440-spy-1d-2026-11-16'
  const HOURLY = 'vw-bt-time-1440-spy-60-2026-11-16'

  it('host lane, 1D: R2, R4, R6, R7 are TradingView on all 8,508 bars', () => {
    const cap = capture(DAILY)
    const { plot } = door(cap, 'host', TEXT(cap))
    for (const title of ['R2_secs_D_rth', 'R4_secs_D_premarket', 'R6_secs_D_anchor', 'R7_in_seconds_1440']) {
      const r = grade(cap, plot(title), title)
      expect(r.n).toBe(8508)
      expect(r.drawn, title).toBe(8508)
      expect(r.bad, `${title}: first ${JSON.stringify(r.first)}`).toBe(0)
    }
  })

  it('host lane, RTH 60m: R2, R6, R7 are TradingView on all 20,861 bars; R4 (a 00:00 window) is withheld by name', () => {
    const cap = capture(HOURLY)
    const { plot } = door(cap, 'host', TEXT(cap))
    for (const title of ['R2_secs_D_rth', 'R6_secs_D_anchor', 'R7_in_seconds_1440']) {
      const r = grade(cap, plot(title), title)
      expect(r.drawn, title).toBe(20861)
      expect(r.bad, `${title}: first ${JSON.stringify(r.first)}`).toBe(0)
    }
    // ⛔ NON-VACUITY: the anchor really is before the bar on most hourly bars (the -34,200 s midnight defect
    // and a fold to bare `time` would both fail this)
    const j = 1 + cap.study.plots.map((p) => p.title).indexOf('R6_secs_D_anchor')
    expect(cap.plotValues.rows.filter((r) => r[j] < 0).length).toBeGreaterThan(17000)
    const r4 = plot('R4_secs_D_premarket')
    expect(r4.withheldBy).toBe('time-session:day-on-other-chart')
  })

  it('runtime lane: the same rows read from runtime state are TradingView on every bar the run draws', () => {
    const RT = [`//@version=6`, 'indicator("UCTPROBE_VW_BT_TIME_1440", overlay = false)',
      'secs(t) => na(t) ? -1.0 : (t - time) / 1000.0', 'a = array.new_float(2, 0.0)',
      'array.set(a, 0, secs(time("D", "0930-1600")))', 'array.set(a, 1, secs(time("D")))',
      'plot(array.get(a, 0), "R2_secs_D_rth")', 'plot(array.get(a, 1), "R6_secs_D_anchor")'].join(NL)
    for (const [id, least] of [[DAILY, 8508], [HOURLY, 20000]]) {
      const cap = capture(id)
      const { side, plot } = door(cap, 'runtime', RT)
      expect(side.door).toBe('runtime')
      for (const title of ['R2_secs_D_rth', 'R6_secs_D_anchor']) {
        const r = grade(cap, plot(title), title)
        expect(r.drawn, `${id} ${title}`).toBeGreaterThanOrEqual(least)
        expect(r.bad, `${id} ${title}: first ${JSON.stringify(r.first)}`).toBe(0)
      }
    }
  })

  it('the trees: the anchor shape, the 09:30 window reads it, any other window is the daily gate', () => {
    const tree = (body) => { const t = translatePine(V(6, body), { strict: true }); expect(t.ok).toBe(true); return t.outputs[t.selected].ast }
    expect(isDayAnchor(tree('plot(time("D"))'))).toBe(true)
    expect(isDayAnchor(tree('plot(time("1D"))'))).toBe(true)
    const rth = tree('plot(time("D", "0930-1600"))')
    expect(rth.type === 'op' && rth.name === '?:' && isDayAnchor(rth.args[1])).toBe(true)
    expect(isSessionDayGate(tree('plot(time("D", "1000-1100"))'))).toBe(true)
    // ⛔ the chart's own timeframe keeps its own tree (no anchor, no gate)
    const own = tree('plot(time(timeframe.period, "0930-1600"))')
    expect(isSessionDayGate(own) || isDayAnchor(own.args && own.args[1])).toBe(false)
  })
})

// ─── B1 ───────────────────────────────────────────────────────────────────────────────────────────

describe('B1 — "1440" is "D" for timeframe.in_seconds only', () => {
  it('timeframe.in_seconds("1440") is 86400 (R7 above); "1440" in the session clock and the anchor still refuses', () => {
    const f = translatePine(V(6, 'plot(timeframe.in_seconds("1440") + close)'), { strict: true })
    expect(f.ok).toBe(true)
    expect(f.outputs[f.selected].formula).toBe('86400 + close')
    for (const body of ['plot(time("1440", "0930-1600"))', 'plot(time("1440"))']) {
      const t = translatePine(V(6, body), { strict: true })
      expect(t.ok, body).toBe(false)
    }
  })
})

// ─── B2 ───────────────────────────────────────────────────────────────────────────────────────────

describe('B2 — math.toradians / math.todegrees are x * pi / 180 and y * 180 / pi (Q-BT3)', () => {
  const ID = 'vw-bt-toradians-spy-1d-2026-11-16'
  // D3 (`x * (math.pi / 180)` written by hand, not the function) is one ulp off TradingView on 8,457 bars:
  // its constant quotient is not IEEE `Math.PI / 180` there. Recorded in the capture queue; not graded here.
  const ROWS = ['D0_bar_index_CONTROL', 'X_degrees', 'D1_minus_x_pi_over_180', 'D2_minus_x_over_180_pi',
    'E1_minus_y_180_over_pi', 'E2_minus_y_over_pi_180', 'E3_minus_y_times_180_pi']

  it('host lane: every row but D3, all 8,508 bars, exactly', () => {
    const cap = capture(ID)
    const { plot } = door(cap, 'host')
    for (const title of ROWS) {
      const r = grade(cap, plot(title), title)
      expect(r.drawn, title).toBe(8508)
      expect(r.bad, `${title}: first ${JSON.stringify(r.first)}`).toBe(0)
    }
    // ⛔ NON-VACUITY: D2 / E2 are non-zero on thousands of bars, so a different spelling of either function
    // would have moved them (D1 / E1 alone are 0 for any self-consistent spelling)
    const j = (t) => 1 + cap.study.plots.map((p) => p.title).indexOf(t)
    expect(cap.plotValues.rows.filter((r) => r[j('D2_minus_x_over_180_pi')] !== 0).length).toBeGreaterThan(3000)
  })

  it('runtime lane: the same rows over runtime state, bar for bar', () => {
    const cap = capture(ID)
    const text = cap.source.text.replace('x = close * 7.3 + bar_index * 13.17',
      ['a = array.new_float(1, 0.0)', 'array.set(a, 0, close * 7.3 + bar_index * 13.17)', 'x = array.get(a, 0)'].join(NL))
    expect(text).not.toBe(cap.source.text)
    const { side, plot } = door(cap, 'runtime', text)
    expect(side.door).toBe('runtime')
    for (const title of ROWS) {
      const r = grade(cap, plot(title), title)
      expect(r.drawn, title).toBe(8508)
      expect(r.bad, `${title}: first ${JSON.stringify(r.first)}`).toBe(0)
    }
  })

  it('one angle, by position; the v4 bare spelling is the same function, the v6 bare one refuses by name', () => {
    expect(translatePine(V(6, 'plot(math.toradians(close, 2))'), { strict: true }).ok).toBe(false)
    const v4 = translatePine(V(4, 'plot(toradians(close))'), { strict: true })
    const v6 = translatePine(V(6, 'plot(math.toradians(close))'), { strict: true })
    expect(v4.outputs[v4.selected].formula).toBe(v6.outputs[v6.selected].formula)
    const bare = translatePine(V(6, 'plot(toradians(close))'), { strict: true })
    expect(bare.ok).toBe(false)
    expect(String(bare.refusal.message)).toContain('`math.toradians`')
  })
})

// ─── B3 ───────────────────────────────────────────────────────────────────────────────────────────

describe('B3 — math.asin is Math.asin, na outside [-1, 1] (the reference sentence, no epsilon)', () => {
  const YS = [-1, -0.75, -0.5, 0, 1e-17, 0.3333333333333333, 0.5, 0.9999999999999999, 1, 1.0000000000000002, -2, NaN]
  const BARS = YS.map((c, i) => ({ t: i, o: c, h: c, l: c, c, v: 1 }))
  const want = YS.map((y) => (Number.isNaN(y) || y < -1 || y > 1 ? null : Math.asin(y)))
  const asNull = (col) => Array.from(col, (x) => (Number.isFinite(x) ? x : null))

  it('host lane: every value is Math.asin bit for bit, na outside the domain and for na', () => {
    const t = translatePine(V(6, 'plot(math.asin(close))'), { strict: true })
    const p = parseFormula(t.outputs[t.selected].formula)
    expect(asNull(interpret(p.ast, BARS))).toEqual(want)
  })

  it('runtime lane: the same over runtime state', () => {
    const src = V(6, ['a = array.new_float(1, 0.0)', 'array.set(a, 0, close)', 'plot(math.asin(array.get(a, 0)))'].join(NL))
    const b = buildRuntimeIr(src, { bars: BARS, inputs: {} })
    expect(b.ok, b.ok ? '' : b.refusal.message).toBe(true)
    const prog = lowerIrProgram(b.ir, { historyFromListing: true })
    const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((x) => x[k])))
    const out = execute(prog, { bars: BARS.length, series, columns: prog.columns, confirmed: true }).outputs[0]
    expect(asNull(out)).toEqual(want)
  })

  it('v4 bare asin is math.asin (committed:screener-mean-reversion-channel: 2 * asin(1)); v6 bare refuses', () => {
    const v4 = translatePine(V(4, 'pi = 2 * asin(1)\nplot(close * pi)'), { strict: true })
    expect(v4.ok).toBe(true)
    expect(v4.outputs[v4.selected].formula).toBe('close * (2 * asin(1))')
    const bare = translatePine(V(6, 'plot(asin(0.5))'), { strict: true })
    expect(bare.ok).toBe(false)
    expect(String(bare.refusal.message)).toContain('`math.asin`')
  })
})

// ─── B4–B7: the runtime lane's program is the served program ─────────────────────────────────────────

const programOf = (body, opts = {}) => {
  const b = buildRuntimeIr(V(6, body), { bars: [], inputs: {}, newestBarIsForming: false, ...opts })
  expect(b.ok, b.ok ? '' : `${b.refusal.guard}: ${b.refusal.message}`).toBe(true)
  return JSON.stringify(b.ir.statements)
}
const DRAW = { objectsInRun: true }

describe('B4 — color(na) is na ("Casts na to color"): the same program wherever it stands', () => {
  const PAIRS = {
    'a label colour (the drawing build)': ['var float k = 0.0\nk := k + 1\nif k > 3\n    label.new(bar_index, close, "x", color = color(na), textcolor = color.red)\nplot(k)',
      'var float k = 0.0\nk := k + 1\nif k > 3\n    label.new(bar_index, close, "x", color = na, textcolor = color.red)\nplot(k)', DRAW],
    'a ternary arm': ['var float k = 0.0\nk := k + 1\nbgcolor(k > 3 ? color.red : color(na))',
      'var float k = 0.0\nk := k + 1\nbgcolor(k > 3 ? color.red : na)', {}],
    'a var it seeds, then reassigned': ['var float k = 0.0\nk := k + 1\nvar c = color(na)\nc := k > 3 ? color.red : color(na)\nbgcolor(c)',
      'var float k = 0.0\nk := k + 1\nvar color c = na\nc := k > 3 ? color.red : na\nbgcolor(c)', {}],
  }
  for (const [what, [cast, plain, opts]] of Object.entries(PAIRS)) {
    it(what, () => { expect(programOf(cast, opts)).toBe(programOf(plain, opts)) })
  }
})

describe('B5 — ta.kc with a computed flag is the reference body: span = useTrueRange ? ta.tr : high - low', () => {
  const BARS = Array.from({ length: 80 }, (_, i) => {
    const c = 100 + Math.sin(i / 4) * 5 + i * 0.1
    return { t: 1700000000 + i * 86400, o: c - 0.5, h: c + 1 + (i % 3), l: c - 1 - (i % 2), c, v: 1000 + i }
  })
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((x) => x[k])))
  const run = (body) => {
    const b = buildRuntimeIr(V(6, body), { bars: BARS, inputs: {} })
    expect(b.ok, b.ok ? '' : `${b.refusal.guard}: ${b.refusal.message}`).toBe(true)
    const prog = lowerIrProgram(b.ir, { historyFromListing: true })
    return execute(prog, { bars: BARS.length, series, columns: prog.columns, confirmed: true }).outputs.map((o) => Array.from(o))
  }
  const REF = ['f_kc(src, length, mult, useTrueRange) =>', '    float basis = ta.ema(src, length)',
    '    float span = (useTrueRange) ? ta.tr : (high - low)', '    float rangeEma = ta.ema(span, length)',
    '    [basis, basis + rangeEma * mult, basis - rangeEma * mult]'].join(NL)
  for (const on of ['On', 'Off']) {
    it(`the flag "${on}": the three bands are the reference function's, column for column`, () => {
      const src = (call) => [`s = input.string("${on}", "tr", options = ["On", "Off"])`, 'a = array.new_float(1, 0.0)',
        'array.set(a, 0, close)', 'x = array.get(a, 0)', call, 'plot(m)', 'plot(u)', 'plot(l)'].join(NL)
      const ours = run(src('[m, u, l] = ta.kc(x, 10, 2, s == "On")'))
      const ref = run([REF, src('[m, u, l] = f_kc(x, 10, 2, s == "On")')].join(NL))
      expect(ours).toEqual(ref)
      expect(ours[1].filter(Number.isFinite).length).toBeGreaterThan(60)
    })
  }
  it('host lane: an input flag at its default is the literal form at that value', () => {
    const f = (body) => { const t = translatePine(V(6, body), { strict: true }); expect(t.ok).toBe(true); return t.outputs.map((o) => o.formula) }
    expect(f('b = input.bool(false, "tr")\n[m, u, l] = ta.kc(close, 20, 2, b)\nplot(u)'))
      .toEqual(f('[m, u, l] = ta.kc(close, 20, 2, false)\nplot(u)'))
    expect(f('s = input.string("On", "tr", options = ["On", "Off"])\n[m, u, l] = ta.kc(close, 20, 2, s == "On")\nplot(u)'))
      .toEqual(f('[m, u, l] = ta.kc(close, 20, 2, true)\nplot(u)'))
  })
})

describe('B6 — extend.* bound to a name is the inline choice (session-tpo-profile)', () => {
  it('the drawing build reads `ext = c ? extend.right : extend.none` as RT5 reads it written inline', () => {
    const head = 'b = input.bool(true, "x")\nvar line poc = na\nif barstate.islast\n'
    expect(programOf(`${head}    ext = b ? extend.right : extend.none\n    poc := line.new(bar_index - 5, close, bar_index, close, extend = ext)\nplot(close)`, DRAW))
      .toBe(programOf(`${head}    poc := line.new(bar_index - 5, close, bar_index, close, extend = b ? extend.right : extend.none)\nplot(close)`, DRAW))
  })
})

describe('B7 — a sum of text.format_* is one canonical format, the host object pass\'s own', () => {
  const lab = (fmt) => `fmt = ${fmt}\nvar float k = 0.0\nk := k + 1\nif k > 3\n    label.new(bar_index, close, "x", text_formatting = fmt)\nplot(close)`
  it('bold + italic is "bold_italic" in either order, never the concatenation', () => {
    const a = programOf(lab('text.format_bold + text.format_italic'), DRAW)
    const b = programOf(lab('text.format_italic + text.format_bold'), DRAW)
    expect(a).toBe(b)
    expect(canonicalTextFormat(['italic', 'bold'])).toBe('bold_italic')
    expect(a).toContain('"bold_italic"')
    expect(a).not.toContain('bolditalic')
  })
})

describe('B8 — math.e is the reference value', () => {
  it('"2.7182818284590452" is the double Math.E; both lanes read it', () => {
    expect(Number('2.7182818284590452')).toBe(Math.E)
    const t = translatePine(V(6, 'plot(close * math.e)'), { strict: true })
    expect(t.outputs[t.selected].formula).toBe('close * 2.718281828459045')
    programOf('f(float d, float b = 1.0) => math.pow(math.e, -0.5 * math.pow(d / b, 2.0))\nvar float k = 0.0\nk := k + 1\nplot(f(k))')
  })
})
