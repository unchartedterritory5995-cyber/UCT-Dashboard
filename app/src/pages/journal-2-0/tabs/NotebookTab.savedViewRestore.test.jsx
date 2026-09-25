import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'

/**
 * Wave 6 fix round 5, R5-2 — a saved view reopens in the mode it was saved in,
 * through the door a member actually uses: the REAL sidebar row, fed by the
 * saved-views list the server returns.
 *
 * ⚰️ The live walk on 7006f1504 recorded W6_timeline FAIL: a timeline view
 * saved as `viewType: "timeline"`, the page reloaded, and the check read the
 * mode as a list. ⭐ MEASURED, it is the walk's locator and not the product:
 * the walk reopened the view with `get_by_role("button", name=<view name>,
 * exact=True)`, but this row's accessible name also carries its Rename/Delete
 * controls' labels. Playwright's own aria snapshot in real Chromium reads it
 * as "Walk timelineRename Walk timelineDelete Walk timeline" (the row's own
 * markup, set in a bare page), and the exact locator counts 0 while a title
 * locator counts 1. The row was never clicked; the walk recorded no row count,
 * so "not found" read as "restored as a list".
 * Lane E's item-6 rail (`NotebookTab.timeline.test.jsx`) could not have told
 * either story: it MOCKS `FolderSidebar` and hands `onSelectView` a hand-built
 * object, so it proves the restore branch and nothing about the row a member
 * clicks or the list the server serves.
 *
 * This rail keeps `FolderSidebar` REAL. Saved views live in a small fake of
 * `/api/j2/saved-views` (POST stores, GET lists), every mount gets a FRESH SWR
 * cache (a reload), and the row is found by its visible title. The modes come
 * from `SAVEABLE_VIEW_MODES` — derived, never typed — so a mode added tomorrow
 * is covered the day it lands. Each assertion is the toolbar's own
 * `aria-pressed` plus the view's rendered text.
 */

vi.mock('../hooks/useJ2Notes', async (importOriginal) => ({
  ...(await importOriginal()),
  default: () => ({
    notes: [{ id: 'n1', title: 'First note', tags: [], updatedAt: '2026-09-20T00:00:00Z' }],
    isLoading: false, error: null, refresh: vi.fn(), mutate: vi.fn(),
    total: 1, hasMore: false, loadMore: vi.fn(), isLoadingMore: false,
  }),
}))
// Stand-ins that SAY, in rendered text, which view NotebookTab chose to draw.
vi.mock('../components/notebook/NoteTimelineView', () => ({ default: () => <p>Stand-in: timeline view</p> }))
vi.mock('../components/notebook/NoteCalendarView', () => ({ default: () => <p>Stand-in: calendar view</p> }))
vi.mock('../components/notebook/NoteBoardView', () => ({ default: () => <p>Stand-in: board view</p> }))
vi.mock('../components/notebook/NoteGraphView', () => ({ default: () => <p>Stand-in: graph view</p> }))
vi.mock('../components/notebook/NotesTableView', () => ({ default: () => <p>Stand-in: table view</p> }))
vi.mock('../components/notebook/NoteEditorPage', () => ({ default: () => <div data-testid="note-editor" /> }))
vi.mock('../components/notebook/import/ImportWizard', () => ({ default: () => null }))
vi.mock('../components/connectors/NoteConnectorsTrustStrip', () => ({ default: () => null }))
vi.mock('../components/notebook/ResearchHome', () => ({ default: () => <div data-testid="research-home" /> }))
vi.mock('../lib/offline/useBlockedNotes', () => ({ useBlockedNotes: () => ({ blocked: new Set() }) }))

import NotebookTab from './NotebookTab'
import { SAVEABLE_VIEW_MODES, VIEW_MODES } from '../lib/savedViewModes'

let store // the fake server's saved views
beforeEach(() => {
  store = []
  global.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url)
    const method = (init.method || 'GET').toUpperCase()
    if (u === '/api/j2/saved-views' && method === 'POST') {
      const body = JSON.parse(init.body)
      const savedView = { id: `v${store.length + 1}`, name: body.name, viewType: body.viewType, spec: body.spec || {} }
      store.push(savedView)
      return { ok: true, status: 200, json: async () => ({ savedView }) }
    }
    if (u === '/api/j2/saved-views') return { ok: true, status: 200, json: async () => ({ savedViews: store.map((v) => ({ ...v })) }) }
    return { ok: true, status: 200, json: async () => ({}) }
  })
})
afterEach(() => cleanup())

// A fresh SWR cache per mount is what a reload is.
const openNotebook = () => render(
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
    <MemoryRouter initialEntries={['/journal?view=all']}><NotebookTab /></MemoryRouter>
  </SWRConfig>,
)

const labelOf = (mode) => VIEW_MODES.find((m) => m.id === mode).label
const pressed = (mode) => screen.getByRole('button', { name: labelOf(mode) }).getAttribute('aria-pressed')
const STAND_IN = { timeline: 'timeline', calendar: 'calendar', board: 'board', graph: 'graph', table: 'table' }

async function reopenSavedView(name) {
  // By its visible title: the row's accessible name also carries its
  // Rename/Delete labels, so an exact-name locator finds nothing (the walk's miss).
  const row = await screen.findByTitle(name)
  fireEvent.click(row)
}

describe('R5-2 — a saved view reopens in the mode it was saved in, through the real sidebar row', () => {
  it('save a TIMELINE view, reload, reopen it from the sidebar: the timeline is pressed and drawn', async () => {
    openNotebook()
    fireEvent.click(screen.getByRole('button', { name: 'Timeline view' }))
    expect(pressed('timeline')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: /save view/i }))
    const name = await screen.findByLabelText('Name')
    fireEvent.change(name, { target: { value: 'Walk timeline' } })
    fireEvent.keyDown(name, { key: 'Enter' })
    await waitFor(() => expect(store.map((v) => v.viewType)).toEqual(['timeline']))

    cleanup()          // the reload: a new mount, a new SWR cache, the list from the server
    openNotebook()
    expect(pressed('timeline'), 'a fresh page starts as a list').toBe('false')
    await reopenSavedView('Walk timeline')

    expect(pressed('timeline'), 'the saved timeline reopened as another mode').toBe('true')
    expect(await screen.findByText('Stand-in: timeline view')).toBeInTheDocument()
  })

  // CONTROL: the branch table is complete — every saveable mode, read from the
  // one list, reopens as itself.
  const MODES = [...SAVEABLE_VIEW_MODES]
  it('the mode list is not vacuous (non-vacuity for the table below)', () => {
    expect(MODES).toEqual(expect.arrayContaining(['board', 'calendar', 'graph', 'timeline']))
  })
  it.each(MODES)('a saved %s view reopens as itself', async (mode) => {
    store.push({ id: 'v1', name: `Saved ${mode}`, viewType: mode, spec: {} })
    openNotebook()
    await reopenSavedView(`Saved ${mode}`)
    expect(pressed(mode), `the saved ${mode} view reopened as another mode`).toBe('true')
    for (const other of MODES.filter((m) => m !== mode)) expect(pressed(other)).toBe('false')
    if (STAND_IN[mode]) expect(await screen.findByText(`Stand-in: ${STAND_IN[mode]} view`)).toBeInTheDocument()
  })

  it('the Tasks mode is never offered as a saveable view (saveable: false)', () => {
    expect(SAVEABLE_VIEW_MODES.has('tasks')).toBe(false)
    openNotebook()
    fireEvent.click(screen.getByRole('button', { name: 'Tasks view' }))
    expect(screen.queryByRole('button', { name: /save view/i })).toBeNull()
  })
})
