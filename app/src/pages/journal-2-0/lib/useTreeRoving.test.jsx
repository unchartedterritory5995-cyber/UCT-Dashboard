// Finish program, lane KEYS round 4. Every key of the tree pattern, on a small real tree.
//
// The tree below is rendered by ordinary components with their own state, the way the folder
// panel is: a row opens because its toggle button was pressed, not because the hook said so.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import { useState } from 'react'
import useTreeRoving from './useTreeRoving'

afterEach(cleanup)

function Row({ name, level, children, onPick, selected }) {
  const [open, setOpen] = useState(false)
  const canOpen = Boolean(children)
  return (
    <div role="treeitem" aria-label={name} aria-level={level} aria-selected={selected ? 'true' : undefined}
      aria-expanded={canOpen ? String(open) : undefined}>
      {canOpen && <button type="button" tabIndex={-1} data-tree-toggle="" aria-label={`toggle ${name}`}
        onClick={() => setOpen((o) => !o)}>v</button>}
      <button type="button" tabIndex={-1} data-tree-primary="" onClick={() => onPick(name)}>{name}</button>
      <button type="button" tabIndex={-1} aria-label={`Delete ${name}`}>x</button>
      <input tabIndex={-1} aria-label={`Rename ${name}`} />
      {canOpen && open && <div role="group">{children}</div>}
    </div>
  )
}

function Tree({ onPick = () => {}, onMenu, selected }) {
  const t = useTreeRoving({ onMenu })
  return (
    <div>
      <button type="button">before</button>
      <div role="tree" aria-label="Folders" ref={t.ref} onKeyDown={t.onKeyDown} onFocus={t.onFocus}
        onContextMenu={t.onContextMenu}>
        <Row name="All notes" level={1} onPick={onPick} />
        <Row name="Alpha" level={1} onPick={onPick} selected={selected === 'Alpha'}>
          <Row name="Apple" level={2} onPick={onPick} />
          <Row name="Avocado" level={2} onPick={onPick}>
            <Row name="Deep" level={3} onPick={onPick} />
          </Row>
        </Row>
        <Row name="Beta" level={1} onPick={onPick} />
        <Row name="Banana" level={1} onPick={onPick} />
      </div>
      <button type="button">after</button>
    </div>
  )
}
const item = (name) => screen.getByRole('treeitem', { name })
const stops = () => screen.getAllByRole('treeitem').filter((el) => el.tabIndex === 0).map((el) => el.getAttribute('aria-label'))
const key = (k, opts = {}) => fireEvent.keyDown(document.activeElement, { key: k, ...opts })
const at = () => document.activeElement.getAttribute('aria-label')

describe('useTreeRoving: one Tab stop', () => {
  it('exactly one row is in the Tab order, and no control inside a row is', () => {
    render(<Tree />)
    expect(stops()).toEqual(['All notes'])
    expect(screen.getAllByRole('button').filter((b) => !['before', 'after'].includes(b.textContent))
      .every((b) => b.tabIndex === -1)).toBe(true)
  })

  it('the stop starts on the selected row when there is one', () => {
    render(<Tree selected="Alpha" />)
    expect(stops()).toEqual(['Alpha'])
  })

  it('the stop follows focus, and a click on a control inside a row makes that row the stop', () => {
    render(<Tree />)
    item('Beta').focus()
    expect(stops()).toEqual(['Beta'])
    screen.getByRole('button', { name: 'Delete Banana' }).focus()
    expect(stops()).toEqual(['Banana'])
  })
})

describe('useTreeRoving: the keys', () => {
  it('Down and Up move between the rows that are showing, and stop at the ends', () => {
    render(<Tree />)
    item('All notes').focus()
    key('ArrowDown'); expect(at()).toBe('Alpha')
    key('ArrowDown'); expect(at()).toBe('Beta')          // Alpha is closed: its children are skipped
    key('ArrowUp'); key('ArrowUp'); expect(at()).toBe('All notes')
    key('ArrowUp'); expect(at()).toBe('All notes')
  })

  it('Home and End go to the first and the last row showing', () => {
    render(<Tree />)
    item('Beta').focus()
    key('End'); expect(at()).toBe('Banana')
    key('ArrowDown'); expect(at()).toBe('Banana')
    key('Home'); expect(at()).toBe('All notes')
  })

  it('Right opens a closed row, then moves to its first child; on a leaf it does nothing', () => {
    render(<Tree />)
    item('Alpha').focus()
    key('ArrowRight')
    expect(item('Alpha').getAttribute('aria-expanded')).toBe('true')
    expect(at()).toBe('Alpha')
    key('ArrowRight'); expect(at()).toBe('Apple')
    key('ArrowRight'); expect(at()).toBe('Apple')
  })

  it('Left closes an open row; on a closed row or a leaf it moves to the parent', () => {
    render(<Tree />)
    item('Alpha').focus()
    key('ArrowRight'); key('ArrowRight'); key('ArrowDown')
    expect(at()).toBe('Avocado')
    key('ArrowRight'); key('ArrowRight'); expect(at()).toBe('Deep')
    key('ArrowLeft'); expect(at()).toBe('Avocado')        // leaf: to the parent
    key('ArrowLeft')                                       // open: close it
    expect(item('Avocado').getAttribute('aria-expanded')).toBe('false')
    expect(at()).toBe('Avocado')
    key('ArrowLeft'); expect(at()).toBe('Alpha')          // closed: to the parent
    key('ArrowLeft'); expect(item('Alpha').getAttribute('aria-expanded')).toBe('false')
    key('ArrowLeft'); expect(at()).toBe('Alpha')          // top level, closed: stays
  })

  it('opening a row puts its children into the Down and Up order', () => {
    render(<Tree />)
    item('Alpha').focus()
    key('ArrowRight'); key('ArrowDown'); expect(at()).toBe('Apple')
    key('ArrowDown'); expect(at()).toBe('Avocado')
    key('ArrowDown'); expect(at()).toBe('Beta')
  })

  it('Enter and Space press the row\'s own primary control, never a nested row\'s', () => {
    const onPick = vi.fn()
    render(<Tree onPick={onPick} />)
    item('Alpha').focus()
    key('ArrowRight')
    key('Enter'); key(' ')
    expect(onPick.mock.calls).toEqual([['Alpha'], ['Alpha']])
  })

  it('a letter moves to the next row starting with it; typing on extends the search', () => {
    render(<Tree />)
    item('All notes').focus()
    key('b'); expect(at()).toBe('Beta')
    key('a'); expect(at()).toBe('Banana')                  // "ba" within half a second
  })

  it('the same letter again, after a pause, steps to the next match and wraps', () => {
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValue(1000)
    render(<Tree />)
    item('All notes').focus()
    key('b'); expect(at()).toBe('Beta')
    now.mockReturnValue(3000); key('b'); expect(at()).toBe('Banana')
    now.mockReturnValue(5000); key('b'); expect(at()).toBe('Beta')
    now.mockRestore()
  })

  it('Shift+F10 and the context-menu key hand the row to onMenu', () => {
    const onMenu = vi.fn()
    render(<Tree onMenu={onMenu} />)
    item('Beta').focus()
    key('F10', { shiftKey: true })
    key('ContextMenu')
    expect(onMenu.mock.calls.map((c) => c[0].getAttribute('aria-label'))).toEqual(['Beta', 'Beta'])
  })

  it('the context menu of the browser is held back after the menu KEY, and left alone for a right-click', () => {
    render(<Tree onMenu={() => {}} />)
    item('Beta').focus()
    key('F10', { shiftKey: true })
    const fromKey = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    item('Beta').dispatchEvent(fromKey)
    expect(fromKey.defaultPrevented).toBe(true)
    // a right-click with no menu key before it: the browser's menu, as today
    cleanup()
    render(<Tree onMenu={() => {}} />)
    const fromMouse = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 })
    item('Beta').dispatchEvent(fromMouse)
    expect(fromMouse.defaultPrevented).toBe(false)
  })

  it('the arrows carry on from a row whose BUTTON has focus (a member who clicked a folder)', () => {
    const onPick = vi.fn()
    render(<Tree onPick={onPick} />)
    screen.getByRole('button', { name: 'Delete Beta' }).focus()
    key('ArrowDown'); expect(at()).toBe('Banana')
    screen.getByRole('button', { name: 'Delete Beta' }).focus()
    key('Enter')                                   // the button's own press, not the row's
    expect(onPick).not.toHaveBeenCalled()
  })

  it('a key pressed in a FIELD inside a row is left alone (a rename field keeps its keys)', () => {
    const onPick = vi.fn()
    render(<Tree onPick={onPick} />)
    const inner = screen.getByRole('textbox', { name: 'Rename Beta' })
    inner.focus()
    const ev = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    inner.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(inner)
  })

  it('Ctrl, Cmd and Alt chords are not taken (Ctrl+Alt+D still opens today\'s note)', () => {
    render(<Tree />)
    item('All notes').focus()
    const ev = new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, altKey: true, bubbles: true, cancelable: true })
    document.activeElement.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(false)
    expect(at()).toBe('All notes')
  })
})
