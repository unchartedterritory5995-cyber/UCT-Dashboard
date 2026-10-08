// Finish program, lane KEYS round 2. Three pages mark where focus lands after a navigation
// (lib/routeFocus.jsx), so the next Tab is the thing the member came for:
//
//   Trades       the table body: next Tab is the first trade, not 13 column headers
//   Insights     in front of the "Open My Playbook" door
//   My Playbook  in front of the setup cards: next Tab is the first card's first number
//
// Each case checks the landing itself AND what the next Tab stop after it is.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { latchNotebookFlags, __resetNotebookFlags } from './offline/notebookFlags'

let playbookState
vi.mock('../hooks/useScope', () => ({ default: () => ({ apiParams: {}, setFacet: vi.fn() }) }))
vi.mock('../hooks/useJ2Playbook', () => ({ default: () => playbookState }))
vi.mock('../featureFlags', () => ({ useFeatureFlag: () => true }))

import TradesTable, { buildTradesColumns } from '../components/TradesTable'
import PlaybookSection from '../components/insights/PlaybookSection'
import MyPlaybook from '../components/insights/MyPlaybook'

const TABBABLE = 'a[href], button:not([disabled]), select, input, textarea, [tabindex]:not([tabindex="-1"])'
/** The first Tab stop that comes after `el` in the document. */
function nextStopAfter(el) {
  const all = [...document.body.querySelectorAll(TABBABLE)]
  return all.find((n) => el.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING) || null
}
const landing = () => document.body.querySelector('[data-route-landing]')

const json = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
beforeEach(() => { global.fetch = vi.fn(() => json({})) })
afterEach(() => { __resetNotebookFlags(); vi.restoreAllMocks() })

describe('pages that mark their own landing', () => {
  it('Trades: the landing is the table body and the next stop is the first trade', () => {
    const trade = (id, symbol) => ({
      id, symbol, side: 'Long', shares: 10, entryPrice: 10, entryDate: '2026-09-10T00:00:00Z', exitPrice: 11,
      exitDate: '2026-09-11T00:00:00Z', originalStop: 9, setup: null, pnlDollar: 10, pnlPercent: 0.1,
      rMultiple: 1, holdDays: 1, result: 'Win', source: 'broker',
    })
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <MemoryRouter>
          <TradesTable trades={[trade('a', 'AAA'), trade('b', 'BBB')]} onRowAction={() => {}}
            visibleColumns={buildTradesColumns().filter((c) => !c.hiddenByDefault)} />
        </MemoryRouter>
      </SWRConfig>,
    )
    const el = landing()
    expect(el?.tagName).toBe('TBODY')
    expect(el.getAttribute('tabindex')).toBe('-1')
    expect((el.getAttribute('aria-label') || '').length).toBeGreaterThan(0)
    // NON-VACUITY: the column headers are real stops, and they come BEFORE the landing.
    const sortButtons = [...document.querySelectorAll('thead button')]
    expect(sortButtons.length).toBeGreaterThan(3)
    expect(el.contains(nextStopAfter(el))).toBe(true)
  })

  it('Insights: the landing sits in front of the My Playbook door', () => {
    latchNotebookFlags({ notebook_playbook_enabled: true })
    playbookState = { stats: [], isLoading: false, error: null, allAccounts: false }
    render(<MemoryRouter><PlaybookSection /></MemoryRouter>)
    const el = landing()
    expect(el).toBeTruthy()
    expect(nextStopAfter(el)).toBe(screen.getByTestId('open-my-playbook'))
  })

  it('Insights with the playbook switch off: no door, so no landing either', () => {
    latchNotebookFlags({ notebook_playbook_enabled: false })
    playbookState = { stats: [], isLoading: false, error: null, allAccounts: false }
    render(<MemoryRouter><PlaybookSection /></MemoryRouter>)
    expect(landing()).toBeNull()
  })

  it('My Playbook: the landing sits in front of the cards, after the note about untagged trades', async () => {
    latchNotebookFlags({ notebook_playbook_enabled: true })
    const setup = (name) => ({
      setup: name, tradeCount: 25, winCount: 10, lossCount: 15, beCount: 0, winRate: 0.4,
      profitFactor: 1.33, expectancy: 20, expectancyR: 0.2, avgR: 0.2, totalR: 5, totalPnlDollar: 500,
      sample: { n: 25, band: 'normal', wording: null },
      winRateStat: { k: 10, n: 25, rate: 0.4, band: 'normal', wording: null, range: null },
      avgRStat: { n: 25, mean: 0.2, band: 'normal', wording: null, range: null },
      expectancyStat: { n: 25, mean: 20, band: 'normal', wording: null, range: null },
      trades: [],
    })
    const payload = {
      asOf: '2026-10-03T12:00:00+00:00', accountId: null, untagged: { count: 3 },
      sample: { tooFewBelow: 10, normalFrom: 25, rangeZ: 1.96, wording: {} },
      setups: [setup('Pullback')], notesBySetup: { Pullback: [] }, patterns: null,
    }
    global.fetch = vi.fn((url) => (String(url).startsWith('/api/j2/my-playbook') ? json(payload) : json({})))
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
        <MemoryRouter initialEntries={['/journal-2-0/playbook']}>
          <Routes><Route path="/journal-2-0/playbook" element={<MyPlaybook />} /></Routes>
        </MemoryRouter>
      </SWRConfig>,
    )
    const card = await waitFor(() => {
      const c = document.querySelector('[data-setup="Pullback"]')
      expect(c).toBeTruthy()
      return c
    })
    const el = landing()
    expect(el).toBeTruthy()
    // NON-VACUITY: the "Tag them" link is a real stop and it is BEFORE the landing.
    const tagLink = screen.getByRole('link', { name: /Tag them/ })
    expect(tagLink.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(card.contains(nextStopAfter(el))).toBe(true)
  })
})
