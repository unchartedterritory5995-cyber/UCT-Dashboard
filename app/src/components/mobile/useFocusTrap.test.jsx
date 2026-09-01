import { render, fireEvent, screen, cleanup } from '@testing-library/react'
import { useRef } from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import useFocusTrap, { focusableWithin, isHiddenForFocus, sheetOpenAbove, trapTabKey, FOCUSABLE_SELECTOR } from './useFocusTrap'
import Sheet from './Sheet'

// ─── the ONE focus trap ──────────────────────────────────────────────────────
//
// Five surfaces used to hand-roll this wrap. Four of them are gone (they render
// inside a `Sheet`, which consumes this module); one — EarningsResearchModal's
// desktop dialog — consumes the hook directly. So a defect here is a defect on
// every modal in the app, and these cases are the only place it is measured in
// isolation.

const mkContainer = (n) => {
  const container = document.createElement('div')
  container.tabIndex = -1
  const buttons = Array.from({ length: n }, (_, i) => {
    const b = document.createElement('button')
    b.textContent = `b${i}`
    container.appendChild(b)
    return b
  })
  document.body.appendChild(container)
  return { container, buttons }
}

const tabOn = (node, shiftKey = false) => {
  const ev = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true })
  node.dispatchEvent(ev)
  return ev
}

// ⚠️ RTL's own cleanup runs AFTER this hook (afterEach is LIFO), so wiping the
// body first leaves it trying to unmount a portal node that no longer exists.
// Unmount through RTL, THEN clear the hand-built nodes.
afterEach(() => { cleanup(); document.body.innerHTML = '' })

describe('focusableWithin — the ring', () => {
  it('⛔ DOES NOT ASK `offsetParent`, the predicate that is always null in jsdom', () => {
    // The bug this module exists to retire: `EarningsResearchModal` filtered on
    // `el.offsetParent !== null`, jsdom computes no layout, so the filter
    // removed EVERY candidate and the trap silently did nothing while its tests
    // stubbed the getter and reported green. This case is the standing proof
    // that a plain jsdom container — every offsetParent null — yields a ring.
    const { container, buttons } = mkContainer(3)
    expect(buttons.every((b) => b.offsetParent === null)).toBe(true)
    expect(focusableWithin(container)).toEqual(buttons)
  })

  it('skips hidden / aria-hidden / display:none / visibility:hidden', () => {
    const { container, buttons } = mkContainer(6)
    buttons[0].setAttribute('hidden', '')
    buttons[1].setAttribute('aria-hidden', 'true')
    buttons[2].style.display = 'none'
    buttons[5].style.visibility = 'hidden'
    expect(focusableWithin(container)).toEqual([buttons[3], buttons[4]])
  })

  it('skips a candidate under a hidden ANCESTOR, not just a hidden node', () => {
    const { container, buttons } = mkContainer(3)
    const shroud = document.createElement('div')
    shroud.setAttribute('aria-hidden', 'true')
    container.insertBefore(shroud, buttons[1])
    shroud.appendChild(buttons[1])
    expect(focusableWithin(container)).toEqual([buttons[0], buttons[2]])
  })

  it('the selector excludes disabled controls and tabindex="-1"', () => {
    const { container } = mkContainer(0)
    container.innerHTML = [
      '<button>ok</button><button disabled>no</button>',
      '<input><input disabled>',
      '<a href="#">link</a><a>no href</a>',
      '<div tabindex="0">tabbable</div><div tabindex="-1">not</div>',
    ].join('')
    expect(focusableWithin(container).map((n) => n.textContent || n.tagName))
      .toEqual(['ok', 'INPUT', 'link', 'tabbable'])
    expect(FOCUSABLE_SELECTOR).toContain('summary')
  })

  it('an absent container is an empty ring, not a throw', () => {
    expect(focusableWithin(null)).toEqual([])
    expect(isHiddenForFocus(null)).toBe(true)
  })
})

describe('trapTabKey — the wrap decision', () => {
  it('wraps FORWARD from the last to the first, and says it intervened', () => {
    const { container, buttons } = mkContainer(3)
    buttons[2].focus()
    const ev = tabOn(buttons[2])
    expect(trapTabKey(ev, container)).toBe(true)
    expect(ev.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(buttons[0])
  })

  it('wraps BACKWARD from the first round to the last', () => {
    const { container, buttons } = mkContainer(3)
    buttons[0].focus()
    const ev = tabOn(buttons[0], true)
    expect(trapTabKey(ev, container)).toBe(true)
    expect(document.activeElement).toBe(buttons[2])
  })

  it('⭐ POSITIVE CONTROL: leaves the MIDDLE alone — a ring, not a cage', () => {
    // Without this, a wrap that called preventDefault on every Tab would pass
    // both cases above and make every dialog impossible to walk through.
    const { container, buttons } = mkContainer(3)
    buttons[1].focus()
    const ev = tabOn(buttons[1])
    expect(trapTabKey(ev, container)).toBe(false)
    expect(ev.defaultPrevented).toBe(false)
    expect(document.activeElement).toBe(buttons[1])
  })

  it('pulls focus BACK in when it has escaped the container', () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    const { container, buttons } = mkContainer(2)
    outside.focus()
    trapTabKey(tabOn(outside), container)
    expect(document.activeElement).toBe(buttons[0])
    outside.focus()
    trapTabKey(tabOn(outside, true), container)
    expect(document.activeElement).toBe(buttons[1])
  })

  it('a container with NOTHING focusable keeps focus on the container, never the page behind', () => {
    const behind = document.createElement('button')
    document.body.appendChild(behind)
    const { container } = mkContainer(0)
    container.appendChild(document.createElement('p'))
    behind.focus()
    const ev = tabOn(behind)
    expect(trapTabKey(ev, container)).toBe(true)
    expect(ev.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(container)
  })

  it('Shift+Tab from the CONTAINER itself enters the ring at the end', () => {
    // The state right after a modal opens: focus is on the panel, which is
    // tabIndex=-1 and therefore not in its own ring.
    const { container, buttons } = mkContainer(3)
    container.focus()
    trapTabKey(tabOn(container, true), container)
    expect(document.activeElement).toBe(buttons[2])
  })

  it('an absent container is a no-op, not a throw', () => {
    const { buttons } = mkContainer(1)
    buttons[0].focus()
    expect(trapTabKey(tabOn(buttons[0]), null)).toBe(false)
  })
})

describe('useFocusTrap — installation', () => {
  function Dialog({ active = true }) {
    const ref = useRef(null)
    useFocusTrap(active, ref)
    return (
      <div ref={ref} tabIndex={-1} data-testid="dlg">
        <button>alpha</button>
        <button>omega</button>
      </div>
    )
  }

  const alpha = () => screen.getByRole('button', { name: 'alpha' })
  const omega = () => screen.getByRole('button', { name: 'omega' })

  it('traps once mounted, in BOTH directions', () => {
    render(<Dialog />)
    omega().focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(alpha())
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(omega())
  })

  it('⛔ LISTENS ON DOCUMENT IN CAPTURE, so a sibling header outside the subtree is still covered', () => {
    // A React onKeyDown on the rendered body sees only its own subtree, and a
    // dialog's FIRST focusable is routinely a sibling of that body. Firing on
    // an element that is not the container proves the listener is not scoped
    // to the container's own React tree.
    render(<Dialog />)
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()
    fireEvent.keyDown(outside, { key: 'Tab' })
    expect(document.activeElement).toBe(alpha())
  })

  it('does NOT engage while inactive, and unmounts its listener', () => {
    const { unmount } = render(<Dialog active={false} />)
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(outside)
    unmount()
    outside.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(outside)
  })

  it('⛔ STANDS DOWN while a `Sheet` is open above it, so the two do not fight over one Tab', () => {
    // The real shape: EarningsResearchModal's DESKTOP dialog is not a Sheet,
    // but its Financials tab pops a `StatementPanels` Sheet out to <body> —
    // outside the dialog's own panel. Both listen on document in capture, the
    // dialog registered FIRST, and its "focus escaped, pull it back" branch
    // would yank focus out of the pop-out on every keypress.
    //
    // ⚠️ THE OBVIOUS ASSERTION HERE IS VACUOUS, and the first draft of this
    // case was: firing Tab on the LAST control inside the Sheet passes with or
    // without the guard, because the unguarded dialog grabs focus and Sheet's
    // own trap — running second — simply pulls it back. Measured by deleting
    // the guard: still green. The distinguishing state is a MIDDLE control,
    // where Sheet correctly does nothing, so the only thing that can move
    // focus is the outer dialog reaching in.
    render(
      <>
        <Dialog />
        <Sheet open onClose={() => {}} title="popout">
          <button>sheet-one</button>
          <button>sheet-two</button>
        </Sheet>
      </>,
    )
    const ring = focusableWithin(document.querySelector('[data-sheet-panel]'))
    expect(ring.length).toBeGreaterThan(2)
    const middle = ring[1]
    expect(middle).not.toBe(ring[0])
    expect(middle).not.toBe(ring[ring.length - 1])

    middle.focus()
    fireEvent.keyDown(middle, { key: 'Tab' })
    expect(document.activeElement).toBe(middle)
    expect(screen.getByTestId('dlg').contains(document.activeElement)).toBe(false)
  })

  it('sheetOpenAbove sees a Sheet outside the container and ignores one inside it', () => {
    const outer = document.createElement('div')
    document.body.appendChild(outer)
    expect(sheetOpenAbove(outer)).toBe(false)
    const sheet = document.createElement('div')
    sheet.setAttribute('data-sheet-panel', '')
    document.body.appendChild(sheet)
    expect(sheetOpenAbove(outer)).toBe(true)
    outer.appendChild(sheet)          // now the Sheet is INSIDE the container
    expect(sheetOpenAbove(outer)).toBe(false)
  })

  it('ignores every key that is not Tab', () => {
    render(<Dialog />)
    omega().focus()
    fireEvent.keyDown(document, { key: 'Enter' })
    fireEvent.keyDown(document, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(omega())
  })
})
