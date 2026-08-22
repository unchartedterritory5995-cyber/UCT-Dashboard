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

describe('an inert field says WHY, to a screen reader and not only to a pointer', () => {
  // ⚰️ MEASURED ON PRODUCTION 2026-08-15. Every moving-average row ships `Offset`
  // and `Plot style` disabled — deliberately: `indicatorRegistry.MA_FIELDS` marks
  // them `disabled: NOT_WIRED` ("Coming soon — needs renderer support") because
  // honouring them needs series-level work, and the file's own rule is that
  // "showing them inert is honest; showing them live would silently do nothing".
  //
  // The reason was rendered only as a `title` on the ROW — a hover tooltip. The
  // controls themselves carried a bare `disabled`: no `aria-disabled`, no
  // description. So a mouse user got the sentence and a screen-reader user got
  // "dimmed, no reason". The toggle branch already put the reason on its control;
  // the number and select branches did not.
  //
  // `IndicatorSettingsDialog` states the rule: "`aria-disabled` alongside
  // `disabled` so the reason reaches assistive tech, which a bare `disabled`
  // attribute does not carry."
  const disabledControls = () => [...document.body.querySelectorAll('input,select,button')]
    .filter((e) => e.disabled)

  it('every disabled control carries aria-disabled, the reason, and a resolvable description', () => {
    render(<ChartSettingsModal open settings={base()} onChange={vi.fn()} />)
    openIndicators()

    const dis = disabledControls()
    // ⛔ THE CONTROL. If nothing renders disabled, every assertion below is
    // vacuous — and the MA rows are the reason this test exists.
    expect(dis.length, 'no disabled control rendered — the sweep proves nothing').toBeGreaterThan(4)

    for (const el of dis) {
      const where = `${el.tagName}[${el.getAttribute('aria-describedby') || el.title || '?'}]`
      expect(el.getAttribute('aria-disabled'), `${where}: disabled with no aria-disabled`).toBe('true')
      expect(el.title, `${where}: disabled with no reason on the control`).toBeTruthy()

      const id = el.getAttribute('aria-describedby')
      expect(id, `${where}: no aria-describedby`).toBeTruthy()
      const described = document.getElementById(id)
      expect(described, `${where}: aria-describedby points at nothing`).toBeTruthy()
      expect(described.textContent.trim(), `${where}: the description is empty`).toBe(el.title)
    }
  })

  it('an ENABLED control gets none of it — the reason is not sprayed everywhere', () => {
    render(<ChartSettingsModal open settings={base()} onChange={vi.fn()} />)
    openIndicators()
    const live = [...document.body.querySelectorAll('input,select')].filter((e) => !e.disabled)
    expect(live.length, 'no enabled control rendered').toBeGreaterThan(4)
    for (const el of live) {
      expect(el.getAttribute('aria-disabled'), `${el.tagName} is live but marked aria-disabled`).toBeNull()
    }
  })
})

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
