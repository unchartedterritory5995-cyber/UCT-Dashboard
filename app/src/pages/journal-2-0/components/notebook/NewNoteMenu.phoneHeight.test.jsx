// Final fix (C3): the phone ⋯ menu had no height limit and ran under the floating "+" (with the sample active its last
// row, "Remove the sample notebook", was cut off). The menu engine now measures the room below the open menu's top
// (`--menu-room`) and, on a phone, the menu is held to it less the "+" and scrolls inside. jsdom lays nothing out, so
// the CSS is read as text and the measurement is driven with a stubbed box.
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MenuRows, useMenuButton } from './NewNoteMenu'

const read = (rel) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8')
const phoneBlock = (css) => {
  const at = css.indexOf('@media (max-width: 640px)')
  expect(at, 'the phone block exists').toBeGreaterThan(-1)
  return css.slice(at)
}
const px = (css, name) => Number(new RegExp(`${name}:\\s*(\\d+)px`).exec(css)?.[1])

describe('the phone menu fits above the floating "+" (CSS)', () => {
  const block = phoneBlock(read('NewNoteMenu.module.css'))
  const menuRule = /\.menu\s*\{([^}]*)\}/.exec(block)?.[1] || ''

  it('is held to the room below its top and scrolls its rows', () => {
    expect(menuRule).toMatch(/max-height:[^;]*var\(--menu-room/)
    expect(menuRule).toMatch(/overflow-y:\s*auto/)
  })

  it('the clearance it keeps is more than the "+" takes from the foot of the screen', () => {
    const tokens = read('../../../../styles/tokens.css')
    const clearance = px(tokens, '--space-3xl') + px(tokens, '--space-2xl')
    expect(menuRule).toMatch(/var\(--menu-room[^)]*\)\s*-\s*var\(--space-3xl\)\s*-\s*var\(--space-2xl\)/)
    const fab = phoneBlock(read('NotebookPlusFab.module.css'))
    const fabTakes = px(fab, 'height') + Number(/bottom:\s*calc\((\d+)px/.exec(fab)?.[1])
    expect(fabTakes, 'non-vacuity: the "+" was read').toBeGreaterThan(50)
    expect(clearance).toBeGreaterThan(fabTakes)
  })

  it('CONTROL: the desktop menu rule has no height limit (a phone-only change)', () => {
    const css = read('NewNoteMenu.module.css')
    const base = /\.menu\s*\{([^}]*)\}/.exec(css.slice(0, css.indexOf('@media')))?.[1] || ''
    expect(base).not.toMatch(/max-height/)
  })
})

function Menu() {
  const menu = useMenuButton()
  return (
    <div>
      <button {...menu.triggerProps}>More</button>
      {menu.open && <div {...menu.menuProps}><MenuRows menu={menu} items={[{ key: 'a', label: 'A', run: () => {} }]} /></div>}
    </div>
  )
}

const realRect = HTMLElement.prototype.getBoundingClientRect
afterEach(() => { HTMLElement.prototype.getBoundingClientRect = realRect })

describe('the menu engine measures the room below the open menu', () => {
  it('sets --menu-room to the window height less the menu\'s top, in the commit that opens it', () => {
    HTMLElement.prototype.getBoundingClientRect = function box() { return { top: 120, left: 0, right: 0, bottom: 0, width: 0, height: 0 } }
    render(<Menu />)
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'More' })) })
    const menu = screen.getByRole('menu')
    expect(menu.style.getPropertyValue('--menu-room')).toBe(`${window.innerHeight - 120}px`)
  })
})
