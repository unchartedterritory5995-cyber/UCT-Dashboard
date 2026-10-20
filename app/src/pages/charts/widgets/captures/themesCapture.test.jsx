// Notebook widgets Task 16: `/themes` inserts the SAME frozen node a fresh Theme Tracker's "Send this
// ranking to Journal" builds (the shared set, Today, high to low, no theme open), through the Task 8 snapshot
// insert path, only when wave 4 is on. The REAL ThemeTrackerPage is mounted (harness mirrors
// ThemeTrackerPage.openThemeReport.test.jsx); its data hooks are the seams.
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

const h = (sym, r1d) => ({ sym, name: sym, returns: { '1d': r1d }, ref_prices: { '1d': 10 } })
// Served in the WRONG order, one theme with no Today number (it ranks last), and one with no group_return
// (its number is the holdings' average): the ranking is the capture's, not the payload's.
const { THEME_DATA } = vi.hoisted(() => ({ THEME_DATA: { themes: [] } }))
const THEMES = [
  { ticker: 'SOLAR', name: 'Solar', group_return: { '1d': -0.8 }, holdings: [h('FSLR', -1), h('ENPH', -0.5)] },
  { ticker: 'QTUM', name: 'Quantum Computing', group_return: {}, holdings: [h('IONQ', 4), h('RGTI', 2), h('QBTS', 3), h('ARQQ', 1)] },
  { ticker: 'NUKE', name: 'Nuclear', group_return: {}, holdings: [] },
  { ticker: 'SMH', name: 'Semiconductors', group_return: { '1d': 1.5 }, holdings: [h('NVDA', 2), h('AMD', 1)] },
]

vi.mock('../../../../components/StockChart', () => ({ default: () => null }))
vi.mock('../../../../components/CompanyLogo', () => ({ default: () => null }))
vi.mock('../../../../components/chart/pane/ChartPane', () => ({ default: () => null }))
vi.mock('../../../../utils/prefetchBars', () => ({
  prefetchBar: () => {}, prefetchBars: () => {}, prefetchBarsToIDB: () => {},
  prefetchAllTimeframes: () => {}, prefetchBarOnIntent: () => {}, prefetchListAllTimeframes: () => {},
  prewarmVisibleList: () => {}, warmMemFromIDB: () => {},
}))
vi.mock('../../../../hooks/useMobileSWR', () => ({
  default: (key) => {
    if (key === '/api/theme-performance') return { data: THEME_DATA, isLoading: false }
    if (key === '/api/theme-rotation') return { data: { rankings: {} } }
    return { data: undefined, isLoading: false }
  },
}))
vi.mock('../../../../hooks/useFlagged', () => ({
  useFlagged: () => ({ flagged: [], toggle: () => {}, isFlagged: () => false }),
}))
vi.mock('../../../../hooks/useTickerTags', () => ({ default: () => ({ getTag: () => null }) }))
vi.mock('../../../../hooks/usePreferences', async (importOriginal) => ({
  ...(await importOriginal()),
  default: () => ({ prefs: {}, setPref: () => {}, loading: false }),
  parsePref: (raw, fallback) => fallback,
}))
vi.mock('../../../../hooks/useRealtimePrices', () => ({
  default: () => ({ prices: {}, isLoading: false, isStreaming: false, staleSymbols: new Set() }),
}))
vi.mock('../../../../hooks/useRealtimeBarPrices', () => ({ default: () => ({}), pickFreshPrice: () => null }))
vi.mock('../../ChartsSymContext', () => ({
  ChartsSymContext: { Provider: ({ children }) => children },
  useChartsSym: () => ({ sym: null, setSym: () => {} }),
}))

const sent = []
vi.mock('../../../journal-2-0/lib/captureTargets', async (importOriginal) => ({
  ...(await importOriginal()),
  CAPTURE_TARGETS: { note: { run: async (attrs) => { sent.push(attrs); return 'Saved' } } },
}))

const ThemeTrackerPage = (await import('../../../ThemeTrackerPage')).default

const W4 = { notebook_widgets_w4_enabled: true }
let perfBody = { themes: THEMES }
const ok = (body) => ({ ok: true, status: 200, json: async () => body })
const answer = (url) => (String(url) === '/api/theme-performance'
  ? ok(perfBody) : { ok: true, status: 200, json: async () => ({}) })
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
const item = () => snapshotWidgetItems('themes').find((i) => i.title === 'Theme rankings')

const realFetch = globalThis.fetch
beforeEach(() => {
  sent.length = 0
  THEME_DATA.themes = THEMES
  perfBody = { themes: THEMES }
  localStorage.clear()
  globalThis.fetch = vi.fn(async (url) => answer(url))
})
afterEach(() => {
  globalThis.fetch = realFetch
  __resetNotebookFlags()
  editor?.destroy(); editor = null
})

describe('/themes (Task 16)', () => {
  it('inserted_node_equals_send_to_journal_node', async () => {
    render(<ThemeTrackerPage />)
    fireEvent.click(await screen.findByLabelText('Send this ranking to Journal', {}, { timeout: 8000 }))
    await waitFor(() => expect(sent).toHaveLength(1))

    latchNotebookFlags(W4)
    const ed = mount('<p>/themes</p>')
    const res = await item().command({ editor: ed, range: slashRange(ed) })
    expect(res.ok).toBe(true)
    const [node] = embeds(ed)
    expect(strip(node.attrs)).toEqual(strip(ed.schema.nodes.widgetEmbed.create(sent[0]).attrs))
    // Non-vacuity: ranked high to low on Today, the averaged theme placed by its holdings, the blank one last.
    const p = node.attrs.params
    expect(p.period).toBe('1d')
    expect(p.sortDir).toBe('desc')
    expect(p.rows.map((r) => r.sym)).toEqual(['QTUM', 'SMH', 'SOLAR', 'NUKE'])
    expect(p.rows[0]).toMatchObject({ chgPct: 2.5, extraValue: 'IONQ · QBTS · RGTI' })
    expect(p.rows[3].chgPct).toBeUndefined()
    expect(p.openTheme).toBeUndefined()
  }, 30000)

  it('W4 off: the item is absent', () => {
    expect(snapshotWidgetItems('themes')).toEqual([])
    latchNotebookFlags(W4)                                        // control
    expect(snapshotWidgetItems('').find((i) => i.title === 'Theme rankings').group).toBe('more')
  })

  it('prose after the command offers nothing', () => {
    latchNotebookFlags(W4)
    expect(snapshotWidgetItems('themes are rotating')).toEqual([])
    expect(snapshotWidgetItems('theme rankings shifted')).toEqual([])
  })

  it('a failed fetch inserts nothing', async () => {
    latchNotebookFlags(W4)
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }))
    const ed = mount('<p>Rank /themes</p>')
    const notify = vi.fn()
    ed.storage.uctJournalWidgets = { ...(ed.storage.uctJournalWidgets || {}), notify }
    const res = await item().command({ editor: ed, range: slashRange(ed) })
    expect(res.ok).toBe(false)
    expect(embeds(ed)).toHaveLength(0)
    expect(ed.state.doc.textContent).toBe('Rank ')
    expect(notify).toHaveBeenCalledWith('Theme rankings could not be loaded just now, so nothing was added.', 'error')
  })

  it('rankings still being computed insert nothing and say so', async () => {
    latchNotebookFlags(W4)
    perfBody = { status: 'computing', themes: [] }
    const ed = mount('<p>/themes</p>')
    const res = await item().command({ editor: ed, range: slashRange(ed) })
    expect(res).toEqual({ ok: false, message: 'The theme rankings are still being computed. Try again in a minute.' })
    expect(embeds(ed)).toHaveLength(0)
  })
})
