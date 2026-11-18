// CHARTS OUTCOME — pl-widget slice 1 (lever A1 of EXEC-LEDGER-NEXT): the Journal family (widget.sendToJournal) over the
// capture doors of the REAL Alerts, News & Catalysts, Market Context, AI Search and Fundamentals widgets. The door is one
// shared action (`capture` on pages/charts/widgetDoors.js), so the test is one table. Each widget is mounted in its
// WidgetDoorContext slot beside the real Agent panel, with the props WidgetHost gives it on /charts. The Journal is read at its
// own send function (sendCaptureToJournal: the capture it was handed), never from a receipt alone.
//
// AI Search: on /charts its conversation is the widget's own state and starts empty; the only way to seed it without a paid
// stream is the widget's own `initialThread` prop (the earnings modal's restore door). The thread is invented fixture data.
//
// ⛔ THE MODEL IS SCRIPTED (outcomeHarness). Data is invented fixture data. Evidence: LOCAL native Windows Node, jsdom,
// BROWSER-MOCK-MODEL / SIMULATED.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { open, outcomeSuite, afterEachOutcome, chart, must, waitFor, proposalsNow, refusals } from './outcomeHarness'
import { WidgetDoorContext, mountedWidgetDoor } from '../../../pages/charts/widgetDoors'
import { WorkspaceContext } from '../../../pages/charts/WorkspaceContext'
import { AuthContext } from '../../../context/AuthContext'

vi.mock('../../../pages/journal-2-0/components/VoiceInputButton', () => ({ default: () => null }))
vi.mock('../../../components/StockChart', () => ({ default: () => null }))
vi.mock('../../../components/chart/pane/ChartPane', () => ({ default: () => null }))
vi.mock('../../../components/CompanyLogo', () => ({ default: () => null }))
vi.mock('echarts-for-react', () => ({ default: () => null }))
const data = vi.hoisted(() => ({
  sent: [],
  alerts: [
    { id: 1, sym: 'AAA', target_price: 10, direction: 'above', alert_type: 'price', is_active: 1, created_at: '2026-11-01T12:00:00Z' },
    { id: 2, sym: 'BBB', target_price: 20, direction: 'below', alert_type: 'price', is_active: 0, triggered_at: '2026-11-02T14:00:00Z' },
  ],
  events: [
    { date: '2026-10-14', type: 'earnings', direction: 'up', title: 'Fixture beat', description: 'fixture', move_pct: 1, source: 'earnings' },
    { date: '2026-09-02', type: 'catalyst', direction: 'down', title: 'Fixture cut', description: null, move_pct: -1, source: 'fixture' },
  ],
  breadth: { market_phase: 'Fixture Phase', exposure: { score: 50, score_delta: 1 }, breadth_score: 50, distribution_days: 1, pct_above_50ma: 50, pct_above_200ma: 50, wire_date: '2026-11-02' },
  table: { ticker: 'AAA', annual: [{ year: 2025, eps: 1, eps_chg_pct: 1, sales: 1, sales_chg_pct: 1, estimate: false }],
    quarterly: [{ period: 'Q3 2026', eps: 1, eps_chg_pct: 1, sales: 1, sales_chg_pct: 1, estimate: false }] },
  thread: [{ id: 't1', q: 'what is a fixture question', answer: 'A fixture answer.', citations: [], related: [] }],
}))
vi.mock('../../../pages/journal-2-0/lib/sendToJournal', () => ({
  sendCaptureToJournal: async (kind, capture, opts) => { data.sent.push({ kind, capture, opts }); return `Sent to ${opts?.target === 'inbox' ? 'your Notebook inbox' : 'your note'}` },
}))
vi.mock('../../../hooks/usePreferences', () => ({ default: () => ({ prefs: {}, setPref: () => {}, loading: false }), parsePref: (raw, fallback) => { try { return raw == null ? fallback : JSON.parse(raw) } catch { return fallback } } }))
vi.mock('../../../hooks/usePlacedTheme', () => ({ default: () => null }))
vi.mock('../../../hooks/useTickerMeta', () => ({ default: () => ({ name: 'Fixture Co' }) }))
vi.mock('../../../hooks/useNewsCatalysts', () => ({ default: (sym) => ({ status: 'ready', events: sym ? data.events : [] }) }))
vi.mock('../../../hooks/useEarningsTable', () => ({ default: (sym) => ({ data: sym ? data.table : null }) }))
vi.mock('../../../hooks/useFundamentalSnapshot', () => ({ default: () => ({ data: null }) }))
vi.mock('../../../hooks/useLivePrices', () => ({ default: () => ({ prices: {}, isLoading: false }) }))
vi.mock('../../../hooks/useRealtimePrices', () => ({ default: () => ({ prices: {}, isLoading: false, isStreaming: false, staleSymbols: new Set() }) }))
const byKey = (key) => {
  const k = String(key || '')
  if (k.startsWith('/api/watchlist-alerts')) return data.alerts
  if (k === '/api/breadth') return { ...data.breadth, _fetchedAt: Date.parse('2026-11-02T15:00:00Z') }
  return null
}
vi.mock('swr', async (orig) => ({ ...(await orig()), default: (key) => ({ data: byKey(key), isLoading: false, mutate: () => {} }) }))
vi.mock('../../../hooks/useMobileSWR', () => ({ default: (key) => ({ data: byKey(key), error: null, isLoading: false, isValidating: false, mutate: () => {} }) }))

const C = {
  alerts: (await import('../../../pages/charts/widgets/AlertsWidget')).default,
  news: (await import('../../../pages/charts/widgets/NewsWidget')).default,
  marketcontext: (await import('../../../pages/charts/widgets/MarketContextWidget')).default,
  aisearch: (await import('../../../pages/charts/widgets/AiSearchWidget')).default,
  fundamentals: (await import('../../../pages/charts/widgets/FundamentalsWidget')).default,
}
// the props WidgetHost gives each type on /charts (WORKSPACE_WIDGETS); AI Search's thread is the fixture seed (see the header)
const PROPS = {
  alerts: (w, onOpts) => ({ color: w.color, opts: w.opts, onOptsChange: onOpts }),
  news: (w, onOpts) => ({ color: w.color, opts: w.opts, onOptsChange: onOpts }),
  fundamentals: (w, onOpts) => ({ color: w.color, opts: w.opts, onOptsChange: onOpts }),
  marketcontext: () => ({}),
  aisearch: (w) => ({ color: w.color, initialThread: w.seedThread || null }),
}
await outcomeSuite()

function Live({ board }) {
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick(n => n + 1), 10); return () => clearInterval(t) }, [])
  const onOpts = (id) => (opts) => { board.state.widgets = board.state.widgets.map(x => (x.id === id ? { ...x, opts } : x)) }
  const ws = { groupSyms: { N: 'AAA' }, setGroupSym: () => {}, groupTfs: {}, activeWatchlistRef: { current: null }, aiSearchBus: null }
  return (
    <MemoryRouter>
      <AuthContext.Provider value={{ user: { id: 1, role: 'admin' } }}>
        <WorkspaceContext.Provider value={ws}>
          {board.state.widgets.filter(w => C[w.type]).map(w => {
            const W = C[w.type]
            return <div key={w.id} data-testid={`w-${w.id}`}><WidgetDoorContext.Provider value={w.id}><W {...PROPS[w.type](w, onOpts(w.id))} /></WidgetDoorContext.Provider></div>
          })}
        </WorkspaceContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>
  )
}
const wgt = (id, type, extra = {}) => ({ id, type, x: 12, y: 0, w: 12, h: 20, color: 'N', opts: {}, ...extra })
function board(widgets) {
  data.sent = []
  const m = open([chart('c1', 0, 0, 12, 20), ...widgets], { 'N:c1': 'AAA' })
  render(<Live board={m.board} />)
  return m
}
const idOf = (c, type) => must((c.board?.[0]?.widgets || []).find(w => w.type === type), `a ${type} widget`).id
const send = (type, where) => (c) => [{ action: 'widget.sendToJournal', target: must(c.board?.[0]?.ref, 'board'), args: { widget: idOf(c, type), where } }]
const boardOf = (m) => JSON.stringify(m.board.state.widgets)

afterEach(() => { afterEachOutcome(); cleanup() })

describe('Send to Journal over the real widgets\' own capture doors (C3-132, C3-137, C3-186, C3-200, C3-180)', () => {
  it.each([
    ['C3-132', 'alerts', 'drop my alerts into the journal', 'note', 'alerts'],
    ['C3-137', 'news', 'put the news and catalysts feed in a fresh journal note', 'newNote', 'news'],
    ['C3-186', 'marketcontext', 'save the market context panel to my notebook inbox', 'inbox', 'marketcontext'],
    ['C3-200', 'aisearch', 'journal this ai search conversation', 'note', 'aisearch'],
    ['C3-180', 'fundamentals', 'send the fundamentals table to a new journal note', 'newNote', 'fundamentals'],
  ])('%s "%s": shown first; on Apply the Journal receives exactly that widget\'s capture, where it was asked; the board is untouched', async (_row, type, text, where, kind) => {
    // one other widget beside it (its own capture door too): the send must pick THIS one, and leave that one alone
    const m = board([wgt('x', type, type === 'aisearch' ? { seedThread: data.thread } : {}), wgt('other', type === 'alerts' ? 'marketcontext' : 'alerts', { x: 0, y: 20 })])
    await waitFor(() => expect(mountedWidgetDoor('x')?.capture?.()).toBeTruthy())
    const want = mountedWidgetDoor('x').capture()
    expect(want.kind).toBe(kind)
    const before = boardOf(m)
    await m.say(text, send(type, where))
    expect(proposalsNow()).toHaveLength(1)
    expect(data.sent).toEqual([])                       // nothing reaches the Journal before Apply
    await m.apply()
    await waitFor(() => expect(data.sent).toHaveLength(1))
    expect(data.sent[0]).toMatchObject({ kind, opts: { target: where } })
    expect(data.sent[0].capture).toEqual(want.capture)
    expect(boardOf(m)).toBe(before)                     // a send changes no widget, the other one included
  }, 60000)

  it('NEGATIVE: Dismiss sends nothing', async () => {
    const m = board([wgt('x', 'marketcontext')])
    await waitFor(() => expect(mountedWidgetDoor('x')?.capture?.()).toBeTruthy())
    await m.say('send the market context to my journal', send('marketcontext', 'note'))
    await m.dismiss()
    expect(data.sent).toEqual([])
  }, 60000)

  it('NEGATIVE: an AI Search widget with no conversation offers no capture; the send is refused and the Journal receives nothing', async () => {
    const m = board([wgt('x', 'aisearch')])
    await waitFor(() => expect(mountedWidgetDoor('x')).toBeTruthy())
    expect(mountedWidgetDoor('x').capture()).toBe(null)
    await m.say('journal this ai search conversation', send('aisearch', 'note'))
    expect(proposalsNow()).toHaveLength(0)
    expect(refusals().length).toBeGreaterThan(0)
    expect(data.sent).toEqual([])
  }, 60000)
})
