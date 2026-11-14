// Follow-up A (usage counting): each press on the notes list sends exactly ONE usage event with exactly its allowed
// props (lib/notebookTelemetry.js), never a title, a tag or a folder name. The events ride the same telemetry door
// as every Notebook event (one POST each, never awaited by the press).
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AUTH, installFetch, Providers } from '../a11y/fixtures'
import { __resetNotebookFlags } from '../lib/offline/notebookFlags'
import { telemetryBodies, expectNoContent } from '../lib/testing/telemetryFetch'
import NotebookTab from './NotebookTab'
import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOUR_NAV, __resetLinkOpenedForTests, documentNav, linkOpened } from '../lib/notebookUsage'

const LAYOUT_KEY = 'uct.notebook.list.layout'
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)) })
afterEach(() => {
  cleanup()
  __resetLinkOpenedForTests()
  vi.restoreAllMocks()
  __resetNotebookFlags()
  try { window.localStorage.removeItem(LAYOUT_KEY) } catch { /* private mode */ }
  vi.clearAllMocks()
})

let fetchSpy
// The router's navigate, from inside the tree (an in-app link, the walkthrough's start, Back).
let nav = null
function NavProbe() { nav = useNavigate(); return null }
async function renderTab(route = '/journal/notebook?view=all', extra = []) {
  fetchSpy = installFetch([[/mapping-offer$/, { offer: null }], ...extra])
  render(<Providers auth={AUTH} route={route}><NavProbe /><NotebookTab /></Providers>)
  await settle()
}
const go = async (...args) => { act(() => { nav(...args) }); await settle() }
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

describe('a ?view= link (fix round 1, I2: only a link the member followed)', () => {
  it('a page first loaded by a followed link (?view=board) sends one view_used {board, link}', async () => {
    vi.spyOn(documentNav, 'type').mockReturnValue('navigate')
    await renderTab('/journal/notebook?view=board')
    expect(usage('view_used')).toEqual([{ event: 'view_used', props: { mode: 'board', via: 'link' } }])
  })

  it('a reload of that address sends none', async () => {
    vi.spyOn(documentNav, 'type').mockReturnValue('reload')
    await renderTab('/journal/notebook?view=board')
    expect(usage('view_used')).toEqual([])
  })

  it("a real in-app link (the task reminder notice's ?view=tasks) sends one", async () => {
    await renderTab()
    await go('/journal/notebook?view=tasks')
    expect(usage('view_used')).toEqual([{ event: 'view_used', props: { mode: 'tasks', via: 'link' } }])
  })

  it("the Tasks walkthrough's own start navigation sends none, and the engine marks it", async () => {
    await renderTab()
    await go('/journal/notebook?view=tasks', { state: { [TOUR_NAV]: true } })
    expect(usage('view_used')).toEqual([])
    const engine = readFileSync(join(process.cwd(), 'src/pages/journal-2-0/components/notebook/onboarding/GenericTourEngine.jsx'), 'utf8')
    expect(engine).toContain('navigate(r.path, { state: { ...(stripTourState(location.state) || {}), [TOUR_NAV]: true } })')
  })

  // Follow-up B, item 6a: the notes list remounted while the navigation type is still PUSH on the same entry (the
  // same `location.key`) used to count the one link again.
  it('a remount of the notes list on the same pushed address sends none', async () => {
    let mounted = null
    function Host() { const [on, setOn] = useState(true); mounted = setOn; return on ? <NotebookTab /> : null }
    fetchSpy = installFetch([[/mapping-offer$/, { offer: null }]])
    render(<Providers auth={AUTH} route="/journal/notebook?view=all"><NavProbe /><Host /></Providers>)
    await settle()
    await go('/journal/notebook?view=board')
    expect(usage('view_used')).toHaveLength(1)
    act(() => { mounted(false) })
    await settle()
    act(() => { mounted(true) })
    await settle()
    expect(screen.getByRole('button', { name: /^View: Board/ })).toBeTruthy()   // non-vacuity: remounted on the board
    expect(usage('view_used')).toHaveLength(1)
    await go('/journal/notebook?view=table')                                     // control: a new link still counts
    expect(usage('view_used')).toHaveLength(2)
  })

  it('linkOpened counts one router entry (location.key) at most once', () => {
    expect(linkOpened('PUSH', null, 'k1')).toBe(true)
    expect(linkOpened('PUSH', null, 'k1')).toBe(false)
    expect(linkOpened('PUSH', null, 'k2')).toBe(true)
    expect(linkOpened('PUSH', { [TOUR_NAV]: true }, 'k3')).toBe(false)
    expect(linkOpened('REPLACE', null, 'k4')).toBe(false)
  })

  it('Back to a view address sends none', async () => {
    await renderTab()
    await go('/journal/notebook?view=board')
    await go('/journal/notebook?view=table')
    expect(usage('view_used')).toHaveLength(2)                // control: the two links counted
    await go(-1)
    expect(screen.getByRole('button', { name: /^View: Board/ })).toBeTruthy()   // Back did reach the board
    expect(usage('view_used')).toHaveLength(2)
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
