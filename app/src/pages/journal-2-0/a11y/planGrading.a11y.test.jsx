// app/src/pages/journal-2-0/a11y/planGrading.a11y.test.jsx
//
// Wave 13, lane 13A: plan vs execution grading through 8A's axe harness (the ONE way a Notebook
// rail asks axe-core). Every surface here is dark behind notebook_plan_grading_enabled, so the
// gate is latched ON for each recipe. Each recipe proves the state it is about rendered before
// axe runs, so an empty screen can never pass as a clean one:
//   * plan-grade-card         -- a planned trade's four checks, labels, the setup chip, Re-link open;
//   * discipline-record       -- the record with all three R3 sample bands on screen;
//   * trades-table-unplanned  -- the Trade Journal table carrying the Unplanned chip.
// The last describe holds OUTSIDE_POPULATION_SURFACES to the rails: every entry's file exists
// and its recipe is registered in a rail file, so the manifest can never be decorative.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Providers } from './fixtures'
import { axeSurface } from './surface'
import { OUTSIDE_POPULATION_SURFACES } from './notebookSurfaces'
import { J2_DIR } from './population'
import PlanGradeCard from '../components/trade/PlanGradeCard'
import DisciplineRecord from '../components/insights/DisciplineRecord'
import TradesTable, { buildTradesColumns } from '../components/TradesTable'
import { latchNotebookFlags, __resetNotebookFlags } from '../lib/offline/notebookFlags'

const settle = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })
const json = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
const stat = (k, n, band, range = null) => ({ k, n, rate: n ? k / n : null, band, range })

const GRADE = {
  tradeId: 't1', tradeRef: 'id:t1', symbol: 'NVDA', side: 'Long', status: 'planned',
  plan: { entry: 100, stop: 96, target: 120, shares: 100, sourceLabel: 'Plan note', matchTier: 'window',
    noteId: 'n1', noteTitle: 'NVDA plan', matchedAt: '2026-09-15T00:00:00Z', relinkedAt: null },
  checks: {
    r: 4,
    entry: { state: 'kept', planned: 100, actual: 100.5, chaseR: 0.125 },
    stop: { state: 'missed', planned: 96, limit: 95, exit: 94.5 },
    size: { state: 'none' },
    target: { state: 'unreadable' },
  },
  labels: ['date_only', 'edited_after_entry'],
  setupChip: { setup: 'Breakout' },
  candidates: [{ kind: 'note', id: 'n2', title: 'Other plan', plan: { entry: 101, stop: 97 } }],
}
const RECORD = {
  windows: [20, 60].map((size) => ({
    size, trades: size, equity: size - 1, options: 1, planned: 12, unplanned: 6, needsPick: 1, editedAfterEntry: 1,
    planRate: stat(12, 18, 'thin', [0.44, 0.84]), entry: stat(5, 6, 'too_few'), stop: stat(10, 12, 'thin', [0.55, 0.95]),
    size_: stat(26, 30, 'normal'), followedPlan: stat(4, 12, 'thin', [0.14, 0.61]),
    target: { hit: 2, reachedNotTaken: 3, notReached: 4, unknown: 0, hitRate: stat(2, 9, 'too_few') },
  })),
}

describe('a11y: plan vs execution grading (wave 13, lane 13A)', () => {
  beforeEach(() => {
    latchNotebookFlags({ notebook_plan_grading_enabled: true })
    global.fetch = vi.fn((url) => {
      const u = String(url)
      if (u.startsWith('/api/j2/plan-grades/trades/')) return json(GRADE)
      if (u.startsWith('/api/j2/plan-grades/discipline')) return json(RECORD)
      if (u.startsWith('/api/j2/plan-grades/status')) return json({ statuses: { a: { tradeRef: 'id:a', status: 'unplanned' } } })
      return json({})
    })
  })
  afterEach(() => { __resetNotebookFlags(); vi.restoreAllMocks() })

  axeSurface('plan-grade-card', async () => {
    render(<Providers route="/journal-2-0/trade/t1"><PlanGradeCard tradeId="t1" trade={{ id: 't1', symbol: 'NVDA' }} onTagSetup={() => {}} /></Providers>)
    await screen.findByText('Not honoured')
    await userEvent.click(screen.getByRole('button', { name: 'Re-link' }))
    expect(screen.getByRole('button', { name: /Other plan/ })).toBeTruthy()
    expect(screen.getByTestId('plan-setup-chip')).toBeTruthy()
    await settle()
  })

  axeSurface('discipline-record', async () => {
    render(<Providers route="/journal?j2tab=analytics&ins=discipline"><DisciplineRecord accountId="acct" /></Providers>)
    await screen.findByText('Discipline record')
    expect(screen.getAllByText('too few to judge').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/thin sample/).length).toBeGreaterThan(0)
    await settle()
  })

  axeSurface('trades-table-unplanned', async () => {
    const trade = { id: 'a', symbol: 'AAA', side: 'Long', shares: 10, entryPrice: 10, entryDate: '2026-09-10T00:00:00Z',
      exitPrice: 11, exitDate: '2026-09-11T00:00:00Z', originalStop: 9, setup: null, pnlDollar: 10, pnlPercent: 0.1,
      rMultiple: 1, holdDays: 1, result: 'Win', source: 'broker' }
    render(<Providers route="/journal?j2tab=journal"><TradesTable trades={[trade]} visibleColumns={buildTradesColumns().filter((c) => !c.hiddenByDefault)} /></Providers>)
    await screen.findByTestId('unplanned-chip')
    await settle()
  })
})

describe('OUTSIDE_POPULATION_SURFACES is held to the rails', () => {
  const rails = readdirSync(join(J2_DIR, 'a11y'))
    .filter((f) => f.endsWith('.a11y.test.jsx'))
    .map((f) => readFileSync(join(J2_DIR, 'a11y', f), 'utf8'))

  it('every entry names a real file and a recipe registered in a rail', () => {
    const entries = Object.entries(OUTSIDE_POPULATION_SURFACES)
    expect(entries.length).toBeGreaterThan(0)
    for (const [file, { recipe, railFile }] of entries) {
      expect(existsSync(join(J2_DIR, file)), file).toBe(true)
      expect(existsSync(join(J2_DIR, railFile)), railFile).toBe(true)
      expect(rails.some((src) => src.includes(`axeSurface('${recipe}'`)), recipe).toBe(true)
    }
  })

  it('the registration check can fail (a recipe nobody registered is caught)', () => {
    const never = ['no-such', 'recipe', '13a'].join('-')   // built, so this file cannot contain it
    expect(rails.some((src) => src.includes(`axeSurface('${never}'`))).toBe(false)
  })
})
