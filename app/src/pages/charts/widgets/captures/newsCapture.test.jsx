// Notebook widgets Task 16: `/news NVDA` inserts the SAME frozen node the /charts News widget's
// "Send to Journal" builds, through the Task 8 snapshot insert path, only when wave 4 is on.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { WorkspaceContext } from '../../WorkspaceContext'
import NewsWidget from '../NewsWidget'
import { snapshotWidgetItems } from '../../../journal-2-0/components/notebook/SlashMenu'
import { buildExtensions } from '../../../journal-2-0/lib/tiptap'
import { latchNotebookFlags, __resetNotebookFlags } from '../../../journal-2-0/lib/offline/notebookFlags'

if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
}

// ONE fetch answer, read by both doors: the widget through its hooks, the slash insert through fetch.
const EVENTS = [
  { date: '2026-10-14', type: 'earnings', direction: 'up', title: 'Q3 earnings beat', description: 'EPS 1.20 vs 1.10', move_pct: 8.8, source: 'earnings' },
  { date: '2026-09-02', type: 'catalyst', direction: 'down', title: 'Guidance cut', description: null, move_pct: -6.1, source: '@DeItaone' },
]
const COMPANY = 'NVIDIA Corporation'
const PREFS = { theme: 'light' }
vi.mock('../../../../hooks/useNewsCatalysts', () => ({ default: () => ({ status: 'ready', events: EVENTS }) }))
vi.mock('../../../../hooks/useTickerMeta', () => ({ default: () => ({ name: COMPANY }) }))
vi.mock('../../../../hooks/usePreferences', async (importOriginal) => ({
  ...(await importOriginal()),
  default: () => ({ prefs: { theme: 'light' }, setPref: vi.fn() }),
}))
vi.mock('../NewsSettingsPanel', () => ({ default: () => <div /> }))
vi.mock('../../../../components/ui/UIcon', () => ({ default: ({ name }) => <span data-icon={name} /> }))
vi.mock('../../../../components/CompanyLogo', () => ({ default: () => <span /> }))
vi.mock('../../../../components/chart/drawingsStore', async (importOriginal) => ({
  ...(await importOriginal()), addDrawing: vi.fn(() => 'id-1'),
}))

const sent = []
vi.mock('../../../journal-2-0/lib/captureTargets', async (importOriginal) => ({
  ...(await importOriginal()),
  CAPTURE_TARGETS: { note: { run: async (attrs) => { sent.push(attrs); return 'Saved' } } },
}))

const W4 = { notebook_widgets_w4_enabled: true }
const ok = (body) => ({ ok: true, status: 200, json: async () => body })
const answer = (url) => {
  const u = String(url)
  if (u === '/api/news-catalysts/NVDA') return ok({ status: 'ready', events: EVENTS })
  if (u === '/api/ticker-meta/NVDA') return ok({ name: COMPANY })
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

const realFetch = global.fetch
beforeEach(() => { sent.length = 0; global.fetch = vi.fn(async (url) => answer(url)) })
afterEach(() => { global.fetch = realFetch; __resetNotebookFlags(); editor?.destroy(); editor = null })

describe('/news (Task 16)', () => {
  it('inserted_node_equals_send_to_journal_node', async () => {
    render(
      <WorkspaceContext.Provider value={{ groupSyms: { A: 'NVDA' }, setGroupSym: vi.fn() }}>
        <NewsWidget color="A" opts={{}} onOptsChange={vi.fn()} />
      </WorkspaceContext.Provider>,
    )
    fireEvent.click(screen.getByTitle('Send this feed to Journal'))
    await waitFor(() => expect(sent).toHaveLength(1))

    latchNotebookFlags(W4)
    const [item] = snapshotWidgetItems('news NVDA')
    expect(item.title).toBe('News and catalysts — NVDA')
    const ed = mount('<p>/news NVDA</p>')
    const res = await item.command({ editor: ed, range: slashRange(ed) })
    expect(res.ok).toBe(true)
    expect(global.fetch).toHaveBeenCalledWith('/api/news-catalysts/NVDA', expect.anything())
    const [node] = embeds(ed)
    const doorNode = ed.schema.nodes.widgetEmbed.create(sent[0])
    expect(strip(node.attrs)).toEqual(strip(doorNode.attrs))
    // Non-vacuity: they agree on the feed, the company and the member's theme, not on emptiness.
    expect(node.attrs.params.events).toHaveLength(2)
    expect(node.attrs.params.company).toBe(COMPANY)
    expect(node.attrs.params.settings).toBeTruthy()
  })

  it('a bare /news completes to /news and a valid symbol inserts', () => {
    latchNotebookFlags(W4)
    const [bare] = snapshotWidgetItems('ne').filter((i) => i.cmd === 'news')
    expect(bare.description).toBe('Type a symbol — e.g. /news NVDA')
    const ed = mount('<p>/ne</p>')
    bare.command({ editor: ed, range: slashRange(ed) })
    expect(ed.state.doc.textContent).toBe('/news ')
    expect(snapshotWidgetItems('news $nvda').map((i) => i.title)).toEqual(['News and catalysts — NVDA'])
  })

  it('W4 off: the items are absent', () => {
    expect(snapshotWidgetItems('news NVDA')).toEqual([])
    expect(snapshotWidgetItems('news')).toEqual([])
    expect(snapshotWidgetItems('').some((i) => i.cmd === 'news')).toBe(false)
    latchNotebookFlags(W4)
    expect(snapshotWidgetItems('').find((i) => i.cmd === 'news').group).toBe('more')
  })

  it('prose after the command offers nothing', () => {
    latchNotebookFlags(W4)
    expect(snapshotWidgetItems('news is quiet today')).toEqual([])
    expect(snapshotWidgetItems('news 123')).toEqual([])
    expect(snapshotWidgetItems('new NVDA')).toEqual([])   // prefix + args never matches
  })

  it('a failed fetch inserts nothing (an empty feed is a failure too)', async () => {
    latchNotebookFlags(W4)
    for (const feed of [{ ok: false, status: 500, json: async () => ({}) }, ok({ status: 'generating', events: [] })]) {
      global.fetch = vi.fn(async (url) => (String(url).startsWith('/api/news-catalysts/') ? feed : answer(url)))
      const ed = mount('<p>Read /news NVDA</p>')
      const notify = vi.fn()
      ed.storage.uctJournalWidgets = { ...(ed.storage.uctJournalWidgets || {}), notify }
      const res = await snapshotWidgetItems('news NVDA')[0].command({ editor: ed, range: slashRange(ed) })
      expect(res.ok).toBe(false)
      expect(embeds(ed)).toHaveLength(0)
      expect(ed.state.doc.textContent).toBe('Read ')
      expect(notify).toHaveBeenCalledWith('News and catalysts could not be loaded just now, so nothing was added.', 'error')
      editor.destroy(); editor = null
    }
  })
})
