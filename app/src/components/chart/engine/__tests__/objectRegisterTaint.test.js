// app/src/components/chart/engine/__tests__/objectRegisterTaint.test.js
//
// ─── ⭐⭐ C17 — WHAT A WITHHELD OP WOULD HAVE WRITTEN IS UNKNOWN ────────────────
//
// The warm-up curtain (`readUnknown`) withholds an op on a bar where it reads a
// `var` Pine holds and this lane cannot compute. Before C17 the runtime forgot
// that the moment it skipped the op: a register the op would have written kept
// its old value as if it were Pine's, and every later getter read it as known.
// The converter covered that with a blanket `state:lost` on any handle written
// off a recurrence — which cost `rsi-swing-indicator` its whole program.
//
// The runtime now carries a per-bar, per-property TAINT (`objectRuntime.js`
// `regTaint`): a withheld op marks what it would have written; an op whose
// guard, handle or address reads a mark is withheld in turn; a property whose
// VALUE reads one is marked on the object; a clean write clears the mark; and
// an object still marked at the end is held but not drawn.
//
// Each rule has the control that fails without it. `unknownMask`'s equality
// probe (the curtain could not see `laststate == 1`) is railed here too.
import { describe, it, expect } from 'vitest'
import { evaluateObjects } from '../objectRuntime'
import { unknownMask, probeValuesOf, PREFIX_PROBE } from '../objectColumns'
import { parseFormula } from '../ast/parse.js'
import { interpret } from '../ast/interpret'
import { translatePine } from '../ast/pine'
import { objectReaderFor } from '../objectColumns'

const P = (over) => ({ programVersion: 1, regs: [{ id: 'r0', family: 'label' }], colls: [], ops: [], ...over })
const ctx = (n, extra = {}) => ({ barCount: n, readNode: (node) => (node === 9 ? 0 : 1), readTime: (b) => b, ...extra })
const G = (node) => ({ v: 'graph', node })
const GET = (prop, reg = 'r0') => ({ v: 'get', target: { r: 'reg', id: reg }, prop })
const TEXT_LT = (num) => ({
  v: 'text',
  node: { t: 'if', cond: { v: 'cmp', op: '<', args: [{ v: 'num', id: num }, { v: 'const', value: 5 }] }, then: { t: 'lit', s: 'LO' }, else: { t: 'lit', s: 'HI' } },
})
/** A label made into `r0` on every bar the graph node 0 guards. */
const mkInto = (when = G(0), site = 's0') => ({
  k: 'create', family: 'label', site, into: 'r0', when, props: { x: { v: 'bar' }, y: { v: 'bar' } },
})

describe('C17 — a withheld create taints its register; a reader of it is withheld', () => {
  // bar 0: the create reads an unknown node → withheld, `r0` tainted
  // bar 1: `n0 := label.get_y(r0)` reads the tainted handle → `n0` tainted,
  //        and a label whose TEXT reads `n0` is made (Pine made it) but not drawn
  const prog = () => P({
    nums: [{ id: 'n0', init: 0 }],
    ops: [
      { k: 'setnum', num: 'n0', value: GET('y'), when: { v: 'bar' } },   // not on bar 0 (bar index 0 is falsy)
      { k: 'create', family: 'label', site: 's1', into: null, when: { v: 'bar' }, props: { x: { v: 'bar' }, y: { v: 'const', value: 1 }, text: TEXT_LT('n0') } },
      mkInto(),
    ],
  })
  const unknownOnBar0 = (node, bar) => node === 0 && bar === 0

  it('⭐ the text that read a pre-curtain label is held, counted, and NOT drawn', () => {
    const run = evaluateObjects(prog(), ctx(2, { readUnknown: unknownOnBar0 }))
    // bar 1 drew the `r0` label (known guard) — and withheld the text reader
    expect(run.live.map((o) => [o.site, o.createdBar])).toEqual([['s0', 1]])
    expect(run.withheld).toEqual({ label: 1 })
    expect(run.stats.objectsTainted).toBe(1)
    expect(run.stats.withheldUnknown).toBe(1)
  })

  it('⛔ CONTROL — with no curtain the same program draws the text label, reading the known handle', () => {
    const run = evaluateObjects(prog(), ctx(2))
    expect(run.live.map((o) => o.site).sort()).toEqual(['s0', 's0', 's1'])
    expect(run.live.find((o) => o.site === 's1').props.text).toBe('LO') // n0 = y of bar 0's label = 0
    expect(run.stats.objectsTainted).toBeUndefined()
  })

  it('⭐ a CLEAN write clears the mark: the next getter on the register is exact again', () => {
    // bar 0 withheld (r0 tainted); bar 1's reader is marked, and its create of
    // r0 is clean; bar 2's reader reads bar 1's label (y = 1): drawn, exact.
    const run = evaluateObjects(prog(), ctx(3, { readUnknown: unknownOnBar0 }))
    const texts = run.live.filter((o) => o.site === 's1').map((o) => [o.createdBar, o.props.text])
    expect(texts).toEqual([[2, 'LO']])
    expect(run.stats.objectsTainted).toBe(1)
  })
})

describe('C17 — the mark is "unknown at this bar", never a bar number', () => {
  it('⭐ a curtain on bar 7 only taints from bar 7; bars 0–6 are served', () => {
    const prog = P({
      nums: [{ id: 'n0', init: 0 }],
      ops: [
        { k: 'setnum', num: 'n0', value: GET('y'), when: null },
        { k: 'create', family: 'label', site: 's1', into: null, when: null, props: { x: { v: 'bar' }, y: { v: 'num', id: 'n0' } } },
        mkInto(),
      ],
    })
    const run = evaluateObjects(prog, ctx(10, { readUnknown: (node, bar) => node === 0 && bar === 7 }))
    // the reader's y is a WHOLE coordinate read off `n0`: tainted on bar 8 only
    // (bar 7's label was withheld; bar 8 reads r0 → tainted; bar 9 reads bar 8's)
    const drawn = run.live.filter((o) => o.site === 's1').map((o) => o.createdBar)
    expect(drawn).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 9])
    expect(run.stats.objectsTainted).toBe(1)
  })
})

describe('C17 — guard-level reads withhold the op and taint what it would have written', () => {
  it('⭐ an update whose handle is tainted is withheld, and marks the object the register still holds', () => {
    // bar 0: create into r0 (clean). bar 1: a second create into r0 is withheld
    // (curtain) — Pine's r0 may now be a new label. bar 1: set_y(r0) is withheld
    // and the bar-0 label (which r0 still holds here) is marked — it is not drawn.
    const prog = P({
      ops: [
        mkInto(),
        { k: 'update', family: 'label', target: { r: 'reg', id: 'r0' }, when: null, props: { y: { v: 'const', value: 42 } } },
      ],
    })
    const run = evaluateObjects(prog, ctx(2, { readUnknown: (node, bar) => node === 0 && bar === 1 }))
    expect(run.stats.withheldTainted).toBe(1)
    expect(run.live).toEqual([])
    expect(run.withheld).toEqual({ label: 1 })
  })

  it('⛔ CONTROL — with no curtain the update runs on the bar-1 label and both are drawn', () => {
    const prog = P({
      ops: [
        mkInto(),
        { k: 'update', family: 'label', target: { r: 'reg', id: 'r0' }, when: null, props: { y: { v: 'const', value: 42 } } },
      ],
    })
    const run = evaluateObjects(prog, ctx(2))
    expect(run.live.map((o) => o.props.y)).toEqual([42, 42])
    expect(run.stats.withheldTainted).toBeUndefined()
  })
})

describe('C17 — a value-level read marks only that property, and a clean write of it clears it', () => {
  const prog = (cleanText) => P({
    nums: [{ id: 'n0', init: 0 }],
    ops: [
      { k: 'setnum', num: 'n0', value: GET('y'), when: G(0) },                          // withheld on bar 0
      { k: 'create', family: 'label', site: 's0', into: 'r0', when: { v: 'const', value: 1 }, once: true, props: { x: { v: 'bar' }, y: { v: 'const', value: 3 }, text: TEXT_LT('n0') } },
      ...(cleanText ? [{ k: 'update', family: 'label', target: { r: 'reg', id: 'r0' }, when: { v: 'bar' }, props: { text: { v: 'text', node: { t: 'lit', s: 'OK' } } } }] : []),
    ],
  })
  const curtain = { readUnknown: (node, bar) => node === 0 && bar === 0 }

  it('⭐ a create whose text reads a tainted scalar RUNS (Pine made it) and is held undrawn', () => {
    const run = evaluateObjects(prog(false), ctx(2, curtain))
    expect(run.stats.created).toBe(1)            // the object exists — ids stay Pine's
    expect(run.live).toEqual([])
    expect(run.withheld).toEqual({ label: 1 })
  })

  it('⭐ …and a later CLEAN `set_text` makes it exact again — it is drawn', () => {
    const run = evaluateObjects(prog(true), ctx(2, curtain))
    expect(run.live.map((o) => o.props.text)).toEqual(['OK'])
    expect(run.stats.objectsTainted).toBeUndefined()
  })
})

describe('C17 — the curtain can see an EQUALITY against the state', () => {
  // up bars on 1, 4, 7, 9 — `state` is 1 after an up bar and 2 after a down bar
  const closes = [10, 12, 11, 10, 14, 13, 12, 16, 15, 17, 16, 15]
  const bars = closes.map((c, i) => ({ t: 1_700_000_000 + i * 86400, o: c - (i % 3 === 1 ? 1 : -1), h: c + 1, l: c - 1, c, v: 1 }))
  const state = 'accum(0, close > open ? self : self, 3)' // a state the bars never reset
  const maskOf = (src) => {
    const { ast } = parseFormula(src)
    const col = interpret(ast, bars, {}, undefined, undefined, {})
    return unknownMask(ast, col, bars, {}, undefined, {})
  }

  it('⭐ `state == 1` on the prefix is UNKNOWN (a prefix of 1 flips it)', () => {
    const mask = maskOf(`${state} == 1 ? 1 : 0`)
    expect(mask).not.toBeNull()
    expect([...mask].slice(0, 3)).toEqual([1, 1, 1])
  })

  it('⛔ CONTROL — probing only at ±PREFIX_PROBE cannot see it (the gap this closes)', () => {
    const { ast } = parseFormula(`${state} == 1 ? 1 : 0`)
    const col = interpret(ast, bars, {}, undefined, undefined, {})
    const hi = interpret(ast, bars, {}, undefined, undefined, { prefixProbe: PREFIX_PROBE })
    const lo = interpret(ast, bars, {}, undefined, undefined, { prefixProbe: -PREFIX_PROBE })
    expect([0, 1, 2].every((i) => col[i] === hi[i] && col[i] === lo[i])).toBe(true)
  })

  it('⭐ the probe values are ±PREFIX_PROBE and every finite literal an ==/!= compares', () => {
    const { ast } = parseFormula(`(${state} == 1) || (${state} != 2) || (${state} > 7) ? 1 : 0`)
    expect(probeValuesOf(ast).sort((a, b) => a - b)).toEqual([-PREFIX_PROBE, 1, 2, PREFIX_PROBE])
  })
})

describe('C17 — end to end: a handle written off a `var` the curtain withholds', () => {
  // 260 daily bars: up on bars 0, 50, 100, 150, 200, and on every bar from 250.
  // `lv` is a `var` (curtain 250): an up bar before 250 makes a line from an
  // `lv` this lane cannot compute there — withheld, and `l` marked.
  const bars = Array.from({ length: 260 }, (_, i) => {
    const up = i >= 250 || i % 50 === 0
    const c = 100 + i
    return { t: new Date(Date.UTC(2024, 0, 1) + i * 86400000).toISOString().slice(0, 10), o: up ? c - 1 : c + 1, h: c + 2, l: c - 2, c, v: 1 }
  })
  const SRC = `//@version=5
indicator("t", overlay=true)
var line l = na
var float lv = na
if close > open
    lv := high
if close > open
    label.new(bar_index, line.get_y1(l))
    l := line.new(bar_index, lv, bar_index + 1, high)
plot(close)
`
  it('⭐ the label that reads the first known line is drawn; nothing reads a pre-curtain value', () => {
    const t = translatePine(SRC)
    const reader = objectReaderFor({ objects: t.objects }, bars, { tf: 'D', newestBarIsForming: false })
    const run = evaluateObjects(reader.program, {
      barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
    })
    const labels = run.live.filter((o) => o.family === 'label')
    const lines = run.live.filter((o) => o.family === 'line')
    // bar 0's label reads `l` before any line (Pine's `na` too): drawn. The
    // labels of bars 50…250 read a line made off the curtain: made, not drawn.
    expect(labels.map((o) => o.createdBar)).toEqual([0, 251, 252, 253, 254, 255, 256, 257, 258, 259])
    expect(Number.isNaN(labels[0].props.y)).toBe(true)
    expect(run.withheld).toEqual({ label: 5 })
    // every other drawn label's y is the y1 of the line made on the bar before it — Pine's own reading
    const lineAt = new Map(lines.map((l) => [l.createdBar, l.props.y1]))
    for (const lb of labels.slice(1)) expect(lb.props.y).toBe(lineAt.get(lb.createdBar - 1))
    // and every line's y1 is that bar's high (`lv := high` ran on it)
    expect(lines.map((o) => o.createdBar)).toEqual([250, 251, 252, 253, 254, 255, 256, 257, 258, 259])
    for (const ln of lines) expect(ln.props.y1).toBe(bars[ln.createdBar].h)
  })
})
