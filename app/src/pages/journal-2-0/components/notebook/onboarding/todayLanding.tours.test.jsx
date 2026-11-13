import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Every walkthrough that starts on the Notebook route is started AT ITS ROUTE through the real NotebookTab, and the
 * page drawn there must be the one that holds its first anchor.
 *
 * Two pages answer on the Notebook route (Notebook simplify, Task 5): `?view=today` is the Daily brief (TodayHome.jsx);
 * every other address is the notes list. The anchor's host is the step's own `file`. A file the Daily brief renders --
 * TodayHome.jsx and the components it imports from its own folder, read from its own source below, never typed --
 * must find the Daily brief on screen at the start; any other file must find the list.
 *
 * ⚰️ Task 5 left four tours (voice-notes, review-drafts, earnings-prep, passed-setups) starting on Research Home, no
 * longer routed, and named them in `DEFERRED_TO_GO_LIVE`. Go-live wave 1 re-pointed them (voice notes and reviews to
 * the list's New menu, earnings prep and passed setups to the Daily brief), so the list is EMPTY and stays pinned to
 * exactly the tours whose start page does not hold their first anchor.
 *
 * The first step is read as a desktop screen (tourTiers.js: with no matchMedia the desktop steps are kept), the one
 * this jsdom page is.
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
vi.mock('../TodayHome', () => ({ default: () => <div data-testid="today-home" /> }))
vi.mock('../../../lib/offline/useBlockedNotes', () => ({ useBlockedNotes: () => ({ blocked: new Set() }) }))

import NotebookTab from '../../../tabs/NotebookTab'
import { __setTodayLandingForTests } from '../../../lib/todayHome'
import { setCurrentAccountId } from '../../../lib/offline/currentAccount'
import { NOTEBOOK_ROOT, TOUR_REGISTRY } from './tourRegistry'
import { stepsForScreen } from './tourTiers'

const T = { timeout: 20000 }
vi.setConfig({ testTimeout: 40000 })

// The files the Daily brief draws: itself, and every component it imports from its own folder (read, not typed).
const BRIEF_SRC = fs.readFileSync(path.join(path.resolve(__dirname), '..', 'TodayHome.jsx'), 'utf8')
const BRIEF_FILES = new Set(['components/notebook/TodayHome.jsx',
  ...[...BRIEF_SRC.matchAll(/import\(\s*'\.\/(\w+)'\s*\)|from '\.\/(\w+)'/g)]
    .map((m) => `components/notebook/${m[1] || m[2]}.jsx`)])

// The walkthroughs whose start page does not hold their first anchor. Empty since go-live wave 1.
const DEFERRED_TO_GO_LIVE = Object.freeze([])

const notebookStarts = TOUR_REGISTRY.filter((t) => typeof t.start === 'string'
  && new URL(t.start, 'http://x.invalid').pathname === NOTEBOOK_ROOT)
const startsOnBrief = (t) => new URL(t.start, 'http://x.invalid').searchParams.get('view') === 'today'

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

describe('every walkthrough that starts on the Notebook lands on the page holding its first anchor', () => {
  it('NON-VACUITY: the four re-pointed tours start on the Notebook, two on the Daily brief, whose files it reads', () => {
    const ids = notebookStarts.map((t) => t.id)
    for (const id of ['voice-notes', 'earnings-prep', 'passed-setups', 'review-drafts']) expect(ids).toContain(id)
    expect(notebookStarts.filter(startsOnBrief).map((t) => t.id).sort()).toEqual(['earnings-prep', 'passed-setups'])
    expect(BRIEF_FILES.has('components/notebook/ReportingSoon.jsx')).toBe(true)
    expect(BRIEF_FILES.has('components/notebook/PassedSetups.jsx')).toBe(true)
    expect(BRIEF_FILES.has('tabs/NotebookTab.jsx')).toBe(false)
  })

  it('the deferred list is exactly the tours whose start page does not hold their first anchor (none)', async () => {
    const misplaced = []
    for (const t of notebookStarts) {
      const [first] = stepsForScreen((await t.load()).steps)
      if (BRIEF_FILES.has(first.file) !== startsOnBrief(t)) misplaced.push(t.id)
    }
    expect(misplaced.sort()).toEqual([...DEFERRED_TO_GO_LIVE].sort())
  })

  it('CONTROL: a tour starting on the list whose first anchor is a Daily brief file is caught', () => {
    const fake = { start: `${NOTEBOOK_ROOT}?view=all` }
    expect(BRIEF_FILES.has('components/notebook/ReportingSoon.jsx') !== startsOnBrief(fake)).toBe(true)
  })

  it.each(notebookStarts.map((t) => [t.id, t]))('%s', async (_id, entry) => {
    render(<MemoryRouter initialEntries={[entry.start]}><NotebookTab /></MemoryRouter>)
    await screen.findByTestId('folder-sidebar', {}, T)
    if (startsOnBrief(entry)) {
      expect(await screen.findByTestId('today-home', {}, T)).toBeInTheDocument()
      expect(screen.queryByRole('toolbar', { name: 'Notes list tools' })).toBeNull()
    } else {
      await screen.findByRole('toolbar', { name: 'Notes list tools' }, T)
      expect(screen.queryByTestId('today-home')).toBeNull()
    }
  })
})
