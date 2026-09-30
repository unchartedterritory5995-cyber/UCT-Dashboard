// app/src/components/chart/engine/__tests__/objectGetterState.test.js
//
// ─── ⭐⭐ C14 — A DRAWING GETTER, ANSWERED WHERE PINE READS IT ─────────────────
//
// `rsi-swing-indicator` (NYSE:RDDT 1D, 2026-09-28 capture) writes
// `last := label.get_y(l)` inside an `if` and reads it in a label's text, and
// draws `line.new(…, x2 = labelll_ts)` from a block local `labelll_ts =
// label.get_x(labelll)`. A getter answers what the program last set on that
// object, which the object RUNTIME holds — so the runtime answers it, in op
// order (`program.nums`, `setnum`, `{v:'num'}`, a whole-coordinate `{v:'get'}`).
//
// Each half has the control that fails without it. What stays refused, by name:
// a getter inside arithmetic, a scalar anything else also writes, a read of a
// name one op makes both before and after a write of it in ONE statement
// (`readBeforeWrite`, narrowed by C12r — a read before a LATER statement's
// write is now served), and a getter on state this program lost (`state:lost`).
import { describe, it, expect } from 'vitest'
import { translatePine } from '../ast/pine'
import { assertObjectProgram } from '../ast/objectProgram'
import { getterScalars } from '../ast/objectFnInline'
import { evaluateObjects } from '../objectRuntime'
import { objectReaderFor } from '../objectColumns'

const HEAD = '//@version=5\nindicator("g", overlay=true)\n'
const tr = (body) => translatePine(HEAD + body + '\nplot(close)\n')
const opsOf = (t) => (t.objects ? t.objects.ops : [])

/** Bars: every bar an up bar, highs rising by 1 from 11. */
const upBars = (n) => Array.from({ length: n }, (_, i) => ({
  t: `2026-01-${String(i + 1).padStart(2, '0')}`, o: 9 + i, h: 11 + i, l: 8 + i, c: 10 + i, v: 1,
}))
const run = (t, bars) => {
  const reader = objectReaderFor({ objects: t.objects }, bars, { tf: 'D', newestBarIsForming: false })
  return evaluateObjects(reader.program, {
    barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
  })
}

const SWING = `var label hi = na
var float lastY = 0.0
if close > open
    lastY := label.get_y(hi)
    hiX = label.get_x(hi)
    hiY = label.get_y(hi)
    line.new(bar_index, high, hiX, hiY)
    hi := label.new(bar_index, high, lastY < high ? "HH" : "LH")`

describe('C14 — a scalar a getter writes, and a getter as a whole coordinate', () => {
  it('⭐ the reader finds the three scalars; the program writes them in op order and reads them', () => {
    const t = tr(SWING)
    expect(t.objectDiagnostics.getterScalars).toEqual({ served: ['hiX', 'hiY', 'lastY'], refused: [] })
    expect(t.objectDiagnostics.droppedOps).toBe(0)
    const p = t.objects
    expect(() => assertObjectProgram(p)).not.toThrow()
    expect(p.nums).toEqual(expect.arrayContaining([
      { id: expect.any(String), init: 0 },
      { id: expect.any(String), init: null },
    ]))
    // three writes, then the line, then the label — the source order
    expect(p.ops.filter((o) => o.k !== 'setreg').map((o) => o.k + (o.family ? `:${o.family}` : '')))
      .toEqual(['setnum', 'setnum', 'setnum', 'create:line', 'create:label'])
    const line = p.ops.find((o) => o.k === 'create' && o.family === 'line')
    expect(line.props.x2.v).toBe('num')
    expect(line.props.y2.v).toBe('num')
    const label = p.ops.find((o) => o.k === 'create' && o.family === 'label')
    expect(label.props.text.node.cond).toMatchObject({ v: 'cmp', op: '<', args: [{ v: 'num' }, { v: 'tree' }] })
  })

  it('⭐ the runtime draws what Pine draws: x2/y2 are the PREVIOUS label, the text reads it', () => {
    const bars = upBars(4)
    const r = run(tr(SWING), bars)
    const lines = r.live.filter((o) => o.family === 'line')
    const labels = r.live.filter((o) => o.family === 'label')
    expect(lines).toHaveLength(4)
    expect(labels).toHaveLength(4)
    // bar 0: no label yet — `label.get_x(na)` is na (measured: the vendor's first line has a null y2)
    expect(Number.isNaN(lines[0].props.x2)).toBe(true)
    expect(Number.isNaN(lines[0].props.y2)).toBe(true)
    expect(lines.slice(1).map((l) => [l.props.x2, l.props.y2])).toEqual([[0, 11], [1, 12], [2, 13]])
    // bar 0: `na < high` is false → "LH" (the vendor's first overbought label reads "LH" there)
    expect(labels.map((l) => l.props.text)).toEqual(['LH', 'HH', 'HH', 'HH'])
  })

  it('⭐ an INLINE getter in a coordinate is a `get` read at the op', () => {
    const t = tr(`var line l = na
if close > open
    label.new(bar_index, line.get_y1(l))
    l := line.new(bar_index, high, bar_index + 1, high)`)
    const lab = opsOf(t).find((o) => o.k === 'create' && o.family === 'label')
    expect(lab.props.y).toMatchObject({ v: 'get', prop: 'y1' })
    const r = run(t, upBars(3))
    const ys = r.live.filter((o) => o.family === 'label').map((o) => o.props.y)
    expect(Number.isNaN(ys[0])).toBe(true)
    expect(ys.slice(1)).toEqual([11, 12])
  })

  it('⛔ a getter INSIDE arithmetic stays refused, by name', () => {
    const t = tr(`var line l = na
if close > open
    label.new(bar_index, line.get_y1(l) + 1)
    l := line.new(bar_index, high, bar_index + 1, high)`)
    expect(opsOf(t).some((o) => o.k === 'create' && o.family === 'label')).toBe(false)
    expect(t.objectDiagnostics.getters).toContain('line.get_y1')
    expect(t.objectDiagnostics.dropReasons['create:label']).toBe(1)
  })

  it('⛔ a name ALSO written some other way is not a scalar — its reader refuses', () => {
    const t = tr(`${SWING}\nif close < open\n    lastY := close`)
    expect(t.objectDiagnostics.getterScalars.served).not.toContain('lastY')
    expect(opsOf(t).some((o) => o.k === 'create' && o.family === 'label')).toBe(false)
  })
})

describe('C14 — getterScalars (the reader half)', () => {
  const scan = (src) => {
    const t = translatePine(HEAD + src + '\nplot(close)\n')
    return t.objectDiagnostics.getterScalars || { served: [], refused: [] }
  }
  it('a scalar written inside a loop, a function body, or declared twice does not qualify', () => {
    expect(scan(`var label a = na\nvar float y = 0.0\nfor i = 0 to 2\n    y := label.get_y(a)\nlabel.new(bar_index, y)`).served).toEqual([])
    expect(scan(`var label a = na\nvar float y = 0.0\nf() =>\n    y := label.get_y(a)\nlabel.new(bar_index, y)`).served).toEqual([])
    expect(typeof getterScalars).toBe('function')
  })
})

describe('C14 — the handle an if/else helper returns', () => {
  it('⭐ each arm\'s create is copied into the caller\'s variable under its own guard', () => {
    const t = tr(`var label keep = na
mk(up) =>
    if up
        label.new(bar_index, high, "U")
    else
        label.new(bar_index, low, "D")
if close > open
    keep := mk(true)
    label.set_text(keep, "moved")`)
    const copies = opsOf(t).filter((o) => o.k === 'setreg' && o.value && o.value.r === 'site')
    expect(copies).toHaveLength(2)
    const r = run(t, upBars(2))
    expect(r.live.filter((o) => o.family === 'label').map((o) => o.props.text)).toEqual(['moved', 'moved'])
  })
})

describe('C14 — a name read before its own later write in the bar', () => {
  const late = `var int st = 0
if st == 2 and close > open
    label.new(bar_index, high, "X")
if close > open
    st := 1
if close < open
    st := 2`
  // ⭐⭐ C9 × C14 (2026-09-29, one mechanism): a write in a LATER top-level
  // statement is no longer refused — the object pass resolves an op against the
  // env as its OWN statement leaves it (`baseFor`, C9), which is Pine's value at
  // the read: last bar's final `st`. This case was `⛔ is refused by name`; it is
  // now read exactly, and the same-statement case below keeps the refusal.
  it('⭐ a write in a LATER statement is read as Pine reads it — last bar\'s final value', () => {
    const t = tr(late)
    expect(t.objectDiagnostics.readBeforeWrite).toBeUndefined()
    expect(opsOf(t).some((o) => o.k === 'create')).toBe(true)
    // up/down pattern, past the 250-bar warm-up
    const N = 320
    const up = (i) => (i * 7) % 5 < 3
    const bars = Array.from({ length: N }, (_, i) => {
      const d = new Date(Date.UTC(2020, 0, 1) + i * 86400000).toISOString().slice(0, 10)
      return up(i) ? { t: d, o: 10, h: 12, l: 9, c: 11, v: 1 } : { t: d, o: 11, h: 12, l: 9, c: 10, v: 1 }
    })
    const r = run(t, bars)
    // Pine, by hand: the guard reads `st` as it ENDED the previous bar
    let st = 0
    const want = []
    for (let i = 0; i < N; i += 1) {
      if (st === 2 && up(i)) want.push(i)
      if (up(i)) st = 1
      else st = 2
    }
    const got = r.live.filter((o) => o.family === 'label').map((o) => o.createdBar)
    const tail = (xs) => xs.filter((b) => b >= 260)
    expect(tail(got)).toEqual(tail(want))
    expect(tail(got).length).toBeGreaterThan(5)
  })

  // ⭐ C12r (merged over C9): a write later in the op's OWN statement, with
  // every read of the name ABOVE it, reads the statement's START binding — the
  // plot lane's `partialStateRead`, `accum(…)[1]`. The refusal survives only
  // for a name one op reads on BOTH sides of a write (`objectReadOrder.test.js`).
  it('⭐ a write later in the op\'s OWN statement, below every read, is read at the statement\'s start', () => {
    const t = tr(`var int st = 0
if close > open
    if st == 2
        label.new(bar_index, high, "X")
    st := 1
if close < open
    st := 2`)
    expect(t.objectDiagnostics.readBeforeWrite).toBeUndefined()
    const N = 320
    const up = (i) => (i * 7) % 5 < 3
    const bars = Array.from({ length: N }, (_, i) => {
      const d = new Date(Date.UTC(2020, 0, 1) + i * 86400000).toISOString().slice(0, 10)
      return up(i) ? { t: d, o: 10, h: 12, l: 9, c: 11, v: 1 } : { t: d, o: 11, h: 12, l: 9, c: 10, v: 1 }
    })
    const r = run(t, bars)
    let st = 0
    const want = []
    for (let i = 0; i < N; i += 1) {
      if (up(i)) { if (st === 2) want.push(i); st = 1 } else st = 2
    }
    const got = r.live.filter((o) => o.family === 'label').map((o) => o.createdBar)
    const tail = (xs) => xs.filter((b) => b >= 260)
    expect(tail(got)).toEqual(tail(want))
    expect(tail(got).length).toBeGreaterThan(5)
  })
  it('✓ CONTROL — read AFTER the bar\'s writes, it is kept', () => {
    const t = tr(`var int st = 0
if close > open
    st := 1
if close < open
    st := 2
if st == 2 and close > open
    label.new(bar_index, high, "X")`)
    expect(t.objectDiagnostics.readBeforeWrite).toBeUndefined()
    expect(opsOf(t).some((o) => o.k === 'create')).toBe(true)
  })
  it('✓ CONTROL — read after the bar’s EARLIER write, with another write later (smc’s `last_ph_s`): the walk binds it positionally, kept', () => {
    const t = tr(`var float lv = na
if close > open
    lv := high
if not na(lv) and close > lv
    label.new(bar_index, lv, "B")
    lv := na`)
    expect(t.objectDiagnostics.readBeforeWrite).toBeUndefined()
    expect(opsOf(t).some((o) => o.k === 'create')).toBe(true)
  })
  it('✓ CONTROL — a read that folds away (`and <false input>`) cannot be wrong, and is kept', () => {
    const t = tr(`show = input.bool(false, "s")\n${late.replace('st == 2 and close > open', 'st == 2 and show')}`)
    expect(t.objectDiagnostics.readBeforeWrite).toBeUndefined()
  })
})

describe('C14 — a getter on state this program lost is withheld (`state:lost`)', () => {
  it('⛔ a lost create of the family makes every getter on it unknowable', () => {
    const t = tr(`var line l = na
if close > open
    label.new(bar_index, line.get_y1(l))
    l := line.new(bar_index, high, bar_index + 1, high)
if close > open
    line.new(bar_index, nosuchname, bar_index + 1, high)`)
    expect(t.objectDiagnostics.dropReasons['state:lost']).toBe(1)
    expect(opsOf(t).some((o) => o.k === 'create' && o.family === 'label')).toBe(false)
  })
})

describe('C14 — the runtime half, on hand-built programs', () => {
  const P = (over) => ({ programVersion: 1, regs: [{ id: 'r0', family: 'label' }], colls: [], ops: [], ...over })
  const ctx = (n, extra = {}) => ({ barCount: n, readNode: () => 1, readTime: (b) => b, ...extra })
  const mk = (when = null) => ({ k: 'create', family: 'label', site: 's0', into: 'r0', when, props: { x: { v: 'bar' }, y: { v: 'bar' } } })
  const GET = { v: 'get', target: { r: 'reg', id: 'r0' }, prop: 'y' }

  it("⭐ a scalar is written where its op stands: before the create it reads last bar's label", () => {
    const at = (setFirst) => {
      const write = { k: 'setnum', num: 'n0', value: GET, when: null }
      const reader = { k: 'create', family: 'label', site: 's1', into: null, when: null, props: { x: { v: 'bar' }, y: { v: 'num', id: 'n0' } } }
      const prog = P({ nums: [{ id: 'n0', init: null }], ops: setFirst ? [write, mk(), reader] : [mk(), write, reader] })
      return evaluateObjects(prog, ctx(3)).live.filter((o) => o.site === 's1').map((o) => o.props.y)
    }
    expect(at(true)).toEqual([NaN, 0, 1])
    expect(at(false)).toEqual([0, 1, 2]) // CONTROL — the same ops in another order read another label
  })

  it('⭐ a `var` scalar starts at its declared value until a getter writes it', () => {
    const prog = P({
      nums: [{ id: 'n0', init: 5 }],
      ops: [
        { k: 'setnum', num: 'n0', value: GET, when: { v: 'bar' } }, // skipped on bar 0 (bar index 0 is falsy)
        { ...mk(), site: 's1', into: null, props: { x: { v: 'bar' }, y: { v: 'num', id: 'n0' } } },
      ],
    })
    expect(evaluateObjects(prog, ctx(1)).live.map((o) => o.props.y)).toEqual([5])
  })

  it('⭐ a handle a DELETE empties reads `na` (the runtime empties the register; C16 rails the same)', () => {
    const t = tr(`var line l = na
if close > open
    label.new(bar_index, line.get_y1(l))
    l := line.new(bar_index, high, bar_index + 1, high)
if close < open
    line.delete(l)`)
    expect(t.objectDiagnostics.dropReasons['state:lost']).toBeUndefined()
    expect(opsOf(t).some((o) => o.k === 'create' && o.family === 'label')).toBe(true)
  })

  it('⭐ C17 — a handle written off a recurrence is CONVERTED; the runtime taints it where the curtain withholds it', () => {
    // ⚰️ This pinned `state:lost` for the whole program: the runtime held no
    // taint of its own, so the converter ruled the handle out on every bar.
    // It does now — `objectRegisterTaint.test.js` runs this source end to end.
    const t = tr(`var line l = na
var float lv = na
if close > open
    lv := high
if close > open
    label.new(bar_index, line.get_y1(l))
    l := line.new(bar_index, lv, bar_index + 1, high)`)
    expect(t.objectDiagnostics.dropReasons['state:lost']).toBeUndefined()
    expect(opsOf(t).some((o) => o.k === 'create' && o.family === 'label')).toBe(true)
  })

  it('⛔ the validator: a scalar read outside an op\'s own props/guard, a setnum in a loop', () => {
    const num = { v: 'num', id: 'n0' }
    const base = { nums: [{ id: 'n0', init: null }] }
    expect(() => assertObjectProgram(P({ ...base, ops: [{ k: 'loop', id: 'i', from: { v: 'const', value: 0 }, to: { v: 'const', value: 1 }, body: [{ k: 'setnum', num: 'n0', value: GET, when: null }] }] }))).toThrow(/bad setnum/)
    expect(() => assertObjectProgram(P({ ...base, ops: [{ ...mk(), props: { x: { v: 'bar' }, y: { v: 'op', op: '+', args: [num, { v: 'const', value: 1 }] } } }] }))).toThrow(/legal only in a guard/)
  })
})
