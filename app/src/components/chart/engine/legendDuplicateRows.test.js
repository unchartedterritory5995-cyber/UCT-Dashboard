// ─── ⭐⭐ TWO COPIES OF ONE INDICATOR: ONE LEGEND ROW EACH (the Fred RS 10-member sweep, 2026-11-18) ──────────────
//
// Measured on production: "Duplicate on chart" on Fred RS gave each copy TWO legend rows — `Fred RS #1 52.19`
// and a valueless `Fred RS` (data-plot-key out2), the same for #2 — four rows for two copies; TradingView shows
// one row a copy. `disambiguateSiblings` numbers only the chips that computed; Fred RS's three averages are `na`
// until switched on, so their label-only chips kept the bare name and `legendRows` (one row per NAME) no longer
// folded them into their copy's row. `readout.withInstanceSuffixes` gives them their instance's suffix.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { memberPaneDefinition } from '../builder/memberPane/memberPaneDefinition'
import { legendChips } from './readout'
import { legendRows } from '../legend/legendRows'

const RS = fs.readFileSync(path.join(path.resolve(process.cwd(), '..'), 'docs/pine/rs-rating/rs-rating-fred6724__pziQwiT2.pine'), 'utf8')
const DEF = memberPaneDefinition({ source: RS, id: 'u_fredrsdup1', name: 'Fred RS' }).definition
const registry = { getDefinition: (id) => (id === DEF.id ? DEF : null) }
const inst = (n) => ({ instanceId: `inst:${DEF.id}:${n}`, defId: DEF.id, inputs: {}, hidden: false })
// the RS line computed on both copies; the averages (out2..out4) computed nothing, as at Fred RS's defaults
const bound = (n, v) => ({ key: `inst:${DEF.id}:${n}::value`, instanceId: `inst:${DEF.id}:${n}`, defId: DEF.id, plotKey: 'value',
  series: { __id: `${DEF.id}/value/${n}` }, lastValue: v })
const rowsOf = (instances, bindings) => legendRows(legendChips(bindings, null, registry, instances)).map((r) => r.chip.label)

describe('Fred RS duplicated: one legend row per copy', () => {
  it('two copies read `Fred RS #1` and `Fred RS #2`, and NO valueless `Fred RS` row is left over', () => {
    const rows = rowsOf([inst(1), inst(2)], [bound(1, 52.19), bound(2, 52.19)])
    expect(rows).toEqual(['Fred RS #1', 'Fred RS #2'])
  })

  it('every chip of a copy carries that copy\'s number (the empty averages included)', () => {
    const chips = legendChips([bound(1, 52.19), bound(2, 52.19)], null, registry, [inst(1), inst(2)])
    for (const c of chips) expect(c.label, `${c.instanceId} ${c.plotKey}`).toBe(c.instanceId.endsWith(':1') ? 'Fred RS #1' : 'Fred RS #2')
  })

  it('CONTROL: one copy is one row, `Fred RS`, unnumbered (nothing to tell apart)', () => {
    expect(rowsOf([inst(1)], [bound(1, 52.19)])).toEqual(['Fred RS'])
  })

  it('CONTROL: a copy whose line computed nothing either stays as it was (no number to borrow)', () => {
    const chips = legendChips([bound(1, 52.19)], null, registry, [inst(1), inst(2)])
    const second = chips.filter((c) => c.instanceId.endsWith(':2'))
    expect(second.length).toBeGreaterThan(0)
    for (const c of second) expect(c.suffix || '').toBe('')
  })
})
