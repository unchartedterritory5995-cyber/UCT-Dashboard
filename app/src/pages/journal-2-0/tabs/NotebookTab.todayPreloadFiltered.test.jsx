import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Tier 3b fix round 2 (N6), its own file so the module registry is fresh: on a folder or ticker address the Today
 * chunk is never asked for (the list is drawn there, not a home).
 * (Notebook simplify, Task 5: no bare address asks for it any more either; NotebookTab.todayPreload.test.jsx.)
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
    <div data-testid="today-home" data-hold={p.holdMake ? 'make-0' : 'make'}>
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

// Fix round 2 (N6): a folder or ticker in the address (the filters this tab reads from it) is the list, never Today: no Today chunk.
describe('no Today chunk on a filtered address (N6)', () => {
  it.each(['/journal?folder=f1', '/journal?ticker=NVDA'])('%s', async (addr) => {
    const before = H.todayChunk.length
    at(addr)
    await screen.findByRole('toolbar', { name: 'Notes list tools' }, T)
    await new Promise((r) => setTimeout(r, 50))
    expect(H.todayChunk.length).toBe(before)
  })
})
