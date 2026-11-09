// @vitest-environment node
// app/src/components/chart/builder/memberPane/div4RuntimeReadPaint.test.js
//
// ─── ⭐⭐ DIV-4 — a `barcolor` the host lane withholds for its colour, read from the run ──
//
// The host lane refuses an unbounded `barssince` over a recurrence by name (pine.js,
// "NOT OVER A RECURRENCE"), so `barcolor(b < s ? green : b > s ? red : na)` over two
// such counts is withheld `paint:colour` (SuperTrend STRATEGY's shape). Behind the
// runtime pane's switch the member door now asks the per-bar run for that colour at
// the paint's own statement (`compute.runtimeColours`), and the registry serves the
// column only where the run is exact (`nativeRegistry.js::withRuntimeColours`).
// Pine's reference for the call: `barcolor(color, ...)`, "color (series color) Color
// of bars"; an `na` colour leaves the bar its own colour.
import { describe, it, expect, vi, afterEach } from 'vitest'

import * as registry from '../../engine/nativeRegistry'
import { validateDefinition } from '../../engine/defSchema'
import { memberPaneDefinition } from './memberPaneDefinition'
import { translatePine, PAINT_RUNTIME_COLOUR } from '../../engine/ast/pine'

afterEach(() => { vi.unstubAllEnvs() })

// written for this rail (not corpus text): two counts since a latch flipped
const SRC = `//@version=5
indicator("div4 rail", overlay = true)
len = input.int(3, "Len")
hi = ta.highest(high, len)[1]
lo = ta.lowest(low, len)[1]
var int trend = 1
trend := close > hi ? 1 : close < lo ? -1 : trend
up = trend == 1 and trend[1] == -1
dn = trend == -1 and trend[1] == 1
b = ta.barssince(up)
s = ta.barssince(dn)
plot(ta.sma(close, len), "c")
barcolor(b < s ? color.green : b > s ? color.red : na, title = "bc")
`
const PAINT_LINE = 13

const door = (runtime) => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', runtime ? '1' : '')
  return memberPaneDefinition({ source: SRC, id: 'u_00000000d4a1', name: 'div4' })
}

// deterministic bars with turns both ways
const BARS = Array.from({ length: 80 }, (_, i) => {
  const c = 100 + 12 * Math.sin(i / 5) + (i % 7) * 0.3
  return { t: 1700000000 + i * 86400, o: c - 0.5, h: c + 1, l: c - 1, c, v: 1000 + i }
})

const GREEN = 0x50af4c // packed 0xTTBBGGRR of #4CAF50
const RED = 0x5252ff //   ... of #FF5252

/** Pine, by hand, for SRC at its defaults: the packed colour per bar, NaN for `na`. */
function expected(bars, len = 3) {
  let trend = 1
  const tr = []
  let lastUp = null
  let lastDn = null
  return bars.map((bar, i) => {
    const hi = i >= len ? Math.max(...bars.slice(i - len, i).map((x) => x.h)) : NaN
    const lo = i >= len ? Math.min(...bars.slice(i - len, i).map((x) => x.l)) : NaN
    if (bar.c > hi) trend = 1
    else if (bar.c < lo) trend = -1
    tr.push(trend)
    const prev = i > 0 ? tr[i - 1] : NaN
    if (trend === 1 && prev === -1) lastUp = i
    if (trend === -1 && prev === 1) lastDn = i
    const b = lastUp === null ? NaN : i - lastUp
    const s = lastDn === null ? NaN : i - lastDn
    return b < s ? GREEN : b > s ? RED : NaN
  })
}
const show = (xs) => Array.from(xs, (x) => (Number.isNaN(x) ? 'na' : x))

describe('⭐⭐ DIV-4 — the host lane withholds this colour, and says why', () => {
  it('the translation withholds it `paint:colour`, carrying where the run can read it (non-enumerable)', () => {
    const t = translatePine(SRC, { strict: true })
    const [p] = t.presentation.paints
    expect(p.withheld.code).toBe('paint:colour')
    expect(p[PAINT_RUNTIME_COLOUR]).toMatchObject({ line: PAINT_LINE, column: 1 })
    expect(JSON.stringify(p)).not.toContain('"node"')
    // and no copy of the record (`{...p}`, as readers spread it) carries it either
    expect(Object.getOwnPropertySymbols({ ...p })).toEqual([])
    // ⛔ a bgcolor carries none: its style transparency is not read from a run
    const bg = translatePine(SRC.replace('barcolor(', 'bgcolor('), { strict: true }).presentation.paints[0]
    expect(bg.withheld.code).toBe('paint:colour')
    expect(bg[PAINT_RUNTIME_COLOUR]).toBeUndefined()
  })
  it('⛔ with the runtime pane OFF the document is exactly what it was', () => {
    const d = door(false)
    expect(d.ok, d.reason).toBe(true)
    expect(d.definition.paints).toBeUndefined()
    expect(d.definition.compute.runtimeColours).toBeUndefined()
    expect(d.notes.some((n) => /is not drawn: `barcolor`'s colour/.test(n.note))).toBe(true)
  })
})

describe('⭐⭐ DIV-4 — with the runtime pane on, the colour is read from the run', () => {
  it('the document reads it from a runtime colour column, validates, installs, and says so', () => {
    const d = door(true)
    expect(d.ok, d.reason).toBe(true)
    expect(d.lane).toBeUndefined() // still the host document
    const [paint] = d.definition.paints
    expect(paint).toMatchObject({ kind: 'barcolor', line: PAINT_LINE, title: 'bc', colorMode: 'column:rtcolour1', colorPacked: {} })
    const rc = d.definition.compute.runtimeColours
    expect(rc.keys).toEqual(['rtcolour1'])
    expect(rc.at[0]).toMatchObject({ line: PAINT_LINE, kind: 'colour' })
    expect(d.notes.some((n) => /takes its colour from running the script bar by bar/.test(n.note))).toBe(true)
    expect(validateDefinition(d.definition).errors).toBeUndefined()
    const { installed, errors } = registry.installUserDefinitions([d.definition])
    expect(errors).toEqual([])
    expect(installed).toHaveLength(1)
    registry.uninstallUserDefinition(d.definition.id)
  })

  it("from the listing, at the defaults: the column is Pine's colour on every bar", () => {
    const d = door(true)
    const cols = registry.computeFor(d.definition, BARS, undefined,
      { tf: 'D', symbol: 'AMEX:SPY', historyFromListing: true, newestBarIsForming: false })
    expect(registry.columnErrors(cols).rtcolour1).toBeUndefined()
    const want = expected(BARS)
    // the fixture exercises all three answers
    expect(want.includes(GREEN) && want.includes(RED) && want.some((x) => Number.isNaN(x))).toBe(true)
    expect(show(cols.rtcolour1)).toEqual(show(want))
    expect(cols.value).toBeInstanceOf(Float64Array) // the host column is still there
  })

  it('⛔ off the listing it is NOT served, by name', () => {
    const d = door(true)
    const off = registry.computeFor(d.definition, BARS, undefined, { tf: 'D', symbol: 'AMEX:SPY', newestBarIsForming: false })
    expect(off.rtcolour1).toBeUndefined()
    expect(registry.columnErrors(off).rtcolour1.guard).toBe(registry.RUNTIME_COLOUR_GUARD)
  })

  it('⛔ with the folded `len` edited away from its default it is NOT served', () => {
    const d = door(true)
    const manifest = d.definition.compute.paramManifest || {}
    const pid = Object.keys(manifest).find((k) => manifest[k].default === 3)
    expect(pid).toBeTruthy()
    const edited = JSON.parse(JSON.stringify(d.definition))
    const loc = edited.compute.paramManifest[pid].locators[0]
    let node = loc.treeIndex === null ? edited.compute.ast : edited.compute.trees[loc.treeIndex]
    for (const step of loc.astPath) node = node[step]
    node.value = 5
    const ctx = { tf: 'D', symbol: 'AMEX:SPY', historyFromListing: true, newestBarIsForming: false }
    // control: the unedited document is served on the same bars
    expect(registry.computeFor(d.definition, BARS, undefined, ctx).rtcolour1).toBeInstanceOf(Float64Array)
    const e = registry.computeFor(edited, BARS, undefined, ctx)
    expect(e.rtcolour1).toBeUndefined()
    expect(registry.columnErrors(e).rtcolour1.guard).toBe(registry.RUNTIME_COLOUR_GUARD)
  })
})

describe('⛔ DIV-4 — the schema admits a runtime colour column only as declared', () => {
  const base = () => door(true).definition
  it('a paint naming an undeclared run column is refused', () => {
    const d = base()
    d.compute = { ...d.compute, runtimeColours: { ...d.compute.runtimeColours, keys: ['rtcolourX'] } }
    expect((validateDefinition(d).errors || []).join(' ')).toMatch(/rtcolour1/)
  })
  it('a run column that collides with a plot key is refused', () => {
    const d = base()
    d.compute = { ...d.compute, runtimeColours: { ...d.compute.runtimeColours, keys: ['value'] } }
    expect((validateDefinition(d).errors || []).join(' ')).toMatch(/runtimeColours\.keys\[0\]/)
  })
})
