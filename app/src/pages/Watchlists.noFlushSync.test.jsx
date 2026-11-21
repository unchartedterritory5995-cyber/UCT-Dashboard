// The scan-list virtualizer must NOT re-render through `flushSync` on scroll (2026-11-20).
//
// ⭐ WHY. react-virtual's default (`useFlushSync: true`) re-renders through `flushSync` on every
// scroll event while the list scrolls. An arrow key's `scrollIntoView` (Watchlists' keyboard
// navigation) is such a scroll, so the flushSync forced the WHOLE pending chart switch — both linked
// charts, their setData and indicators — to render and commit synchronously inside the scroll
// handler: 23 ms of a two-chart list flip in a production CPU profile
// (D:/uct-history/profile-2026-11-20, `isScrolling -> onChange -> flushSync`). As an ordinary update
// it batches with the switch the key already scheduled.
//
// This rail pins the option where ScanRows hands it to the REAL hook (the hook is wrapped, not
// replaced, so the list renders exactly as in the app). That the selected row still shows in view
// in the same or the next frame, and that the switch gets no later, is measured in a real browser
// (the flip proof's per-frame selected-row record), because jsdom performs no layout or scrolling.
import { render } from '@testing-library/react'
import { vi, test, expect, beforeEach } from 'vitest'
import { useRef } from 'react'

const hoisted = vi.hoisted(() => ({ opts: [] }))

vi.mock('@tanstack/react-virtual', async (importOriginal) => {
  const real = await importOriginal()
  return {
    ...real,
    useVirtualizer: (opts) => { hoisted.opts.push(opts); return real.useVirtualizer(opts) },
  }
})
vi.mock('../components/StockChart', () => ({ default: () => null }))
vi.mock('../components/chart/SymbolSearch', () => ({ default: () => null }))
vi.mock('../components/CompanyLogo', () => ({ default: () => null }))
vi.mock('../components/chart/pane/ChartPane', () => ({ default: () => null }))
vi.mock('../utils/prefetchBars', () => ({
  prefetchBars: () => {}, prefetchBarsToIDB: () => {}, prefetchAllTimeframes: () => {},
  prefetchBarOnIntent: () => {}, prefetchListAllTimeframes: () => {}, warmMemFromIDB: () => {},
  prewarmVisibleList: () => {},
}))
vi.mock('swr', () => ({ default: () => ({ data: [], mutate: () => {} }) }))
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'user', display_name: 'Pat' } }),
}))

import { ScanRows } from './Watchlists'

function List({ n = 300 }) {
  const scrollRef = useRef(null)
  const items = Array.from({ length: n }, (_, i) => ({ id: `S${i}`, sym: `S${i}` }))
  return (
    <div ref={scrollRef} style={{ height: 300, overflowY: 'auto' }}>
      <ScanRows scrollRef={scrollRef} items={items} renderRow={(it) => <span>{it.sym}</span>} emptyText="none" />
    </div>
  )
}

beforeEach(() => { hoisted.opts.length = 0 })

test('ScanRows hands the virtualizer useFlushSync: false, on every render', () => {
  const { rerender } = render(<List />)
  rerender(<List n={301} />)
  expect(hoisted.opts.length).toBeGreaterThan(0)
  // every call: a render that dropped it would flushSync from then on
  for (const o of hoisted.opts) expect(o.useFlushSync).toBe(false)
})

test('control: the wrapper sees ScanRows\' own options (the rail is not reading a default)', () => {
  render(<List />)
  const o = hoisted.opts.at(-1)
  expect(o.count).toBe(300)
  expect(o.overscan).toBe(12)
  expect(typeof o.observeElementRect).toBe('function')
})
