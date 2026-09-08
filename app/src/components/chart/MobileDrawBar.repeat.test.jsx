// @vitest-environment jsdom
/* MOB-06′ orphan · REPEAT — the state existed, the phone could not reach it.
 *
 * `repeatMode` and its localStorage persistence have shipped for waves. What
 * never shipped was the prop reaching `MobileDrawBar`, so a phone-only user was
 * locked to the default with no way to change it — an orphaned mobile task in
 * the exact sense the presentation contract defines.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import MobileDrawBar from './MobileDrawBar'

beforeEach(() => cleanup())

const draw = (props = {}) => {
  const setRepeatMode = vi.fn()
  const setActiveTool = vi.fn()
  const view = render(
    <MobileDrawBar
      open onClose={() => {}}
      activeTool={null} setActiveTool={setActiveTool}
      onUndo={() => {}} onRedo={() => {}}
      magnet={false} setMagnet={() => {}}
      repeatMode={false} setRepeatMode={setRepeatMode}
      {...props} />,
  )
  return { ...view, setRepeatMode }
}

describe('repeat on the phone drawing bar', () => {
  it('the control exists and reports its state', () => {
    draw()
    const btn = screen.getByLabelText('Repeat drawing: off')
    expect(btn.getAttribute('aria-pressed')).toBe('false')
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
    expect(screen.getByLabelText('Repeat drawing: on').getAttribute('aria-pressed')).toBe('true')
  })

  it('a host that does not supply the setter simply omits the control', () => {
    // Every other mount of this bar (there is one today, but the prop is
    // optional) must not render a toggle wired to nothing.
    render(
      <MobileDrawBar open onClose={() => {}} activeTool={null} setActiveTool={() => {}}
        onUndo={() => {}} onRedo={() => {}} magnet={false} setMagnet={() => {}} />,
    )
    expect(screen.queryByLabelText(/Repeat drawing/)).toBeNull()
  })

  it('it sits beside Magnet — related actions live together', () => {
    draw()
    const bar = screen.getByTestId('mobile-draw-bar')
    const labels = [...bar.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))
    const m = labels.indexOf('Snap to price')
    const r = labels.findIndex((l) => /Repeat drawing/.test(l || ''))
    expect(m).toBeGreaterThan(-1)
    expect(r).toBe(m + 1)
  })
})
