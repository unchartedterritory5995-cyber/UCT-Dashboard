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
import { render, screen, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthContext } from '../../context/AuthContext'
import ChartToolbar from './ChartToolbar'
import ChartSettingsModal from './ChartSettingsModal'
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

// ─── ⭐ RETARGETED A SECOND TIME, ONTO THE SURFACE THAT NOW CARRIES THE CONTROLS
//
// What stood here was ten cases driving the TOOLBAR's per-indicator rows: "a
// FLIPPED row writes the instance, and stops being inert". B4 Task 8 deleted
// those fifteen rows for the launcher (spec §6), so the subject is gone — the
// fourth time a case in this family has had its subject migrated out from under
// it, and the reason the describe above asserts the flip SETS rather than naming
// a survivor.
//
// The claim is unchanged and it is not retired: a flipped indicator's controls
// must write the INSTANCE and the legacy MIRROR, each field writing the input it
// names, refusing what the definition refuses. Those controls live on the
// GENERATED SETTINGS DIALOG now, and it reaches MORE of them than the toolbar
// ever did (MACD's two colours, VWAP's opacity / style / width, six of
// ichimoku's eight). So the cases move there, with the same stateful harness and
// the same real user events.
//
// ⚠️ THE STATEFUL HARNESS IS STILL LOAD-BEARING. The dialog's inputs are
// CONTROLLED: a mount whose `onChange` only records leaves the box showing the
// OLD value, so a second keystroke appends to it and `clear(); type('9')` reads
// back `79`. That is the harness lying, not the writer.
function mountDialog(settings, onChange) {
  function Harness() {
    const [cs, setCs] = useState(settings)
    return <ChartSettingsModal open settings={cs} onChange={(next) => { onChange(next); setCs(next) }} />
  }
  return render(<Harness />)
}
const openIndicators = () => fireEvent.click(screen.getByRole('tab', { name: 'Indicators' }))

/** One indicator's SECTION in the dialog. The section label is the definition's
 *  short name, which is unique — scoping to it is what keeps `Period` and
 *  `Color` (which repeat across fifteen sections) unambiguous. */
const sectionFor = (shortName) =>
  [...document.body.querySelectorAll('[class*="sectionLabel"]')]
    .find((n) => n.textContent === shortName).parentElement

/** One field row inside a section, addressed BY DECLARATION INDEX.
 *  ⚠️ NOT by label: MACD declares `signalPeriod` and `signalColor` BOTH labelled
 *  "Signal", and `macdColor`'s label is "MACD", which is also the section's own
 *  heading. A label lookup finds two elements and reads as a missing control.
 *  The dialog renders `row.fields` in declaration order, so the Nth field row IS
 *  the Nth declared input — and if that ever stops being true, the case that
 *  asserts declaration order goes red first. */
const fieldFor = (shortName, defId, key) => {
  const idx = engineRegistry.getDefinition(defId).inputs.findIndex((i) => i.key === key)
  const rows = sectionFor(shortName).querySelectorAll('[class*="indRow"]')
  return rows[idx]
}
const numberIn = (row) => within(row).getByRole('spinbutton')
const swatchIn = (row) => row.querySelector('[data-color-swatch]')
const toggleFor = (shortName) => within(sectionFor(shortName)).getByRole('switch')

describe('the generated dialog — a FLIPPED indicator writes the instance, field by field', () => {
  it('the period control is live, shows the INSTANCE, and says nothing about an engine', () => {
    mountDialog(settingsWith({ indicatorInstances: [RSI_7] }), vi.fn())
    openIndicators()
    const row = fieldFor('RSI', 'rsi', 'period')
    expect(numberIn(row).disabled, 'a control with a writer is greyed out').toBe(false)
    expect(row.getAttribute('title'), 'a live control claims something owns it').toBeNull()
    // …and it shows the INSTANCE's value, which is the value it SETS.
    expect(numberIn(row).value).toBe('7')
  })

  it('typing a period writes the INSTANCE and the legacy MIRROR, in one blob', async () => {
    const user = userEvent.setup()
    const spy = vi.fn()
    mountDialog(settingsWith({ indicatorInstances: [RSI_7] }), spy)
    openIndicators()
    // `<input type=number>` hands back a string; the writer coerces it off the
    // DEFINITION's declared type, not off a hand-maintained field list.
    // Select the existing digit and replace it. `clear()` first is a trap: an
    // empty box is a value `setIndicatorInput` REFUSES, so the write never lands,
    // the controlled input re-renders with the old value, and the next keystroke
    // APPENDS to it — the harness reads `79` and blames the writer.
    await user.type(numberIn(fieldFor('RSI', 'rsi', 'period')), '9',
      { initialSelectionStart: 0, initialSelectionEnd: 9 })
    const next = spy.mock.calls.at(-1)[0]
    expect(live(next).find((i) => i.defId === 'rsi').inputs.period).toBe(9)
    expect(next.indicators.rsi.period, 'the alert evaluator reads this section').toBe(9)
  })

  it('a value the definition would REFUSE writes nothing at all', async () => {
    // `period` is an int 2..100. Storing 500 makes an instance `normalizeInstances`
    // drops — the indicator would silently vanish on the next paint. A refused
    // write must not persist a half-blob either.
    const user = userEvent.setup()
    const spy = vi.fn()
    mountDialog(settingsWith({ indicatorInstances: [RSI_7] }), spy)
    openIndicators()
    await user.type(numberIn(fieldFor('RSI', 'rsi', 'period')), '500',
      { initialSelectionStart: 0, initialSelectionEnd: 9 })
    expect(numberIn(fieldFor('RSI', 'rsi', 'period')).value,
      'the box never reached an out-of-range value — this case is vacuous').not.toBe('500')
    for (const [blob] of spy.mock.calls) {
      const inst = live(blob).find((i) => i.defId === 'rsi')
      expect(inst, 'a refused write dropped the instance').toBeTruthy()
      expect(inst.inputs.period).toBeLessThanOrEqual(100)
    }
  })

  it('⭐ the colour control writes both sides — through a REAL click, which lands', async () => {
    // ⚠️ THE CLICK IS REAL ON PURPOSE. `user.click` sends a MOUSEDOWN first, and
    // a close-on-outside-mousedown handler that does not exempt a PORTALED popup
    // unmounts the surface before the click lands. That was a shipped bug one
    // surface over (`ChartToolbar.colorPicker.test.jsx`), and `fireEvent.click`
    // cannot see it.
    const user = userEvent.setup()
    const spy = vi.fn()
    mountDialog(settingsWith({ indicatorInstances: [RSI_7] }), spy)
    openIndicators()
    await user.click(swatchIn(fieldFor('RSI', 'rsi', 'color')))
    // The dialog opens the SHARED `ColorPanel`, portaled to <body>, whose hex box
    // is unlabelled — found through the panel's own `data-color-panel` contract
    // rather than a CSS-module class a rename would silently break.
    const panel = document.querySelector('[data-color-panel]')
    expect(panel, 'the colour panel never opened').toBeTruthy()
    const hex = within(panel).getByRole('textbox')
    await user.clear(hex)
    await user.type(hex, '00ff00{Enter}')
    const next = spy.mock.calls.at(-1)[0]
    expect(live(next).find((i) => i.defId === 'rsi').inputs.color).toBe('#00ff00')
    expect(next.indicators.rsi.color, 'the mirror was not written').toBe('#00ff00')
  })

  it('the TOGGLE reads the instance list: a tombstone beats a still-true toggle', () => {
    // The blob says `enabled: true` — under Flip A that was the switch, and the
    // toggle would be on over an indicator the user deleted.
    mountDialog(settingsWith({ indicatorInstances: [{ instanceId: 'legacy:rsi', deleted: true }] }), vi.fn())
    openIndicators()
    expect(toggleFor('RSI').getAttribute('aria-checked')).toBe('false')
    // MACD has a true toggle and NO instance of its own here, so
    // `isIndicatorEnabled` projects it. The claim is that RSI's tombstone is
    // per-DEFINITION and does not reach its neighbour.
    expect(toggleFor('MACD').getAttribute('aria-checked'),
      'RSI tombstone switched MACD off too — the read is not per definition').toBe('true')
  })

  it('switching it off writes a TOMBSTONE and clears the mirror', async () => {
    const user = userEvent.setup()
    const spy = vi.fn()
    mountDialog(settingsWith({ indicatorInstances: [RSI_7] }), spy)
    openIndicators()
    await user.click(toggleFor('RSI'))
    const next = spy.mock.calls.at(-1)[0]
    expect(next.indicatorInstances).toContainEqual({ instanceId: 'legacy:rsi', deleted: true })
    expect(live(next).filter((i) => i.defId === 'rsi')).toEqual([])
    expect(next.indicators.rsi.enabled, 'the mirror still says the indicator is on').toBe(false)
  })

  it('BB is flipped too: period, std-dev and colour are all live and all write', async () => {
    const user = userEvent.setup()
    const spy = vi.fn()
    mountDialog(settingsWith({
      indicatorInstances: [{
        instanceId: 'legacy:bb', defId: 'bb', defVersion: 1,
        inputs: { period: 34, stdDev: 3, color: 'rgba(156,39,176,0.85)' },
        placement: { target: 'price' }, hidden: false,
      }],
    }), spy)
    openIndicators()
    expect(numberIn(fieldFor('BB', 'bb', 'period')).value).toBe('34')
    expect(numberIn(fieldFor('BB', 'bb', 'stdDev')).value).toBe('3')
    expect(swatchIn(fieldFor('BB', 'bb', 'color')).disabled).toBe(false)

    await user.type(numberIn(fieldFor('BB', 'bb', 'period')), '21',
      { initialSelectionStart: 0, initialSelectionEnd: 9 })
    const next = spy.mock.calls.at(-1)[0]
    expect(live(next).find((i) => i.defId === 'bb').inputs.period).toBe(21)
    expect(next.indicators.bb.period).toBe(21)
  })

  it('MACD has THREE live periods, and each writes the input it names', async () => {
    // MACD is the only pilot with three period fields on one instance, so "the
    // controls are live" is not the whole claim: each has to write ITS OWN input.
    // A writer keyed on the ROW rather than the FIELD would move `fastPeriod`
    // when the user typed in the signal box, and all three would still look live.
    const user = userEvent.setup()
    const spy = vi.fn()
    mountDialog(settingsWith({
      indicatorInstances: [{
        instanceId: 'legacy:macd', defId: 'macd', defVersion: 2,
        inputs: { fastPeriod: 5, slowPeriod: 35, signalPeriod: 4 },
        placement: { target: 'pane' }, hidden: false,
      }],
    }), spy)
    openIndicators()
    expect(['fastPeriod', 'slowPeriod', 'signalPeriod']
      .map((k) => numberIn(fieldFor('MACD', 'macd', k)).value)).toEqual(['5', '35', '4'])

    await user.type(numberIn(fieldFor('MACD', 'macd', 'signalPeriod')), '7',
      { initialSelectionStart: 0, initialSelectionEnd: 9 })
    const next = spy.mock.calls.at(-1)[0]
    const inst = live(next).find((i) => i.defId === 'macd')
    expect(inst.inputs.signalPeriod, 'the signal box wrote nothing').toBe(7)
    expect(inst.inputs.fastPeriod, 'typing in the signal box moved the FAST period').toBe(5)
    expect(inst.inputs.slowPeriod).toBe(35)
    expect(next.indicators.macd.signalPeriod, 'the alert evaluator reads this section').toBe(7)
  })

  it('⭐ …and MACD has TWO COLOUR controls — which no surface had before B4', () => {
    // The gap the ledger measured and B3 could not close: `macdColor` and
    // `signalColor` had a control NOWHERE. Asserted on the real dialog, because a
    // control that appears and writes nowhere is the defect this phase retires.
    mountDialog(settingsWith({
      indicatorInstances: [{
        instanceId: 'legacy:macd', defId: 'macd', defVersion: 2,
        inputs: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
        placement: { target: 'pane' }, hidden: false,
      }],
    }), vi.fn())
    openIndicators()
    for (const key of ['macdColor', 'signalColor']) {
      expect(swatchIn(fieldFor('MACD', 'macd', key)), `no control for ${key}`).toBeTruthy()
    }
  })

  it('VWAP opacity writes the instance — a control the toolbar never had', () => {
    const spy = vi.fn()
    mountDialog(settingsWith({
      indicators: { vwap: { enabled: true, color: '#26C6DA', opacity: 100, lineStyle: 'solid', lineWidth: 1 } },
      indicatorInstances: [{
        instanceId: 'legacy:vwap', defId: 'vwap', defVersion: 1,
        inputs: { color: '#ff0000', opacity: 100, lineStyle: 'solid', lineWidth: 1 },
        placement: { target: 'price' }, hidden: false,
      }],
    }), spy)
    openIndicators()
    expect(swatchIn(fieldFor('VWAP', 'vwap', 'color')).style.background,
      'the swatch must show the INSTANCE').toBe('rgb(255, 0, 0)')

    // ⚠️ TYPED AS A WHOLE VALUE, not digit by digit. `opacity` is an int 5..100,
    // so replacing the selection with `4` is a value `setIndicatorInput` REFUSES
    // — the write never lands, the controlled box re-renders at 100 and the next
    // keystroke appends. `fireEvent.change` delivers the finished value the way a
    // spinner or a paste does, which is what this case is about.
    fireEvent.change(numberIn(fieldFor('VWAP', 'vwap', 'opacity')), { target: { value: '40' } })
    const next = spy.mock.calls.at(-1)[0]
    expect(live(next).find((i) => i.defId === 'vwap').inputs.opacity).toBe(40)
    expect(next.indicators.vwap.opacity, 'the mirror was not written').toBe(40)
    // …and the bound really is enforced on this control: 4 is below the declared
    // minimum and must persist nothing at all.
    const before = spy.mock.calls.length
    fireEvent.change(numberIn(fieldFor('VWAP', 'vwap', 'opacity')), { target: { value: '4' } })
    expect(spy.mock.calls.length, 'a value below the declared minimum was persisted').toBe(before)
  })

  it('⭐ a NON-MIGRATED id stores a NUMBER, not the string the input hands back', async () => {
    // `updateIndicator`'s `numFields` set did this on the toolbar and RETIRED
    // with it. Every id routes through `setIndicatorInput` now, which coerces off
    // the DEFINITION's declared type — so the claim survives its writer, and a
    // blob storing `"21"` instead of `21` is still a red test.
    const user = userEvent.setup()
    const spy = vi.fn()
    mountDialog(settingsWith({ indicators: { stoch: { enabled: true, kPeriod: 14, dPeriod: 3 } } }), spy)
    openIndicators()
    await user.type(numberIn(fieldFor('Stoch', 'stoch', 'kPeriod')), '21',
      { initialSelectionStart: 0, initialSelectionEnd: 9 })
    const next = spy.mock.calls.at(-1)[0]
    expect(next.indicators.stoch.kPeriod, 'the numeric coercion is gone — the blob stores a string')
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
