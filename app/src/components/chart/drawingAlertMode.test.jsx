// @vitest-environment jsdom
/* MOB-05 — the menu offers BOTH semantics, and remembers which you meant.
 *
 * ⛔ THE DEFAULT IS THE DECISION HERE. An alert set ON a line is, to almost
 * everyone, an alert about THAT LINE — so "Follows the line" leads. The fixed
 * reading is not demoted to a preference buried in settings: it is the second
 * button, one tap away, and it remains the ONLY thing the seeded price-context
 * alerts do. Both intents stay expressible; neither is guessed at.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { DrawingContextMenu } from './ChartDrawingOverlay'

const LINE = { id: 'd1', type: 'trendline', points: [{ price: 100 }, { price: 110 }] }

const open = (onSetAlert = vi.fn()) => {
  const v = render(
    <DrawingContextMenu x={10} y={10} drawing={LINE} alertSupported onSetAlert={onSetAlert} onClose={() => {}} />,
  )
  fireEvent.click(screen.getByText('Set alert…'))
  return { v, onSetAlert }
}

beforeEach(() => { localStorage.clear(); cleanup() })

describe('the alert-mode segment', () => {
  it('offers both semantics, and follows-the-line leads', () => {
    open()
    const follows = screen.getByRole('radio', { name: /Follows the line/ })
    const fixed = screen.getByRole('radio', { name: /Fixed level/ })
    expect(follows).toHaveAttribute('aria-checked', 'true')
    expect(fixed).toHaveAttribute('aria-checked', 'false')
  })

  it('the default sends a BOUND alert', () => {
    const { onSetAlert } = open()
    fireEvent.click(screen.getByText('▲ Above'))
    expect(onSetAlert).toHaveBeenCalledWith('above', { bound: true })
  })

  it('choosing Fixed level sends a FIXED alert — the seeded semantics, kept', () => {
    const { onSetAlert } = open()
    fireEvent.click(screen.getByRole('radio', { name: /Fixed level/ }))
    fireEvent.click(screen.getByText('▼ Below'))
    expect(onSetAlert).toHaveBeenCalledWith('below', { bound: false })
  })

  it('remembers the choice, because a trader picks one meaning and stays there', () => {
    open()
    fireEvent.click(screen.getByRole('radio', { name: /Fixed level/ }))
    expect(localStorage.getItem('uct.chart.alertBind')).toBe('fixed')
    cleanup()
    const { onSetAlert } = open()
    expect(screen.getByRole('radio', { name: /Fixed level/ })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByText('▲ Above'))
    expect(onSetAlert).toHaveBeenCalledWith('above', { bound: false })
  })

  it('a shape with no level is offered no alert at all', () => {
    render(<DrawingContextMenu x={0} y={0} drawing={{ id: 'r', type: 'rect' }} alertSupported={false} onClose={() => {}} />)
    expect(screen.queryByText('Set alert…')).toBeNull()
  })

  it('survives localStorage being unavailable (private mode)', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    expect(() => open()).not.toThrow()
    expect(screen.getByRole('radio', { name: /Follows the line/ })).toHaveAttribute('aria-checked', 'true')
    spy.mockRestore()
  })
})
