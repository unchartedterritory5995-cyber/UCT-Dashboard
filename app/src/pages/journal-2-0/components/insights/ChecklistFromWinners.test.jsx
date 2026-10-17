import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'

import ChecklistFromWinners, {
  ADDED_TEXT, CREATE_FAILED_TEXT, MARK_FAILED_TEXT, NO_ACCOUNT_TEXT, NONE_TEXT, TOO_FEW_TEXT, shareLine,
} from './ChecklistFromWinners'

// The payload shape checklist_suggestions.suggest builds (tests/test_checklist_suggestions.py).
const ev = (i, r) => ({ tradeRef: `id:t${i}`, tradeId: `t${i}`, symbol: `SYM${i}`, exitDate: `2026-10-${String(10 + i).padStart(2, '0')}`, r })
const PATIENT = {
  tag: 'patient', label: 'Before entry: am I patient?', shareBest: 0.45, shareOthers: 0.12,
  evidence: [ev(1, 3.2), ev(2, 2.75), ev(3, 2.5), ev(4, 2.1), ev(5, 1.9), ev(6, 1.6), ev(7, 1.4), ev(8, 1.2), ev(9, 1.0)],
}
const CALM = {
  tag: 'calm', label: 'Before entry: am I calm?', shareBest: 0.4, shareOthers: 0.0,
  evidence: [ev(11, 4.0), ev(12, 3.0), ev(13, 2.0), ev(14, 1.8), ev(15, 1.7), ev(16, 1.5), ev(17, 1.3), ev(18, 1.1)],
}
const OK = { status: 'ok', winnerCount: 26, bestCount: 20, suggestions: [PATIENT, CALM] }
const TOO_FEW = { status: 'too_few', winnerCount: 7, bestCount: 0, suggestions: [] }

const SUGG = '/api/j2/insights/checklist-suggestions'
const RULES_POST = '/api/j2/accounts/acc1/rules'
const RULE_PUT = '/api/j2/trader-blocks/rules/r-new'

/** A fetch that answers the reads and the two rule writes; every other request rejects loudly. */
function fakeFetch({ suggestions = OK, createOk = true, putResults = [true] } = {}) {
  const puts = [...putResults]
  return vi.fn(async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase()
    const json = (status, body) => ({ ok: status < 400, status, json: async () => body })
    if (method === 'GET' && url.startsWith(SUGG)) return json(200, suggestions)
    if (method === 'GET' && url.startsWith('/api/j2/accounts/acc1/rules')) return json(200, [])
    if (method === 'POST' && url === RULES_POST) {
      return createOk ? json(200, { id: 'r-new', label: JSON.parse(opts.body).label, beforeEntry: false }) : json(500, {})
    }
    if (method === 'PUT' && url === RULE_PUT) {
      const ok = puts.length ? puts.shift() : true
      return ok ? json(200, { id: 'r-new', beforeEntry: true }) : json(500, { detail: 'boom' })
    }
    throw new Error(`unexpected request ${method} ${url}`)
  })
}

const writes = (fetchMock) => fetchMock.mock.calls
  .map(([url, opts = {}]) => ({ url, method: (opts.method || 'GET').toUpperCase(), body: opts.body }))
  .filter((c) => c.method !== 'GET')

function renderPanel(props = { accountId: 'acc1' }) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter><ChecklistFromWinners {...props} /></MemoryRouter>
    </SWRConfig>,
  )
}

const card = (tag) => screen.getByText(tag, { selector: 'span' }).closest('li')

beforeEach(() => { localStorage.clear() })

describe('ChecklistFromWinners — reading', () => {
  it('renders the too_few sentence', async () => {
    globalThis.fetch = fakeFetch({ suggestions: TOO_FEW })
    renderPanel()
    expect(await screen.findByText(TOO_FEW_TEXT)).toBeInTheDocument()
    expect(TOO_FEW_TEXT).toBe('Log at least 10 winning trades and this will suggest checklist items from them.')
    expect(screen.queryByRole('button', { name: /add to my checklist/i })).not.toBeInTheDocument()
  })

  it('renders a suggestion with its share line and evidence links to each trade page', async () => {
    globalThis.fetch = fakeFetch()
    renderPanel()
    const patient = within(await screen.findByText('patient', { selector: 'span' }).then((n) => n.closest('li')))
    expect(patient.getByText('On 9 of your 20 best trades (45%) · on 12% of the rest')).toBeInTheDocument()
    const links = patient.getAllByRole('link')
    expect(links).toHaveLength(9)
    expect(links[0]).toHaveAttribute('href', '/journal-2-0/trade/t1')
    expect(links[0]).toHaveTextContent('SYM1 · Oct 11, 2026 · +3.20R')
    expect(patient.getByRole('button', { name: /add to my checklist/i })).toBeInTheDocument()
    expect(shareLine(CALM, 20)).toBe('On 8 of your 20 best trades (40%) · on 0% of the rest')
    // The request carries the account.
    expect(globalThis.fetch.mock.calls.some(([u]) => u === `${SUGG}?account_id=acc1`)).toBe(true)
  })

  it('an ok book with no suggestions says so, and All Accounts lists them without an add door', async () => {
    globalThis.fetch = fakeFetch({ suggestions: { ...OK, suggestions: [] } })
    const { unmount } = renderPanel()
    expect(await screen.findByText(NONE_TEXT)).toBeInTheDocument()
    unmount()
    globalThis.fetch = fakeFetch()
    renderPanel({ accountId: null })
    expect(await screen.findByText(NO_ACCOUNT_TEXT)).toBeInTheDocument()
    expect(screen.getByText('patient', { selector: 'span' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add to my checklist/i })).not.toBeInTheDocument()
    expect(globalThis.fetch.mock.calls.every(([u]) => !u.includes('/accounts/'))).toBe(true)
    expect(globalThis.fetch.mock.calls.some(([u]) => u === SUGG)).toBe(true)
  })
})

describe('ChecklistFromWinners — accepting', () => {
  async function openAndSave(tag, label) {
    const item = within(card(tag))
    fireEvent.click(item.getByRole('button', { name: /add to my checklist/i }))
    const dialog = within(screen.getByRole('dialog'))
    const input = dialog.getByLabelText('Your rule')
    expect(input).toHaveValue(`Before entry: am I ${tag}?`)                      // pre-filled
    // The evidence line is read-only text, not a field.
    expect(dialog.getByText(shareLine(tag === 'patient' ? PATIENT : CALM, 20))).toBeInTheDocument()
    expect(dialog.getAllByRole('textbox')).toHaveLength(1)
    if (label !== undefined) fireEvent.change(input, { target: { value: label } })
    fireEvent.click(dialog.getByRole('button', { name: 'Save rule' }))
  }

  it('accepting POSTs the edited label once, then PUTs before entry true; the suggestion leaves', async () => {
    globalThis.fetch = fakeFetch()
    renderPanel()
    await screen.findByText('patient', { selector: 'span' })
    await openAndSave('patient', 'Before entry: am I being patient with this one?')
    expect(await screen.findByText(ADDED_TEXT)).toBeInTheDocument()
    expect(ADDED_TEXT).toBe('Added. It will show in your pre-entry checklist.')
    const w = writes(globalThis.fetch)
    expect(w.map((c) => `${c.method} ${c.url}`)).toEqual([`POST ${RULES_POST}`, `PUT ${RULE_PUT}`])
    const posted = JSON.parse(w[0].body)
    expect(posted.label).toBe('Before entry: am I being patient with this one?')
    expect(posted.evidence).toBe(shareLine(PATIENT, 20))
    expect(JSON.parse(w[1].body)).toEqual({ beforeEntry: true })
    expect(screen.queryByText('patient', { selector: 'span' })).not.toBeInTheDocument()
    expect(screen.getByText('calm', { selector: 'span' })).toBeInTheDocument()
  })

  it('a failed create shows the failure sentence, keeps the suggestion and writes nothing else', async () => {
    globalThis.fetch = fakeFetch({ createOk: false })
    renderPanel()
    await screen.findByText('patient', { selector: 'span' })
    await openAndSave('patient')
    expect(await screen.findByText(CREATE_FAILED_TEXT)).toBeInTheDocument()
    expect(CREATE_FAILED_TEXT).toBe("Couldn't add that rule. Nothing was changed.")
    expect(screen.getByText('patient', { selector: 'span' })).toBeInTheDocument()
    expect(writes(globalThis.fetch).map((c) => c.method)).toEqual(['POST'])
    expect(screen.queryByText(ADDED_TEXT)).not.toBeInTheDocument()
  })

  it('no other write happens: only GETs plus the one rules POST and the one before-entry PUT', async () => {
    globalThis.fetch = fakeFetch()
    renderPanel()
    await screen.findByText('patient', { selector: 'span' })
    await openAndSave('calm')
    await screen.findByText(ADDED_TEXT)
    await waitFor(() => expect(globalThis.fetch.mock.calls.length).toBeGreaterThan(2))
    const all = globalThis.fetch.mock.calls.map(([url, opts = {}]) => `${(opts.method || 'GET').toUpperCase()} ${url}`)
    const nonGet = all.filter((c) => !c.startsWith('GET '))
    expect(nonGet).toEqual([`POST ${RULES_POST}`, `PUT ${RULE_PUT}`])
    // Every GET is one of the two reads.
    for (const c of all.filter((x) => x.startsWith('GET '))) {
      expect(c.startsWith(`GET ${SUGG}`) || c.startsWith('GET /api/j2/accounts/acc1/rules')).toBe(true)
    }
  })

  it('a failed PUT says so, and Try again sends one more PUT and never a second POST', async () => {
    globalThis.fetch = fakeFetch({ putResults: [false, true] })
    renderPanel()
    await screen.findByText('patient', { selector: 'span' })
    await openAndSave('patient')
    expect(await screen.findByText(MARK_FAILED_TEXT)).toBeInTheDocument()
    expect(MARK_FAILED_TEXT).toBe("Added the rule, but couldn't mark it for before entry. Try again.")
    // The rule exists, so the suggestion has left (it is never offered twice) and no success claimed.
    expect(screen.queryByText('patient', { selector: 'span' })).not.toBeInTheDocument()
    expect(screen.queryByText(ADDED_TEXT)).not.toBeInTheDocument()
    expect(writes(globalThis.fetch).map((c) => c.method)).toEqual(['POST', 'PUT'])

    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByText(ADDED_TEXT)).toBeInTheDocument()
    expect(screen.queryByText(MARK_FAILED_TEXT)).not.toBeInTheDocument()
    const w = writes(globalThis.fetch)
    expect(w.map((c) => `${c.method} ${c.url}`)).toEqual([`POST ${RULES_POST}`, `PUT ${RULE_PUT}`, `PUT ${RULE_PUT}`])
    expect(JSON.parse(w[2].body)).toEqual({ beforeEntry: true })
  })

  it('a retry that fails again keeps the sentence and its Try again', async () => {
    globalThis.fetch = fakeFetch({ putResults: [false, false] })
    renderPanel()
    await screen.findByText('patient', { selector: 'span' })
    await openAndSave('patient')
    await screen.findByText(MARK_FAILED_TEXT)
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    await waitFor(() => expect(writes(globalThis.fetch)).toHaveLength(3))
    expect(await screen.findByRole('button', { name: /try again/i })).not.toBeDisabled()
    expect(screen.getByText(MARK_FAILED_TEXT)).toBeInTheDocument()
    expect(writes(globalThis.fetch).filter((c) => c.method === 'POST')).toHaveLength(1)
  })

  it('renders no emoji', async () => {
    globalThis.fetch = fakeFetch()
    const { container } = renderPanel()
    await screen.findByText('patient', { selector: 'span' })
    expect(container.textContent).not.toMatch(/\p{Extended_Pictographic}/u)
  })
})
