// Finish program, lane KEYS: the anchored menu is a real ARIA menu.
//
// The desktop branch is `role="menu"`, and its rows were plain <button>s. A menu must hold
// menu items: an automated accessibility check reports `aria-required-children` (critical),
// and the Notebook's "Block actions" button opens this menu. The rows are now
// `role="menuitem"`, and the menu has the keys a menu needs: Arrow keys, Home and End move
// between the rows, Escape closes it and focus goes back to what opened it.
//
// Desktop branch only (matchMedia matches: false in jsdom). The touch branch is a Sheet.
import { render, screen, fireEvent } from '@testing-library/react'
import { vi, expect, test, describe } from 'vitest'
import ContextPopover from './ContextPopover'

const ITEMS = [
  { label: 'Move up' }, { label: 'Move down', disabled: true }, { separator: true }, { label: 'Remove', danger: true },
]
const menu = () => document.body.querySelector('[role="menu"]')
const rows = () => [...menu().querySelectorAll('[role="menuitem"]')]
const key = (k) => fireEvent.keyDown(document.activeElement, { key: k })

function open(extra = {}) {
  const trigger = document.createElement('button')
  document.body.appendChild(trigger)
  trigger.focus()
  const onClose = vi.fn()
  const view = render(<ContextPopover open onClose={onClose} anchor={{ x: 10, y: 10 }} items={ITEMS} {...extra} />)
  return { trigger, onClose, ...view }
}

describe('ContextPopover: the anchored menu is a real menu', () => {
  test('every row is a menuitem, and the menu holds nothing else that is interactive', () => {
    const { trigger } = open()
    expect(rows().map((r) => r.textContent)).toEqual(['Move up', 'Move down', 'Remove'])
    expect(menu().querySelectorAll('button:not([role="menuitem"])')).toHaveLength(0)
    expect(rows().every((r) => r.tagName === 'BUTTON')).toBe(true) // still real buttons
    trigger.remove()
  })

  test('the separator is a separator, not a menu item', () => {
    const { trigger } = open()
    expect(menu().querySelectorAll('[role="separator"]')).toHaveLength(1)
    trigger.remove()
  })

  test('focus starts on the first row; ArrowDown and ArrowUp move, skip a disabled row, and wrap', () => {
    const { trigger } = open()
    expect(document.activeElement).toBe(rows()[0])
    key('ArrowDown')
    expect(document.activeElement.textContent).toBe('Remove') // "Move down" is disabled
    key('ArrowDown')
    expect(document.activeElement.textContent).toBe('Move up') // wrapped
    key('ArrowUp')
    expect(document.activeElement.textContent).toBe('Remove')
    trigger.remove()
  })

  test('Home and End jump to the first and last row', () => {
    const { trigger } = open()
    key('End')
    expect(document.activeElement.textContent).toBe('Remove')
    key('Home')
    expect(document.activeElement.textContent).toBe('Move up')
    trigger.remove()
  })

  test('an arrow key is consumed by the menu (the page behind does not scroll)', () => {
    const { trigger } = open()
    const ev = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    document.activeElement.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
    trigger.remove()
  })

  test('Escape closes the menu, and closing returns focus to what opened it', () => {
    const { trigger, onClose, rerender } = open()
    key('Escape')
    expect(onClose).toHaveBeenCalledTimes(1)
    rerender(<ContextPopover open={false} onClose={onClose} anchor={{ x: 10, y: 10 }} items={ITEMS} />)
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })

  test('a row still runs on click (a menuitem that is a button keeps its click)', () => {
    const onClick = vi.fn()
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()
    render(<ContextPopover open onClose={() => {}} anchor={{ x: 0, y: 0 }} items={[{ label: 'Go', onClick }]} />)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Go' }))
    expect(onClick).toHaveBeenCalledTimes(1)
    trigger.remove()
  })

  test('custom children are left as the caller wrote them (their roles are theirs)', () => {
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    render(
      <ContextPopover open onClose={() => {}} anchor={{ x: 0, y: 0 }}>
        <button type="button">plain</button>
      </ContextPopover>)
    expect(screen.getByRole('button', { name: 'plain' })).toBeTruthy()
    trigger.remove()
  })
})
