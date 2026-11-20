// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.qbh0Controls.test.js
//
// ─── ⛔ Q-BH0 — WHAT THE RULE MUST NOT REACH, AND EVERY PATH THAT SERVES IT ─────────────────────────────────────────
//
// `vendorHarness.qbh0BoolHistory.test.js` grades TradingView's two Q-BH0 captures: a Pine v6 bool's history before
// history begins reads `false` (H01-H10 draw 1 on bar 0, H10 on bars 0-1). The rule is `pine.js::v6BoolHistory`
// (the columnar lane: a written `x[k]` of a v6 bool is `na(close[k]) ? 0 : x[k]`) and
// `pineRuntimeFrontend.js::v6BoolHistoryIr` (the run, the same test on every static arm of its offset lowering).
// This file holds the rule to its witness and nothing wider:
//   · v5 and v4 keep `na` there (a v5 bool can be `na`: engine 56, S1): the rule on and the rule off
//     (`__v6BoolHistoryForTests`, the before-Q-BH0 reading) draw the same picture, bar for bar, on both lanes;
//   · in v6 the two differ exactly on the bars before history, and nowhere else;
//   · a v6 NUMBER's history is still `na`; a bool this engine holds as `na` after history begins keeps its read;
//   · off the listing those bars are not drawn at all (read before the chart's first bar), never a guessed `false`;
//   · a v5 library inside a v6 script keeps v5's reading (judged per token, both lanes);
//   · the Python twin computes the same trees to the same values (the fixture is the one authority);
//   · every arm of the run's offset lowering serves the rule (a `var` slot, a function's own slot, an expression
//     hoisted into a committed series, a column the run reads, a request's own region).
import { describe, it, expect, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { loadCapture } from './harness'
import { enterMemberDoor, toProductBars, HARNESS_DEF_ID } from './ourSide'
import * as registry from '../../nativeRegistry'
import { __permitRuntimePaneForTests } from '../../runtimePaneGate'
import { __allowEveryRuntimeScriptForTests } from '../../runtimeKill'
import { __forceRuntimeLaneForTests } from '../../../builder/memberPane/memberPaneDefinition'
import { computeRuntimeColumns, resetRuntimeSessions, resetRuntimeLedgers } from '../../runtime/runtimeColumns.js'
import { requestAlignment, interpret } from '../../ast/interpret.js'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { runtimeClockOpts } from '../../ast/pineRuntimeClock.js'
import { lowerIrProgram } from '../../runtime/lowerIr.js'
import { execute } from '../../runtime/vm.js'
import { translatePine, Resolver, parseWholeExpression, lexPine, __v6BoolHistoryForTests } from '../../ast/pine.js'
import { TABLE } from '../../ast/parse.js'
import { stampLibraryVersion, LIBRARY_VERSION } from '../../ast/pineLibraryVersion.js'
import { fixtureLibraries } from '../../ast/__tests__/libraryFixture.js'

const H = path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness')
const RDDT = 'vw-v6-bool-history-bar0-rddt-1d-2026-11-19.json'
const capture = () => {
  const loaded = loadCapture(path.join(H, RDDT))
  if (!loaded.capture) throw new Error(`not a capture — ${loaded.reason}`)
  return loaded.capture
}
const ROWS = ['H00_bar_index_CONTROL', 'H01_b1_eq_false', 'H02_b1_as_condition', 'H03_not_b1', 'H04_b1_ne_true',
  'H05_b_ne_b1', 'H06_edge_b_and_not_b1', 'H07_var_c1_eq_false', 'H08_var_not_c1', 'H09_u1_eq_false', 'H10_b2_eq_false']
// the rows whose bar-0 answer is the history read through `==` / `!=` (v5 reads `na` there; `na`, read as a
// condition, is false); H10's history is two bars deep
const EQ_ROWS = ['H01_b1_eq_false', 'H04_b1_ne_true', 'H05_b_ne_b1', 'H07_var_c1_eq_false', 'H09_u1_eq_false', 'H10_b2_eq_false']
// every row whose bar-0 answer is the history before history begins (all but the two controls)
const HIST_ROWS = ROWS.filter((t) => t !== 'H00_bar_index_CONTROL' && t !== 'H02_b1_as_condition')
const depthOf = (t) => (t === 'H10_b2_eq_false' ? 2 : 1)

const flagOf = (rel) => (fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
  .match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
const OBJECTS_FLAG = flagOf('src/components/chart/engine/objectsOnlyPaneGate.js')
const RUNTIME_FLAG = flagOf('src/components/chart/engine/runtimePaneGate.js')
const enterLane = (lane) => {
  vi.stubEnv(OBJECTS_FLAG, '1')
  vi.stubEnv(RUNTIME_FLAG, lane === 'production' ? '' : '1')
  if (lane !== 'production') { __permitRuntimePaneForTests(); __allowEveryRuntimeScriptForTests() }
  __forceRuntimeLaneForTests(lane === 'runtime lane forced')
}
afterEach(() => { __v6BoolHistoryForTests(true); __forceRuntimeLaneForTests(false); vi.unstubAllEnvs() })

/** Each plot's column as the member door computes it on `bars`, named by `titles` in the script's plot order.
 *  `rule: false` computes it as this engine did before Q-BH0 (`__v6BoolHistoryForTests`), from a source that differs
 *  by a trailing comment, so nothing either door memoised by source answers for the other. */
function doorColumns(source, bars, titles, { listing = true, rule = true } = {}) {
  __v6BoolHistoryForTests(rule)
  const door = enterMemberDoor(rule ? source : `${source}\n// Q-BH0: the rule off\n`)
  try {
    expect(door.def, door.refusal || '').toBeTruthy()
    const cols = registry.computeFor(door.def, bars, undefined,
      { tf: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: false, historyFromListing: listing })
    const plots = door.def.plots || []
    expect(plots.length).toBe(titles.length)
    const out = {}
    plots.forEach((p, i) => { out[titles[i]] = cols[p.key] ? Array.from(cols[p.key]) : null })
    for (const t of titles) expect(out[t], `${t}: no column`).not.toBe(null)
    return { lane: door.built.lane || 'host', cols: out }
  } finally {
    registry.uninstallUserDefinition(HARNESS_DEF_ID)
    __v6BoolHistoryForTests(true)
  }
}
const isNa = (x) => typeof x === 'number' && Number.isNaN(x)
const sameFrom = (a, b, from) => a.length === b.length && a.every((x, i) => i < from || Object.is(x, b[i]))

describe('⛔ Q-BH0 controls: v5 and v4 keep today\'s answer; v6 moves only before history; a number keeps `na`; off the listing nothing is guessed', () => {
  const v6 = () => capture().source.text
  const v5 = () => v6().replace('//@version=6', '//@version=5')
  const v4 = () => v5().replace('//@version=5', '//@version=4').replace('indicator(', 'study(')

  for (const lane of ['production', 'runtime lane forced']) {
    for (const [name, src] of [['v5', v5], ['v4', v4]]) {
      it(`${name}, ${lane}: the rule on draws what the rule off draws, bar for bar; the \`==\` / \`!=\` rows read \`na\` (0) on bar 0`, () => {
        enterLane(lane)
        const bars = toProductBars(capture())
        const on = doorColumns(src(), bars, ROWS)
        const off = doorColumns(src(), bars, ROWS, { rule: false })
        if (lane === 'runtime lane forced') expect(on.lane).toBe('runtime')
        else expect(on.lane).not.toBe('runtime')
        for (const t of ROWS) expect(sameFrom(on.cols[t], off.cols[t], 0), `${name} ${t}`).toBe(true)
        for (const t of EQ_ROWS) {
          for (let i = 0; i < depthOf(t); i += 1) expect(on.cols[t][i], `${name} ${t} bar ${i}`).toBe(0)
        }
        expect(on.cols.H02_b1_as_condition[0]).toBe(0)
        expect(on.cols.H00_bar_index_CONTROL.slice(0, 3)).toEqual([0, 1, 2])
      }, 120000)
    }

    it(`v6, ${lane}: the rule moves exactly the bars before history (TradingView's 1), and nothing else`, () => {
      enterLane(lane)
      const cap = capture()
      const bars = toProductBars(cap)
      const on = doorColumns(v6(), bars, ROWS)
      const off = doorColumns(v6(), bars, ROWS, { rule: false })
      const vendor = (t, i) => cap.plotValues.rows[i][1 + ROWS.indexOf(t)]
      for (const t of ROWS) {
        const k = HIST_ROWS.includes(t) ? depthOf(t) : 0
        expect(sameFrom(on.cols[t], off.cols[t], k), `${t} after bar ${k - 1}`).toBe(true)
        for (let i = 0; i < k; i += 1) expect(on.cols[t][i], `${t} bar ${i}`).toBe(vendor(t, i))
      }
      // non-vacuous: what the rule changed is what the captures graded wrong (the `==` / `!=` rows drew 0)
      for (const t of EQ_ROWS) {
        for (let i = 0; i < depthOf(t); i += 1) {
          expect([off.cols[t][i], on.cols[t][i]], `${t} bar ${i}`).toEqual([0, 1])
        }
      }
    }, 120000)

    it(`a v6 NUMBER's history is still \`na\` before history begins, ${lane}`, () => {
      enterLane(lane)
      const bars = toProductBars(capture())
      const src = ['//@version=6', 'indicator("qbh0 number")', 'x = close + 0', 'var float y = 0.0', 'y := close',
        'plot(x[1], title = "N1")', 'plot(y[1], title = "N2")', 'plot(nz(x[2], -1), title = "N3")'].join('\n')
      const { cols } = doorColumns(src, bars, ['N1', 'N2', 'N3'])
      expect(isNa(cols.N1[0]) && isNa(cols.N2[0]), `${cols.N1[0]} ${cols.N2[0]}`).toBe(true)
      expect(cols.N1[1]).toBe(bars[0].c)
      expect(cols.N3.slice(0, 3)).toEqual([-1, -1, bars[0].c])
      // and the rule changes no number on any bar
      const off = doorColumns(src, bars, ['N1', 'N2', 'N3'], { rule: false })
      for (const t of ['N1', 'N2', 'N3']) expect(sameFrom(cols[t], off.cols[t], 0), t).toBe(true)
    }, 120000)

    it(`off the listing the bars before history are not drawn (never a guessed \`false\`), ${lane}`, () => {
      enterLane(lane)
      const bars = toProductBars(capture())
      // without the `bar_index` control: a run off the listing never draws a count of bars from its own start
      const src = v6().split('\n').filter((l) => !l.startsWith('plot(bar_index')).join('\n')
      const titles = ROWS.slice(1)
      const off = doorColumns(src, bars, titles, { listing: false })
      const on = doorColumns(src, bars, titles, { listing: true })
      for (const t of HIST_ROWS) {
        for (let i = 0; i < depthOf(t); i += 1) {
          expect(isNa(off.cols[t][i]), `${t} bar ${i} off the listing: ${off.cols[t][i]}`).toBe(true)
        }
        // what is drawn is the listing run's answer, and something is drawn
        const drawn = off.cols[t].map((_, i) => i).filter((i) => !isNa(off.cols[t][i]))
        expect(drawn.length, t).toBeGreaterThan(bars.length / 2)
        for (const i of drawn) expect(off.cols[t][i], `${t} bar ${i}`).toBe(on.cols[t][i])
      }
      if (lane === 'production') {
        // the host lane withholds exactly what it withheld before Q-BH0: the rule changes nothing off the listing
        const before = doorColumns(src, bars, titles, { listing: false, rule: false })
        for (const t of titles) expect(sameFrom(off.cols[t], before.cols[t], 0), t).toBe(true)
      }
    }, 180000)
  }
})

// ─── ⛔ THE VERSION ISLAND: a v5 library inside a v6 script keeps v5's `na` (judged per token) ──────────────────────
const N = 40
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: 100 + Math.sin(i), h: 102 + Math.sin(i) + (i % 3), l: 98 - (i % 4),
  c: 100 + Math.cos(i) * 2 + i * 0.1, v: 1000 + i * 7,
}))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))
const MPL = '// This Pine Script code is subject to the terms of the Mozilla Public License 2.0 at https://mozilla.org/MPL/2.0/'
const V5 = '//@version=5\nindicator("t")\n'
const V6 = '//@version=6\nindicator("t")\n'
const LIB = `${MPL}
//@version=5
library("qbh0island")
export edge(float x) =>
    bool up = x > 0
    up[1] == false ? 1 : 0
`
const LIBS = fixtureLibraries({
  'tester/qbh0island/1': { path: 'tester/qbh0island/1', source: LIB, licence: 'MPL-2.0', attribution: 'qbh0island (test fixture)' },
})
const ADMIT = { admit: Object.keys(LIBS).map((p) => ({ path: p })) }
function runtimeRun(src) {
  const b = buildRuntimeIr(src, { ...runtimeClockOpts(false), bars: BARS, inputs: {}, libraries: LIBS, libraryCrossVersion: ADMIT })
  if (!b.ok) return { b, col: null, why: `${b.refusal.guard}: ${b.refusal.message}` }
  const p = lowerIrProgram(b.ir)
  const { outputs } = execute(p, { bars: N, series: SERIES, columns: p.columns, confirmed: true })
  return { b, col: Array.from(outputs[0]) }
}
const LISTING_OPTS = { historyFromListing: true, naConditionFalse: true }

describe('⛔ Q-BH0 and the version island: a v5 library keeps v5\'s reading inside a v6 script', () => {
  it('the runtime lane: the v5 library in a v6 script computes what it computes in a v5 script; pasted, v6 draws 1 on bar 0', () => {
    const use = 'import tester/qbh0island/1 as q\nplot(q.edge(close))\n'
    const island = runtimeRun(`${V6}${use}`)
    const inV5 = runtimeRun(`${V5}${use}`)
    expect(island.col, island.why).not.toBe(null)
    expect(inV5.col, inV5.why).not.toBe(null)
    expect(island.col).toEqual(inV5.col)
    expect(island.col[0]).toBe(0)
    const pasted = runtimeRun(`${V6}${LIB.split('\n').slice(3).join('\n').replace(/^export /gm, '')}plot(edge(close))\n`)
    expect(pasted.col, pasted.why).not.toBe(null)
    expect(pasted.col[0]).toBe(1)
    expect(sameFrom(pasted.col, island.col, 1)).toBe(true)
    // the host lane: it refuses the import by name (its link check refuses the bool-na family), or, where it links
    // it, its resolver reads the library's tokens at v5 too and draws the v5 script's picture
    const t = translatePine(`${V6}${use}`, { libraries: LIBS, libraryCrossVersion: ADMIT, mode: 'host' })
    if (!t.ok) expect(t.refusal.guard).toBe(LIBRARY_VERSION)
    else {
      const out = (t.outputs || []).find((o) => o && o.ast && o.kind !== 'alertcondition')
      expect(Array.from(interpret(out.ast, BARS, {}, undefined, undefined, LISTING_OPTS))[0]).toBe(0)
    }
  })

  // the columnar resolver over a v5 library's tokens: the same expression, stamped as island tokens and read by a v6
  // resolver, equals a v5 resolver's reading, and differs from a v6 resolver's on the bars before history alone
  const tokens = (text, island) => lexPine(`${V6}x = ${text}\n`).tokens.filter((t) => t.line === 3).slice(2)
    .map((t) => (island ? stampLibraryVersion({ ...t }, 5, 6) : t))
  const resolved = (text, version, island) => {
    const r = new Resolver(new Map(), TABLE, new Map(), { pineVersion: version, pineScript: true })
    return Array.from(interpret(r.resolve(parseWholeExpression(tokens(text, island))), BARS, {}, undefined, undefined, LISTING_OPTS))
  }
  for (const text of ['(close > 0)[1] == false ? 1 : 0', '(close > 0) != (close > 0)[2] ? 1 : 0']) {
    it(`the columnar resolver: \`${text}\` over island tokens is read as a v5 script reads it`, () => {
      const island = resolved(text, 6, true)
      const v5 = resolved(text, 5, false)
      const v6 = resolved(text, 6, false)
      expect(island).toEqual(v5)
      const k = text.includes('[2]') ? 2 : 1
      expect(v6.slice(0, k)).toEqual(new Array(k).fill(1))
      expect(v5.slice(0, k).every((x) => x === 0 || isNa(x)), `${v5.slice(0, k)}`).toBe(true)
      expect(sameFrom(v6, v5, k)).toBe(true)
    })
  }
})

// ─── ⭐ THE TWIN: the tree the columnar lane writes is the fixture's, and both lanes compute the fixture's values ────
// `tests/fixtures/ast/v6_bool_history_parity.json` is the one authority; `tests/test_ast_v6_bool_history_parity.py`
// holds the Python lane (`ast_interpret.py`, which evaluates saved trees server-side) to the same values.
describe('⭐ Q-BH0, the twin: the translator writes the fixture\'s trees and interpret.js computes its values', () => {
  const FIX = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), '..', 'tests/fixtures/ast/v6_bool_history_parity.json'), 'utf8'))
  const treeOf = (text, version) => {
    const toks = lexPine(`//@version=${version}\nindicator("t")\nx = ${text}\n`).tokens.filter((t) => t.line === 3).slice(2)
    return new Resolver(new Map(), TABLE, new Map(), { pineVersion: version, pineScript: true }).resolve(parseWholeExpression(toks))
  }
  for (const [name, c] of Object.entries(FIX.cases)) {
    it(`${name}: \`${c.pine}\` at v${c.version}`, () => {
      expect(JSON.parse(JSON.stringify(treeOf(c.pine, c.version)))).toEqual(c.ast)
      const got = Array.from(interpret(c.ast, FIX.bars, {}))
      expect(got.map((x) => (Number.isNaN(x) ? null : x))).toEqual(c.expected)
    })
  }

  // ⛔ ONLY THE BARS BEFORE HISTORY. A bool this engine holds as `na` AFTER history begins (a crossing's own warm-up:
  // `ta.crossover(close, ta.sma(close, 3))` is `na` on its first bars here) keeps its read there: Q-BH0 witnessed the
  // bars before history, nothing else, so the rule is not `nz(x[k], 0)`.
  it('⛔ a bool held as `na` after history begins keeps its read: v6 differs from v5 on bar 0 alone', () => {
    const text = 'ta.crossover(close, ta.sma(close, 3))[1]'
    const v6 = Array.from(interpret(treeOf(text, 6), BARS, {}, undefined, undefined, LISTING_OPTS))
    const v5 = Array.from(interpret(treeOf(text, 5), BARS, {}, undefined, undefined, LISTING_OPTS))
    expect(v6[0]).toBe(0)
    expect(isNa(v5[0])).toBe(true)
    expect(sameFrom(v6, v5, 1)).toBe(true)
    // non-vacuous: the read IS `na` on a bar after history begins, and finite later
    const naAfter = v6.map((_, i) => i).filter((i) => i >= 1 && isNa(v6[i]))
    expect(naAfter.length, `${v6.slice(0, 6)}`).toBeGreaterThan(0)
    expect(v6.slice(8).every((x) => x === 0 || x === 1)).toBe(true)
  })
})

// ─── ⭐ THE RUN'S OWN LOWERINGS: every path that lowers a written `x[k]` of a v6 bool answers the same ─────────────
// Each body below reaches a different arm of `pineRuntimeFrontend.js`'s `case 'offset'` (a `var` slot, a function's
// own slot, an expression hoisted into a committed series, a column the run reads because the read depends on a text
// input, a request's own region). A v6 bool's history is `false` on the first `k` bars in every one of them and the
// read itself after; the same body in v5 keeps `na` (0 through `==`).
describe('⭐ Q-BH0 on the run\'s own lowerings: the same answer on every path', () => {
  const ctx = { tf: 'D', newestBarIsForming: false, historyFromListing: true, symbol: { ticker: 'RDDT', exchange: 'NYSE' } }
  const run = (version, body, rows) => {
    resetRuntimeSessions(); resetRuntimeLedgers()
    const doc = { id: 'qbh0', meta: { runtimeHistory: 'listing' },
      compute: { kind: 'runtime', fn: 'runtime:qbh0', outputs: { a: 0 }, source: `//@version=${version}\nindicator("qbh0")\n${body}` } }
    const cols = computeRuntimeColumns(doc, rows, ctx)
    expect(cols && cols.a, `version ${version}: no column`).toBeTruthy()
    return Array.from(cols.a)
  }
  for (const [name, body, k] of [
    ['a `var bool` slot', 'var bool c = false\nc := close > 0\nplot(c[1] == false ? 1 : 0)', 1],
    ['a `var bool` slot, two bars back', 'var bool c = false\nc := close > 0\nplot(c[2] == false ? 1 : 0)', 2],
    ['a function\'s own bool', 'f(float x) =>\n    bool up = x > 0\n    up[1] == false ? 1 : 0\nplot(f(close))', 1],
    ['an expression over a slot, hoisted', 'var float x = 0.0\nx := close\nplot((x > 0)[1] == false ? 1 : 0)', 1],
    ['a bool that depends on a text input', 'string m = input.string("A")\nb = m == "A" and close > 0\nplot(b[1] == false ? 1 : 0)', 1],
  ]) {
    it(`${name}: \`false\` on the first ${k} bar${k > 1 ? 's' : ''}, the read after; v5 keeps \`na\``, () => {
      const rows = toProductBars(capture())
      const now = run(6, body, rows)
      expect(now.slice(0, k)).toEqual(new Array(k).fill(1))
      // every bool here is true on every bar, so its own past reads `true` once history begins
      expect(now.slice(k).every((x) => x === 0), `${now.slice(k, k + 6)}`).toBe(true)
      const old = run(5, body, rows)
      expect(old.slice(0, k)).toEqual(new Array(k).fill(0))
      expect(sameFrom(old, now, k)).toBe(true)
    }, 120000)
  }

  it('a request\'s own region: the requested series\' first bar reads `false` before it, and its own past after', () => {
    const rows = toProductBars(capture())
    const a = requestAlignment({ chartBars: rows, srcBars: rows, code: 'W', live: false,
      opts: { tf: 'D', newestBarIsForming: false, historyFromListing: true } })
    const P = a.runBars
    const onChart = (perWeek) => rows.map((_, i) => (a.withheld[i] || a.index[i] < 0 ? NaN : perWeek[a.index[i]]))
    const want = onChart(P.map((_, j) => (j === 0 ? 1 : (P[j - 1].c > P[j - 1].o ? 0 : 1))))
    const got = run(6, 'plot(request.security(syminfo.tickerid, "W", (close > open)[1] == false ? 1 : 0))', rows)
    let compared = 0
    for (let i = 0; i < want.length; i += 1) {
      if (isNa(want[i])) { expect(isNa(got[i]), `bar ${i}`).toBe(true); continue }
      expect(got[i], `bar ${i}`).toBe(want[i])
      compared += 1
    }
    expect(compared).toBeGreaterThan(rows.length - 20)
    // non-vacuous: a chart bar that reads the first requested week is drawn, and it reads 1
    const first = want.findIndex((w, i) => !isNa(w) && a.index[i] === 0)
    expect(first).toBeGreaterThanOrEqual(0)
    expect(got[first]).toBe(1)
    // v5 keeps `na` there; read as a condition the history before the first week is 0 in v6 too, as before
    expect(run(5, 'plot(request.security(syminfo.tickerid, "W", (close > open)[1] == false ? 1 : 0))', rows)[first]).toBe(0)
    expect(run(6, 'plot(request.security(syminfo.tickerid, "W", (close > open)[1] ? 1 : 0))', rows)[first]).toBe(0)
  }, 120000)
})
