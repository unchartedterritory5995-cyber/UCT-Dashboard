// app/src/pages/journal-2-0/a11y/pageLayoutsTrade.a11y.test.jsx
//
// P4a Task 8: the trade page rendering from the page layout, through 8A's axe harness. A file of its own beside
// pageLayouts.a11y.test.jsx because it replaces `swr` for the whole file (the page reads one trade through it),
// which would change what the Today and editor recipes render.
//
// Recipes, each proving its state is on screen BEFORE axe runs:
//   * trade-page-layout        -- a saved layout with The story first and the Chart hidden, the Customize button
//                                 in the top bar; the outcome grid, story, executions and the Compass section
//                                 are the page's own markup;
//   * trade-page-layout-empty  -- every panel hidden: the identity header, the top bar and Customize are all that
//                                 is left, and the page still has its landmarks.
//
// The sections that own a graph of their own (linked notes, market at entry, plan grade, the chart pane, before
// and after, the review card) are stubs here, as in TradeDetailPage.layout.test.jsx; their own a11y is theirs.
import { vi, expect, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { axeSurface } from './surface'

const { prefsRef } = vi.hoisted(() => ({ prefsRef: { current: {} } }))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => vi.fn() }
})
vi.mock('../../../hooks/usePreferences', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, default: () => ({ prefs: prefsRef.current, setPref: vi.fn(), loading: false }) }
})
vi.mock('../featureFlags', () => ({ useFeatureFlag: () => true }))
vi.mock('../lib/tradeCardPng', () => ({ renderTradeCardPng: vi.fn() }))
vi.mock('../../../components/chart/chartScreenshot', () => ({ downloadBlob: vi.fn(), copyBlobToClipboard: vi.fn() }))
vi.mock('../lib/sendToJournal', () => ({ sendCaptureToJournal: vi.fn() }))
vi.mock('../../../components/chart/SymbolSearch', () => ({
  default: ({ sym }) => <button type="button">{sym || 'search'}</button>,
}))
vi.mock('../hooks/useTradeReview', () => ({
  default: () => ({
    review: null, isLoading: false, generate: vi.fn(), regenerate: vi.fn(),
    feedback: vi.fn(), forget: vi.fn(), reset: vi.fn(), error: null,
  }),
}))
vi.mock('../../../context/AuthContext', async () => {
  const { createContext } = await import('react')
  return { useIsPaid: () => true, useAuth: () => ({ user: null }), AuthContext: createContext({ user: null }) }
})
vi.mock('../hooks/useJ2SelectedAccount', () => ({ default: () => ({ accountId: 'a1', account: null, accounts: [] }) }))
vi.mock('../hooks/useJ2Settings', () => ({
  default: () => ({ settings: { setups: ['VCP', 'HTF'], mistakeTags: ['FOMO'], emotionTags: ['calm'] } }),
}))
vi.mock('../hooks/useJ2Trades', () => ({
  default: () => ({
    trades: [{ id: 't1', symbol: 'NVDA', side: 'Long', setup: 'VCP', entryDate: '2026-05-01' }],
    isLoading: false,
    error: null,
  }),
}))
vi.mock('../components/TradeReviewCard', () => ({ default: () => <section aria-label="Compass review"><p>Compass review</p></section> }))
vi.mock('../components/notebook/LinkedNotesPanel', () => ({ default: () => <section aria-label="Linked notes"><p>Linked notes</p></section> }))
vi.mock('../components/EntryContextCard', () => ({ default: () => <section aria-label="Market at entry"><p>Market at entry</p></section> }))
vi.mock('../components/trade/PlanGradeCard', () => ({ default: () => <section aria-label="Plan vs execution"><p>Plan vs execution</p></section> }))
vi.mock('../components/trade/TradeBeforeAfter', () => ({ default: () => <section aria-label="Before and after"><p>Before and after</p></section> }))
vi.mock('../../../components/chart/pane/ChartPane', () => ({ default: () => <div data-testid="p-chart" /> }))
// The Customize editor opens through an eager slot; its own recipes are in pageLayouts.a11y.test.jsx.
vi.mock('../components/layout/PageLayoutEditorSlot', () => ({ default: () => null }))

const T1 = {
  id: 't1', symbol: 'NVDA', side: 'Long', shares: 100,
  entryPrice: 50, exitPrice: 56, originalStop: 50, rMultiple: null,
  pnlDollar: 600, pnlDollarNet: 588, pnlPercent: 0.12, holdDays: 3,
  result: 'Win', setup: 'VCP', entryDate: '2026-05-01', exitDate: '2026-05-04',
  notes: '', source: null, mistakeTags: [], emotionTags: [],
}
vi.mock('swr', () => ({
  default: (key) => ({
    data: key === '/api/j2/trades/t1' ? { trade: T1, brokerActivities: [] } : null,
    error: undefined,
    isLoading: false,
    mutate: vi.fn(),
  }),
}))

import TradeDetailPage from '../components/trade/TradeDetailPage'
import { __resetNotebookFlags, latchNotebookFlags } from '../lib/offline/notebookFlags'
import { DEFAULT_LAYOUT, LAYOUT_PREF } from '../lib/pageLayouts'

const clone = (v) => JSON.parse(JSON.stringify(v))

function layoutWith(edit) {
  const layout = clone(DEFAULT_LAYOUT)
  edit(layout.trade)
  return { [LAYOUT_PREF]: JSON.stringify(layout) }
}

const page = () => render(
  <MemoryRouter initialEntries={['/journal-2-0/trade/t1']}>
    <Routes>
      <Route path="/journal-2-0/trade/:id" element={<TradeDetailPage />} />
    </Routes>
  </MemoryRouter>,
)

beforeEach(() => {
  __resetNotebookFlags()
  latchNotebookFlags({
    journal_page_layouts_enabled: true,
    notebook_plan_grading_enabled: true,
    notebook_visual_playbook_enabled: true,
  })
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }))
})
afterEach(() => __resetNotebookFlags())

axeSurface('trade-page-layout', async () => {
  prefsRef.current = layoutWith((list) => {
    list.unshift(list.splice(list.findIndex((e) => e.id === 'story'), 1)[0])
    list.find((e) => e.id === 'chart').shown = false
  })
  const { container } = page()
  await screen.findByRole('region', { name: 'Before and after' })        // the lazy sections have arrived
  await screen.findByRole('button', { name: /Customize/ })
  // The story comes before the outcome grid, the chart is gone, and the page's own sections are there.
  const story = screen.getByRole('heading', { name: 'The story' }).closest('section')
  const outcome = container.querySelector('[data-testid="trade-outcome-grid"]')
  expect(story.compareDocumentPosition(outcome) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(container.querySelector('[data-testid="p-chart"]')).toBeNull()
  screen.getByText('Executions')
  return { root: container }
})

axeSurface('trade-page-layout-empty', async () => {
  prefsRef.current = layoutWith((list) => { for (const e of list) e.shown = false })
  const { container } = page()
  await screen.findByRole('button', { name: /Customize/ })
  // Nothing after the header: no story, no outcome grid, no chart.
  expect(screen.queryByRole('heading', { name: 'The story' })).toBeNull()
  expect(container.querySelector('[data-testid="trade-outcome-grid"]')).toBeNull()
  expect(container.querySelector('[data-testid="p-chart"]')).toBeNull()
  screen.getByRole('link', { name: /Trade Journal/ })
  return { root: container }
})
