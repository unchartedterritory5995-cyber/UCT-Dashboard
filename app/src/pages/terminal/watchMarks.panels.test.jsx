// Watchlist marks on a real board: four real panels, the real kit cell, the real shared source.
//
//     cd app && npx vitest run src/pages/terminal/watchMarks.panels.test.jsx --maxWorkers=2
//
// HILO (new highs and lows), UPDG (upgrades), CONFL (confluence) draw their names through the kit's
// symbol cell and were not edited for this feature; MOST (movers) draws its own row button and
// places the kit's mark. All four sit under ONE WatchMarksProvider, as they do in the shell.
// Rails:
//   * the member's names are marked in every list, and nobody else's are;
//   * the whole board costs ONE read of the member's lists;
//   * a member with no watchlist sees the same board with no mark;
//   * the marked board passes axe.
// Each panel's own data is its own test's fixture shape, cut down; every ticker is made up.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, within, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'

vi.mock('../../utils/jsonFetcher', () => ({ default: vi.fn() }))
vi.mock('./panels/commandWriteBack', () => ({ usePanelWriteBack: () => null }))
vi.mock('../../hooks/useMarketOpen', () => ({ default: () => ({ isOpen: true, isPremarket: false, isExtended: false, isHalfDay: false }) }))
vi.mock('../../hooks/useLivePrices', () => ({ default: () => ({ prices: {}, isLoading: false, error: null }) }))
import jsonFetcher from '../../utils/jsonFetcher'
import { AuthContext } from '../../context/AuthContext'
import { FLAGGED_STORAGE_KEY, writeFlagged } from '../../hooks/flaggedStore'
import { USER_LISTS_URL } from '../../hooks/useUserTickerSet'
import { PanelFreshnessContext, PanelListContext } from '../../components/terminal'
import WatchMarksProvider from '../../components/terminal/WatchMarksProvider'
import HighsLowsPanel from './panels/HighsLowsPanel'
import UpgradesPanel, { UPGRADES_URL } from './panels/UpgradesPanel'
import ConfluencePanel, { CONFLUENCE_URL } from './panels/ConfluencePanel'
import MoversPanel from './panels/MoversPanel'
import { CATALYSTS_URL, MOVERS_URL, VOLUME_URL } from './panels/moversModel'
import { expectNoAxeViolations } from '../journal-2-0/a11y/axeHarness'

const ASOF = '2026-11-16T10:31:02.123456-05:00'
const hl = (sym, dir, count) => ({ sym, price: 10, pct: 1, count, ts: ASOF, dir, pick: sym })
const HILO = {
  window: 'rth', date: '2026-11-16', asof: ASOF, ticks: 412, active: true, group: null, value: null, categories: {},
  highs_total: 2, lows_total: 2,
  highs: [hl('AAA', 'high', 9), hl('BBB', 'high', 4)],
  lows: [hl('DDD', 'low', 7), hl('EEE', 'low', 2)],
}
const UPDG = {
  upgrades: [
    { ticker: 'AAA', action: 'upgrade', firm: 'Harbor Securities', from_rating: 'Hold', to_rating: 'Buy', price_target: '$120' },
    { ticker: 'bbb', action: 'Initiates', firm: 'Northgate Research', from_rating: null, to_rating: 'Outperform', price_target: 48.5 },
  ],
  downgrades: [{ ticker: 'CCC', action: 'downgraded', firm: 'Harbor Securities', from_rating: 'Buy', to_rating: 'Neutral', price_target: null }],
  pt_changes: [{ ticker: 'AAA', action: 'lowers pt', firm: 'Eastline Capital', price_target: '300-320' }],
  summary: { upgrades: 2, downgrades: 1, pt_changes: 1 },
}
const confl = (sym, dir) => ({
  sym, band: 'L', dir, dpn: 1200000000, acc: 'Acc', net: 12400000, net5: 6000000, bull: 13000000, bear: 600000, bullPct: 96,
  top: { cp: 'C', strike: 420, exp: '1/15/2027', dte: 60, prem: 5200000 }, leapPrem: 6100000, leapShare: 0.482, status: 'BUILDING',
  freshRatio: 0.48, bigPrint: 88000000, bigDate: '11/03', dpLo: 170.5, dpHi: 195.25, dpAvg: 182.4, dpLast: 190.06, bigPrice: 181,
  sector: 'Technology', score: 2.7,
})
const CONFL = {
  ok: true, window: 'Oct 6 to Nov 14, 2026', days: 30, rows: [confl('AAA', 'BULL'), confl('CCC', 'BEAR'), confl('FFF', 'BULL')],
  counts: { total: 3, bull: 2, bear: 1, building: 3 },
  band_meta: { L: ['Large Cap', '$10B to $500B'], M: ['Mid Cap', '$2B to $10B'], S: ['Small Cap', '< $2B'] },
  allowedDays: [20, 30, 60, 90], warnings: null,
}
const MOVERS = { ripping: [{ sym: 'AAA', pct: '+12.50%' }, { sym: 'GGG', pct: '+4.00%' }], drilling: [{ sym: 'DDD', pct: '-8.25%' }] }
const ROUTES = {
  '/api/nhnl/live?limit=50': HILO,
  [UPGRADES_URL]: UPDG,
  [CONFLUENCE_URL]: CONFL,
  [MOVERS_URL]: MOVERS,
  [CATALYSTS_URL]: { rows: [] },
  [VOLUME_URL]: { active: true, rows: [] },
}

// The member: AAA on two lists, CCC on one, DDD flagged. BBB, EEE, FFF and GGG are nobody's.
const LISTS = [
  { id: 'w1', name: 'Swing ideas', items: [{ sym: 'AAA' }, { sym: 'CCC' }] },
  { id: 'w2', name: 'Leaders', items: [{ sym: 'AAA' }] },
]
const realFetch = globalThis.fetch
let lists
let listReads

function Slot({ children }) {
  return (
    <PanelFreshnessContext.Provider value={() => {}}>
      <PanelListContext.Provider value={{ open: () => {}, run: () => {}, rerun: () => {}, publish: () => {}, publishRows: () => {} }}>
        {children}
      </PanelListContext.Provider>
    </PanelFreshnessContext.Provider>
  )
}
function board() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), shouldRetryOnError: false }}>
      <AuthContext.Provider value={{ user: { id: 'u1', display_name: 'Test' }, loading: false }}>
        <WatchMarksProvider>
          <Slot><HighsLowsPanel /></Slot>
          <Slot><UpgradesPanel /></Slot>
          <Slot><ConfluencePanel /></Slot>
          <Slot><MoversPanel onRun={() => {}} onRows={() => {}} /></Slot>
        </WatchMarksProvider>
      </AuthContext.Provider>
    </SWRConfig>,
  )
}
async function ready() {
  await screen.findByTestId('terminal-hilo-highs-row-AAA')
  await screen.findByTestId('terminal-updg-table')
  await screen.findByTestId('terminal-confl-row-AAA')
  await screen.findByTestId('terminal-movers-row-AAA')
}
/** The names carrying the mark inside one element, in screen order. */
const markedIn = (el) => within(el).queryAllByTestId('watch-mark').map((m) => (
  m.closest('[data-testid^="panel-symbol-"]')?.getAttribute('data-testid').replace('panel-symbol-', '')
    || m.closest('tr')?.getAttribute('data-testid').replace('terminal-movers-row-', '')
))

beforeEach(() => {
  lists = LISTS
  listReads = 0
  localStorage.removeItem(FLAGGED_STORAGE_KEY)
  jsonFetcher.mockReset()
  jsonFetcher.mockImplementation(async (url) => {
    if (url in ROUTES) return ROUTES[url]
    throw Object.assign(new Error(`unserved ${url}`), { status: 500 })
  })
  globalThis.fetch = vi.fn(async (url) => {
    if (String(url) === USER_LISTS_URL) {
      listReads += 1
      return new Response(JSON.stringify(lists), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
})
afterEach(() => { cleanup(); globalThis.fetch = realFetch; localStorage.removeItem(FLAGGED_STORAGE_KEY) })

describe('a board of real panels, a member with watchlists', () => {
  it('marks the member\'s names in every list, and only those', async () => {
    writeFlagged(['DDD'])
    board()
    await ready()
    await waitFor(() => expect(screen.getAllByTestId('watch-mark').length).toBeGreaterThan(0))

    // HILO: AAA among the highs (on two lists), DDD among the lows (flagged); BBB and EEE are not.
    expect(markedIn(screen.getByTestId('terminal-hilo-highs'))).toEqual(['AAA'])
    expect(markedIn(screen.getByTestId('terminal-hilo-lows'))).toEqual(['DDD'])
    const hiloAaa = within(screen.getByTestId('terminal-hilo-highs-row-AAA')).getByRole('button', { name: 'Load AAA, on your watchlist' })
    expect(hiloAaa.getAttribute('title')).toBe('Load AAA into the linked panels. On your watchlists: Swing ideas, Leaders.')
    expect(within(screen.getByTestId('terminal-hilo-lows-row-DDD')).getByRole('button', { name: 'Load DDD, on your Flagged list' })).toBeTruthy()
    expect(within(screen.getByTestId('terminal-hilo-highs-row-BBB')).getByRole('button', { name: 'Load BBB' })).toBeTruthy()

    // UPDG: AAA twice (an upgrade and a target change), CCC once; the lower-case "bbb" is not.
    expect(markedIn(screen.getByTestId('terminal-updg-table'))).toEqual(['AAA', 'CCC', 'AAA'])

    // CONFL: AAA and CCC; FFF is nobody's.
    const conflRows = ['AAA', 'CCC', 'FFF'].map((s) => screen.getByTestId(`terminal-confl-row-${s}`))
    expect(conflRows.map((r) => within(r).queryAllByTestId('watch-mark').length)).toEqual([1, 1, 0])

    // MOST draws its own row button; the kit's mark sits after the name as a named image.
    expect(markedIn(screen.getByTestId('terminal-movers-table')).sort()).toEqual(['AAA', 'DDD'])
    const mostAaa = screen.getByTestId('terminal-movers-row-AAA')
    expect(within(mostAaa).getByRole('img', { name: 'On your watchlists: Swing ideas, Leaders' })).toBeTruthy()
    expect(within(screen.getByTestId('terminal-movers-row-GGG')).queryByTestId('watch-mark')).toBeNull()

    // every panel, one read
    expect(listReads).toBe(1)
  }, 30_000)

  it('the marked board passes axe', async () => {
    writeFlagged(['DDD'])
    const { container } = board()
    await ready()
    await waitFor(() => expect(screen.getAllByTestId('watch-mark').length).toBeGreaterThan(5))
    await expectNoAxeViolations(container)
  }, 40_000)
})

describe('the same board, a member with no watchlist', () => {
  it('shows every row and not one mark', async () => {
    lists = []
    board()
    await ready()
    await waitFor(() => expect(listReads).toBe(1))
    expect(screen.queryByTestId('watch-mark')).toBeNull()
    expect(within(screen.getByTestId('terminal-hilo-highs-row-AAA')).getByRole('button', { name: 'Load AAA' })).toBeTruthy()
    expect(screen.getByTestId('terminal-movers-row-AAA')).toBeTruthy()
  }, 30_000)
})
