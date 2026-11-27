// app/src/components/chart/engine/runtime/__tests__/taintVm.test.js
//
// ─── START-TAINT PART 2: the taint run's rules, one fixture each (`../vmTaint.js`, `docs/pine/START-TAINT.md`) ──────
//
// Every rule here has a mutant (`ci/mutants/e104-taint-vm.json`) that drops it, and the fixture's tag goes wrong.
// Every fixture is also a VALUE rail: each run is made twice, by `execute` and by `executeTainted`, and the values
// must be the same (the taint run never changes a value). Tags read: C clean, O offset (`bar_index`), T tainted.
import { describe, it, expect } from 'vitest'

import { execute, executeTainted, makeContext } from '../vm.js'
import { makeProgram, OP } from '../program.js'
import { contextForProgram } from '../lower.js'
import { lowerIrProgram } from '../lowerIr.js'
import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { interpret } from '../../ast/interpret.js'
import { columnTagsOf, TAG } from '../taintTags.js'

const N = 12
/** close > open on bars 3.. only (bars 0-2 close below open), and an EMA above close on some bars, below on others */
const BARS = Array.from({ length: N }, (_, i) => ({
  t: 1700000000 + i * 86400, o: i < 3 ? 12 : 10 + (i % 3), h: 12 + i, l: 9 + i, c: i < 3 ? 11 : 11 + (i % 4), v: 100,
}))
const SERIES = contextForProgram({ columns: [] }, BARS).series
const BAR_INDEX = Float64Array.from({ length: N }, (_, i) => i)
const CLOSE = SERIES[3]
const tags = (u8) => Array.from(u8, (t) => 'COT'[t]).join('')
const I = (op, a = 0, b = 0) => [op, a, b]

function sameValues(plain, tainted) {
  expect(tainted.outputs.length).toBe(plain.outputs.length)
  for (let k = 0; k < plain.outputs.length; k += 1) expect(Array.from(tainted.outputs[k])).toEqual(Array.from(plain.outputs[k]))
}

/** A hand-built program over BARS; `columns` are `[values, tag]` pairs. */
function hand(rows, { columns = [], outputs = 1, persists = 0, consts = [], textOps = [] } = {}) {
  const cols = columns.map(([v]) => v)
  const program = makeProgram({ code: rows.flat(), consts, columns: cols, outputs: Array.from({ length: outputs }, () => 'plot'),
    persists, textOps })
  const ctx = makeContext({ bars: N, series: SERIES, columns: cols })
  const plain = execute(program, ctx)
  const res = executeTainted(program, ctx, undefined, { taint: { columnTags: Uint8Array.from(columns.map(([, t]) => t)) } })
  sameValues(plain, res)
  return res
}

/** Real lowered Pine over BARS, its columns tagged by `columnTagsOf` from the trees the build evaluated. */
function pine(src) {
  const trees = []
  const built = buildRuntimeIr(`//@version=5\nindicator("t")\n${src}`, { bars: BARS, inputs: {},
    columnInterpret: (t, b, i, o) => { trees.push(t); return interpret(t, b, i, undefined, undefined, o) } })
  expect(built.ok, built.ok ? '' : `${built.refusal.guard}: ${built.refusal.message}`).toBe(true)
  const program = lowerIrProgram(built.ir)
  const ctx = contextForProgram(program, BARS)
  const plain = execute(program, ctx)
  const res = executeTainted(program, ctx, undefined, { taint: { columnTags: columnTagsOf(trees) } })
  sameValues(plain, res)
  return { res, program, values: plain.outputs }
}

describe('source 1: a `var` starts T', () => {
  it('a counter built on itself is T on every bar (exact: it is never overwritten from clean values)', () => {
    const { res } = pine('var float cnt = 0.0\ncnt := cnt + 1\nplot(cnt)')
    expect(tags(res.taint.outputs[0])).toBe('TTTTTTTTTTTT')
  })
  it('latch-after-event: a var written from clean values is C from that bar (a STORE overwrites the tag)', () => {
    const { res } = pine('var float last = na\nif close > open\n    last := high\nplot(last)')
    // bars 0-2: no event yet, the slot holds what another start left in it; bar 3 sets it from a clean high
    expect(tags(res.taint.outputs[0])).toBe('TTTCCCCCCCCC')
  })
})

describe('source 2: a history read before the run\'s first bar is T', () => {
  it('a series: close[3] is T on bars 0-2, C after', () => {
    const res = hand([I(OP.READ_SERIES_HIST, 3, 3), I(OP.EMIT, 0), I(OP.HALT)])
    expect(tags(res.taint.outputs[0])).toBe('TTTCCCCCCCCC')
  })
  it('a column: col[2] is T on bars 0-1, then the column\'s own tag', () => {
    const res = hand([I(OP.READ_HIST, 0, 2), I(OP.EMIT, 0), I(OP.HALT)], { columns: [[CLOSE, TAG.C]] })
    expect(tags(res.taint.outputs[0])).toBe('TTCCCCCCCCCC')
  })
  it('a slot: z[2] is T on bars 0-1, then what the ring committed', () => {
    const { res, program } = pine('float z = close\nz := z + 1\nplot(z[2])')
    expect(Array.from(program.code).filter((_, i) => i % 3 === 0)).toContain(OP.READ_HIST_SLOT)
    expect(tags(res.taint.outputs[0])).toBe('TTCCCCCCCCCC')
  })
})

describe('source 3: bar_index is O, and O shown as a value is T (ruling 2)', () => {
  it('bar_index plotted is T', () => {
    expect(tags(hand([I(OP.READ_COLUMN, 0), I(OP.EMIT, 0), I(OP.HALT)], { columns: [[BAR_INDEX, TAG.O]] })
      .taint.outputs[0])).toBe('TTTTTTTTTTTT')
    // the same through the build: the bar_index column is tagged O by its tree, and plotted it is T
    expect(tags(pine('plot(bar_index)').res.taint.outputs[0])).toBe('TTTTTTTTTTTT')
  })
  it('bar_index in text is T; bar_index stored stays O (the control)', () => {
    const res = hand([
      I(OP.READ_COLUMN, 0), I(OP.TEXT, 0, 1), I(OP.STORE_PERSIST, 0),   // s := str.tostring(bar_index)
      I(OP.READ_COLUMN, 0), I(OP.STORE_PERSIST, 1),                       // k := bar_index
      I(OP.HALT),
    ], { columns: [[BAR_INDEX, TAG.O]], persists: 2, outputs: 0, textOps: ['str.tostring'] })
    expect(tags(res.taint.persist)).toBe('TO')
  })
})

describe('the O rules: O +- C is O, O - O is C, O cmp O is C, any other use is T', () => {
  const OCOL = [[BAR_INDEX, TAG.O]]
  it('stored results: bar_index + 5 is O; 5 - bar_index, bar_index * 2 and bar_index + bar_index are T', () => {
    const res = hand([
      I(OP.READ_COLUMN, 0), I(OP.CONST, 0), I(OP.ADD), I(OP.STORE_PERSIST, 0),
      I(OP.CONST, 0), I(OP.READ_COLUMN, 0), I(OP.SUB), I(OP.STORE_PERSIST, 1),
      I(OP.READ_COLUMN, 0), I(OP.CONST, 1), I(OP.MUL), I(OP.STORE_PERSIST, 2),
      I(OP.READ_COLUMN, 0), I(OP.READ_COLUMN, 0), I(OP.ADD), I(OP.STORE_PERSIST, 3),
      I(OP.READ_COLUMN, 0), I(OP.CONST, 0), I(OP.SUB), I(OP.STORE_PERSIST, 4),
      I(OP.HALT),
    ], { columns: OCOL, persists: 5, outputs: 0, consts: [5, 2] })
    expect(tags(res.taint.persist)).toBe('OTTTO')
  })
  it('bar_index - bar_index[1] is C (from bar 1: bar 0 reads before the first bar)', () => {
    const res = hand([I(OP.READ_COLUMN, 0), I(OP.READ_HIST, 0, 1), I(OP.SUB), I(OP.EMIT, 0), I(OP.HALT)], { columns: OCOL })
    expect(tags(res.taint.outputs[0])).toBe('TCCCCCCCCCCC')
  })
  it('bar_index > bar_index[1] is C; bar_index > 100 is T', () => {
    const res = hand([
      I(OP.READ_COLUMN, 0), I(OP.READ_HIST, 0, 1), I(OP.GT), I(OP.EMIT, 0),
      I(OP.READ_COLUMN, 0), I(OP.CONST, 0), I(OP.GT), I(OP.EMIT, 1),
      I(OP.HALT),
    ], { columns: OCOL, outputs: 2, consts: [100] })
    expect(tags(res.taint.outputs[0])).toBe('TCCCCCCCCCCC')
    expect(tags(res.taint.outputs[1])).toBe('TTTTTTTTTTTT')
  })
  it('an O history OFFSET is T: close[bar_index] reaches back to the run\'s first bar; close[bar_index - bar_index[1]] is C', () => {
    const res = hand([
      I(OP.READ_COLUMN, 0), I(OP.READ_SERIES_HIST_DYN, 3, 0), I(OP.EMIT, 0),
      I(OP.READ_COLUMN, 0), I(OP.READ_HIST, 0, 1), I(OP.SUB), I(OP.READ_SERIES_HIST_DYN, 3, 0), I(OP.EMIT, 1),
      I(OP.HALT),
    ], { columns: OCOL, outputs: 2 })
    expect(Array.from(res.outputs[0])).toEqual(new Array(N).fill(CLOSE[0]))   // the value: our first bar's close, every bar
    expect(tags(res.taint.outputs[0])).toBe('TTTTTTTTTTTT')
    expect(tags(res.taint.outputs[1])).toBe('TCCCCCCCCCCC')
  })
})

describe('implicit flow: a T condition taints everything either arm may write, until the join', () => {
  it('a local written under a T condition is T on EVERY bar, the bars that did not take the arm included', () => {
    const { res, values } = pine('float x = 0.0\nif ta.ema(close, 3) > close\n    x := 1.0\nplot(x)')
    const v = Array.from(values[0])
    expect(v).toContain(0)   // non-vacuity: some bars did not take the arm
    expect(v).toContain(1)   // and some did
    expect(tags(res.taint.outputs[0])).toBe('TTTTTTTTTTTT')
  })
  it('a store after the join is not under the branch (the region closes at the join)', () => {
    const { res } = pine('float x = 0.0\nif ta.ema(close, 3) > close\n    x := 1.0\nfloat w = close\nplot(w)\nplot(x)')
    expect(tags(res.taint.outputs[0])).toBe('CCCCCCCCCCCC')
  })
  it('a C condition opens nothing (the control)', () => {
    const { res } = pine('float x = 0.0\nif close > open\n    x := 1.0\nplot(x)')
    expect(tags(res.taint.outputs[0])).toBe('CCCCCCCCCCCC')
  })
})

describe('calls: an argument\'s tag reaches the body, the result\'s tag comes back', () => {
  it('f(close) is C; f(bar_index) (bar_index * 2 inside) is T', () => {
    const { res } = pine('f(v) =>\n    v * 2\nplot(f(close))\nplot(f(bar_index))')
    expect(tags(res.taint.outputs[0])).toBe('CCCCCCCCCCCC')
    expect(tags(res.taint.outputs[1])).toBe('TTTTTTTTTTTT')
  })
})

describe('a call site\'s held cell starts T (another start may have run the site before our first bar)', () => {
  it('s[1] inside f, on the first bar the site runs, reads what the site held before it ever ran here: T', () => {
    const { res, values } = pine('f(v) =>\n    float s = v\n    s[1]\nfloat r = na\nif close > open\n    r := f(close)\nplot(r)')
    expect(Number.isNaN(values[0][3])).toBe(true)   // bar 3: the site's first run here; s[1] is the never-run bar 2
    expect(tags(res.taint.outputs[0])).toBe('CCCTCCCCCCCC')
  })
})

describe('fail closed until their own parts (built-ins, part 3)', () => {
  it('a window built-in (a column the part-2 tags do not name) is T', () => {
    expect(tags(pine('plot(ta.sma(close, 3))').res.taint.outputs[0])).toBe('TTTTTTTTTTTT')
  })
})

describe('the taint run is a whole top-level run', () => {
  const p = makeProgram({ code: [OP.READ_SERIES, 3, 0, OP.EMIT, 0, 0, OP.HALT, 0, 0], consts: [], columns: [], outputs: ['plot'] })
  const ctx = makeContext({ bars: N, series: SERIES, columns: [] })
  it('refuses a resume, a probe, a checkpoint, a realtime ledger or a request entry by name', () => {
    for (const o of [{ resume: {} }, { probe: { bars: [] } }, { checkpointAt: 3 }, { realtime: {} }, { entry: 0 }]) {
      expect(() => executeTainted(p, ctx, undefined, o)).toThrow(/runtime:taint/)
    }
  })
  it('refuses column tags that do not match the columns', () => {
    expect(() => executeTainted(p, ctx, undefined, { taint: { columnTags: [0] } })).toThrow(/runtime:taint/)
  })
  it('the listing run (`execute`) carries no tags', () => {
    expect(execute(p, ctx).taint).toBeUndefined()
    expect(executeTainted(p, ctx).taint.outputs[0]).toBeInstanceOf(Uint8Array)
  })
})
