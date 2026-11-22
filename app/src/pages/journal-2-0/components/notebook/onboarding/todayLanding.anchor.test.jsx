import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Tier 3b fix round 2 (N7): one UN-MOCKED case beside todayLanding.tours.test.jsx (which stands the pages in). The
 * review-drafts tour's start address renders the REAL notes list, and the tour's first anchor is on the page.
 * Go-live wave 1: Research Home (its old screen) is gone; the tour starts on the list (`?view=all`), at the New menu's
 * arrow (`templates`), and waits for the menu's "Today's recap" row, which a press on that arrow draws.
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
vi.mock('../../../lib/offline/useBlockedNotes', () => ({ useBlockedNotes: () => ({ blocked: new Set() }) }))

import NotebookTab from '../../../tabs/NotebookTab'
import { __setTodayLandingForTests } from '../../../lib/todayHome'
import { setCurrentAccountId } from '../../../lib/offline/currentAccount'
import { latchNotebookFlags, __resetNotebookFlags } from '../../../lib/offline/notebookFlags'
import { getTourEntry } from './tourRegistry'
import { stepsForScreen } from './tourTiers'

vi.setConfig({ testTimeout: 40000 })

beforeEach(() => {
  __setTodayLandingForTests(true)
  setCurrentAccountId('acct-A')
  Element.prototype.scrollIntoView = vi.fn()
  latchNotebookFlags({ notebook_review_drafts_enabled: true })
  global.fetch = vi.fn(async (url) => ({
    ok: true, status: 200,
    json: async () => (String(url) === '/api/auth/preferences'
      ? { notebook_tips: JSON.stringify({ v: 1, seen: ['first-run'] }) }
      : String(url).startsWith('/api/j2/note-folders') ? { folders: [] } : {}),
  }))
})
afterEach(() => { setCurrentAccountId(null); __resetNotebookFlags() })

describe('the review-drafts tour start, un-mocked (N7)', () => {
  it('its start address draws the notes list holding its first anchor, and opening it draws the step it waits for', async () => {
    const entry = getTourEntry('review-drafts')
    const steps = stepsForScreen((await entry.load()).steps)   // a desktop screen (jsdom has no matchMedia match)
    expect(entry.start).toBe('/journal/notebook?view=all')
    render(<MemoryRouter initialEntries={[entry.start]}><NotebookTab /></MemoryRouter>)
    await waitFor(() => expect(document.querySelector('[data-list-toolbar]')).not.toBeNull(), { timeout: 20000 })
    // Simplify pass 2 (C2): the arrow, then "Draft a review" (its second view holds the reviews), then the reviews.
    expect(steps[0]).toMatchObject({ anchor: 'templates', waitFor: 'review-drafts-open' })
    expect(steps[1]).toMatchObject({ anchor: 'review-drafts-open', waitFor: 'review-drafts-daily' })
    const first = document.querySelector(`[data-tour="${steps[0].anchor}"]`)
    expect(first).not.toBeNull()
    expect(document.querySelector('[data-tour="review-drafts-open"]')).toBeNull()
    fireEvent.click(first)
    const open = document.querySelector('[data-tour="review-drafts-open"]')
    expect(open).not.toBeNull()
    expect(document.querySelector('[data-tour="review-drafts-daily"]')).toBeNull()
    fireEvent.click(open)
    for (const s of steps.slice(2)) expect(document.querySelector(`[data-tour="${s.anchor}"]`), s.anchor).not.toBeNull()
    expect(document.querySelector('[data-today-home]')).toBeNull()
  })
})
