// Follow-up B, item 6b (the regression test follow-up A's re-review asked for): the Daily brief's Restore (today's note
// in the Trash) fetches the bulk actions library on demand (lib/noteBatch.js has NO default export). A failed fetch is
// retried once under a new address (lib/lazyChunk.js `chunkRetry.importUrl`); a retry that succeeds must be ACCEPTED
// and the restore must RUN (follow-up A fix round 1, I1: the default "has a default export" test refused it).
// Same shape as tabs/NotebookTab.bulkRetry.test.jsx.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../lib/reviewDrafts', () => ({ draftDailyReview: vi.fn(), todayDayIso: () => '2026-11-05' }))
vi.mock('./FirstRunGate', () => ({ FirstRunInlineSlot: () => null }))
const runNoteBatch = vi.fn()
vi.mock('../../lib/noteBatch', () => ({ runNoteBatch: (...a) => runNoteBatch(...a) }))

import TodayHome, { RESTORE_ACTION, TRASHED_NOTE, restoreBatchLoader } from './TodayHome'
import { chunkRetry } from '../../lib/lazyChunk'
import { __resetNotebookFlags } from '../../lib/offline/notebookFlags'
import { __resetRegistryTourControl } from './onboarding/tourRegistryControl'

const realLoad = restoreBatchLoader.load
const chunkError = () => new Error(`Failed to fetch dynamically imported module: ${window.location.origin}/assets/noteBatch-abc.js`)
const TODAY = {
  day: '2026-11-05',
  session: { day: '2026-11-05', weekday: 'Thursday', phase: 'premarket', minutesToOpen: 72, recap: false },
  market: null,
  setups: { count: 0, nearCount: 0, rows: [], more: 0 },
  names: { count: 0, rows: [], more: 0, earningsUnknown: false, buzzKnown: false, reportingToday: [] },
  todayNote: { id: 'n-old', trashed: true, missing: false, created: false, items: [] },
  openFromYesterday: { count: 0, items: [], more: 0, priorDaily: null },
  onThisDay: { count: 0, items: [] },
  reasons: {},
}

beforeEach(() => {
  runNoteBatch.mockReset()
  runNoteBatch.mockResolvedValue({ results: [{ id: 'n-old', status: 'changed' }] })
  vi.stubGlobal('fetch', vi.fn((url) => {
    const ok = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
    return ok(String(url).startsWith('/api/j2/notes/today') ? TODAY : {})
  }))
})
afterEach(() => {
  cleanup()
  restoreBatchLoader.load = realLoad
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  __resetNotebookFlags()
  __resetRegistryTourControl()
})

const header = () => document.querySelector('[data-today-home] header')
const renderBrief = () => render(
  <MemoryRouter><TodayHome onOpenNote={vi.fn()} onOpenToday={vi.fn()} /></MemoryRouter>)

describe('the Daily brief\'s Restore on a flaky network', () => {
  it('first fetch fails, the retry under a new address succeeds: the retry is accepted and the restore RUNS', async () => {
    restoreBatchLoader.load = vi.fn(() => Promise.reject(chunkError()))
    const retry = vi.spyOn(chunkRetry, 'importUrl').mockImplementation((spec) => {
      expect(spec).toContain('chunk-retry=')
      return realLoad()
    })
    renderBrief()
    expect(await within(header()).findByText(TRASHED_NOTE)).toBeInTheDocument()
    fireEvent.click(within(header()).getByRole('button', { name: RESTORE_ACTION }))
    await waitFor(() => expect(runNoteBatch).toHaveBeenCalledWith({ ids: ['n-old'], op: 'restore' }), { timeout: 3000 })
    expect(restoreBatchLoader.load).toHaveBeenCalledTimes(1)
    expect(retry).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('CONTROL: with the first fetch fine, Restore runs with no retry', async () => {
    const retry = vi.spyOn(chunkRetry, 'importUrl')
    renderBrief()
    fireEvent.click(await within(header()).findByRole('button', { name: RESTORE_ACTION }))
    await waitFor(() => expect(runNoteBatch).toHaveBeenCalledWith({ ids: ['n-old'], op: 'restore' }))
    expect(retry).not.toHaveBeenCalled()
  })
})
