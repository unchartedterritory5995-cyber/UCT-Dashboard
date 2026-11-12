import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

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
  it('is the Today home without the landing choice or a Research home link; All notes stays', async () => {
    at('/journal?view=today')
    await waitFor(() => expect(document.querySelector('[data-today-home]')).not.toBeNull(), T)
    expect(screen.getByRole('heading', { level: 2, name: 'Daily brief' })).toBeTruthy()
    expect(screen.getByTestId('folder-sidebar').getAttribute('data-today')).toBe('1')
    expect(screen.queryByLabelText('Open the Notebook on')).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByRole('button', { name: /Research home/ })).toBeNull()
    expect(screen.queryByRole('toolbar', { name: 'Notes list tools' })).toBeNull()
    const home = document.querySelector('[data-today-home]')
    act(() => { within(home).getByRole('button', { name: 'All notes' }).click() })
    await listToolbar()
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
})
