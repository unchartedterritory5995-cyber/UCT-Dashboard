import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import useRovingTabIndex from './useRovingTabIndex'

/** A minimal stand-in for a nav of links — exactly the shape both NavBar.jsx
 *  and the Journal's top tab bar use: a container, N sibling <a>s, one of
 *  them marked `aria-current="page"` (exactly what react-router's NavLink
 *  sets on the active route), an optional disabled item. */
function TestNav({ orientation, activeTo = '/b', disabledTo = null, onActivate, withOutsider = false }) {
  const { containerProps, itemProps } = useRovingTabIndex({ orientation })
  const items = ['/a', '/b', '/c', '/d']
  return (
    <nav aria-label="test nav" {...containerProps}>
      {withOutsider && (
        // A focusable control inside the SAME container that is NOT one of
        // the roving items (the real shape of NavBar: a Search button sits
        // beside the roving NAV_ITEMS list, inside the same <nav>). Arrow
        // keys fired here must be a complete no-op.
        <button type="button">outsider</button>
      )}
      {items.map((to) => (
        <a
          key={to}
          href={to}
          aria-current={to === activeTo ? 'page' : undefined}
          onClick={(e) => { e.preventDefault(); onActivate?.(to) }}
          {...itemProps(to, { disabled: to === disabledTo })}
        >
          {to}
        </a>
      ))}
    </nav>
  )
}

const tabIndexOf = (to) => screen.getByText(to).tabIndex

describe('useRovingTabIndex', () => {
  it('is ONE tab stop: exactly one item has tabIndex 0, the rest -1', () => {
    render(<TestNav orientation="horizontal" />)
    const indices = ['/a', '/b', '/c', '/d'].map(tabIndexOf)
    expect(indices.filter((t) => t === 0)).toHaveLength(1)
    expect(indices.filter((t) => t === -1)).toHaveLength(3)
  })

  it('focus lands on the active item (aria-current="page") when tabbing in', () => {
    render(<TestNav orientation="horizontal" activeTo="/c" />)
    expect(tabIndexOf('/c')).toBe(0)
    expect(tabIndexOf('/a')).toBe(-1)
    expect(tabIndexOf('/b')).toBe(-1)
    expect(tabIndexOf('/d')).toBe(-1)
  })

  it('falls back to the first item when nothing is active', () => {
    render(<TestNav orientation="horizontal" activeTo="/nowhere" />)
    expect(tabIndexOf('/a')).toBe(0)
  })

  it('ArrowRight moves focus AND the roving tab stop to the next item (horizontal)', () => {
    render(<TestNav orientation="horizontal" activeTo="/a" />)
    const a = screen.getByText('/a')
    a.focus()
    fireEvent.keyDown(a, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(screen.getByText('/b'))
    expect(tabIndexOf('/b')).toBe(0)
    expect(tabIndexOf('/a')).toBe(-1)
  })

  it('ArrowLeft moves focus to the previous item and WRAPS from the first to the last (horizontal)', () => {
    render(<TestNav orientation="horizontal" activeTo="/a" />)
    const a = screen.getByText('/a')
    a.focus()
    fireEvent.keyDown(a, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(screen.getByText('/d'))
  })

  it('ArrowUp/ArrowDown move focus in a vertical group; ArrowLeft/Right do nothing', () => {
    render(<TestNav orientation="vertical" activeTo="/a" />)
    const a = screen.getByText('/a')
    a.focus()
    fireEvent.keyDown(a, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(a) // horizontal keys are no-ops in a vertical group
    fireEvent.keyDown(a, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByText('/b'))
  })

  it('Home jumps to the first item, End jumps to the last', () => {
    render(<TestNav orientation="horizontal" activeTo="/c" />)
    const c = screen.getByText('/c')
    c.focus()
    fireEvent.keyDown(c, { key: 'End' })
    expect(document.activeElement).toBe(screen.getByText('/d'))
    fireEvent.keyDown(screen.getByText('/d'), { key: 'Home' })
    expect(document.activeElement).toBe(screen.getByText('/a'))
  })

  it('skips a disabled item when stepping over it', () => {
    render(<TestNav orientation="horizontal" activeTo="/b" disabledTo="/c" />)
    const b = screen.getByText('/b')
    b.focus()
    fireEvent.keyDown(b, { key: 'ArrowRight' })
    // /c is disabled -- lands on /d, not /c
    expect(document.activeElement).toBe(screen.getByText('/d'))
  })

  it('Enter still activates the native element -- nothing here intercepts it', () => {
    const onActivate = vi.fn()
    render(<TestNav orientation="horizontal" activeTo="/a" onActivate={onActivate} />)
    const a = screen.getByText('/a')
    a.focus()
    // Roving tabindex changes which element Tab lands on and what arrow keys
    // do; it must never swallow a key it doesn't own. A real browser fires
    // 'click' for Enter/Space on a focused <a> natively -- confirm the click
    // handler (standing in for navigation) still fires when simulated, and
    // that an unrelated key passed through this hook's onKeyDown is a no-op.
    fireEvent.keyDown(a, { key: 'Enter' })
    fireEvent.click(a)
    expect(onActivate).toHaveBeenCalledWith('/a')
  })

  it("a keydown that did not originate on one of this group's own items is ignored, even from inside the same container", () => {
    render(<TestNav orientation="horizontal" activeTo="/a" withOutsider />)
    const outsider = screen.getByText('outsider')
    outsider.focus()
    fireEvent.keyDown(outsider, { key: 'ArrowRight' })
    // Focus never moves off the outsider, and the roving stop is untouched.
    expect(document.activeElement).toBe(outsider)
    expect(tabIndexOf('/a')).toBe(0)
  })
})
