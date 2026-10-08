// Lane FIN-A11Y (review R4 minors on the Journal-side surfaces of the Notebook waves):
//   M-6   Plan grade: "Reading your plan" was not a status; re-link dropped focus, said nothing.
//   M-8   Entry context and the Unplanned chip: the reason lived in a mouse-only title.
//   M-9   Discipline record: the selected window was told apart by colour alone.
//   M-12  Insights: the review draft buttons were unstyled browser buttons.
//   M-16  Before and after: the fills drawn on the charts were not in text; fixed ids.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SWRConfig } from 'swr'
import { MemoryRouter } from 'react-router-dom'
import { latchNotebookFlags, __resetNotebookFlags } from '../lib/offline/notebookFlags'

vi.mock('../../../components/chart/pane/ChartPane', () => ({ default: () => <div data-testid="pane" /> }))

const { default: PlanGradeCard } = await import('./trade/PlanGradeCard')
const { default: TradeBeforeAfter } = await import('./trade/TradeBeforeAfter')
const { default: DisciplineRecord } = await import('./insights/DisciplineRecord')
const { ReviewDraftsSection } = await import('./insights/InsightsHub')
const { default: EntryContextCard } = await import('./EntryContextCard')
const { default: TradesTable, buildTradesColumns } = await import('./TradesTable')

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })
const Wrap = ({ children }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
    <MemoryRouter>{children}</MemoryRouter>
  </SWRConfig>
)
afterEach(() => { __resetNotebookFlags(); vi.restoreAllMocks() })

// ── M-6 ────────────────────────────────────────────────────────────────────────────────────
describe('M-6 -- the plan grade card', () => {
  const PLANNED = {
    tradeId: 't1', tradeRef: 'id:t1', symbol: 'NVDA', side: 'Long', status: 'planned', dateOnly: false,
    plan: { entry: 100, stop: 96, target: 120, shares: 100, source: 'text', sourceLabel: 'Plan note',
      matchTier: 'window', noteId: 'n1', noteTitle: 'NVDA plan', matchedAt: 'x', relinkedAt: null, roles: {} },
    checks: { r: 4, entry: { state: 'kept', planned: 100, actual: 100.5, chaseR: 0.125, deltaPct: 0.005, tolerance: 1 },
      stop: { state: 'kept', planned: 96, limit: 95, exit: 110, exitVsStopR: 3 },
      size: { state: 'kept', planned: 100, actual: 100, deltaPct: 0 },
      target: { state: 'not_reached', planned: 120, hitLine: 119, exit: 110, mfePrice: 111 }, followedPlan: true },
    labels: [], setupChip: null,
    candidates: [{ kind: 'note', id: 'n2', title: 'Other plan', tier: 'window', plan: { entry: 101, stop: 97 }, editedAfterEntry: false }],
  }
  let hold
  beforeEach(() => {
    latchNotebookFlags({ notebook_plan_grading_enabled: true })
    hold = null
    global.fetch = vi.fn(async (url) => {
      if (hold) await hold
      if (String(url).endsWith('/relink')) {
        return json({ ...PLANNED, plan: { ...PLANNED.plan, noteId: 'n2', noteTitle: 'Other plan', relinkedAt: 'x' } })
      }
      return json(PLANNED)
    })
  })
  const card = (id = 't1') => (
    <Wrap><PlanGradeCard tradeId={id} trade={{ id, symbol: 'NVDA' }} /></Wrap>
  )

  it('"Reading your plan" is a status', async () => {
    let release
    hold = new Promise((r) => { release = r })
    render(card())
    expect(screen.getByTestId('plan-grade-loading')).toHaveAttribute('role', 'status')
    release()
    await screen.findByRole('list', { name: 'Plan checks' })
  })

  it('picking another plan returns focus to Re-link and says the plan was linked', async () => {
    const user = userEvent.setup()
    render(card())
    await screen.findByRole('list', { name: 'Plan checks' })
    const status = document.querySelector('[data-plan-grade-status]')
    expect(status).toHaveAttribute('role', 'status')
    expect(status).toHaveTextContent('')
    await user.click(screen.getByRole('button', { name: 'Re-link' }))
    await user.click(screen.getByRole('button', { name: /Other plan/ }))
    await waitFor(() => expect(status).toHaveTextContent('Linked to “Other plan”. The grade above is for that plan.'))
    expect(screen.getByRole('button', { name: 'Re-link' })).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Re-link' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('two cards on one page do not share a heading id', async () => {
    render(<>{card('t1')}{card('t2')}</>)
    const cards = await screen.findAllByTestId('plan-grade-card')
    const ids = cards.map((c) => c.getAttribute('aria-labelledby'))
    expect(new Set(ids).size).toBe(2)
    for (const c of cards) expect(c).toHaveAccessibleName('Plan vs execution')
  })
})

// ── M-16: before and after ─────────────────────────────────────────────────────────────────
describe('M-16 -- before and after says the fills in text', () => {
  it('the entry and exit drawn on the charts are written out', async () => {
    latchNotebookFlags({ notebook_visual_playbook_enabled: true })
    global.fetch = vi.fn(async () => json({
      trade: { tradeId: 't1', tradeRef: 'id:t1', symbol: 'NVDA', side: 'Long', result: 'Win', shares: 100,
        entryPrice: 100, exitPrice: 110, entryDate: '2026-09-30T14:00:00Z', exitDate: '2026-10-02T15:00:00Z',
        entryDay: '2026-09-30', exitDay: '2026-10-02' },
      planStatus: 'linked', plan: { entry: 100, stop: 96, target: 112, noteId: 'n1', noteTitle: 'NVDA plan' },
    }))
    render(<Wrap><TradeBeforeAfter tradeId="t1" /></Wrap>)
    const fills = await screen.findByTestId('before-after-fills')
    expect(fills).toHaveTextContent('Fills drawn: long entry at 100 on 2026-09-30, exit at 110 on 2026-10-02.')
    const card = screen.getByTestId('trade-before-after')
    expect(card).toHaveAccessibleName('Before and after')
    expect(card.getAttribute('aria-labelledby')).not.toBe('before-after-title')
  })
})

// ── M-9 ────────────────────────────────────────────────────────────────────────────────────
describe('M-9 -- the selected discipline window is not colour alone', () => {
  const stat = (k, n, band, range = null) => ({ k, n, rate: n ? k / n : null, band, range, wording: null })
  const win = (size) => ({
    size, trades: size, equity: size - 1, options: 1, planned: 12, unplanned: 6, needsPick: 0,
    planRate: stat(26, 30, 'normal'), editedAfterEntry: 1, entry: stat(26, 30, 'normal'), stop: stat(26, 30, 'normal'),
    size_: stat(26, 30, 'normal'), target: { hit: 2, reachedNotTaken: 3, notReached: 4, unknown: 0, hitRate: stat(26, 30, 'normal') },
    followedPlan: stat(26, 30, 'normal'),
  })
  it('the pressed window carries a check mark, and it moves with the selection', async () => {
    latchNotebookFlags({ notebook_plan_grading_enabled: true })
    global.fetch = vi.fn(async () => json({ windows: [win(20), win(60)] }))
    const user = userEvent.setup()
    render(<Wrap><DisciplineRecord accountId="a1" /></Wrap>)
    const twenty = await screen.findByRole('button', { name: 'Last 20' })
    const sixty = screen.getByRole('button', { name: 'Last 60' })
    expect(twenty).toHaveAttribute('aria-pressed', 'true')
    expect(twenty.querySelector('svg')).not.toBeNull()
    expect(sixty.querySelector('svg')).toBeNull()
    await user.click(sixty)
    expect(sixty).toHaveAttribute('aria-pressed', 'true')
    expect(sixty.querySelector('svg')).not.toBeNull()
    expect(twenty.querySelector('svg')).toBeNull()
  })
})

// ── M-12 ───────────────────────────────────────────────────────────────────────────────────
describe('M-12 -- the review draft buttons use the app button', () => {
  it('each of the three is a .btn, and keeps the touch target', () => {
    render(<Wrap><ReviewDraftsSection accountId="a1" /></Wrap>)
    const section = screen.getByTestId('review-drafts-section')
    const buttons = within(section).getAllByRole('button')
    expect(buttons).toHaveLength(3)
    for (const b of buttons) {
      expect(b.className.split(/\s+/)).toEqual(expect.arrayContaining(['btn', 'btn-secondary', 'touchTarget']))
    }
  })
})

// ── M-8 ────────────────────────────────────────────────────────────────────────────────────
describe('M-8 -- reasons are on screen or in the name, not only in a hover title', () => {
  it('a missing entry-context field shows why, as text', async () => {
    latchNotebookFlags({ notebook_entry_context_enabled: true })
    global.fetch = vi.fn(async (url) => {
      if (String(url).includes('/meta')) return json({ missingReasons: { no_breadth: 'no breadth snapshot was stored that day' }, whyMaxChars: 500 })
      return json({
        status: 'captured', key: { symbol: 'NVDA', entryDay: '2026-10-02' }, reason: null,
        context: {
          symbol: 'NVDA', entryDay: '2026-10-02', captureDay: '2026-10-05', capturedLate: true, why: null,
          fields: { regime: { value: 'Uptrend', asOf: '2026-10-02' }, breadth_pct_above_50: { missing: 'no_breadth' } },
        },
      })
    })
    render(<Wrap><EntryContextCard kind="trade" id="t1" /></Wrap>)
    const missing = await screen.findByText(/no breadth snapshot was stored that day/)
    expect(missing).toBeVisible()
    expect(missing.closest('[data-field]')).toHaveTextContent('Not available')
    // the late badge says when, in its own text
    expect(screen.getByTestId('entry-context-late')).not.toHaveAttribute('title')
    expect(screen.getByTestId('entry-context-late-when')).toHaveTextContent('on 2026-10-05, after the entry')
    expect(screen.getByTestId('entry-context-late-when')).toBeVisible()
  })

  it('the Unplanned chip carries its reason in text a screen reader reads', async () => {
    latchNotebookFlags({ notebook_plan_grading_enabled: true })
    global.fetch = vi.fn(async () => json({ statuses: { a: { tradeRef: 'ext:a', status: 'unplanned' } } }))
    const trade = {
      id: 'a', symbol: 'AAA', side: 'Long', shares: 10, entryPrice: 10, entryDate: '2026-09-10T00:00:00Z', exitPrice: 11,
      exitDate: '2026-09-11T00:00:00Z', originalStop: 9, setup: null, pnlDollar: 10, pnlPercent: 0.1,
      rMultiple: 1, holdDays: 1, result: 'Win', source: 'broker',
    }
    render(<Wrap><TradesTable trades={[trade]} visibleColumns={buildTradesColumns().filter((c) => !c.hiddenByDefault)} /></Wrap>)
    const chip = await screen.findByTestId('unplanned-chip')
    const reason = chip.nextElementSibling
    expect(reason).toHaveTextContent('No plan was written for this trade before entry.')
    expect(reason.className).toMatch(/sr-only/)
  })
})
