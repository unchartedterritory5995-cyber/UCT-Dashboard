// app/src/components/chart/builder/memberPane/runtimeProductWorkflow.test.jsx
//
// ⭐⭐⭐ UIE PHASE 4 (M4) — AN ADVANCED (RUNTIME-LANE) INDICATOR'S WHOLE LIFECYCLE, THROUGH
// THE REAL UCT COMPONENTS: import (the member door, `MemberPane`), preview (what the pane
// is handed), customize (`IndicatorSettingsDialog`), save (the document `onAttach` is
// handed, through JSON — the store's wire), reload (a fresh install of the stored
// document and the stored settings blob), edit (a setting changed after reload; the
// formula editor's refusal of a script document), reuse (a second chart's instance,
// independent of the first) and a timeframe switch.
//
// ⚠️ THE CEILING: `ChartPane` is mocked (as in `MemberPane.test.jsx`) — what the pane is
// HANDED is asserted, never pixels. The runtime flags are set for THIS test file only
// (`vi.stubEnv` / `import.meta.env`, restored after), never in a shared environment. The
// server's admission of runtime documents is the Python round trip's
// (`tests/test_runtime_document_round_trip.py`), not this file's.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import * as registry from '../../engine/nativeRegistry'
import { MEMBER_PANE_DEF_PREFIX } from './memberPaneDefinition'
import IndicatorSettingsDialog from '../../IndicatorSettingsDialog'
import { mergeChartSettings } from '../../chartDefaults'
import { addInstance, findInstance } from '../../engine/instanceControls'

const paneProps = []
vi.mock('../../pane/ChartPane', () => ({
  default: (props) => { paneProps.push(props); return <div data-testid="mock-chart-pane" /> },
}))

const SRC = `//@version=5
indicator("Lifecycle", overlay = false)
len = input.int(10, "Length", minval = 2, maxval = 50)
src = input.source(close, "Source")
up = input.color(color.green, "Up")
dn = input.color(color.red, "Down")
float s = 0.0
for i = 0 to len - 1
    s += src[i]
m = s / len
plot(m, "Mean", color = m > m[1] ? up : dn)
`
const day = (n, t0 = 1600000000, step = 86400) => Array.from({ length: n }, (_, i) => {
  const c = 100 + 6 * Math.sin(i / 8) + 2 * Math.sin(i / 3)
  return { t: t0 + i * step, o: c - 0.5, h: c + 1, l: c - 1, c, v: 1000 }
})
const DAILY = day(400)
const FIVE = day(2000, 1700000000, 300)
const D = { tf: 'D', newestBarIsForming: false, historyFromListing: true }

const flagsOn = () => {
  vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  import.meta.env.VITE_PINE_MEMBER_PANE_ENABLED = '1'
}
afterEach(() => {
  cleanup()
  delete import.meta.env.VITE_PINE_MEMBER_PANE_ENABLED
  vi.unstubAllEnvs()
  for (const d of registry.listUserDefinitions()) registry.uninstallUserDefinition(d.id)
  paneProps.length = 0
})

/** Workflow A + B: import through the real pane; returns the document `onAttach` saved. */
async function importAndSave() {
  flagsOn()
  const { default: MemberPane } = await import('./MemberPane.jsx')
  const saved = []
  const onAttach = async (definition) => { saved.push(JSON.parse(JSON.stringify(definition))); return { ok: true } }
  render(<MemberPane sym="SPY" tf="D" source={SRC} onAttach={onAttach} />)
  return { saved, MemberPane }
}

describe('⭐⭐ Workflow A/B — import and preview', () => {
  it('the door mints a runtime document with the script\'s settings; the preview pane holds it and nothing else', async () => {
    await importAndSave()
    expect(screen.getByTestId('pine-member-pane')).toBeTruthy()
    const def = registry.getDefinition(MEMBER_PANE_DEF_PREFIX)
    expect(def.compute.kind).toBe('runtime')
    const keys = def.inputs.map((i) => i.key)
    for (const k of ['len', 'src', 'up', 'dn']) expect(keys).toContain(k)
    expect(def.placement.target).toBe('pane')
    const handed = paneProps[paneProps.length - 1]
    const inst = (handed.stored.indicatorInstances || []).map((i) => i.defId)
    expect(inst).toEqual([MEMBER_PANE_DEF_PREFIX])
    // preview computes the same columns the chart will (the binder's own call)
    const cols = registry.computeFor(def, DAILY, undefined, D)
    expect(cols[def.plots[0].key].slice(20).every(Number.isFinite)).toBe(true)
  })

  it('⛔ an unsupported script shows its reason, and nothing is installed', async () => {
    flagsOn()
    const { default: MemberPane } = await import('./MemberPane.jsx')
    render(<MemberPane sym="SPY" tf="D" source={'//@version=6\nindicator("x")\nplot(request.security(syminfo.tickerid, "45", close))\n'} />)
    expect(screen.getByTestId('pine-member-pane-refusal').textContent.length).toBeGreaterThan(10)
    expect(registry.listUserDefinitions().map((d) => d.id)).not.toContain(MEMBER_PANE_DEF_PREFIX)
  })
})

describe('⭐⭐ Workflow C/D/E — save, reload, customize, edit, reuse, switch timeframe', () => {
  function Dialog({ initial, instanceId, spy }) {
    const [cs, setCs] = useState(initial)
    return <IndicatorSettingsDialog open instanceId={instanceId} settings={cs} registry={registry}
      onChange={(next) => { setCs(next); spy(next) }} onClose={() => {}} />
  }

  it('the whole lifecycle', async () => {
    const { saved } = await importAndSave()
    // ── SAVE: the pane hands the document to the store ──
    await act(async () => { fireEvent.click(screen.getByTestId('pine-member-pane-attach').querySelector('button')) })
    expect(saved).toHaveLength(1)
    cleanup()   // the preview unmounts and uninstalls its own entry
    expect(registry.getDefinition(MEMBER_PANE_DEF_PREFIX)).toBeFalsy()

    // ── RELOAD: the stored document under its stored id, the member's chart settings ──
    const stored = { ...saved[0], id: 'u_member-pane-lifecycle' }
    const { installed, errors } = registry.installUserDefinitions([JSON.parse(JSON.stringify(stored))])
    expect(errors).toEqual([])
    const def = installed[0]
    const key = def.plots[0].key
    let chartA = addInstance(mergeChartSettings(null), def.id, registry)
    const instA = chartA.indicatorInstances.find((i) => i.defId === def.id)
    const before = registry.computeFor(def, DAILY, instA.inputs, D)[key]

    // ── CUSTOMIZE: the ONE settings dialog lists the script's settings and writes the blob ──
    const spy = vi.fn()
    flagsOn()
    render(<Dialog initial={chartA} instanceId={instA.instanceId} spy={spy} />)
    const dialog = screen.getByRole('dialog')
    for (const k of ['len', 'src', 'up', 'dn']) expect(dialog.querySelector(`[data-input-key="${k}"]`), k).toBeTruthy()
    const box = dialog.querySelector('[data-input-key="len"] input[type="number"]')
    fireEvent.change(box, { target: { value: '20' } })
    fireEvent.blur(box)
    fireEvent.change(dialog.querySelector('[data-input-key="src"] select'), { target: { value: 'hl2' } })
    chartA = spy.mock.calls[spy.mock.calls.length - 1][0]
    const editedA = findInstance(chartA, instA.instanceId)
    expect(editedA.inputs).toMatchObject({ len: 20, src: 'hl2' })
    const after = registry.computeFor(def, DAILY, editedA.inputs, D)[key]
    expect(after).not.toEqual(before)
    let s = 0
    for (let i = 0; i < 20; i += 1) s += (DAILY[100 - i].h + DAILY[100 - i].l) / 2
    expect(after[100]).toBeCloseTo(s / 20, 9)
    // invalid: past the author's bound is not written
    fireEvent.change(box, { target: { value: '500' } })
    fireEvent.blur(box)
    const last = spy.mock.calls[spy.mock.calls.length - 1][0]
    expect(findInstance(last, instA.instanceId).inputs.len).toBeLessThanOrEqual(50)
    cleanup()

    // ── RELOAD AGAIN: settings blob and document through JSON — the same output ──
    registry.uninstallUserDefinition(def.id)
    const { installed: again } = registry.installUserDefinitions([JSON.parse(JSON.stringify(stored))])
    const reopened = findInstance(JSON.parse(JSON.stringify(chartA)), instA.instanceId)
    expect(registry.computeFor(again[0], DAILY, reopened.inputs, D)[key]).toEqual(after)

    // ── EDIT: a setting changed after reload follows; the source editor refuses a script by name ──
    const edited = registry.computeFor(again[0], DAILY, { ...reopened.inputs, len: 5 }, D)[key]
    expect(edited).not.toEqual(after)

    // ── REUSE: a second chart gets its own instance, its own settings ──
    const chartB = addInstance(mergeChartSettings(null), again[0].id, registry)
    const instB = chartB.indicatorInstances.find((i) => i.defId === again[0].id)
    expect(instB.instanceId).toBeTruthy()
    expect(registry.computeFor(again[0], DAILY, instB.inputs, D)[key]).toEqual(before)
    expect(findInstance(chartA, instA.instanceId).inputs.len).toBe(20)

    // ── TIMEFRAME: the same instance on a 5-minute chart computes over those bars ──
    const five = registry.computeFor(again[0], FIVE, reopened.inputs, { tf: '5', newestBarIsForming: false })[key]
    expect(five).toHaveLength(FIVE.length)
    let s5 = 0
    for (let i = 0; i < 20; i += 1) s5 += (FIVE[1500 - i].h + FIVE[1500 - i].l) / 2
    expect(five[1500]).toBeCloseTo(s5 / 20, 9)
  })
})
