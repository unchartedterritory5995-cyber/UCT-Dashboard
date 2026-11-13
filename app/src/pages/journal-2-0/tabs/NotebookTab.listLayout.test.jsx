// Notebook simplify, Task 3 (2026-11-11): a list that is a list, and one New menu.
//
// Measured in a real browser at 1920x945 before this work: "View: List" drew a grid of cards five across, each with
// a large serif title, blue tag chips and a tick box always showing. The list is now one note per row in a single
// column (no wider than 860 px): the title on line one, a quiet meta line under it, hairlines between rows. The grid
// is still there, as "Cards", a display choice under List in the View menu, remembered in this browser
// (`uct.notebook.list.layout`). It is not a view mode: saved views and the server's list of modes are untouched.
//
// The New ▾ is Blank, From a template, Voice note, Import, then a "Reviews" group whose three items run the SAME
// drafting door as Research Home's "Reviews that write themselves" buttons (lib/reviewDraftRun.js).
//
// ⛔ jsdom lays nothing out: the single column and the tick box's visibility are pinned on the stylesheets below.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AUTH, installFetch, NOTES, Providers } from '../a11y/fixtures'
import { __resetNotebookFlags, latchNotebookFlags } from '../lib/offline/notebookFlags'
import { parseRules, declarations } from '../a11y/cssAudit'
import NotebookTab from './NotebookTab'

vi.mock('../lib/reviewDrafts', async (importOriginal) => ({
  ...(await importOriginal()),
  draftDailyReview: vi.fn(async () => ({ note: { id: 'n1', title: 'NVDA thesis' }, created: false })),
  draftWeeklyReview: vi.fn(async () => ({ note: { id: 'n1', title: 'NVDA thesis' }, created: false })),
  draftMonthlyReview: vi.fn(async () => ({ note: { id: 'n1', title: 'NVDA thesis' }, created: false })),
}))

const LAYOUT_KEY = 'uct.notebook.list.layout'
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)) })
afterEach(() => {
  cleanup()
  __resetNotebookFlags()
  try { window.localStorage.removeItem(LAYOUT_KEY) } catch { /* private mode */ }
  vi.clearAllMocks()
})

async function renderTab(route = '/journal/notebook?view=all') {
  installFetch([[/mapping-offer$/, { offer: null }]])
  const out = render(<Providers auth={AUTH} route={route}><NotebookTab /></Providers>)
  await settle()
  return out
}
const bar = () => screen.getByRole('toolbar', { name: 'Notes list tools' })
const notesList = () => screen.getByRole('group', { name: 'Notes' })
/** A CSS-module class by its source name (vitest hashes it to `_rows_60648c`). */
const hasClass = (el, name) => el.className.split(/\s+/).some((c) => c === name || new RegExp(`^_${name}_`).test(c))
// the notes list's own row (the folders panel's tree carries the same hub attribute on its note rows)
const rowOf = (id) => screen.queryByRole('group', { name: 'Notes' })?.querySelector(`[data-note-card-id="${id}"]`) || null
const openViewMenu = () => {
  const t = within(bar()).getByRole('button', { name: /^View:/ })
  if (t.getAttribute('aria-expanded') !== 'true') fireEvent.click(t)
  return screen.getByRole('menu', { name: 'View' })
}
// Simplify pass 2 (A10): the group is "Show as" (Rows / Cards); "layout" is the page-layout panels' word.
const layoutGroup = () => within(openViewMenu()).getByRole('group', { name: 'Show as' })
const openNewMenu = () => {
  fireEvent.click(within(bar()).getByRole('button', { name: 'More ways to start a note' }))
  return screen.getByRole('menu', { name: 'Start a note' })
}

describe('rows are the default: one column, a title and a quiet meta line per note', () => {
  it('with nothing stored, the list is rows, and each note is a row with its meta line', async () => {
    await renderTab()
    await waitFor(() => expect(rowOf('n1')).not.toBeNull())
    expect(notesList()).toHaveAttribute('data-list-layout', 'rows')
    expect(hasClass(notesList(), 'rows')).toBe(true)
    expect(hasClass(notesList(), 'grid')).toBe(false)
    const row = rowOf('n1')
    expect(row.querySelector('[data-note-title]')).toHaveTextContent('NVDA thesis')
    // line two, in order: relative date, $TICKER, the tags, the subtitle
    const meta = row.querySelector('[data-note-meta]')
    expect(meta).not.toBeNull()
    const words = [...meta.children].map((el) => el.textContent.trim()).filter(Boolean)
    expect(words.slice(1)).toEqual(['$NVDA', '#semis', '#thesis', 'Data centre cycle'])
    // the View menu says which: "Rows" checked, under List
    expect(within(layoutGroup()).getByRole('menuitemradio', { name: 'Rows' })).toHaveAttribute('aria-checked', 'true')
    expect(within(layoutGroup()).getByRole('menuitemradio', { name: 'Cards' })).toHaveAttribute('aria-checked', 'false')
  })

  it('the Rows / Cards choice sits directly under List in the View menu, before Table', async () => {
    await renderTab()
    const menu = openViewMenu()
    const order = [...menu.querySelectorAll('[role="menuitemradio"]')]
      .filter((el) => !el.closest('[data-saved-views-group]'))
      .map((el) => el.textContent.trim())
    expect(order.slice(0, 4)).toEqual(['List', 'Rows', 'Cards', 'Table'])
  })

  it('CONTROL: outside List (Table) the menu offers no Rows / Cards', async () => {
    await renderTab('/journal/notebook?view=table')
    expect(within(openViewMenu()).queryByRole('group', { name: 'Show as' })).toBeNull()
  })
})

describe('choosing Cards is remembered and restores the grid', () => {
  it('Cards draws the grid, is stored, and a fresh mount opens on the grid again', async () => {
    const first = await renderTab()
    fireEvent.click(within(layoutGroup()).getByRole('menuitemradio', { name: 'Cards' }))
    await waitFor(() => expect(notesList()).toHaveAttribute('data-list-layout', 'cards'))
    expect(hasClass(notesList(), 'grid')).toBe(true)
    expect(hasClass(notesList(), 'rows')).toBe(false)
    expect(window.localStorage.getItem(LAYOUT_KEY)).toBe('cards')
    first.unmount()
    await renderTab()
    await waitFor(() => expect(rowOf('n1')).not.toBeNull())
    expect(notesList()).toHaveAttribute('data-list-layout', 'cards')
    // and back: Rows is stored too
    fireEvent.click(within(layoutGroup()).getByRole('menuitemradio', { name: 'Rows' }))
    await waitFor(() => expect(notesList()).toHaveAttribute('data-list-layout', 'rows'))
    expect(window.localStorage.getItem(LAYOUT_KEY)).toBe('rows')
  })

  it('a stored value that is neither is read as rows', async () => {
    window.localStorage.setItem(LAYOUT_KEY, 'tiles')
    await renderTab()
    await waitFor(() => expect(rowOf('n1')).not.toBeNull())
    expect(notesList()).toHaveAttribute('data-list-layout', 'rows')
  })
})

describe('the tick box: on hover, on keyboard focus, on every row once anything is selected; always on touch', () => {
  it('once one note is selected, every row is marked as selecting (so every tick box shows)', async () => {
    await renderTab()
    await waitFor(() => expect(rowOf('n1')).not.toBeNull())
    const wraps = () => [...notesList().querySelectorAll('[data-note-row]')]
    expect(wraps().length).toBe(NOTES.length)
    for (const w of wraps()) expect(hasClass(w, 'selectingAny')).toBe(false)   // CONTROL: nothing selected yet
    for (const w of wraps()) expect(hasClass(w, 'selectRow')).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select NVDA thesis' }))
    await waitFor(() => { for (const w of wraps()) expect(hasClass(w, 'selectingAny')).toBe(true) })
  })

  const css = readFileSync(join(process.cwd(), 'src/pages/journal-2-0/components/notebook/NoteCard.module.css'), 'utf8')
    .replace(/\r\n/g, '\n')
  const rules = parseRules(css)
  const decl = (sel, prop) => {
    const r = rules.find((x) => x.selector.split(',').map((s) => s.trim()).includes(sel))
    return r ? Object.fromEntries(declarations(r).map((d) => [d.prop, d.value]))[prop] : undefined
  }

  it('in a row the tick box is hidden until the row is hovered, focused, selected, or anything is selected', () => {
    expect(decl('.selectRow .selectBox', 'opacity')).toBe('0')
    for (const sel of [
      '.selectRow:hover .selectBox',
      '.selectRow:focus-within .selectBox',
      '.selectRow.selectWrapOn .selectBox',
      '.selectRow.selectingAny .selectBox',
    ]) expect(decl(sel, 'opacity'), sel).toBe('1')
  })

  it('on the touch tier (<=1024px) it is always shown in a row', () => {
    const touchBlocks = [...css.matchAll(/@media\s*\(max-width:\s*1024px\)\s*\{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n')
    expect(touchBlocks).toMatch(/\.selectRow \.selectBox\s*\{[^}]*opacity:\s*1/)
  })
})

describe('the row stylesheet: one column, 860 px at most, hairlines, no card chrome', () => {
  const tabCss = readFileSync(join(process.cwd(), 'src/pages/journal-2-0/tabs/NotebookTab.module.css'), 'utf8')
  const cardCss = readFileSync(join(process.cwd(), 'src/pages/journal-2-0/components/notebook/NoteCard.module.css'), 'utf8')
  const base = (css, sel) => {
    const r = parseRules(css).find((x) => x.selector === sel)
    return r ? Object.fromEntries(declarations(r).map((d) => [d.prop, d.value])) : {}
  }

  it('the list is a single left-aligned column no wider than 860 px', () => {
    const rows = base(tabCss, '.rows')
    expect(rows['max-width']).toBe('860px')
    expect(rows.display).toBe('flex')
    expect(rows['flex-direction']).toBe('column')
    expect(rows['margin-left']).toBeUndefined()           // left-aligned, never centred with auto margins
    expect(base(tabCss, '.rows > [data-note-row]')['border-bottom']).toMatch(/^1px solid/)
  })

  it('a row has no border or background; its title is 16 px on one line with an ellipsis; tags are muted text', () => {
    const row = base(cardCss, '.row')
    expect(row.border).toBe('0')
    expect(row.background).toBe('transparent')
    const title = base(cardCss, '.rowTitle')
    // 16 px through the token (the Notebook token rail refuses a raw 16px); the token is 16px on every tier
    expect(title['font-size']).toBe('var(--text-xl)')
    const tokens = readFileSync(join(process.cwd(), 'src/styles/tokens.css'), 'utf8')
    expect([...tokens.matchAll(/--text-xl:\s*([^;]+);/g)].map((m) => m[1].trim())).toEqual(['16px'])
    expect(title['white-space']).toBe('nowrap')
    expect(title['text-overflow']).toBe('ellipsis')
    const tag = base(cardCss, '.rowTag')
    expect(tag.color).toBe('var(--text-muted)')
    expect(tag.background).toBeUndefined()
  })
})

describe('one New menu', () => {
  it('Blank, From a template, Voice note, Import, then Reviews: the three drafts (no "From an outline")', async () => {
    latchNotebookFlags({
      notebook_voice_notes_enabled: true, notebook_journal_styles_enabled: true, notebook_review_drafts_enabled: true,
    })
    await renderTab()
    const menu = openNewMenu()
    const top = within(menu).getAllByRole('menuitem').filter((el) => !el.closest('[role="group"]'))
    expect(top.map((el) => el.textContent.trim())).toEqual(['Blank', 'From a template', 'Voice note', 'Import'])
    const reviews = within(menu).getByRole('group', { name: 'Reviews' })
    expect(within(reviews).getAllByRole('menuitem').map((el) => el.textContent.trim()))
      .toEqual(["Today's recap", "This week's review", "This month's review"])
    expect(within(menu).queryByRole('menuitem', { name: 'From an outline' })).toBeNull()
  })

  it('CONTROL: with review drafts off there is no Reviews group (no door that opens nothing)', async () => {
    await renderTab()
    expect(within(openNewMenu()).queryByRole('group', { name: 'Reviews' })).toBeNull()
  })

  it.each([
    ["Today's recap", 'draftDailyReview', { day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }],
    ["This week's review", 'draftWeeklyReview', { weekStart: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }],
    ["This month's review", 'draftMonthlyReview', { month: expect.stringMatching(/^\d{4}-\d{2}$/) }],
  ])('%s runs the review drafting door Research Home runs', async (name, fn, args) => {
    latchNotebookFlags({ notebook_review_drafts_enabled: true })
    const drafts = await import('../lib/reviewDrafts')
    await renderTab()
    const reviews = within(openNewMenu()).getByRole('group', { name: 'Reviews' })
    fireEvent.click(within(reviews).getByRole('menuitem', { name }))
    await waitFor(() => expect(drafts[fn]).toHaveBeenCalledTimes(1))
    expect(drafts[fn]).toHaveBeenCalledWith(expect.objectContaining(args))
  })
})

describe('the toolbar names the daily note', () => {
  it('the button says "Today\'s note"', async () => {
    await renderTab()
    expect(within(bar()).getByRole('button', { name: "Today's note" })).toBeTruthy()
    expect(within(bar()).queryByRole('button', { name: 'Today' })).toBeNull()
  })
})

// Go-live wave 1 (D5): a selected row's tint is on the accent token and stays under hover and keyboard focus.
describe('the selected row: a token tint that hover does not paint over', () => {
  const tabCss = readFileSync(join(process.cwd(), 'src/pages/journal-2-0/tabs/NotebookTab.module.css'), 'utf8')
  const cardCss = readFileSync(join(process.cwd(), 'src/pages/journal-2-0/components/notebook/NoteCard.module.css'), 'utf8')
  const rule = (css, sel) => parseRules(css).find((x) => x.selector.split(',').map((s) => s.trim()).includes(sel))
  const bg = (css, sel) => {
    const r = rule(css, sel)
    return r ? Object.fromEntries(declarations(r).map((d) => [d.prop, d.value])).background : undefined
  }
  const SELECTED = '.rows > [data-note-row]:has(input[type="checkbox"]:checked)'
  /** CSS specificity [ids, classes, types] of a simple selector chain (enough for these rules). */
  const weight = (sel) => {
    const inner = [...sel.matchAll(/:has\(([^()]*(?:\([^()]*\))?[^()]*)\)/g)].map((m) => m[1])
    const outer = sel.replace(/:has\(([^()]*(?:\([^()]*\))?[^()]*)\)/g, '')
    const count = (s) => [
      (s.match(/#[\w-]+/g) || []).length,
      (s.match(/\.[\w-]+|\[[^\]]+\]|:(?!has)[\w-]+/g) || []).length,
      (s.match(/(^|[\s>+~])[a-z][\w-]*/gi) || []).length,
    ]
    const best = inner.map(count).reduce((a, b) => (a[1] > b[1] ? a : b), [0, 0, 0])
    const o = count(outer)
    return [o[0] + best[0], o[1] + best[1], o[2] + best[2]]
  }
  const beats = (a, b) => a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2]

  it('the tint is on the accent token (no raw colour), and a hovered or focused selected row has its own', () => {
    expect(bg(tabCss, SELECTED)).toMatch(/var\(--accent\)/)
    expect(bg(tabCss, SELECTED)).not.toMatch(/rgba?\(|#[0-9a-f]{3,8}\b/i)
    expect(bg(tabCss, `${SELECTED}:hover`)).toMatch(/var\(--accent\)/)
    expect(bg(tabCss, `${SELECTED}:has(:focus-visible)`)).toMatch(/var\(--accent\)/)
    expect(bg(tabCss, `${SELECTED}:hover`)).not.toBe(bg(tabCss, '.rows > [data-note-row]:hover'))
  })

  it('the selected rules outrank the plain hover rule, so hover never wins over a selection', () => {
    expect(beats(weight(SELECTED), weight('.rows > [data-note-row]:hover'))).toBe(true)
    expect(beats(weight(`${SELECTED}:hover`), weight('.rows > [data-note-row]:hover'))).toBe(true)
  })

  it('NoteCard no longer paints its own raw-colour selected background on a row', () => {
    expect(rule(cardCss, '.selectRow.selectWrapOn')).toBeUndefined()
  })

  it('CONTROL: the weight check can say no', () => {
    expect(beats(weight('.rows > [data-note-row]'), weight('.rows > [data-note-row]:hover'))).toBe(false)
  })
})
