// Notebook widgets Task 16: `/alerts` inserts the SAME frozen node the /charts Alerts widget's
// "Send to Journal" builds, through the Task 8 snapshot insert path, only when wave 4 is on.
// The list is the member's own (registry vendor row "private"): public pages show the neutral line.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { Editor } from '@tiptap/core'
import { WorkspaceContext } from '../../WorkspaceContext'
import AlertsWidget from '../AlertsWidget'
import { snapshotWidgetItems } from '../../../journal-2-0/components/notebook/SlashMenu'
import { buildExtensions } from '../../../journal-2-0/lib/tiptap'
import { latchNotebookFlags, __resetNotebookFlags } from '../../../journal-2-0/lib/offline/notebookFlags'

if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
}

const PREFS = { theme: 'light' }
vi.mock('../../../../hooks/usePreferences', async (importOriginal) => ({
  ...(await importOriginal()),
  default: () => ({ prefs: PREFS, setPref: vi.fn() }),
}))
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
// The widget's quotes come from the shared live-price store; the slash insert reads /api/live-prices. Both
// see the same quotes: one with a real price, one degraded (no price), one symbol with no quote at all.
const PRICES = { NVDA: { price: 181.25, change_pct: 1.2 }, AMD: { price: 0, change_pct: 0 } }
vi.mock('../../../../hooks/useLivePrices', () => ({ default: () => ({ prices: { NVDA: PRICES.NVDA } }) }))
vi.mock('../NewsSettingsPanel', () => ({ default: () => <div /> }))
vi.mock('../../../../components/ui/UIcon', () => ({ default: ({ name }) => <span data-icon={name} /> }))

const sent = []
vi.mock('../../../journal-2-0/lib/captureTargets', async (importOriginal) => ({
  ...(await importOriginal()),
  CAPTURE_TARGETS: { note: { run: async (attrs) => { sent.push(attrs); return 'Saved' } } },
}))

const W4 = { notebook_widgets_w4_enabled: true }
const NOW_S = Date.UTC(2026, 8, 10, 17, 26) / 1000
const ALERTS = [
  { id: 1, sym: 'NVDA', target_price: 190, direction: 'above', alert_type: 'price', is_active: 1, created_at: '2026-09-01T12:00:00Z' },
  // A trendline: its level is read off the clock at capture, so both doors must read the same instant.
  { id: 2, sym: 'amd', direction: 'below', alert_type: 'trendline', is_active: 1,
    anchor_t1: NOW_S - 86400 * 10, anchor_p1: 150, anchor_t2: NOW_S - 86400, anchor_p2: 160 },
  { id: 3, sym: 'TSLA', target_price: 300, direction: 'above', is_active: 0, triggered_at: '2026-09-08T14:00:00Z' },
]
let alertsBody = ALERTS
const ok = (body) => ({ ok: true, status: 200, json: async () => body })
const answer = (url) => {
  const u = String(url)
  if (u === '/api/watchlist-alerts?active_only=false') return ok(alertsBody)
  if (u.startsWith('/api/live-prices?tickers=')) return ok(PRICES)
  if (u.startsWith('/api/auth/preferences')) return ok(PREFS)
  return { ok: false, status: 404, json: async () => ({}) }
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
const item = () => snapshotWidgetItems('alerts').find((i) => i.title === 'My price alerts')

const realFetch = globalThis.fetch
beforeEach(() => {
  sent.length = 0
  alertsBody = ALERTS
  globalThis.fetch = vi.fn(async (url) => answer(url))
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW_S * 1000))
})
afterEach(() => {
  vi.useRealTimers()
  globalThis.fetch = realFetch
  __resetNotebookFlags()
  editor?.destroy(); editor = null
})

describe('/alerts (Task 16)', () => {
  it('inserted_node_equals_send_to_journal_node', async () => {
    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <WorkspaceContext.Provider value={{ groupSyms: {}, setGroupSym: vi.fn() }}>
          <AlertsWidget color="A" opts={{}} onOptsChange={vi.fn()} />
        </WorkspaceContext.Provider>
      </SWRConfig>,
    )
    fireEvent.click(await screen.findByTitle('Send these alerts to Journal'))
    await waitFor(() => expect(sent).toHaveLength(1))

    latchNotebookFlags(W4)
    const ed = mount('<p>/alerts</p>')
    const res = await item().command({ editor: ed, range: slashRange(ed) })
    expect(res.ok).toBe(true)
    const [node] = embeds(ed)
    expect(strip(node.attrs)).toEqual(strip(ed.schema.nodes.widgetEmbed.create(sent[0]).attrs))
    // Non-vacuity: the live price, the degraded quote read as none, the clock-read trendline level, the look.
    const [nv, amd, tsla] = node.attrs.params.alerts
    expect(nv.priceAtCapture).toBe(181.25)
    expect(amd.priceAtCapture).toBeNull()
    expect(amd.levelAtCapture).toBeCloseTo(160 + 10 / 9, 6)
    expect(tsla.priceAtCapture).toBeNull()
    expect(node.attrs.params.settings).toBeTruthy()
  })

  it('W4 off: the item is absent', () => {
    expect(snapshotWidgetItems('alerts')).toEqual([])
    latchNotebookFlags(W4)                                        // control
    expect(snapshotWidgetItems('').find((i) => i.title === 'My price alerts').group).toBe('more')
  })

  it('prose after the command offers nothing', () => {
    latchNotebookFlags(W4)
    expect(snapshotWidgetItems('alerts fired twice')).toEqual([])
    expect(snapshotWidgetItems('my price alerts are stale')).toEqual([])
  })

  it('a failed fetch inserts nothing', async () => {
    latchNotebookFlags(W4)
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }))
    const ed = mount('<p>Check /alerts</p>')
    const notify = vi.fn()
    ed.storage.uctJournalWidgets = { ...(ed.storage.uctJournalWidgets || {}), notify }
    const res = await item().command({ editor: ed, range: slashRange(ed) })
    expect(res.ok).toBe(false)
    expect(embeds(ed)).toHaveLength(0)
    expect(ed.state.doc.textContent).toBe('Check ')
    expect(notify).toHaveBeenCalledWith('My price alerts could not be loaded just now, so nothing was added.', 'error')
  })

  it('no alerts at all inserts nothing and says so', async () => {
    latchNotebookFlags(W4)
    alertsBody = []
    const ed = mount('<p>/alerts</p>')
    const notify = vi.fn()
    ed.storage.uctJournalWidgets = { ...(ed.storage.uctJournalWidgets || {}), notify }
    const res = await item().command({ editor: ed, range: slashRange(ed) })
    expect(res).toEqual({ ok: false, message: 'You have no price alerts yet, so nothing was added.' })
    expect(embeds(ed)).toHaveLength(0)
  })
})
