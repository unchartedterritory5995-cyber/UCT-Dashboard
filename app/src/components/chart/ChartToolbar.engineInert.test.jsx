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
