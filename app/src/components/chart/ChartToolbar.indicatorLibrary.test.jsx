import { createRef } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChartToolbar from './ChartToolbar'
import { mergeChartSettings } from './chartDefaults'
import { AuthContext } from '../../context/AuthContext'
import { ENGINE_OWNED } from './engine/flipState'
import { isIndicatorEnabled } from './engine/instanceControls'

// ─── THE THREE DOORS ONTO THE LIBRARY, AND THE ONE MOUNT SITE THAT GETS NONE ─
//
// The dialog's own suite covers what it renders. What only this file can cover
// is the WIRING: a labelled button (spec §6, "not icon-only in v1"), the
// imperative door `Alt+Shift+A` will use, and the read-only mount-site rule.
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

const launcher = () => screen.getByRole('button', { name: /Indicators/ })

describe('ChartToolbar — the indicator library', () => {
  it('offers a LABELLED Indicators button, and it opens the library', async () => {
    const user = userEvent.setup()
    mount()
    // Not icon-only: the accessible name carries the WORD, which is what a user
    // hunting for "how do I add RSI" is scanning for.
    expect(launcher().textContent).toMatch(/\bIndicators\b/)
    expect(screen.queryByRole('searchbox')).toBeNull()
    await user.click(launcher())
    expect(screen.getByRole('searchbox')).toBeTruthy()
    expect(screen.getAllByRole('option').length).toBeGreaterThan(10)
  })

  it('adds an indicator end to end, through the toolbar\'s own settings writer', async () => {
    const user = userEvent.setup()
    const { onUpdateSettings } = mount()
    await user.click(launcher())
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
    expect(screen.queryByRole('button', { name: /Indicators/ })).toBeNull()
    // …and the IMPERATIVE door — the one `Alt+Shift+A` will call — refuses too,
    // reporting the refusal rather than silently no-opping.
    expect(ref.current.openIndicatorLibrary()).toBe(false)
    expect(screen.queryByRole('searchbox')).toBeNull()
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
