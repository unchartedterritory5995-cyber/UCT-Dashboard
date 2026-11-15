// S11 (audit 2026-11-05): the notes list toolbar is ONE row -- View ▾, sort, Today, "+ New" with its ▾, and
// ⋯. Every action that used to be its own toolbar button now sits one menu away. These doors let a test say
// what it means ("press Templates", "switch to the board") without each test re-learning which menu holds it.
// They press the REAL controls (trigger, then menu row), so a door that moved or vanished still fails.
import { fireEvent, screen, within } from '@testing-library/react'

const bar = () => screen.getByRole('toolbar', { name: 'Notes list tools' })

/** Which trigger holds each old toolbar action, and the row it is now. */
const WHERE = {
  Templates: ['More ways to start a note', 'From a template'],
  'From a template': ['More ways to start a note', 'From a template'],
  Blank: ['More ways to start a note', 'Blank'],
  'Voice note': ['More ways to start a note', 'Voice note'],
  Import: ['More ways to start a note', 'Import'],
  Export: ['More notebook actions', 'Export'],
  'My tools': ['More notebook actions', 'My tools'],
  'Manage templates': ['More notebook actions', 'Manage templates'],
}

function trigger(name) {
  return name === 'View'
    ? within(bar()).getByRole('button', { name: /^View:/ })
    : within(bar()).getByRole('button', { name })
}

function openMenu(triggerName) {
  const t = trigger(triggerName)
  if (t.getAttribute('aria-expanded') !== 'true') fireEvent.click(t)
  return screen.getByRole('menu', { name: triggerName === 'View' ? 'View' : t.getAttribute('aria-label') === 'More ways to start a note' ? 'Start a note' : t.getAttribute('aria-label') })
}

function closeMenu(triggerName) {
  const t = trigger(triggerName)
  if (t.getAttribute('aria-expanded') === 'true') fireEvent.click(t)
}

/** Press an action that used to be a toolbar button ("Templates", "Import", "Export", "My tools", ...). */
export function pressToolbar(name) {
  const [t, row] = WHERE[name] || [null, null]
  if (!t) throw new Error(`toolbarDoors: no door named ${name}`)
  const menu = openMenu(t)
  // Notebook simplify, Task 3: "From an outline" (the sheet, search first) left the ▾; "Templates" is "From a template".
  fireEvent.click(within(menu).getByRole('menuitem', { name: row }))
}

/** Whether the toolbar offers that action at all (its menu is opened, read, and closed again). */
export function toolbarOffers(name) {
  const [t, row] = WHERE[name] || [null, null]
  if (!t) throw new Error(`toolbarDoors: no door named ${name}`)
  const toolbar = screen.queryByRole('toolbar', { name: 'Notes list tools' })
  if (!toolbar) return false
  const triggerEl = within(toolbar).queryByRole('button', { name: t })
  if (!triggerEl) return false
  const menu = openMenu(t)
  const found = within(menu).queryAllByRole('menuitem', { name: row })
    .some((el) => !/phoneOnlyItem/.test(el.className))
  closeMenu(t)
  return found
}

/** The View menu's row for a mode (`short` is "List", "Table", "Board", ...). Opens the menu. */
export function viewOption(short) {
  const menu = openMenu('View')
  // Simplify pass 2 (C1): Graph and Timeline are in the menu's "More views" second view; the door presses it first.
  // From inside that second view, a first-view mode is one "Back" away.
  const find = () => within(menu).queryByRole('menuitemradio', { name: short })
  if (find()) return find()
  const back = within(menu).queryByRole('menuitem', { name: 'Back to View' })
  if (back) fireEvent.click(back)
  if (find()) return find()
  fireEvent.click(within(menu).getByRole('menuitem', { name: 'More views' }))
  return within(menu).getByRole('menuitemradio', { name: short })
}

/** Switch the list to a view mode by its short name, through the View menu. */
export function chooseView(short) {
  fireEvent.click(viewOption(short))
}

/** The mode the View trigger says is on ("List", "Board", ...). */
export function currentView() {
  return trigger('View').textContent.replace(/^View:\s*/, '').trim()
}

/** Whether the View menu offers "Save view" in the current mode (opened, read, closed). */
export function offersSaveView() {
  const menu = openMenu('View')
  const found = Boolean(within(menu).queryByRole('menuitem', { name: 'Save view' }))
  closeMenu('View')
  return found
}

/** Press "Save view" inside the View menu. */
export function pressSaveView() {
  const menu = openMenu('View')
  fireEvent.click(within(menu).getByRole('menuitem', { name: 'Save view' }))
}

// Notebook simplify, Task 2: the saved views are the View menu's "Saved views" group (they left the folders panel).
/** The View menu's "Saved views" group, once the saved-views list has arrived. Opens the menu. */
export async function savedViewsGroup() {
  const menu = openMenu('View')
  return within(menu).findByRole('group', { name: 'Saved views' })
}

/** Apply a saved view by its name, through the View menu. */
export async function chooseSavedView(name) {
  const group = await savedViewsGroup()
  fireEvent.click(await within(group).findByRole('menuitemradio', { name }))
}

/** Press a saved view's "Rename" or "Delete" in the View menu. */
export async function pressSavedViewAction(action, name) {
  const group = await savedViewsGroup()
  fireEvent.click(await within(group).findByRole('menuitem', { name: `${action} ${name}` }))
}
