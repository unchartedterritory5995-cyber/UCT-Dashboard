// app/src/components/chart/IndicatorSettingsDialog.timeframeLocked.test.jsx
//
// ⭐ SETTINGS PARITY (timeframe, Engine 77, #1831) — coordinator UI ruling 2026-11-18: while no evidence admits a
// moved timeframe, a runtime script's `input.timeframe` is shown READ-ONLY at its default, with one line saying
// why, never as a control that accepts a choice the run then refuses (`runtime/runtimeInputs.js::
// withTimeframeInputs` -> `locked`, `indicatorRegistry.fieldFromInput` -> `disabled`).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import IndicatorSettingsDialog from './IndicatorSettingsDialog'
import { mergeChartSettings } from './chartDefaults'
import { setIndicatorEnabled } from './engine/instanceControls'
import { legacyInstanceId } from './engine/instances'
import * as registry from './engine/nativeRegistry'
import { memberPaneDefinition } from './builder/memberPane/memberPaneDefinition'
import { TIMEFRAME_LOCKED_SENTENCE } from './engine/runtime/runtimeInputs'

const ID = 'u_member-pane-tflocked'
const SRC = `//@version=5
indicator("TF locked")
tf = input.timeframe("1D", "Alt Timeframe")
len = input.int(10, "Length", minval=2, maxval=100)
float s = 0.0
for i = 0 to len - 1
    s += close[i]
plot(s / len)
bgcolor(ta.change(time(tf)) != 0 ? color.new(color.blue, 90) : na)
`

afterEach(() => { cleanup(); registry.uninstallUserDefinition(ID); vi.unstubAllEnvs() })

describe('a runtime script\'s timeframe setting, while no move is admitted', () => {
  it('is listed at its default, inert, with the one line beside it; Length beside it stays live (CONTROL)', () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    const built = memberPaneDefinition({ source: SRC, id: ID })
    expect(built.ok, built.reason).toBe(true)
    expect(built.lane).toBe('runtime')
    registry.installUserDefinitions([built.definition])
    const settings = setIndicatorEnabled(mergeChartSettings(null), ID, true, registry)
    render(<IndicatorSettingsDialog open instanceId={legacyInstanceId(ID)} settings={settings} registry={registry}
      onChange={() => {}} onClose={() => {}} />)
    const dialog = screen.getByRole('dialog')
    const row = dialog.querySelector('[data-input-key="tf"]')
    expect(row, 'the timeframe setting is listed').toBeTruthy()
    const select = row.querySelector('select')
    expect(select.disabled).toBe(true)
    expect(select.getAttribute('aria-disabled')).toBe('true')
    expect(select.value).toBe('1D')
    expect(row.textContent).toContain(TIMEFRAME_LOCKED_SENTENCE)
    const len = dialog.querySelector('[data-input-key="len"] input[type="number"]')
    expect(len.disabled).toBe(false)
  })
})
