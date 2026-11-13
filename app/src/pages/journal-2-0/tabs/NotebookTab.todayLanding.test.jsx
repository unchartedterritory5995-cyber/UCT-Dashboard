import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Audit 2026-11-05, S15: the Today home (the Daily brief since Notebook simplify, Task 5) and the day note.
 * ⚰️ This file also railed where the Notebook OPENS (the Today home by default, the member's `notebook_landing` choice,
 * Research Home at `?view=home`, nothing drawn until the preferences answered). Task 5 made the Notebook open on the
 * notes list, always; those seven cases were replaced by NotebookTab.landing.test.jsx. What stays here: what the Daily
 * brief reads (`make`, `hold`, `wait`) for each first-run state.
 * Through the real NotebookTab; the Daily brief itself is a stand-in (it has its own suite).
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
vi.mock('../components/notebook/TodayHome', () => {
  H.todayChunk.push(Date.now())          // the chunk was asked for
  return { default: (p) => (
    <div data-testid="today-home" data-read={p.todayRead}>
      <button type="button" onClick={p.onSelectAllNotes}>All notes</button>
    </div>
  ) }
})
vi.mock('../lib/offline/useBlockedNotes', () => ({ useBlockedNotes: () => ({ blocked: new Set() }) }))

import NotebookTab from './NotebookTab'
import { useFirstRunPending } from '../lib/firstRun'
import { __setTodayLandingForTests } from '../lib/todayHome'
import { setCurrentAccountId } from '../lib/offline/currentAccount'
import { latchNotebookFlags, __resetNotebookFlags } from '../lib/offline/notebookFlags'

const T = { timeout: 20000 }
vi.setConfig({ testTimeout: 40000 })

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
    if (u === '/api/auth/preferences') {
      return ok(prefs)
    }
    if (u.startsWith('/api/j2/note-folders')) return ok({ folders: [] })
    return ok({})
  })
})
afterEach(() => { setCurrentAccountId(null); __resetNotebookFlags() })

const at = (path) => render(<MemoryRouter initialEntries={[path]}><NotebookTab /></MemoryRouter>)

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

// Final fix (C5): the shell's walkthrough gate (RegistryToursGate.jsx) cannot compute the first run's due rule (it does
// not know the notes count), so the notes list publishes "the first run is due here or not decided yet" for it.
function PendingProbe() {
  return <p data-testid="pending" data-on={useFirstRunPending() ? '1' : '0'} />
}
describe('the notes list publishes "first run pending" for the walkthrough gate (C5)', () => {
  beforeEach(() => { latchNotebookFlags({ notebook_starter_packs_enabled: true }) })
  const withProbe = (path) => render(
    <MemoryRouter initialEntries={[path]}><PendingProbe /><NotebookTab /></MemoryRouter>,
  )

  it('first run not yet seen and the notes count unknown: pending; leaving the Notebook clears it', async () => {
    H.total = undefined
    prefs = {}
    const view = withProbe('/journal?view=all')
    await waitFor(() => expect(screen.getByTestId('pending').getAttribute('data-on')).toBe('1'), T)
    view.unmount()
    render(<MemoryRouter><PendingProbe /></MemoryRouter>)
    expect(screen.getByTestId('pending').getAttribute('data-on')).toBe('0')
  })

  it('CONTROL: an established member (first run recorded, with notes) is never pending', async () => {
    H.total = 3
    prefs = { notebook_tips: JSON.stringify({ v: 1, seen: ['first-run'] }) }
    withProbe('/journal?view=all')
    await waitFor(() => expect(global.fetch.mock.calls.some(([u]) => String(u) === '/api/auth/preferences')).toBe(true), T)
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.getByTestId('pending').getAttribute('data-on')).toBe('0')
  })
})
