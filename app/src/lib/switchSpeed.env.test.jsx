// The switch-speed rails (lib/switchSpeed.test.js, hooks/useSymbolHandoff.switchSpeed*.test.jsx) dispatch real DOM
// events, and the instrument reads "the event in flight" (`window.event`) exactly as it does in a browser. This
// pins that the TEST ENVIRONMENT reports it the same way. Without it those rails would count every press
// `unpressed`, and be red for a reason that is not the product's.
import { describe, it, expect } from 'vitest'
import { render, fireEvent } from '@testing-library/react'

describe('the test environment reports the event in flight as a browser does', () => {
  it('window.event is the event being dispatched, with a time, and nothing outside a dispatch', () => {
    expect(window.event).toBeUndefined()
    let seen = null
    const ev = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
    document.body.addEventListener('keydown', () => { seen = window.event }, { once: true })
    document.body.dispatchEvent(ev)
    expect(seen).toBe(ev)
    expect(typeof ev.timeStamp).toBe('number')
    expect(ev.timeStamp).toBeGreaterThan(0)
    expect(window.event).toBeUndefined()
  })

  it('...and inside a React handler it is the native event of that handler', () => {
    const seen = []
    const view = render(<input data-testid="box" onKeyDown={(e) => { seen.push([window.event === e.nativeEvent, window.event?.type, window.event?.key, window.event?.target?.tagName]) }} />)
    fireEvent.keyDown(view.getByTestId('box'), { key: 'Enter' })
    expect(seen).toEqual([[true, 'keydown', 'Enter', 'INPUT']])
  })
})
