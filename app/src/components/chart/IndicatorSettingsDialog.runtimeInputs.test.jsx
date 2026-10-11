// app/src/components/chart/IndicatorSettingsDialog.runtimeInputs.test.jsx
//
// ⭐ UIE PHASE 2 (M4) — a RUNTIME document's own settings in the ONE settings dialog.
//
// The member door now mints a runtime document that declares its script's `input.*`
// settings (`engine/runtime/runtimeInputs.js`). Nothing here is runtime-specific:
// the dialog that edits every UCT indicator lists them, writes the member's value into
// `indicatorInstances[].inputs` (the persisted settings blob), refuses a value past the
// author's own bound — and the run the chart computes with that blob follows it.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import IndicatorSettingsDialog from './IndicatorSettingsDialog'
import { mergeChartSettings } from './chartDefaults'
import { setIndicatorEnabled, findInstance } from './engine/instanceControls'
import { legacyInstanceId } from './engine/instances'
import * as registry from './engine/nativeRegistry'
import { memberPaneDefinition } from './builder/memberPane/memberPaneDefinition'

const ID = 'u_member-pane-m4dialog'
const SRC = `//@version=5
indicator("M4 dialog")
len = input.int(10, "Length", minval=2, maxval=100)
float s = 0.0
for i = 0 to len - 1
    s += close[i]
plot(s / len)
`
const bars = Array.from({ length: 300 }, (_, i) => {
  const c = 100 + 6 * Math.sin(i / 8)
  return { t: 1600000000 + i * 86400, o: c, h: c + 1, l: c - 1, c, v: 1000 }
})

afterEach(() => { cleanup(); registry.uninstallUserDefinition(ID); vi.unstubAllEnvs() })

function install() {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  const built = memberPaneDefinition({ source: SRC, id: ID })
  expect(built.ok, built.reason).toBe(true)
  expect(built.lane).toBe('runtime')
  registry.installUserDefinitions([built.definition])
  return built
}

function Harness({ initial, instanceId, spy }) {
  const [cs, setCs] = useState(initial)
  return (
    <IndicatorSettingsDialog open instanceId={instanceId} settings={cs} registry={registry}
      onChange={(next) => { setCs(next); spy(next) }} onClose={() => {}} />
  )
}

describe('⭐ a runtime script\'s settings are edited like any indicator\'s', () => {
  it('the dialog lists Length; a new value is persisted on the instance and the run follows it', () => {
    const built = install()
    const initial = setIndicatorEnabled(mergeChartSettings(null), ID, true, registry)
    const instanceId = legacyInstanceId(ID)
    const spy = vi.fn()
    render(<Harness initial={initial} instanceId={instanceId} spy={spy} />)
    const row = screen.getByRole('dialog').querySelector('[data-input-key="len"]')
    expect(row, 'the Length setting is listed').toBeTruthy()
    const box = row.querySelector('input[type="number"]')
    fireEvent.change(box, { target: { value: '30' } })
    fireEvent.blur(box)
    const saved = spy.mock.calls[spy.mock.calls.length - 1][0]
    const inst = findInstance(saved, instanceId)
    expect(inst.inputs.len).toBe(30)
    // the chart computes with exactly that blob (the binder's own call)
    const key = built.rows[0].key
    const ctx = { tf: 'D', newestBarIsForming: false, historyFromListing: true }
    const def = registry.getDefinition(ID)
    const at30 = registry.computeFor(def, bars, inst.inputs, ctx)[key]
    const at10 = registry.computeFor(def, bars, {}, ctx)[key]
    expect(at30).not.toEqual(at10)
    // bar 40: the mean of the last 30 closes, by hand
    let s = 0
    for (let i = 0; i < 30; i += 1) s += bars[40 - i].c
    expect(at30[40]).toBeCloseTo(s / 30, 9)
  })

  it('⛔ a value past the author\'s own bound is not written', () => {
    install()
    const initial = setIndicatorEnabled(mergeChartSettings(null), ID, true, registry)
    const instanceId = legacyInstanceId(ID)
    const spy = vi.fn()
    render(<Harness initial={initial} instanceId={instanceId} spy={spy} />)
    const box = screen.getByRole('dialog').querySelector('[data-input-key="len"] input[type="number"]')
    fireEvent.change(box, { target: { value: '500' } })
    fireEvent.blur(box)
    const last = spy.mock.calls.length ? spy.mock.calls[spy.mock.calls.length - 1][0] : initial
    const v = (findInstance(last, instanceId).inputs || {}).len
    expect(v === undefined || v <= 100).toBe(true)
  })
})

// ⭐⭐ UIE PHASE 3 (M4) — a source and a colour setting, in the same dialog, no new control
const ID2 = 'u_member-pane-m4dialog2'
const SRC2 = `//@version=5
indicator("M4 dialog 2")
src = input.source(close, "Source")
up = input.color(color.green, "Up")
dn = input.color(color.red, "Down")
float s = 0.0
for i = 0 to 4
    s += src[i]
m = s / 5
plot(m, color = m > m[1] ? up : dn)
`
describe('⭐⭐ UIE Phase 3 — source and colour settings', () => {
  afterEach(() => { registry.uninstallUserDefinition(ID2) })
  it('the source is a menu of bar series; picking hl2 is persisted and the run follows; the colours are colour swatches', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    const built = memberPaneDefinition({ source: SRC2, id: ID2 })
    expect(built.ok, built.reason).toBe(true)
    registry.installUserDefinitions([built.definition])
    const initial = setIndicatorEnabled(mergeChartSettings(null), ID2, true, registry)
    const instanceId = legacyInstanceId(ID2)
    const spy = vi.fn()
    render(<Harness initial={initial} instanceId={instanceId} spy={spy} />)
    const dialog = screen.getByRole('dialog')
    const sel = dialog.querySelector('[data-input-key="src"] select')
    expect(sel, 'the Source setting is a menu').toBeTruthy()
    expect([...sel.options].map((o) => o.value)).toEqual(['open', 'high', 'low', 'close', 'hl2', 'hlc3', 'ohlc4', 'hlcc4'])
    fireEvent.change(sel, { target: { value: 'hl2' } })
    const inst = findInstance(spy.mock.calls[spy.mock.calls.length - 1][0], instanceId)
    expect(inst.inputs.src).toBe('hl2')
    const key = built.rows[0].key
    const ctx = { tf: 'D', newestBarIsForming: false, historyFromListing: true }
    const def = registry.getDefinition(ID2)
    const hl2 = registry.computeFor(def, bars, inst.inputs, ctx)[key]
    let s = 0
    for (let i = 0; i < 5; i += 1) s += (bars[40 - i].h + bars[40 - i].l) / 2
    expect(hl2[40]).toBeCloseTo(s / 5, 9)
    for (const k of ['up', 'dn']) {
      const row = dialog.querySelector(`[data-input-key="${k}"]`)
      expect(row, `${k} is listed`).toBeTruthy()
      expect(row.querySelector('input[type="number"], select')).toBeNull()
    }
  })
})
