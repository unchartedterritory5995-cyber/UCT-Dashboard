// app/src/components/chart/IndicatorSettingsDialog.runtimeInputKinds.test.jsx
//
// ⭐⭐ PHASE 3 WS-D — a pasted Pine script's `input.time` and `input.session`, in the ONE settings
// dialog. A time is one date-and-time control read and written in UTC (labelled so); a session is
// a text field that commits only a session. Each writes the member's value into
// `indicatorInstances[].inputs`, and the run the chart computes with that blob follows it.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import IndicatorSettingsDialog, { DEBOUNCE_MS } from './IndicatorSettingsDialog'
import { mergeChartSettings } from './chartDefaults'
import { setIndicatorEnabled, findInstance } from './engine/instanceControls'
import { legacyInstanceId } from './engine/instances'
import { fieldFromInput, timeInputText, timeInputMs } from './indicatorRegistry'
import * as registry from './engine/nativeRegistry'
import { memberPaneDefinition } from './builder/memberPane/memberPaneDefinition'

const ID = 'u_member-pane-wsd-dialog'
const SRC = `//@version=5
indicator("WS-D dialog")
startDate = input.time(timestamp("01 Jan 2021 00:00 +0000"), "Start")
sess = input.session("0930-1600", "Session")
var string seen = ""
seen := sess
plot(time >= startDate and seen == "0930-1600" ? close : 0)
`
afterEach(() => { cleanup(); registry.uninstallUserDefinition(ID); vi.unstubAllEnvs(); vi.useRealTimers() })

function Harness({ initial, instanceId, spy }) {
  const [cs, setCs] = useState(initial)
  return (
    <IndicatorSettingsDialog open instanceId={instanceId} settings={cs} registry={registry}
      onChange={(next) => { setCs(next); spy(next) }} onClose={() => {}} />
  )
}
function open() {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  const built = memberPaneDefinition({ source: SRC, id: ID })
  expect(built.ok, built.reason).toBe(true)
  expect(built.lane).toBe('runtime')
  registry.installUserDefinitions([built.definition])
  const initial = setIndicatorEnabled(mergeChartSettings(null), ID, true, registry)
  const instanceId = legacyInstanceId(ID)
  const spy = vi.fn()
  render(<Harness initial={initial} instanceId={instanceId} spy={spy} />)
  const last = () => (spy.mock.calls.length ? spy.mock.calls[spy.mock.calls.length - 1][0] : initial)
  return { instanceId, spy, last, row: (k) => screen.getByRole('dialog').querySelector(`[data-input-key="${k}"]`) }
}

describe('⭐ the field descriptors', () => {
  it('time → a date-and-time control, session → a session field', () => {
    expect(fieldFromInput({ key: 't', type: 'time', default: 0, label: 'T' })).toEqual({ key: 't', label: 'T', type: 'datetime' })
    expect(fieldFromInput({ key: 's', type: 'session', default: '0930-1600' })).toEqual({ key: 's', label: 's', type: 'session' })
  })
  it('timeInputText / timeInputMs round-trip in UTC; anything else is not a time', () => {
    const ms = Date.UTC(2021, 0, 1, 9, 30)
    expect(timeInputText(ms)).toBe('2021-01-01T09:30')
    expect(timeInputMs('2021-01-01T09:30')).toBe(ms)
    expect(timeInputMs('2021-02-30T09:30')).toBe(null)
    expect(timeInputMs('')).toBe(null)
    expect(timeInputText(1.5)).toBe('')
  })
})

describe('⭐⭐ the dialog edits them like any setting', () => {
  it('the time control shows the author\'s default in UTC; a new date is persisted as UNIX ms', () => {
    vi.useFakeTimers()
    const { instanceId, last, row } = open()
    const r = row('startDate')
    expect(r, 'the Start setting is listed').toBeTruthy()
    expect(r.textContent).toMatch(/UTC/)
    const box = r.querySelector('input[type="datetime-local"]')
    expect(box.value).toBe('2021-01-01T00:00')
    fireEvent.change(box, { target: { value: '2021-06-01T13:30' } })
    act(() => { vi.advanceTimersByTime(DEBOUNCE_MS + 10) })
    expect(findInstance(last(), instanceId).inputs.startDate).toBe(Date.UTC(2021, 5, 1, 13, 30))
  })

  it('the session field commits a session; ⛔ anything else is put back and the row says why', () => {
    const { instanceId, last, row } = open()
    const box = row('sess').querySelector('input[type="text"]')
    expect(box.value).toBe('0930-1600')
    fireEvent.change(box, { target: { value: '9:30 to 4' } })
    fireEvent.blur(box)
    expect((findInstance(last(), instanceId).inputs || {}).sess).toBeUndefined()
    expect(row('sess').textContent).toMatch(/HHMM-HHMM/)
    const box2 = row('sess').querySelector('input[type="text"]')
    fireEvent.change(box2, { target: { value: '0800-1200:23456' } })
    fireEvent.blur(box2)
    expect(findInstance(last(), instanceId).inputs.sess).toBe('0800-1200:23456')
  })
})
