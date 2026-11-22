// Simplify pass 2 (spec C, Review focus 5): ONE contract for every Notebook menu that tucks rows into a second view --
// the menu engine's `children` rows (NewNoteMenu.jsx MenuRows: the View menu's "More views", the New and phone More
// menus' "Draft a review", the "Aa" menu's Font and Size) and the note's More panel's "Export" (NoteMoreMenu.jsx +
// NoteExportControls.jsx, a disclosure rather than a role="menu", so it cannot share MenuRows' code; it shares this kit).
//
// What it asserts, for any such menu:
//   1. pressing the parent row (Enter on a button is a click) replaces the rows with "Back" (named "Back to ...") and
//      the children, in order, INSIDE THE SAME container (no nested popup); focus is on the first child that can take it;
//   2. Left, "Back" and Escape each return to the first view with focus on the row that opened the second one;
//   3. a second Escape closes the menu, and focus goes to its button (when `trigger` is given);
//   4. (follow-up B, item 3b) inside the second view, Home goes to its first row ("Back") and End to its last child, and
//      the arrow keys wrap (Down from the last child to "Back", Up from "Back" to the last child);
//   5. (follow-up B, item 3b) Tab from the second view does what the menu's own contract says (`tab`):
//      'closes' -- the menu engine's menus (NewNoteMenu.jsx useMenuButton): Tab takes focus out and the menu closes;
//      'stays'  -- the note's More panel (a disclosure, lib/useDisclosureFocus.js): Tab stays inside the view and wraps,
//                  and the panel stays open, exactly as Tab does in the panel's first view.
//
// Lives under lib/testing/ (test infrastructure by its path, components/screener/reachable.test.js TEST_INFRA).
import { act, fireEvent, waitFor } from '@testing-library/react'
import { expect } from 'vitest'

const ROWS = '[role="menuitem"], [role="menuitemradio"], button'
const nameOf = (el) => (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim()
const shown = (el) => !el.closest('[hidden]')
/** The rows the container shows now: menu rows (a row inside a nested menu counts once), in order. */
export function visibleRows(container) {
  return [...container.querySelectorAll(ROWS)].filter((el) => shown(el) && !el.parentElement?.closest('button'))
}
const rowNamed = (container, name) => visibleRows(container).find((el) => nameOf(el) === name)
const key = (k) => fireEvent.keyDown(document.activeElement, { key: k })

/** Press Tab on the focused element the way a browser does in a test environment with no focus navigation: the
 *  keydown first, and, when nothing took it (`preventDefault`), focus moves on to the next control outside the menu
 *  (a control the kit adds after the menu). Returns whether the keydown was taken. */
function pressTab(container) {
  const from = document.activeElement
  const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
  from.dispatchEvent(ev)
  if (ev.defaultPrevented) return true
  const next = document.createElement('button')
  next.type = 'button'
  next.textContent = 'after the menu'
  next.setAttribute('data-kit-after', '')
  container.ownerDocument.body.appendChild(next)
  next.focus()
  return false
}

/**
 * @param {object} o
 * @param {() => (Element|Promise<Element>)} o.openMenu  opens the menu and returns the element holding its rows
 *   (the role="menu", or the More panel)
 * @param {string} o.parentRowName   the row that opens the second view ("More views")
 * @param {string[]} o.childRowNames  the second view's rows after "Back", in order
 * @param {() => Element} [o.trigger] the menu's button, for the closing Escape's focus check
 * @param {(el: Element) => boolean} [o.isClosed]  whether the container now reads closed (default: detached or hidden)
 */
export async function expectSecondView({ openMenu, parentRowName, childRowNames, trigger, isClosed, tab = 'closes' }) {
  let container = await openMenu()
  const closed = isClosed || ((el) => !el.isConnected || Boolean(el.closest('[hidden]')))
  const parent = () => rowNamed(container, parentRowName)
  expect(parent(), `the first view offers "${parentRowName}"`).toBeTruthy()

  const enter = async () => {
    const row = parent()
    row.focus()
    await act(async () => { fireEvent.click(row) })
    await waitFor(() => {
      const names = visibleRows(container).map(nameOf)
      expect(names[0], 'the second view starts with Back').toMatch(/^Back to \S/)
      expect(names.slice(1), 'then the children, in order').toEqual(childRowNames)
    })
    expect(container.isConnected, 'the second view is drawn in the SAME container').toBe(true)
    expect(rowNamed(container, parentRowName), 'the parent row is replaced, not kept beside its children').toBeFalsy()
    const firstChild = visibleRows(container).slice(1).find((el) => !el.disabled)
    await waitFor(() => expect(document.activeElement, 'focus on the first child').toBe(firstChild || visibleRows(container)[0]))
  }
  const backOnParent = async (how) => {
    await waitFor(() => expect(document.activeElement, `${how}: focus back on "${parentRowName}"`).toBe(parent()))
    expect(visibleRows(container).some((el) => /^Back to /.test(nameOf(el))), `${how}: the first view again`).toBe(false)
  }

  await enter()
  await act(async () => { key('ArrowLeft') })
  await backOnParent('Left')

  await enter()
  await act(async () => { fireEvent.click(visibleRows(container)[0]) })
  await backOnParent('Back')

  await enter()
  await act(async () => { key('Escape') })
  await backOnParent('Escape')
  expect(closed(container), 'the first Escape only went back').toBe(false)

  await act(async () => { key('Escape') })
  await waitFor(() => expect(closed(container), 'the second Escape closes the menu').toBe(true))
  if (trigger) expect(document.activeElement, 'and focus is on its button').toBe(trigger())

  // 4. Home / End and wrap-around, inside the second view.
  // (an engine menu is unmounted when closed, so the reopened menu is a new element: every helper reads `container`)
  container = await openMenu()
  await enter()
  const viewRows = () => visibleRows(container).filter((el) => !el.disabled)
  const backRow = () => viewRows()[0]
  const lastChild = () => viewRows().at(-1)
  await act(async () => { key('End') })
  await waitFor(() => expect(document.activeElement, 'End: the last child').toBe(lastChild()))
  await act(async () => { key('Home') })
  await waitFor(() => expect(document.activeElement, 'Home: the first row of the view (Back)').toBe(backRow()))
  await act(async () => { key('ArrowUp') })
  await waitFor(() => expect(document.activeElement, 'Up from Back wraps to the last child').toBe(lastChild()))
  await act(async () => { key('ArrowDown') })
  await waitFor(() => expect(document.activeElement, 'Down from the last child wraps to Back').toBe(backRow()))
  expect(closed(container), 'the keys moved focus only').toBe(false)

  // 5. Tab from the second view (from its last child).
  lastChild().focus()
  let taken
  await act(async () => { taken = pressTab(container) })
  try {
    if (tab === 'stays') {
      expect(taken, 'Tab is kept inside the view').toBe(true)
      expect(document.activeElement, 'Tab from the last child wraps to Back').toBe(backRow())
      expect(closed(container), 'and the menu stays open').toBe(false)
      // close it the menu's own way, so the caller's next step starts clean
      await act(async () => { key('Escape') })
      await act(async () => { key('Escape') })
      await waitFor(() => expect(closed(container), 'Escape, Escape still closes it after Tab').toBe(true))
    } else {
      expect(taken, 'Tab is not kept by the menu').toBe(false)
      await waitFor(() => expect(closed(container), 'Tab out of the second view closes the menu').toBe(true))
    }
  } finally {
    for (const el of container.ownerDocument.querySelectorAll('[data-kit-after]')) el.remove()
  }
}
