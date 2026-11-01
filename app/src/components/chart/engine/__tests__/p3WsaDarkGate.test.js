// app/src/components/chart/engine/__tests__/p3WsaDarkGate.test.js
//
// ─── ⛔⛔ P3 WS-A — THE STATEMENT GRAMMAR STAYS DARK: THE C18 DOOR BUILDS WHAT MASTER BUILT ──
//
// `buildRuntimeIr` is asked by the HOST object pass too (C18: `probeObjectRuntime` /
// `runtimeObjectValues`, via `translatePine`'s `objectRuntimeCheck`), in production, on
// every translation, with the runtime lane dark. A second fresh review measured WS-A's new
// lowerings drawing on that path (`var bool b = if …` → a label at y=2 where master drew
// nothing and TradingView draws 1). The grammar is now built only for `p3Statements: true`,
// which only the runtime pane's builds pass (`runtimeColumns.js`).
//
// Every expectation in CASES is master's OWN output, measured on master 685b5e91d7 with
// this same harness (objects-only pane on, 12 daily bars, closes 101..112). This branch must
// reproduce it. The three REVERSE cases are where master drew a WRONG value and this branch
// refuses by name instead (decision recorded in the WS-A report):
//   readSelf  `t := if close > t / t + 1`  master drew na (it wrote na into t first), TV 12
//   v6for     a v6 `for` whose body grows n master drew 4, TV (re-read bound) 6
//   v6bool    a v6 unmatched bool           master drew 2 (na == false is false), TV 1
import { describe, it, expect, vi, afterEach } from 'vitest'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../objectColumns'
import { evaluateObjects } from '../objectRuntime'
import { buildRuntimeIr } from '../ast/pineRuntimeFrontend.js'
import { probeRuntimeProgram, computeRuntimeColumns } from '../runtime/runtimeColumns.js'

const N = 12
const BARS = Array.from({ length: N }, (_, i) => ({
  t: `2026-01-${String(i + 2).padStart(2, '0')}`, o: 100 + i, h: 102 + i, l: 99 + i, c: 101 + i, v: 1000,
}))
const HEAD = '//@version=6\nindicator("t", overlay = true)\nplot(close)\n'
const L = (expr) => `if barstate.islast\n    label.new(bar_index, ${expr}, "s")\n`

// name -> [source, master's C18 result]
const CASES = {
  boolVar: ['isUp(x) => x > 103\nvar bool b = if close > 200\n    isUp(close)\n' + L('b == false ? 1.0 : 2.0'), { reader: null }],
  boolMulti: ['isUp(x) => x > 103\nvar float y = 0.0\nbool b = false\nb := if close > 200\n    y := 1.0\n    isUp(close)\n' + L('b == false ? 1.0 : 2.0'), { reader: null }],
  boolSwStmt: ['isUp(x) => x > 103\nbool b = false\nif barstate.islast\n    b := switch\n        close > 200 => isUp(close)\n    label.new(bar_index, b == false ? 1.0 : 2.0, "s")\n', { labels: [2], rt: null }],
  switchStmt: ['float s = 0.0\nif barstate.islast\n    switch\n        close > 105 => s := 1.0\n        => s := 2.0\n    label.new(bar_index, s, "s")\n', { reader: null }],
  multiArm: ['var float y = 0.0\nfloat s = 0.0\nif barstate.islast\n    s := if close > 105\n        y := 3.0\n        y + 1\n    else\n        0.0\n    label.new(bar_index, s, "s")\n', { labels: [4], rt: null }],
  comma: ['float a = 0.0\nfloat b = 0.0\nif barstate.islast\n    a := 5.0, b := 7.0\n    label.new(bar_index, a + b, "s")\n', { labels: [12], rt: null }],
  varIf: ['var float v = if close > 0\n    close\nelse\n    0.0\n' + L('v'), { reader: null }],
  fnSwitch: ['f(x) =>\n    switch\n        x > 105 => x * 2\n        => x\nv = f(close)\n' + L('v'), { reader: null }],
  plainIf: ['v = if close > 105\n    close * 2\nelse\n    close\n' + L('v'), { labels: [224], rt: null }],
}
// master drew these, wrongly; this branch refuses by name (no runtime drawing)
const REVERSE = {
  readSelf: 'var float t = 0.0\nt := if close > t\n    t + 1\nelse\n    t\n' + L('t'),
  v6for: 'n = 3\nfloat s = 0.0\nfor i = 0 to n\n    s += 1\n    if i == 1\n        n := 5\n' + L('s'),
  v6bool: 'b = if close > 200\n    close > open\n' + L('b == false ? 1.0 : 2.0'),
}

function c18(src) {
  const d = memberPaneDefinition({ source: HEAD + src, id: 'u_wsa_dark', name: 'rt' })
  expect(d.ok, d.reason).toBe(true)
  const reader = objectReaderFor(d.definition, BARS, { tf: 'D', newestBarIsForming: false, historyFromListing: true })
  if (!reader) return { reader: null }
  const run = evaluateObjects(reader.program, {
    barCount: N, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
  })
  return {
    labels: run.live.filter((o) => o.family === 'label').map((o) => o.props.y),
    rt: reader.runtime ? !!reader.runtime.served : null,
  }
}

describe('⛔⛔ the C18 door (objects-only pane, production path) draws exactly what master drew', () => {
  afterEach(() => { vi.unstubAllEnvs() })
  for (const [name, [src, master]] of Object.entries(CASES)) {
    it(`${name}: ${JSON.stringify(master)}`, () => {
      vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
      expect(c18(src)).toEqual(master)
    })
  }
  for (const [name, src] of Object.entries(REVERSE)) {
    it(`${name}: master drew a wrong value; refused here, so the runtime draws nothing`, () => {
      vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
      expect(c18(src).rt === true).toBe(false)
    })
  }
})

describe('⛔⛔ the flag: the WS-A grammar is built only for `p3Statements: true`', () => {
  const B = Array.from({ length: 8 }, (_, i) => ({ t: 1700000000 + i * 86400, o: 100, h: 102 + i, l: 98, c: 100 + i, v: 1000 }))
  const C18_OPTS = { bars: B, inputs: {}, objectTrees: [], objectTreesAt: [] }
  const v6 = '//@version=6\nindicator("t")\n'
  const SHAPES = {
    'multi-statement arm': `${v6}var float y = 0.0\nx = if close > 103\n    y := y + 1\n    y\nelse\n    0.0\nplot(x)\n`,
    'switch statement': `${v6}float s = 0.0\nswitch\n    close > 103 => s := 1.0\n    => s := 2.0\nplot(s)\n`,
    'var x = if': `${v6}var float v = if close > 0\n    close\nelse\n    0.0\nplot(v)\n`,
    'function ending in a switch': `${v6}f(x) =>\n    switch\n        x > 103 => x * 2\n        => x\nplot(f(close))\n`,
    'tuple-valued block': `${v6}[p, q] = if close > 103\n    [1.0, 2.0]\nelse\n    [3.0, 4.0]\nplot(p + q)\n`,
    'function ending in a comma line': `${v6}g(v) => v * 3\nf(x) =>\n    a = x, g(a)\nplot(f(close))\n`,
    'a read of x inside x := if': `${v6}var float t = 0.0\nt := if close > t\n    t + 1\nelse\n    t\nplot(t)\n`,
  }
  for (const [name, src] of Object.entries(SHAPES)) {
    it(`${name}: refused off the runtime pane, built on it`, () => {
      const off = buildRuntimeIr(src, C18_OPTS)
      expect(off.ok, 'the C18 build must not serve a WS-A shape').toBe(false)
      // master's own refusal where it had one (`pine:block` for a function ending in a
      // switch), else this gate's sentence
      expect(off.refusal.message).toMatch(/built only on the runtime pane|single expression/)
      const on = buildRuntimeIr(src, { ...C18_OPTS, p3Statements: true })
      expect(on.ok, on.ok ? '' : on.refusal.message).toBe(true)
    })
  }
  it('⭐ the runtime pane\'s own builds DO pass the flag (probe, per-bar check, columns)', () => {
    const src = `${v6}var float y = 0.0\nx = if close > 103\n    y := y + 1\n    y\nelse\n    0.0\nplot(x)\n`
    const probe = probeRuntimeProgram(src)
    expect(probe.ok, probe.ok ? '' : probe.refusal.message).toBe(true)
    const cols = computeRuntimeColumns({ id: 'x', compute: { fn: 'x', source: src, outputs: { v: 0 } } }, B, { tf: 'D' })
    const v = cols.v || Object.values(cols)[0]
    expect(Array.from(v || []).map((q) => (Number.isNaN(q) ? null : q))).toEqual([0, 0, 0, 0, 1, 2, 3, 4])
  })
  it('⛔ CONTROL — a top-level comma `:=` line master served is still served off the pane', () => {
    const off = buildRuntimeIr(`${v6}float a = 0.0\nfloat b = 0.0\na := 5.0, b := 7.0\nplot(a + b)\n`, C18_OPTS)
    expect(off.ok, off.ok ? '' : off.refusal.message).toBe(true)
  })
  it('⛔ CONTROL — a shape master served is built the same either way', () => {
    const src = `${v6}x = if close > 103\n    close * 2\nelse\n    close\nplot(x)\n`
    const off = buildRuntimeIr(src, C18_OPTS)
    const on = buildRuntimeIr(src, { ...C18_OPTS, p3Statements: true })
    expect(off.ok && on.ok).toBe(true)
    expect(JSON.stringify(off.ir.statements)).toBe(JSON.stringify(on.ir.statements))
  })
})
