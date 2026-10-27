// app/src/components/mobile/Sheet.inert.test.jsx
//
// 11.20 walk D6 (axe serious, color-contrast 1.41:1 on the mobile top bar's "Journal" title, behind every open sheet at
// 390 in Light): the page behind a Sheet's scrim was still in the accessibility tree, so axe measured the dimmed title
// and a screen reader's virtual cursor could still walk the page the modal covers. While a Sheet is open, everything
// that was on <body> before it opened is `inert` (out of the accessibility tree, the Tab order and the pointer), in ONE
// place: Sheet.jsx. What opens later (a nested sheet, a menu a sheet's own content portals, a toast) is untouched, the
// topmost sheet is never inert, and an element that was inert already stays exactly as it was.
import { useState } from 'react'
import { act, render, screen, fireEvent, cleanup } from '@testing-library/react'
import { createPortal } from 'react-dom'
import { afterEach, expect, test } from 'vitest'
import Sheet from './Sheet'

afterEach(cleanup)

const frames = (n = 2) => act(() => new Promise((resolve) => {
  const step = (k) => (k ? requestAnimationFrame(() => step(k - 1)) : resolve())
  step(n)
}))
const backdropOf = (name) => screen.getByRole('dialog', { name }).parentElement
const pageRoot = () => screen.getByRole('button', { name: 'Open outer' }).closest('body > *')

function Host() {
  const [outer, setOuter] = useState(false)
  const [inner, setInner] = useState(false)
  const [menu, setMenu] = useState(false)
  return (
    <>
      <header><span>Journal</span></header>
      <button type="button" onClick={() => setOuter(true)}>Open outer</button>
      <Sheet open={outer} onClose={() => setOuter(false)} title="Outer" labelledByTitle>
        <button type="button" onClick={() => setInner(true)}>Open inner</button>
        <button type="button" onClick={() => setMenu(true)}>Open menu</button>
        {menu && createPortal(<div role="menu" aria-label="Sheet menu"><button type="button">Pick</button></div>, document.body)}
      </Sheet>
      <Sheet open={inner} onClose={() => setInner(false)} title="Inner" labelledByTitle>
        <button type="button">Inner action</button>
      </Sheet>
    </>
  )
}

test('the page behind an open sheet is inert; the sheet is not; closing restores the page and focus', async () => {
  render(<Host />)
  const opener = screen.getByRole('button', { name: 'Open outer' })
  opener.focus()
  expect(pageRoot().hasAttribute('inert')).toBe(false)
  fireEvent.click(opener)
  await frames()
  expect(pageRoot().hasAttribute('inert')).toBe(true)
  expect(backdropOf('Outer').hasAttribute('inert')).toBe(false)
  fireEvent.keyDown(document, { key: 'Escape' })
  await frames()
  expect(screen.queryByRole('dialog', { name: 'Outer' })).toBeNull()
  expect(pageRoot().hasAttribute('inert')).toBe(false)
  expect(document.activeElement).toBe(opener)          // focus went back to a page that is no longer inert
})

test('a nested sheet makes the outer one inert while it is open, and only then', async () => {
  render(<Host />)
  fireEvent.click(screen.getByRole('button', { name: 'Open outer' }))
  await frames()
  fireEvent.click(screen.getByRole('button', { name: 'Open inner' }))
  await frames()
  expect(backdropOf('Outer').hasAttribute('inert')).toBe(true)
  expect(backdropOf('Inner').hasAttribute('inert')).toBe(false)
  expect(pageRoot().hasAttribute('inert')).toBe(true)
  fireEvent.keyDown(document, { key: 'Escape' })       // the topmost answers: the inner one closes
  await frames()
  expect(screen.queryByRole('dialog', { name: 'Inner' })).toBeNull()
  expect(backdropOf('Outer').hasAttribute('inert')).toBe(false)
  expect(pageRoot().hasAttribute('inert')).toBe(true)  // still behind the outer sheet
  fireEvent.keyDown(document, { key: 'Escape' })
  await frames()
  expect(pageRoot().hasAttribute('inert')).toBe(false)
})

test("what a sheet's own content portals after it opens (a menu) is never made inert", async () => {
  render(<Host />)
  fireEvent.click(screen.getByRole('button', { name: 'Open outer' }))
  await frames()
  fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
  const menu = screen.getByRole('menu', { name: 'Sheet menu' })
  expect(menu.hasAttribute('inert')).toBe(false)
})

test('CONTROL: an element that was inert before the sheet opened is still inert after it closes', async () => {
  const already = document.createElement('div')
  already.setAttribute('inert', '')
  document.body.appendChild(already)
  try {
    render(<Host />)
    fireEvent.click(screen.getByRole('button', { name: 'Open outer' }))
    await frames()
    fireEvent.keyDown(document, { key: 'Escape' })
    await frames()
    expect(already.hasAttribute('inert')).toBe(true)
  } finally {
    already.remove()
  }
})
