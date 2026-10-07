// Wave 13 lane 13E-2 — the Entry-context card.
// ⛔ The load-bearing guard: a past day (status !== 'captured') renders ONLY the server's own
// sentence — never a field row, never a fabricated value.
//
// CONTRACT: every answer here is the one the REAL server gives (`__fixtures__/contract`,
// written by tools/notebook_contract_fixtures.py and held current by
// tests/test_notebook_contract_fixtures.py), the meta included. Nothing types a context by hand.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EntryContextCard from './EntryContextCard'
import { latchNotebookFlags, __resetNotebookFlags } from '../lib/offline/notebookFlags'
import { contract, contractBody, contractResponse } from '../__fixtures__/contract'

function mockFetch(answer) {
  global.fetch = vi.fn(async (url) => {
    const u = String(url)
    if (u.endsWith('/api/j2/entry-context/meta')) return contractResponse('entry-context.meta')
    return answer(u)
  })
}
const on = () => latchNotebookFlags({ notebook_entry_context_enabled: true })
const field = (key) => within(document.querySelector(`[data-field="${key}"]`))

afterEach(() => { __resetNotebookFlags(); vi.restoreAllMocks() })

describe('dark behind the flag and free-plan 402', () => {
  it('renders nothing while notebook_entry_context_enabled is off (no fetch, no card)', () => {
    mockFetch(() => contractResponse('entry-context.position.captured'))
    render(<EntryContextCard kind="position" id="ec-today" />)
    expect(screen.queryByTestId('entry-context-card')).toBeNull()
    expect(screen.queryByTestId('entry-context-loading')).toBeNull()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('renders nothing on a free plan (402), the same as the flag being off', async () => {
    on()
    mockFetch(() => contractResponse('entry-context.position.free-plan'))
    const { container } = render(<EntryContextCard kind="position" id="ec-today" />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByTestId('entry-context-loading')).toBeNull())
    expect(screen.queryByTestId('entry-context-card')).toBeNull()
    expect(screen.queryByText(/paid plan/)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(container.textContent).toBe('')
  })
})

describe('a past day reads "not captured" — never reconstructed', () => {
  it('renders only the servers sentence, never a field row, when the entry was never captured', async () => {
    on()
    mockFetch(() => contractResponse('entry-context.position.not-captured'))
    render(<EntryContextCard kind="position" id="ec-old" />)
    const card = await screen.findByTestId('entry-context-not-captured')
    expect(within(card).getByText(contractBody('entry-context.position.not-captured').reason)).toBeTruthy()
    expect(screen.getByText(/never reconstructed/)).toBeTruthy()
    expect(screen.queryByTestId('entry-context-card')).toBeNull()
    expect(screen.queryByText('Regime')).toBeNull()
    expect(screen.queryByText('RS rank')).toBeNull()
    expect(document.querySelector('[data-field]')).toBeNull()
  })

  it('renders only the server sentence for a carried-in broker holding with no entry day', async () => {
    on()
    mockFetch(() => contractResponse('entry-context.position.entry-day-unknown'))
    render(<EntryContextCard kind="position" id="ec-carried" />)
    const card = await screen.findByTestId('entry-context-not-captured')
    const sent = contractBody('entry-context.position.entry-day-unknown')
    expect(sent.status).toBe('entry_day_unknown')
    expect(within(card).getByText(sent.reason)).toBeTruthy()
    expect(screen.getByText(/no entry day to freeze/)).toBeTruthy()
    expect(document.querySelector('[data-field]')).toBeNull()
  })

  it('carries the walkthrough\'s first anchor, so the entry-context tour opens on it (W14-Q2)', async () => {
    on()
    mockFetch(() => contractResponse('entry-context.position.not-captured'))
    render(<EntryContextCard kind="trade" id="t1" />)
    const card = await screen.findByTestId('entry-context-not-captured')
    expect(card.getAttribute('data-tour')).toBe('entry-context-card')
    // the steps after it describe the captured card's parts, and stay absent here
    expect(document.querySelector('[data-tour="entry-context-fields"]')).toBeNull()
  })
})

describe('a captured context', () => {
  it('renders every field the server froze, with its as-of', async () => {
    on()
    mockFetch(() => contractResponse('entry-context.position.captured'))
    render(<EntryContextCard kind="position" id="ec-today" />)
    await screen.findByTestId('entry-context-card')
    expect(field('regime').getByText('Amber')).toBeTruthy()
    expect(field('exposure').getByText('73 / 150')).toBeTruthy()             // 72.5, rounded
    expect(field('breadth_pct_above_50').getByText('55.1%')).toBeTruthy()
    expect(field('rs_rank').getByText('91')).toBeTruthy()
    expect(field('days_to_earnings').getByText('15 days')).toBeTruthy()
    expect(field('uct_scans').getByText('Pullback Ma')).toBeTruthy()
    // Each as-of is the server's, cut to its day, whatever precision the source stamped.
    expect(field('regime').getByText('as of 2026-10-05')).toBeTruthy()
    expect(field('breadth_pct_above_50').getByText('as of 2026-10-05')).toBeTruthy()
    expect(screen.queryByText('Not available')).toBeNull()
    expect(screen.queryByTestId('entry-context-late')).toBeNull()
    expect(String(global.fetch.mock.calls.map((c) => String(c[0])).find((u) => !u.endsWith('/meta'))))
      .toBe(contract('entry-context.position.captured')._contract.path)
  })

  it('labels a missing value "Not available" with the server\'s reason, and keeps a real zero', async () => {
    on()
    mockFetch(() => contractResponse('entry-context.position.with-gaps'))
    const sent = contractBody('entry-context.position.with-gaps').context.fields
    const reasons = contractBody('entry-context.meta').missingReasons
    render(<EntryContextCard kind="position" id="ec-gaps" />)
    await screen.findByTestId('entry-context-card')
    // RS rank is MISSING: labelled, with the reason as a sentence, never a guessed number and
    // never the server's code.
    expect(sent.rs_rank).toMatchObject({ value: null, missing: 'rs_not_ranked' })
    expect(field('rs_rank').getByText('Not available', { exact: false })).toBeTruthy()
    await waitFor(() => expect(field('rs_rank').getByText(`(${reasons.rs_not_ranked})`)).toBeTruthy())
    expect(screen.queryByText(/rs_not_ranked/)).toBeNull()
    expect(document.querySelector('[data-field="rs_rank"]').textContent).not.toMatch(/as of/)
    // Zero days to earnings is a VALUE (it reports today), not a missing one.
    expect(sent.days_to_earnings).toMatchObject({ value: 0, missing: null })
    expect(field('days_to_earnings').getByText('Reports today')).toBeTruthy()
    // An empty scan list is a VALUE too: the name was on no scan.
    expect(sent.uct_scans).toMatchObject({ value: [], missing: null })
    expect(field('uct_scans').getByText('None')).toBeTruthy()
    expect(screen.getAllByText('Not available', { exact: false })).toHaveLength(1)
  })

  it('flags a captured-late row and says when, without hiding or inventing anything', async () => {
    on()
    mockFetch(() => contractResponse('entry-context.position.captured-late'))
    const sent = contractBody('entry-context.position.captured-late').context
    expect(sent).toMatchObject({ capturedLate: true, captureKind: 'captured_late', entryDay: '2026-10-01', captureDay: '2026-10-05' })
    render(<EntryContextCard kind="position" id="ec-old" />)
    await screen.findByTestId('entry-context-late')
    expect(screen.getByText('captured late')).toBeTruthy()
    expect(screen.getByTestId('entry-context-late-when').textContent).toBe('on 2026-10-05, after the entry')
    expect(field('rs_rank').getByText('77')).toBeTruthy()
  })

  it('reaches the trade route for kind="trade" and reads the SAME context shape (the card stays after close)', async () => {
    on()
    const seen = []
    mockFetch((u) => { seen.push(u); return contractResponse('entry-context.trade.captured') })
    render(<EntryContextCard kind="trade" id="ec-trade" />)
    await screen.findByTestId('entry-context-card')
    expect(seen).toEqual([contract('entry-context.trade.captured')._contract.path])
    expect(field('regime').getByText('Amber')).toBeTruthy()
    // The closed trade reaches the row its position had: one context, by the same key.
    expect(contractBody('entry-context.trade.captured').key).toEqual(contractBody('entry-context.position.captured').key)
  })
})

describe('a failed read', () => {
  it('shows a retry affordance and refetches on click', async () => {
    on()
    let n = 0
    mockFetch(() => {
      n += 1
      if (n === 1) return contractResponse('entry-context.position.not-found')
      return contractResponse('entry-context.position.captured')
    })
    render(<EntryContextCard kind="position" id="ec-today" />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Couldn’t load the market context.')
    expect(screen.queryByTestId('entry-context-not-captured')).toBeNull()      // an error is not "not captured"
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByTestId('entry-context-card')
  })
})
