// app/src/components/chart/engine/__tests__/hiddenPlotChip.test.js
//
// ─── ⛔⛔ A HIDDEN PLOT IS NOT A PLOT THAT COMPUTED NOTHING ──────────────────
//
// ⚰️ MEASURED ON THE LIVE CHART, the day C1-A shipped. A conditional colour
// rides as a HIDDEN condition column; `planBindings` correctly gives a hidden
// plot no series; and `legendChips` — which read only the INSTANCE's `hidden`
// flag — then found no binding for it and stamped the chip
// `data-computed="false"`. The member saw "no value on these bars — its window
// reaches back further than the history loaded here; try a longer timeframe",
// for a column that was working exactly as designed and was never meant to draw.
// Every dynamically-coloured import showed one.
//
// ⭐ THE RULE: `computed` is ABSENT when nobody looked. That was already this
// module's stated contract for an instance-level hide ("Absent is 'not asked';
// `false` would claim a measurement that never ran") — a plot-level hide means
// exactly the same thing and now answers the same way.
import { describe, it, expect } from 'vitest'
import { legendChips } from '../readout'

const DEF = {
  id: 'u_h', label: 'H',
  plots: [
    { key: 'value', label: 'Value', style: 'line', legend: { decimals: 2 } },
    { key: 'value_c', label: 'Colour rule', style: 'line', hidden: true, legend: { decimals: 0 } },
  ],
}
const registry = (id) => (id === DEF.id ? DEF : null)
const instances = [{ instanceId: 'i1', defId: 'u_h', inputs: {} }]
// Only the VISIBLE plot has a binding — which is exactly what the binder does.
const bindings = [{ instanceId: 'i1', plotKey: 'value' }]

const chipFor = (key, chips) => chips.find((c) => c.plotKey === key)

describe('a hidden PLOT reports as hidden, not as empty', () => {
  const chips = legendChips(bindings, null, registry, instances)

  it('⛔⛔ the hidden plot does NOT claim it computed nothing', () => {
    const c = chipFor('value_c', chips)
    expect(c).toBeTruthy()
    expect(c.hidden).toBe(true)
    // Absent, not false — nobody looked.
    expect('computed' in c).toBe(false)
  })

  it('⭐ the VISIBLE plot still reports honestly — the control', () => {
    // Without this, a change that marked EVERY chip hidden would pass above and
    // silently retire the real "this drew nothing" signal `ctrl-03` depends on.
    const c = chipFor('value', chips)
    expect(c.hidden).toBe(false)
    expect(c.computed).toBe(true)
  })

  it('⛔ and a VISIBLE plot with no binding still says so', () => {
    const orphan = legendChips([], null, registry, instances)
    expect(chipFor('value', orphan).computed).toBe(false)
    expect('computed' in chipFor('value_c', orphan)).toBe(false)
  })

  it('an INSTANCE-level hide behaves identically — one rule, two flags', () => {
    const hiddenInst = legendChips(bindings, null, registry,
      [{ instanceId: 'i1', defId: 'u_h', inputs: {}, hidden: true }])
    for (const c of hiddenInst) {
      expect(c.hidden).toBe(true)
      expect('computed' in c).toBe(false)
    }
  })
})
