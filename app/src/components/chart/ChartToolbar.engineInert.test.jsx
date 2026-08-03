// ─── A CONTROL THAT CANNOT DO ANYTHING MUST NOT LOOK LIKE IT CAN ────────────
//
// B3 Flip A hands an indicator's DRAWING to the engine, which reads its period
// and colour from the INSTANCE. These settings rows keep writing
// `cs.indicators.<id>.<field>`, which the engine never consults — so typing 7
// into MACD's fast-period box moves nothing on the chart and says nothing about
// why. The `enabled` checkbox is different and must keep working: under Flip A
// the legacy toggle is still the SWITCH (StockChart projects an instance whose
// toggle is off to `hidden`), which is what makes Alt+U and that checkbox real.
//
// ⚠️ NEVER use fireEvent.click to assert a disabled control is inert — it
// dispatches a raw MouseEvent straight at the node, bypassing the `disabled`
// check no real browser bypasses, and React's ChangeEventPlugin then turns it
// into onChange. Use userEvent and/or the native element.click().
//
// ⭐ B3 TASK 10 EXHAUSTED THIS FILE'S ORIGINAL SUBJECTS, AND THAT IS THE THIRD
// TIME. `engineInert` means "engine-drawn AND nothing here can change it", and it
// SUBTRACTS `ENGINE_FLIPPED_DEF_IDS` — so `rsi` and `bb`, which every case here
// used to be written against, are LIVE rows now and their inert assertions all
// went red on the flip. Retargeted to `macd` and `vwap`, the two migrated
// definitions Task 11 has not flipped yet, with a NON-VACUITY rail at the top:
// when Task 11 lands, that rail fails and tells whoever is holding it that this
// file has no subject left rather than letting it pass on an empty loop.
//
// The other half is `ChartToolbar.flipB.test.jsx`: a row that HAS a writer must
// come back to life, or the honesty fix inverts into a working control that looks
// dead. Neither file is worth much without the other.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChartToolbar from './ChartToolbar'
import { mergeChartSettings } from './chartDefaults'
import { AuthContext } from '../../context/AuthContext'
import {
  ENGINE_MIGRATED_DEF_IDS, ENGINE_FLIPPED_DEF_IDS, engineDrawnDefIds, engineDrawnInputs,
} from './engine/flipState'
import * as engineRegistry from './engine/nativeRegistry'

const MACD_INSTANCE = {
  instanceId: 'legacy:macd', defId: 'macd', defVersion: 2,
  inputs: { fastPeriod: 5, slowPeriod: 35, signalPeriod: 4 },
  placement: { target: 'pane' }, hidden: false,
}
const VWAP_INSTANCE = {
  instanceId: 'legacy:vwap', defId: 'vwap', defVersion: 1,
  inputs: { color: '#ff0000' }, placement: { target: 'price' }, hidden: false,
}

const settingsWith = (over) => mergeChartSettings(JSON.stringify({
  indicators: {
    macd: { enabled: true, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
    vwap: { enabled: true, color: '#26C6DA' },
    stoch: { enabled: true },
  },
  ...over,
}))

function mount(settings, onUpdateSettings) {
  return render(
    <AuthContext.Provider value={{ isPaid: true, user: null, loading: false }}>
      <ChartToolbar
        activeTool="cursor"
        setActiveTool={() => {}}
        chartSettings={settings}
        onUpdateSettings={onUpdateSettings}
      />
    </AuthContext.Provider>,
  )
}

const openPanel = (user) => user.click(screen.getByTitle('Chart Settings'))
/** The settings row for an indicator, found by its label span. */
const rowFor = (label) => screen.getByText(label, { selector: 'span' }).parentElement
const periodBox = (row) => within(row).getAllByRole('spinbutton')[0]
const swatch = (row) => within(row).getAllByRole('button').at(-1)
const ENGINE_TITLE = /Drawn by the indicator engine/

describe('the SUBJECT is the premise — this file is empty without an un-flipped migrated id', () => {
  it('there is at least one MIGRATED definition that is NOT flipped', () => {
    // ⛔ THE RAIL THAT EXPIRES THIS FILE HONESTLY. Every case below needs an id
    // the engine draws and no control can write. Task 10 took `rsi` and `bb`;
    // Task 11 takes `macd` and `vwap`, and on that day this fails instead of the
    // whole file passing on subjects that no longer exist. That has already
    // happened twice here (Stoch → MACD → VWAP), each time silently.
    const unflipped = [...ENGINE_MIGRATED_DEF_IDS].filter(id => !ENGINE_FLIPPED_DEF_IDS.has(id))
    expect(unflipped,
      'every migrated definition is flipped — no row can be inert any more, and this '
      + 'file has to move to whatever B4 migrates next').not.toHaveLength(0)
    expect(unflipped).toContain('macd')
    expect(unflipped).toContain('vwap')
  })

  it('…and rsi and bb are NOT among them — they are the ones Task 10 flipped', () => {
    expect(ENGINE_FLIPPED_DEF_IDS.has('rsi')).toBe(true)
    expect(ENGINE_FLIPPED_DEF_IDS.has('bb')).toBe(true)
  })
})

// ── AND IT MUST SHOW WHAT IS ACTUALLY ON THE CHART ──────────────────────────
//
// Greying the box was half the honesty fix. The greyed box still read
// `cs.indicators.<id>.<field>`, so a user on an `?instances=` chart saw a
// disabled **12/26/9** in the settings panel while `readout.js`' `chipLabel`
// printed **MACD(5,35,4)** in the legend. Two numbers for one line, with a
// tooltip next to the wrong one explaining that this field is not the authority.
describe('ChartToolbar — an inert row shows the INSTANCE value, not the blob', () => {
  it('the disabled period boxes print what the engine is rendering', async () => {
    const user = userEvent.setup()
    // The blob says 12/26/9; the instance the engine draws says 5/35/4.
    mount(settingsWith({ engineEnabled: true, indicatorInstances: [MACD_INSTANCE] }), vi.fn())
    await openPanel(user)
    const boxes = within(rowFor('MACD')).getAllByRole('spinbutton')
    expect(boxes).toHaveLength(3)
    expect(boxes.map(b => b.disabled)).toEqual([true, true, true])
    expect(boxes.map(b => b.value),
      'a greyed box is showing the blob, not what the engine is drawing').toEqual(['5', '35', '4'])
    for (const b of boxes) expect(b.getAttribute('title')).toMatch(ENGINE_TITLE)
  })

  it('…and the blob still says 12, so this is a DISPLAY fix and not a write', async () => {
    // The row is read-only for an un-flipped migrated id; nothing here may have
    // reached back into `cs`.
    //
    // ⭐ THE REASON, RESTATED FOR THE THIRD TIME. It used to be "`instanceControls`
    // does not exist yet" (false since Task 9), then "`rsi` is not in
    // `ENGINE_FLIPPED_DEF_IDS`" (false since Task 10). What keeps it true now is
    // narrower still: `macd` is not flipped, so `ChartToolbar.updateIndicator`'s
    // routing branch is unreachable FOR IT and `engineInert` does not subtract it.
    // A green test whose stated reason has quietly become false is the failure
    // mode this branch keeps hitting.
    const user = userEvent.setup()
    const spy = vi.fn()
    const cs = settingsWith({ engineEnabled: true, indicatorInstances: [MACD_INSTANCE] })
    mount(cs, spy)
    await openPanel(user)
    expect(cs.indicators.macd.fastPeriod).toBe(12)
    expect(spy).not.toHaveBeenCalled()
  })

  it('two instances of one definition: the row shows the FIRST, which is what draws first', async () => {
    // A settings row is per-DEFINITION and can only show one number. First-in-list
    // is the binder's own draw order, so the row names the first line the user
    // sees rather than an arbitrary one. Pinned because the docstring claims it.
    const user = userEvent.setup()
    mount(settingsWith({
      engineEnabled: true,
      indicatorInstances: [
        MACD_INSTANCE,
        { ...MACD_INSTANCE, instanceId: 'second:macd', inputs: { fastPeriod: 50, slowPeriod: 60, signalPeriod: 7 } },
      ],
    }), vi.fn())
    await openPanel(user)
    expect(within(rowFor('MACD')).getAllByRole('spinbutton')[0].value).toBe('5')
  })

  it('the MIGRATED-ID FILTER drops an un-migrated instance — the control, moved down a level', () => {
    // ⏳ EXPIRED AT B3 TASK 8, EXACTLY WHERE TASK 7 SAID IT WOULD, AND THIS IS THE
    // REPLACEMENT IT PRESCRIBED.
    //
    // The original case rendered a row: "a VALID instance of an UN-MIGRATED
    // definition leaves that row fully live". It had already been re-pointed
    // twice — Stoch (whose row has no `disabled` at all, so it passed vacuously),
    // then MACD, then VWAP — and VWAP migrating exhausted the row-level subjects:
    // `ChartToolbar` wires `engineInert` to exactly rsi/macd/bb/vwap and all four
    // are migrated. There is no fifth row.
    //
    // So the claim moves to where it actually lives. What the row-level case was
    // ever testing is `engineDrawnInputs`'s `ENGINE_MIGRATED_DEF_IDS` filter: drop
    // it and every stored instance greys its own row while the chart keeps obeying
    // that row — a working control that looks dead, the same lie as a dead control
    // that looks working. That filter is in `flipState.js` and can be interrogated
    // directly, with a subject that cannot be migrated out from under it.
    const unmigrated = engineRegistry.listDefinitions()
      .map(d => d.id)
      .filter(id => !ENGINE_MIGRATED_DEF_IDS.has(id))
    expect(unmigrated, 'every definition is migrated — this control is now empty').not.toHaveLength(0)

    for (const defId of unmigrated) {
      const cs = settingsWith({
        engineEnabled: true,
        indicatorInstances: [{
          instanceId: `legacy:${defId}`, defId, defVersion: 1,
          inputs: {}, placement: engineRegistry.getDefinition(defId).placement, hidden: false,
        }],
      })
      expect(engineDrawnDefIds(cs, engineRegistry).has(defId), `${defId} greyed its own live control`).toBe(false)
      expect(engineDrawnInputs(cs, engineRegistry).has(defId), defId).toBe(false)
    }

    // …and the positive half, so this is a FILTER and not a blanket "return
    // nothing": a migrated definition's instance IS reported, inputs and all.
    const migrated = settingsWith({ engineEnabled: true, indicatorInstances: [VWAP_INSTANCE] })
    expect(engineDrawnDefIds(migrated, engineRegistry).has('vwap')).toBe(true)
    expect(engineDrawnInputs(migrated, engineRegistry).get('vwap').color).toBe('#ff0000')
  })

  it('VWAP is MIGRATED and NOT FLIPPED: its colour swatch is inert and shows the INSTANCE', async () => {
    // VWAP's only `engineInert` control is the swatch (its opacity/style/width
    // live in the settings page, not the toolbar), so this is the whole toolbar
    // surface for it — and the swatch showing `#ff0000` while the blob says
    // `#26C6DA` is exactly the "two colours for one line" the inert treatment
    // exists to end.
    const user = userEvent.setup()
    mount(settingsWith({ engineEnabled: true, indicatorInstances: [VWAP_INSTANCE] }), vi.fn())
    await openPanel(user)
    const box = swatch(rowFor('VWAP'))
    expect(box.disabled, 'a migrated definition left its dead control looking live').toBe(true)
    expect(box.getAttribute('title')).toMatch(ENGINE_TITLE)
    expect(box.style.background).toBe('rgb(255, 0, 0)')
  })

  it('…but VWAP\'s enable CHECKBOX stays live — the toggle is still the switch', async () => {
    // Flip A keeps `cs.indicators.vwap.enabled` as the switch: StockChart projects
    // an instance whose toggle is off to `hidden`. Greying this box would leave a
    // user with a VWAP they cannot turn off — and Alt+U writes the same field, so
    // the two would disagree about whether the indicator is on.
    const user = userEvent.setup()
    const onUpdate = vi.fn()
    mount(settingsWith({ engineEnabled: true, indicatorInstances: [VWAP_INSTANCE] }), onUpdate)
    await openPanel(user)
    const box = within(rowFor('VWAP')).getByRole('checkbox')
    expect(box.disabled).toBe(false)
    await user.click(box)
    expect(onUpdate).toHaveBeenCalled()
    expect(onUpdate.mock.calls.at(-1)[0].indicators.vwap.enabled).toBe(false)
    expect(onUpdate.mock.calls.at(-1)[0].indicatorInstances,
      'an un-flipped id must not route through instanceControls').toEqual([VWAP_INSTANCE])
  })

  it('a LIVE row is untouched: no instance ⇒ the blob is still what it shows', async () => {
    const user = userEvent.setup()
    mount(settingsWith({
      indicators: { macd: { enabled: true, fastPeriod: 21, slowPeriod: 26, signalPeriod: 9 } },
    }), vi.fn())
    await openPanel(user)
    const boxes = within(rowFor('MACD')).getAllByRole('spinbutton')
    expect(boxes[0].disabled).toBe(false)
    expect(boxes[0].value).toBe('21')
  })

  it('an instance whose inputs OMIT a field falls back for that field only', async () => {
    // `normalizeInstances` fills declared defaults, so this is really about the
    // fallback not turning into `undefined` and making React drop to an
    // uncontrolled input.
    const user = userEvent.setup()
    mount(settingsWith({
      engineEnabled: true,
      indicatorInstances: [{ ...MACD_INSTANCE, inputs: { fastPeriod: 5 } }],
    }), vi.fn())
    await openPanel(user)
    const boxes = within(rowFor('MACD')).getAllByRole('spinbutton')
    expect(boxes[0].disabled).toBe(true)
    expect(boxes[0].value, 'MACD fastPeriod comes from the instance').toBe('5')
    // The other two are declared with defaults, so the normaliser supplies them —
    // either way the boxes must show a real number and stay controlled.
    expect(boxes[1].value).not.toBe('')
    expect(boxes[2].value).not.toBe('')
  })
})

describe('ChartToolbar — the period and colour rows an engine-drawn indicator makes inert', () => {
  let spy
  beforeEach(() => { spy = vi.fn() })

  it('engine OFF: MACD\'s period boxes are live, and say nothing about an engine', async () => {
    const user = userEvent.setup()
    mount(settingsWith(), spy)
    await openPanel(user)
    const boxes = within(rowFor('MACD')).getAllByRole('spinbutton')
    expect(boxes.map(b => b.disabled)).toEqual([false, false, false])
    expect(boxes[0].getAttribute('title')).toBe('Fast')
    expect(swatch(rowFor('VWAP')).disabled).toBe(false)
  })

  it('engine ON and drawing them: period and colour are disabled and SAY WHY', async () => {
    const user = userEvent.setup()
    mount(settingsWith({
      engineEnabled: true, indicatorInstances: [MACD_INSTANCE, VWAP_INSTANCE],
    }), spy)
    await openPanel(user)
    const boxes = within(rowFor('MACD')).getAllByRole('spinbutton')
    expect(boxes[0].disabled, 'MACD fast period is still writable and still ignored').toBe(true)
    expect(boxes[0].getAttribute('title')).toMatch(ENGINE_TITLE)
    const box = swatch(rowFor('VWAP'))
    expect(box.disabled, 'the colour swatch is still clickable and still ignored').toBe(true)
    expect(box.getAttribute('title')).toMatch(ENGINE_TITLE)
  })

  it('…and neither one can be made to write, by pointer or by keyboard', async () => {
    const user = userEvent.setup()
    mount(settingsWith({
      engineEnabled: true, indicatorInstances: [MACD_INSTANCE, VWAP_INSTANCE],
    }), spy)
    await openPanel(user)

    await user.type(within(rowFor('MACD')).getAllByRole('spinbutton')[0], '7')
    within(rowFor('MACD')).getAllByRole('spinbutton')[0].click()
    await user.click(swatch(rowFor('VWAP')))
    swatch(rowFor('VWAP')).click()

    expect(spy, 'a disabled control wrote settings').not.toHaveBeenCalled()
    // The picker must not even OPEN — a popup whose choice is discarded is the
    // same lie one layer down. Its hex field is the tell (it portals to <body>,
    // so `screen`, not `within(row)`).
    expect(screen.queryByPlaceholderText('#hex'), 'the colour picker opened anyway').toBeNull()
  })

  it('the ENABLE checkbox stays live — it is Flip A\'s actual switch', async () => {
    const user = userEvent.setup()
    mount(settingsWith({ engineEnabled: true, indicatorInstances: [MACD_INSTANCE] }), spy)
    await openPanel(user)
    const box = within(rowFor('MACD')).getByRole('checkbox')
    expect(box.disabled).toBe(false)
    await user.click(box)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0].indicators.macd.enabled).toBe(false)
  })

  it('a NON-migrated indicator keeps every control, engine on or off', async () => {
    // If this greyed out too, one flip would silence fourteen indicators' settings.
    const user = userEvent.setup()
    mount(settingsWith({ engineEnabled: true, indicatorInstances: [MACD_INSTANCE] }), spy)
    await openPanel(user)
    const row = rowFor('Stoch')
    expect(periodBox(row).disabled).toBe(false)
    expect(swatch(row).disabled).toBe(false)
  })

  it('an instance the VALIDATOR drops leaves the controls alone', async () => {
    // `bogus` is not a declared MACD input, so `normalizeInstances` refuses the
    // record and the engine draws nothing. Greying the row for an instance nobody
    // is going to draw is the same lie in the other direction.
    const user = userEvent.setup()
    mount(settingsWith({
      engineEnabled: true,
      indicatorInstances: [{ ...MACD_INSTANCE, inputs: { ...MACD_INSTANCE.inputs, bogus: 1 } }],
    }), spy)
    await openPanel(user)
    expect(within(rowFor('MACD')).getAllByRole('spinbutton')[0].disabled).toBe(false)
  })

  it('instances stored while the FLAG is off change nothing, for an UN-FLIPPED id', async () => {
    // The realistic pre-flip state: migrated instances in the blob, engine dark.
    // The legacy blocks still draw, so the legacy fields still drive them.
    //
    // ⚠️ ONLY FOR AN UN-FLIPPED ID. A flipped definition runs the engine whatever
    // the flag says (it has no other renderer), so `rsi` here would be inert-ish
    // and this case would be asserting the opposite of the truth.
    const user = userEvent.setup()
    mount(settingsWith({ indicatorInstances: [MACD_INSTANCE] }), spy)
    await openPanel(user)
    const boxes = within(rowFor('MACD')).getAllByRole('spinbutton')
    expect(boxes[0].disabled).toBe(false)
    expect(boxes[0].value, 'the flag-off row must show the BLOB').toBe('12')
  })
})
