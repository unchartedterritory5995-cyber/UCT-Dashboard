// Follow-up B, item 6b (the regression test follow-up A's re-review asked for): the Daily brief's Restore (today's note
// in the Trash) fetches the bulk actions library on demand (lib/noteBatch.js has NO default export). A failed fetch is
// retried once under a new address (lib/lazyChunk.js `chunkRetry.importUrl`); a retry that succeeds must be ACCEPTED
// and the restore must RUN (follow-up A fix round 1, I1: the default "has a default export" test refused it).
// Same shape as tabs/NotebookTab.bulkRetry.test.jsx.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const draftDailyReview = vi.fn()
vi.mock('../../lib/reviewDrafts', () => ({ draftDailyReview: (...a) => draftDailyReview(...a), todayDayIso: () => '2026-11-05' }))
vi.mock('./FirstRunGate', () => ({ FirstRunInlineSlot: () => null }))
const runNoteBatch = vi.fn()
vi.mock('../../lib/noteBatch', () => ({ runNoteBatch: (...a) => runNoteBatch(...a) }))

import TodayHome, {
  ACTION_LOAD_FAILED, RECAP_ACTION, RESTORE_ACTION, TRASHED_NOTE, recapDraftsLoader, restoreBatchLoader,
} from './TodayHome'
import { chunkRetry } from '../../lib/lazyChunk'
import { pageReload } from '../../lib/heldModule'
import { latchNotebookFlags } from '../../lib/offline/notebookFlags'
import { __resetNotebookFlags } from '../../lib/offline/notebookFlags'
import { __resetRegistryTourControl } from './onboarding/tourRegistryControl'

const realLoad = restoreBatchLoader.load
const realRecapLoad = recapDraftsLoader.load
const chunkError = (name = 'noteBatch') => new Error(`Failed to fetch dynamically imported module: ${window.location.origin}/assets/${name}-abc.js`)
let TODAY
const TRASHED_DAY = {
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

const EVENING = {
  ...TRASHED_DAY,
  session: { day: '2026-11-05', weekday: 'Thursday', phase: 'after_close', minutesToOpen: null, recap: true },
  todayNote: { id: 'n-today', title: 'today', trashed: false, missing: false, created: false, items: [], itemCount: 0,
    openCount: 0, recapWritten: false },
}

beforeEach(() => {
  TODAY = TRASHED_DAY
  draftDailyReview.mockReset()
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
  recapDraftsLoader.load = realRecapLoad
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

// Follow-up B fix round 1, item 3: a library that could not be fetched twice says so in plain words, with a Reload the
// member presses; the browser's error text never reaches the screen.
describe('an action whose code cannot be fetched', () => {
  it('Restore failing twice: the plain sentence and a Reload button, never the raw error', async () => {
    restoreBatchLoader.load = vi.fn(() => Promise.reject(chunkError()))
    vi.spyOn(chunkRetry, 'importUrl').mockImplementation(() => Promise.reject(chunkError()))
    const reload = vi.spyOn(pageReload, 'run').mockImplementation(() => {})
    renderBrief()
    fireEvent.click(await within(header()).findByRole('button', { name: RESTORE_ACTION }))
    const alert = await screen.findByRole('alert', {}, { timeout: 3000 })
    expect(alert.textContent).toContain(ACTION_LOAD_FAILED)
    expect(ACTION_LOAD_FAILED).toBe('This action could not be loaded. Reload the page to get this back.')
    expect(alert.textContent).not.toMatch(/Failed to fetch|dynamically imported|assets\//)
    expect(runNoteBatch).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()                                       // never by itself
    fireEvent.click(within(alert).getByRole('button', { name: 'Reload' }))
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it("CONTROL: a refused request still shows the server's own sentence", async () => {
    runNoteBatch.mockRejectedValue(Object.assign(new Error('That note is locked, so it was not restored.'), { status: 409 }))
    renderBrief()
    fireEvent.click(await within(header()).findByRole('button', { name: RESTORE_ACTION }))
    expect((await screen.findByRole('alert')).textContent).toBe('That note is locked, so it was not restored.')
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull()
  })

  it('the Recap card failing to load twice: the same plain sentence and Reload', async () => {
    latchNotebookFlags({ notebook_review_drafts_enabled: true })
    TODAY = EVENING
    recapDraftsLoader.load = vi.fn(() => Promise.reject(chunkError('reviewDrafts')))
    vi.spyOn(chunkRetry, 'importUrl').mockImplementation(() => Promise.reject(chunkError('reviewDrafts')))
    renderBrief()
    fireEvent.click(await screen.findByRole('button', { name: RECAP_ACTION }))
    const alert = await screen.findByRole('alert', {}, { timeout: 3000 })
    expect(alert.textContent).toContain(ACTION_LOAD_FAILED)
    expect(alert.textContent).not.toMatch(/Failed to fetch|dynamically imported/)
    expect(within(alert).getByRole('button', { name: 'Reload' })).toBeTruthy()
  })
})

// Follow-up B fix round 1, item 2: the Recap card's library has named exports only; a retried fetch that succeeds is
// accepted and the recap runs.
describe("the Daily brief's Recap on a flaky network", () => {
  it('first fetch fails, the retry succeeds: the retry is accepted and the recap is written', async () => {
    latchNotebookFlags({ notebook_review_drafts_enabled: true })
    TODAY = EVENING
    draftDailyReview.mockResolvedValue({ note: { id: 'n-today' }, created: false })
    recapDraftsLoader.load = vi.fn(() => Promise.reject(chunkError('reviewDrafts')))
    const retry = vi.spyOn(chunkRetry, 'importUrl').mockImplementation((spec) => {
      expect(spec).toContain('chunk-retry=')
      return realRecapLoad()
    })
    renderBrief()
    fireEvent.click(await screen.findByRole('button', { name: RECAP_ACTION }))
    await waitFor(() => expect(draftDailyReview).toHaveBeenCalledTimes(1), { timeout: 3000 })
    expect(retry).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
