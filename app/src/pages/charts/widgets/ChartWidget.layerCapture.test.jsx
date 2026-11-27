// The journal capture key (Ctrl+Alt+J) on a hidden LAYER board (2026-11-27, the board keep-alive's layer mode;
// boardVisibility.js). The key is on `document` and answers the ACTIVE chart (by widget id); a kept board stays
// mounted, and a board saved from another shares its widget ids, so without the board's gate one press could capture
// from the hidden chart too.
//   J1 (red first) the active chart of a hidden layer board captures nothing; the same chart shown captures once
import { render, act, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import { WorkspaceContext } from '../WorkspaceContext'
import { BoardVisibilityContext, createBoardVisibility } from '../../../components/chart/boardVisibility'

vi.mock('../../../components/chart/pane/ChartPane', async () => {
  const { forwardRef, useEffect, useImperativeHandle } = await import('react')
  const api = new Proxy({}, { get: () => () => null })
  return {
    // the pane marks its widget active on mount (in the product: on hover / focus)
    default: forwardRef(({ onActivate }, ref) => {
      useImperativeHandle(ref, () => api)
      useEffect(() => { onActivate?.() }, [])   // eslint-disable-line react-hooks/exhaustive-deps
      return <div data-testid="pane" />
    }),
  }
})
vi.mock('../../../components/chart/SymbolSearch', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  return {
    default: forwardRef((_p, ref) => {
      useImperativeHandle(ref, () => ({ openWith: () => {} }))
      return <span />
    }),
  }
})
vi.mock('../../../components/community/ShareToFloor', () => ({ default: () => null }))
vi.mock('../../../components/chart/ChartSettingsModal', () => ({ default: () => null }))
vi.mock('./ChartMarketClock', () => ({ default: () => null }))
vi.mock('./ChartDayGain', () => ({ default: () => null }))
vi.mock('./AiSearchWidget', () => ({ default: () => null }))
vi.mock('./TimeframeMenu', () => ({ default: () => null }))
vi.mock('../../../hooks/useFlagged', () => ({ useFlagged: () => ({ isFlagged: () => false, toggle: () => {} }) }))
vi.mock('../../../hooks/useWatchlistAlerts', () => ({ default: () => ({ alerts: [], createAlert: () => {}, deleteAlert: () => {} }) }))
vi.mock('../../../hooks/useFundamentalSnapshot', () => ({ default: () => ({ data: null, isLoading: false }) }))
vi.mock('../../../hooks/usePreferences', () => ({ default: () => ({ prefs: {}, setPref: () => {}, loading: false }) }))
vi.mock('../../../hooks/useThemeIndexBars', () => ({ default: () => ({ isIndex: false, bars: null, name: null, sector: null, loading: false }) }))
vi.mock('../../../hooks/useTickerMeta', () => ({ default: () => ({ name: 'Apple' }) }))
vi.mock('../../../hooks/useMarketOpen', () => ({ default: () => ({ isOpen: false, isPremarket: false, isExtended: false }) }))
vi.mock('../../../utils/extSession', () => ({ getExtSessionCached: () => ({ session: 'post' }) }))
vi.mock('../../journal-2-0/lib/embedArchive', () => ({ kickSnapshotWarm: () => {} }))

import ChartWidget from './ChartWidget'

let inbox = 0
beforeEach(() => {
  inbox = 0
  globalThis.fetch = vi.fn(async (url) => {
    if (String(url).startsWith('/api/j2/inbox')) inbox++
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  })
})
afterEach(() => { cleanup(); delete globalThis.fetch })

function mount(vis) {
  const value = {
    groupSyms: { A: 'AAPL', B: null, C: null, D: null },
    setGroupSym: () => {},
    chartsTheme: 'default',
    crosshairBus: { emit: () => {}, subscribe: () => () => {} },
    aiSearchBus: { subscribe: () => () => {}, request: () => false },
    activeChartRef: { current: null },
  }
  return render(
    <MemoryRouter>
      <WorkspaceContext.Provider value={value}>
        <BoardVisibilityContext.Provider value={vis}>
          <ChartWidget color="A" opts={{}} onOptsChange={() => {}} />
        </BoardVisibilityContext.Provider>
      </WorkspaceContext.Provider>
    </MemoryRouter>,
  )
}
const capture = () => act(async () => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', ctrlKey: true, altKey: true, bubbles: true }))
  await new Promise((r) => setTimeout(r, 0))
})

test('J1 (red first) the active chart of a hidden layer board captures nothing', async () => {
  const vis = createBoardVisibility({ layer: true })
  mount(vis)
  await capture()
  expect(inbox, 'NON-VACUITY: Ctrl+Alt+J captures from the active chart of a shown board').toBe(1)
  act(() => { vis.set('hidden') })
  await capture()
  expect(inbox, 'a hidden board captured').toBe(1)
  act(() => { vis.set('visible') })
  await capture()
  expect(inbox).toBe(2)
})
