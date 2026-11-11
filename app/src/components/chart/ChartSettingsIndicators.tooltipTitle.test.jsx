// app/src/components/chart/ChartSettingsIndicators.tooltipTitle.test.jsx
//
// ─── UCT RS PHASE 2a, UNIT 2a-12 — THE INSPECTOR'S LABEL TITLE (visual review S1)
//     AND ITS DOT SIZE ROW ──────────────────────────────────────────────────
//
// S1: a declared `tooltip` rides the regular input row's label as `title`, so a
// label the Inspector column truncates ("Short-history dots") can still be read on
// hover; a field with no tooltip carries NO `title` (an empty title is a tooltip
// that says nothing). And the one new control: "Dot size" beside Plot style, for a
// definition that draws dots, writing `presentation.dotSize` through
// `setInstanceDotSize` — the writer the dialog's Style tab and the `setDotSize`
// agent op share.
//
// ⛔ Drives the REAL modal, as `ChartSettingsModal.inspector.test.jsx` does, so a
// case cannot pass over a door that is broken. UCT RS is the subject because it is
// the one native definition that declares tooltips at all.
import { useState } from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import ChartSettingsModal from './ChartSettingsModal'
import { mergeChartSettings } from './chartDefaults'
import * as registry from './engine/nativeRegistry'
import { setIndicatorEnabled, findInstance } from './engine/instanceControls'
import { legacyInstanceId } from './engine/instances'
import { fieldsForInstance } from './indicatorRegistry'

afterEach(() => { cleanup() })

/** ⚠️ STATEFUL: the modal is CONTROLLED, so a write is only visible once the new
 *  settings come back in. ⚠️ THE SINK IS A CALLBACK, NOT AN OBJECT PROP — writing
 *  through a prop inside the component trips the immutability lint rule; the
 *  CALLER's closure holds the record instead (the inspector suite's own shape). */
function Host({ initial, onSeen }) {
  const [cs, setCs] = useState(initial)
  return (
    <ChartSettingsModal
      open settings={cs}
      onChange={(next) => { onSeen(next); setCs(next) }}
      onClose={() => {}}
    />
  )
}
const show = (cs) => {
  const seen = { cs }
  render(<Host initial={cs} onSeen={(next) => { seen.cs = next }} />)
  return seen
}
const openTab = () => fireEvent.click(screen.getByRole('tab', { name: /Indicators/i }))
const rows = () => [...document.body.querySelectorAll('[data-structure-row]')]
const nameOf = (r) => (r.querySelector('[class*="insRowName"]')?.textContent || '').trim()
const select = (re) => {
  const row = rows().find((r) => re.test(nameOf(r)))
  if (!row) throw new Error(`no structure row matches ${re}; rows: ${rows().map(nameOf).join(' | ')}`)
  fireEvent.click(row)
}
const inspector = () => document.body.querySelector('[data-inspector-for]')
const labelOf = (key) => inspector().querySelector(`[data-field="${key}"] [class*="insFieldLabel"]`)

const RS = 'rsLine'
/** ⚠️ Anchored, and NOT `/Relative Strength/`: the RSI row is named "Relative Strength Index". */
const RS_ROW = /^UCT/
const withRs = () => setIndicatorEnabled(mergeChartSettings({}), RS, true, registry)

describe('S1 — the regular input row\'s label carries its tooltip as `title`', () => {
  it('⭐ title === tooltip where one is declared; NO title attribute where none is', () => {
    const cs = withRs()
    show(cs); openTab(); select(RS_ROW)
    const def = registry.getDefinition(RS)
    const fields = fieldsForInstance(def, findInstance(cs, legacyInstanceId(RS))).all
    const withTip = fields.filter((f) => f.tooltip)
    const without = fields.filter((f) => !f.tooltip)
    expect(withTip.length).toBeGreaterThan(0)
    expect(without.length).toBeGreaterThan(0)
    let seenTip = 0
    let seenNone = 0
    for (const f of withTip) {
      const el = labelOf(f.key)
      if (!el) continue   // a field the Inspector does not render as an input row is not this rail's claim
      expect(el.getAttribute('title'), f.key).toBe(f.tooltip)
      seenTip += 1
    }
    for (const f of without) {
      const el = labelOf(f.key)
      if (!el) continue
      expect(el.hasAttribute('title'), f.key).toBe(false)
      seenNone += 1
    }
    // ⛔ NON-VACUITY — both halves measured something.
    expect(seenTip, 'no tooltip-bearing field reached the Inspector').toBeGreaterThan(0)
    expect(seenNone, 'no tooltip-less field reached the Inspector').toBeGreaterThan(0)
  })
})

describe('the Dot size row (2a-12)', () => {
  it('⭐ UCT RS shows it under Appearance; choosing Large writes presentation.dotSize and marks the blob custom', () => {
    const cs = withRs()
    const seen = show(cs); openTab(); select(RS_ROW)
    const sel = inspector().querySelector('[data-field="__dotSize__"] select')
    expect(sel).toBeTruthy()
    expect(sel.value).toBe('medium')
    expect([...sel.options].map((o) => o.textContent)).toEqual(['Small', 'Default', 'Large'])
    expect(sel.closest('[data-section="appearance"]')).toBeTruthy()
    fireEvent.change(sel, { target: { value: 'large' } })
    expect(findInstance(seen.cs, legacyInstanceId(RS)).presentation).toEqual({ dotSize: 'large' })
    expect(seen.cs.preset).toBe('custom')
    expect(inspector().querySelector('[data-field="__dotSize__"] select').value).toBe('large')
    // Default deletes the key again
    fireEvent.change(inspector().querySelector('[data-field="__dotSize__"] select'), { target: { value: 'medium' } })
    expect('presentation' in findInstance(seen.cs, legacyInstanceId(RS))).toBe(false)
  })

  it('⛔ a definition with no dot output has no row', () => {
    const cs = setIndicatorEnabled(mergeChartSettings({}), 'rsi', true, registry)
    show(cs); openTab(); select(/^Relative Strength Index/)
    expect(inspector()).toBeTruthy()
    expect(inspector().querySelector('[data-field="__dotSize__"]')).toBeNull()
  })
})
