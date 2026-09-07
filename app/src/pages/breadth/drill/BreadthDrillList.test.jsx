// BreadthDrillList — the contract it hands the REAL watchlist table.
//
// Watchlists itself is mocked to a probe: this file is about WHAT the drill feeds
// it, not about re-testing the table (which has its own suites). Rail 1 compares
// that contract against ScannerResults — the widget this one is modelled on — by
// reading ScannerResults' SOURCE, so the two cannot silently diverge.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { cwd } from 'node:process'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

let lastProps = null
vi.mock('../../Watchlists', () => ({
  default: (props) => {
    lastProps = props
    return <div data-testid="watchlists-probe" />
  },
}))
// The industry/sector map is a network fetch inside useGroupMeta; pin it so the
// grouped assertions are deterministic.
vi.mock('../grouping/useGroupMeta', () => ({
  default: () => ({
    industries: { AEHR: 'Semiconductor Equipment & Materials', COHU: 'Semiconductor Equipment & Materials', SRPT: 'Biotechnology' },
    sectors: { AEHR: 'Technology', COHU: 'Technology', SRPT: 'Healthcare' },
    themes: { AEHR: 'AI Infrastructure', COHU: 'AI Infrastructure', SRPT: null },
  }),
}))

// The bar warmer is a real network+IDB module; probe it instead of running it.
const deepCalls = []
vi.mock('../../../utils/prefetchBars', () => ({
  prefetchListDeep: (syms, opts) => { deepCalls.push({ syms, opts }) },
}))

import BreadthDrillList from './BreadthDrillList'
import { DrillSourceContext } from './DrillSourceContext'
import { WorkspaceContext } from '../../charts/WorkspaceContext'
import { drillWorkspaceValue } from './drillWorkspace'

const ITEMS = [
  { t: 'AEHR', n: 'Aehr Test Systems', c: 86.26, vr: 1.7, atr: 10.7, a50: -0.5, pct: 13.1 },
  { t: 'COHU', n: 'Cohu Inc', c: 50.72, vr: 0.9, atr: 6.7, a50: -0.8, pct: 10.3 },
  { t: 'SRPT', n: 'Sarepta Therapeutics', c: 28.44, vr: 2.4, atr: 9.1, a50: -1.2, pct: 15.6 },
]

function ws(overrides = {}) {
  return drillWorkspaceValue({
    groupSyms: { A: null, B: null, C: null, D: null },
    setGroupSym: () => {},
    crosshairBus: { emit: () => {}, subscribe: () => () => {} },
    activeChartRef: { current: null },
    chartApiById: { current: new Map() },
    activeWatchlistRef: { current: null },
    ...overrides,
  })
}

function mount(drill, wsValue = ws()) {
  return render(
    <WorkspaceContext.Provider value={wsValue}>
      <DrillSourceContext.Provider value={drill}>
        <BreadthDrillList color="A" />
      </DrillSourceContext.Provider>
    </WorkspaceContext.Provider>,
  )
}

const LIVE = { items: ITEMS, label: 'UP 4%+', date: null, live: true, latestDate: '2026-09-04' }
const HISTORICAL = { items: ITEMS, label: 'UP 4%+', date: '2026-08-01', live: false, latestDate: '2026-09-04' }

beforeEach(() => { lastProps = null; localStorage.clear() })

describe('BreadthDrillList — it feeds the REAL table, it does not build one', () => {
  it('renders Watchlists in scan mode with the cell as membership', () => {
    mount(LIVE)
    expect(screen.getByTestId('watchlists-probe')).toBeTruthy()
    expect(lastProps.pickList).toBe('__scan__')
    expect(lastProps.embedded).toBe(true)
    expect(Array.isArray(lastProps.scanSymbols)).toBe(true)
    expect(lastProps.pickName).toBe('UP 4%+')
  })

  it('⛔ activeRef and widgetKey TRAVEL TOGETHER (the Shift+F-in-both-widgets bug)', () => {
    // Watchlists reads them as a pair: isActiveWidget() is `!activeRef || …`, so a
    // widgetKey without an activeRef leaves the widget permanently "active".
    const ref = { current: null }
    mount(LIVE, ws({ activeWatchlistRef: ref }))
    expect(lastProps.activeRef).toBe(ref)
    expect(lastProps.widgetKey).toBeTruthy()
  })

  it('carries the breadth-only fields the meta batch cannot supply', () => {
    mount(LIVE)
    expect(lastProps.metaOverride.AEHR).toMatchObject({
      name: 'Aehr Test Systems', atr: 10.7, a50: -0.5,
    })
  })

  it('⛔ maps `vr` to RVOL — the ratio the retired table showed as "1.7x"', () => {
    // The watchlist's Vol column means RAW volume, which this payload does not
    // carry. Without this mapping the ratio is the ONE piece of information the
    // new surface shows less of than the old one. RVOL is a percent; the cell
    // divides by 100, so 1.7x is stored as 170.
    mount(LIVE)
    expect(lastProps.metaOverride.AEHR.rvol).toBe(170)
    expect(lastProps.metaOverride.SRPT.rvol).toBeCloseTo(240)
  })

  it('⛔ leads with RVOL and keeps its OWN column key — Vol can never be filled', () => {
    // Sharing the global watchlist key shipped a dead column: `Vol` means RAW
    // volume, which a recorded snapshot has no way to supply, so every row
    // showed an em-dash there for anyone whose watchlists include it.
    mount(LIVE)
    expect(lastProps.defaultColCfg.order).toContain('rvol')
    expect(lastProps.defaultColCfg.order).not.toContain('vol')
    expect(lastProps.colStorageKey).toBeTruthy()
    expect(lastProps.colStorageKey).toMatch(/breadthDrill$/)
  })

  it('offers no dead back button — there is no picker to return to', () => {
    mount(LIVE)
    expect(lastProps.onExitPick).toBeUndefined()
  })
})

describe('BreadthDrillList — a failed load is NOT an empty result', () => {
  it('⛔⛔ shows a load error, never "no stocks matched"', () => {
    // openDrill used to `.catch()` into `items: []`, so ONE dropped request — a
    // pod restart mid-deploy will do it — told the member the market was quiet.
    // That is a confident wrong answer about the market, from a network blip.
    mount({ ...LIVE, items: [], error: 'load' })
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByText(/couldn’t load this list/i)).toBeTruthy()
    expect(screen.queryByTestId('watchlists-probe')).toBeNull()
  })

  it('offers a retry that calls back into the page', async () => {
    const onRetry = vi.fn()
    const user = userEvent.setup()
    mount({ ...LIVE, items: [], error: 'load', onRetry })
    await user.click(screen.getByRole('button', { name: /try again/i }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('NON-VACUITY: a genuinely empty result still renders the table', () => {
    // If the error branch swallowed the empty case too, "nothing matched" would
    // become unreachable and this test would be the only thing to notice.
    mount({ ...LIVE, items: [], error: null })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByTestId('watchlists-probe')).toBeTruthy()
    expect(lastProps.scanEmptyText).toMatch(/no stocks matched/i)
  })

  it('a list still loading says so, and does not claim nothing matched', () => {
    mount({ ...LIVE, items: [], loading: true })
    expect(lastProps.scanEmptyText).toMatch(/loading/i)
  })
})

describe('BreadthDrillList — historical vs live quotes', () => {
  it('⭐ a HISTORICAL drill pins its quotes to the snapshot day', () => {
    mount(HISTORICAL)
    expect(lastProps.quoteOverride.AEHR).toEqual({ price: 86.26, change_pct: 13.1, volume: null })
    expect(lastProps.quoteOverride.SRPT).toEqual({ price: 28.44, change_pct: 15.6, volume: null })
  })

  it('a LIVE drill pins nothing and streams like any other watchlist', () => {
    mount(LIVE)
    expect(lastProps.quoteOverride).toBeNull()
  })

  it('⛔ the NEWEST recorded day pins TOO — this shipped blank once', () => {
    // A previous version exempted drill.date === latestDate, reasoning that
    // today's snapshot should tick. On a closed market there are no live quotes
    // to fall back to, so Price/Vol/%Chg rendered as em-dashes for EVERY row —
    // caught only in the browser. A recorded day is a recorded day.
    mount({ ...HISTORICAL, date: '2026-09-04' })
    expect(lastProps.quoteOverride).not.toBeNull()
    expect(lastProps.quoteOverride.AEHR).toEqual({ price: 86.26, change_pct: 13.1, volume: null })
  })

  it('every row gets a pinned quote, so none can render blank', () => {
    mount(HISTORICAL)
    for (const [t] of ITEMS.map(i => [i.t])) {
      expect(lastProps.quoteOverride[t], `${t} has a pinned quote`).toBeDefined()
    }
  })
})

describe('BreadthDrillList — the chart paints the first row on open', () => {
  it('seeds the colour group once the async items arrive', async () => {
    // Items land AFTER mount, so seeding at mount seeds nothing and the chart
    // keeps whatever symbol it had — it shipped showing a ticker not in the list.
    const calls = []
    const { rerender } = render(
      <WorkspaceContext.Provider value={ws({ setGroupSym: (c, s) => calls.push([c, s]) })}>
        <DrillSourceContext.Provider value={{ ...LIVE, items: [] }}>
          <BreadthDrillList color="A" />
        </DrillSourceContext.Provider>
      </WorkspaceContext.Provider>,
    )
    expect(calls).toEqual([])
    rerender(
      <WorkspaceContext.Provider value={ws({ setGroupSym: (c, s) => calls.push([c, s]) })}>
        <DrillSourceContext.Provider value={LIVE}>
          <BreadthDrillList color="A" />
        </DrillSourceContext.Provider>
      </WorkspaceContext.Provider>,
    )
    expect(calls).toEqual([['A', 'AEHR']])
  })

  it('does not stomp a symbol the group already holds', () => {
    const calls = []
    mount(LIVE, ws({ groupSyms: { A: 'NVDA', B: null, C: null, D: null }, setGroupSym: (c, s) => calls.push([c, s]) }))
    expect(calls).toEqual([])
  })
})

describe('BreadthDrillList — grouping', () => {
  it('flat by default: top-level rows are tickers, no groups', () => {
    mount(LIVE)
    expect(lastProps.scanSymbols).toEqual(['AEHR', 'COHU', 'SRPT'])
    expect(lastProps.scanGroups).toBeNull()
  })

  it('⛔ grouped: top-level rows are UPPERCASED group names, keyed the same way', async () => {
    // The watchlist uppercases every row sym, so scanSymbols / scanGroups /
    // metaOverride must all key the group name in uppercase or the lookup misses.
    const user = userEvent.setup()
    mount(LIVE)
    await user.click(screen.getByRole('button', { name: 'Grouped' }))
    expect(lastProps.scanSymbols).toContain('SEMICONDUCTOR EQUIPMENT & MATERIALS')
    expect(lastProps.scanGroups['SEMICONDUCTOR EQUIPMENT & MATERIALS']).toEqual(['AEHR', 'COHU'])
    expect(lastProps.metaOverride['SEMICONDUCTOR EQUIPMENT & MATERIALS']).toEqual({ group_count: 2 })
    // Every scanGroups key must appear in scanSymbols, or that group renders no row.
    for (const k of Object.keys(lastProps.scanGroups)) expect(lastProps.scanSymbols).toContain(k)
  })

  it('asks for ALL groups open, not the accordion', () => {
    mount(LIVE)
    expect(lastProps.groupExpand).toBe('multi')
  })

  it('switching to Sector regroups under the sector map', async () => {
    const user = userEvent.setup()
    mount(LIVE)
    await user.click(screen.getByRole('button', { name: 'Grouped' }))
    await user.click(screen.getByRole('button', { name: 'Sector' }))
    expect(lastProps.scanSymbols).toContain('TECHNOLOGY')
    expect(lastProps.scanGroups.TECHNOLOGY).toEqual(['AEHR', 'COHU'])
  })

  it('Theme is offered and groups under the primary-theme map', async () => {
    const user = userEvent.setup()
    mount(LIVE)
    await user.click(screen.getByRole('button', { name: 'Grouped' }))
    await user.click(screen.getByRole('button', { name: 'Theme' }))
    expect(lastProps.scanSymbols).toContain('AI INFRASTRUCTURE')
    expect(lastProps.scanGroups['AI INFRASTRUCTURE']).toEqual(['AEHR', 'COHU'])
  })

  it('a themeless stock buckets as Unclassified rather than vanishing', async () => {
    // SRPT has no primary theme. Dropping it would make the drill's count
    // disagree with the cell that opened it — the list must stay complete.
    const user = userEvent.setup()
    mount(LIVE)
    await user.click(screen.getByRole('button', { name: 'Grouped' }))
    await user.click(screen.getByRole('button', { name: 'Theme' }))
    const members = Object.values(lastProps.scanGroups).flat()
    expect(members).toContain('SRPT')
    expect(members).toHaveLength(ITEMS.length)
  })
})

describe('the widget it replicates — ScannerResults is the reference', () => {
  // Resolved from the vitest root (`app/`) rather than import.meta.url, which is
  // not a file URL under this file's environment. The existence assertion below
  // is the non-vacuity guard: a moved reference fails loudly instead of making
  // every comparison in this block pass on an empty string.
  const REF_PATH = resolve(cwd(), 'src/pages/charts/widgets/ScannerResults.jsx')
  const reference = () => {
    expect(existsSync(REF_PATH), `reference widget still lives at ${REF_PATH}`).toBe(true)
    return readFileSync(REF_PATH, 'utf8')
  }

  it('uses the same scan-mode door ScannerResults does', () => {
    const src = reference()
    // Non-vacuity: if ScannerResults ever stops feeding the real table, this
    // reference is wrong and the comparison below is meaningless.
    expect(src).toContain('pickList="__scan__"')
    expect(src).toContain("from '../../Watchlists'")
    mount(LIVE)
    expect(lastProps.pickList).toBe('__scan__')
  })

  it('passes every prop ScannerResults treats as load-bearing', () => {
    const src = reference()
    mount(LIVE)
    // Derived from the reference rather than retyped: any prop ScannerResults
    // passes AND that the drill also needs must actually be handed over.
    const shared = ['embedded', 'pickList', 'scanSymbols', 'pickName', 'activeRef', 'widgetKey', 'scanFooter']
    for (const p of shared) {
      expect(src.includes(p), `ScannerResults still passes ${p}`).toBe(true)
      expect(lastProps[p], `BreadthDrillList passes ${p}`).not.toBeUndefined()
    }
  })
})


// ── Bar prefetch ────────────────────────────────────────────────────────────
// ⛔ THIS WAS A REGRESSION, not a new feature. `CLAUDE.md` records prefetch as
// wired into the DrillModal this component replaced, and both sibling ad-hoc
// lists still warm (PeriodSortResults, EtfHoldingsResults call prefetchListDeep).
// The rebuild shipped with none, so every row click was a cold fetch — the drill
// was slower than the widget it is supposed to BE, and slower than what it
// replaced. Nothing on screen says so, which is why it needs a rail.
describe('it warms the bars the user is about to open', () => {
  beforeEach(() => { deepCalls.length = 0 })

  it('warms every symbol in the cell once the list arrives', () => {
    mount({ items: ITEMS, label: 'Up 4%+', date: '2026-09-04' })
    expect(deepCalls.length).toBeGreaterThan(0)
    expect(deepCalls[0].syms).toEqual(['AEHR', 'COHU', 'SRPT'])
  })

  it('does NOT re-warm the same cell on a re-render', () => {
    const drill = { items: ITEMS, label: 'Up 4%+', date: '2026-09-04' }
    const { rerender } = mount(drill)
    const after = deepCalls.length
    rerender(
      <WorkspaceContext.Provider value={ws()}>
        <DrillSourceContext.Provider value={drill}>
          <BreadthDrillList color="A" />
        </DrillSourceContext.Provider>
      </WorkspaceContext.Provider>,
    )
    expect(deepCalls.length, 'warm is keyed on the CELL, not the render').toBe(after)
  })

  it('warms again when a DIFFERENT cell is opened', () => {
    mount({ items: ITEMS, label: 'Up 4%+', date: '2026-09-04' })
    const after = deepCalls.length
    mount({ items: ITEMS, label: 'Down 4%+', date: '2026-09-04' })
    expect(deepCalls.length).toBeGreaterThan(after)
  })

  it('gives what is ON SCREEN priority over the background trickle', () => {
    mount({ items: ITEMS, label: 'Up 4%+', date: '2026-09-04' })
    expect(typeof lastProps.onScanVisibleSyms).toBe('function')
    deepCalls.length = 0
    lastProps.onScanVisibleSyms(['COHU', 'SRPT'])
    expect(deepCalls).toHaveLength(1)
    expect(deepCalls[0].syms).toEqual(['COHU', 'SRPT'])
    expect(deepCalls[0].opts?.priority, 'the row you are about to click must jump the queue').toBe(true)
  })

  it('an empty visible window warms nothing', () => {
    mount({ items: ITEMS, label: 'Up 4%+', date: '2026-09-04' })
    deepCalls.length = 0
    lastProps.onScanVisibleSyms([])
    expect(deepCalls).toHaveLength(0)
  })
})
