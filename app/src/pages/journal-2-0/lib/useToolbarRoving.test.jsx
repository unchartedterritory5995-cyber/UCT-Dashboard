// The one-stop toolbar hook: the two cases its first user (a note chart's toolbar) does not
// have. The basic behaviour is tested there (WidgetEmbedView.toolbarOneStop.test.jsx).
//
//  1. A row can hold controls a stylesheet hides at this width. A hidden control must never
//     hold the stop: the whole row would drop out of the Tab order.
//  2. The hook can be switched off (the editor's phone Format panel keeps Tab inside the row),
//     and then every control is an ordinary Tab stop again.
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import useToolbarRoving from './useToolbarRoving'

afterEach(cleanup)

function Row({ enabled = true, hideFirst = false, orientation }) {
  const r = useToolbarRoving({ enabled, orientation })
  return (
    <div role="toolbar" aria-label="t" ref={r.ref} onKeyDown={r.onKeyDown} onFocus={r.onFocus}>
      <button type="button" data-hidden={hideFirst ? '' : undefined}>one</button>
      <button type="button">two</button>
      <button type="button">three</button>
    </div>
  )
}
const buttons = () => [...document.querySelectorAll('button')]
// Among the controls that are on screen. A hidden one cannot take focus whatever its tabindex.
const stops = () => buttons().filter((b) => !b.hasAttribute('data-hidden') && b.tabIndex === 0).map((b) => b.textContent)

// jsdom has no layout: give "shown" controls a box and "hidden" ones none, as a browser would.
function withLayout(fn) {
  const real = Element.prototype.getClientRects
  Element.prototype.getClientRects = function rects() {
    return this.hasAttribute('data-hidden') ? [] : [{ width: 10, height: 10 }]
  }
  try { return fn() } finally { Element.prototype.getClientRects = real }
}

describe('useToolbarRoving', () => {
  it('a hidden control never holds the stop, and the arrows pass over it', () => withLayout(() => {
    render(<Row hideFirst />)
    expect(stops()).toEqual(['two'])
    const [, two, three] = buttons()
    two.focus()
    fireEvent.keyDown(two, { key: 'ArrowLeft' })       // wraps to the last SHOWN control
    expect(document.activeElement).toBe(three)
    fireEvent.keyDown(three, { key: 'Home' })
    expect(document.activeElement).toBe(two)           // the first SHOWN control, not the hidden one
  }))

  it('CONTROL: with every control shown the first one holds the stop', () => withLayout(() => {
    render(<Row />)
    expect(stops()).toEqual(['one'])
  }))

  it('vertical (a list of rows): Down and Up move, Left and Right are left alone', () => {
    render(<Row orientation="vertical" />)
    const [one, two] = buttons()
    one.focus()
    fireEvent.keyDown(one, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(one)
    fireEvent.keyDown(one, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(two)
    fireEvent.keyDown(two, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(one)
    fireEvent.keyDown(one, { key: 'End' })
    expect(document.activeElement.textContent).toBe('three')
  })

  it('switched off, every control is an ordinary Tab stop again and the arrows do nothing', () => {
    const view = render(<Row />)
    expect(stops()).toEqual(['one'])
    view.rerender(<Row enabled={false} />)
    expect(buttons().every((b) => !b.hasAttribute('tabindex'))).toBe(true)
    const [one] = buttons()
    one.focus()
    fireEvent.keyDown(one, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(one)
    view.rerender(<Row />)
    expect(stops().length).toBe(1)
  })
})
