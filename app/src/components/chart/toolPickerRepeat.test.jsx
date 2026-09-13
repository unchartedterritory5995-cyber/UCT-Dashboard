// @vitest-environment jsdom
/* MOB-06′ orphan · REPEAT — the state existed, the phone could not reach it.
 *
 * `repeatMode` and its localStorage persistence have shipped for waves. What
 * never shipped was the prop reaching the phone at all, so a phone-only user was
 * locked to the default with no way to change it — an orphaned mobile task in
 * the exact sense the presentation contract defines.
 *
 * ⚠️ IT LIVES ON THE TOOLS SHEET, NOT THE DRAW BAR, AND THAT IS A MEASUREMENT
 * NOT A PREFERENCE. It shipped on the bar first; at 390px that left the tool
 * rail 51px wide — 0.98 of one tile, down from ~3 — because the side cluster is
 * `flex: 0 0 auto`. Every test still passed. Opening the artifact is what
 * caught it. It also belongs here by the grammar: "keep the tool armed" is a
 * mode you set once, and low-frequency configuration does not get to compete
 * with high-frequency tiles.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import MobileToolPicker from './MobileToolPicker'
import { DRAW_TOOLS } from './MobileDrawBar'

beforeEach(() => cleanup())

const draw = (props = {}) => {
  const setRepeatMode = vi.fn()
  const view = render(
    <MobileToolPicker
      open onClose={() => {}} tools={DRAW_TOOLS}
      activeTool={null} onPick={() => {}}
      repeatMode={false} setRepeatMode={setRepeatMode}
      {...props} />,
  )
  return { ...view, setRepeatMode }
}

describe('repeat on the phone Tools sheet', () => {
  it('the control exists and reports its state', () => {
    draw()
    // A CHECKBOX reports state through `checked`, not `aria-pressed` — the
    // control moved from a toggle BUTTON on the rail to a labelled settings row,
    // and the assertion follows the element rather than the other way round.
    const box = screen.getByLabelText('Repeat drawing: off')
    expect(box.type).toBe('checkbox')
    expect(box.checked).toBe(false)
  })

  it('tapping it flips the state through the host, not a local copy', () => {
    // ⛔ The bar PRESENTS state it does not own. A local `useState` here would
    // give the phone a second repeat flag that the overlay never reads — the
    // duplicate-state defect this programme keeps closing.
    const { setRepeatMode } = draw()
    fireEvent.click(screen.getByLabelText('Repeat drawing: off'))
    expect(setRepeatMode).toHaveBeenCalledWith(true)
  })

  it('an ON state is shown as ON', () => {
    draw({ repeatMode: true })
    expect(screen.getByLabelText('Repeat drawing: on').checked).toBe(true)
  })

  it('a host that does not supply the setter simply omits the control', () => {
    render(
      <MobileToolPicker open onClose={() => {}} tools={DRAW_TOOLS}
        activeTool={null} onPick={() => {}} />,
    )
    expect(screen.queryByLabelText(/Repeat drawing/)).toBeNull()
  })

  it('⛔ it is NOT a tile — a mode must not sit in the tool grid’s scanning path', () => {
    draw()
    const grid = screen.getByTestId('tool-grid')
    expect(grid.contains(screen.getByLabelText('Repeat drawing: off')),
      'the repeat toggle was rendered inside the tool grid').toBe(false)
  })
})
