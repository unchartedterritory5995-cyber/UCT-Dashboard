// app/src/components/chart/engine/ast/barConstant.test.js
//
// ─── ⭐⭐ COND-TA — ONE BAR-CONSTANT RULE, THREE DOORS, ONE ANSWER ─────────────────────────
//
// A condition fixed for a binding (inputs, the chart's timeframe flags, `syminfo.*`, literals and
// pure calls over them) runs a `ta.*` call on every bar or on none, so the every-bar reading IS
// TradingView's: it is DRAWN on every lane. Peer evidence: RS Rating (fred6724),
// `if (typMa == 'SMA' and not timeframe.isweekly)` / `rsMA := ta.sma(rs, lenMa)`, MATCH on
// RDDT / ALAB / CRWV (maxRel 0). Pinned here:
//   1. the canonical rule (`barConstantTree`) on the shared fixture `tests/fixtures/ast/
//      bar_constant_cases.json`, which `tests/test_bar_constant.py` holds its Python twin to;
//   2. the ONE pure-call allowlist (`PURE_PINE_CALLS`) and the token door's reading of it
//      (`guardIsBarInvariant`): `math.random` is not pure, `timeframe.change()` is not constant,
//      a name reassigned from a series is not constant;
//   3. the three doors (screener, host bind, runtime) give ONE answer on a shared set of shapes:
//      the constant ones drawn and equal to the every-bar reading; the varying ones never the
//      every-bar number (refused, withheld by name, or the per-run reading).
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { barConstantTree, isPurePineCall, PURE_PINE_CALLS } from './barConstant'
import { guardIsBarInvariant, barInvariantNames } from './objectFnInline'
import { translatePine, lexPine, blockStatements, isPunct, findTop, boundName } from './pine'
import { interpret } from './interpret'
import { buildRuntimeIr } from './pineRuntimeFrontend.js'
import { lowerIrProgram } from '../runtime/lowerIr.js'
import { execute } from '../runtime/vm.js'
import * as registry from '../nativeRegistry'
import { BLOCK_RUNS_GUARD } from '../blockRuns'
import { toProductBars, enterMemberDoor, HARNESS_DEF_ID } from '../__tests__/vendorHarness/ourSide'

const ROOT = path.resolve(process.cwd(), '..')
const CASES = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/ast/bar_constant_cases.json'), 'utf8')).cases
const CAP = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures/vendor/harness/vw-call-site-history-rddt-1d-2026-10-01.json'), 'utf8'))
const BARS = CAP.bars.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v: v == null ? 0 : v }))
const SERIES = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(BARS.map((b) => b[k])))

afterEach(() => { vi.unstubAllEnvs() })

const same = (a, b) => (!Number.isFinite(a) && !Number.isFinite(b)) || (Number.isFinite(a) && Number.isFinite(b)
  && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)))
const P = (v, ...b) => [`//@version=${v}`, 'indicator("bar constant")', ...b].join('\n')

describe('COND-TA — 1. the canonical rule on the shared fixture (the Python twin reads it too)', () => {
  it('has cases both ways', () => {
    expect(CASES.filter((c) => c.constant).length).toBeGreaterThanOrEqual(5)
    expect(CASES.filter((c) => !c.constant).length).toBeGreaterThanOrEqual(5)
  })
  it.each(CASES.map((c) => [c.name, c]))('%s', (_, c) => {
    expect(barConstantTree(c.tree)).toBe(c.constant)
  })
})

/** The token door's answer for `guard` in `script` (the walk's own invariant names). */
const tokenGuard = (script, guard) => {
  const lexed = lexPine(script)
  const stmts = blockStatements(lexed.tokens, lexed.indents, 0)
  const names = barInvariantNames(stmts, { isPunct, findTop, boundName })
  // the guard's own tokens: one statement's header
  const g = lexPine(guard)
  const [st] = blockStatements(g.tokens, g.indents, 0)
  return guardIsBarInvariant(st.header, names)
}

describe('COND-TA — 2. one pure-call allowlist; what is not constant', () => {
  it('`PURE_PINE_CALLS`: math / str / color are pure; math.random and str.format_time are not', () => {
    for (const n of ['math.max', 'math.abs', 'str.length', 'color.new', 'nz']) expect(isPurePineCall(n), n).toBe(true)
    for (const n of ['math.random', 'str.format_time', 'ta.sma', 'request.security', 'array.get', 'timeframe.change'])
      expect(isPurePineCall(n), n).toBe(false)
    expect(PURE_PINE_CALLS.excluded).toEqual(['math.random', 'str.format_time'])
  })

  it('the token door: inputs, timeframe flags and pure math over them are constant; timeframe.change(), a reassigned name and math.random are not', () => {
    const script = P(6, "typMa = input.string('SMA', 'MA', options = ['SMA', 'EMA'])", 'len = input.int(21, "len")',
      'flag = input.bool(true, "f")', 'flag := close > open', 'plot(close)')
    expect(tokenGuard(script, "typMa == 'SMA' and not timeframe.isweekly")).toBe(true)
    expect(tokenGuard(script, 'math.abs(len - 21) < 1')).toBe(true)
    expect(tokenGuard(script, 'timeframe.change("W")')).toBe(false)
    expect(tokenGuard(script, 'flag')).toBe(false)
    expect(tokenGuard(script, 'math.random() > 0.5')).toBe(false)
    expect(tokenGuard(script, 'close > open')).toBe(false)
  })
})

/** One shape through the three doors: screener (lenient), host (member door + bind), runtime. */
function doors(src) {
  const len = translatePine(src, { paramManifest: true }).outputs[0]
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  const door = enterMemberDoor(src)
  let host = null
  try {
    const cols = registry.computeFor(door.def, toProductBars(CAP), undefined,
      { tf: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' }, historyFromListing: true })
    const err = (registry.columnErrors(cols) || {}).value
    host = err ? { withheld: err.guard } : { column: Array.from(cols.value) }
  } finally { registry.uninstallUserDefinition(HARNESS_DEF_ID) }
  const b = buildRuntimeIr(src, { bars: BARS, inputs: {} })
  let runtime
  if (!b.ok) runtime = { refused: b.refusal.guard }
  else {
    const program = lowerIrProgram(b.ir)
    const r = execute(program, { bars: BARS.length, series: SERIES, columns: program.columns, confirmed: true })
    runtime = { column: Array.from(r.outputs[0]) }
  }
  const screener = len.refusal ? { refused: len.refusal.guard } : { column: Array.from(interpret(len.ast, BARS, {})) }
  return { screener, host, runtime }
}
const everyBar = (src) => Array.from(interpret(translatePine(src, { strict: true }).outputs[0].ast, BARS, {}))
const equalOn = (a, b) => a.length === b.length && a.every((x, i) => same(x, b[i]))

const CONSTANT = {
  'RS Rating (input string and `not timeframe.isweekly`)': P(5, "typMa = input.string('EMA', 'Type', options = ['SMA', 'EMA'])",
    "lenMa = input(21, title = 'Len')", 'rs = close / ta.sma(close, 50)', 'rsMA = ta.sma(rs, lenMa)',
    "if (typMa == 'SMA' and not timeframe.isweekly)", '    rsMA := ta.sma(rs, lenMa)',
    "if (typMa == 'EMA' and not timeframe.isweekly)", '    rsMA := ta.ema(rs, lenMa)', 'plot(rsMA, "v")'),
  'an input-only `?:`': P(6, 'u = input.bool(true, "u")', 'plot(u ? ta.sma(close, 3) : ta.ema(close, 3), "v")'),
  'pure math over an input, `if` block': P(6, 'len = input.int(21, "len")', 'float v = close', 'if math.abs(len - 21) < 1', '    v := ta.sma(close, 3)', 'plot(v, "v")'),
  'pure math over an input, `?:`': P(6, 'len = input.int(21, "len")', 'plot(math.max(len, 5) > 10 ? ta.sma(close, 3) : close, "v")'),
}
const VARYING = {
  'timeframe.change()': P(6, 'float v = close', 'if timeframe.change("W")', '    v := ta.sma(close, 3)', 'plot(v, "v")'),
  'a name reassigned from a series': P(6, 'flag = input.bool(true, "f")', 'flag := close > open', 'float v = close', 'if flag', '    v := ta.sma(close, 3)', 'plot(v, "v")'),
}

describe('COND-TA — 3. three doors, one answer', () => {
  it.each(Object.entries(CONSTANT))('constant: %s — DRAWN on every door, each equal to the every-bar reading', (_, src) => {
    const want = everyBar(src)
    const { screener, host, runtime } = doors(src)
    expect(screener.column, `screener refused ${screener.refused}`).toBeTruthy()
    expect(host.column, `host withheld ${host.withheld}`).toBeTruthy()
    expect(runtime.column, `runtime refused ${runtime.refused}`).toBeTruthy()
    expect(equalOn(screener.column, want)).toBe(true)
    expect(equalOn(host.column, want)).toBe(true)
    expect(equalOn(runtime.column, want)).toBe(true)
  })

  it.each(Object.entries(VARYING))('varying: %s — never the every-bar number on any door', (_, src) => {
    const want = everyBar(src)
    const { screener, host, runtime } = doors(src)
    expect(screener.refused, 'the screener lane refuses it by name').toBeTruthy()
    expect(host.withheld).toBe(BLOCK_RUNS_GUARD)
    if (runtime.column) expect(equalOn(runtime.column, want)).toBe(false)
    else expect(runtime.refused).toBeTruthy()
  })
})
