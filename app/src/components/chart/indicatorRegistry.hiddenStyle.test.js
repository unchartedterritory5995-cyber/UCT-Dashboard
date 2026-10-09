// app/src/components/chart/indicatorRegistry.hiddenStyle.test.js
//
// ⭐ BATCH 2 — a colour rule's hidden index column (`hist_cs`, `hist_c`) is a plot the
// binder never draws, so the Inspector must not offer its colour / width boxes.
import { describe, it, expect } from 'vitest'
import { hiddenPlotOnlyInputKeys, styleInputKeys } from './indicatorRegistry'

const def = {
  plots: [
    { key: 'hist', style: 'histogram', $refs: { color: 'color', lineWidth: 'lineWidth' } },
    { key: 'hist_cs', hidden: true, $refs: { color: 'hist_csColor', lineWidth: 'hist_csWidth' } },
    // a hidden plot that SHARES an input with a drawn one keeps it
    { key: 'shadow', hidden: true, $refs: { color: 'color' } },
  ],
}

describe('hiddenPlotOnlyInputKeys', () => {
  it('names only the inputs that nothing drawn reads', () => {
    expect([...hiddenPlotOnlyInputKeys(def)].sort()).toEqual(['hist_csColor', 'hist_csWidth'])
    expect(styleInputKeys(def).has('hist_csColor')).toBe(true)   // still a style input, just inert
  })

  it('is empty for a definition with no hidden plot, and tolerates junk', () => {
    expect(hiddenPlotOnlyInputKeys({ plots: [def.plots[0]] }).size).toBe(0)
    expect(hiddenPlotOnlyInputKeys(null).size).toBe(0)
    expect(hiddenPlotOnlyInputKeys({ plots: [null, {}] }).size).toBe(0)
  })
})
