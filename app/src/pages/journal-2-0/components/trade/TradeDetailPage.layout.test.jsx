/**
 * The trade page renders its sections from the page layout (P4a Task 6).
 *
 * What follows the identity header is a list: the panels `resolvePanels(layout, 'trade')` names, in the
 * member's order, shown ones only. With the page-layouts switch off the list is DEFAULT_LAYOUT's, which is
 * the order the page always had; a saved layout is then ignored (and stays stored). The save-error line is
 * not a panel: it sits just above the story (where it sat before P4a, ruling P4a-T9-R1), and straight after
 * the identity header only when the story is hidden, so an error is always seen.
 *
 * Panels are found by `data-testid` or heading, and read in DOM order. The sections that own a graph of
 * their own (linked notes, entry context, plan grade, the chart pane, before and after) are stubs here;
 * the outcome grid, the story, the executions table and the Compass section are the page's own markup.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const { prefsRef, paidRef, navigateSpy, tradesRef } = vi.hoisted(() => ({
  prefsRef: { current: {} },
  paidRef: { current: true },
  navigateSpy: { fn: () => {} },
  tradesRef: { current: null },
}))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => navigateSpy.fn }
})
vi.mock('../../../../hooks/usePreferences', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, default: () => ({ prefs: prefsRef.current, setPref: vi.fn(), loading: false }) }
})

// Same support mocks as TradeDetailPage.test.jsx: none of these is under test.
vi.mock('../../featureFlags', () => ({ useFeatureFlag: () => true }))
vi.mock('../../lib/tradeCardPng', () => ({ renderTradeCardPng: vi.fn() }))
vi.mock('../../../../components/chart/chartScreenshot', () => ({
  downloadBlob: vi.fn(),
  copyBlobToClipboard: vi.fn(),
}))
vi.mock('../../lib/sendToJournal', () => ({ sendCaptureToJournal: vi.fn() }))
vi.mock('../../../../components/chart/SymbolSearch', () => ({
  default: ({ sym }) => <button type="button">{sym || 'search'}</button>,
}))
vi.mock('../../hooks/useTradeReview', () => ({
  default: () => ({
    review: null, isLoading: false, generate: vi.fn(), regenerate: vi.fn(),
    feedback: vi.fn(), forget: vi.fn(), reset: vi.fn(), error: null,
  }),
}))
vi.mock('../../../../context/AuthContext', async () => {
  const { createContext } = await import('react')
  return {
    useIsPaid: () => paidRef.current,
    useAuth: () => ({ user: null }),
    AuthContext: createContext({ user: null }),
  }
})
vi.mock('../../hooks/useJ2SelectedAccount', () => ({
  default: () => ({ accountId: 'a1', account: null, accounts: [] }),
}))
vi.mock('../../hooks/useJ2Settings', () => ({
  default: () => ({ settings: { setups: ['VCP', 'HTF'], mistakeTags: ['FOMO'], emotionTags: ['calm'] } }),
}))
vi.mock('../../hooks/useJ2Trades', () => ({
  default: () => ({
    trades: tradesRef.current || [{ id: 't1', symbol: 'NVDA', side: 'Long', setup: 'VCP', entryDate: '2026-05-01' }],
    isLoading: false,
    error: null,
  }),
}))
vi.mock('../TradeReviewCard', () => ({ default: () => <div data-testid="review" /> }))

// The sections that own a graph of their own.
vi.mock('../notebook/LinkedNotesPanel', () => ({ default: () => <div data-testid="p-linkedNotes" /> }))
vi.mock('../EntryContextCard', () => ({ default: () => <div data-testid="p-entryContext" /> }))
vi.mock('./PlanGradeCard', () => ({ default: () => <div data-testid="p-planGrade" /> }))
vi.mock('./TradeBeforeAfter', () => ({ default: () => <div data-testid="p-beforeAfter" /> }))
vi.mock('../../../../components/chart/pane/ChartPane', () => ({ default: () => <div data-testid="p-chart" /> }))

// The Customize editor opens through an eager slot with a lazy import; its own tests are in
// components/layout. Here it is a stub that shows what the page handed it and can report a save.
vi.mock('../layout/PageLayoutEditorSlot', () => ({
  default: ({ page, onClose, onSaved }) => (
    <div data-testid="editor-stub" data-page={page}>
      <button type="button" onClick={() => { onSaved?.(); onClose() }}>stub save</button>
      <button type="button" onClick={onClose}>stub cancel</button>
    </div>
  ),
}))

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

import TradeDetailPage from './TradeDetailPage'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'
import { LAYOUT_PREF, PANELS, DEFAULT_LAYOUT } from '../../lib/pageLayouts'

// panel name -> its element in the DOM (null when it is not there)
const byTestId = (id) => (c) => c.querySelector(`[data-testid="${id}"]`)
const headingSection = (text) => (c) =>
  [...c.querySelectorAll('h2')].find((h) => h.textContent === text)?.closest('section') || null
const FINDERS = {
  linkedNotes: byTestId('p-linkedNotes'),
  entryContext: byTestId('p-entryContext'),
  planGrade: byTestId('p-planGrade'),
  outcome: byTestId('trade-outcome-grid'),
  chart: byTestId('p-chart'),
  beforeAfter: byTestId('p-beforeAfter'),
  story: headingSection('The story'),
  executions: (c) => [...c.querySelectorAll('summary')].find((s) => s.textContent === 'Executions')?.closest('details') || null,
  review: headingSection('Compass post-mortem'),
}

// The panel names under the page root, in DOM order.
function panelOrder(container) {
  const found = Object.entries(FINDERS)
    .map(([name, find]) => [name, find(container)])
    .filter(([, el]) => el)
  found.sort(([, a], [, b]) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
  return found.map(([name]) => name)
}

// A saved trade list from `[id, shown]` pairs, then every registry panel the pairs did not name, hidden.
const tradeList = (pairs) => {
  const named = new Set(pairs.map(([id]) => id))
  return [
    ...pairs.map(([id, shown]) => ({ id, shown })),
    ...PANELS.trade.filter((p) => !named.has(p.id)).map((p) => ({ id: p.id, shown: false })),
  ]
}
const savedLayout = (pairs) => ({ ...JSON.parse(JSON.stringify(DEFAULT_LAYOUT)), trade: tradeList(pairs) })
const saved = (pairs) => ({ [LAYOUT_PREF]: JSON.stringify(savedLayout(pairs)) })

// What TradeDetailPage.jsx rendered after the identity header before this task. Captured by rendering the
// UNMODIFIED component at BASE (47034d9a56 + the Step 0 test commit, which touches no trade code) with
// every section on and the same stubs; the test below is green there.
const BASE_ORDER = [
  'linkedNotes', 'entryContext', 'planGrade', 'outcome', 'chart', 'beforeAfter', 'story', 'executions', 'review',
]

function setFlags({ layouts, planGrade = true, beforeAfter = true }) {
  __resetNotebookFlags()
  latchNotebookFlags({
    journal_page_layouts_enabled: layouts,
    notebook_plan_grading_enabled: planGrade,
    notebook_visual_playbook_enabled: beforeAfter,
  })
}

const tree = () => (
  <MemoryRouter initialEntries={['/journal-2-0/trade/t1']}>
    <Routes>
      <Route path="/journal-2-0/trade/:id" element={<TradeDetailPage />} />
    </Routes>
  </MemoryRouter>
)
const renderPage = () => render(tree())

// The lazy sections (plan grade, chart, before and after) arrive a tick after the first paint.
async function lazyArrived(names) {
  for (const n of names) await screen.findByTestId(n)
}

beforeEach(() => {
  prefsRef.current = {}
  paidRef.current = true
  tradesRef.current = null
  navigateSpy.fn = vi.fn()
  setFlags({ layouts: false })
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
})

describe('TradeDetailPage renders from the page layout', () => {
  it('test_default_trade_layout_renders_todays_order: the switch off, and on with no saved layout, give the base order', async () => {
    setFlags({ layouts: false })
    const off = renderPage()
    await lazyArrived(['p-planGrade', 'p-chart', 'p-beforeAfter'])
    expect(panelOrder(off.container)).toEqual(BASE_ORDER)
    off.unmount()

    setFlags({ layouts: true })
    prefsRef.current = {}
    const on = renderPage()
    await lazyArrived(['p-planGrade', 'p-chart', 'p-beforeAfter'])
    expect(panelOrder(on.container)).toEqual(BASE_ORDER)
  })

  it('a saved layout with the story first and the chart hidden renders the story before the outcome grid, and no chart card', async () => {
    setFlags({ layouts: true })
    prefsRef.current = saved([
      ['story', true], ['chart', false], ['outcome', true], ['beforeAfter', true], ['executions', true],
    ])
    const { container } = renderPage()
    // beforeAfter is lazy like the chart: once it is here, a chart that was going to load would have.
    await lazyArrived(['p-beforeAfter'])
    expect(panelOrder(container)).toEqual(['story', 'outcome', 'beforeAfter', 'executions'])
    expect(container.querySelector('[data-testid="p-chart"]')).toBeNull()
    expect(container.querySelector('[data-testid="trade-outcome-grid"]')).not.toBeNull()
  })

  it('with the switch off a saved layout is ignored', async () => {
    setFlags({ layouts: false })
    prefsRef.current = saved([['story', true], ['chart', false]])
    const { container } = renderPage()
    await lazyArrived(['p-planGrade', 'p-chart', 'p-beforeAfter'])
    expect(panelOrder(container)).toEqual(BASE_ORDER)
  })

  it('an unreadable saved layout falls back to the default order', async () => {
    setFlags({ layouts: true })
    prefsRef.current = { [LAYOUT_PREF]: '{not json' }
    const { container } = renderPage()
    await lazyArrived(['p-planGrade', 'p-chart', 'p-beforeAfter'])
    expect(panelOrder(container)).toEqual(BASE_ORDER)
  })

  // Ruling P4a-T9-R1. Before P4a the save-error line sat between the chart card and the before-and-after card,
  // straight above the story, where most failing saves are made (setup, tags, notes). It goes back there.
  const raiseSaveError = async () => {
    // The stop form is the outcome grid's: an empty stop is refused with a save error.
    fireEvent.click(screen.getByRole('button', { name: '+ Add stop' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    return screen.findByText(/Couldn’t save/)
  }

  it.each([
    ['off', false], ['on with the default layout', true],
  ])('with the switch %s the save error sits where it did before P4a: after the chart card, before the before-and-after card', async (_, layouts) => {
    setFlags({ layouts })
    prefsRef.current = {}
    const { container } = renderPage()
    await lazyArrived(['p-planGrade', 'p-chart', 'p-beforeAfter'])
    const err = await raiseSaveError()
    expect(err.previousElementSibling.contains(FINDERS.chart(container))).toBe(true)
    expect(err.nextElementSibling).toBe(FINDERS.beforeAfter(container))
    expect(err.nextElementSibling.nextElementSibling).toBe(FINDERS.story(container))
  })

  it('with the before-and-after card off, the save error is the story\'s previous sibling (the pre-P4a DOM)', async () => {
    setFlags({ layouts: false, beforeAfter: false })
    const { container } = renderPage()
    await lazyArrived(['p-chart'])
    const err = await raiseSaveError()
    expect(err.nextElementSibling).toBe(FINDERS.story(container))
    expect(err.previousElementSibling.contains(FINDERS.chart(container))).toBe(true)
  })

  it('a saved layout that moves the story first puts the save error straight before it', async () => {
    setFlags({ layouts: true })
    prefsRef.current = saved([['story', true], ['outcome', true], ['chart', true], ['beforeAfter', true]])
    const { container } = renderPage()
    await lazyArrived(['p-beforeAfter'])
    const err = await raiseSaveError()
    expect(err.nextElementSibling).toBe(FINDERS.story(container))
    expect(err.previousElementSibling).toBe(container.querySelector('header'))
  })

  it('with the story hidden the save error renders straight after the header, and still renders when every panel is hidden', async () => {
    setFlags({ layouts: true })
    prefsRef.current = saved([['outcome', true], ['chart', true]])
    const { container, rerender } = renderPage()
    await lazyArrived(['p-chart'])
    const err = await raiseSaveError()
    expect(err.previousElementSibling).toBe(container.querySelector('header'))

    // The member now hides every panel: the error is not a panel, so it stays.
    prefsRef.current = saved([])
    rerender(tree())
    await waitFor(() => expect(panelOrder(container)).toEqual([]))
    const still = screen.getByText(/Couldn’t save/)
    expect(still.previousElementSibling).toBe(container.querySelector('header'))
  })

  it('a section keeps its own condition: a layout that shows it does not make it appear when its gate is off', async () => {
    setFlags({ layouts: true, planGrade: false, beforeAfter: false })
    paidRef.current = false
    prefsRef.current = saved(PANELS.trade.map((p) => [p.id, true]))
    const { container } = renderPage()
    await lazyArrived(['p-chart'])
    expect(panelOrder(container)).toEqual([
      'linkedNotes', 'entryContext', 'outcome', 'chart', 'story', 'executions',
    ])
  })

  it('a reorder moves a section and does not remount it: an open Executions section stays open', async () => {
    setFlags({ layouts: true })
    prefsRef.current = {}
    const { container, rerender } = renderPage()
    await lazyArrived(['p-planGrade', 'p-chart', 'p-beforeAfter'])
    const before = FINDERS.executions(container)
    before.open = true

    // The member saves Executions first, the rest in their order.
    prefsRef.current = saved([
      ['executions', true], ['linkedNotes', true], ['entryContext', true], ['planGrade', true], ['outcome', true],
      ['chart', true], ['beforeAfter', true], ['story', true], ['review', true],
    ])
    rerender(tree())
    await waitFor(() => expect(panelOrder(container)[0]).toBe('executions'))

    const after = FINDERS.executions(container)
    expect(after).toBe(before)
    expect(after.open).toBe(true)
  })
})

describe('the Customize button (P4a Task 7)', () => {
  const customizeButton = () => screen.queryByRole('button', { name: 'Customize' })

  it('with the switch off there is no Customize button', async () => {
    setFlags({ layouts: false })
    renderPage()
    await lazyArrived(['p-chart'])
    expect(customizeButton()).toBeNull()
  })

  it('with the switch on it sits in the top bar, beside the back link, and opens nothing until pressed', async () => {
    setFlags({ layouts: true })
    renderPage()
    await lazyArrived(['p-chart'])
    const button = customizeButton()
    expect(button).not.toBeNull()
    const topBar = screen.getByRole('link', { name: /Trade Journal/ }).parentElement
    expect(topBar.contains(button)).toBe(true)
    expect(screen.queryByTestId('editor-stub')).toBeNull()
  })

  it('opens the editor for the trade page; Cancel closes it with no toast', async () => {
    setFlags({ layouts: true })
    renderPage()
    await lazyArrived(['p-chart'])
    fireEvent.click(customizeButton())
    expect(screen.getByTestId('editor-stub').getAttribute('data-page')).toBe('trade')
    fireEvent.click(screen.getByRole('button', { name: 'stub cancel' }))
    expect(screen.queryByTestId('editor-stub')).toBeNull()
    expect(screen.queryByText('Layout saved.')).toBeNull()
  })

  // P4a final review m6: the page's j / k / arrow keys move between trades. While the Customize sheet is open
  // they do nothing, whatever button inside the sheet has focus.
  it('while the Customize sheet is open the arrow and j / k keys do not change the trade', async () => {
    tradesRef.current = [
      { id: 't0', symbol: 'AMD', side: 'Long', setup: 'VCP', entryDate: '2026-04-28' },
      { id: 't1', symbol: 'NVDA', side: 'Long', setup: 'VCP', entryDate: '2026-05-01' },
      { id: 't2', symbol: 'TSLA', side: 'Long', setup: 'VCP', entryDate: '2026-05-06' },
    ]
    setFlags({ layouts: true })
    renderPage()
    await lazyArrived(['p-chart'])

    // CONTROL: with the sheet closed the keys navigate, so a silent handler cannot pass this test.
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(navigateSpy.fn).toHaveBeenCalledTimes(1)
    navigateSpy.fn.mockClear()

    fireEvent.click(customizeButton())
    const inSheet = screen.getByRole('button', { name: 'stub save' })
    for (const key of ['ArrowRight', 'ArrowLeft', 'j', 'k']) {
      fireEvent.keyDown(inSheet, { key })
      fireEvent.keyDown(window, { key })
    }
    expect(navigateSpy.fn).not.toHaveBeenCalled()

    // Closed again, the keys work again.
    fireEvent.click(screen.getByRole('button', { name: 'stub cancel' }))
    fireEvent.keyDown(window, { key: 'k' })
    expect(navigateSpy.fn).toHaveBeenCalledTimes(1)
  })

  it('a save closes the editor and "Layout saved." is shown by the page, after the sheet is gone', async () => {
    setFlags({ layouts: true })
    renderPage()
    await lazyArrived(['p-chart'])
    fireEvent.click(customizeButton())
    fireEvent.click(screen.getByRole('button', { name: 'stub save' }))
    expect(screen.queryByTestId('editor-stub')).toBeNull()
    expect(screen.getByText('Layout saved.')).toBeInTheDocument()
    expect(screen.getByText('Layout saved.').closest('[role="status"]')).not.toBeNull()
  })
})

// R-T6-R1: the chart card's "Add context in notes" button scrolls to and focuses the notes field, which lives
// INSIDE the story section. With the story hidden there is no field to go to, so there is no button; the
// sentence it sat in still says why the chart is a daily one.
describe('the chart card "Add context in notes" button follows the story section', () => {
  const addContext = () => screen.queryByRole('button', { name: /Add context in notes/ })
  const CAPTION = /Daily chart — no execution times logged\./

  it('is there when the story is shown (the default layout)', async () => {
    setFlags({ layouts: false })
    renderPage()
    await lazyArrived(['p-chart'])
    expect(addContext()).not.toBeNull()
    expect(screen.getByText(CAPTION)).toBeInTheDocument()
  })

  it('is there when a saved layout shows both the chart and the story', async () => {
    setFlags({ layouts: true })
    prefsRef.current = saved([['chart', true], ['story', true]])
    renderPage()
    await lazyArrived(['p-chart'])
    expect(addContext()).not.toBeNull()
  })

  it('is NOT there when the story is hidden, and the caption sentence still is', async () => {
    setFlags({ layouts: true })
    prefsRef.current = saved([['chart', true], ['story', false]])
    const { container } = renderPage()
    await lazyArrived(['p-chart'])
    expect(container.querySelector('#trade-setup')).toBeNull() // the story really is not rendered
    expect(addContext()).toBeNull()
    expect(screen.getByText(CAPTION)).toBeInTheDocument()
  })

  it('a button that is there reaches the notes field (the story renders it)', async () => {
    setFlags({ layouts: true })
    prefsRef.current = saved([['chart', true], ['story', true]])
    const scrolled = vi.fn()
    Element.prototype.scrollIntoView = scrolled
    renderPage()
    await lazyArrived(['p-chart'])
    fireEvent.click(addContext())
    expect(scrolled).toHaveBeenCalled()
  })
})
