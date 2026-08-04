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
  it('all four pilots are flipped, and the migrated set has nothing else in it', () => {
    // ⚠️ THE SECOND HALF OF THIS CASE INVERTED AT TASK 11. It used to assert
    // `macd` was migrated and NOT flipped, because the file needed an un-flipped
    // subject for its Flip-A-treatment case. That case is gone with its subject
    // (see below), and what the file needs now is the opposite guarantee: if a
    // definition is ever migrated WITHOUT being flipped, `engineInert` goes live
    // again and this file's "a migrated row is a live writer" premise is false.
    for (const id of ['rsi', 'bb', 'macd', 'vwap']) {
      expect(ENGINE_FLIPPED_DEF_IDS.has(id), id).toBe(true)
    }
    expect([...ENGINE_MIGRATED_DEF_IDS].filter(id => !ENGINE_FLIPPED_DEF_IDS.has(id)),
      'a migrated definition is not flipped — its row is INERT again, and this file '
      + 'asserts every migrated row is a live writer').toEqual([])
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
    // ⚠️ MACD IS FLIPPED TOO (Task 11) — this used to say "macd is not flipped"
    // and pass for that reason. It still passes, for a DIFFERENT one, and a green
    // assertion with a false stated reason is the rot this branch keeps finding:
    // MACD has a true toggle and NO instance of its own here, so
    // `isIndicatorEnabled` projects it. The claim is that RSI's tombstone is
    // per-DEFINITION and does not reach its neighbour.
    expect(within(rowFor('MACD')).getByRole('checkbox').checked,
      'RSI\'s tombstone unchecked MACD too — the read is not per definition').toBe(true)
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

  it('MACD\u2019s THREE boxes are all live, and each writes the input it names', async () => {
    // ⚠️ THIS CASE WAS INVERTED BY TASK 11. It read "an UN-FLIPPED migrated
    // definition keeps the Flip-A treatment exactly" and asserted MACD's three
    // boxes were DISABLED with the engine tooltip. MACD is flipped now, so that
    // assertion is the opposite of the truth — the fourth time a case in this
    // family has had its subject migrated out from under it, which is why the
    // describe above asserts the sets are EQUAL rather than naming a survivor.
    //
    // MACD is the only pilot with THREE fields on one instance, so "the row is
    // live" is not the whole claim: each box has to write ITS OWN input. A writer
    // keyed on the ROW rather than the FIELD would move `fastPeriod` when the user
    // typed in the signal box, and all three boxes would still look live.
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
    expect(boxes.map(b => b.disabled), 'a row with a writer is still greyed out')
      .toEqual([false, false, false])
    expect(boxes[0].getAttribute('title')).toBe('Fast')
    expect(boxes.map(b => b.value), 'the boxes must show the INSTANCE').toEqual(['5', '35', '4'])

    await user.type(boxes[2], '7', { initialSelectionStart: 0, initialSelectionEnd: 9 })
    const next = spy.mock.calls.at(-1)[0]
    const inst = live(next).find(i => i.defId === 'macd')
    expect(inst.inputs.signalPeriod, 'the signal box wrote nothing').toBe(7)
    expect(inst.inputs.fastPeriod, 'typing in the signal box moved the FAST period').toBe(5)
    expect(inst.inputs.slowPeriod).toBe(35)
    expect(next.indicators.macd.signalPeriod, 'the alert evaluator reads this section').toBe(7)
  })

  it('VWAP\u2019s swatch is live too, and writes the instance\u2019s colour', async () => {
    // VWAP's only toolbar control is the swatch — its opacity / style / width live
    // on the settings page — so this is the whole toolbar surface for it, and it
    // was `engineInert`'s last subject before the flip.
    const user = userEvent.setup()
    const spy = vi.fn()
    mount(settingsWith({
      indicators: { vwap: { enabled: true, color: '#26C6DA' } },
      indicatorInstances: [{
        instanceId: 'legacy:vwap', defId: 'vwap', defVersion: 1,
        inputs: { color: '#ff0000' }, placement: { target: 'price' }, hidden: false,
      }],
    }), spy)
    await openPanel(user)
    const box = swatch(rowFor('VWAP'))
    expect(box.disabled, 'a row with a writer is still greyed out').toBe(false)
    expect(box.style.background, 'the swatch must show the INSTANCE').toBe('rgb(255, 0, 0)')
    await user.click(box)
    const hex = screen.getByPlaceholderText('#hex')
    await user.clear(hex)
    await user.type(hex, '#00ff00{Enter}')
    const next = spy.mock.calls.at(-1)[0]
    expect(live(next).find(i => i.defId === 'vwap').inputs.color).toBe('#00ff00')
    expect(next.indicators.vwap.color, 'the mirror was not written').toBe('#00ff00')
  })

  it('⭐ the NUMERIC PARSE the legacy branch does is still there for a NON-MIGRATED id', async () => {
    // The fall-through branch of `updateIndicator` keeps its `numFields` set —
    // `<input type=number>` hands back a STRING, and a settings blob that stored
    // `"21"` instead of `21` would be a silent type regression in every
    // indicator the engine has not migrated. A flipped id coerces off the
    // DEFINITION instead; both are asserted so neither can quietly become the
    // other. ⚠️ The subject was already Stoch, which is NOT migrated, so Task 11
    // moved only the title — but the title mattered: "un-flipped" now names an
    // EMPTY set, and a case named for one reads as vacuous.
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

// ═══════════════════════════════════════════════════════════════════════════
// ─── B4 TASK 3: THE VOLUME-OVERLAY STRIP READS THE CATALOG ────────────────
//
// `const OSC = [['rsi','RSI'], … ['williamsR','W%R'], …]` was a SECOND copy of
// `StockChart`'s `OSC_OPTS`, in another file, spelling `williamsR` a third way.
// Both strips now derive from `oscillatorIds()` + `labelFor()`, so they cannot
// drift — and the derivation is on `placement.target`, which is what
// `resolvePlacement` reads, so the menu, this strip and the RENDERER agree by
// construction rather than by three people remembering.
describe('ChartToolbar — the volume-overlay strip is derived, not a second OSC list', () => {
  const withVolumeOverlaySubjects = () => mergeChartSettings(JSON.stringify({
    volume: { visible: true },
    indicators: {
      williamsR: { enabled: true },   // a PANE oscillator, and the A7 relabel
      rsi: { enabled: true },         // a PANE oscillator, and FLIPPED
      bb: { enabled: true },          // a PRICE overlay — must never be offered
      atr: { enabled: false },        // an oscillator that is OFF
    },
  }))

  /** The strip's checkboxes, read off the one row that carries its heading. */
  const stripLabels = () => {
    const heading = screen.getByText('Overlay on volume pane:')
    const row = heading.parentElement
    return within(row).getAllByRole('checkbox').map(cb => cb.parentElement.textContent.trim())
  }

  it('offers every ENABLED pane oscillator, under the catalog label', async () => {
    const user = userEvent.setup()
    mount(withVolumeOverlaySubjects(), vi.fn())
    await openPanel(user)
    // Registry order, which is what `oscillatorIds()` returns.
    expect(stripLabels()).toEqual(['RSI', '%R'])
    // ⭐ `%R`, not `W%R`: adjudication A7's cell, on the surface a user reads.
    expect(stripLabels()).not.toContain('W%R')
  })

  it('⛔ never offers a PRICE overlay, however enabled it is', async () => {
    const user = userEvent.setup()
    mount(withVolumeOverlaySubjects(), vi.fn())
    await openPanel(user)
    // `bb` is ON and shares the CANDLES' scale — it cannot be moved into the
    // volume pane, and `instances.test.js`'s "the toolbar cannot produce that"
    // rests on exactly this. That guarantee used to be a hand-written list
    // omitting it; it is now `placement.target !== 'pane'`.
    expect(stripLabels()).not.toContain('BB')
    expect(stripLabels()).not.toContain('Bollinger Bands')
  })

  it('and an OFF oscillator is not offered either — the strip is the enabled set', async () => {
    const user = userEvent.setup()
    mount(withVolumeOverlaySubjects(), vi.fn())
    await openPanel(user)
    expect(stripLabels()).not.toContain('ATR')
  })
})
