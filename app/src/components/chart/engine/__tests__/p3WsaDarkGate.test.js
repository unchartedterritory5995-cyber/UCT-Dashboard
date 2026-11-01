// app/src/components/chart/engine/__tests__/p3WsaDarkGate.test.js
//
// ─── ⛔⛔ P3 WS-A — THE OBJECT DOOR BUILDS WHAT MASTER BUILT (`opts.objectDoor`) ──────
//
// `buildRuntimeIr` is asked by the HOST object pass too (C18: `probeObjectRuntime` /
// `runtimeObjectValues`, via `translatePine`'s `objectRuntimeCheck`), in production, on
// every translation, with the runtime lane dark. A second fresh review measured WS-A's new
// lowerings drawing on that path (`var bool b = if …` → a label at y=2 where master drew
// nothing). Shared contract with WS-D: those two builds pass `objectDoor: true`; under it
// every lowering added after master 685b5e91d7 refuses `runtime:object-door`, and every
// shape master served is built as master built it — EXCEPT where the Pine docs say
// master's value is wrong and no capture has settled it (house rule: refuse what is not
// proven exact). Those four refuse `runtime:object-door` by name (REFUSED below):
//   readSelf    `t := if close > t / t + 1`  master drew na,  docs: 12        (Q-A2)
//   readSelfSw  `st := switch st` cycle      master drew 0,   docs: cycles    (Q-A2)
//   v6for       a v6 `for` the body grows    master drew 4,   docs: 6         (Q-A1)
//   v6bool      a v6 unmatched bool          master drew 2,   docs: 1         (Q-A3)
//
// Every expectation below is master's OWN output, measured on master 685b5e91d7 with this
// same harness (objects-only pane on, 12 daily bars, closes 101..112).
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
  defaultLast: ['v = switch\n    => close\n    close > 105 => close * 2\n' + L('v'), { labels: [224], rt: true }],
  fnComma: ['g(v) => v * 3\nf(x) =>\n    a = x, g(a)\nv = f(close)\n' + L('v'), { reader: null }],
}

// master drew a documented-wrong value; the drawing door refuses by name now
const REFUSED = {
  readSelf: ['var float t = 0.0\nt := if close > t\n    t + 1\nelse\n    t\n' + L('t'), /reads `t` inside its own block.*Q-A2/],
  readSelfSw: ['var int st = 0\nst := switch st\n    0 => 1\n    1 => 2\n    => 0\n' + L('st'), /reads `st` inside its own block.*Q-A2/],
  v6for: ['n = 3\nfloat s = 0.0\nfor i = 0 to n\n    s += 1\n    if i == 1\n        n := 5\n' + L('s'), /re-reads a `for` loop's `to` bound.*Q-A1/],
  v6bool: ['b = if close > 200\n    close > open\n' + L('b == false ? 1.0 : 2.0'), /v6 bool is never `na`.*Q-A3/],
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
    labels: run.live.filter((o) => o.family === 'label').map((o) => (Number.isNaN(o.props.y) ? null : o.props.y)),
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
  for (const [name, [src, why]] of Object.entries(REFUSED)) {
    it(`${name}: master drew a documented-wrong value; the door refuses by name, the runtime draws nothing`, () => {
      vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
      const r = c18(src)
      expect(r.rt === true).toBe(false)
      const door = buildRuntimeIr(HEAD + src, {
        bars: DOOR_BARS, inputs: {}, objectTrees: [], objectTreesAt: [], objectDoor: true,
      })
      expect(door.ok).toBe(false)
      expect(door.refusal.guard).toBe('runtime:object-door')
      expect(door.refusal.message).toMatch(why)
    })
  }
})
const DOOR_BARS = Array.from({ length: 8 }, (_, i) => ({ t: 1700000000 + i * 86400, o: 100, h: 102 + i, l: 98, c: 100 + i, v: 1000 }))

describe('⛔⛔ the contract: under `objectDoor: true` the WS-A grammar refuses `runtime:object-door`', () => {
  const B = Array.from({ length: 8 }, (_, i) => ({ t: 1700000000 + i * 86400, o: 100, h: 102 + i, l: 98, c: 100 + i, v: 1000 }))
  const DOOR = { bars: B, inputs: {}, objectTrees: [], objectTreesAt: [], objectDoor: true }
  const PANE = { bars: B, inputs: {}, objectTrees: [], objectTreesAt: [] }
  const v6 = '//@version=6\nindicator("t")\n'
  const SHAPES = {
    'multi-statement arm': `${v6}var float y = 0.0\nx = if close > 103\n    y := y + 1\n    y\nelse\n    0.0\nplot(x)\n`,
    'switch statement': `${v6}float s = 0.0\nswitch\n    close > 103 => s := 1.0\n    => s := 2.0\nplot(s)\n`,
    'var x = if': `${v6}var float v = if close > 0\n    close\nelse\n    0.0\nplot(v)\n`,
    'tuple-valued block': `${v6}[p, q] = if close > 103\n    [1.0, 2.0]\nelse\n    [3.0, 4.0]\nplot(p + q)\n`,
  }
  for (const [name, src] of Object.entries(SHAPES)) {
    it(`${name}: refused on the object door, built on the pane`, () => {
      const off = buildRuntimeIr(src, DOOR)
      expect(off.ok, 'the object door must not serve a WS-A shape').toBe(false)
      expect(off.refusal.guard).toBe('runtime:object-door')
      const on = buildRuntimeIr(src, PANE)
      expect(on.ok, on.ok ? '' : on.refusal.message).toBe(true)
    })
  }
  it('⛔ a function ending in a switch keeps master\'s own refusal on the door (`pine:block`)', () => {
    const src = `${v6}f(x) =>\n    switch\n        x > 103 => x * 2\n        => x\nplot(f(close))\n`
    expect(buildRuntimeIr(src, DOOR).refusal.guard).toBe('pine:block')
    expect(buildRuntimeIr(src, PANE).ok).toBe(true)
  })
  it('⛔ a function ending in a comma line: master\'s own refusal on the door (`pine:statement`)', () => {
    const src = `${v6}g(v) => v * 3\nf(x) =>\n    a = x, g(a)\nplot(f(close))\n`
    expect(buildRuntimeIr(src, DOOR).refusal.guard).toBe('pine:statement')
    expect(buildRuntimeIr(src, PANE).ok).toBe(true)
  })
  it('⛔ a switch subject holding a call is NOT hoisted on the door (master\'s IR, one slot)', () => {
    const src = `${v6}x = switch nz(close)\n    104 => 1.0\n    => 2.0\nplot(x)\n`
    const door = buildRuntimeIr(src, DOOR)
    const pane = buildRuntimeIr(src, PANE)
    expect(JSON.stringify(door.ir).includes('switch subject')).toBe(false)
    expect(JSON.stringify(pane.ir).includes('switch subject')).toBe(true)
  })
  it('⭐ the runtime pane\'s own builds never set it (probe, columns)', () => {
    const src = `${v6}var float y = 0.0\nx = if close > 103\n    y := y + 1\n    y\nelse\n    0.0\nplot(x)\n`
    const probe = probeRuntimeProgram(src)
    expect(probe.ok, probe.ok ? '' : probe.refusal.message).toBe(true)
    const cols = computeRuntimeColumns({ id: 'x', compute: { fn: 'x', source: src, outputs: { v: 0 } } }, B, { tf: 'D' })
    const v = cols.v || Object.values(cols)[0]
    expect(Array.from(v || []).map((q) => (Number.isNaN(q) ? null : q))).toEqual([0, 0, 0, 0, 1, 2, 3, 4])
  })
  it('⛔ CONTROL — a shape master served is built the same either way', () => {
    const src = `${v6}x = if close > 103\n    close * 2\nelse\n    close\nplot(x)\n`
    const off = buildRuntimeIr(src, DOOR)
    const on = buildRuntimeIr(src, PANE)
    expect(off.ok && on.ok).toBe(true)
    expect(JSON.stringify(off.ir.statements)).toBe(JSON.stringify(on.ir.statements))
  })
})
