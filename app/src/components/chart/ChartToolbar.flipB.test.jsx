// ─── THE OTHER HALF OF `engineInert`: A CONTROL THAT *CAN* DO SOMETHING ─────
//
// `ChartToolbar.engineInert.test.jsx` proves a row whose indicator the engine
// draws is DISABLED, because under Flip A nothing here reaches the instance the
// engine reads. Flip B gives it a writer — `instanceControls` — and the moment an
// id is FLIPPED the row has to come back to life, or the honesty fix inverts
// into a working control that looks dead.
//
// ⛔ `ENGINE_FLIPPED_DEF_IDS` SHIPS EMPTY, so the branch this file exercises is
// unreachable in production today. That is exactly why the set is MOCKED here:
// an inertness proof cannot tell a machine that is dark from one that does not
// work, and Task 10's flip is only a two-line change if the mechanism it turns on
// has already been driven end to end.
import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthContext } from '../../context/AuthContext'

vi.mock('./engine/flipState', async (importOriginal) => ({
  ...await importOriginal(),
  ENGINE_FLIPPED_DEF_IDS: Object.freeze(new Set(['rsi'])),
}))

const { default: ChartToolbar } = await import('./ChartToolbar')
const { mergeChartSettings } = await import('./chartDefaults')
const { ENGINE_FLIPPED_DEF_IDS } = await import('./engine/flipState')
const { normalizeInstances } = await import('./engine/instances')
const engineRegistry = await import('./engine/nativeRegistry')

const RSI_7 = {
  instanceId: 'legacy:rsi', defId: 'rsi', defVersion: 1,
  inputs: { period: 7, color: '#ff0000' }, placement: { target: 'pane' }, hidden: false,
}
const settingsWith = (over) => mergeChartSettings(JSON.stringify({
  indicators: { rsi: { enabled: true, period: 14, color: '#7b68ee' }, bb: { enabled: true } },
  engineEnabled: true,
  ...over,
}))

/**
 * ⚠️ STATEFUL ON PURPOSE. The panel's inputs are CONTROLLED — they render the
 * value the settings blob currently holds. A mount whose `onUpdateSettings` only
 * records leaves the box showing the OLD value, so a second keystroke appends to
 * it and `clear(); type('9')` reads back `79`. That is the harness lying, not the
 * writer, and it hides the round trip these cases are actually about: the blob
 * the writer returns has to render back into a box the user can keep typing in.
 */
function mount(settings, onUpdateSettings) {
  function Harness() {
    const [cs, setCs] = useState(settings)
    return (
      <AuthContext.Provider value={{ isPaid: true, user: null, loading: false }}>
        <ChartToolbar activeTool="cursor" setActiveTool={() => {}}
          chartSettings={cs}
          onUpdateSettings={(next) => { onUpdateSettings(next); setCs(next) }} />
      </AuthContext.Provider>
    )
  }
  return render(<Harness />)
}
const openPanel = (user) => user.click(screen.getByTitle('Chart Settings'))
const rowFor = (label) => screen.getByText(label, { selector: 'span' }).parentElement
const periodBox = (row) => within(row).getAllByRole('spinbutton')[0]
const swatch = (row) => within(row).getAllByRole('button').at(-1)
const live = (cs) => normalizeInstances(cs.indicatorInstances, engineRegistry).kept

describe('the mock is the subject — without a non-empty set every case here is vacuous', () => {
  it('rsi is flipped and bb is not', () => {
    expect(ENGINE_FLIPPED_DEF_IDS.has('rsi')).toBe(true)
    expect(ENGINE_FLIPPED_DEF_IDS.has('bb')).toBe(false)
  })
})

describe('ChartToolbar — a FLIPPED row writes the instance, and stops being inert', () => {
  it('the period box is live again, and says nothing about an engine', async () => {
    const user = userEvent.setup()
    mount(settingsWith({ indicatorInstances: [RSI_7] }), vi.fn())
    await openPanel(user)
    const row = rowFor('RSI')
    expect(periodBox(row).disabled, 'a row with a writer is still greyed out').toBe(false)
    expect(periodBox(row).getAttribute('title')).toBe('Period')
    expect(swatch(row).disabled).toBe(false)
    // …and it still shows the INSTANCE's value, which is now the value it SETS.
    expect(periodBox(row).value).toBe('7')
  })

  it('typing a period writes the INSTANCE and the legacy MIRROR, in one blob', async () => {
    const user = userEvent.setup()
    const spy = vi.fn()
    mount(settingsWith({ indicatorInstances: [RSI_7] }), spy)
    await openPanel(user)
    // `<input type=number>` hands back a string; the writer coerces it off the
    // DEFINITION's declared type, not off a hand-maintained field list.
    // Select the existing digit and replace it. `clear()` first is a trap: an
    // empty box is a value `setIndicatorInput` REFUSES, so the write never lands,
    // the controlled input re-renders with the old value, and the next keystroke
    // APPENDS to it — the harness reads `79` and blames the writer.
    await user.type(periodBox(rowFor('RSI')), '9', { initialSelectionStart: 0, initialSelectionEnd: 9 })
    const next = spy.mock.calls.at(-1)[0]
    expect(live(next).find(i => i.defId === 'rsi').inputs.period).toBe(9)
    expect(next.indicators.rsi.period, 'the alert evaluator reads this section').toBe(9)
  })

  it('a value the definition would REFUSE writes nothing at all', async () => {
    // `period` is an int 2..100. Storing 500 makes an instance `normalizeInstances`
    // drops — the indicator would silently vanish on the next paint. A refused
    // write must not persist a half-blob either.
    const user = userEvent.setup()
    const spy = vi.fn()
    mount(settingsWith({ indicatorInstances: [RSI_7] }), spy)
    await openPanel(user)
    await user.type(periodBox(rowFor('RSI')), '500', { initialSelectionStart: 0, initialSelectionEnd: 9 })
    expect(periodBox(rowFor('RSI')).value,
      'the box never reached an out-of-range value — this case is vacuous').not.toBe('500')
    for (const [blob] of spy.mock.calls) {
      const inst = live(blob).find(i => i.defId === 'rsi')
      expect(inst, 'a refused write dropped the instance').toBeTruthy()
      expect(inst.inputs.period).toBeLessThanOrEqual(100)
    }
  })

  it('the colour swatch writes both sides too', async () => {
    const user = userEvent.setup()
    const spy = vi.fn()
    mount(settingsWith({ indicatorInstances: [RSI_7] }), spy)
    await openPanel(user)
    await user.click(swatch(rowFor('RSI')))
    // The picker's preset cells carry their colour as the title. Reading the
    // colour off the control rather than hardcoding one keeps the case alive if
    // the palette changes — and the search is scoped to the PORTALED popup,
    // because every other row's swatch button carries a hex title too.
    const popup = screen.getByPlaceholderText('#hex').closest('div').parentElement
    const cell = within(popup).getAllByTitle(/^#[0-9a-f]{6}$/i)[1]
    const picked = cell.getAttribute('title')
    expect(picked, 'the picker never opened').toBeTruthy()
    // ⚠️ `fireEvent.click`, DELIBERATELY, and not the trap the sibling suite
    // warns about (that one is about bypassing `disabled`; this control is
    // enabled and the event is real). `user.click` sends a MOUSEDOWN first, and
    // `ChartToolbar`'s outside-click handler (`:1000`) closes the whole settings
    // panel on any mousedown outside `settingsRef` — the ColorPicker popup is
    // PORTALED to `document.body`, so it is "outside". The panel unmounts before
    // the click lands. **That is a pre-existing bug in the shipped toolbar, not
    // an artifact of this suite** — see the Task 9 report — and it is left alone
    // here because this task's gate is that nothing changes. What is under test
    // is the WRITE PATH the picker feeds, so the click is dispatched at it
    // directly.
    fireEvent.click(cell)
    const next = spy.mock.calls.at(-1)[0]
    expect(live(next).find(i => i.defId === 'rsi').inputs.color).toBe(picked)
    expect(next.indicators.rsi.color).toBe(picked)
  })

  it('the CHECKBOX reads the instance list: a tombstone beats a still-true toggle', async () => {
    // The blob says `enabled: true` — under Flip A that is the switch, and the box
    // would be checked over an indicator the user deleted.
    const user = userEvent.setup()
    mount(settingsWith({ indicatorInstances: [{ instanceId: 'legacy:rsi', deleted: true }] }), vi.fn())
    await openPanel(user)
    expect(within(rowFor('RSI')).getByRole('checkbox').checked).toBe(false)
    expect(within(rowFor('BB')).getByRole('checkbox').checked, 'bb is not flipped').toBe(true)
  })

  it('unchecking it writes a TOMBSTONE and clears the mirror', async () => {
    const user = userEvent.setup()
    const spy = vi.fn()
    mount(settingsWith({ indicatorInstances: [RSI_7] }), spy)
    await openPanel(user)
    await user.click(within(rowFor('RSI')).getByRole('checkbox'))
    const next = spy.mock.calls.at(-1)[0]
    expect(next.indicatorInstances).toContainEqual({ instanceId: 'legacy:rsi', deleted: true })
    expect(live(next).filter(i => i.defId === 'rsi')).toEqual([])
    expect(next.indicators.rsi.enabled, 'the mirror still says the indicator is on').toBe(false)
  })

  it('an UN-FLIPPED migrated definition keeps the Flip-A treatment exactly', async () => {
    // `bb` is drawn by the engine and has no writer yet, so its row must still be
    // disabled with the reason in the tooltip. One flip must not silence — or
    // un-silence — the other three pilots.
    const user = userEvent.setup()
    const spy = vi.fn()
    mount(settingsWith({
      indicators: { rsi: { enabled: true }, bb: { enabled: true, period: 20, stdDev: 2 } },
      indicatorInstances: [{
        instanceId: 'legacy:bb', defId: 'bb', defVersion: 1,
        inputs: { period: 34 }, placement: { target: 'price' }, hidden: false,
      }],
    }), spy)
    await openPanel(user)
    const row = rowFor('BB')
    expect(periodBox(row).disabled).toBe(true)
    expect(periodBox(row).getAttribute('title')).toMatch(/Drawn by the indicator engine/)
    expect(periodBox(row).value, 'the inert box still shows the instance').toBe('34')
    await user.type(periodBox(row), '5')
    expect(spy, 'a disabled control wrote settings').not.toHaveBeenCalled()
  })
})
