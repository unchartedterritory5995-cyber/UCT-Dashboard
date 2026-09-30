// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c21DualView.test.js
//
// ─── C21 — DUAL-VIEW: THE RUN AGREES WITH TRADINGVIEW, AND NOTHING IS DRAWN ─────
//
// Captured on a live TradingView chart 2026-09-28 (NYSE:RDDT 1D, 632 bars from the
// listing day). TradingView holds 436 objects: seven floating HTF candles made on
// bar 0 and re-set on every bar (7 boxes, 28 lines), and — all made on the last
// bar — 104 boxes / 208 lines / 86 labels for the 43 candle patterns its
// 200-candle scan finds, one centre label and two floating pattern labels.
//
// ⛔ ON THE PRODUCT PATH IT DRAWS NOTHING, AND EVERY REASON IS NAMED:
//   · the floating candles' updates read `var`s declared inside `update_drawings`'
//     `for` (`htf_o`, …) — ONE variable across passes and bars, fed by 212-slot
//     arrays shortened by a `while` — `pine:state`, named as that construct;
//   · the ten drawing lists diverge (`collsDivergedWhy`): the floating lists' bar-0
//     pushes read the loop counter, the historical lists' pushes sit in a loop
//     whose bound reads an array; their 39 reads are withheld (`coll:diverged`);
//   · the runtime lane BUILDS it since C23 (its seven compile walls and the
//     eager v6 `and` served on a pane) — and on the bar that matters it needs
//     247,425 VM instructions as written (with this file's hooks 256,060; the
//     C21 substituted run needed 290,066 at `db6190f3f`, the eager `and`s being
//     the difference) against `INSTRUCTIONS_PER_BAR` (200,000; not raised, by ruling).
//
// ⭐ WHAT C21 FIXED ON THE WAY — A WRONG VALUE IN THE RUNTIME LANE. A plain local
// `float htf_o = get_htf_open(i)` in `detect_pattern_at_index` was lowered as a
// PERSISTENT slot because `update_drawings` declares `var float htf_o`: the lane
// keyed persistence by NAME across the whole script
// (`pineRuntimeFrontend.js::declarationPersists`). The pattern scan read the first
// bar's candles and found 51 patterns where TradingView drew 43. With the rule
// per declaration it finds TradingView's 43, in TradingView's order — the rail
// below, run with a TEST-ONLY ceiling (the product runs at `DEFAULT_LIMITS`, the
// k-clustering precedent, `vendorHarness.c18KClustering`).
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'

import { loadCapture } from './harness'
import { toProductBars } from './ourSide'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend'
import { runtimeClockOpts } from '../../ast/pineRuntimeClock'
import { lowerIrProgram } from '../../runtime/lowerIr'
import { execute } from '../../runtime/vm'
import { Budget, DEFAULT_LIMITS } from '../../runtime/limits'

const FILE = path.resolve(process.cwd(), '..',
  'tests/fixtures/vendor/harness/dual-view-htf-candlestick-patterns-theultimator5-rddt-1d-2026-09-28.json')

/** The nineteen pattern names, in the order `detect_pattern_at_index` joins them. */
const NAMES = ['Evening Star', 'Morning Star', 'Shooting Star', 'Hammer', 'Inverted Hammer',
  'Bearish Harami', 'Bullish Harami', 'Bearish Engulfing', 'Bullish Engulfing', 'Piercing Line',
  'Bullish Belt', 'Bullish Kicker', 'Bearish Kicker', 'Hanging Man', 'Dark Cloud Cover',
  'Three Inside Up', 'Three Inside Down', 'Three Outside Up', 'Three Outside Down']
/** A pattern text → a code, line-exact (`Hammer` is not `Inverted Hammer`). */
const codeOf = (t) => NAMES.reduce((c, n, j) => c + (`\n${t}\n`.includes(`\n${n}\n`) ? 2 ** j : 0), 0)

/** ⭐⭐ C23 — THE SCRIPT AS WRITTEN. C21 measured the runtime lane by
 *  SUBSTITUTING seven compile walls (`isfirst`, `timeframe.change`, the
 *  own-timeframe request, `math.avg`, the colour inputs, `syminfo.mintick`,
 *  `alert`) and the eager v6 `and`; C23 serves each one on a pane
 *  (`runtimeWallsC23.test.js`), so the run below reads the vendor's own source
 *  with nothing replaced — only the instrument hooks are added. */
const HOOK_HEAD = [
  'var array<float> c21_codes = array.new<float>()',
  'c21_code(string t) =>',
  '    string w = "\\n" + t + "\\n"',
  '    float c = 0',
  ...NAMES.map((n, j) => `    c := c + (str.contains(w, "\\n${n}\\n") ? ${2 ** j} : 0)`),
  '    c',
  '',
].join('\n')
const PLOTS = 50

function instrumented(source) {
  let src = source
  // the pattern codes, pushed where the script's own 200-candle scan finds each
  const at = '            if pattern_found\n                int num_in_pattern = get_pattern_candle_count(pattern_text)\n'
  expect(src.split(at).length - 1).toBe(1)
  src = src.replace(at, `${at}                array.push(c21_codes, c21_code(pattern_text))\n`)
  const decl = 'max_boxes_count=250)\n'
  expect(src.split(decl).length - 1).toBe(1)
  src = src.replace(decl, `${decl}${HOOK_HEAD}`)
  const plots = [
    'plot(array.size(c21_codes), "n")',
    'plot(array.size(pattern_at_index) > 3 ? (array.get(pattern_at_index, 3) ? c21_code(array.get(pattern_text_at_index, 3)) : 0) : -1, "floating 3")',
    ...Array.from({ length: PLOTS }, (_, k) => `plot(array.size(c21_codes) > ${k} ? array.get(c21_codes, ${k}) : na, "c${k}")`),
  ].join('\n')
  return `${src}\n${plots}\n`
}

describe('⭐ C21 — dual-view-htf-candlestick-patterns', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  const load = () => {
    const loaded = loadCapture(FILE)
    expect(loaded.capture, loaded.reason).toBeTruthy()
    return loaded.capture
  }

  it('⛔ on the product path nothing is drawn, and each refusal names its construct', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const cap = load()
    const d = memberPaneDefinition({ source: cap.source.text, id: 'u_c21_dv', name: 'dv' })
    // the HTF MA plot carries the door; the drawing does not
    expect(d.ok, d.reason).toBe(true)
    expect(d.definition.objects ?? null).toBeNull()
  })

  it('⭐ the door\'s translation names the 78 `pine:state` as ONE construct and the lists still diverging', async () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const cap = load()
    const { translatePine } = await import('../../ast/pine')
    const { memberInputTranslation } = await import('../../../builder/builderInputs')
    const { probeObjectRuntime } = await import('../../runtime/runtimeColumns')
    const t = memberInputTranslation(translatePine, cap.source.text, {
      paramManifest: true, strict: true, colourInputs: true, objectRuntimeCheck: probeObjectRuntime,
    })
    const od = t.objectDiagnostics
    // ⭐ C25 — the translation now HOLDS a program: the floating candles' lists
    // are made on bar 0 (the loop counter is known per pass), and of their
    // creates only the two horizontal-line lists stay — the boxes and wicks a
    // lost step would have MOVED are held (`geometry:lost`). The door still
    // draws nothing (the test above: a lost removal withholds the drawing).
    const creates = []
    const scan = (list) => list.forEach((o) => { if (o.k === 'create') creates.push(o.family); if (o.k === 'loop') scan(o.body) })
    scan(t.objects.ops)
    expect(creates).toEqual(['line', 'line'])
    expect(od.dropReasons['geometry:lost']).toBe(3)
    const state = od.guardRefusals.filter((e) => /pine:state/.test(e))
    expect(state.length).toBe(29)
    // ⭐⭐ C25 — each names the WRITE that stops the loop scalar: pass 0's
    // `htf_o := current_htf_open`, a var the block fold loses at the `while` of
    // line 627 — the 212-slot windows' shortening loop (C22's boundary).
    for (const e of state) {
      expect(e).toMatch(/pine:state `htf_[a-z_]+` \(a `var` carried in a loop of `update_drawings`: its write at line 459 reads a value this reader cannot carry \(pine:reassign: `current_htf_open` .*at line 627/)
    }
    expect(od.loopScalars).toHaveLength(7)
    // ⭐ C25 — five lists diverge (the historical four, `pattern_labels`) and
    // their 18 reads are withheld; C21 measured ten lists and 39 reads.
    expect(od.collsDiverged).toBe(5)
    expect(od.collsDivergedWhy.filter((e) => /coll:push@4[1-3]\d$/.test(e))).toHaveLength(0)
    expect(od.dropReasons['coll:diverged']).toBe(18)
    // ⭐ C23 — the runtime lane now BUILDS the script (was `pine:window-dependent`,
    // the first of seven walls); the drawing still stops on the host walls above.
    expect(od.runtimeRefused ?? null).toBeNull()
  })

  it('⭐ the runtime run finds TradingView\'s 43 patterns in its order — and the bar is over the ceiling', () => {
    const cap = load()
    expect(cap.history.startsAtBar0).toBe(true)
    expect(cap.symbol.minmov / cap.symbol.pricescale).toBe(0.01)
    const bars = toProductBars(cap)
    const built = buildRuntimeIr(instrumented(cap.source.text), {
      bars, inputs: {}, objectTrees: [], pane: true, symbol: { ticker: 'RDDT', exchange: 'NYSE' }, basePeriod: 'D', tf: 'D',
      ...runtimeClockOpts(cap.newestBarIsForming === false ? false : null, { tf: 'D' }),
    })
    expect(built.ok, JSON.stringify(built.refusal)).toBe(true)
    const program = lowerIrProgram(built.ir)
    const series = ['o', 'h', 'l', 'c', 'v'].map((f) => Float64Array.from(bars.map((b) => b[f])))
    // ⚠️ A TEST-ONLY CEILING, so the agreement can be shown; the product runs at
    // DEFAULT_LIMITS and stops on this bar by name.
    const budget = new Budget({ INSTRUCTIONS_PER_BAR: 5000000 })
    const res = execute(program, {
      bars: bars.length, series, columns: program.columns, confirmed: true, barTimes: bars.map((b) => b.t),
    }, undefined, { budget })
    // our plots are the LAST 2 + PLOTS outputs (the script's own HTF MA plot comes first)
    const base = res.outputs.length - (2 + PLOTS)
    expect(base).toBe(1)
    const last = (i) => res.outputs[base + i][bars.length - 1]

    // TradingView's pattern labels, in creation order (the ⓘ markers and the
    // centre label excluded): 43 historical, then the floating one.
    const labels = [...cap.objects.records.labels].sort((a, b) => a.id - b.id)
      .map((l) => l.t).filter((t) => t !== 'ⓘ' && t !== 'Daily')
    const vendor = labels.slice(0, 43).map(codeOf)
    expect(labels).toHaveLength(44)
    expect(last(0)).toBe(43)
    const ours = Array.from({ length: 43 }, (_, k) => last(2 + k))
    expect(ours).toEqual(vendor)
    expect(last(2 + 43)).toBeNaN()
    // the floating Dark Cloud Cover, TradingView's candle 3
    expect(labels[43]).toBe('Dark Cloud Cover')
    expect(last(1)).toBe(codeOf('Dark Cloud Cover'))

    expect(budget.counts.INSTRUCTIONS_PER_BAR).toBeGreaterThan(DEFAULT_LIMITS.INSTRUCTIONS_PER_BAR)
  })
})
