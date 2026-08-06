import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ChartSettingsModal from './ChartSettingsModal'
import { mergeChartSettings, instanceTombstone } from './chartDefaults'
import { getDefinition, listDefinitions } from './engine/nativeRegistry'
import { CARVED_OUT_ROWS } from './indicatorCatalog'

// ─── THE INDICATORS TAB, END TO END ─────────────────────────────────────────
//
// This tab had NO rendering test at all. It is the surface B3 Task 12 changed
// — the VWAP row's fields are GENERATED from the engine definition now, and its
// writes go through `instanceControls` rather than straight into
// `settings.indicators.vwap` — and both halves of that are only observable
// here, through the real JSX, in the state a user is actually in.
//
// ⚠️ THE STATE THAT MATTERS IS "AN INSTANCE ALREADY EXISTS". With no stored
// instance the old raw writer looked fine, because `migrateLegacyToInstances`
// projects the legacy section on every paint. It SKIPS an instance id it
// already has — so the moment any control door has created `legacy:vwap` (the
// toolbar checkbox, either right-click door, Ctrl or Alt+U), a write to the
// legacy section is read by nobody. Every case below that could pass either way
// is paired with one that cannot.

const base = (extra) => mergeChartSettings(JSON.stringify(extra || {}))
const openIndicators = () => fireEvent.click(screen.getByRole('tab', { name: 'Indicators' }))
const lastCall = (spy) => spy.mock.calls[spy.mock.calls.length - 1][0]
const liveVwap = (cs) => (cs.indicatorInstances || []).find(i => i.defId === 'vwap' && !i.deleted)

const WITH_INSTANCE = {
  indicators: { vwap: { enabled: true, color: '#26C6DA', opacity: 100, lineStyle: 'solid', lineWidth: 1 } },
  indicatorInstances: [{
    instanceId: 'legacy:vwap', defId: 'vwap', hidden: false,
    inputs: { color: '#26C6DA', opacity: 100, lineStyle: 'solid', lineWidth: 1 },
  }],
}

describe('ChartSettingsModal — the Indicators tab renders the generated row', () => {
  it('shows Moving averages, Volume and one section per indicator — from the ROWS', () => {
    render(<ChartSettingsModal open settings={base()} onChange={vi.fn()} />)
    openIndicators()
    // ⚠️ `document.body`, not render()'s container: the modal is PORTALED, so a
    // container query finds nothing and an empty result would read as "no
    // sections" rather than "wrong root".
    const container = document.body
    // A hardcoded section list used to live in this file; a row in a group
    // nobody had listed rendered nothing, silently. Read the SECTION LABELS
    // themselves — "Volume" is also a row label, and a getByText would find that
    // instead and pass whether or not the section exists.
    const labels = [...container.querySelectorAll('[class*="sectionLabel"]')].map(n => n.textContent)
    // ⭐ WIDENED AT B4 TASK 6, AND DERIVED RATHER THAN RETYPED. This read
    // `['Moving averages', 'Volume', 'VWAP']` while VWAP was the only definition
    // with a generated row. Every definition has one now, so the expectation is
    // built from the registry — a section list typed here is the hardcoded group
    // array this very case was written to catch coming back.
    expect(labels).toEqual([
      'Moving averages', 'Volume',
      ...listDefinitions().map(d => d.meta.shortName),
      ...CARVED_OUT_ROWS.map(r => r.shortName),
    ])
    expect(labels.length, 'the section list collapsed — a row in a group nobody listed renders NOTHING')
      .toBeGreaterThan(15)
  })

  it('offers exactly the controls the DEFINITION declares, by its own labels', () => {
    render(<ChartSettingsModal open settings={base(WITH_INSTANCE)} onChange={vi.fn()} />)
    openIndicators()
    // Not a hardcoded list: read the labels off the definition and demand each one.
    for (const input of getDefinition('vwap').inputs) {
      expect(screen.getAllByText(input.label).length, `no control for ${input.key}`).toBeGreaterThan(0)
    }
    // …and the row is titled from the definition's name, not a string typed here.
    expect(screen.getByRole('switch', { name: /Session VWAP/ })).toBeTruthy()
  })
})

describe('ChartSettingsModal — the row is a CONTROL DOOR onto a flipped indicator', () => {
  it('turning VWAP ON writes an INSTANCE, not just the legacy flag', () => {
    const onChange = vi.fn()
    render(<ChartSettingsModal open settings={base()} onChange={onChange} />)
    openIndicators()
    fireEvent.click(screen.getByRole('switch', { name: /Session VWAP/ }))
    const next = lastCall(onChange)
    expect(liveVwap(next), 'the toggle wrote the mirror alone — the chart reads the instance').toBeTruthy()
    expect(next.indicators.vwap.enabled, 'the mirror keeps the alert evaluator alive').toBe(true)
  })

  it('turning VWAP OFF TOMBSTONES it — the mirror alone comes back on the next paint', () => {
    const onChange = vi.fn()
    render(<ChartSettingsModal open settings={base(WITH_INSTANCE)} onChange={onChange} />)
    openIndicators()
    fireEvent.click(screen.getByRole('switch', { name: /Session VWAP/ }))
    const next = lastCall(onChange)
    expect(next.indicators.vwap.enabled).toBe(false)
    expect(next.indicatorInstances.some(i => i.instanceId === 'legacy:vwap' && i.deleted === true)).toBe(true)
  })

  it('⭐ the opacity box reaches the STORED INSTANCE, which a raw section write never did', () => {
    const onChange = vi.fn()
    render(<ChartSettingsModal open settings={base(WITH_INSTANCE)} onChange={onChange} />)
    openIndicators()
    // Found by its LABEL ROW, not by role: the tab renders several unnamed
    // number inputs and `getByRole('spinbutton')` matches all of them.
    const row = screen.getByText('Opacity %').closest('div')
    const box = row.querySelector('input[type="number"]')
    fireEvent.change(box, { target: { value: '40' } })
    const next = lastCall(onChange)
    expect(liveVwap(next).inputs.opacity, 'the opacity write never reached the instance').toBe(40)
    expect(next.indicators.vwap.opacity, 'the legacy mirror stopped being written').toBe(40)
  })

  it('a TOMBSTONED VWAP reads OFF even though the legacy mirror still says on', () => {
    const cs = base({
      indicators: { vwap: { enabled: true } },
      indicatorInstances: [instanceTombstone('legacy:vwap')],
    })
    // ⭐ B5 TASK 9: the divergence the fixture sets up is between the SEEDED
    // instance and the tombstone, because the mirror no longer survives the
    // merge. `base()` folds `indicators.vwap.enabled` — and the tombstone
    // reserves the id, so the fold must NOT seed one, which is the divergence.
    expect(cs.indicators.vwap, 'the mirror survived the fold').toBeUndefined()
    expect(cs.indicatorInstances, 'the fixture does not set up the divergence')
      .toContainEqual(instanceTombstone('legacy:vwap'))
    expect(cs.indicatorInstances.filter(i => i.defId === 'vwap')).toEqual([])
    render(<ChartSettingsModal open settings={cs} onChange={vi.fn()} />)
    openIndicators()
    const toggle = screen.getByRole('switch', { name: /Session VWAP/ })
    expect(toggle.getAttribute('aria-checked'),
      'the row ticked a box over a chart with no line').toBe('false')
  })
})
