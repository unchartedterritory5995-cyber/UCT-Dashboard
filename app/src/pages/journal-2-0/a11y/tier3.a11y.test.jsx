// app/src/pages/journal-2-0/a11y/tier3.a11y.test.jsx
//
// Notebook P2 Tier 3, Task 10: the four Tier 3 surfaces outside the derived population, through
// 8A's axe harness. All four are dark behind journal_tier3_enabled, so the gate is latched ON for
// each recipe. Every payload is a contract fixture (the server's REAL answer, recorded by
// tools/notebook_contract_fixtures.py), never a hand-typed shape. Each recipe proves the state it
// is about rendered before axe runs, so an empty screen can never pass as a clean one:
//   * checkin-outcomes        -- Insights > Psychology > By check-in, every mood level on screen,
//                                the too-few level marked, then the Focus tab selected;
//   * checklist-from-winners  -- two suggestions with their evidence links, one offering the add
//                                with its confirm OPEN, one offering only the mark;
//   * wrapped-surface         -- Your 2025 in trading, all four sections rendered;
//   * wrapped-door            -- the Report page door in December: the current-year link and the
//                                earlier-years picker.
// Task 10 fix round 1 (review M6), the non-happy states, each on contract fixtures too:
//   * checklist-from-winners-added         -- Save rule, both writes answered: the role=status line;
//   * checklist-from-winners-create-failed -- the rules POST refused: the role=alert line;
//   * checklist-from-winners-mark-failed   -- the before-entry PUT refused: the pending role=alert line
//                                             with its Try again button;
//   * wrapped-surface-not-ready / -no-trades -- the current year before December 1, a year with no trades;
//   * wrapped-door-october                 -- outside December: the earlier-years picker, no current link.
// The two rule writes answer with the server's recorded rule (`trader-blocks.rules.edit.before-entry`,
// the before-entry PUT's real answer; the panel reads only the rule's `id` from the create answer).
// The check-in BLOCK (components/notebook/blocks/MoodCheckInBlock.jsx) is in the derived
// population and has its own recipe (trader-block-checkin); it is not repeated here.
import { describe, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { axeSurface } from './surface'
import CheckInOutcomes, { TOO_FEW_TEXT } from '../components/insights/CheckInOutcomes'
import ChecklistFromWinners, {
  ADDED_TEXT, CREATE_FAILED_TEXT, MARK_FAILED_TEXT, PENDING_MARK_TEXT,
} from '../components/insights/ChecklistFromWinners'
import WrappedSurface from '../surfaces/WrappedSurface'
import WrappedDoor from '../components/WrappedDoor'
import { latchNotebookFlags, __resetNotebookFlags } from '../lib/offline/notebookFlags'
import { contractBody, contractResponse } from '../__fixtures__/contract'

const settle = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
const ok = (body) => ({ ok: true, status: 200, json: async () => body })
const refused = () => ({ ok: false, status: 500, json: async () => ({ detail: 'Internal Server Error' }) })
const WRAPPED_BY_YEAR = { 2025: 'wrapped.year', 2026: 'wrapped.year.not-ready', 2024: 'wrapped.year.no-trades' }
let writesAnswer   // { post: 'ok' | 'fail', put: 'ok' | 'fail' } -- set by the recipes that write

function Shell({ route = '/', children }) {
  return (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
    </SWRConfig>
  )
}

describe('a11y: Tier 3 surfaces (P2 Tier 3, Task 10)', () => {
  beforeEach(() => {
    latchNotebookFlags({ journal_tier3_enabled: true })
    writesAnswer = null
    global.fetch = vi.fn(async (url, opts = {}) => {
      const u = String(url)
      const method = (opts.method || 'GET').toUpperCase()
      if (method !== 'GET') {
        if (writesAnswer && method === 'POST' && /^\/api\/j2\/accounts\/acc1\/rules$/.test(u)) {
          return writesAnswer.post === 'ok' ? contractResponse('trader-blocks.rules.edit.before-entry') : refused()
        }
        if (writesAnswer && method === 'PUT' && /^\/api\/j2\/trader-blocks\/rules\/[^/]+$/.test(u)) {
          return writesAnswer.put === 'ok' ? contractResponse('trader-blocks.rules.edit.before-entry') : refused()
        }
        throw new Error(`unexpected write ${method} ${u}`)
      }
      if (u.startsWith('/api/j2/insights/checklist-suggestions')) return contractResponse('checklist-suggestions')
      if (u === '/api/j2/wrapped/years' || u.startsWith('/api/j2/wrapped/years?')) return contractResponse('wrapped.years')
      const year = u.match(/^\/api\/j2\/wrapped\/(\d{4})(\?|$)/)
      if (year && WRAPPED_BY_YEAR[year[1]]) return contractResponse(WRAPPED_BY_YEAR[year[1]])
      if (/^\/api\/j2\/accounts\/[^/]+\/rules/.test(u)) return ok([])
      if (u.startsWith('/api/j2/accounts')) return ok({ accounts: [] })
      throw new Error(`unexpected request ${u}`)
    })
  })
  afterEach(() => {
    __resetNotebookFlags()
    localStorage.clear()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  axeSurface('checkin-outcomes', async () => {
    const checkIns = contractBody('analytics.check-ins').psychology.checkIns
    render(<Shell><CheckInOutcomes checkIns={checkIns} /></Shell>)
    const panel = screen.getByRole('tabpanel')
    const words = within(panel).getAllByRole('rowheader').map((th) => th.textContent.replace(TOO_FEW_TEXT, ''))
    expect(words).toEqual(['Rough', 'Low', 'Okay', 'Good', 'Great'])
    expect(within(panel).getAllByText(TOO_FEW_TEXT).length).toBeGreaterThan(0)
    await userEvent.click(screen.getByRole('tab', { name: 'Focus' }))
    expect(screen.getByRole('tab', { name: 'Focus' }).getAttribute('aria-selected')).toBe('true')
    expect(within(screen.getByRole('tabpanel')).getByRole('rowheader', { name: /^Locked in/ })).toBeTruthy()
  })

  axeSurface('checklist-from-winners', async () => {
    render(<Shell><ChecklistFromWinners accountId="acc1" /></Shell>)
    const patient = (await screen.findByText('patient', { selector: 'span' })).closest('li')
    const calm = screen.getByText('calm', { selector: 'span' }).closest('li')
    expect(within(patient).getAllByRole('link').length).toBe(10)
    expect(within(calm).getByText(PENDING_MARK_TEXT)).toBeTruthy()
    expect(within(calm).getByRole('button', { name: /mark it for before entry/i })).toBeTruthy()
    await userEvent.click(within(patient).getByRole('button', { name: /add to my checklist/i }))
    const confirm = within(patient).getByRole('group', { name: 'Add "patient" to your checklist' })   // M5: non-modal
    expect(within(confirm).getByLabelText('Your rule')).toBeTruthy()
    expect(within(confirm).getByRole('button', { name: 'Save rule' })).toBeTruthy()
    await settle()
  })

  axeSurface('wrapped-surface', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-05T14:30:00Z'))          // the fixture world's frozen now
    render(
      <Shell route="/journal-2-0/wrapped/2025?account_id=_all_">
        <Routes><Route path="/journal-2-0/wrapped/:year" element={<WrappedSurface />} /></Routes>
      </Shell>,
    )
    await screen.findByRole('region', { name: 'Best setups' })
    expect(screen.getByRole('heading', { level: 1, name: 'Your 2025 in trading' })).toBeTruthy()
    for (const name of ['Most-written tickers', 'Discipline trend', 'Lessons you wrote into your rules']) {
      expect(screen.getByRole('region', { name })).toBeTruthy()
    }
    expect(within(screen.getByRole('region', { name: 'Discipline trend' })).getAllByRole('listitem')).toHaveLength(12)
    await settle()
  })

  axeSurface('wrapped-door', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-12-05T15:00:00Z'))          // December ET: the current year is open
    render(<Shell><WrappedDoor accountId={null} /></Shell>)
    const door = await screen.findByRole('navigation', { name: 'Your trading year' })
    expect(within(door).getByRole('link', { name: 'Your 2026 in trading' })).toBeTruthy()
    const picker = within(door).getByRole('combobox', { name: 'Earlier years' })
    expect(within(picker).getAllByRole('option').map((o) => o.textContent)).toEqual(['2025', '2023'])
    await settle()
  })

  // -- fix round 1 (review M6): the states a member meets when something is missing or refused --

  async function openPatientConfirmAndSave() {
    render(<Shell><ChecklistFromWinners accountId="acc1" /></Shell>)
    const patient = (await screen.findByText('patient', { selector: 'span' })).closest('li')
    await userEvent.click(within(patient).getByRole('button', { name: /add to my checklist/i }))
    const confirm = within(patient).getByRole('group', { name: 'Add "patient" to your checklist' })   // M5: non-modal
    await userEvent.click(within(confirm).getByRole('button', { name: 'Save rule' }))
  }

  axeSurface('checklist-from-winners-added', async () => {
    writesAnswer = { post: 'ok', put: 'ok' }
    await openPatientConfirmAndSave()
    expect(await screen.findByText(ADDED_TEXT)).toBeTruthy()
    expect(screen.queryByText('patient', { selector: 'span' })).toBeNull()        // the added habit left the list
    await settle()
  })

  axeSurface('checklist-from-winners-create-failed', async () => {
    writesAnswer = { post: 'fail', put: 'ok' }
    await openPatientConfirmAndSave()
    expect(await screen.findByText(CREATE_FAILED_TEXT)).toBeTruthy()
    expect(screen.queryByText(ADDED_TEXT)).toBeNull()
    await settle()
  })

  axeSurface('checklist-from-winners-mark-failed', async () => {
    writesAnswer = { post: 'ok', put: 'fail' }
    await openPatientConfirmAndSave()
    expect(await screen.findByText(MARK_FAILED_TEXT)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Try again to mark "patient" for before entry' })).toBeTruthy()
    await settle()
  })

  function renderYear(year) {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-05T14:30:00Z'))          // the fixture world's frozen now
    render(
      <Shell route={`/journal-2-0/wrapped/${year}?account_id=_all_`}>
        <Routes><Route path="/journal-2-0/wrapped/:year" element={<WrappedSurface />} /></Routes>
      </Shell>,
    )
  }

  axeSurface('wrapped-surface-not-ready', async () => {
    renderYear(2026)
    expect(await screen.findByText('Your 2026 trading year opens on December 1.')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Best setups' })).toBeNull()
    await settle()
  })

  axeSurface('wrapped-surface-no-trades', async () => {
    renderYear(2024)
    expect(await screen.findByText('No closed trades in 2024.')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Best setups' })).toBeNull()
    await settle()
  })

  axeSurface('wrapped-door-october', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-05T14:30:00Z'))          // October ET: the current year is not open
    render(<Shell><WrappedDoor accountId={null} /></Shell>)
    const door = await screen.findByRole('navigation', { name: 'Your trading year' })
    expect(within(door).getAllByRole('link').map((a) => a.textContent)).toEqual(['Your 2025 in trading'])
    const picker = within(door).getByRole('combobox', { name: 'Earlier years' })
    expect(within(picker).getAllByRole('option').map((o) => o.textContent)).toEqual(['2025', '2023'])
    await settle()
  })
})
