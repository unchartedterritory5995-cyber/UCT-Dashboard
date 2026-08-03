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
// ⛔⭐ B3 TASK 11 EXHAUSTED THE SUBJECTS FOR THE FOURTH AND LAST TIME, AND THE
// RAIL AT THE TOP FIRED EXACTLY AS DESIGNED. `engineInert` means "engine-drawn
// AND nothing here can change it", and it SUBTRACTS `ENGINE_FLIPPED_DEF_IDS` —
// so with all four pilots flipped it is IDENTICALLY FALSE and no row on this
// panel renders disabled. Stoch → MACD → VWAP → rsi/bb → nothing: four
// exhaustions, three of them silent before Task 10 added the rail.
//
// The file is NOT deleted, and neither is the predicate, for two reasons that
// have to be stated because "it is inert, delete it" is the obvious move:
//
//   1. `engineInert` is the general rule, not a fact about these four ids. B4
//      migrates ten more definitions, and the FIRST one migrated-without-flipping
//      makes every one of its rows lie again. `flipB.test.jsx` asserts the two id
//      sets are EQUAL, so that day is a red test rather than a discovery.
//   2. The half of this file that could NEVER go vacuous is the DISPLAY half: a
//      row — inert or live — must show the value the ENGINE is rendering, not the
//      blob. That was the second half of the original honesty fix and it is
//      independent of `disabled`.
//
// So every `disabled`-shaped case below has been INVERTED to the direction it can
// now be wrong in (a row with a writer that looks dead is the same lie as a dead
// row that looks live — `ChartToolbar.flipB.test.jsx` owns the writer half), the
// display cases stay, and the wiring rail added in Task 11 pins WHICH rows ask
// the predicate so a lie about any of them is visible at all.
//
// The other half is `ChartToolbar.flipB.test.jsx`: a row that HAS a writer must
// come back to life, or the honesty fix inverts into a working control that looks
// dead. Neither file is worth much without the other.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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

describe('the PREMISE, restated after the fourth exhaustion', () => {
  it('⛔ `engineInert` has NO subject: every migrated definition is flipped', () => {
    // The rail that used to demand an un-flipped subject, pointed the other way.
    // It is the same claim about the same list — it just changed sign when the
    // list emptied, and saying so out loud is what stops the next reader assuming
    // the inert cases below still describe shipped behaviour.
    const unflipped = [...ENGINE_MIGRATED_DEF_IDS].filter(id => !ENGINE_FLIPPED_DEF_IDS.has(id))
    expect(unflipped,
      'a migrated definition is NOT flipped — `engineInert` is live again for it, and the '
      + 'INVERTED cases below (which assert its rows are writable) are now wrong').toEqual([])
  })

  it('…and all four pilots ARE flipped, so the inversions below have their subject', () => {
    for (const id of ['rsi', 'bb', 'macd', 'vwap']) {
      expect(ENGINE_FLIPPED_DEF_IDS.has(id), id).toBe(true)
    }
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
  it('⭐ the period boxes print what the engine is RENDERING, not what the blob stores', () => {
    // THE HALF OF THE HONESTY FIX THAT CANNOT GO VACUOUS. `disabled` depended on
    // the row having no writer; this does not. The blob says 12/26/9 and the
    // instance the engine draws says 5/35/4, and a panel showing 12 next to a
    // legend printing MACD(5,35,4) is two numbers for one line whether or not the
    // box can be typed in.
    const user = userEvent.setup()
    mount(settingsWith({ engineEnabled: true, indicatorInstances: [MACD_INSTANCE] }), vi.fn())
    return openPanel(user).then(() => {
      const boxes = within(rowFor('MACD')).getAllByRole('spinbutton')
      expect(boxes).toHaveLength(3)
      expect(boxes.map(b => b.value),
        'the boxes are showing the blob, not what the engine is drawing').toEqual(['5', '35', '4'])
    })
  })

  it('⭐ INVERTED AT TASK 11: the row is LIVE, and merely OPENING the panel writes nothing', async () => {
    // This case used to read "…and the blob still says 12, so this is a DISPLAY
    // fix and not a write", asserting `onUpdateSettings` was never called BECAUSE
    // the row was inert. MACD is flipped, so the row has a writer and that reason
    // is gone — but the assertion is still worth having for a narrower claim:
    // RENDERING the panel must not write anything. A `shownInput` that
    // "helpfully" persisted the instance value back into the blob would be a
    // silent settings write on every panel open.
    const user = userEvent.setup()
    const spy = vi.fn()
    const cs = settingsWith({ engineEnabled: true, indicatorInstances: [MACD_INSTANCE] })
    mount(cs, spy)
    await openPanel(user)
    expect(cs.indicators.macd.fastPeriod, 'the blob was mutated in place').toBe(12)
    expect(spy, 'opening the settings panel persisted a write').not.toHaveBeenCalled()
    // …and the row really is live now, so this is not the old claim in disguise.
    expect(within(rowFor('MACD')).getAllByRole('spinbutton')[0].disabled).toBe(false)
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

  it('⭐ INVERTED AT TASK 11: VWAP\'s swatch shows the INSTANCE, and is no longer dead', async () => {
    // It used to assert `box.disabled === true`, because VWAP was migrated and
    // un-flipped. It is flipped now, so a greyed swatch would be the OPPOSITE lie
    // — a working control that looks dead. The display half is unchanged and is
    // the part that always mattered: `#ff0000` from the instance, not `#26C6DA`
    // from the blob, because two colours for one line is the defect either way.
    const user = userEvent.setup()
    mount(settingsWith({ engineEnabled: true, indicatorInstances: [VWAP_INSTANCE] }), vi.fn())
    await openPanel(user)
    const box = swatch(rowFor('VWAP'))
    expect(box.disabled, 'a flipped row has a writer and must not be greyed').toBe(false)
    expect(box.getAttribute('title'), 'a live control still claims the engine owns it')
      .not.toMatch(ENGINE_TITLE)
    expect(box.style.background, 'the swatch is showing the blob').toBe('rgb(255, 0, 0)')
  })

  it('⭐ INVERTED AT TASK 11: VWAP\'s checkbox writes the INSTANCE, not just the mirror', async () => {
    // Under Flip A this asserted the checkbox must NOT route through
    // `instanceControls` — correct while the legacy toggle was the switch. After
    // the flip the instance IS the switch, so a checkbox that only cleared the
    // mirror would untick itself and leave the line on the chart. Both halves are
    // asserted: the tombstone (what the chart reads) and the mirror (what the
    // alert evaluator reads).
    const user = userEvent.setup()
    const onUpdate = vi.fn()
    mount(settingsWith({ engineEnabled: true, indicatorInstances: [VWAP_INSTANCE] }), onUpdate)
    await openPanel(user)
    const box = within(rowFor('VWAP')).getByRole('checkbox')
    expect(box.disabled).toBe(false)
    await user.click(box)
    expect(onUpdate).toHaveBeenCalled()
    const next = onUpdate.mock.calls.at(-1)[0]
    expect(next.indicators.vwap.enabled, 'the mirror was not cleared').toBe(false)
    expect(next.indicatorInstances,
      'a flipped id must route through instanceControls — the chart reads the instance')
      .toContainEqual({ instanceId: 'legacy:vwap', deleted: true })
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

  it('⭐ INVERTED AT TASK 11: engine ON and drawing them — every control is LIVE and says nothing', async () => {
    // The exact inverse of what this asserted at Flip A, on the same fixture. A
    // flipped id routes its writes to `instanceControls`, so a greyed box with a
    // tooltip saying "this field is not what sets it" would be a working control
    // telling the user their keystroke did nothing while it did — and `disabled`
    // and `title` disagreeing is how the ORIGINAL half-fix happened, which is why
    // both are asserted together in both directions.
    const user = userEvent.setup()
    mount(settingsWith({
      engineEnabled: true, indicatorInstances: [MACD_INSTANCE, VWAP_INSTANCE],
    }), spy)
    await openPanel(user)
    const boxes = within(rowFor('MACD')).getAllByRole('spinbutton')
    expect(boxes[0].disabled, 'MACD fast period is greyed and it has a writer').toBe(false)
    expect(boxes[0].getAttribute('title')).toBe('Fast')
    const box = swatch(rowFor('VWAP'))
    expect(box.disabled, 'the colour swatch is greyed and it has a writer').toBe(false)
    expect(box.getAttribute('title')).not.toMatch(ENGINE_TITLE)
  })

  it('…and BOTH can be made to write, by pointer and by keyboard', async () => {
    // The other inversion. It used to assert nothing could write; the failure it
    // now catches is the same defect one direction over — a control that opens,
    // accepts input and discards it.
    const user = userEvent.setup()
    mount(settingsWith({
      engineEnabled: true, indicatorInstances: [MACD_INSTANCE, VWAP_INSTANCE],
    }), spy)
    await openPanel(user)

    await user.type(within(rowFor('MACD')).getAllByRole('spinbutton')[0], '7',
      { initialSelectionStart: 0, initialSelectionEnd: 9 })
    expect(spy, 'the keyboard wrote nothing to a live row').toHaveBeenCalled()

    await user.click(swatch(rowFor('VWAP')))
    // The picker must OPEN — a swatch that swallows the click is the same lie one
    // layer down. Its hex field is the tell (it portals to <body>, so `screen`).
    expect(screen.queryByPlaceholderText('#hex'), 'the colour picker never opened').not.toBeNull()
  })

  it('the ENABLE checkbox stays live — and now writes the INSTANCE', async () => {
    const user = userEvent.setup()
    mount(settingsWith({ engineEnabled: true, indicatorInstances: [MACD_INSTANCE] }), spy)
    await openPanel(user)
    const box = within(rowFor('MACD')).getByRole('checkbox')
    expect(box.disabled).toBe(false)
    await user.click(box)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0].indicators.macd.enabled, 'the mirror was not cleared').toBe(false)
    expect(spy.mock.calls[0][0].indicatorInstances,
      'the checkbox left the instance live — the chart still draws it')
      .toContainEqual({ instanceId: 'legacy:macd', deleted: true })
  })

  it('a NON-migrated indicator keeps every control — asserted where it can FAIL', async () => {
    // ⭐ THIS CASE USED TO BE VACUOUS, AND THE FILE ALREADY SAID SO ABOUT ITS OWN
    // SIBLING (see "Stoch (whose row has no `disabled` at all, so it passed
    // vacuously)" above) — it just never came back and fixed this one.
    //
    // It read:
    //     const row = rowFor('Stoch')
    //     expect(periodBox(row).disabled).toBe(false)
    //     expect(swatch(row).disabled).toBe(false)
    //
    // Stoch's row passes NO `disabled` prop (`ChartToolbar.jsx`, the Stochastic
    // block), so `.disabled` is `false` for a reason that has nothing to do with
    // the engine and cannot be changed by anything the engine does. MEASURED:
    // mutating the predicate to `engineInert = (key) => key === 'stoch'` — the
    // exact regression the old comment named, "one flip silences fourteen
    // indicators' settings" — leaves **58 files / 1,245 tests green**.
    //
    // ⭐ THE FIX IS IN THE COMPONENT, NOT HERE: **every** indicator row now asks
    // `engineInert(key)`, so the predicate can be caught lying about any of
    // them. The answer stays `false` for all eleven un-migrated ids by
    // construction (`engineDrawnDefIds` returns only migrated ids), so nothing
    // renders differently — but the row is now live BECAUSE THE PREDICATE SAYS
    // SO rather than because nobody asked, and that is the whole difference
    // between a control and a decoration.
    //
    // Asserted behaviourally rather than on `.disabled`: a disabled input
    // swallows `user.type`, so ANY mechanism that turned this row off — this
    // predicate, a future one, a CSS guard — fails here without the assertion
    // having to know how it was spelt.
    const user = userEvent.setup()
    mount(settingsWith({ engineEnabled: true, indicatorInstances: [MACD_INSTANCE] }), spy)
    await openPanel(user)
    const row = rowFor('Stoch')
    await user.type(periodBox(row), '9')
    expect(spy, 'a non-migrated indicator lost its settings row to the engine').toHaveBeenCalled()
    expect(spy.mock.calls.at(-1)[0].indicators.stoch.kPeriod).toBe(149)   // 14 → "149"
    // …and its swatch still opens a real picker (the ColorPicker half, which
    // `disabled` would also have taken).
    await user.click(swatch(row))
    expect(screen.queryByPlaceholderText('#hex'), 'the picker did not open').not.toBeNull()
  })

  it('EVERY indicator row asks the predicate — the structural half', () => {
    // ⭐ WHY SOURCE AND NOT THE DOM. Which rows CONSULT `engineInert` is not
    // observable from any render, and that set is precisely what decided the
    // vacuity above: an id absent from it can be lied about for free, forever,
    // and no DOM assertion anywhere can notice. Reading the JSX is the only
    // place the claim exists.
    //
    // ⚠️ AND IT SURVIVES TASK 11 AND B4. This pins the WIRING, not the
    // predicate's value: after every pilot is flipped `engineInert` is
    // identically false and no row renders disabled, but the bindings must all
    // still be there — they are what a future migrated-but-unflipped definition
    // reactivates. A control whose subject can be migrated out from under it is
    // what has expired this file three times.
    const src = readFileSync(
      resolve(process.cwd(), 'src/components/chart/ChartToolbar.jsx'), 'utf8')
    const hits = [...src.matchAll(/engineInert\('([a-zA-Z]+)'\)/g)].map(m => m[1])
    const wired = new Set(hits)
    // ⚠️ COUNTED, NOT JUST NAMED. A SET is satisfied by ONE binding per id, so
    // dropping `disabled={engineInert('rsi')}` from RSI's period box while its
    // swatch keeps its own is INVISIBLE to a set — measured: that mutation
    // survived the set-only version of this test. The per-row control count is
    // what makes each individual binding load-bearing.
    //
    // Yes, this needs updating when a row gains or loses a control. That is the
    // prompt, not the cost: the update is "wire the new control", which is
    // exactly the step whose omission this whole case exists to catch.
    const perId = {}
    for (const id of hits) perId[id] = (perId[id] || 0) + 1
    expect(perId, 'a control in an indicator row is not wired to engineInert (or one was '
      + 'added/removed) — wire it and update this map').toEqual({
      rsi: 2, macd: 3, bb: 3, vwap: 1, stoch: 4, atr: 2, sar: 2, ichimoku: 2,
      volumeProfile: 2, mfi: 2, cci: 2, williamsR: 2, adx: 4, obv: 1, donchian: 2,
    })
    // Every indicator with a settings row, migrated or not. `volumeProfile` is
    // in the panel but is not an engine definition at all — it is here because
    // the rule is "every ROW asks", which is a property of the panel.
    expect([...wired].sort()).toEqual([
      'adx', 'atr', 'bb', 'cci', 'donchian', 'ichimoku', 'macd', 'mfi', 'obv',
      'rsi', 'sar', 'stoch', 'volumeProfile', 'vwap', 'williamsR',
    ])
    // …and it really is every one the panel renders, so a row ADDED without the
    // treatment (B4's new definitions) fails here rather than quietly becoming
    // the next unfalsifiable case.
    const rows = new Set([...src.matchAll(/updateIndicator\('([a-zA-Z]+)', 'enabled'/g)]
      .map(m => m[1]))
    expect([...rows].sort(), 'an indicator row does not consult engineInert — a lie about '
      + 'that id would be invisible, which is how this file went vacuous').toEqual([...wired].sort())
    // `disabled` and `title` must name the SAME predicate — the component's own
    // rail ("THE SAME PREDICATE AS `engineInert`"). A row greyed without the
    // tooltip is the original half-fix all over again.
    const titled = new Set([...src.matchAll(/inertTitle\('([a-zA-Z]+)'/g)].map(m => m[1]))
    expect([...titled].sort(), 'a row is disabled with no explanation, or explained but live')
      .toEqual([...wired].sort())
  })

  it('an instance the VALIDATOR drops is not REPORTED as drawn — the claim, moved down a level', async () => {
    // ⚠️ THIS CASE WENT VACUOUS AT TASK 11 AND HAS BEEN MOVED, NOT DELETED. It
    // asserted the row stayed WRITABLE when the instance was invalid — true, and
    // now true for every instance, valid or not, because `engineInert` is
    // identically false. A `.disabled === false` assertion cannot fail here any
    // more, which is the same shape as the Stoch vacuity this file just fixed.
    //
    // The claim it stood for lives one level down and is still falsifiable there:
    // `engineDrawnInputs` must not REPORT a dropped instance as drawn. Everything
    // that consumes it — the greyed-out treatment when it returns, the value the
    // row DISPLAYS today — is wrong if it does, and the row's displayed value is
    // asserted here too so this is not a pure unit test in a component file.
    const user = userEvent.setup()
    const cs = settingsWith({
      engineEnabled: true,
      indicatorInstances: [{ ...MACD_INSTANCE, inputs: { ...MACD_INSTANCE.inputs, bogus: 1 } }],
    })
    expect(engineDrawnInputs(cs, engineRegistry).has('macd'),
      'a record `normalizeInstances` refuses was reported as drawn').toBe(false)
    mount(cs, spy)
    await openPanel(user)
    const boxes = within(rowFor('MACD')).getAllByRole('spinbutton')
    expect(boxes[0].disabled).toBe(false)
    expect(boxes[0].value, 'the row showed a value from an instance nobody will draw').toBe('12')
  })

  it('⚠️ a flag-off blob shows the BLOB even for a FLIPPED id — a KNOWN divergence', () => {
    // ⛔ A REAL, DELIBERATE INCONSISTENCY, RECORDED RATHER THAN PAPERED OVER.
    // `engineDrawnInputs` returns nothing unless `cs.engineEnabled === true`
    // (`flipState.js`), so with the flag off the row falls back to the blob — but
    // `StockChart` DRAWS a flipped id regardless of that flag, from the stored
    // instance. So on a flag-off chart with a stored MACD instance the panel shows
    // 12/26/9 while the chart renders 5/35/4.
    //
    // It is carried, not fixed, because fixing it means changing
    // `engineDrawnInputs`' contract, which four other call sites share, inside a
    // task whose gate is that only two indicators move. It is narrow: the flag is
    // false for every existing user, and every existing user also has no stored
    // instance, so the fallback and the instance agree for all of them. It bites
    // the first user handed an `?instances=` link on a flag-off chart.
    //
    // Asserted as it SHIPS so the divergence is visible and so a fix is a
    // deliberate red rather than a surprise. Task 10's carry #4 is the same fact
    // seen from the other side ("engineDrawnInputs still reads
    // `cs.indicatorInstances` RAW, not through the migrator").
    const cs = settingsWith({ indicatorInstances: [MACD_INSTANCE] })
    expect(engineDrawnInputs(cs, engineRegistry).has('macd'),
      'the flag-off fallback changed — the panel and the chart may now agree, which is '
      + 'the FIX; delete this case and say so in the report').toBe(false)
    const user = userEvent.setup()
    mount(cs, spy)
    return openPanel(user).then(() => {
      const boxes = within(rowFor('MACD')).getAllByRole('spinbutton')
      expect(boxes[0].disabled).toBe(false)
      expect(boxes[0].value, 'the flag-off row must show the BLOB').toBe('12')
    })
  })
})
