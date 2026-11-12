import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * ⚰️ Notebook simplify, Task 5 (2026-11-11): Research Home is no longer routed; `?view=home` opens the notes list. The
 * four tours below that start on Research Home's boxes now land on the list, where their first anchor is not drawn
 * (the engine skips a step whose anchor is absent). Re-pointing them is the go-live pass's
 * (docs/notebook/simplify-2026-11-11-ledger.md, Task 5): `DEFERRED_TO_GO_LIVE` names them, and this rail pins that
 * list to exactly the tours whose first anchor lives in a Research Home file, so a re-pointed tour has to leave it.
 * What follows describes the rail as it was written:
 *
 * Tier 3b fix round 1 (I2): with the Today home as the DEFAULT landing (the production setting, ON here --
 * test-setup.js turns it off for the older suites), every Learn tour that starts on the Notebook route is started AT
 * ITS ROUTE through the real NotebookTab, and the page drawn there must be the one that holds its first anchor.
 * Four tours start on Research Home's boxes (voice notes, earnings prep, passed setups, reviews); on the bare address
 * they would land on Today, find no anchor and skip every step. They start at `?view=home` now.
 *
 * The anchor's host is the step's own `file` (each step file names where its anchor lives). A file Research Home
 * renders -- ResearchHome.jsx and the boxes it imports, read from its own source below, never typed -- must find
 * Research Home on screen at the start; any other file must find the page that is not a home (the list's views).
 */
vi.mock('../../../hooks/useJ2Notes', () => ({
  default: () => ({
    notes: [], isLoading: false, error: null, refresh: () => {}, mutate: () => {},
    total: 3, hasMore: false, loadMore: () => {}, isLoadingMore: false,
  }),
}))
vi.mock('../FolderSidebar', () => ({ default: () => <div data-testid="folder-sidebar" /> }))
vi.mock('../NoteEditorPage', () => ({ default: () => <div data-testid="note-editor" /> }))
vi.mock('../import/ImportWizard', () => ({ default: () => null }))
vi.mock('../../connectors/NoteConnectorsTrustStrip', () => ({ default: () => null }))
vi.mock('../ResearchHome', () => ({ default: () => <div data-testid="research-home" /> }))
vi.mock('../TodayHome', () => ({ default: () => <div data-testid="today-home" /> }))
vi.mock('../../../lib/offline/useBlockedNotes', () => ({ useBlockedNotes: () => ({ blocked: new Set() }) }))

import NotebookTab from '../../../tabs/NotebookTab'
import { __setTodayLandingForTests } from '../../../lib/todayHome'
import { setCurrentAccountId } from '../../../lib/offline/currentAccount'
import { NOTEBOOK_ROOT, TOUR_REGISTRY } from './tourRegistry'

const T = { timeout: 20000 }
vi.setConfig({ testTimeout: 40000 })

// The files Research Home draws: itself, and every component it imports from its own folder (read, not typed).
const RH_SRC = fs.readFileSync(path.join(path.resolve(__dirname), '..', 'ResearchHome.jsx'), 'utf8')
const HOME_FILES = new Set(['components/notebook/ResearchHome.jsx',
  ...[...RH_SRC.matchAll(/import\(\s*'\.\/(\w+)'\s*\)|from '\.\/(\w+)'/g)]
    .map((m) => `components/notebook/${m[1] || m[2]}.jsx`)])

// The walkthroughs whose first anchor is on Research Home (no longer routed): re-pointed at go-live.
const DEFERRED_TO_GO_LIVE = Object.freeze(['voice-notes', 'review-drafts', 'earnings-prep', 'passed-setups'])

const notebookStarts = TOUR_REGISTRY.filter((t) => typeof t.start === 'string'
  && new URL(t.start, 'http://x.invalid').pathname === NOTEBOOK_ROOT)

beforeEach(() => {
  __setTodayLandingForTests(true)
  setCurrentAccountId('acct-A')
  Element.prototype.scrollIntoView = vi.fn()
  global.fetch = vi.fn(async (url) => ({
    ok: true, status: 200,
    json: async () => (String(url) === '/api/auth/preferences'
      ? { notebook_tips: JSON.stringify({ v: 1, seen: ['first-run'] }) }
      : String(url).startsWith('/api/j2/note-folders') ? { folders: [] } : {}),
  }))
})
afterEach(() => { setCurrentAccountId(null) })

describe('every Learn tour that starts on the Notebook lands on the notes list (Task 5; Today ON)', () => {
  it('NON-VACUITY: the four Research Home tours are among them, and their hosts are Research Home files', async () => {
    const ids = notebookStarts.map((t) => t.id)
    for (const id of ['voice-notes', 'earnings-prep', 'passed-setups', 'review-drafts']) expect(ids).toContain(id)
    expect(HOME_FILES.has('components/notebook/ReportingSoon.jsx')).toBe(true)
    expect(HOME_FILES.has('components/notebook/PassedSetups.jsx')).toBe(true)
    expect(HOME_FILES.has('components/notebook/NewNoteMenu.jsx')).toBe(true)
  })

  it('the deferred list is exactly the tours whose first anchor lives in a Research Home file', async () => {
    const onHome = []
    for (const t of notebookStarts) {
      const { steps } = await t.load()
      if (HOME_FILES.has(steps[0].file)) onHome.push(t.id)
    }
    expect(onHome.sort()).toEqual([...DEFERRED_TO_GO_LIVE].sort())
  })

  it.each(notebookStarts.map((t) => [t.id, t]))('%s', async (_id, entry) => {
    render(<MemoryRouter initialEntries={[entry.start]}><NotebookTab /></MemoryRouter>)
    await screen.findByTestId('folder-sidebar', {}, T)
    await screen.findByRole('toolbar', { name: 'Notes list tools' }, T)
    expect(screen.queryByTestId('research-home')).toBeNull()
    expect(screen.queryByTestId('today-home')).toBeNull()
  })
})
