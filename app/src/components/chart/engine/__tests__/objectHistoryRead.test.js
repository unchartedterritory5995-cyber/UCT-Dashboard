// ─── C9 — `x[e]` WITH A PER-BAR `e`, SERVED BY THE OBJECT RUNTIME ────────────
//
// `extrapolated-pivot-connector` draws its two lines and four labels at
// `up[n - a1]` / `n[n - a1 + length]` — the pivot value, and the bar, at the bar
// a `valuewhen` found. TradingView (NYSE:RDDT 1D, 2026-09-28) holds 2 lines and
// 4 labels at y 230.41 / 282.95 / 79.7499 / 119.27; the V2 graph refuses the read
// by design (an offset's bar count is a literal), so the object runtime reads
// the column at `bar - e` (`{v:'at'}`, objectProgram.js `MAX_BARS_BACK_CAP`).
//
// Each Pine rule below has its own case, and each case is built so the wrong
// rule gives a DIFFERENT answer, not a missing one.
import { describe, it, expect } from 'vitest'
import { evaluateObjects, OBJECT_STATUS } from '../objectRuntime'
import { assertObjectProgram } from '../ast/objectProgram'
import { translatePine } from '../ast/pine.js'

const ctxOf = (barCount, cols = {}, extra = {}) => ({
  barCount,
  readNode: (node, bar) => (cols[node] ? cols[node][bar] : NaN),
  readTime: (bar) => 1_700_000_000 + bar * 86400,
  ...extra,
})
const P = (over) => ({ programVersion: 1, regs: [], colls: [], ops: [], ...over })
const AT = (src, back, limit = 5000) => ({ v: 'at', args: [src, back], limit })
const G = (node) => ({ v: 'graph', node })
const on = (n, list) => Array.from({ length: n }, (_, i) => (list.includes(i) ? 1 : 0))

// node 0: guard · node 1: the source column (100 + bar) · node 2: the offset
const SRC = Array.from({ length: 10 }, (_, i) => 100 + i)
const labelAt = (when, back, limit) => P({
  ops: [{ k: 'create', family: 'label', site: 's', into: null, when,
    props: { x: { v: 'bar' }, y: AT(G(1), back, limit), text: { v: 'const', value: 'L' } } }],
})

describe('the runtime reads `x` on bar `bar - e`', () => {
  it('⭐⭐ reads the source column at the earlier bar', () => {
    const prog = labelAt(G(0), G(2))
    assertObjectProgram(prog)
    const back = [0, 0, 0, 0, 0, 0, 0, 3, 0, 0]
    const r = evaluateObjects(prog, ctxOf(10, { 0: on(10, [7]), 1: SRC, 2: back }))
    expect(r.status).toBe(OBJECT_STATUS.OK)
    expect(r.live).toHaveLength(1)
    expect(r.live[0].props.y).toBe(104)   // bar 7 − 3 = bar 4
    expect(r.live[0].props.x).toBe(7)
  })

  it('⭐ `bar_index` read back is the bar it was read on', () => {
    const prog = P({
      ops: [{ k: 'create', family: 'label', site: 's', into: null, when: G(0),
        props: { x: AT({ v: 'bar' }, G(2)), y: { v: 'const', value: 1 } } }],
    })
    assertObjectProgram(prog)
    const r = evaluateObjects(prog, ctxOf(10, { 0: on(10, [8]), 2: Array(10).fill(5) }))
    expect(r.live[0].props.x).toBe(3)
  })

  it('⭐ a bar BEFORE the first bar is `na` — the object exists with an `na` y', () => {
    const prog = labelAt(G(0), G(2))
    const r = evaluateObjects(prog, ctxOf(10, { 0: on(10, [2]), 1: SRC, 2: Array(10).fill(5) }))
    expect(r.status).toBe(OBJECT_STATUS.OK)
    expect(r.live).toHaveLength(1)
    expect(Number.isNaN(r.live[0].props.y)).toBe(true)
  })

  // ⚰️ C29 (C9, measured 2026-09-30, `vw-offset-na-spy-1d-2026-09-30`): an `na`
  // offset used to WITHHOLD the op; TradingView reads the CURRENT bar there.
  it('⭐ an `na` offset reads the CURRENT bar (TradingView: `close[na]` is `close`)', () => {
    const prog = labelAt(G(0), G(2))
    const back = Array(10).fill(NaN)
    back[6] = 1
    const r = evaluateObjects(prog, ctxOf(10, { 0: on(10, [3, 6]), 1: SRC, 2: back }))
    expect(r.status).toBe(OBJECT_STATUS.OK)
    expect(r.live.map((o) => o.props.y)).toEqual([SRC[3], SRC[5]])
    expect(r.stats.withheldUnknown || 0).toBe(0)
  })

  it('⛔⛔ a NEGATIVE offset is a Pine runtime error — nothing is held, not even earlier objects', () => {
    const prog = labelAt(G(0), G(2))
    const back = Array(10).fill(0)
    back[5] = -1
    const r = evaluateObjects(prog, ctxOf(10, { 0: on(10, [1, 5]), 1: SRC, 2: back }))
    expect(r.status).toBe(OBJECT_STATUS.RUNTIME_ERROR)
    expect(r.reason).toContain('bar 5')
    expect(r.live).toEqual([])
    expect(r.counts.label).toBe(0)
  })

  it('⛔⛔ an offset at or past `max_bars_back` is a Pine runtime error', () => {
    const prog = labelAt(G(0), G(2), 4)
    const back = Array(10).fill(4)
    const r = evaluateObjects(prog, ctxOf(10, { 0: on(10, [8]), 1: SRC, 2: back }))
    expect(r.status).toBe(OBJECT_STATUS.RUNTIME_ERROR)
    expect(r.reason).toContain('max_bars_back (4)')
    expect(r.live).toEqual([])
  })

  it('⛔ a FRACTIONAL offset is a Pine runtime error, never rounded', () => {
    const prog = labelAt(G(0), G(2))
    const r = evaluateObjects(prog, ctxOf(10, { 0: on(10, [8]), 1: SRC, 2: Array(10).fill(1.5) }))
    expect(r.status).toBe(OBJECT_STATUS.RUNTIME_ERROR)
  })

  it('CONTROL — an out-of-range offset on a bar the guard SKIPS is nothing at all', () => {
    // Pine evaluates `x[e]` only where the statement runs.
    const prog = labelAt(G(0), G(2))
    const back = Array(10).fill(-7)
    back[9] = 2
    const r = evaluateObjects(prog, ctxOf(10, { 0: on(10, [9]), 1: SRC, 2: back }))
    expect(r.status).toBe(OBJECT_STATUS.OK)
    expect(r.live.map((o) => o.props.y)).toEqual([107])
  })

  it('⛔ the program door refuses a read with no `max_bars_back`', () => {
    const bad = P({
      ops: [{ k: 'create', family: 'label', site: 's', into: null, when: G(0),
        props: { y: { v: 'at', args: [G(1), G(2)] } } }],
    })
    expect(() => assertObjectProgram(bad)).toThrow(/max_bars_back/)
  })
})

// ─── the translator ────────────────────────────────────────────────────────
const NL = String.fromCharCode(10)
const script = (decl, ...lines) => [
  '//@version=5', `indicator("t", overlay = true${decl})`, ...lines].join(NL)
const BODY = [
  'k = ta.valuewhen(close > open, bar_index, 1)',
  'label.new(bar_index, high[bar_index - k], "H")',
]
const translate = (src) => {
  const t = translatePine(src, { strict: true })
  return { ops: (t.objects && t.objects.ops) || [], diag: t.objectDiagnostics || {} }
}
const createY = (ops) => {
  const c = ops.find((o) => o.k === 'create')
  return c ? c.props.y : null
}

describe('the translator emits the read, or names why not', () => {
  it('⭐⭐ `high[bar_index - k]` with `max_bars_back` declared becomes a history read', () => {
    const { ops, diag } = translate(script(', max_bars_back = 5000', ...BODY))
    const y = createY(ops)
    expect(y && y.v).toBe('at')
    expect(y.limit).toBe(5000)
    expect(y.args[0].v).toBe('tree')
    expect(y.args[1].v).toBe('tree')
    expect(diag.historyReads).toBe(1)
  })

  // ⚰️ C29 (C9, measured 2026-09-30, `vw-mbb-auto-spy-1d-2026-09-30`): this
  // REFUSED `no-max-bars-back`. TradingView's automatic buffer was measured to
  // reach 399, so the read is served bounded by `AUTO_MAX_BARS_BACK`, `auto`.
  it('⭐ without `max_bars_back` the read is served on the measured automatic buffer (400, `auto`)', () => {
    const { ops, diag } = translate(script('', ...BODY))
    expect(ops.filter((o) => o.k === 'create').length).toBeGreaterThan(0)
    expect(diag.historyReadRefusals || {}).toEqual({})
    expect(JSON.stringify(ops)).toContain('"limit":400,"auto":true')
  })

  it('⛔ a `max_bars_back = N` in a COMMENT is prose, not a declaration (the automatic buffer applies)', () => {
    const { ops } = translate(script('', '// max_bars_back = 5000', ...BODY))
    expect(JSON.stringify(ops)).toContain('"limit":400,"auto":true')
    expect(JSON.stringify(ops)).not.toContain('"limit":5000')
  })

  it('⛔ the per-series `max_bars_back(x, n)` form refuses by name', () => {
    const { diag } = translate(script(', max_bars_back = 5000', 'max_bars_back(high, 100)', ...BODY))
    expect(diag.historyReadRefusals).toEqual({ 'max-bars-back-call': 1 })
  })

  it('⛔ a REASSIGNED source refuses — its history is its end-of-bar value', () => {
    const { diag } = translate(script(', max_bars_back = 5000',
      'var float s = 0.0', 's := s + 1',
      'k = ta.valuewhen(close > open, bar_index, 1)',
      'label.new(bar_index, s[bar_index - k], "S")'))
    expect(diag.historyReadRefusals).toEqual({ source: 1 })
  })

  it('CONTROL — a CONSTANT offset is still the ordinary offset node, not a history read', () => {
    const { ops, diag } = translate(script(', max_bars_back = 5000',
      'len = input.int(3)', 'label.new(bar_index, high[len], "H")'))
    const y = createY(ops)
    expect(y && y.v).toBe('tree')
    expect(diag.historyReads).toBeUndefined()
  })
})
