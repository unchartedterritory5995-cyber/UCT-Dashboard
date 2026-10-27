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
import { afterEach, beforeEach, expect, test } from 'vitest'
import Sheet from './Sheet'

// The app's root, as main.jsx mounts it: the page a sheet makes inert.
let appRoot
beforeEach(() => { appRoot = document.body.appendChild(Object.assign(document.createElement('div'), { id: 'root' })) })
afterEach(() => { cleanup(); appRoot.remove() })
const renderApp = (ui) => render(ui, { container: appRoot })

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
  renderApp(<Host />)
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
  renderApp(<Host />)
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
  renderApp(<Host />)
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
    renderApp(<Host />)
    fireEvent.click(screen.getByRole('button', { name: 'Open outer' }))
    await frames()
    fireEvent.keyDown(document, { key: 'Escape' })
    await frames()
    expect(already.hasAttribute('inert')).toBe(true)
  } finally {
    already.remove()
  }
})

// W11-R80/R82 (review I-1): a keep-live layer drawn ABOVE the sheet's backdrop stays live; everything under the scrim
// is inert (W11-R82: a keep-live layer is live only while its z is above the sheet's).
test('a body child marked data-sheet-keep-live (the video player) stays live under a normal sheet; an unmarked one does not', async () => {
  const live = document.body.appendChild(Object.assign(document.createElement('div'), { id: 'video' }))
  live.setAttribute('data-sheet-keep-live', '8500')                    // its z: above the modal rung (1000)
  const other = document.body.appendChild(document.createElement('div'))
  try {
    renderApp(<Host />)
    fireEvent.click(screen.getByRole('button', { name: 'Open outer' }))
    await frames()
    expect(live.hasAttribute('inert')).toBe(false)
    expect(other.hasAttribute('inert')).toBe(true)                    // CONTROL: no marker, inert as before
    expect(appRoot.hasAttribute('inert')).toBe(true)
  } finally {
    live.remove()
    other.remove()
  }
})

/** TickerPopup's shape: its own <body> portal above the modal rung, opening a default-z Sheet from inside it. */
function PopupHost() {
  const [open, setOpen] = useState(false)
  return createPortal(
    <div data-testid="popup" style={{ position: 'fixed', zIndex: 8600 }}>
      <button type="button" onClick={() => setOpen(true)}>Chart tools</button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Tools" labelledByTitle><button type="button">Draw</button></Sheet>
    </div>,
    document.body,
  )
}

test('W11-R82: a sheet opened from inside a higher popup is drawn above it and operable, and the popup under its scrim is inert until it closes', async () => {
  renderApp(<><button type="button">Page</button><PopupHost /></>)
  fireEvent.click(screen.getByRole('button', { name: 'Chart tools' }))
  await frames()
  const popup = screen.getByTestId('popup')
  expect(Number(backdropOf('Tools').style.zIndex)).toBeGreaterThan(8600)   // lifted above its host
  expect(backdropOf('Tools').hasAttribute('inert')).toBe(false)              // and operable
  expect(screen.getByRole('button', { name: 'Draw' }).closest('[inert]')).toBeNull()
  expect(popup.hasAttribute('inert')).toBe(true)                             // under the scrim: inert
  expect(appRoot.hasAttribute('inert')).toBe(true)
  fireEvent.keyDown(document, { key: 'Escape' })
  await frames()
  expect(popup.hasAttribute('inert')).toBe(false)                            // live again after
})

test('W11-R82: a keep-live layer BELOW a lifted sheet (the 8500 player under an 8601 sheet) is inert while it is open', async () => {
  const video = document.body.appendChild(document.createElement('div'))
  video.setAttribute('data-sheet-keep-live', '8500')
  try {
    renderApp(<PopupHost />)
    fireEvent.click(screen.getByRole('button', { name: 'Chart tools' }))
    await frames()
    expect(video.hasAttribute('inert')).toBe(true)
    fireEvent.keyDown(document, { key: 'Escape' })
    await frames()
    expect(video.hasAttribute('inert')).toBe(false)
  } finally {
    video.remove()
  }
})

test('W11-R82 m-1: the anchor never takes a box, whatever display a parent rule gives its children', async () => {
  const css = document.head.appendChild(document.createElement('style'))
  css.textContent = '.row > * { display: block }'
  try {
    renderApp(<div className="row"><Sheet open onClose={() => {}} title="Row sheet" labelledByTitle>x</Sheet></div>)
    const anchor = appRoot.querySelector('[data-sheet-anchor]')
    expect(anchor).not.toBeNull()
    expect(getComputedStyle(anchor).display).toBe('none')
  } finally {
    css.remove()
  }
})

test('CONTROL: a sheet opened from the page keeps the default modal rung (no inline z-index)', async () => {
  renderApp(<Host />)
  fireEvent.click(screen.getByRole('button', { name: 'Open outer' }))
  await frames()
  expect(backdropOf('Outer').style.zIndex).toBe('')
})
