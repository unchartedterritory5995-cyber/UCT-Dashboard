import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ChartToolbar from './ChartToolbar'
import { mergeChartSettings } from './chartDefaults'
import { legendModeOf } from './legendMode'
import { AuthContext } from '../../context/AuthContext'

// ─── THE LEGEND BUTTON — ONE CLICK, ONE WRITE, ONE KEY ───────────────────────
//
// The mode was buried in Chart Settings → Header. This is its quick control: a
// three-state cycle button beside the magnet / extended-hours toggles.
//
// ⛔ THE SHARPEST ASSERTION HERE IS THE ONE ABOUT WHAT IT DOES **NOT** WRITE.
// `header.showLegend` is the legacy boolean the same fact used to live in, and
// "keep them in sync" is the obvious-looking thing to do. It is also the defect:
// two keys over one fact, and whichever a surface happens to read decides the
// answer. The write must touch `legendMode` and leave `showLegend` untouched.

const mount = (settings, onUpdateSettings) => render(
  <AuthContext.Provider value={{ isPaid: true, user: null, loading: false }}>
    <ChartToolbar
      activeTool="cursor"
      setActiveTool={() => {}}
      chartSettings={settings}
      onUpdateSettings={onUpdateSettings}
    />
  </AuthContext.Provider>,
)

/** The button, found by the role+name a user would reach for — never a class. */
const legendBtn = () => screen.getByRole('button', { name: /legend/i })

describe('ChartToolbar — the legend mode button', () => {
  let spy
  beforeEach(() => { cleanup(); spy = vi.fn() })

  it('renders, and its title names the mode the chart is in', () => {
    mount(mergeChartSettings({ header: { legendMode: 'always' } }), spy)
    expect(legendBtn().getAttribute('title')).toMatch(/always/i)
  })

  it('⭐ carries a VISIBLE text label — the owner could not find it as a bare icon', () => {
    // 🔴 MEASURED IN PRODUCTION 2026-08-16: shipped as a 15px monochrome eye in a
    // row of seven near-identical unlabelled icons, and the person who ASKED for
    // the feature reported it missing while looking straight at it. A control
    // nobody can find is not shipped. The sibling extended-hours toggle in this
    // same toolbar has always used TEXT (`EXT`/`RTH`) for exactly this reason:
    // a mode has to announce itself.
    //
    // ⚠️ Asserted on RENDERED TEXT, not on a class or a `title` — a tooltip is
    // invisible until you already suspect the button is there, which is the
    // failure being fixed.
    mount(mergeChartSettings({ header: { legendMode: 'always' } }), spy)
    expect(legendBtn().textContent.trim().toLowerCase()).toContain('legend')
  })

  it('the label does not turn into a second control — one click still cycles once', async () => {
    // A caption nested in the button must not swallow or double the click.
    const user = userEvent.setup()
    mount(mergeChartSettings({ header: { legendMode: 'always' } }), spy)
    await user.click(legendBtn())
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('cycles always -> hold', async () => {
    const user = userEvent.setup()
    mount(mergeChartSettings({ header: { legendMode: 'always' } }), spy)
    await user.click(legendBtn())
    expect(spy).toHaveBeenCalledTimes(1)
    expect(legendModeOf(spy.mock.calls[0][0])).toBe('hold')
  })

  it('cycles hold -> off', async () => {
    const user = userEvent.setup()
    mount(mergeChartSettings({ header: { legendMode: 'hold' } }), spy)
    await user.click(legendBtn())
    expect(legendModeOf(spy.mock.calls[0][0])).toBe('off')
  })

  it('cycles off -> always', async () => {
    const user = userEvent.setup()
    mount(mergeChartSettings({ header: { legendMode: 'off' } }), spy)
    await user.click(legendBtn())
    expect(legendModeOf(spy.mock.calls[0][0])).toBe('always')
  })

  it('writes legendMode and does NOT touch the legacy showLegend boolean', async () => {
    // ⚠️ THE FIXTURE IS CHOSEN SO THE ASSERTION CAN FAIL, and the first draft's
    // could not. It started from `showLegend: true` + `always`, so a "keep them
    // in sync" implementation writing `showLegend = (mode !== 'off')` would have
    // written `true` — the same value — and the test passed over the exact defect
    // it was written to catch. Measured, not reasoned about: the mutation was run.
    //
    // Starting from `showLegend: false` and cycling to a SHOWING mode makes the
    // two implementations disagree: a syncing one flips it to true, a correct one
    // leaves the legacy key exactly as it found it.
    const user = userEvent.setup()
    const before = mergeChartSettings({ header: { showLegend: false, legendMode: 'off' } })
    mount(before, spy)
    await user.click(legendBtn())
    const next = spy.mock.calls[0][0]
    expect(next.header.legendMode).toBe('always')
    expect(next.header.showLegend, 'the legacy boolean was rewritten — it is a read-only fallback')
      .toBe(false)
  })

  it('a LEGACY blob (showLegend:false, no mode) starts from off and cycles to always', async () => {
    // The migration path a real user arrives on: they turned the legend off
    // months ago via the settings checkbox and have never seen the new control.
    // The button must read their state through the same resolver the chart does,
    // or their first click lands somewhere arbitrary.
    const user = userEvent.setup()
    mount(mergeChartSettings({ header: { showLegend: false } }), spy)
    expect(legendBtn().getAttribute('title')).toMatch(/off/i)
    await user.click(legendBtn())
    expect(legendModeOf(spy.mock.calls[0][0])).toBe('always')
  })

  it('marks the settings blob custom, like every other toolbar write', async () => {
    const user = userEvent.setup()
    mount(mergeChartSettings({ header: { legendMode: 'always' }, preset: 'classic' }), spy)
    await user.click(legendBtn())
    expect(spy.mock.calls[0][0].preset).toBe('custom')
  })

  it('renders nothing when the host passes no settings writer', () => {
    // Read-only mounts (Model Book, grid cells) persist nothing — a button that
    // writes nowhere is worse than no button.
    render(
      <AuthContext.Provider value={{ isPaid: true, user: null, loading: false }}>
        <ChartToolbar activeTool="cursor" setActiveTool={() => {}} />
      </AuthContext.Provider>,
    )
    expect(screen.queryByRole('button', { name: /legend/i })).toBeNull()
  })
})
