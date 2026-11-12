// S11 + VIS-4 (audit 2026-11-05, V2): the notes list toolbar is ONE row, in this order --
//   View: List ▾  ·  sort  ·  Today's note  ·  + New ▾  ·  ⋯
// "+ New" (with its ▾: Blank · From a template · Voice note · Import) is the ONLY solid primary; ⋯ holds
// Export, My tools and Manage templates; Save view lives inside the View menu. The view lives in the
// address (`?view=board`), so a reload keeps it.
//
// ⚰️ Replaces NotebookTab.viewSelect.test.jsx (P0.11's phone View select beside seven icon toggles) and
// NotebookTab.listCaret.test.jsx (the caret beside "+ New note"): both surfaces are gone, and their
// contracts (every mode offered; one state behind every door; the caret's keyboard) are pinned here.
//
// ⛔ jsdom lays nothing out: the 32 px row height and the phone row are pinned on the stylesheet below.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { AUTH, installFetch, NOTES, Providers, SAVED_VIEWS } from '../a11y/fixtures'
import { __resetNotebookFlags, latchNotebookFlags } from '../lib/offline/notebookFlags'
import { parseRules, declarations } from '../a11y/cssAudit'
import { VIEW_MODES } from '../lib/savedViewModes'
import NotebookTab from './NotebookTab'
import {
  chooseSavedView, chooseView, currentView, offersSaveView, savedViewsGroup, toolbarOffers, viewOption,
} from './__tests__/toolbarDoors'

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)) })
afterEach(() => { cleanup(); __resetNotebookFlags() })

function Where() {
  const loc = useLocation()
  return <output data-testid="where">{loc.search}</output>
}
async function renderTab(route = '/journal/notebook?view=all', routes = []) {
  installFetch([[/mapping-offer$/, { offer: null }], ...routes])
  const out = render(<Providers auth={AUTH} route={route}><NotebookTab /><Where /></Providers>)
  await settle()
  return out
}
const bar = () => screen.getByRole('toolbar', { name: 'Notes list tools' })
/** Every control on the row, in DOM order, by the name a member hears. */
const controls = () => [...bar().querySelectorAll('button, select')]
  .filter((el) => !el.closest('[role="menu"]'))
  .map((el) => (el.tagName === 'SELECT' ? `select:${el.getAttribute('aria-label')}` : (el.getAttribute('aria-label') || el.textContent.trim())))

describe('the list toolbar is one row with exactly these controls', () => {
  it('View, sort, Today, + New and its ▾, ⋯ -- in that order, nothing else', async () => {
    await renderTab()
    expect(controls()).toEqual([
      // Notebook simplify, Task 3: the daily note's button says what it opens.
      'View: List', 'select:Sort notes', "Today's note", '+ New', 'More ways to start a note', 'More notebook actions',
    ])
  })

  it('"+ New" is the ONLY solid primary on the row (its ▾ is the same split control)', async () => {
    await renderTab()
    const primaries = [...bar().querySelectorAll('.btn-primary')]
    expect(primaries.map((el) => el.getAttribute('aria-label') || el.textContent.trim()))
      .toEqual(['+ New', 'More ways to start a note'])
    const split = bar().querySelector('[data-tour="import"]')
    for (const el of primaries) expect(split.contains(el)).toBe(true)
  })

  it('every control is on the buttons.css roles (no bespoke button class)', async () => {
    await renderTab()
    for (const el of bar().querySelectorAll('button')) expect(el.className).toMatch(/\bbtn\b/)
  })

  it('the View trigger SAYS the mode and its menu offers every mode, then Save view', async () => {
    await renderTab()
    const menu = (viewOption('List'), screen.getByRole('menu', { name: 'View' }))
    // the modes are the menu's own radios; the saved views (Task 2) are a named group of their own below them
    expect(within(menu).getAllByRole('menuitemradio').filter((el) => !el.closest('[role="group"]'))
      .map((el) => el.textContent.trim()))
      .toEqual(VIEW_MODES.map((m) => m.short))
    expect(within(menu).getByRole('menuitem', { name: 'Save view' })).toBeTruthy()
  })

  it('the New ▾ lists Blank, From a template, Voice note (paid, gate on) and Import', async () => {
    latchNotebookFlags({ notebook_voice_notes_enabled: true })
    await renderTab()
    fireEvent.click(within(bar()).getByRole('button', { name: 'More ways to start a note' }))
    const menu = screen.getByRole('menu', { name: 'Start a note' })
    const rows = within(menu).getAllByRole('menuitem').map((el) => el.textContent.trim())
    expect(rows[0]).toBe('Blank')
    expect(rows[1]).toBe('From a template')
    expect(rows[rows.length - 1]).toBe('Import')
  })
})

describe('every action that was on the toolbar is still reachable (S11 enumeration)', () => {
  // The row before S11, button by button: Import, Manage templates (switch on), My tools (wave 8), Export,
  // Today, Templates, + New note, its caret, Save view, seven view toggles, the sort select, Clear filter.
  it('with every gate on, each one is one press or one menu away', async () => {
    latchNotebookFlags({ notebook_journal_styles_enabled: true, notebook_widgets_w8_enabled: true })
    await renderTab()
    for (const name of ['Import', 'Manage templates', 'My tools', 'Export', 'Templates']) {
      expect(toolbarOffers(name), name).toBe(true)
    }
    expect(within(bar()).getByRole('button', { name: "Today's note" })).toBeTruthy()
    expect(within(bar()).getByRole('button', { name: '+ New' })).toBeTruthy()
    expect(within(bar()).getByRole('combobox', { name: 'Sort notes' })).toBeTruthy()
    expect(offersSaveView()).toBe(true)
    for (const m of VIEW_MODES) expect(viewOption(m.short), m.short).toBeTruthy()
  })

  // Fix round 1 (review Minor 11): the enumeration now names the two doors it had missed.
  // Notebook simplify, Task 3: "From an outline" left the ▾ (it opened the same sheet as "From a template").
  it('Clear filter is on the row while a filter is on, and the note-type door is in the ▾ (gate on)', async () => {
    latchNotebookFlags({ notebook_journal_styles_enabled: true })
    await renderTab('/journal/notebook?view=all&ticker=NVDA')
    expect(within(bar()).getByRole('button', { name: 'Clear filter' })).toBeTruthy()
    fireEvent.click(within(bar()).getByRole('button', { name: 'More ways to start a note' }))
    const menu = screen.getByRole('menu', { name: 'Start a note' })
    expect(within(menu).queryByRole('menuitem', { name: 'From an outline' })).toBeNull()
    expect(within(menu).getByRole('menuitem', { name: 'From a template' })).toBeTruthy()
  })

  it('a gate that is off leaves no door that opens nothing', async () => {
    await renderTab()
    expect(toolbarOffers('Manage templates')).toBe(false)
    expect(toolbarOffers('My tools')).toBe(false)
    expect(toolbarOffers('Export')).toBe(true)   // control: the ⋯ menu itself rendered
  })

  it('"+ New" is one press, one blank note (the caret alone creates nothing)', async () => {
    await renderTab()
    const newBtn = within(bar()).getByRole('button', { name: '+ New' })
    expect(newBtn).toHaveAttribute('data-tour', 'new-note')
    fireEvent.click(within(bar()).getByRole('button', { name: 'More ways to start a note' }))
    expect(screen.getByRole('menu', { name: 'Start a note' })).toBeTruthy()
  })
})

describe('the phone Folder chip (review Minor 17)', () => {
  it('discloses the folders panel: aria-expanded and aria-controls name it', async () => {
    window.localStorage.setItem('uct.j2.nb.sidebarOpen', '0')
    await renderTab()
    const chip = within(bar()).getByRole('button', { name: /^Folder:/ })
    expect(chip).toHaveAttribute('aria-expanded', 'false')
    expect(document.getElementById(chip.getAttribute('aria-controls'))).not.toBeNull()
    window.localStorage.removeItem('uct.j2.nb.sidebarOpen')
  })
})

describe('the view lives in the address', () => {
  it('?view=board opens the board and KEEPS the address (a reload opens it again)', async () => {
    await renderTab('/journal/notebook?view=board')
    expect(currentView()).toBe('Board')
    expect(screen.getByTestId('where').textContent).toBe('?view=board')
  })

  it('choosing a view writes it to the address, and that address round-trips on a fresh mount', async () => {
    const first = await renderTab()
    chooseView('Table')
    expect(currentView()).toBe('Table')
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('?view=table'))
    const search = screen.getByTestId('where').textContent
    first.unmount()
    await renderTab(`/journal/notebook${search}`)
    expect(currentView()).toBe('Table')
  })

  it('CONTROL: a bare ?view=all is the list', async () => {
    await renderTab('/journal/notebook?view=all')
    expect(currentView()).toBe('List')
  })
})

describe('the menus keep the menu-button keyboard', () => {
  it('ArrowDown on View opens it on the first mode; Escape returns focus to the trigger', async () => {
    await renderTab()
    const trigger = within(bar()).getByRole('button', { name: /^View:/ })
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    const menu = screen.getByRole('menu', { name: 'View' })
    await waitFor(() => expect(document.activeElement).toBe(within(menu).getAllByRole('menuitemradio')[0]))
    // Notebook simplify, Task 3: under List come its own Rows / Cards, then the next mode
    fireEvent.keyDown(document.activeElement, { key: 'ArrowDown' })
    expect(document.activeElement.textContent.trim()).toBe('Rows')
    fireEvent.keyDown(document.activeElement, { key: 'ArrowDown' })
    fireEvent.keyDown(document.activeElement, { key: 'ArrowDown' })
    expect(document.activeElement.textContent.trim()).toBe('Table')
    fireEvent.keyDown(document.activeElement, { key: 'Escape' })
    expect(screen.queryByRole('menu', { name: 'View' })).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

})

describe('the stylesheet: one 32 px row on desktop, one 44 px row on a phone', () => {
  const css = readFileSync(join(process.cwd(), 'src', 'pages', 'journal-2-0', 'tabs', 'NotebookTab.module.css'), 'utf8')
  /** The bodies of every `@media (max-width: 640px)` block, by brace matching. */
  const phoneBodies = () => {
    const out = []
    let at = css.indexOf('@media (max-width: 640px)')
    while (at >= 0) {
      let i = css.indexOf('{', at) + 1
      const start = i
      for (let depth = 1; depth > 0; i += 1) { if (css[i] === '{') depth += 1; else if (css[i] === '}') depth -= 1 }
      out.push(css.slice(start, i - 1))
      at = css.indexOf('@media (max-width: 640px)', i)
    }
    return out.join(' ')
  }
  /** The FIRST (base, unconditioned) rule for a selector. */
  const base = (sel) => {
    const r = parseRules(css).find((x) => x.selector === sel)
    return r ? Object.fromEntries(declarations(r).map((d) => [d.prop, d.value])) : {}
  }

  it('every toolbar control is 32 px tall on desktop', () => {
    expect(base('.toolBtn').height).toBe('32px')
    expect(base('.sortSelect').height).toBe('32px')
  })

  it('a phone hides "+ New" and Today (the floating "+" and ⋯ carry them); the row wraps rather than overflow', () => {
    const phone = phoneBodies()
    expect(phone).toMatch(/\.newWrap \.newSplit,\s*\.newWrap \.todayBtn \{ display: none; \}/)
    expect(phone).toMatch(/\.phoneOnlyItem \{ display: flex !important; \}/)
    expect(phone).toMatch(/\.toolbar \{ flex-wrap: wrap;/)   // fix round 1: wraps (NotebookTab.toolbarFits.test.js)
    // the folders door joins the row, and the standalone toggle steps aside while the row is on screen
    expect(phone).toMatch(/\.phoneFolders \{ display: inline-flex; \}/)
    expect(phone).toMatch(/\.wrap\[data-list-toolbar\] > \.sidebarToggle \{ display: none; \}/)
  })
})

// ── Notebook simplify, Task 2 (2026-11-11) ─────────────────────────────────────────────────────────────────────────
// The saved views left the folders panel: they are the "Saved views" group at the foot of this View menu, where a row
// applies a view, each row renames and deletes, and "Add thesis starter views" is offered when there are none.
describe('Task 2: the saved views are listed in the View menu, not the folders panel', () => {
  it('the View menu lists each saved view (the fixture serves one) in a "Saved views" group', async () => {
    await renderTab()
    const group = await savedViewsGroup()
    expect(within(group).getAllByRole('menuitemradio').map((el) => el.textContent.trim()))
      .toEqual(SAVED_VIEWS.map((v) => v.name))
    expect(within(group).getByRole('menuitem', { name: `Rename ${SAVED_VIEWS[0].name}` })).toBeTruthy()
    expect(within(group).getByRole('menuitem', { name: `Delete ${SAVED_VIEWS[0].name}` })).toBeTruthy()
  })

  it('the folders panel lists no saved view and offers no starter views', async () => {
    await renderTab()
    await savedViewsGroup()                                  // the list has arrived (control: the menu shows it)
    const panel = document.getElementById('notebook-folders-panel')
    expect(within(panel).queryByText(SAVED_VIEWS[0].name)).toBeNull()
    expect(within(panel).queryByText(/saved views/i)).toBeNull()
    expect(within(panel).queryByText('Add thesis starter views')).toBeNull()
  })

  it('applying a view from the menu: the menu stays usable while it is on, checks it, and drops Save view', async () => {
    await renderTab()
    await chooseSavedView(SAVED_VIEWS[0].name)
    const trigger = within(bar()).getByRole('button', { name: /^View:/ })
    expect(trigger).not.toBeDisabled()
    const group = await savedViewsGroup()
    expect(within(group).getByRole('menuitemradio', { name: SAVED_VIEWS[0].name })).toHaveAttribute('aria-checked', 'true')
    expect(within(screen.getByRole('menu', { name: 'View' })).queryByRole('menuitem', { name: 'Save view' })).toBeNull()
  })

  it('with no saved views the group offers "Add thesis starter views"', async () => {
    await renderTab('/journal/notebook?view=all', [[/^\/api\/j2\/saved-views$/, { savedViews: [] }]])
    const group = await savedViewsGroup()
    expect(within(group).getByRole('menuitem', { name: 'Add thesis starter views' })).toBeTruthy()
    expect(within(group).queryAllByRole('menuitemradio')).toEqual([])
  })

  it('CONTROL: while the saved-views list has failed, no starter views are offered', async () => {
    await renderTab('/journal/notebook?view=all', [[/^\/api\/j2\/saved-views$/, [500, { detail: 'down' }]]])
    fireEvent.click(within(bar()).getByRole('button', { name: /^View:/ }))
    await settle()
    const menu = screen.getByRole('menu', { name: 'View' })
    expect(within(menu).queryByRole('menuitem', { name: 'Add thesis starter views' })).toBeNull()
  })
})

// The empty list says WHICH empty it is. ⚰️ Measured on the real page: "Add thesis starter views" switched the list to a
// view matching nothing, and the page said "Your notebook is empty", drew "How do you trade?" and the whole template
// picker, in an account of 15 notes.
describe('Task 2: an empty list in an account WITH notes says "No notes match this view."', () => {
  // The main list carries the filter in its address; the "All notes" count read (sort=title) never does.
  const filteredEmpty = [[/^\/api\/j2\/notes$/, (url) => (/[?&](ticker|savedViewId|tag)=/.test(url)
    ? { notes: [], total: 0 } : { notes: NOTES, total: NOTES.length })]]
  const emptyBlock = () => document.querySelector('[data-empty="filtered"]')

  it('a saved view matching nothing: the sentence and "Clear filter", nothing else', async () => {
    await renderTab('/journal/notebook?view=all', filteredEmpty)
    await chooseSavedView(SAVED_VIEWS[0].name)
    await waitFor(() => expect(emptyBlock()).not.toBeNull())
    expect(emptyBlock()).toHaveTextContent(/^No notes match this view\.\s*Clear filter$/)
    expect(within(emptyBlock()).getAllByRole('button').map((b) => b.textContent.trim())).toEqual(['Clear filter'])
    expect(screen.queryByText('Your notebook is empty.')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Import notes' })).toBeNull()
    expect(document.querySelector('[data-template-key]')).toBeNull()
    expect(screen.queryByText('How do you trade?')).toBeNull()
  })

  it('a ticker filter matching nothing says the same; "Clear filter" lands on All notes, with the notes', async () => {
    await renderTab('/journal/notebook?view=all&ticker=ZZZZ', filteredEmpty)
    await waitFor(() => expect(emptyBlock()).not.toBeNull())
    fireEvent.click(within(emptyBlock()).getByRole('button', { name: 'Clear filter' }))
    await waitFor(() => expect(emptyBlock()).toBeNull())
    expect(screen.getByTestId('where').textContent).toBe('?view=all')
    expect(await screen.findAllByText(NOTES[0].title)).not.toHaveLength(0)
  })

  it('CONTROL: an account with ZERO notes keeps its own empty state: the sentence, Import notes, the picker', async () => {
    await renderTab('/journal/notebook?view=all', [[/^\/api\/j2\/notes$/, { notes: [], total: 0 }]])
    expect(await screen.findByText('Your notebook is empty.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import notes' })).toBeInTheDocument()
    await waitFor(() => expect(document.querySelector('[data-template-key]')).not.toBeNull(), { timeout: 5000 })
    expect(emptyBlock()).toBeNull()
  })
})
