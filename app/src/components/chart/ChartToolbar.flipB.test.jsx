// ─── THE OTHER HALF OF `engineInert`: A CONTROL THAT *CAN* DO SOMETHING ─────
//
// `ChartToolbar.engineInert.test.jsx` proves a row whose indicator the engine
// draws is DISABLED, because nothing there reaches the instance the engine reads.
// Flip B gives it a writer — `instanceControls` — and the moment an id is FLIPPED
// the row has to come back to life, or the honesty fix inverts into a working
// control that looks dead.
//
// ⭐ THE MOCK IS GONE. Task 9 wrote this file with `ENGINE_FLIPPED_DEF_IDS` MOCKED
// to `{rsi}`, because the shipped set was empty and an inertness proof cannot tell
// a machine that is dark from one that does not work. Task 10 flipped `rsi` and
// `bb` for real, so the mock would now UNDER-state the shipped set — and its "bb
// is not flipped" case would have stayed green while its premise became false,
// which is the exact rot this branch keeps finding. Every case below drives the
// REAL constant.
import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthContext } from '../../context/AuthContext'
import ChartToolbar from './ChartToolbar'
import { mergeChartSettings } from './chartDefaults'
import { ENGINE_FLIPPED_DEF_IDS, ENGINE_MIGRATED_DEF_IDS } from './engine/flipState'
import { normalizeInstances } from './engine/instances'
import * as engineRegistry from './engine/nativeRegistry'

const RSI_7 = {
  instanceId: 'legacy:rsi', defId: 'rsi', defVersion: 1,
  inputs: { period: 7, color: '#ff0000' }, placement: { target: 'pane' }, hidden: false,
}
const settingsWith = (over) => mergeChartSettings(JSON.stringify({
  indicators: {
    rsi: { enabled: true, period: 14, color: '#7b68ee' },
    bb: { enabled: true, period: 20, stdDev: 2, color: 'rgba(156,39,176,0.85)' },
    macd: { enabled: true, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
  },
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

describe('the SHIPPED set is the subject — without a non-empty one every case is vacuous', () => {
  it('rsi and bb are flipped; macd is migrated and is not', () => {
    expect(ENGINE_FLIPPED_DEF_IDS.has('rsi')).toBe(true)
    expect(ENGINE_FLIPPED_DEF_IDS.has('bb')).toBe(true)
    expect(ENGINE_MIGRATED_DEF_IDS.has('macd')).toBe(true)
    expect(ENGINE_FLIPPED_DEF_IDS.has('macd'),
      'macd is flipped too — this file needs a different un-flipped subject').toBe(false)
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

  it('⭐ the colour swatch writes both sides — through a REAL click, which now lands', async () => {
    // ⚠️ THIS CASE USED `fireEvent.click`, AND SAID WHY: `user.click` sends a
    // MOUSEDOWN first, and the toolbar's outside-click handler closed the whole
    // settings panel on any mousedown outside `settingsRef` — the ColorPicker
    // popup is PORTALED to `document.body`, so it was "outside" and the panel
    // unmounted before the click landed. **That was a shipped bug, not a harness
    // artifact**, and it is fixed in this same task
    // (`ChartToolbar.colorPicker.test.jsx`). So the click is REAL now: this case
    // exercises the write path AND the reachability that Flip B needs, and a
    // regression in either fails it.
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

    await user.click(cell)

    const next = spy.mock.calls.at(-1)[0]
    expect(live(next).find(i => i.defId === 'rsi').inputs.color).toBe(picked)
    expect(next.indicators.rsi.color).toBe(picked)
  })

  it('the CHECKBOX reads the instance list: a tombstone beats a still-true toggle', async () => {
    // The blob says `enabled: true` — under Flip A that was the switch, and the
    // box would be checked over an indicator the user deleted.
    const user = userEvent.setup()
    mount(settingsWith({ indicatorInstances: [{ instanceId: 'legacy:rsi', deleted: true }] }), vi.fn())
    await openPanel(user)
    expect(within(rowFor('RSI')).getByRole('checkbox').checked).toBe(false)
    expect(within(rowFor('MACD')).getByRole('checkbox').checked, 'macd is not flipped').toBe(true)
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

  it('BB is flipped too: period, std-dev and colour are all live and all write', async () => {
    // The second flipped pilot, and the one whose row carries THREE controls. A
    // `shownInput`/`engineInert` wired to one of them and not the others is a real
    // shape of half-fix.
    const user = userEvent.setup()
    const spy = vi.fn()
    mount(settingsWith({
      indicatorInstances: [{
        instanceId: 'legacy:bb', defId: 'bb', defVersion: 1,
        inputs: { period: 34, stdDev: 3, color: 'rgba(156,39,176,0.85)' },
        placement: { target: 'price' }, hidden: false,
      }],
    }), spy)
    await openPanel(user)
    const row = rowFor('BB')
    const boxes = within(row).getAllByRole('spinbutton')
    expect(boxes.map(b => b.disabled), 'a flipped BB row is still greyed out').toEqual([false, false])
    expect(boxes.map(b => b.value), 'the row shows the blob, not the instance').toEqual(['34', '3'])
    expect(swatch(row).disabled).toBe(false)

    await user.type(boxes[0], '21', { initialSelectionStart: 0, initialSelectionEnd: 9 })
    const next = spy.mock.calls.at(-1)[0]
    expect(live(next).find(i => i.defId === 'bb').inputs.period).toBe(21)
    expect(next.indicators.bb.period).toBe(21)
  })

  it('an UN-FLIPPED migrated definition keeps the Flip-A treatment exactly', async () => {
    // `macd` is drawn by the engine and has no writer yet, so its row must still
    // be disabled with the reason in the tooltip. One flip must not silence — or
    // un-silence — the pilots that have not flipped.
    const user = userEvent.setup()
    const spy = vi.fn()
    mount(settingsWith({
      indicatorInstances: [{
        instanceId: 'legacy:macd', defId: 'macd', defVersion: 2,
        inputs: { fastPeriod: 5, slowPeriod: 35, signalPeriod: 4 },
        placement: { target: 'pane' }, hidden: false,
      }],
    }), spy)
    await openPanel(user)
    const boxes = within(rowFor('MACD')).getAllByRole('spinbutton')
    expect(boxes.map(b => b.disabled)).toEqual([true, true, true])
    expect(boxes[0].getAttribute('title')).toMatch(/Drawn by the indicator engine/)
    expect(boxes.map(b => b.value), 'the inert boxes still show the instance').toEqual(['5', '35', '4'])
    await user.type(boxes[0], '5')
    expect(spy, 'a disabled control wrote settings').not.toHaveBeenCalled()
  })

  it('⭐ the NUMERIC PARSE the legacy branch does is still there for an un-flipped id', async () => {
    // The fall-through branch of `updateIndicator` keeps its `numFields` set —
    // `<input type=number>` hands back a STRING, and a settings blob that stored
    // `"21"` instead of `21` would be a silent type regression in every
    // indicator the engine has not migrated. A flipped id coerces off the
    // DEFINITION instead; both are asserted so neither can quietly become the
    // other.
    const user = userEvent.setup()
    const spy = vi.fn()
    mount(settingsWith(), spy)
    await openPanel(user)
    await user.type(within(rowFor('Stoch')).getAllByRole('spinbutton')[0], '21',
      { initialSelectionStart: 0, initialSelectionEnd: 9 })
    const next = spy.mock.calls.at(-1)[0]
    expect(next.indicators.stoch.kPeriod, 'the numeric parse is gone — the blob stores a string')
      .toBe(21)
    expect(typeof next.indicators.stoch.kPeriod).toBe('number')
  })
})
