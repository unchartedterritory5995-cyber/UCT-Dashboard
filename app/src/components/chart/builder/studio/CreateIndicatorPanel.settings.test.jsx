// THE DOCK'S SETTINGS FIELDS: a built indicator's numbers can be changed by hand.
//
// The fields come from the working indicator's own formula (`authoring/derivedSettings.js`); a
// change is the ordinary slot edit, with no request to the assistant.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react'
import * as registry from '../../engine/nativeRegistry'
import { mergeChartSettings } from '../../chartDefaults'
import { scriptedConverse } from '../../../../testing/createIndicator/scriptedConverse'

vi.mock('../authoring/studioTelemetry', async (orig) => ({ ...(await orig()), logStudioAction: vi.fn() }))

import CreateIndicatorPanel from './CreateIndicatorPanel'

afterEach(() => { cleanup(); registry.clearUserDefinitions() })

function mount(converse = scriptedConverse) {
  const spy = vi.fn(converse)
  const onPreview = vi.fn()
  render(<CreateIndicatorPanel settings={mergeChartSettings({})} onChange={() => {}} sym="AAPL" tf="D"
    onPreview={onPreview} onClose={() => {}} converse={spy} />)
  return { converse: spy, onPreview }
}
async function say(text) {
  fireEvent.change(screen.getByTestId('create-indicator-input'), { target: { value: text } })
  await act(async () => { fireEvent.click(screen.getByTestId('create-indicator-send')) })
  await act(async () => {})
}
const rows = () => screen.queryAllByTestId('studio-setting')
const field = (row) => within(row).getByRole('textbox')
async function type(row, text, key = 'Enter') {
  fireEvent.change(field(row), { target: { value: text } })
  await act(async () => { key === 'blur' ? fireEvent.blur(field(row)) : fireEvent.keyDown(field(row), { key }) })
}

describe('the dock’s settings', () => {
  it('nothing is shown before there is an indicator', () => {
    mount()
    expect(screen.queryByTestId('studio-settings')).toBeNull()
  })

  it('a built indicator shows its length as a field, in plain words', async () => {
    mount()
    await say('Add a 20 EMA')
    expect(rows()).toHaveLength(1)
    expect(rows()[0].getAttribute('data-role')).toBe('length')
    expect(field(rows()[0]).value).toBe('20')
    expect(rows()[0].textContent).toMatch(/EMA 20/)
    expect(screen.getByTestId('studio-settings').textContent).toMatch(/changes this indicator everywhere it is used/)
  })

  it('changing it sends NOTHING to the assistant, redraws the preview, and can be undone', async () => {
    const { converse, onPreview } = mount()
    await say('Add a 20 EMA')
    const calls = converse.mock.calls.length
    const previews = onPreview.mock.calls.length
    await type(rows()[0], '50')
    expect(converse.mock.calls.length, 'a settings change asked the assistant').toBe(calls)
    expect(field(rows()[0]).value).toBe('50')
    expect(rows()[0].textContent).toMatch(/EMA 50/)                       // the caption follows the maths
    expect(onPreview.mock.calls.length).toBeGreaterThan(previews)          // the chart was redrawn
    expect(document.body.textContent).toMatch(/Set EMA 20 length from 20 to 50\./)
    await act(async () => { fireEvent.click(screen.getByTestId('create-indicator-undo')) })
    expect(field(rows()[0]).value).toBe('20')
  })

  it('leaving the field commits too; Escape is left to the window', async () => {
    mount()
    await say('Add a 20 EMA')
    await type(rows()[0], '34', 'blur')
    expect(field(rows()[0]).value).toBe('34')
    // Escape belongs to the surface the field sits in (it closes, or asks first): the field does not
    // commit on it and does not quietly throw the typing away
    fireEvent.change(field(rows()[0]), { target: { value: '99' } })
    await act(async () => { fireEvent.keyDown(field(rows()[0]), { key: 'Escape' }) })
    expect(field(rows()[0]).value).toBe('99')
    expect(rows()[0].textContent).toMatch(/EMA 34/)                      // nothing was committed
  })

  it('a value a length cannot take is refused in words beside the field, and nothing changes', async () => {
    const { onPreview } = mount()
    await say('Add a 20 EMA')
    const previews = onPreview.mock.calls.length
    for (const bad of ['0', '2.5', 'abc', '-4']) {
      await type(rows()[0], bad)
      const alert = within(rows()[0]).getByRole('alert')
      expect(alert.textContent).toMatch(/whole number of at least 1|Enter a number/)
      expect(field(rows()[0]).getAttribute('aria-invalid')).toBe('true')
    }
    expect(onPreview.mock.calls.length).toBe(previews)
    expect(rows()[0].textContent).toMatch(/EMA 20/)
    // typing again clears the refusal
    fireEvent.change(field(rows()[0]), { target: { value: '21' } })
    expect(within(rows()[0]).queryByRole('alert')).toBeNull()
  })

  it('the same value, or an emptied field, is not a change', async () => {
    const { onPreview } = mount()
    await say('Add a 20 EMA')
    const previews = onPreview.mock.calls.length
    await type(rows()[0], '20')
    await type(rows()[0], '   ')
    expect(onPreview.mock.calls.length).toBe(previews)
    expect(field(rows()[0]).value).toBe('20')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('every field has a label a screen reader announces', async () => {
    mount()
    await say('Add a 20 EMA')
    const input = field(rows()[0])
    expect(input.id).toBeTruthy()
    expect(document.querySelector(`label[for="${input.id}"]`).textContent).toMatch(/EMA 20/)
  })
})
