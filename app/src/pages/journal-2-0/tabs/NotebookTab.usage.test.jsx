// Follow-up A (usage counting): each press on the notes list sends exactly ONE usage event with exactly its allowed
// props (lib/notebookTelemetry.js), never a title, a tag or a folder name. The events ride the same telemetry door
// as every Notebook event (one POST each, never awaited by the press).
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AUTH, installFetch, Providers } from '../a11y/fixtures'
import { __resetNotebookFlags } from '../lib/offline/notebookFlags'
import { telemetryBodies, expectNoContent } from '../lib/testing/telemetryFetch'
import NotebookTab from './NotebookTab'

const LAYOUT_KEY = 'uct.notebook.list.layout'
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)) })
afterEach(() => {
  cleanup()
  __resetNotebookFlags()
  try { window.localStorage.removeItem(LAYOUT_KEY) } catch { /* private mode */ }
  vi.clearAllMocks()
})

let fetchSpy
async function renderTab(route = '/journal/notebook?view=all', extra = []) {
  fetchSpy = installFetch([[/mapping-offer$/, { offer: null }], ...extra])
  render(<Providers auth={AUTH} route={route}><NotebookTab /></Providers>)
  await settle()
}
const usage = (event) => telemetryBodies(fetchSpy).filter((b) => b.event === event)
const bar = () => screen.getByRole('toolbar', { name: 'Notes list tools' })
const openViewMenu = () => {
  const t = within(bar()).getByRole('button', { name: /^View:/ })
  if (t.getAttribute('aria-expanded') !== 'true') fireEvent.click(t)
  return screen.getByRole('menu', { name: 'View' })
}

describe('the View menu', () => {
  it('Cards sends one list_layout_used {layout: cards} and one menu_row_used {view, cards}', async () => {
    await renderTab()
    fireEvent.click(within(openViewMenu()).getByRole('menuitemradio', { name: 'Cards' }))
    await waitFor(() => expect(usage('list_layout_used')).toHaveLength(1))
    expect(usage('list_layout_used')).toEqual([{ event: 'list_layout_used', props: { layout: 'cards' } }])
    expect(usage('menu_row_used')).toEqual([{ event: 'menu_row_used', props: { menu: 'view', row: 'cards' } }])
  })

  it('Table sends one view_used {table, menu}; the address it writes is not counted again as a link', async () => {
    await renderTab()
    expect(usage('view_used')).toEqual([])                       // control: ?view=all is not a mode
    fireEvent.click(within(openViewMenu()).getByRole('menuitemradio', { name: 'Table' }))
    await settle()
    expect(usage('view_used')).toEqual([{ event: 'view_used', props: { mode: 'table', via: 'menu' } }])
    expect(usage('menu_row_used')).toEqual([{ event: 'menu_row_used', props: { menu: 'view', row: 'table' } }])
  })

  it('the mode already on screen sends no view_used (once per change, not per press)', async () => {
    await renderTab('/journal/notebook?view=table')
    const before = usage('view_used').length
    fireEvent.click(within(openViewMenu()).getByRole('menuitemradio', { name: 'Table' }))
    await settle()
    expect(usage('view_used')).toHaveLength(before)
  })
})

describe('a ?view= link', () => {
  it('opening ?view=board sends one view_used {board, link}', async () => {
    await renderTab('/journal/notebook?view=board')
    expect(usage('view_used')).toEqual([{ event: 'view_used', props: { mode: 'board', via: 'link' } }])
  })
})

describe('the New and More menus', () => {
  it('New > Import sends one menu_row_used {new, import}', async () => {
    await renderTab()
    fireEvent.click(within(bar()).getByRole('button', { name: 'More ways to start a note' }))
    fireEvent.click(within(screen.getByRole('menu', { name: 'Start a note' })).getByRole('menuitem', { name: /Import/ }))
    await settle()
    expect(usage('menu_row_used')).toEqual([{ event: 'menu_row_used', props: { menu: 'new', row: 'import' } }])
  })
})

describe("today's note", () => {
  it("the list's Today's note button sends one today_door_used {list_button, created}", async () => {
    await renderTab('/journal/notebook?view=all', [
      [/\/api\/j2\/notes\/daily$/, { note: { id: 'n9', title: 'Daily NVDA' }, created: true }],
    ])
    fireEvent.click(within(bar()).getByRole('button', { name: /Today's note/ }))
    await waitFor(() => expect(usage('today_door_used')).toHaveLength(1))
    expect(usage('today_door_used')).toEqual([{ event: 'today_door_used', props: { door: 'list_button', created: true } }])
    expect(expectNoContent(telemetryBodies(fetchSpy), ['NVDA', 'n9'])).toEqual([])
  })
})
