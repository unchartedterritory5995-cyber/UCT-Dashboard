// ─── THE SHIPPED BUG: A COLOUR SWATCH THAT COULD NOT BE USED ────────────────
//
// Measured in B3 Task 9 and fixed here, INDEPENDENTLY OF THE ENGINE — it broke
// every colour control in the chart toolbar's inline settings panel for every
// user, migrated or not.
//
// `ChartToolbar` closes the settings panel on any `mousedown` outside
// `settingsRef`; `ColorPicker`'s popup is PORTALED to `document.body`, so it is
// outside by construction. Pressing a preset dispatched mousedown → the panel
// unmounted → the button was gone before `click` fired → `pick()` never ran and
// `onChange` never fired. Opening the picker always worked (the swatch itself is
// a real child of the panel), which is what made it read as a dead palette.
//
// ⚠️ THE ORDER OF EVENTS IS THE WHOLE TEST. `userEvent.click` sends
// pointerdown/mousedown/mouseup/click in the real order; `fireEvent.click` sends
// ONLY `click` and therefore passes on the BROKEN code. Both are used below —
// `fireEvent` as the negative control that proves the distinction is real, and
// `userEvent` as the gate. A future rewrite that swaps the gate to `fireEvent`
// silently un-tests the bug.
import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthContext } from '../../context/AuthContext'
import ChartToolbar from './ChartToolbar'
import { mergeChartSettings } from './chartDefaults'
import { PORTAL_POPUP_ATTR } from './ColorPicker'

const BASE = mergeChartSettings(JSON.stringify({
  // `atr` is deliberate: it is neither migrated nor flipped, so this file
  // measures the PANEL, not anything the engine does to a row — and its row
  // carries exactly ONE ColorPicker, so `.at(-1)` is unambiguous.
  indicators: { atr: { enabled: true, period: 14, color: '#FFA726' } },
}))

function mount(onUpdateSettings) {
  function Harness() {
    const [cs, setCs] = useState(BASE)
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
const panelIsOpen = () => screen.queryAllByText('Indicators', { selector: 'span' }).length > 0
/** The portaled popup, found through the CONTRACT the fix is built on rather
 *  than through a CSS-module class name that a rename would silently break. */
const popup = () => document.querySelector(`[${PORTAL_POPUP_ATTR}]`)

describe('the settings panel survives a click inside a portaled popup', () => {
  it('the picker OPENS — without this every case below is vacuous', async () => {
    const user = userEvent.setup()
    mount(vi.fn())
    await openPanel(user)
    expect(panelIsOpen()).toBe(true)
    await user.click(within(rowFor('ATR')).getAllByRole('button').at(-1))
    expect(popup(), 'the ColorPicker popup never opened').toBeTruthy()
    expect(popup().hasAttribute(PORTAL_POPUP_ATTR)).toBe(true)
    // …and it really is OUTSIDE the panel in the DOM, which is the premise.
    expect(document.body.contains(popup())).toBe(true)
    expect(screen.getByTitle('Chart Settings').closest('div').contains(popup()),
      'the popup is not portaled — this suite tests nothing').toBe(false)
  })

  it('⭐ a REAL click on a preset picks the colour AND leaves the panel open', async () => {
    // THE GATE. Reverting either half of the fix (the attribute on the popup, or
    // the `closest()` exemption in the handler) fails this and nothing else.
    const user = userEvent.setup()
    const spy = vi.fn()
    mount(spy)
    await openPanel(user)
    await user.click(within(rowFor('ATR')).getAllByRole('button').at(-1))
    const cell = within(popup()).getAllByTitle(/^#[0-9a-f]{6}$/i)[1]
    const picked = cell.getAttribute('title')
    expect(picked).toBeTruthy()

    await user.click(cell)

    expect(spy, 'the colour never reached onUpdateSettings — the panel closed on mousedown')
      .toHaveBeenCalled()
    expect(spy.mock.calls.at(-1)[0].indicators.atr.color).toBe(picked)
    expect(panelIsOpen(), 'the settings panel closed while the user was picking a colour').toBe(true)
  })

  it('the hex input can be typed into without the panel closing under the cursor', async () => {
    // The other half of the same popup, and a different event shape: focusing an
    // input is a mousedown too. Committing with the OK button is a second one.
    const user = userEvent.setup()
    const spy = vi.fn()
    mount(spy)
    await openPanel(user)
    await user.click(within(rowFor('ATR')).getAllByRole('button').at(-1))
    const hex = within(popup()).getByPlaceholderText('#hex')
    await user.clear(hex)
    await user.type(hex, '#123456')
    expect(popup(), 'the popup closed while the hex field was being typed into').toBeTruthy()
    await user.click(within(popup()).getByText('OK'))
    expect(spy.mock.calls.at(-1)[0].indicators.atr.color).toBe('#123456')
    expect(panelIsOpen()).toBe(true)
  })

  it('a mousedown genuinely OUTSIDE still closes the panel — the fix is not a mute', async () => {
    // ⚠️ The failure direction that a `return` in the wrong place would create: a
    // panel that never closes. The exemption is scoped to elements carrying the
    // attribute, so a plain body click must still dismiss.
    const user = userEvent.setup()
    mount(vi.fn())
    await openPanel(user)
    expect(panelIsOpen()).toBe(true)
    await user.click(document.body)
    expect(panelIsOpen(), 'the panel no longer closes on a real outside click').toBe(false)
  })

  it('NEGATIVE CONTROL: `fireEvent.click` alone cannot see this bug', async () => {
    // Proof that the gate above needed `userEvent`. `fireEvent.click` dispatches
    // no mousedown, so it reported a working picker on the broken build — which is
    // exactly how the defect survived a suite that already clicked colour cells.
    const user = userEvent.setup()
    const spy = vi.fn()
    mount(spy)
    await openPanel(user)
    await user.click(within(rowFor('ATR')).getAllByRole('button').at(-1))
    const cell = within(popup()).getAllByTitle(/^#[0-9a-f]{6}$/i)[1]
    fireEvent.click(cell)
    expect(spy).toHaveBeenCalled()
    expect(spy.mock.calls.at(-1)[0].indicators.atr.color).toBe(cell.getAttribute('title'))
  })
})
