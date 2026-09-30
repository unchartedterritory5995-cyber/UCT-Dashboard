/* MVP trial withdrawal block (docs/terminal-research/10-roadmap/2026-09-30-mvp-preregistration-ravi.md)
 * and NOW-gate clause 4: while TERMINAL_NEXT_ENABLED is off, a user TAGGED into terminal-next sees
 * the drill WITHOUT its chart. The client half of the polarity the kill-switch rail cites:
 *   listed in cohortsWithdrawn  => no chart widget shown, list full width
 *   not listed (every member)   => the drill exactly as before
 *   and the SAVED board keeps its chart either way, so switching back on restores it untouched.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { AuthContext } from '../../../context/AuthContext'

const setPref = vi.fn()
vi.mock('../../../hooks/usePreferences', () => ({ default: () => ({ prefs: {}, setPref }) }))
vi.mock('./BreadthDrillBoard', () => ({
  default: ({ board }) => (
    <div data-testid="board">
      {board.widgets.map((w) => <span key={w.id} data-testid="widget" data-id={w.id} />)}
    </div>
  ),
}))
vi.mock('../../charts/popout/PopoutWindow', () => ({ default: () => null }))
vi.mock('../../charts/popout/PopoutShell', () => ({ default: ({ children }) => children }))
vi.mock('../../charts/WidgetHost', () => ({ default: ({ widget }) => <div data-testid="host" data-id={widget.id} /> }))

import BreadthDrillModal from './BreadthDrillModal'
import { LIST_WIDGET_ID, DRILL_BOARD_PREF } from './drillBoardPrefs'

const DRILL = { items: [{ t: 'AEHR', pct: 13.1 }], label: 'Up 4%+', date: '2026-09-04' }
const openAs = (auth) => render(
  <AuthContext.Provider value={auth}>
    <BreadthDrillModal drill={DRILL} onClose={() => {}} />
  </AuthContext.Provider>,
)
const shownIds = () => screen.getAllByTestId('widget').map((el) => el.getAttribute('data-id'))

beforeEach(() => setPref.mockClear())
afterEach(cleanup)

describe('the drill chart and the Terminal-Next withdrawal', () => {
  it('a member (never tagged) sees the list AND the chart, exactly as before', () => {
    openAs({ cohortsWithdrawn: [] })
    expect(shownIds()).toContain(LIST_WIDGET_ID)
    expect(shownIds().length).toBe(2)
  })

  it('with no auth context at all the drill is unchanged', () => {
    openAs(null)
    expect(shownIds().length).toBe(2)
  })

  it('a tagged user with the switch off sees the list only', () => {
    openAs({ cohortsWithdrawn: ['terminal-next'] })
    expect(shownIds()).toEqual([LIST_WIDGET_ID])
  })

  it('the SAVED board keeps the chart, so switching back on restores it untouched', () => {
    const { unmount } = openAs({ cohortsWithdrawn: ['terminal-next'] })
    unmount()                                                     // flushes the pending save
    const saves = setPref.mock.calls.filter(([k]) => k === DRILL_BOARD_PREF)
    expect(saves.length).toBeGreaterThan(0)
    const saved = JSON.parse(saves.at(-1)[1])
    expect(saved.widgets.length).toBe(2)                          // the chart was never written away
  })
})

describe('the board lays a chartless board out full width', () => {
  it('no chart widget => no resize divider, the list alone', async () => {
    vi.doUnmock('./BreadthDrillBoard')
    vi.resetModules()
    const { default: Board } = await import('./BreadthDrillBoard')
    render(<Board board={{ widgets: [{ id: LIST_WIDGET_ID, type: 'watchlist' }], split: 320 }}
                  onBoardChange={() => {}} poppedIds={[]} />)
    expect(screen.queryByRole('separator')).toBeNull()
    expect(screen.getAllByTestId('host').map((el) => el.getAttribute('data-id'))).toEqual([LIST_WIDGET_ID])
  })
})
