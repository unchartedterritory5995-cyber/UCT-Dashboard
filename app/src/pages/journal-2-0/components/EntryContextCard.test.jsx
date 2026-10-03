// Wave 13 lane 13E-2 — the Entry-context card.
// ⛔ The load-bearing guard: a past day (status !== 'captured') renders ONLY the server's own
// sentence — never a field row, never a fabricated value.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EntryContextCard from './EntryContextCard'
import { latchNotebookFlags, __resetNotebookFlags } from '../lib/offline/notebookFlags'

const json = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) })

const META = {
  version: 1, fields: [], missingReasons: { rs_cache_cold: 'the RS rankings cache was cold' },
  notCaptured: {}, captureKinds: ['at_entry', 'captured_late'], whyMaxChars: 500,
}
const CAPTURED_CONTEXT = {
  symbol: 'NVDA', entryDay: '2026-10-02', captureKind: 'at_entry', capturedLate: false,
  captureDay: '2026-10-02', capturedAt: '2026-10-02T14:31:07+00:00', trigger: 'manual_add', version: 1,
  fields: {
    regime: { value: 'amber', source: 'x', asOf: '2026-10-02', missing: null, detail: null },
    exposure: { value: 72.5, source: 'x', asOf: '2026-10-02', missing: null, detail: null },
    breadth_pct_above_50: { value: 55.14, source: 'x', asOf: '2026-10-02', missing: null, detail: null },
    rs_rank: { value: null, source: 'x', asOf: null, missing: 'rs_cache_cold', detail: null },
    days_to_earnings: { value: 0, source: 'x', asOf: '2026-10-02', missing: null, detail: null },
    uct_scans: { value: [], source: 'x', asOf: '2026-10-02', missing: null, detail: null },
    member_screens: { value: null, source: 'x', asOf: null, missing: 'no_screens_swept', detail: null },
    fingerprint: { value: null, source: 'x', asOf: null, missing: 'source_error', detail: null },
  },
  why: null,
}

function mockFetch(answer) {
  global.fetch = vi.fn((url) => {
    const u = String(url)
    if (u.endsWith('/api/j2/entry-context/meta')) return json(META)
    return answer(u)
  })
}

afterEach(() => { __resetNotebookFlags(); vi.restoreAllMocks() })

describe('dark behind the flag and free-plan 402', () => {
  it('renders nothing while notebook_entry_context_enabled is off (no fetch, no card)', () => {
    mockFetch(() => json({}))
    render(<EntryContextCard kind="position" id="p1" />)
    expect(screen.queryByTestId('entry-context-card')).toBeNull()
    expect(screen.queryByTestId('entry-context-loading')).toBeNull()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('renders nothing on a free plan (402), the same as the flag being off', async () => {
    latchNotebookFlags({ notebook_entry_context_enabled: true })
    mockFetch(() => json({ detail: 'The entry context requires a paid plan' }, 402))
    render(<EntryContextCard kind="position" id="p1" />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.queryByTestId('entry-context-card')).toBeNull()
    expect(screen.queryByText(/paid plan/)).toBeNull()
  })
})

describe('a past day reads "not captured" — never reconstructed', () => {
  it('renders only the servers sentence, never a field row, when the entry was never captured', async () => {
    latchNotebookFlags({ notebook_entry_context_enabled: true })
    mockFetch(() => json({
      status: 'not_captured', key: { symbol: 'NVDA', entryDay: '2026-09-01' }, context: null,
      reason: 'No market context was captured for this entry. It is frozen only on the day of '
        + 'the entry, and a past day is never reconstructed.',
    }))
    render(<EntryContextCard kind="position" id="p1" />)
    await screen.findByTestId('entry-context-not-captured')
    expect(screen.getByText(/never reconstructed/)).toBeTruthy()
    expect(screen.queryByTestId('entry-context-card')).toBeNull()
    expect(screen.queryByText('Regime')).toBeNull()
    expect(screen.queryByText('RS rank')).toBeNull()
  })

  it('renders only the server sentence for a carried-in broker holding with no entry day', async () => {
    latchNotebookFlags({ notebook_entry_context_enabled: true })
    mockFetch(() => json({
      status: 'entry_day_unknown', key: null, context: null,
      reason: 'The broker reported this holding without its entry date, so there is no entry '
        + 'day to freeze a market context for.',
    }))
    render(<EntryContextCard kind="position" id="p1" />)
    await screen.findByTestId('entry-context-not-captured')
    expect(screen.getByText(/no entry day to freeze/)).toBeTruthy()
  })
})

describe('a captured context', () => {
  it('renders every field with its as-of, and "Not available" for a labelled missing value', async () => {
    latchNotebookFlags({ notebook_entry_context_enabled: true })
    mockFetch(() => json({ status: 'captured', key: { symbol: 'NVDA', entryDay: '2026-10-02' }, context: CAPTURED_CONTEXT, reason: null }))
    render(<EntryContextCard kind="position" id="p1" />)
    await screen.findByTestId('entry-context-card')
    expect(screen.getByText('Amber')).toBeTruthy()
    expect(screen.getByText('73 / 150')).toBeTruthy()
    expect(screen.getByText('55.1%')).toBeTruthy()
    expect(screen.getByText('Reports today')).toBeTruthy()
    expect(screen.getByText('None')).toBeTruthy()
    // RS rank is MISSING — labelled, never a guessed number.
    expect(screen.getByText('Not available')).toBeTruthy()
    expect(screen.queryByText(/rs_cache_cold/)).toBeNull()  // the code, not the sentence, as the label
    expect(screen.getAllByText(/as of 2026-10-02/).length).toBeGreaterThan(0)
  })

  it('flags a captured-late row without hiding or inventing anything', async () => {
    latchNotebookFlags({ notebook_entry_context_enabled: true })
    mockFetch(() => json({
      status: 'captured', key: { symbol: 'NVDA', entryDay: '2026-09-20' },
      context: { ...CAPTURED_CONTEXT, capturedLate: true, captureDay: '2026-10-02' }, reason: null,
    }))
    render(<EntryContextCard kind="position" id="p1" />)
    await screen.findByTestId('entry-context-late')
    expect(screen.getByText('captured late')).toBeTruthy()
  })

  it('reaches the trade route for kind="trade" and reads the SAME context shape (the card stays after close)', async () => {
    latchNotebookFlags({ notebook_entry_context_enabled: true })
    mockFetch((u) => {
      expect(u).toContain('/api/j2/entry-context/trade/t1')
      return json({ status: 'captured', key: { symbol: 'NVDA', entryDay: '2026-10-02' }, context: CAPTURED_CONTEXT, reason: null })
    })
    render(<EntryContextCard kind="trade" id="t1" />)
    await screen.findByTestId('entry-context-card')
    expect(screen.getByText('Amber')).toBeTruthy()
  })
})

describe('a failed read', () => {
  it('shows a retry affordance and refetches on click', async () => {
    latchNotebookFlags({ notebook_entry_context_enabled: true })
    let n = 0
    mockFetch(() => {
      n += 1
      if (n === 1) return json({ detail: 'try again' }, 503)
      return json({ status: 'captured', key: { symbol: 'NVDA', entryDay: '2026-10-02' }, context: CAPTURED_CONTEXT, reason: null })
    })
    render(<EntryContextCard kind="position" id="p1" />)
    await screen.findByRole('alert')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByTestId('entry-context-card')
  })
})
