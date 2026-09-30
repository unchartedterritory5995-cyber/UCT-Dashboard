// app/src/components/chart/engine/ast/staleSnapshotRead.test.js
//
// ─── ⛔⛔ C28 — A NAME BOUND BELOW AN UNFOLDABLE WRITE DOES NOT READ THE OLD VALUE ─
//
//     float knnVal = 50.0
//     if kSize >= knnK
//         for …                      ← the fold stops here
//         knnVal := kBull / knnK * 100.0
//     knnIsBull = knnVal >= 60.0
//
// The closing pass condemns `knnVal` (its `:=` was never folded) — but only in
// the FINAL env. `knnIsBull`'s binding carries the env AS IT STOOD where it was
// written, which still held `knnVal = 50.0`, so it read `50 >= 60` on every bar:
// a plot of `knnIsBull ? 1 : 0` drew a flat 0, and the objects pane printed a
// `NEUTRAL` cell. ⚰️ MEASURED on artemis-oscillator-pro (NYSE:RDDT 1D): four
// table cells TradingView does not draw (`◈ NEUTRAL`, `0%`, `29 ▼ BEAR`, `↓-3`
// against its `▼ BEAR`, `80%`, `22 ▼ STRONG BEAR`, `↓-17`) — the vendor rail is
// `vendorHarness.c28StaleSnapshot.test.js`.
//
// ⭐ The rule (`Resolver.staleSnapshotRead`): a historic top-level binding of a
// condemned name is read only by a binding written ABOVE the first write the
// walk could not fold — there it IS Pine's value — and refuses anywhere else.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { translatePine, printFormula } from './pine'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'

const LF = String.fromCharCode(10)
const src = (...lines) => lines.join(LF) + LF

const HEAD = [
  '//@version=6',
  'indicator("stale", overlay = false)',
  'knnK = input.int(5, "K")',
  'var array<float> knnF1 = array.new<float>()',
  'float knnVal = 50.0',
  'pre = knnVal * 2',
  'int kSize = array.size(knnF1)',
  'if kSize >= knnK',
  '    var array<float> kDist = array.new<float>()',
  '    for i = 0 to kSize - 1',
  '        array.push(kDist, math.abs(close - array.get(knnF1, i)))',
  '    knnVal := array.min(kDist)',
  'if bar_index > 1',
  '    array.push(knnF1, close)',
  'knnIsBull = knnVal >= 60.0',
]

/** The script's LAST output — each case below appends exactly one. */
const lastOutput = (source) => {
  const r = translatePine(source, {})
  return r.outputs[r.outputs.length - 1]
}

afterEach(() => { vi.unstubAllEnvs() })

describe('C28 — a snapshot does not see the closing pass', () => {
  it('🔴 a name bound BELOW the unfoldable write refuses with the condemnation\'s own sentence', () => {
    const out = lastOutput(src(...HEAD, 'plot(knnIsBull ? 1 : 0, "kb")'))
    expect(out.refusal, out.ast && printFormula(out.ast)).toBeTruthy()
    expect(out.refusal.guard).toBe('pine:reassign')
    expect(out.refusal.message).toContain('`knnVal`')
  })

  it('⭐ CONTROL — a name bound ABOVE it reads the value it held there (Pine\'s value)', () => {
    const out = lastOutput(src(...HEAD, 'plot(pre, "pre")'))
    expect(out.refusal).toBeFalsy()
    expect(printFormula(out.ast)).toBe('50 * 2')
  })

  it('⭐ CONTROL — a parameter that shares the name is not the condemned binding', () => {
    const out = lastOutput(src(...HEAD,
      'dbl(knnVal) =>',
      '    knnVal * 2',
      'plot(dbl(close), "p")'))
    expect(out.refusal).toBeFalsy()
    expect(printFormula(out.ast)).toBe('close * 2')
  })

  const TABLE = [
    'plot(close)',
    'var table t = table.new(position.top_right, 2, 2)',
    'if barstate.islast',
    '    table.cell(t, 0, 0, knnIsBull ? "BULL" : "NEUTRAL")',
    '    table.cell(t, 1, 0, "K")',
  ]

  it('🔴 the object pass withholds the cell rather than printing the declaration\'s answer', () => {
    const r = translatePine(src(...HEAD, ...TABLE), {})
    const cells = r.objects.ops.filter((o) => o.k === 'cell')
    expect(cells.map((c) => c.props.text.node)).toEqual([{ t: 'lit', s: 'K' }])
    expect(r.objectDiagnostics.dropReasons['cell:text']).toBe(1)
  })

  it('⭐ at the member door the cell is read off the RUN (C18), never off the declaration', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const d = memberPaneDefinition({ source: src(...HEAD, ...TABLE), id: 'u_stale_snapshot', name: 'stale' })
    expect(d.ok, d.reason).toBe(true)
    const { ops, trees } = d.definition.objects
    const bull = ops.find((o) => o.k === 'cell' && o.col.value === 0)
    const cond = bull.props.text.node.cond
    expect(printFormula(trees[cond.tree])).toBe('__uct_runtime_at(0)')
    for (const t of trees) expect(printFormula(t)).not.toContain('50 >= 60')
  })
})
