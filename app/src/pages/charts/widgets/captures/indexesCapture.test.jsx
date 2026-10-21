// Notebook widgets Task 16: `/indexes` inserts the SAME frozen node the /charts Indexes widget's
// "Send to Journal" builds, through the Task 8 snapshot insert path, only when wave 4 is on AND Wave R's
// capture release switch is on (R39: a wave-4 flag must not release what Wave R holds dark).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { Editor } from '@tiptap/core'
import IndexesWidget from '../IndexesWidget'
import { snapshotWidgetItems } from '../../../journal-2-0/components/notebook/SlashMenu'
import { buildExtensions } from '../../../journal-2-0/lib/tiptap'
import { latchNotebookFlags, __resetNotebookFlags } from '../../../journal-2-0/lib/offline/notebookFlags'
import { CAPTURE_FLAG_KEY, captureEnabled } from '../../../../widgets/captureRelease'

if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
}

vi.mock('../../../../components/ui/UIcon', () => ({ default: ({ name }) => <span data-icon={name} /> }))
const sent = []
vi.mock('../../../journal-2-0/lib/captureTargets', async (importOriginal) => ({
  ...(await importOriginal()),
  CAPTURE_TARGETS: { note: { run: async (attrs) => { sent.push(attrs); return 'Saved' } } },
}))

const W4 = { notebook_widgets_w4_enabled: true }
const SNAPSHOT = {
  etfs: {
    SPY: { price: '645.12', chg: '+0.43%' }, QQQ: { price: '583.20', chg: '-0.12%' },
    DIA: { price: '451.08', chg: '+0.21%' }, IWM: { price: '238.44', chg: '-0.87%' }, VIX: { price: '15.20', chg: '-2.10%' },
  },
  futures: { BTC: { price: '96,401.00', chg: '+1.55%' } },
}
const ok = (body) => ({ ok: true, status: 200, json: async () => body })
const answer = (url) => (String(url) === '/api/snapshot' ? ok(SNAPSHOT) : { ok: false, status: 404, json: async () => ({}) })
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
const item = () => snapshotWidgetItems('indexes').find((i) => i.title === 'Index levels')

const realFetch = globalThis.fetch
beforeEach(() => {
  sent.length = 0
  localStorage.setItem(CAPTURE_FLAG_KEY, '1')
  globalThis.fetch = vi.fn(async (url) => answer(url))
  // 2026-09-10 17:26 UTC = 1:26 PM ET: both doors stamp the landing instant from this clock.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(Date.UTC(2026, 8, 10, 17, 26)))
})
afterEach(() => {
  vi.useRealTimers()
  localStorage.removeItem(CAPTURE_FLAG_KEY)
  globalThis.fetch = realFetch
  __resetNotebookFlags()
  editor?.destroy(); editor = null
})

describe('/indexes (Task 16)', () => {
  it('inserted_node_equals_send_to_journal_node', async () => {
    render(<SWRConfig value={{ provider: () => new Map() }}><IndexesWidget opts={{}} onOptsChange={vi.fn()} /></SWRConfig>)
    fireEvent.click(await screen.findByTitle('Send these index levels to Journal'))
    await waitFor(() => expect(sent).toHaveLength(1))

    latchNotebookFlags(W4)
    const ed = mount('<p>/indexes</p>')
    const res = await item().command({ editor: ed, range: slashRange(ed) })
    expect(res.ok).toBe(true)
    const [node] = embeds(ed)
    expect(strip(node.attrs)).toEqual(strip(ed.schema.nodes.widgetEmbed.create(sent[0]).attrs))
    // Non-vacuity: all six readings and the landing stamp, not two empty captures.
    expect(node.attrs.params.rows.map((r) => r.sym)).toEqual(['SPY', 'QQQ', 'DIA', 'IWM', 'BTC', 'VIX'])
    expect(node.attrs.params.updated).toBe('1:26 PM ET')
  })

  it('W4 off: the item is absent', () => {
    expect(snapshotWidgetItems('indexes')).toEqual([])
    latchNotebookFlags(W4)                                        // control
    expect(snapshotWidgetItems('').find((i) => i.title === 'Index levels').group).toBe('more')
  })

  it('held dark by Wave R: absent when captureEnabled() is false, even with W4 on', () => {
    latchNotebookFlags(W4)
    localStorage.setItem(CAPTURE_FLAG_KEY, '0')
    expect(captureEnabled()).toBe(false)
    expect(snapshotWidgetItems('indexes')).toEqual([])
    expect(snapshotWidgetItems('').some((i) => i.title === 'Index levels')).toBe(false)
    localStorage.removeItem(CAPTURE_FLAG_KEY)                     // the shipped default is dark too
    expect(snapshotWidgetItems('indexes')).toEqual([])
    localStorage.setItem(CAPTURE_FLAG_KEY, '1')                   // control: the switch releases it
    expect(item()).toBeTruthy()
  })

  it('prose after the command offers nothing', () => {
    latchNotebookFlags(W4)
    expect(snapshotWidgetItems('indexes are up today')).toEqual([])
    expect(snapshotWidgetItems('index levels look high')).toEqual([])
  })

  it('a failed fetch inserts nothing', async () => {
    latchNotebookFlags(W4)
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }))
    const ed = mount('<p>Open /indexes</p>')
    const notify = vi.fn()
    ed.storage.uctJournalWidgets = { ...(ed.storage.uctJournalWidgets || {}), notify }
    const res = await item().command({ editor: ed, range: slashRange(ed) })
    expect(res.ok).toBe(false)
    expect(embeds(ed)).toHaveLength(0)
    expect(ed.state.doc.textContent).toBe('Open ')
    expect(notify).toHaveBeenCalledWith('Index levels could not be loaded just now, so nothing was added.', 'error')
  })
})
