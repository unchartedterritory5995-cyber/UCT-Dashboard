import { createRef } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChartToolbar from './ChartToolbar'
import { mergeChartSettings } from './chartDefaults'
import { AuthContext } from '../../context/AuthContext'
import { ENGINE_OWNED } from './engine/flipState'
import { isIndicatorEnabled } from './engine/instanceControls'

// ─── THE DOORS ONTO THE LIBRARY, AND THE ONE MOUNT SITE THAT GETS NONE ──────
//
// The dialog's own suite covers what it renders. What only this file can cover
// is the WIRING: the imperative door `Alt+Shift+A` uses, the builder door the
// consolidated Chart Settings → Indicators tab uses, and the read-only
// mount-site rule.
//
// ⚰️ A LABELLED TOOLBAR BUTTON WAS THE FIRST DOOR, AND IT IS RETIRED. Spec §6
// asked for one ("not icon-only in v1") because the add-flow had no other home;
// `ChartSettingsModal` → Indicators IS that home now — same catalogue, same
// `matches()` search, same `toggledRow` write, plus the settings for what is
// already on. Two labelled entry points onto one job is the split the
// consolidation ends. The library COMPONENT stays, because the chords, the two
// right-click rows and the phone ƒx sheet still open it; only the button went.
//
// ⚠️ THE READ-ONLY RULE IS THE ONE THAT COULD SILENTLY BE WRONG. The shipped
// `Alt+Shift+A` branch is guarded by `typeof onOpenSettings === 'function'`, so
// on a mount site that passes no handler the key did nothing. Its successor must
// keep that property, and BOTH directions are asserted — a gate nobody has seen
// refuse is not a gate.

const base = () => mergeChartSettings(null)

function mount({ settings = base(), onUpdateSettings = vi.fn(), ref } = {}) {
  render(
    <AuthContext.Provider value={{ isPaid: true, user: null, loading: false }}>
      <ChartToolbar
        ref={ref}
        activeTool="cursor"
        setActiveTool={() => {}}
        chartSettings={settings}
        onUpdateSettings={onUpdateSettings}
      />
    </AuthContext.Provider>,
  )
  return { onUpdateSettings }
}

describe('ChartToolbar — the indicator library', () => {
  it('⛔ NO labelled Indicators button — Chart Settings → Indicators is the one home', async () => {
    // ⚰️ THIS CASE USED TO DEMAND THE OPPOSITE. See the header: the button is
    // retired because the settings tab is the add-flow now. What still has to be
    // true — and is asserted here — is that the library is REACHABLE and renders
    // everything it always did, because the chords and menus still open it.
    const ref = createRef()
    mount({ ref })
    expect(screen.queryByRole('button', { name: /^Indicators$/ }),
      'the retired toolbar Indicators button is back — there are two homes again').toBeNull()
    expect(screen.queryByRole('searchbox')).toBeNull()

    expect(ref.current.openIndicatorLibrary()).toBe(true)
    expect(await screen.findByRole('searchbox')).toBeTruthy()
    expect(screen.getAllByRole('option').length).toBeGreaterThan(10)
  })

  it('adds an indicator end to end, through the toolbar\'s own settings writer', async () => {
    const user = userEvent.setup()
    const ref = createRef()
    const { onUpdateSettings } = mount({ ref })
    ref.current.openIndicatorLibrary()
    await screen.findByRole('searchbox')
    await user.click(screen.getByRole('option', { name: /Average True Range/ }))
    expect(onUpdateSettings).toHaveBeenCalledTimes(1)
    const next = onUpdateSettings.mock.calls[0][0]
    expect(isIndicatorEnabled(next, 'atr', ENGINE_OWNED)).toBe(true)
    expect(next.indicatorInstances.some((i) => i && i.defId === 'atr' && !i.deleted)).toBe(true)
    expect(next.preset).toBe('custom')
    // …add-and-stay-open survives the round trip through the real toolbar.
    expect(screen.getByRole('searchbox')).toBeTruthy()
  })

  it('⛔ a READ-ONLY mount site gets no button and no library — both directions', () => {
    const ref = createRef()
    render(
      <AuthContext.Provider value={{ isPaid: true, user: null, loading: false }}>
        {/* No `onUpdateSettings`: the mount-site signal the settings gear already
            uses. A chart nobody can change must not sprout an add-dialog. */}
        <ChartToolbar ref={ref} activeTool="cursor" setActiveTool={() => {}} chartSettings={base()} />
      </AuthContext.Provider>,
    )
    // The IMPERATIVE doors — the one `Alt+Shift+A` calls and the one Chart
    // Settings → Indicators → "New Formula" calls — refuse, and REPORT the
    // refusal rather than silently no-opping.
    expect(ref.current.openIndicatorLibrary()).toBe(false)
    expect(ref.current.openFormulaBuilder()).toBe(false)
    expect(screen.queryByRole('searchbox')).toBeNull()
  })

  it('⭐ opens the ONE mounted builder through `openFormulaBuilder`', async () => {
    // The door Chart Settings → Indicators → "New Formula" travels down:
    // `ChartPane` holds the toolbar API, `StockChart` publishes into it, and the
    // sheet itself is mounted HERE and nowhere else (an AST rail in
    // `BuilderSheet.test.jsx` fails the build on a second element). A launcher
    // that reported success while opening nothing is the defect this pins.
    const ref = createRef()
    mount({ ref })
    expect(ref.current.openFormulaBuilder()).toBe(true)
    // The sheet is `lazy()` — deliberately, so the two translators stay out of
    // the chunk every StockChart in the app loads — so this awaits the chunk.
    expect(await screen.findByText('New formula', {}, { timeout: 5000 })).toBeTruthy()
  })

  it('…and a MANAGED mount site opens it through the same imperative door', async () => {
    const ref = createRef()
    mount({ ref })
    expect(ref.current.openIndicatorLibrary()).toBe(true)
    expect(await screen.findByRole('searchbox')).toBeTruthy()
  })

  it('🐛 a click inside the library does not close the settings panel underneath', async () => {
    // ⚠️ THE PORTAL TRAP, AND WHY THIS USES `userEvent`. `Sheet` renders into
    // `document.body`, and the panel's close-on-outside handler asks
    // `settingsRef.contains(e.target)` — every dialog node is outside it by
    // construction. Without `PORTAL_POPUP_ATTR` the mousedown of the click that
    // adds an indicator closes the panel, which is precisely the bug that made
    // every colour swatch in this panel unusable in production.
    //
    // ⛔ `fireEvent.click` SENDS NO MOUSEDOWN and passes on the broken build.
    const user = userEvent.setup()
    const ref = createRef()
    const { onUpdateSettings } = mount({ ref })
    await user.click(screen.getByTitle('Chart Settings'))
    expect(screen.getByText('Preset'), 'the settings panel did not open').toBeTruthy()

    // Opened through the imperative door on purpose: the toolbar BUTTON calls
    // `closeOthers`, which would close the panel for an unrelated reason and make
    // this case unable to fail.
    ref.current.openIndicatorLibrary()
    const row = await screen.findByRole('option', { name: /Average True Range/ })
    await user.click(row)

    expect(screen.queryByText('Preset'),
      'the settings panel closed on the mousedown of a click inside a portaled dialog').toBeTruthy()
    expect(onUpdateSettings, 'the click was swallowed by the closing panel').toHaveBeenCalledTimes(1)
  })
})
