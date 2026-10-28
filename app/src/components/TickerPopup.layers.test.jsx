// Escape over the TickerPopup in the topology the APP produces, not a convenient one.
//
// 1. A right-click on the popup's chart opens the REAL ChartContextMenu from
//    GlobalAddPositionProvider, which is mounted at the app root: the menu renders inside #root,
//    BEFORE the popup's <body> portal in document order. "Later in the document = on top" is
//    false for it.
// 2. That menu (and the IPO first-trade tag) close from a DOCUMENT keydown listener. On a
//    trusted key, browsers run a microtask checkpoint between the document and window
//    listeners, and React commits the close in it, so the menu is already UNMOUNTED when the
//    popup's window-bubble listener runs. Modelled here with a document listener registered
//    after the menu's that flushes React synchronously (flushSync) -- the same effect.
import { renderWithProviders, screen, fireEvent, act } from '../test-utils'
import { flushSync } from 'react-dom'
import { useState } from 'react'
import { vi, test, expect, describe, beforeEach, afterEach } from 'vitest'

vi.mock('../utils/prefetchBars', () => ({
  prefetchAllTimeframes: vi.fn(), prefetchBars: vi.fn(), prefetchBar: vi.fn(), default: vi.fn(),
}))
vi.mock('./chart/pane/ChartPane', () => ({ default: () => <div data-testid="pane-stub" /> }))
vi.mock('../context/AuthContext', async (orig) => {
  const real = await orig()
  const user = { id: 1, email: 'harness@local', role: 'admin' }
  return { ...real, useAuth: () => ({ user, plan: 'pro', isPaid: true, loading: false }), useIsPaid: () => true }
})

import TickerPopup from './TickerPopup'
import GlobalAddPositionProvider from '../pages/journal-2-0/GlobalAddPositionProvider'

const BAR = { t: 1760000000, o: 100, h: 101, l: 99, c: 100.5, v: 1000 }
let flushers = []

beforeEach(() => {
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }))
})
afterEach(() => {
  for (const f of flushers) document.removeEventListener('keydown', f)
  flushers = []
})

/** A document listener AFTER the layer's own: React commits that layer's close right here,
 *  before the event reaches window -- what the browser's microtask checkpoint does. */
function commitBetweenDocumentAndWindow() {
  const f = () => flushSync(() => {})
  document.addEventListener('keydown', f)
  flushers.push(f)
}

function mountAppTopology(onClose = vi.fn()) {
  renderWithProviders(
    <>
      <GlobalAddPositionProvider />
      <TickerPopup sym="QQQ" open onClose={onClose} />
    </>,
  )
  return { onClose, popup: screen.getByRole('dialog', { name: 'QQQ chart' }) }
}

async function rightClickMenu() {
  await act(async () => {
    window.dispatchEvent(new CustomEvent('uct:chart-contextmenu', {
      detail: { sym: 'QQQ', tf: 'D', bar: BAR, clientX: 60, clientY: 60, sections: [] },
    }))
  })
  return screen.findByRole('menu')
}

describe('the REAL app-root ChartContextMenu over the popup', () => {
  test('PREMISE: the menu renders BEFORE the popup in document order (inside the app tree)', async () => {
    const { popup } = mountAppTopology()
    const menu = await rightClickMenu()
    expect(menu).toHaveAttribute('data-escape-layer')
    expect(popup.contains(menu)).toBe(false)
    expect(popup.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
  })

  test('Escape closes the menu and NOT the popup, even though the menu unmounts before window sees the key', async () => {
    const { onClose } = mountAppTopology()
    await rightClickMenu()
    commitBetweenDocumentAndWindow()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()      // the menu is really gone...
    expect(onClose).not.toHaveBeenCalled()             // ...and the popup was not closed with it
    // the next Escape belongs to the popup
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  test('Tab inside the popup closes the MENU (APG) and leaves the popup open', async () => {
    const { onClose, popup } = mountAppTopology()
    const menu = await rightClickMenu()
    expect(menu.contains(document.activeElement)).toBe(true)   // focus went into the menu
    fireEvent.keyDown(document.activeElement, { key: 'Tab' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.queryByRole('dialog', { name: /Chart actions/ })).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    expect(popup.isConnected).toBe(true)
  })

  test('also without the early commit (menu still mounted when window sees the key)', async () => {
    const { onClose } = mountAppTopology()
    await rightClickMenu()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('a non-modal layer that removes ITSELF in a document listener (the IPO tag shape)', () => {
  test('opened after the popup, inside #root, gone before window: the popup stays open', () => {
    const { onClose } = mountAppTopology()
    const root = document.body.firstElementChild          // the render container, before the portal
    const tag = document.createElement('div')
    tag.setAttribute('data-escape-layer', '')
    root.appendChild(tag)
    const close = (e) => { if (e.key === 'Escape') tag.remove() }
    document.addEventListener('keydown', close)
    try {
      fireEvent.keyDown(document.body, { key: 'Escape' })
      expect(tag.isConnected).toBe(false)
      expect(onClose).not.toHaveBeenCalled()
    } finally {
      document.removeEventListener('keydown', close)
    }
  })

  test('a layer that was ALREADY open when the popup opened is beneath it: Escape closes the popup', () => {
    const beneath = document.createElement('div')
    beneath.setAttribute('data-escape-layer', '')
    document.body.appendChild(beneath)
    try {
      const { onClose } = mountAppTopology()
      fireEvent.keyDown(document.body, { key: 'Escape' })
      expect(onClose).toHaveBeenCalledTimes(1)
    } finally {
      beneath.remove()
    }
  })
})

describe('nested ticker popups', () => {
  test('the inner (later) popup closes first; the outer stays until the next Escape', () => {
    const outerClose = vi.fn()
    const innerClose = vi.fn()
    function Nest() {
      const [inner, setInner] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setInner(true)}>open inner</button>
          <TickerPopup sym="AAA" open onClose={outerClose} />
          {inner && <TickerPopup sym="BBB" open onClose={innerClose} />}
        </>
      )
    }
    renderWithProviders(<Nest />)
    fireEvent.click(screen.getByText('open inner'))
    expect(screen.getByRole('dialog', { name: 'BBB chart' })).toBeInTheDocument()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(innerClose).toHaveBeenCalledTimes(1)
    expect(outerClose).not.toHaveBeenCalled()
  })
})

describe('visibility through checkVisibility, as an engine that knows only checkVisibilityCSS reads it', () => {
  // Chrome 105-120 and Firefox 106-121 implement checkVisibility but ignore `visibilityProperty`
  // and honour only `checkVisibilityCSS`. jsdom has no checkVisibility at all, so emulate one.
  test('a visibility:hidden layer opened over the popup is not a layer', () => {
    const had = Object.getOwnPropertyDescriptor(Element.prototype, 'checkVisibility')
    Element.prototype.checkVisibility = function legacy(opts) {
      return !(opts && opts.checkVisibilityCSS && getComputedStyle(this).visibility === 'hidden')
    }
    try {
      const { onClose } = mountAppTopology()
      const ghost = document.createElement('div')
      ghost.setAttribute('data-escape-layer', '')
      ghost.style.visibility = 'hidden'
      document.body.appendChild(ghost)
      fireEvent.keyDown(document.body, { key: 'Escape' })
      expect(onClose).toHaveBeenCalledTimes(1)
      ghost.remove()
    } finally {
      if (had) Object.defineProperty(Element.prototype, 'checkVisibility', had)
      else delete Element.prototype.checkVisibility
    }
  })
})
