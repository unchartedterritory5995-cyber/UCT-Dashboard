/**
 * TodaySurface renders its secondary panels from the page layout (P4a Task 5).
 *
 * The lead (zero-data / all-accounts / the session lead) is NOT part of the layout. What follows it is a list:
 * the panels `resolvePanels(layout, 'today', session)` names, in the member's order, shown ones only. With the
 * page-layouts switch off the list is DEFAULT_LAYOUT's, which is today's fixed order; a saved layout is then
 * ignored (and stays stored). Switching the market phase switches the list, and that is a read: no preference
 * is written.
 *
 * The panels are read by `data-testid` / label in DOM order. The five new panels are stubs here (they have
 * their own tests); the four that existed before are the same stubs TodaySurface.test.jsx uses, with the quick
 * actions row real.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const { prefsRef, setPrefSpy, flagRef, checklistProbe } = vi.hoisted(() => ({
  prefsRef: { current: {} },
  setPrefSpy: vi.fn(),
  flagRef: { current: false },
  checklistProbe: vi.fn(),
}))

let market = { isOpen: true, isPremarket: false, isExtended: false }
let account = { id: 'a1', name: 'Default', balanceSource: 'broker' }
let accountId = 'a1'
let positions = [{ id: 'p1', symbol: 'NVDA', shares: 10, entryPrice: 100 }]
let comparison = [{ id: 'a1', tradeCount: 12 }]

vi.mock('../../../hooks/useMarketOpen', () => ({ default: () => market }))
vi.mock('../../../hooks/usePreferences', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, default: () => ({ prefs: prefsRef.current, setPref: setPrefSpy, loading: false }) }
})
vi.mock('../lib/pageLayoutsFlag', () => ({
  PAGE_LAYOUTS_FLAG: 'journal_page_layouts_enabled',
  pageLayoutsEnabled: () => flagRef.current,
}))
vi.mock('../hooks/useJ2SelectedAccount', () => ({
  default: () => ({ accountId, account, accounts: [account], setAccount: vi.fn(), isLoading: false }),
}))
vi.mock('../hooks/useJ2Positions', () => ({
  default: () => ({ positions, isLoading: false, error: null, refresh: vi.fn() }),
}))
vi.mock('../hooks/useJ2OptionStrategies', () => ({
  default: () => ({ strategies: [], isLoading: false, error: null, refresh: vi.fn() }),
}))
vi.mock('../hooks/useJ2AccountComparison', () => ({
  default: () => ({ accounts: comparison, isLoading: false, error: null, refresh: vi.fn() }),
}))
vi.mock('../hooks/useCompassOverview', () => ({
  default: () => ({ overview: { today: {}, regime: 'Uptrend', week_to_date: {} }, isLoading: false, error: null, refresh: vi.fn() }),
}))
vi.mock('../hooks/useScope', () => ({ default: () => ({ isActive: false, scope: {}, activeCount: 0 }) }))
vi.mock('../hooks/useJ2EODRecaps', () => ({
  default: () => ({ recaps: [], isLoading: false, error: null, generate: vi.fn(), refresh: vi.fn() }),
}))
vi.mock('../hooks/useJ2DisciplineState', () => ({
  default: () => ({ state: null, isLoading: false, error: null, refresh: vi.fn() }),
}))
vi.mock('../hooks/useFirstReport', () => ({ default: () => ({ show: false, dismiss: vi.fn() }) }))
vi.mock('../../../hooks/useRealtimePrices', () => ({
  default: () => ({ prices: {}, isStreaming: false, isLoading: false, staleSymbols: [] }),
}))

// The leads and the modals are not under test.
vi.mock('../components/BrokerAccountHero', () => ({ default: () => <div data-testid="broker-hero" /> }))
vi.mock('../components/EODRecap', () => ({ default: () => <div data-testid="eod-recap" /> }))
vi.mock('../components/HoldingsList', () => ({ default: () => <div data-testid="holdings-list" /> }))
vi.mock('../components/SyncFreshnessChip', () => ({ default: () => null }))
vi.mock('../components/ImportCsvModal', () => ({ default: () => null }))
vi.mock('../components/AddTradeModal', () => ({ default: () => null }))
vi.mock('../components/AddPositionModal', () => ({ default: () => null }))

// The four panels that existed before the layout.
vi.mock('../components/CoachStrip', () => ({ default: () => <div data-testid="coach-strip-stub" /> }))
vi.mock('./today/TodayWeekStrip', () => ({ default: () => <div data-testid="today-week-strip" /> }))
vi.mock('../components/accounts/GoalProgress', () => ({
  default: ({ account: a }) => <div data-testid="goal-progress">{a?.name}</div>,
}))

// The five panels the layout adds.
vi.mock('./today/panels/ChecklistTodayPanel', () => ({
  default: (props) => {
    checklistProbe(props)
    return <div data-testid="panel-checklistToday" />
  },
}))
// My rules is the one stub that HOLDS STATE: a counter a click increments. A panel that only moved keeps
// its count; one that was remounted starts again at 0 (the reorder test below reads which happened).
vi.mock('./today/panels/MyRulesPanel', async () => {
  const { useState } = await import('react')
  return {
    default: function MyRulesStub() {
      const [n, setN] = useState(0)
      return (
        <button type="button" data-testid="panel-myRules" onClick={() => setN((c) => c + 1)}>
          {n}
        </button>
      )
    },
  }
})
vi.mock('./today/panels/RegimePanel', () => ({ default: () => <div data-testid="panel-regime" /> }))
vi.mock('./today/panels/TodayNotePanel', () => ({ default: () => <div data-testid="panel-todayNote" /> }))
vi.mock('./today/panels/NoticesPanel', () => ({ default: () => <div data-testid="panel-notices" /> }))

import TodaySurface from './TodaySurface'
import { LAYOUT_PREF, PANELS } from '../lib/pageLayouts'

// panel name -> how it is found in the DOM
const FINDERS = {
  coachStrip: '[data-testid="coach-strip-stub"]',
  weekStrip: '[data-testid="today-week-strip"]',
  goalProgress: '[data-testid="goal-progress"]',
  quickActions: '[aria-label="Quick actions"]',
  checklistToday: '[data-testid="panel-checklistToday"]',
  myRules: '[data-testid="panel-myRules"]',
  regime: '[data-testid="panel-regime"]',
  todayNote: '[data-testid="panel-todayNote"]',
  notices: '[data-testid="panel-notices"]',
}
const NAME_OF = new Map(Object.entries(FINDERS).map(([name, sel]) => [sel, name]))

// The panel names under the Today root, in DOM order.
function panelOrder(container) {
  const found = [...container.querySelectorAll(Object.values(FINDERS).join(','))]
  return found.map((el) => {
    for (const [sel, name] of NAME_OF) if (el.matches(sel)) return name
    return null
  })
}

// A saved today list from `[id, shown]` pairs, then every registry panel the pairs did not name, hidden.
const todayList = (pairs) => {
  const named = new Set(pairs.map(([id]) => id))
  return [
    ...pairs.map(([id, shown]) => ({ id, shown })),
    ...PANELS.today.filter((p) => !named.has(p.id)).map((p) => ({ id: p.id, shown: false })),
  ]
}
const savedLayout = (perPhase) => ({
  version: 1,
  today: {
    premarket: todayList(perPhase.premarket || []),
    market: todayList(perPhase.market || []),
    postclose: todayList(perPhase.postclose || []),
  },
  trade: [],
})

const PREMARKET = { isOpen: false, isPremarket: true, isExtended: false }
const MARKET = { isOpen: true, isPremarket: false, isExtended: false }
const POSTCLOSE = { isOpen: false, isPremarket: false, isExtended: false }

// What TodaySurface.jsx showed after the lead before this task: CoachStrip, then the secondary block
// (TodayWeekStrip, GoalProgress, TodayQuickActions). Captured by rendering the UNMODIFIED component at BASE
// (f10c7fa609) in all three sessions with the same stubs; the order was identical in each.
const BASE_ORDER = ['coachStrip', 'weekStrip', 'goalProgress', 'quickActions']

function renderToday() {
  return render(
    <MemoryRouter>
      <TodaySurface />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  setPrefSpy.mockClear()
  checklistProbe.mockClear()
  prefsRef.current = {}
  flagRef.current = false
  market = MARKET
  account = { id: 'a1', name: 'Default', balanceSource: 'broker' }
  accountId = 'a1'
  positions = [{ id: 'p1', symbol: 'NVDA', shares: 10, entryPrice: 100 }]
  comparison = [{ id: 'a1', tradeCount: 12 }]
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }))
})

describe('TodaySurface renders from the page layout', () => {
  it('test_default_layout_renders_todays_order: the switch off, and on with no saved layout, give the base order', () => {
    for (const m of [PREMARKET, MARKET, { isOpen: false, isPremarket: false, isExtended: false }]) {
      market = m
      flagRef.current = false
      const off = renderToday()
      expect(panelOrder(off.container)).toEqual(BASE_ORDER)
      off.unmount()

      flagRef.current = true
      prefsRef.current = {}
      const on = renderToday()
      expect(panelOrder(on.container)).toEqual(BASE_ORDER)
      on.unmount()
    }
  })

  it('a saved market layout puts Regime then Quick actions, with no week strip', () => {
    flagRef.current = true
    prefsRef.current = {
      [LAYOUT_PREF]: JSON.stringify(savedLayout({
        market: [['regime', true], ['quickActions', true], ['weekStrip', false]],
      })),
    }
    market = MARKET
    const { container } = renderToday()
    expect(panelOrder(container)).toEqual(['regime', 'quickActions'])
    expect(container.querySelector(FINDERS.weekStrip)).toBeNull()
  })

  it('a saved layout is read as an object as well as a string', () => {
    flagRef.current = true
    prefsRef.current = { [LAYOUT_PREF]: savedLayout({ market: [['todayNote', true], ['coachStrip', true]] }) }
    const { container } = renderToday()
    expect(panelOrder(container)).toEqual(['todayNote', 'coachStrip'])
  })

  it('switches layouts when the session phase changes, and writes no preference', () => {
    flagRef.current = true
    prefsRef.current = {
      [LAYOUT_PREF]: JSON.stringify(savedLayout({
        premarket: [['notices', true], ['checklistToday', true]],
        market: [['regime', true], ['myRules', true]],
      })),
    }
    market = PREMARKET
    const { container, rerender } = renderToday()
    expect(panelOrder(container)).toEqual(['notices', 'checklistToday'])

    market = MARKET
    rerender(
      <MemoryRouter>
        <TodaySurface />
      </MemoryRouter>,
    )
    expect(panelOrder(container)).toEqual(['regime', 'myRules'])

    expect(setPrefSpy).not.toHaveBeenCalled()
    const writes = global.fetch.mock.calls.filter(([, init]) => init && init.method && init.method !== 'GET')
    expect(writes).toEqual([])
  })

  it('zero data suppresses every panel whatever the layout, except the coach strip', () => {
    positions = []
    comparison = [{ id: 'a1', tradeCount: 0 }]
    flagRef.current = true
    prefsRef.current = {
      [LAYOUT_PREF]: JSON.stringify(savedLayout({ market: PANELS.today.map((p) => [p.id, true]) })),
    }
    const { container, getByTestId } = renderToday()
    expect(getByTestId('today-zero-data')).toBeInTheDocument()
    expect(panelOrder(container)).toEqual(['coachStrip'])
  })

  it('with the switch off a saved layout is ignored', () => {
    flagRef.current = false
    prefsRef.current = {
      [LAYOUT_PREF]: JSON.stringify(savedLayout({ market: [['regime', true], ['quickActions', true]] })),
    }
    const { container } = renderToday()
    expect(panelOrder(container)).toEqual(BASE_ORDER)
  })

  it('an unreadable saved layout falls back to the default order', () => {
    flagRef.current = true
    prefsRef.current = { [LAYOUT_PREF]: '{not json' }
    const { container } = renderToday()
    expect(panelOrder(container)).toEqual(BASE_ORDER)
  })

  it('the checklist panel is handed the selected account and its id, the same pair the day page reads', () => {
    flagRef.current = true
    prefsRef.current = { [LAYOUT_PREF]: JSON.stringify(savedLayout({ market: [['checklistToday', true]] })) }
    renderToday()
    expect(checklistProbe).toHaveBeenCalled()
    const props = checklistProbe.mock.calls.at(-1)[0]
    expect(props.account).toBe(account)
    expect(props.accountId).toBe('a1')
  })

  it('All Accounts: Goal progress is absent (it needs one account) and the checklist gets a null id', () => {
    account = null
    accountId = null
    flagRef.current = true
    prefsRef.current = {
      [LAYOUT_PREF]: JSON.stringify(savedLayout({ market: [['goalProgress', true], ['checklistToday', true]] })),
    }
    const { container } = renderToday()
    expect(panelOrder(container)).toEqual(['checklistToday'])
    expect(checklistProbe.mock.calls.at(-1)[0].accountId).toBeNull()
  })

  // A reorder must MOVE a panel, not remount it. React matches array children by key, so a panel that lost its
  // key would be matched by position, unmount at its old slot and mount fresh at the new one, and its state would
  // go. My rules is the stateful stub here: it holds a click counter.
  it('a reorder moves a panel and does not remount it: the panel keeps its state', () => {
    flagRef.current = true
    prefsRef.current = {
      [LAYOUT_PREF]: JSON.stringify(savedLayout({ market: [['myRules', true], ['regime', true]] })),
    }
    const { container, rerender } = renderToday()
    expect(panelOrder(container)).toEqual(['myRules', 'regime'])

    const before = container.querySelector(FINDERS.myRules)
    fireEvent.click(before)
    fireEvent.click(before)
    expect(before.textContent).toBe('2')

    // The member saves a reordered layout: Regime first, then My rules.
    prefsRef.current = {
      [LAYOUT_PREF]: JSON.stringify(savedLayout({ market: [['regime', true], ['myRules', true]] })),
    }
    rerender(
      <MemoryRouter>
        <TodaySurface />
      </MemoryRouter>,
    )
    expect(panelOrder(container)).toEqual(['regime', 'myRules'])

    // The same DOM node, with its count intact: it was moved, not rebuilt.
    const after = container.querySelector(FINDERS.myRules)
    expect(after).toBe(before)
    expect(after.textContent).toBe('2')
  })

  // The lead is not part of the layout, so it comes first whatever the layout lists.
  it('the lead precedes the first panel in DOM order, in every session', () => {
    const allShown = PANELS.today.map((p) => [p.id, true])
    flagRef.current = true
    prefsRef.current = {
      [LAYOUT_PREF]: JSON.stringify(savedLayout({ premarket: allShown, market: allShown, postclose: allShown })),
    }
    const LEADS = [
      [PREMARKET, '[data-testid="today-premarket"]'],
      [MARKET, '[data-testid="broker-hero"]'],
      [POSTCLOSE, '[data-testid="today-postclose"]'],
    ]
    for (const [m, leadSelector] of LEADS) {
      market = m
      const { container, unmount } = renderToday()
      const lead = container.querySelector(leadSelector)
      const panelEls = [...container.querySelectorAll(Object.values(FINDERS).join(','))]
      // Controls: the lead was found, and there are panels to compare it against.
      expect(lead).not.toBeNull()
      expect(panelEls.length).toBe(PANELS.today.length)
      for (const el of panelEls) {
        expect(lead.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      }
      unmount()
    }
  })
})
