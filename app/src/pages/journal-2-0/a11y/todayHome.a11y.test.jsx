// S15 (audit 2026-11-05, M1): the Today home (the Daily brief since Notebook simplify, Task 5) -- the greeting, the
// five cards with their rows, the empty asks, and the folded "Reporting soon" and "Passed setups" below them (they
// replaced the "Open the Notebook on" choice) -- read by axe, as the Notebook renders it (inside its main region).
import { describe, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { axeSurface } from './surface'
import { __resetMyNamesQueue } from '../lib/myNames'
import { latchNotebookFlags, __resetNotebookFlags } from '../lib/offline/notebookFlags'

vi.mock('../components/notebook/FirstRunGate', () => ({ FirstRunInlineSlot: () => null }))
import TodayHome, { TODAY_URL } from '../components/notebook/TodayHome'

const TODAY = {
  day: '2026-11-05',
  session: { day: '2026-11-05', weekday: 'Thursday', phase: 'premarket', minutesToOpen: 72, recap: false },
  market: { held: true, regime: 'green', regimeWord: 'Green', pctAbove50: 61 },
  setups: { count: 1, nearCount: 1, more: 0, rows: [
    { noteId: 'p1', symbol: 'NVDA', setupTag: 'Flag', state: 'waiting', distancePct: 1.2, distanceR: 0.6, entry: 206 }] },
  names: { count: 0, rows: [], more: 0, earningsUnknown: false, buzzKnown: false, reportingToday: [] },
  todayNote: { id: 'n1', title: 'today', created: true, templateMissing: false, templateName: 'Daily prep',
    items: [{ index: 0, text: 'Check the market', checked: false }], openCount: 1, itemCount: 1, recapWritten: false },
  openFromYesterday: { count: 1, more: 0, priorDaily: null, items: [
    { noteId: 'y', noteTitle: 'yesterday', index: 0, text: 'Move the stop', due: null, from: 'yesterday' }] },
  onThisDay: { count: 0, items: [] },
  reasons: {},
}

beforeEach(() => {
  __resetMyNamesQueue()
  vi.stubGlobal('fetch', vi.fn((url) => Promise.resolve({
    ok: true, status: 200, json: () => Promise.resolve(String(url) === TODAY_URL ? TODAY : String(url).startsWith('/api/watchlists') ? [] : {}),
  })))
})
afterEach(() => { vi.unstubAllGlobals(); __resetNotebookFlags() })

describe('the Today home -- axe', () => {
  axeSurface('today-home', async () => {
    latchNotebookFlags({ notebook_earnings_prep_enabled: true, notebook_passed_setups_enabled: true })
    render(<MemoryRouter><main><TodayHome onOpenNote={() => {}} onCreateNote={() => {}} onSelectAllNotes={() => {}} /></main></MemoryRouter>)
    expect(await screen.findByTestId('today-plan')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Reporting soon/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Passed setups/ })).toBeInTheDocument()
  })
})
