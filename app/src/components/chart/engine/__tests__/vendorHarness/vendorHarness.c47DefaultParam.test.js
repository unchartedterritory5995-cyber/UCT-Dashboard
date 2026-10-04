// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c47DefaultParam.test.js
//
// ─── C47 — A DEFAULT PARAMETER VALUE IN A USER FUNCTION (the drawing lane) ────
//
//     resolutionInMinutes(tf = "") =>
//         chartTf = timeframe.multiplier * (…)
//         float result = tf == "" ? chartTf : request.security(syminfo.tickerid, tf, chartTf)
//
// liquidity-heatmap's fourteen label sites all read `resolutionInMinutes()`, and
// every one was `pine:function-def`: the header reader does not take a `=`.
//
// ⭐ WHAT IS SERVED (`pine.js::functionParamDefaults`, `inlineUserFunction`): a
// trailing parameter that declares ONE LITERAL default, and a call that leaves it
// off the end. The body then runs with that literal — the same program a member
// gets by writing the default at the call, which is what the equivalence rails
// below hold, statement for statement.
//
// ⛔ WHAT IT DOES NOT MOVE. liquidity-heatmap stops on its NEXT wall, by name:
// `resolutionInMinutes("3")` / `("240")` is `request.security(tickerid, "3",
// chartTf)` — a timeframe below the chart's, with `timeframe.*` read inside the
// request. Unwitnessed, refused (`pine:request`). Labels stay 27 / 0, withheld.
//
// ⛔ AND WHAT STAYS REFUSED: a default that names anything but a built-in, or is
// an expression or a call; too many arguments; a named argument.
// ⭐ H5 (step 84) WIDENED THREE OF C47's REFUSALS, each re-stated below: a dotted
// built-in constant or a bar series as the default (the runtime lane's L2 rule,
// one rule, `paramDefaultShapeOk`); a required parameter behind an optional one;
// and the PLOT lane (C46 made a newly served output APPEND parameter ids).
//
// ⚠️ THE WITNESS IS PINE'S REFERENCE, AND ONE CAPTURE THAT IS CONSISTENT WITH IT
// WITHOUT SEPARATING IT: pro-trading-art calls `drawLL(…, color.lime)` with its
// `style = label.style_label_down` left off, and TradingView draws those ten
// labels `label_down` — which is also `label.new`'s own default. The probe that
// separates the two is queued (`docs/pine/capture-queue-2026-10-01-c47.md`,
// Q-C47-2, `tools/visual_conformance/probes/vw-default-param.pine`).
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'

import { loadCapture, gradeCapture } from './harness'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { translatePine } from '../../ast/pine'

const HARNESS = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const capture = (name) => {
  const loaded = loadCapture(path.join(HARNESS, name))
  if (!loaded.capture) throw new Error(`not a capture — ${loaded.reason}`)
  return loaded.capture
}
const HEATMAP = 'liquidity-heatmap-nephew-sam-rddt-1d-2026-09-28.json'

afterEach(() => { vi.unstubAllEnvs() })

const HEAD = ['//@version=5', 'indicator("c47 default", overlay = true)']
const objectsOf = (lines) => translatePine([...HEAD, ...lines].join('\n'), { strict: true, basePeriod: 'D' })
const programOf = (lines) => {
  const t = objectsOf(lines)
  expect(t.objects, JSON.stringify(t.objectDiagnostics)).toBeTruthy()
  return t
}
/** The program with everything that is a POSITION IN THE TEXT removed: the two
 *  scripts under comparison differ by a few characters on two lines. */
const shape = (t) => JSON.stringify({ trees: t.objects.trees, ops: t.objects.ops }, (k, v) => (k === 'site' || k === 'at' ? undefined : v))
const drops = (t) => (t.objectDiagnostics && t.objectDiagnostics.dropReasons) || {}
const guards = (t) => (t.objectDiagnostics && t.objectDiagnostics.guardRefusals) || []

const LABEL = (y, text = '"a"') => ['if barstate.islast', `    label.new(bar_index, ${y}, ${text})`]
/** The call in the CONDITION, so a refusal is recorded by guard (`guardRefusals`). */
const GUARDED = (call) => [`if ${call} > 0`, '    label.new(bar_index, close, "a")']

describe('⭐ C47 — an omitted trailing argument takes the literal default its parameter declares', () => {
  const pairs = [
    ['a number', ['f(x, k = 2) => x * k'], 'f(close)', ['f(x, k) => x * k'], 'f(close, 2)'],
    ['a negative number', ['f(x, k = -3) => x + k'], 'f(close)', ['f(x, k) => x + k'], 'f(close, -3)'],
    ['a decimal', ['f(x, k = 0.5) => x * k'], 'f(high)', ['f(x, k) => x * k'], 'f(high, 0.5)'],
    ['a bool', ['f(x, up = true) => up ? x : -x'], 'f(close)', ['f(x, up) => up ? x : -x'], 'f(close, true)'],
    ['a bool, false', ['f(x, up = false) => up ? x : -x'], 'f(close)', ['f(x, up) => up ? x : -x'], 'f(close, false)'],
    ['a string that selects an arm', ['f(x, m = "hi") => m == "hi" ? x : x * 2'], 'f(close)',
      ['f(x, m) => m == "hi" ? x : x * 2'], 'f(close, "hi")'],
    ['a typed parameter', ['f(float x, int k = 4) => x * k'], 'f(close)', ['f(float x, int k) => x * k'], 'f(close, 4)'],
    ['two defaults, none given', ['f(x, a = 2, b = 3) => x * a + b'], 'f(close)', ['f(x, a, b) => x * a + b'], 'f(close, 2, 3)'],
    ['two defaults, the first given', ['f(x, a = 2, b = 3) => x * a + b'], 'f(close, 7)', ['f(x, a, b) => x * a + b'], 'f(close, 7, 3)'],
    ['every parameter defaulted', ['f(a = 2, b = 3) => close * a + b'], 'f()', ['f(a, b) => close * a + b'], 'f(2, 3)'],
    ['a multi-line body', ['f(x, k = 2) =>', '    y = x * k', '    y + 1'], 'f(close)',
      ['f(x, k) =>', '    y = x * k', '    y + 1'], 'f(close, 2)'],
  ]
  for (const [label, withDefault, shortCall, plain, fullCall] of pairs) {
    it(`${label}: \`${shortCall}\` is the program \`${fullCall}\` is`, () => {
      const short = programOf([...withDefault, ...LABEL(shortCall)])
      const full = programOf([...plain, ...LABEL(fullCall)])
      expect(drops(short)).toEqual({})
      expect(drops(full)).toEqual({})
      expect(shape(short)).toBe(shape(full))
      // non-vacuity: the label's y really is a tree over the function's body
      expect(short.objects.ops.some((o) => o.k === 'create' && o.family === 'label' && o.props.y && o.props.y.v === 'tree')).toBe(true)
    })
  }

  it('an argument GIVEN wins over the default (control: the two programs differ)', () => {
    const def = ['f(x, k = 2) => x * k']
    const dflt = programOf([...def, ...LABEL('f(close)')])
    const given = programOf([...def, ...LABEL('f(close, 5)')])
    const five = programOf(['f(x, k) => x * k', ...LABEL('f(close, 5)')])
    expect(shape(given)).toBe(shape(five))
    expect(shape(given)).not.toBe(shape(dflt))
  })

  it('`na` as the default is `na` in the body', () => {
    const short = programOf(['f(x, k = na) => na(k) ? x : x * k', ...LABEL('f(close)')])
    const full = programOf(['f(x, k) => na(k) ? x : x * k', ...LABEL('f(close, na)')])
    expect(shape(short)).toBe(shape(full))
  })
})

describe('⛔ C47 — what a default does NOT open', () => {
  const refusedAs = (lines, guard) => {
    const t = objectsOf(lines)
    expect(drops(t), JSON.stringify(guards(t))).toEqual({ 'guard:create': 1 })
    expect(guards(t).join(' | ')).toContain(guard)
  }
  it('control: the same guarded call with a literal default is not refused at all', () => {
    const t = objectsOf(['f(x, k = 2) => x * k', ...GUARDED('f(close)')])
    expect(drops(t)).toEqual({})
    expect(guards(t)).toEqual([])
  })
  it('two words that are not a type and a name are not a parameter (`f(x y = 2)`)', () => {
    const t = objectsOf(['f(x y = 2) => y', ...GUARDED('f()')])
    expect(drops(t)).not.toEqual({})
  })
  // ⭐ H5 (step 84) — re-stated on purpose: a dotted built-in constant and one of
  // Pine's bar series are now READ (`paramDefaultShapeOk`, the runtime lane's L2
  // rule, one rule for both lanes); a name, an expression or a call still is not.
  it('a default that is a name, an expression or a call keeps `pine:function-def`', () => {
    for (const d of ['k = other', 'k = 1 + 1', 'k = math.max(1, 2)']) {
      refusedAs(['other = 2', `f(x, ${d}) => x * k`, ...GUARDED('f(close)')], 'pine:function-def')
    }
  })
  it('⭐ H5 — a bar-series default is read; one the script binds itself is refused BY NAME', () => {
    const short = programOf(['f(x, k = close) => x * k', ...LABEL('f(high)')])
    const full = programOf(['f(x, k) => x * k', ...LABEL('f(high, close)')])
    expect(shape(short)).toBe(shape(full))
    refusedAs(['close = 2', 'f(x, k = close) => x * k', ...GUARDED('f(high)')], 'pine:function-def')
    // the sentence, on the plot lane where it is the output's own refusal
    const t = translatePine([...HEAD, 'close = 2', 'f(x, k = close) => x * k', 'plot(f(high))'].join('\n'), { strict: true, basePeriod: 'D' })
    const o = t.outputs.find((x) => x && x.kind !== 'alertcondition')
    expect(o.ast).toBeFalsy()
    expect(o.refusal.message).toMatch(/binds its own `close`/)
  })
  it('⭐ H5 — a required parameter behind an optional one is read when every argument is written', () => {
    const t = objectsOf(['f(k = 2, x) => x * k', ...GUARDED('f(3, close)')])
    expect(drops(t)).toEqual({})
    // …and a call leaving the REQUIRED one out is the arity refusal it always was
    refusedAs(['f(k = 2, x) => x * k', ...GUARDED('f(3)')], 'pine:arity')
  })
  it('too few arguments for the parameters WITHOUT a default is `pine:arity`', () => {
    refusedAs(['f(x, y, k = 2) => x * y * k', ...GUARDED('f(close)')], 'pine:arity')
  })
  it('too many arguments is `pine:arity`', () => {
    refusedAs(['f(x, k = 2) => x * k', ...GUARDED('f(close, 2, 3)')], 'pine:arity')
  })
  it('a named argument is still `pine:named-argument`', () => {
    refusedAs(['f(x, k = 2) => x * k', ...GUARDED('f(close, k = 3)')], 'pine:named-argument')
  })
  it('a function with no default is untouched: a short call is `pine:arity`', () => {
    refusedAs(['f(x, k) => x * k', ...GUARDED('f(close)')], 'pine:arity')
  })

  // ⭐ H5 (step 84) — re-stated on purpose. The PLOT lane reads the header too: the
  // C47 confinement existed because a newly served plot minted parameter ids ahead
  // of saved ones, and since C46 an id is the input call's place in the source.
  // Graded on the member door: `vw-default-param-spy-1d-2026-10-02` D01–D15 MATCH
  // on 1,800 bars (`vendorHarness.h5DefaultParams`).
  it('⭐ the PLOT lane: a short call is the program the full call is', () => {
    const plotOf = (call) => {
      const t = translatePine([...HEAD, 'f(x, k = 2) => x * k', `plot(${call})`].join('\n'), { strict: true, basePeriod: 'D' })
      return t.outputs.find((x) => x && x.kind !== 'alertcondition')
    }
    const short = plotOf('f(close)')
    const full = plotOf('f(close, 2)')
    expect(short.ast, short.refusal && short.refusal.message).toBeTruthy()
    expect(short.ast).toEqual(full.ast)
    expect(plotOf('f(close, 3)').ast).not.toEqual(short.ast)
  })
  it('…and the control: the same function without the default plots', () => {
    const t = translatePine([...HEAD, 'f(x, k) => x * k', 'plot(f(close, 2))'].join('\n'), { strict: true, basePeriod: 'D' })
    const o = t.outputs.find((x) => x && x.kind !== 'alertcondition')
    expect(o.ast).toBeTruthy()
  })
})

describe('C47 — liquidity-heatmap: past the default, onto its request (by name)', () => {
  it('the fourteen label sites no longer stop at `pine:function-def`; each stops at `pine:request`', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const cap = capture(HEATMAP)
    const d = memberPaneDefinition({ source: cap.source.text, id: 'u_c47_heat', name: 'c47' })
    expect(d.ok, d.reason).toBe(true)
    const diag = d.translation.objectDiagnostics
    expect(diag.guardRefusals).toHaveLength(14)
    for (const g of diag.guardRefusals) {
      expect(g).toMatch(/^create@\d+: pine:request$/)
    }
    expect(diag.dropReasons).toEqual({ 'guard:create': 14 })
  }, 60000)

  it('⛔ graded: labels stay withheld (27 / 0), the table cell still agrees (1 / 1)', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const { verdict, integrity } = gradeCapture(capture(HEATMAP))
    expect(integrity.ok).toBe(true)
    const counts = Object.fromEntries(verdict.objects.counts.map((c) => [c.family, [c.vendor, c.ours]]))
    expect(counts.labels).toEqual([27, 0])
    expect(counts.tableCells).toEqual([1, 1])
    expect(verdict.objects.verdict).toBe('DIVERGE')
  }, 60000)
})
