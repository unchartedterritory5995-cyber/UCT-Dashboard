// Simplify pass 2 (spec C, Review focus 5): ONE contract for every Notebook menu that tucks rows into a second view --
// the menu engine's `children` rows (NewNoteMenu.jsx MenuRows: the View menu's "More views", the New and phone More
// menus' "Draft a review", the "Aa" menu's Font and Size) and the note's More panel's "Export" (NoteMoreMenu.jsx +
// NoteExportControls.jsx, a disclosure rather than a role="menu", so it cannot share MenuRows' code; it shares this kit).
//
// What it asserts, for any such menu:
//   1. pressing the parent row (Enter on a button is a click) replaces the rows with "Back" (named "Back to ...") and
//      the children, in order, INSIDE THE SAME container (no nested popup); focus is on the first child that can take it;
//   2. Left, "Back" and Escape each return to the first view with focus on the row that opened the second one;
//   3. a second Escape closes the menu, and focus goes to its button (when `trigger` is given).
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

/**
 * @param {object} o
 * @param {() => (Element|Promise<Element>)} o.openMenu  opens the menu and returns the element holding its rows
 *   (the role="menu", or the More panel)
 * @param {string} o.parentRowName   the row that opens the second view ("More views")
 * @param {string[]} o.childRowNames  the second view's rows after "Back", in order
 * @param {() => Element} [o.trigger] the menu's button, for the closing Escape's focus check
 * @param {(el: Element) => boolean} [o.isClosed]  whether the container now reads closed (default: detached or hidden)
 */
export async function expectSecondView({ openMenu, parentRowName, childRowNames, trigger, isClosed }) {
  const container = await openMenu()
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
}
