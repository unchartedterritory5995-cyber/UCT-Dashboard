// P2 Tier 3, Task 9 — Checklist from my winners reads the server's REAL answers.
//
// Every response here is a fixture recorded by tools/notebook_contract_fixtures.py from
// GET /api/j2/insights/checklist-suggestions (`checklist-suggestions*`) and held current by
// tests/test_notebook_contract_fixtures.py. ChecklistFromWinners.test.jsx drives the writes on a
// hand-typed shape; this file proves the panel reads what the server actually sends, by rendered text.
//
// The recorded book: 24 winners (best 20) and 13 other trades. Two habits qualify: "patient" (no rule
// yet: offered with Add to my checklist) and "calm" (a rule was made from it and never marked before
// entry: the server sends that rule's id as `pendingMark`, so the panel offers only the mark).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'

import ChecklistFromWinners, {
  LOAD_FAILED_TEXT, NO_REST_TEXT, NONE_TEXT, PENDING_MARK_TEXT, TOO_FEW_TEXT,
} from './ChecklistFromWinners'
import { contractBody, contractResponse } from '../../__fixtures__/contract'

const SUGG = '/api/j2/insights/checklist-suggestions'

let fixture
beforeEach(() => {
  localStorage.clear()
  fixture = 'checklist-suggestions'
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url)
    if ((opts.method || 'GET') !== 'GET') throw new Error(`unexpected write ${opts.method} ${u}`)
    if (u.startsWith(SUGG)) return contractResponse(fixture)
    if (/^\/api\/j2\/accounts\/[^/]+\/rules/.test(u)) return { ok: true, status: 200, json: async () => [] }
    throw new Error(`unexpected request ${u}`)
  })
})

function renderPanel(accountId = 'acc1') {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter><ChecklistFromWinners accountId={accountId} /></MemoryRouter>
    </SWRConfig>,
  )
}

const card = (tag) => screen.getByText(tag, { selector: 'span' }).closest('li')

describe('ChecklistFromWinners reads the recorded suggestions', () => {
  it('renders each suggestion with its share line and its evidence trades, linked to each trade page', async () => {
    renderPanel()
    const patient = (await screen.findByText('patient', { selector: 'span' })).closest('li')
    expect(within(patient).getByText('On 10 of your 20 best trades (50%) · on 23% of the rest')).toBeInTheDocument()
    const links = within(within(patient).getByRole('list', { name: 'Best trades tagged patient' })).getAllByRole('link')
    expect(links).toHaveLength(10)
    expect(links[0].textContent).toBe('WB00 · Jul 1, 2026 · +3.00R')
    expect(links[0].getAttribute('href')).toBe('/journal-2-0/trade/wb-00')
    expect(links[9].textContent).toBe('WB18 · Aug 13, 2026 · +1.20R')

    const calm = card('calm')
    expect(within(calm).getByText('On 9 of your 20 best trades (45%) · on 0% of the rest')).toBeInTheDocument()
    expect(within(calm).getAllByRole('link')).toHaveLength(9)
    // Habits that do not qualify are not offered.
    expect(screen.queryByText('excited', { selector: 'span' })).not.toBeInTheDocument()
    expect(screen.queryByText('fomo', { selector: 'span' })).not.toBeInTheDocument()
  })

  it('a suggestion with no rule offers the add; one whose rule is made but unmarked offers only the mark', async () => {
    renderPanel()
    const patient = (await screen.findByText('patient', { selector: 'span' })).closest('li')
    expect(within(patient).getByRole('button', { name: /add to my checklist/i })).toBeInTheDocument()
    expect(within(patient).queryByText(PENDING_MARK_TEXT)).not.toBeInTheDocument()

    const calm = card('calm')
    expect(contractBody('checklist-suggestions').suggestions[1].pendingMark).toBeTruthy()   // non-vacuity
    expect(within(calm).getByText(PENDING_MARK_TEXT)).toBeInTheDocument()
    expect(within(calm).getByRole('button', { name: /mark it for before entry/i })).toBeInTheDocument()
    expect(within(calm).queryByRole('button', { name: /add to my checklist/i })).not.toBeInTheDocument()
  })

  it('too few winners: the too_few sentence, and nothing to add', async () => {
    fixture = 'checklist-suggestions.too-few'
    renderPanel()
    expect(await screen.findByText(TOO_FEW_TEXT)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add to my checklist/i })).not.toBeInTheDocument()
  })

  it('every trade among the best (restCount 0): the no-rest sentence, not "nothing stands out"', async () => {
    fixture = 'checklist-suggestions.no-rest'
    renderPanel()
    expect(await screen.findByText(NO_REST_TEXT)).toBeInTheDocument()
    expect(screen.queryByText(NONE_TEXT)).not.toBeInTheDocument()
  })

  it('a refused member (402) reads the load failure, never an empty panel', async () => {
    fixture = 'checklist-suggestions.free-plan'
    renderPanel()
    expect(await screen.findByText(LOAD_FAILED_TEXT)).toBeInTheDocument()
    expect(screen.queryByText(NONE_TEXT)).not.toBeInTheDocument()
  })
})
