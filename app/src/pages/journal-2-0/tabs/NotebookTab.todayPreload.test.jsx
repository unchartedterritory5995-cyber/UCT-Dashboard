import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Tier 3b fix round 1 (I1), its own file so the module registry is fresh: the Today chunk is asked for in the
 * Notebook's first render, while the preferences read is still in flight.
 *
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
    <div data-testid="today-home" data-hold={p.holdMake ? 'make-0' : 'make'}>
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

// Fix round 1 (I1): Today is the default landing, so its chunk is asked for in the Notebook's FIRST render, beside the
// preferences read -- never after it (that made three round trips in a row).
describe('the Today chunk starts with the preferences read (I1)', () => {
  it('asks for the Today chunk while the preferences are still unanswered', async () => {
    prefsGate = new Promise(() => {})                 // the preferences never answer in this test
    const before = H.todayChunk.length
    at('/journal')
    await screen.findByRole('status', { name: 'Opening the Notebook' }, T)
    await waitFor(() => expect(H.todayChunk.length).toBeGreaterThan(before), T)
    expect(screen.queryByTestId('today-home')).toBeNull()      // still pending: the chunk came first
  })
})
