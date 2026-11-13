import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'

/**
 * Notebook simplify, Task 5 ("open on your notes"): one front door, one optional home.
 *   * a bare Notebook opens the notes list, whatever `notebook_landing` holds, and makes nothing (no day note);
 *   * `?view=home` (Research home's old address) opens the list too; `?view=today` opens the Daily brief, which no
 *     longer offers "Open the Notebook on" or a Research home link;
 *   * the list's toolbar has an "AI" button, before "Today's note", that opens the notebook-wide Ask.
 * Through the real NotebookTab, the real Daily brief (TodayHome) and the real Ask panel: a stand-in home could not
 * show that a bare open fires no day-note request. The panel is a stand-in (FolderSidebar.dailyBrief.test.jsx).
 *
 * The production default is ON here (`__setTodayLandingForTests(true)`): that is what a member runs.
 */
const H = vi.hoisted(() => ({ total: 3 }))
vi.mock('../hooks/useJ2Notes', () => ({
  default: () => ({
    notes: H.total ? [{ id: 'n1', title: 'Alpha note', tags: [], updatedAt: '2026-11-10T12:00:00Z' }] : [],
    isLoading: false, error: null, refresh: () => {}, mutate: () => {},
    total: H.total, hasMore: false, loadMore: () => {}, isLoadingMore: false,
  }),
}))
vi.mock('../components/notebook/FolderSidebar', () => ({
  default: (p) => (
    <div data-testid="folder-sidebar" data-today={p.isToday ? '1' : '0'}>
      {p.onSelectToday && <button type="button" onClick={p.onSelectToday}>Daily brief row</button>}
      {p.onSelectAllNotes && <button type="button" onClick={p.onSelectAllNotes}>All notes row</button>}
    </div>
  ),
}))
vi.mock('../components/notebook/NoteEditorPage', () => ({ default: () => <div data-testid="note-editor" /> }))
vi.mock('../components/notebook/import/ImportWizard', () => ({ default: () => null }))
vi.mock('../components/connectors/NoteConnectorsTrustStrip', () => ({ default: () => null }))
vi.mock('../lib/offline/useBlockedNotes', () => ({ useBlockedNotes: () => ({ blocked: new Set() }) }))
// the walkthrough gate and the tour offer have their own suites; the onboarding switch would otherwise start them
vi.mock('../components/notebook/onboarding/NotebookTourGate', () => ({ default: () => null }))
vi.mock('../components/notebook/onboarding/TourOfferDoor', () => ({ default: () => null }))

import NotebookTab from './NotebookTab'
import { __setTodayLandingForTests } from '../lib/todayHome'
import { setCurrentAccountId } from '../lib/offline/currentAccount'
import { __resetNotebookFlags, latchNotebookFlags } from '../lib/offline/notebookFlags'
import { SAMPLE_COPY, SAMPLE_URL } from '../components/notebook/onboarding/sampleNotebook'

const T = { timeout: 20000 }
vi.setConfig({ testTimeout: 40000 })

const TODAY_BODY = {
  day: '2026-11-11',
  session: { phase: 'open' },
  todayNote: { id: 'd1', title: '2026-11-11 · Wednesday', items: [] },
  setups: { rows: [], count: 0 },
  names: { rows: [], count: 0 },
  openFromYesterday: { items: [], count: 0 },
  onThisDay: { items: [] },
}

let prefs
beforeEach(() => {
  __setTodayLandingForTests(true)
  H.total = 3
  setCurrentAccountId('acct-A')
  Element.prototype.scrollIntoView = vi.fn()
  prefs = { notebook_tips: JSON.stringify({ v: 1, seen: ['first-run'] }) }
  global.fetch = vi.fn(async (url) => {
    const u = String(url)
    const ok = (body) => ({ ok: true, status: 200, json: async () => body })
    if (u === '/api/auth/preferences') return ok(prefs)
    if (u.startsWith('/api/j2/note-folders')) return ok({ folders: [] })
    if (u.startsWith('/api/j2/notes/today')) return ok(TODAY_BODY)
    return ok({})
  })
})
afterEach(() => { setCurrentAccountId(null); __resetNotebookFlags() })

const at = (path) => render(<MemoryRouter initialEntries={[path]}><NotebookTab /></MemoryRouter>)
const urls = () => global.fetch.mock.calls.map(([u]) => String(u))
const dayNoteCalls = () => urls().filter((u) => u.startsWith('/api/j2/notes/today') || u.startsWith('/api/j2/notes/daily'))
const listToolbar = () => screen.findByRole('toolbar', { name: 'Notes list tools' }, T)

describe('a bare Notebook opens the notes list (Task 5)', () => {
  for (const stored of ['today', 'home', 'all', undefined]) {
    it(`stored landing ${JSON.stringify(stored)}: the list, never a home`, async () => {
      if (stored !== undefined) prefs = { ...prefs, notebook_landing: stored }
      at('/journal')
      await listToolbar()
      await waitFor(() => expect(urls()).toContain('/api/auth/preferences'), T)
      expect(screen.getByRole('heading', { level: 2, name: 'All notes' })).toBeTruthy()
      expect(document.querySelector('[data-today-home]')).toBeNull()
      expect(screen.queryByRole('heading', { name: 'Research home' })).toBeNull()
      expect(screen.getByTestId('folder-sidebar').getAttribute('data-today')).toBe('0')
    })
  }

  it('makes nothing: no day-note request fires on a bare open', async () => {
    prefs = { ...prefs, notebook_landing: 'today' }
    at('/journal')
    await listToolbar()
    await waitFor(() => expect(urls()).toContain('/api/auth/preferences'), T)
    // give any home that would mount (and read) a chance to do so
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    expect(dayNoteCalls()).toEqual([])
  })

  it('?view=home (Research home’s old address) opens the list', async () => {
    at('/journal?view=home')
    await listToolbar()
    expect(screen.getByRole('heading', { level: 2, name: 'All notes' })).toBeTruthy()
    expect(document.querySelector('[data-today-home]')).toBeNull()
  })
})

describe('the Daily brief (?view=today)', () => {
  it('is the Today home without the landing choice or a Research home link; the panel row goes back to All notes', async () => {
    at('/journal?view=today')
    await waitFor(() => expect(document.querySelector('[data-today-home]')).not.toBeNull(), T)
    // Simplify pass 2: ONE "Daily brief" heading -- the brief's visible one, which is also the pane's focus landing.
    const headings = screen.getAllByRole('heading', { level: 2, name: 'Daily brief' })
    expect(headings).toHaveLength(1)
    expect(document.querySelector('[data-today-home]').contains(headings[0])).toBe(true)
    expect(document.querySelectorAll('[data-focus-fallback]')).toHaveLength(1)
    expect(headings[0].hasAttribute('data-focus-fallback')).toBe(true)
    expect(screen.getByTestId('folder-sidebar').getAttribute('data-today')).toBe('1')
    expect(screen.queryByLabelText('Open the Notebook on')).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByRole('button', { name: /Research home/ })).toBeNull()
    expect(screen.queryByRole('toolbar', { name: 'Notes list tools' })).toBeNull()
    // B4: All notes is the panel's row now, not a button on the brief.
    expect(within(document.querySelector('[data-today-home]')).queryByRole('button', { name: 'All notes' })).toBeNull()
  })

  it('B1: the Daily brief reads with make=0 and makes nothing; its Start is the list button’s door', async () => {
    let body = { ...TODAY_BODY, todayNote: { id: null, missing: true, trashed: false, created: false, items: [] } }
    global.fetch.mockImplementation(async (url, opts = {}) => {
      const u = String(url)
      const ok = (b) => ({ ok: true, status: 200, json: async () => b })
      if (u === '/api/auth/preferences') return ok(prefs)
      if (u.startsWith('/api/j2/note-folders')) return ok({ folders: [] })
      if (u.startsWith('/api/j2/notes/today')) return ok(body)
      if (u === '/api/j2/notes/daily' && opts.method === 'POST') {
        body = { ...TODAY_BODY, todayNote: { id: 'made1', title: '2026-11-11 · Wednesday', items: [] } }
        return ok({ note: { id: 'made1', title: '2026-11-11 · Wednesday', folderId: 'fd' }, created: true, templateMissing: false })
      }
      return ok({})
    })
    // The app's own dedupe window (App.jsx SWR_CONFIG is 8 s; longer here): a return to the brief inside it reads
    // nothing unless the door that made the note revalidated the brief's key. A fresh cache, so no other case's
    // answer is in it.
    render(
      <SWRConfig value={{ dedupingInterval: 600_000, provider: () => new Map() }}>
        <MemoryRouter initialEntries={['/journal?view=today']}><NotebookTab /></MemoryRouter>
      </SWRConfig>,
    )
    const start = await screen.findByRole('button', { name: "Start today's note" }, T)
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(dayNoteCalls()).toEqual(['/api/j2/notes/today?make=0'])
    act(() => { start.click() })
    await waitFor(() => expect(screen.getByTestId('note-editor')).toBeTruthy(), T)
    const posts = global.fetch.mock.calls.filter(([u, o]) => String(u) === '/api/j2/notes/daily' && o?.method === 'POST')
    expect(posts).toHaveLength(1)
    expect(JSON.parse(posts[0][1].body)).toMatchObject({ seedToday: true })
    // Back on the brief (well inside SWR's dedupe window): its read was revalidated, so it says the note exists.
    act(() => { screen.getByRole('button', { name: 'Daily brief row' }).click() })
    expect(await screen.findByRole('button', { name: "Open today's note" }, T)).toBeTruthy()
    expect(screen.queryByRole('button', { name: "Start today's note" })).toBeNull()
  })

  it('the panel’s Daily brief row opens it', async () => {
    at('/journal')
    await listToolbar()
    act(() => { screen.getByRole('button', { name: 'Daily brief row' }).click() })
    await waitFor(() => expect(document.querySelector('[data-today-home]')).not.toBeNull(), T)
  })
})

// The controller's ruling: Research home's first-run "Add a sample notebook" stays reachable for a member with zero
// notes -- in the list's own empty state, beside "Import notes", running the same action.
describe('a member with no notes', () => {
  it('the list’s empty state offers Import notes and Add a sample notebook, which adds it and opens the welcome note', async () => {
    H.total = 0
    latchNotebookFlags({ notebook_onboarding_enabled: true })
    const base = global.fetch
    global.fetch = vi.fn(async (url, opts = {}) => {
      if (String(url) === SAMPLE_URL && opts.method === 'POST') {
        return { ok: true, status: 200, json: async () => ({ folderId: 'f-s', welcomeNoteId: 'w1' }) }
      }
      return base(url, opts)
    })
    at('/journal')
    await screen.findByText('Your notebook is empty.', {}, T)
    expect(screen.getByRole('button', { name: 'Import notes' })).toBeTruthy()
    const add = await screen.findByRole('button', { name: SAMPLE_COPY.add }, T)
    act(() => { add.click() })
    await screen.findByTestId('note-editor', {}, T)
    expect(global.fetch.mock.calls.some(([u, o]) => String(u) === SAMPLE_URL && o?.method === 'POST')).toBe(true)
  })

  it('CONTROL: a member who already had the sample is not offered it again', async () => {
    H.total = 0
    latchNotebookFlags({ notebook_onboarding_enabled: true })
    prefs = { ...prefs, notebook_sample: JSON.stringify({ v: 1, ids: ['s1'] }) }
    at('/journal')
    await screen.findByText('Your notebook is empty.', {}, T)
    await waitFor(() => expect(urls()).toContain('/api/auth/preferences'), T)
    await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
    expect(screen.queryByRole('button', { name: SAMPLE_COPY.add })).toBeNull()
  })
})

describe('the list toolbar’s AI button', () => {
  it('sits before "Today’s note" and opens the notebook-wide Ask', async () => {
    at('/journal')
    const toolbar = await listToolbar()
    const ai = within(toolbar).getByRole('button', { name: 'AI' })
    const todays = within(toolbar).getByRole('button', { name: "Today's note" })
    // eslint-disable-next-line no-bitwise
    expect(ai.compareDocumentPosition(todays) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(ai.getAttribute('aria-expanded')).toBe('false')
    act(() => { ai.click() })
    expect((await screen.findByTestId('ask-scope', {}, T)).textContent).toContain('My Notebook')
    expect(ai.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('region', { name: 'Ask your Notebook' })).toBeTruthy()
    // pressed again, it closes
    act(() => { ai.click() })
    await waitFor(() => expect(screen.queryByTestId('ask-scope')).toBeNull(), T)
    expect(ai.getAttribute('aria-expanded')).toBe('false')
  })

  // Preview fix round 1 (item 4): closing the question panel closed only the panel; "Or tell Notebook what to change"
  // stayed on screen by itself until AI was pressed again.
  it('closing the question panel closes the whole section, both pieces, and focus goes back to AI', async () => {
    latchNotebookFlags({ notebook_ai_actions_enabled: true })
    at('/journal')
    const ai = within(await listToolbar()).getByRole('button', { name: 'AI' })
    act(() => { ai.click() })
    // non-vacuity: both pieces are open
    expect(await screen.findByRole('region', { name: 'Or tell Notebook what to change' }, T)).toBeTruthy()
    expect(screen.getByTestId('ask-scope')).toBeTruthy()
    act(() => { screen.getByRole('button', { name: 'Close Ask' }).click() })
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Ask your Notebook' })).toBeNull(), T)
    expect(screen.queryByRole('region', { name: 'Or tell Notebook what to change' })).toBeNull()
    expect(ai.getAttribute('aria-expanded')).toBe('false')
    await waitFor(() => expect(document.activeElement).toBe(ai), T)
    // AI opens both again
    act(() => { ai.click() })
    expect(await screen.findByRole('region', { name: 'Or tell Notebook what to change' }, T)).toBeTruthy()
    expect(screen.getByTestId('ask-scope')).toBeTruthy()
  })

  it('the section is closed whenever the list is entered: open, go to the Daily brief, come back -- closed', async () => {
    at('/journal')
    let ai = within(await listToolbar()).getByRole('button', { name: 'AI' })
    act(() => { ai.click() })
    await screen.findByTestId('ask-scope', {}, T)
    act(() => { screen.getByRole('button', { name: 'Daily brief row' }).click() })
    await waitFor(() => expect(document.querySelector('[data-today-home]')).not.toBeNull(), T)
    // Simplify pass 2 (B4): the brief has no All notes button; the panel's row is the way back.
    act(() => { screen.getByRole('button', { name: 'All notes row' }).click() })
    ai = within(await listToolbar()).getByRole('button', { name: 'AI' })
    expect(ai.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('region', { name: 'Ask your Notebook' })).toBeNull()
    expect(screen.queryByTestId('ask-scope')).toBeNull()
  })
})
