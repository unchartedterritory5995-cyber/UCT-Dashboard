// ─── A CONTROL THAT CANNOT DO ANYTHING MUST NOT LOOK LIKE IT CAN ────────────
//
// B3 Flip A hands an indicator's DRAWING to the engine, which reads its period
// and colour from the INSTANCE. These settings rows keep writing
// `cs.indicators.<id>.<field>`, which the engine never consults — so typing 7
// into RSI's period box moved nothing on the chart and said nothing about why.
// The `enabled` checkbox is different and must keep working: under Flip A the
// legacy toggle is still the SWITCH (StockChart projects an instance whose
// toggle is off to `hidden`), which is what makes Ctrl+I and this checkbox real.
//
// ⚠️ NEVER use fireEvent.click to assert a disabled control is inert — it
// dispatches a raw MouseEvent straight at the node, bypassing the `disabled`
// check no real browser bypasses, and React's ChangeEventPlugin then turns it
// into onChange. Use userEvent and/or the native element.click().
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChartToolbar from './ChartToolbar'
import { mergeChartSettings } from './chartDefaults'
import { AuthContext } from '../../context/AuthContext'

const RSI_INSTANCE = {
  instanceId: 'legacy:rsi', defId: 'rsi', defVersion: 1,
  inputs: { period: 14, color: '#7b68ee' }, placement: { target: 'pane' }, hidden: false,
}

const settingsWith = (over) => mergeChartSettings(JSON.stringify({
  indicators: { rsi: { enabled: true }, stoch: { enabled: true } },
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

// ── AND IT MUST SHOW WHAT IS ACTUALLY ON THE CHART ──────────────────────────
//
// Greying the box was half the honesty fix. The greyed box still read
// `cs.indicators.rsi.period`, so a user on an `?instances=` chart saw a disabled
// **14** in the settings panel while `readout.js`' `chipLabel` printed
// **RSI(7)** in the legend, in a colour this swatch was not showing. Two numbers
// for one line, with a tooltip next to the wrong one explaining that this field
// is not the authority.
const RSI_INSTANCE_7 = {
  instanceId: 'legacy:rsi', defId: 'rsi', defVersion: 1,
  inputs: { period: 7, color: '#ff0000' }, placement: { target: 'pane' }, hidden: false,
}

describe('ChartToolbar — an inert row shows the INSTANCE value, not the blob', () => {
  it('the disabled period box and swatch print what the engine is rendering', async () => {
    const user = userEvent.setup()
    // The blob says 14 / #7b68ee; the instance the engine draws says 7 / red.
    mount(settingsWith({
      indicators: { rsi: { enabled: true, period: 14, color: '#7b68ee' } },
      engineEnabled: true,
      indicatorInstances: [RSI_INSTANCE_7],
    }), vi.fn())
    await openPanel(user)
    const row = rowFor('RSI')
    expect(periodBox(row).disabled).toBe(true)
    expect(periodBox(row).value, 'the greyed box is showing the blob, not the chart').toBe('7')
    expect(swatch(row).style.background).toBe('rgb(255, 0, 0)')
  })

  it('…and the blob still says 14, so this is a DISPLAY fix and not a write', async () => {
    // The row is read-only under Flip A; nothing here may have reached back into
    // `cs`. `instanceControls` (Task 9) is the writer, and it does not exist yet.
    const user = userEvent.setup()
    const spy = vi.fn()
    const cs = settingsWith({
      indicators: { rsi: { enabled: true, period: 14, color: '#7b68ee' } },
      engineEnabled: true,
      indicatorInstances: [RSI_INSTANCE_7],
    })
    mount(cs, spy)
    await openPanel(user)
    expect(cs.indicators.rsi.period).toBe(14)
    expect(spy).not.toHaveBeenCalled()
  })

  it('two instances of one definition: the row shows the FIRST, which is what draws first', async () => {
    // A settings row is per-DEFINITION and can only show one number. First-in-list
    // is the binder's own draw order, so the row names the first line the user
    // sees rather than an arbitrary one. Pinned because the docstring claims it.
    const user = userEvent.setup()
    mount(settingsWith({
      indicators: { rsi: { enabled: true, period: 14, color: '#7b68ee' } },
      engineEnabled: true,
      indicatorInstances: [
        RSI_INSTANCE_7,
        { ...RSI_INSTANCE_7, instanceId: 'second:rsi', inputs: { period: 50, color: '#00ff00' } },
      ],
    }), vi.fn())
    await openPanel(user)
    const row = rowFor('RSI')
    expect(periodBox(row).value).toBe('7')
  })

  it('a VALID instance of an UN-MIGRATED definition leaves that row fully live', async () => {
    // The `ENGINE_MIGRATED_DEF_IDS` filter is what stops a stored instance from
    // greying a control that still works. Drop the filter and the row greys out
    // while the chart keeps obeying it — a working control that looks dead, which
    // is the same lie as a dead control that looks working, in the other direction.
    //
    // ⚠️ THE SUBJECT HAS TO BE A ROW THAT *HAS* A `disabled`. This has now been
    // wrong twice: the first draft used Stoch, whose row has no `disabled` at all,
    // so the mutation was invisible and the case passed vacuously; the second used
    // MACD, which B3 Task 6 then MIGRATED, and the case went red the moment the
    // id joined the set. **VWAP is the last un-migrated definition wired to
    // `engineInert`** (all four B3 pilots are, so Tasks 10-11 inherit the
    // treatment), and its control is the colour swatch rather than a period box.
    //
    // ⏳ IT EXPIRES AT **TASK 8**, NOT TASK 11 — this comment used to say 11, and
    // that was three tasks of false safety. `ENGINE_MIGRATED_DEF_IDS` gains an id
    // at FLIP A, not Flip B: that is how it gained `macd` in Task 6, and Task 8
    // ("VWAP eligibility + Flip A") states `Set(['rsi','bb','macd','vwap'])` in
    // its own Interfaces. Audited by B3 Task 7.
    //
    // ⚠️ AND THE OBVIOUS FIX WILL NOT BE AVAILABLE. "Give it a new subject"
    // assumes an un-migrated definition is still wired to `engineInert`; after
    // Task 8 there is none — the toolbar wires exactly rsi/macd/bb/vwap, and all
    // four will be migrated. Stoch is not a substitute: its row has no `disabled`
    // at all, which is what made the first draft vacuous. So Task 8 has to move
    // this control DOWN a level — assert `flipState.engineDrawnDefIds` drops an
    // instance whose `defId` is outside `ENGINE_MIGRATED_DEF_IDS` — rather than
    // look for another row to point at.
    const user = userEvent.setup()
    mount(settingsWith({
      indicators: { rsi: { enabled: true }, vwap: { enabled: true, color: '#26C6DA' } },
      engineEnabled: true,
      indicatorInstances: [{
        instanceId: 'legacy:vwap', defId: 'vwap', defVersion: 1,
        inputs: { color: '#ff0000' }, placement: { target: 'price' }, hidden: false,
      }],
    }), vi.fn())
    await openPanel(user)
    const row = rowFor('VWAP')
    const box = swatch(row)
    expect(box.disabled, 'an un-migrated definition greyed its own live control').toBe(false)
    expect(box.getAttribute('title')).not.toMatch(ENGINE_TITLE)
    // …and it shows the BLOB, not the instance: the blob is what draws it.
    expect(box.style.background).toBe('rgb(38, 198, 218)')
  })

  it('MACD is MIGRATED: all three period boxes are inert and show the INSTANCE', async () => {
    // The other side of the same filter, for B3 Task 6's subject. MACD is the
    // only pilot with THREE numeric inputs, so a `shownInput` wired to one of them
    // and not the others is a real shape of half-fix — three boxes, one telling
    // the truth.
    const user = userEvent.setup()
    mount(settingsWith({
      indicators: { rsi: { enabled: true }, macd: { enabled: true, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 } },
      engineEnabled: true,
      indicatorInstances: [{
        instanceId: 'legacy:macd', defId: 'macd', defVersion: 2,
        inputs: { fastPeriod: 5, slowPeriod: 35, signalPeriod: 4 },
        placement: { target: 'pane' }, hidden: false,
      }],
    }), vi.fn())
    await openPanel(user)
    const boxes = within(rowFor('MACD')).getAllByRole('spinbutton')
    expect(boxes).toHaveLength(3)
    expect(boxes.map(b => b.disabled)).toEqual([true, true, true])
    expect(boxes.map(b => b.value),
      'a greyed box is showing the blob, not what the engine is drawing').toEqual(['5', '35', '4'])
    for (const b of boxes) expect(b.getAttribute('title')).toMatch(ENGINE_TITLE)
  })

  it('a LIVE row is untouched: no instance ⇒ the blob is still what it shows', async () => {
    const user = userEvent.setup()
    mount(settingsWith({
      indicators: { rsi: { enabled: true, period: 21, color: '#7b68ee' } },
    }), vi.fn())
    await openPanel(user)
    const row = rowFor('RSI')
    expect(periodBox(row).disabled).toBe(false)
    expect(periodBox(row).value).toBe('21')
  })

  it('an instance whose inputs OMIT a field falls back to the blob for that field only', async () => {
    // `normalizeInstances` fills declared defaults, so this is really about a
    // field the definition does not declare at all — the fallback must not turn
    // into `undefined` and make React drop to an uncontrolled input.
    const user = userEvent.setup()
    mount(settingsWith({
      indicators: { bb: { enabled: true, period: 20, stdDev: 2, color: 'rgba(156,39,176,0.85)' } },
      engineEnabled: true,
      indicatorInstances: [{
        instanceId: 'legacy:bb', defId: 'bb', defVersion: 1,
        inputs: { period: 34 }, placement: { target: 'price' }, hidden: false,
      }],
    }), vi.fn())
    await openPanel(user)
    const row = rowFor('BB')
    const boxes = within(row).getAllByRole('spinbutton')
    expect(boxes[0].disabled).toBe(true)
    expect(boxes[0].value, 'BB period comes from the instance').toBe('34')
    // stdDev is declared with a default, so the normaliser supplies 2 — either
    // way the box must show a real number and stay controlled.
    expect(boxes[1].value).not.toBe('')
  })
})

describe('ChartToolbar — the period and colour rows an engine-drawn indicator makes inert', () => {
  let spy
  beforeEach(() => { spy = vi.fn() })

  it('engine OFF: RSI\'s period and colour are live, and say nothing about an engine', async () => {
    const user = userEvent.setup()
    mount(settingsWith(), spy)
    await openPanel(user)
    const row = rowFor('RSI')
    expect(periodBox(row).disabled).toBe(false)
    expect(periodBox(row).getAttribute('title')).toBe('Period')
    expect(swatch(row).disabled).toBe(false)
  })

  it('engine ON and drawing RSI: period and colour are disabled and SAY WHY', async () => {
    const user = userEvent.setup()
    mount(settingsWith({ engineEnabled: true, indicatorInstances: [RSI_INSTANCE] }), spy)
    await openPanel(user)
    const row = rowFor('RSI')
    expect(periodBox(row).disabled, 'RSI period is still writable and still ignored').toBe(true)
    expect(periodBox(row).getAttribute('title')).toMatch(ENGINE_TITLE)
    expect(swatch(row).disabled, 'the colour swatch is still clickable and still ignored').toBe(true)
    expect(swatch(row).getAttribute('title')).toMatch(ENGINE_TITLE)
  })

  it('…and neither one can be made to write, by pointer or by keyboard', async () => {
    const user = userEvent.setup()
    mount(settingsWith({ engineEnabled: true, indicatorInstances: [RSI_INSTANCE] }), spy)
    await openPanel(user)
    const row = rowFor('RSI')

    await user.type(periodBox(row), '7')
    periodBox(row).click()
    await user.click(swatch(row))
    swatch(row).click()

    expect(spy, 'a disabled control wrote settings').not.toHaveBeenCalled()
    // The picker must not even OPEN — a popup whose choice is discarded is the
    // same lie one layer down. Its hex field is the tell (it portals to <body>,
    // so `screen`, not `within(row)`).
    expect(screen.queryByPlaceholderText('#hex'), 'the colour picker opened anyway').toBeNull()
  })

  it('the ENABLE checkbox stays live — it is Flip A\'s actual switch', async () => {
    const user = userEvent.setup()
    mount(settingsWith({ engineEnabled: true, indicatorInstances: [RSI_INSTANCE] }), spy)
    await openPanel(user)
    const box = within(rowFor('RSI')).getByRole('checkbox')
    expect(box.disabled).toBe(false)
    await user.click(box)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0][0].indicators.rsi.enabled).toBe(false)
  })

  it('a NON-migrated indicator keeps every control, engine on or off', async () => {
    // If this greyed out too, one flip would silence fourteen indicators' settings.
    const user = userEvent.setup()
    mount(settingsWith({ engineEnabled: true, indicatorInstances: [RSI_INSTANCE] }), spy)
    await openPanel(user)
    const row = rowFor('Stoch')
    expect(periodBox(row).disabled).toBe(false)
    expect(swatch(row).disabled).toBe(false)
  })

  it('an instance the VALIDATOR drops leaves the controls alone', async () => {
    // `bogus` is not a declared RSI input, so `normalizeInstances` refuses the
    // record and the engine draws nothing. Greying the row for an instance
    // nobody is going to draw is the same lie in the other direction.
    const user = userEvent.setup()
    mount(settingsWith({
      engineEnabled: true,
      indicatorInstances: [{ ...RSI_INSTANCE, inputs: { ...RSI_INSTANCE.inputs, bogus: 1 } }],
    }), spy)
    await openPanel(user)
    const row = rowFor('RSI')
    expect(periodBox(row).disabled).toBe(false)
    expect(swatch(row).disabled).toBe(false)
  })

  it('instances stored while the FLAG is off change nothing', async () => {
    // The realistic pre-flip state: migrated instances in the blob, engine dark.
    // The legacy blocks still draw, so the legacy fields still drive them.
    const user = userEvent.setup()
    mount(settingsWith({ indicatorInstances: [RSI_INSTANCE] }), spy)
    await openPanel(user)
    const row = rowFor('RSI')
    expect(periodBox(row).disabled).toBe(false)
    expect(swatch(row).disabled).toBe(false)
  })
})
