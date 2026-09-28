// Switch — the semantics the primitive owns, asserted on the rendered DOM.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import Switch from './Switch'

afterEach(cleanup)
const one = (ui) => render(ui).container.firstChild

describe('Switch', () => {
  it('is a non-submitting button with role=switch and a knob', () => {
    const el = one(<Switch checked={false} />)
    expect(el.tagName).toBe('BUTTON')
    expect(el.getAttribute('type')).toBe('button')
    expect(el.getAttribute('role')).toBe('switch')
    expect(el.getAttribute('aria-checked')).toBe('false')
    expect(el.children).toHaveLength(1)
    expect(el.firstChild.tagName).toBe('SPAN')
  })

  it('composes classes with no trailing space, on and off', () => {
    expect(one(<Switch checked className="t" checkedClassName="on" />).getAttribute('class')).toBe('t on')
    cleanup()
    expect(one(<Switch checked={false} className="t" checkedClassName="on" />).getAttribute('class')).toBe('t')
    cleanup()
    expect(one(<Switch checked={false} />).hasAttribute('class')).toBe(false)
  })

  it('a caller cannot override the semantics it owns', () => {
    const el = one(<Switch checked type="submit" role="checkbox" aria-checked="mixed"><i /></Switch>)
    expect(el.getAttribute('type')).toBe('button')
    expect(el.getAttribute('role')).toBe('switch')
    expect(el.getAttribute('aria-checked')).toBe('true')
    expect(el.querySelector('i')).toBeNull()
  })

  it('forwards everything else — name, handler, disabled', () => {
    const onClick = vi.fn()
    const el = one(<Switch checked aria-label="Logos" title="t" disabled={false} onClick={onClick} />)
    expect(el.getAttribute('aria-label')).toBe('Logos')
    expect(el.getAttribute('title')).toBe('t')
    fireEvent.click(el)
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
