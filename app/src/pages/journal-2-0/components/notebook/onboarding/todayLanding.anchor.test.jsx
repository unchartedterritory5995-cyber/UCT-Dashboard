import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Tier 3b fix round 2 (N7): one UN-MOCKED case beside todayLanding.tours.test.jsx (which stands the homes in). With
 * the Today home as the default landing (ON here), the review-drafts tour's start address renders the REAL Research
 * Home, and the tour's first anchor is on the page.
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
  it('its start address draws the real Research Home with the tour’s first anchor', async () => {
    const entry = getTourEntry('review-drafts')
    const { steps } = await entry.load()
    expect(entry.start).toBe('/journal/notebook?view=home')
    render(<MemoryRouter initialEntries={[entry.start]}><NotebookTab /></MemoryRouter>)
    await waitFor(() => expect(document.querySelector(`[data-tour="${steps[0].anchor}"]`)).not.toBeNull(), { timeout: 20000 })
    expect(steps[0].anchor).toBe('review-drafts-home')
    expect(document.querySelector('[data-today-home]')).toBeNull()
  })
})
