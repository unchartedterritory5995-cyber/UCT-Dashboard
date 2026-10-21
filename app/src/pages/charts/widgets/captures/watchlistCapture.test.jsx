// Notebook widgets Task 16: `/watchlist` inserts the SAME frozen node the Watchlists table's
// "Send <list> to Journal" builds for the member's default list (the first of their own lists that holds
// names), through the Task 8 snapshot insert path, only when wave 4 is on. The REAL Watchlists table is
// mounted (harness mirrors Watchlists.quoteoverride.test.jsx); its data hooks are the seams.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { snapshotWidgetItems } from '../../../journal-2-0/components/notebook/SlashMenu'
import { buildExtensions } from '../../../journal-2-0/lib/tiptap'
import { latchNotebookFlags, __resetNotebookFlags } from '../../../journal-2-0/lib/offline/notebookFlags'

if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
}

// The member's own lists, newest-updated first: an EMPTY one leads, so "the first list" alone would differ.
// The table's live feed and the slash insert's /api/live-prices read the same quotes; TSLA has none.
const { LISTS, PRICES } = vi.hoisted(() => ({
  LISTS: [
    { id: 'w0', name: 'Empty', items: [] },
    { id: 'w1', name: 'Swing', items: [{ id: 1, sym: 'NVDA', notes: 'base breakout' }, { id: 2, sym: 'AMD' }, { id: 3, sym: 'TSLA' }] },
    { id: 'w2', name: 'Other', items: [{ id: 4, sym: 'MSFT' }] },
  ],
  PRICES: { NVDA: { price: 181.25, change_pct: 1.2 }, AMD: { price: 150.5, change_pct: -0.4 } },
}))

vi.mock('../../../../components/StockChart', () => ({ default: () => null }))
vi.mock('../../../../components/chart/SymbolSearch', () => ({ default: () => null }))
vi.mock('../../../../components/CompanyLogo', () => ({ default: () => null }))
vi.mock('../../../../components/chart/pane/ChartPane', () => ({ default: () => null }))
vi.mock('../../../../utils/prefetchBars', () => ({
  prefetchBars: () => {}, prefetchBarsToIDB: () => {}, prefetchAllTimeframes: () => {},
  prefetchBarOnIntent: () => {}, prefetchListAllTimeframes: () => {}, warmMemFromIDB: () => {},
  prewarmVisibleList: () => {},
}))
vi.mock('../../../../lib/chartReadoutStore', () => ({
  subscribeChartReadouts: () => () => {}, getChartReadout: () => null, hasFreshReadouts: () => false,
}))
vi.mock('swr', async (importOriginal) => {
  const real = await importOriginal()
  const mine = { data: LISTS, mutate: () => {} }
  const none = { data: [], mutate: () => {} }
  return { ...real, default: (key) => (key === '/api/watchlists' ? mine : none) }
})
vi.mock('../../../../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', role: 'user', display_name: 'Pat' } }),
}))
vi.mock('../../../../hooks/useFlagged', () => {
  const v = {
    flagged: [], toggle: () => {}, remove: () => {}, isFlagged: () => false,
    isShared: false, toggleShare: () => {}, flaggedName: 'Flagged', renameFlagged: () => {},
  }
  return { useFlagged: () => v }
})
vi.mock('../../../../hooks/useTickerTags', () => {
  const v = {
    tags: {}, setTag: () => {}, removeTag: () => {}, getTag: () => null,
    shared: [], isColorShared: () => false, toggleShareColor: () => {}, communityTags: [],
  }
  return { default: () => v }
})
vi.mock('../../../../hooks/useWatchlistAlerts', () => {
  const v = { alerts: [], createAlert: () => {}, deleteAlert: () => {}, getAlertsForSym: () => [], hasAlert: () => false }
  return { default: () => v }
})
vi.mock('../../../../hooks/useTagColors', () => { const v = { tagColors: [], tagByKey: {}, setTagLabel: () => {} }; return { default: () => v } })
vi.mock('../../../../hooks/usePreferences', async (importOriginal) => {
  const v = { prefs: {}, setPref: () => {}, loading: false }
  return { ...(await importOriginal()), default: () => v, parsePref: (raw, fallback) => fallback }
})
vi.mock('../../../../hooks/useRealtimePrices', () => {
  const v = { prices: PRICES, isLoading: false, isStreaming: false, staleSymbols: new Set() }
  return { default: () => v }
})
vi.mock('../../../../hooks/useWatchlistPerformance', () => { const v = { perfData: {}, isLoading: false }; return { default: () => v } })
vi.mock('../../../../hooks/useWatchlistMeta', () => { const v = { metaData: {}, isLoading: false }; return { default: () => v } })
vi.mock('../../../../hooks/useWatchlistThemes', () => { const v = { themeData: {}, isLoading: false }; return { default: () => v } })
vi.mock('../../../../hooks/useBreakpoint', () => ({
  useIsTouch: () => false, useIsPhone: () => false, useIsTablet: () => false, useIsDesktop: () => true,
  useHasCoarsePointer: () => false, useHasNoHover: () => false,
}))
vi.mock('../../ChartsSymContext', () => {
  const v = { sym: null, setSym: () => {} }
  return { ChartsSymContext: { Provider: ({ children }) => children }, useChartsSym: () => v }
})
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }) => ({
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, key: index, start: index * 28, size: 28 })),
    getTotalSize: () => count * 28,
    scrollToIndex: () => {}, measureElement: () => {}, scrollToOffset: () => {},
  }),
  observeElementRect: () => () => {},
  observeElementOffset: () => () => {},
  elementScroll: () => {},
}))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))

const sent = []
vi.mock('../../../journal-2-0/lib/captureTargets', async (importOriginal) => ({
  ...(await importOriginal()),
  CAPTURE_TARGETS: { note: { run: async (attrs) => { sent.push(attrs); return 'Saved' } } },
}))

const Watchlists = (await import('../../../Watchlists')).default

const W4 = { notebook_widgets_w4_enabled: true }
let listsBody = LISTS
const ok = (body) => ({ ok: true, status: 200, json: async () => body })
const answer = (url) => {
  const u = String(url)
  if (u === '/api/watchlists?include_prebuilt=0') return ok(listsBody)
  if (u.startsWith('/api/live-prices?tickers=')) return ok(PRICES)
  return { ok: true, status: 200, json: async () => ({}) }
}
const strip = ({ capturedAt, embedId, ...rest }) => rest // eslint-disable-line no-unused-vars

let editor
const mount = (content) => {
  const el = document.createElement('div')
  document.body.appendChild(el)
  editor = new Editor({ element: el, extensions: buildExtensions(), content })
  return editor
}
const slashRange = (ed) => {
  const text = ed.state.doc.firstChild.textContent
  const at = text.lastIndexOf('/')
  return { from: 1 + at, to: 1 + text.length }
}
const embeds = (ed) => { const o = []; ed.state.doc.descendants((n) => { if (n.type.name === 'widgetEmbed') o.push(n) }); return o }
const item = () => snapshotWidgetItems('watchlist').find((i) => i.title === 'Watchlist snapshot')

const realFetch = globalThis.fetch
beforeEach(() => {
  sent.length = 0
  listsBody = LISTS
  localStorage.clear()
  globalThis.fetch = vi.fn(async (url) => answer(url))
})
afterEach(() => {
  globalThis.fetch = realFetch
  __resetNotebookFlags()
  editor?.destroy(); editor = null
})

describe('/watchlist (Task 16)', () => {
  it('inserted_node_equals_send_to_journal_node', async () => {
    render(<Watchlists embedded />)
    fireEvent.click(await screen.findByLabelText('Send Swing to Journal', {}, { timeout: 8000 }))
    await waitFor(() => expect(sent).toHaveLength(1))

    latchNotebookFlags(W4)
    const ed = mount('<p>/watchlist</p>')
    const res = await item().command({ editor: ed, range: slashRange(ed) })
    expect(res.ok).toBe(true)
    const [node] = embeds(ed)
    expect(strip(node.attrs)).toEqual(strip(ed.schema.nodes.widgetEmbed.create(sent[0]).attrs))
    // Non-vacuity: the first list WITH names (not the empty one), its note, and the quotes as they stood.
    const p = node.attrs.params
    expect(p.watchKey).toBe('w1')
    expect(p.watchName).toBe('Swing')
    expect(p.rows).toEqual([
      { sym: 'NVDA', note: 'base breakout', price: 181.25, chgPct: 1.2 },
      { sym: 'AMD', price: 150.5, chgPct: -0.4 },
      { sym: 'TSLA' },
    ])
  }, 30000)

  it('W4 off: the item is absent', () => {
    expect(snapshotWidgetItems('watchlist').some((i) => i.title === 'Watchlist snapshot')).toBe(false)
    latchNotebookFlags(W4)                                        // control
    expect(snapshotWidgetItems('').find((i) => i.title === 'Watchlist snapshot').group).toBe('more')
  })

  it('prose after the command offers nothing', () => {
    latchNotebookFlags(W4)
    expect(snapshotWidgetItems('watchlist looks heavy')).toEqual([])
    expect(snapshotWidgetItems('watchlist snapshot from friday')).toEqual([])
  })

  it('a failed fetch inserts nothing', async () => {
    latchNotebookFlags(W4)
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }))
    const ed = mount('<p>Names /watchlist</p>')
    const notify = vi.fn()
    ed.storage.uctJournalWidgets = { ...(ed.storage.uctJournalWidgets || {}), notify }
    const res = await item().command({ editor: ed, range: slashRange(ed) })
    expect(res.ok).toBe(false)
    expect(embeds(ed)).toHaveLength(0)
    expect(ed.state.doc.textContent).toBe('Names ')
    expect(notify).toHaveBeenCalledWith('Watchlist snapshot could not be loaded just now, so nothing was added.', 'error')
  })

  it('no list with names inserts nothing and says so', async () => {
    latchNotebookFlags(W4)
    listsBody = [{ id: 'w0', name: 'Empty', items: [] }]
    const ed = mount('<p>/watchlist</p>')
    const res = await item().command({ editor: ed, range: slashRange(ed) })
    expect(res).toEqual({ ok: false, message: 'You have no watchlist with names in it yet, so nothing was added.' })
    expect(embeds(ed)).toHaveLength(0)
  })
})
