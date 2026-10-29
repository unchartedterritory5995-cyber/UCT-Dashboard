// The "Already on your radar" line was REMOVED from the Breadth drill (owner call
// 2026-10-28: Breadth should not narrate the member's own watchlists/flags). This
// rail keeps it gone: even with MEMBER_INTEREST_BREADTH_ENABLED on, the drill
// renders no line and never requests /api/member/interest. Screener and the
// Morning Wire keep their own notice.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { SWRConfig } from 'swr'

vi.mock('../../Watchlists', () => ({ default: () => <div data-testid="watchlists-probe" /> }))
vi.mock('../grouping/useGroupMeta', () => ({ default: () => ({ industries: {}, sectors: {}, themes: {} }) }))
vi.mock('../../../utils/prefetchBars', () => ({ prefetchListDeep: () => {} }))

import BreadthDrillList from './BreadthDrillList'
import { DrillSourceContext } from './DrillSourceContext'
import { WorkspaceContext } from '../../charts/WorkspaceContext'
import { drillWorkspaceValue } from './drillWorkspace'
import { AuthContext } from '../../../context/AuthContext'

const ITEMS = [{ t: 'AEHR', pct: 13.1 }, { t: 'COHU', pct: 10.3 }, { t: 'SRPT', pct: 15.6 }]
const DRILL = { items: ITEMS, label: 'UP 4%+', date: null, live: true, latestDate: '2026-09-04' }

let reply
beforeEach(() => {
  reply = { entities: { SRPT: { because: ['positions'] }, COHU: { because: ['watchlist'] } } }
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(reply) }))
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

function mount(on) {
  const ws = drillWorkspaceValue({
    groupSyms: { A: null, B: null, C: null, D: null }, setGroupSym: () => {},
    crosshairBus: { emit: () => {}, subscribe: () => () => {} },
    activeChartRef: { current: null }, chartApiById: { current: new Map() }, activeWatchlistRef: { current: null },
  })
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <AuthContext.Provider value={{ memberInterestSurfaces: { member_interest_breadth_enabled: on } }}>
        <WorkspaceContext.Provider value={ws}>
          <DrillSourceContext.Provider value={DRILL}>
            <BreadthDrillList color="A" />
          </DrillSourceContext.Provider>
        </WorkspaceContext.Provider>
      </AuthContext.Provider>
    </SWRConfig>,
  )
}
const interestCalls = () => global.fetch.mock.calls.filter(([u]) => String(u).startsWith('/api/member/interest'))

describe('BreadthDrillList: member interest line removed', () => {
  it.each([false, true])('gate %s: no line and no /api/member/interest request', async (on) => {
    mount(on)
    await screen.findByTestId('watchlists-probe')
    await new Promise((r) => setTimeout(r, 25))
    expect(interestCalls()).toHaveLength(0)
    expect(screen.queryByTestId('member-interest-breadth')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toContain('Already on your radar')
  })
})
