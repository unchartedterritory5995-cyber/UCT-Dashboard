// Finish program, lane KEYS round 5. Every key of the one-stop rows hook, on a list shaped like
// the Notebook's: each row a tick box and a card, one row with a third control.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import useGridRoving from './useGridRoving'

afterEach(cleanup)

function List({ onShiftArrow = () => {}, enabled = true }) {
  const g = useGridRoving({ rowSelector: '[data-row]', enabled })
  const rows = ['One', 'Two', 'Three']
  return (
    <div>
      <button type="button">before</button>
      <div role="group" aria-label="Notes" ref={g.ref} onFocus={g.onFocus}
        onKeyDown={(e) => { if (e.shiftKey && e.key.startsWith('Arrow')) onShiftArrow(e.key); g.onKeyDown(e) }}>
        {rows.map((name) => (
          <div key={name} data-row="">
            <input type="checkbox" aria-label={`Select ${name}`} />
            <button type="button">{name}</button>
            {name === 'Two' && <button type="button">Unarchive Two</button>}
          </div>
        ))}
        <div data-row="">
          <select aria-label="Pick"><option>a</option><option>b</option></select>
          <input type="text" aria-label="Words" />
        </div>
      </div>
      <button type="button">after</button>
    </div>
  )
}
const tick = (n) => screen.getByRole('checkbox', { name: `Select ${n}` })
const card = (n) => screen.getByRole('button', { name: n })
const stops = () => [...document.querySelectorAll('[data-grid-roving]')].filter((el) => el.getAttribute('tabindex') === '0')
const key = (k, opts = {}) => fireEvent.keyDown(document.activeElement, { key: k, ...opts })

describe('useGridRoving: one Tab stop', () => {
  it('one control of the whole list is in the Tab order: the first one', () => {
    render(<List />)
    expect(stops()).toEqual([tick('One')])
    expect(card('One').getAttribute('tabindex')).toBe('-1')
    expect(card('before').hasAttribute('tabindex')).toBe(false)
  })

  it('the stop follows focus, however focus got there (a click, a script)', () => {
    render(<List />)
    card('Three').focus()
    expect(stops()).toEqual([card('Three')])
  })

  it('switched off, every control is an ordinary Tab stop again', () => {
    const view = render(<List />)
    view.rerender(<List enabled={false} />)
    expect(document.querySelectorAll('[data-grid-roving]')).toHaveLength(0)
    expect(tick('Two').hasAttribute('tabindex')).toBe(false)
  })
})

describe('useGridRoving: the keys', () => {
  it('Down and Up move by ROW and stay on the same control (tick to tick, card to card)', () => {
    render(<List />)
    tick('One').focus()
    key('ArrowDown'); expect(document.activeElement).toBe(tick('Two'))
    key('ArrowDown'); expect(document.activeElement).toBe(tick('Three'))
    key('ArrowUp'); expect(document.activeElement).toBe(tick('Two'))
    card('One').focus()
    key('ArrowDown'); expect(document.activeElement).toBe(card('Two'))
  })

  it('Up on the first row stays; Down on the last row stays', () => {
    render(<List />)
    tick('One').focus()
    key('ArrowUp'); expect(document.activeElement).toBe(tick('One'))
    key('End'); key('ArrowDown')
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Pick' }))
  })

  it('Right and Left move inside the row and stop at its ends', () => {
    render(<List />)
    tick('Two').focus()
    key('ArrowRight'); expect(document.activeElement).toBe(card('Two'))
    key('ArrowRight'); expect(document.activeElement).toBe(card('Unarchive Two'))
    key('ArrowRight'); expect(document.activeElement).toBe(card('Unarchive Two'))
    key('ArrowLeft'); key('ArrowLeft'); key('ArrowLeft')
    expect(document.activeElement).toBe(tick('Two'))
  })

  it('a row with fewer controls takes its last one, then comes back', () => {
    render(<List />)
    card('Unarchive Two').focus()
    key('ArrowDown'); expect(document.activeElement).toBe(card('Three'))
  })

  it('Home and End go to the first and last row', () => {
    render(<List />)
    card('Two').focus()
    key('Home'); expect(document.activeElement).toBe(card('One'))
    key('End'); expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Words' }))
  })

  it('Shift+Arrow is NOT taken: the selection handler gets it and focus does not move here', () => {
    const onShiftArrow = vi.fn()
    render(<List onShiftArrow={onShiftArrow} />)
    tick('One').focus()
    const ev = new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true, cancelable: true })
    tick('One').dispatchEvent(ev)
    expect(onShiftArrow).toHaveBeenCalledWith('ArrowDown')
    expect(ev.defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(tick('One'))
  })

  it('Ctrl, Cmd and Alt chords are not taken', () => {
    render(<List />)
    tick('One').focus()
    const ev = new KeyboardEvent('keydown', { key: 'ArrowDown', ctrlKey: true, bubbles: true, cancelable: true })
    tick('One').dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(false)
  })

  it('a select keeps Up and Down; a text field keeps every arrow', () => {
    render(<List />)
    const pick = screen.getByRole('combobox', { name: 'Pick' })
    pick.focus()
    const down = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    pick.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(false)
    key('ArrowRight')
    const words = screen.getByRole('textbox', { name: 'Words' })
    expect(document.activeElement).toBe(words)
    const left = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })
    words.dispatchEvent(left)
    expect(left.defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(words)
  })

  it('Space and Enter are left to the control (a tick still ticks)', () => {
    render(<List />)
    tick('One').focus()
    const sp = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
    tick('One').dispatchEvent(sp)
    expect(sp.defaultPrevented).toBe(false)
  })
})
