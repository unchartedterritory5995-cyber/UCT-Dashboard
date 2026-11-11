// app/src/pages/charts/mobile/__tests__/rsVA2Sheet.test.jsx
//
// UCT RS unit VA2 — the PHONE study editor:
//   · the plan's six groups in order, Simple open and the five others folded,
//     with the rating inputs where the plan puts them;
//   · "Save as my default" / "Reset to UCT default" through the same engine
//     writers as the desktop dialog, one `onWrite` each, disabled when a press
//     would change nothing, with the same one-line note;
//   · choosing a preset counts NOTHING: `rs_preset` was retired with the presets (RS split U9).
import { useState } from 'react'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'
import { vi, describe, test, expect, afterEach } from 'vitest'
import MobileIndicatorSheet from '../MobileIndicatorSheet'
import { findInstance, INDICATOR_DEFAULTS_KEY } from '../../../../components/chart/engine/instanceControls'
import { __setRsTelemetrySink } from '../../../../lib/rsTelemetry'

afterEach(() => { cleanup(); __setRsTelemetrySink(null) })

function Harness({ initial, initialEditing, onWrite }) {
  const [cs, setCs] = useState(initial)
  return (
    <MobileIndicatorSheet open onClose={vi.fn()} cs={cs}
      onWrite={(next) => { onWrite(next); setCs(next) }}
      onBrowseLibrary={vi.fn()} onOpenSettings={vi.fn()} initialEditing={initialEditing} />
  )
}
const RS = 'rsLine'
const rsCs = (inputs = {}, extra = {}) => ({ indicatorInstances: [{ instanceId: 'rs-1', defId: RS, inputs, hidden: false }], ...extra })
const rsEditing = { kind: 'study', defId: RS, instanceId: 'rs-1' }
const mount = (cs) => {
  const onWrite = vi.fn()
  render(<Harness initial={cs} initialEditing={rsEditing} onWrite={onWrite} />)
  return onWrite
}
const editor = () => screen.getByRole('dialog', { name: 'UCT Relative Strength settings' })
const heads = () => [...editor().querySelectorAll('[data-group] > button[aria-expanded]')]
const headNamed = (name) => heads().find((b) => b.textContent === name)

describe('the groups', () => {
  test('six groups in the plan\'s order, Simple open, the five others folded', () => {
    mount(rsCs())
    expect(heads().map((b) => b.textContent)).toEqual(['Simple', 'Line', 'New highs', 'Rating', 'Stress test', 'Method'])
    expect(heads().map((b) => b.getAttribute('aria-expanded'))).toEqual(['true', 'false', 'false', 'false', 'false', 'false'])
    expect(editor().querySelector('[data-input-key="showRating"]'), 'RS Rating sits in Simple').not.toBeNull()
    expect(editor().querySelector('[data-input-key="headlineRating"]'), 'folded until Rating opens').toBeNull()
  })
  test('opening Rating shows Headline rating and Rating colours', async () => {
    mount(rsCs())
    await act(async () => { fireEvent.click(headNamed('Rating')) })
    expect(editor().querySelector('[data-input-key="headlineRating"]')).not.toBeNull()
    expect(editor().querySelector('[data-input-key="ratingBands"]')).not.toBeNull()
    // Mansfield view moved to Method in VA2; since 3-08 it is `legacy` (the
    // Reading replaced it). ⭐ 3-14: with nothing declared the Reading is gated off,
    // so the switch still renders in Method, beside the Mansfield length.
    expect(editor().querySelector('[data-input-key="mansfieldLength"]')).toBeNull()
    expect(editor().querySelector('[data-input-key="showMansfield"]')).toBeNull()
    await act(async () => { fireEvent.click(headNamed('Method')) })
    expect(editor().querySelector('[data-input-key="mansfieldLength"]')).not.toBeNull()
    expect(editor().querySelector('[data-input-key="showMansfield"]')).not.toBeNull()
  })
})

describe('Save as my default / Reset to UCT default on the phone', () => {
  const save = () => screen.getByTestId('save-default')
  const reset = () => screen.getByTestId('reset-default')
  const note = () => screen.getByTestId('my-default-note').textContent

  test('a copy at UCT\'s values: both disabled, the note names UCT\'s settings', () => {
    mount(rsCs())
    expect(save().disabled).toBe(true)
    expect(reset().disabled).toBe(true)
    expect(note()).toBe('New copies start with UCT\'s settings.')
  })
  test('Save: one write that carries the default and leaves the copy as it is', async () => {
    const onWrite = mount(rsCs({ benchmark: 'IWM' }))
    await act(async () => { fireEvent.click(save()) })
    expect(onWrite).toHaveBeenCalledTimes(1)
    const next = onWrite.mock.calls[0][0]
    expect(next[INDICATOR_DEFAULTS_KEY]).toEqual({ rsLine: { inputs: { benchmark: 'IWM' } } })
    expect(findInstance(next, 'rs-1').inputs).toEqual({ benchmark: 'IWM' })
    expect(note()).toBe('New copies of this indicator start with these settings.')
    expect(save().disabled).toBe(true)
  })
  test('Reset: one write that forgets the default and puts the copy on UCT\'s values', async () => {
    const onWrite = mount(rsCs({ benchmark: 'IWM' }, { [INDICATOR_DEFAULTS_KEY]: { rsLine: { inputs: { benchmark: 'IWM' } } } }))
    await act(async () => { fireEvent.click(reset()) })
    expect(onWrite).toHaveBeenCalledTimes(1)
    const next = onWrite.mock.calls[0][0]
    expect(INDICATOR_DEFAULTS_KEY in next).toBe(false)
    expect(findInstance(next, 'rs-1').inputs.benchmark).toBe('SPY')
    expect(reset().disabled).toBe(true)
  })
  test('the buttons are tap-sized', () => {
    mount(rsCs({ benchmark: 'IWM' }))
    expect(save().closest('[class*="defaultBtns"]'), 'inside the 44 px button row').not.toBeNull()
  })
})

describe('telemetry', () => {
  // U9: the `rs_preset` count is retired (the slim RS Line has no presets; the server refuses the event).
  // Today's definition still offers the chips; picking one sends no telemetry at all.
  test('choosing a preset sends no telemetry (rs_preset retired, U9)', async () => {
    const sent = []
    __setRsTelemetrySink((e, p) => sent.push([e, p]))
    mount(rsCs())
    const trend = editor().querySelector('[data-preset-id="trend"]')
    expect(trend, 'the preset chip is still on today\'s definition').not.toBeNull()
    await act(async () => { fireEvent.click(trend) })
    expect(sent).toEqual([])
  })
})
