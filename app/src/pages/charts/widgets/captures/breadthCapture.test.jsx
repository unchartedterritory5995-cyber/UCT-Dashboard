// Notebook widgets Task 16: `/breadth` inserts the SAME frozen node the /charts Breadth widget's
// "Send to Journal" builds, through the Task 8 snapshot insert path, only when wave 4 is on.
// `fetch` is the only seam: the widget's own SWR reads (history + the live intraday row) and the slash
// insert's reads answer from the same table.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SWRConfig } from 'swr'
import { Editor } from '@tiptap/core'
import BreadthWidget from '../BreadthWidget'
import { snapshotWidgetItems } from '../../../journal-2-0/components/notebook/SlashMenu'
import { buildExtensions } from '../../../journal-2-0/lib/tiptap'
import { latchNotebookFlags, __resetNotebookFlags } from '../../../journal-2-0/lib/offline/notebookFlags'

if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
}

// A SAVED breadth look for the member's (non-default) theme, so a capture that ignored the pref differs.
const PREFS = { theme: 'light', breadth_widget_settings: JSON.stringify({ _appTheme: 'light', bg: '#123456', tileStyle: 'spark' }) }
vi.mock('../../../../hooks/usePreferences', async (importOriginal) => ({
  ...(await importOriginal()),
  default: () => ({ prefs: PREFS, setPref: vi.fn() }),
}))
vi.mock('../../../../components/ui/UIcon', () => ({ default: ({ name }) => <span data-icon={name} /> }))

const sent = []
vi.mock('../../../journal-2-0/lib/captureTargets', async (importOriginal) => ({
  ...(await importOriginal()),
  CAPTURE_TARGETS: { note: { run: async (attrs) => { sent.push(attrs); return 'Saved' } } },
}))

const W4 = { notebook_widgets_w4_enabled: true }
const day = (date, score, extra = {}) => ({
  date, breadth_score: score, up_4pct_today: 100 + score, down_4pct_today: 40, pct_above_50sma: 50 + score / 10, ...extra,
})
// The weekly sentiment key is absent on the newest row and present on an older one: the forward-fill is live.
const HISTORY = { rows: [day('2026-08-06', 70), day('2026-08-05', 66, { aaii_spread: 6.5 }), day('2026-08-04', 61)] }
const LIVE = {
  ok: true, superseded: false, degraded: false, market_open: true, as_of: '2026-08-07T18:47:00Z',
  row: { date: '2026-08-07', breadth_score: 74, up_4pct_today: 190, pct_above_50sma: 58 },
  path: { breadth_score: [[1, 71], [2, 73], [3, 74]] },
}
let live = LIVE
const ok = (body) => ({ ok: true, status: 200, json: async () => body })
const answer = (url) => {
  const u = String(url)
  if (u === '/api/breadth-monitor?days=90') return ok(HISTORY)
  if (u === '/api/breadth-monitor/live') return ok(live)
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
const item = () => snapshotWidgetItems('breadth').find((i) => i.title === 'Breadth heatmap')

const realFetch = globalThis.fetch
beforeEach(() => { sent.length = 0; live = LIVE; globalThis.fetch = vi.fn(async (url) => answer(url)) })
afterEach(() => { globalThis.fetch = realFetch; __resetNotebookFlags(); editor?.destroy(); editor = null })

describe('/breadth (Task 16)', () => {
  it('inserted_node_equals_send_to_journal_node', async () => {
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <MemoryRouter><BreadthWidget opts={{}} onOptsChange={vi.fn()} /></MemoryRouter>
      </SWRConfig>,
    )
    // The live row has landed once the footer carries its intraday clock.
    await screen.findByText(/Updated 2:47 PM ET/)
    fireEvent.click(screen.getByTitle('Send this snapshot to Journal'))
    await waitFor(() => expect(sent).toHaveLength(1))

    latchNotebookFlags(W4)
    const ed = mount('<p>/breadth</p>')
    const res = await item().command({ editor: ed, range: slashRange(ed) })
    expect(res.ok).toBe(true)
    const [node] = embeds(ed)
    const doorNode = ed.schema.nodes.widgetEmbed.create(sent[0])
    expect(strip(node.attrs)).toEqual(strip(doorNode.attrs))
    // Non-vacuity: they match on the LIVE row, its intraday path, the forward-fill and the saved look.
    const p = node.attrs.params
    expect(p.row.breadth_score).toBe(74)
    expect(p.row.aaii_spread).toBe(6.5)
    expect(p.series.breadth_score).toEqual([71, 73, 74])
    expect(p.updated).toBe('2:47 PM ET')
    expect(p.tileStyle).toBe('spark')
    expect(p.settings.bg).toBe('#123456')
  })

  it('W4 off: the item is absent', () => {
    expect(snapshotWidgetItems('breadth')).toEqual([])
    expect(snapshotWidgetItems('').some((i) => i.title === 'Breadth heatmap')).toBe(false)
    latchNotebookFlags(W4)                                        // control
    expect(snapshotWidgetItems('').find((i) => i.title === 'Breadth heatmap').group).toBe('more')
    expect(item()).toBeTruthy()
  })

  it('prose after the command offers nothing', () => {
    latchNotebookFlags(W4)
    expect(snapshotWidgetItems('breadth looks weak today')).toEqual([])
    expect(snapshotWidgetItems('breadth is narrow').some((i) => i.title === 'Breadth heatmap')).toBe(false)
  })

  it('a failed fetch inserts nothing', async () => {
    latchNotebookFlags(W4)
    globalThis.fetch = vi.fn(async (url) => (String(url).startsWith('/api/breadth-monitor?days=')
      ? { ok: false, status: 500, json: async () => ({}) } : answer(url)))
    const ed = mount('<p>Prep /breadth</p>')
    const notify = vi.fn()
    ed.storage.uctJournalWidgets = { ...(ed.storage.uctJournalWidgets || {}), notify }
    const res = await item().command({ editor: ed, range: slashRange(ed) })
    expect(res.ok).toBe(false)
    expect(embeds(ed)).toHaveLength(0)
    expect(ed.state.doc.textContent).toBe('Prep ')
    expect(notify).toHaveBeenCalledWith('Breadth heatmap could not be loaded just now, so nothing was added.', 'error')
  })

  it('a superseded live read leaves the stored history standing, as the widget does', async () => {
    latchNotebookFlags(W4)
    live = { ...LIVE, superseded: true }
    const ed = mount('<p>/breadth</p>')
    const res = await item().command({ editor: ed, range: slashRange(ed) })
    expect(res.ok).toBe(true)
    const p = embeds(ed)[0].attrs.params
    expect(p.row.date).toBe('2026-08-06')
    expect(p.row._live).toBeUndefined()
  })
})
