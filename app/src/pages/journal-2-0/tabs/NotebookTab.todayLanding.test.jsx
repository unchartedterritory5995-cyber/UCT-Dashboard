import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Audit 2026-11-05, S15: where the Notebook opens. A bare Notebook lands on the Today home unless the member CHOSE
 * another landing (the `notebook_landing` preference); `?view=today` and `?view=home` open each home whatever the
 * landing; and until the preferences answer, a bare Notebook shows NEITHER home (opening Today makes the day's note,
 * which a member who chose Research Home must never get from a flash of the page they opted out of).
 * Through the real NotebookTab; the homes themselves are stand-ins (each has its own suite).
 */
const H = vi.hoisted(() => ({ total: 3, todayChunk: [] }))
vi.mock('../hooks/useJ2Notes', () => ({
  default: () => ({
    notes: [], isLoading: false, error: null, refresh: () => {}, mutate: () => {},
    total: H.total, hasMore: false, loadMore: () => {}, isLoadingMore: false,
  }),
}))
vi.mock('../components/notebook/FolderSidebar', () => ({
  default: (p) => (
    <div data-testid="folder-sidebar" data-today={p.isToday ? '1' : '0'}>
      {p.onSelectToday && <button type="button" onClick={p.onSelectToday}>Today row</button>}
    </div>
  ),
}))
vi.mock('../components/notebook/NoteEditorPage', () => ({ default: () => <div data-testid="note-editor" /> }))
vi.mock('../components/notebook/import/ImportWizard', () => ({ default: () => null }))
vi.mock('../components/connectors/NoteConnectorsTrustStrip', () => ({ default: () => null }))
vi.mock('../components/notebook/ResearchHome', () => ({ default: () => <div data-testid="research-home" /> }))
vi.mock('../components/notebook/TodayHome', () => {
  H.todayChunk.push(Date.now())          // the chunk was asked for
  return { default: (p) => (
    <div data-testid="today-home" data-read={p.todayRead}>
      <button type="button" onClick={p.onOpenResearchHome}>Research home →</button>
      <button type="button" onClick={p.onSelectAllNotes}>All notes</button>
    </div>
  ) }
})
vi.mock('../lib/offline/useBlockedNotes', () => ({ useBlockedNotes: () => ({ blocked: new Set() }) }))

import NotebookTab from './NotebookTab'
import { __setTodayLandingForTests } from '../lib/todayHome'
import { setCurrentAccountId } from '../lib/offline/currentAccount'
import { latchNotebookFlags, __resetNotebookFlags } from '../lib/offline/notebookFlags'

const T = { timeout: 20000 }
vi.setConfig({ testTimeout: 40000 })

let prefs
let prefsGate
beforeEach(() => {
  __setTodayLandingForTests(true)
  H.total = 3
  setCurrentAccountId('acct-A')
  Element.prototype.scrollIntoView = vi.fn()
  prefs = { notebook_tips: JSON.stringify({ v: 1, seen: ['first-run'] }) }
  prefsGate = null
  global.fetch = vi.fn(async (url) => {
    const u = String(url)
    const ok = (body) => ({ ok: true, status: 200, json: async () => body })
    if (u === '/api/auth/preferences') {
      if (prefsGate) await prefsGate
      return ok(prefs)
    }
    if (u.startsWith('/api/j2/note-folders')) return ok({ folders: [] })
    return ok({})
  })
})
afterEach(() => { setCurrentAccountId(null); __resetNotebookFlags() })

const at = (path) => render(<MemoryRouter initialEntries={[path]}><NotebookTab /></MemoryRouter>)

describe('the Notebook opens on Today (S15)', () => {
  it('a bare Notebook lands on the Today home, with the sidebar Today row lit', async () => {
    at('/journal')
    await screen.findByTestId('today-home', {}, T)
    expect(screen.queryByTestId('research-home')).toBeNull()
    expect(screen.getByTestId('folder-sidebar').getAttribute('data-today')).toBe('1')
  })

  it('a member who chose Research Home keeps it', async () => {
    prefs = { ...prefs, notebook_landing: 'home' }
    at('/journal')
    await screen.findByTestId('research-home', {}, T)
    expect(screen.queryByTestId('today-home')).toBeNull()
  })

  it('…and one who chose All notes lands on the list', async () => {
    prefs = { ...prefs, notebook_landing: 'all' }
    at('/journal')
    await screen.findByRole('toolbar', { name: 'Notes list tools' }, T)
    expect(screen.queryByTestId('today-home')).toBeNull()
    expect(screen.queryByTestId('research-home')).toBeNull()
  })

  it('until the preferences answer, neither home is drawn (Today makes the day’s note)', async () => {
    let release
    prefsGate = new Promise((r) => { release = r })
    at('/journal')
    await screen.findByRole('status', { name: 'Opening the Notebook' }, T)
    expect(screen.queryByTestId('today-home')).toBeNull()
    expect(screen.queryByTestId('research-home')).toBeNull()
    await act(async () => { release() })
    await screen.findByTestId('today-home', {}, T)
  })

  it('?view=home is Research Home and ?view=today is Today, whatever the landing', async () => {
    at('/journal?view=home')
    await screen.findByTestId('research-home', {}, T)
  })

  it('Research home and All notes are one click from Today', async () => {
    at('/journal?view=today')
    await screen.findByTestId('today-home', {}, T)
    act(() => { screen.getByRole('button', { name: 'Research home →' }).click() })
    await screen.findByTestId('research-home', {}, T)
    act(() => { screen.getByRole('button', { name: 'Today row' }).click() })
    await screen.findByTestId('today-home', {}, T)
    act(() => { screen.getByRole('button', { name: 'All notes' }).click() })
    await screen.findByRole('toolbar', { name: 'Notes list tools' }, T)
  })

  it('with the default off (the older suites), a bare Notebook is Research Home and ?view=today is still Today', async () => {
    __setTodayLandingForTests(false)
    at('/journal')
    await screen.findByTestId('research-home', {}, T)
  })
})

// Fix round 1 (I9) + fix round 2 (R1-B): Today's read is `make` (make the day's note if missing), `hold` (make=0: the
// first run IS due or on screen) or `wait` (no read yet: it cannot be decided). Only a member who can still get the
// first run ever waits or holds; an established member's one read is `make`, at once.
describe('the first run and the day note (I9, R1-B)', () => {
  beforeEach(() => { latchNotebookFlags({ notebook_starter_packs_enabled: true }) })

  it('a brand-new member (no notes, first run not yet seen): hold (make=0)', async () => {
    H.total = 0
    prefs = {}
    at('/journal?view=today')
    expect((await screen.findByTestId('today-home', {}, T)).getAttribute('data-read')).toBe('hold')
  })

  it('first run not yet seen and the notes count unknown: wait -- no read at all (never make=0, then make=1)', async () => {
    H.total = undefined
    prefs = {}
    at('/journal?view=today')
    expect((await screen.findByTestId('today-home', {}, T)).getAttribute('data-read')).toBe('wait')
  })

  it('R1-B: an ESTABLISHED member (first run recorded) reads with make at once, even with the notes count unknown', async () => {
    H.total = undefined
    prefs = { notebook_tips: JSON.stringify({ v: 1, seen: ['first-run'] }) }
    at('/journal?view=today')
    expect((await screen.findByTestId('today-home', {}, T)).getAttribute('data-read')).toBe('make')
  })

  it('CONTROL: a member who has seen the first run, with notes, reads with make', async () => {
    H.total = 3
    prefs = { notebook_tips: JSON.stringify({ v: 1, seen: ['first-run'] }) }
    at('/journal?view=today')
    await waitFor(() => expect(screen.getByTestId('today-home').getAttribute('data-read')).toBe('make'), T)
  })
})
