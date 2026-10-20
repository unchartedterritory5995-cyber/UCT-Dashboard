// Notebook widgets Task 16: `/scanner` inserts the SAME frozen node the Scanner's "Send to Journal" builds
// for the member's default scan (the first preset), through the Task 8 snapshot insert path, only when
// wave 4 is on AND Wave R's capture switch is on (the widget's own door is held dark by it, so a wave-4
// flag must not release the slash door either: R39).
//
// The scan door renders through Watchlists' `scanActions` slot; Watchlists is a stand-in host here for
// the reason ScannerResults.journalDoor.test.jsx records (the real one OOM-kills the worker), and that
// file's source pins cover the slot's wiring. Everything on the capture path is real.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { snapshotWidgetItems } from '../../../journal-2-0/components/notebook/SlashMenu'
import { buildExtensions } from '../../../journal-2-0/lib/tiptap'
import { latchNotebookFlags, __resetNotebookFlags } from '../../../journal-2-0/lib/offline/notebookFlags'
import { CAPTURE_FLAG_KEY } from '../../../../widgets/captureRelease'
import { PRESET_SCANS } from '../ScannerPicker'

if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
}

vi.mock('../../../Watchlists', () => ({ default: ({ scanActions }) => <div>{scanActions}</div> }))
const WORKSPACE = { groupSyms: {}, setGroupSym: () => {}, activeWatchlistRef: { current: null } }
vi.mock('../../WorkspaceContext', () => ({ useWorkspace: () => WORKSPACE }))
vi.mock('../../../../components/ui/UIcon', () => ({ default: ({ name }) => <span data-icon={name} /> }))

const SCAN = { as_of: '2026-09-10T13:26:00-04:00', results: [{ sym: 'AAA' }, { sym: 'BBB' }, { sym: 'CCC' }] }
// The door's quotes ride the shared live-price store; the slash insert reads /api/live-prices. Same quotes
// both ways: a real one, one with no move, and a symbol with no quote at all.
const PRICES = { AAA: { price: 12.5, change_pct: 8.25 }, BBB: { price: 4, change_pct: null } }
vi.mock('../../../../hooks/useMobileSWR', () => ({ default: () => ({ data: SCAN, error: null, mutate: () => {}, isValidating: false }) }))
vi.mock('../../../../hooks/useLivePrices', () => ({ default: () => ({ prices: PRICES }) }))

const sent = []
vi.mock('../../../journal-2-0/lib/captureTargets', async (importOriginal) => ({
  ...(await importOriginal()),
  CAPTURE_TARGETS: { note: { run: async (attrs) => { sent.push(attrs); return 'Saved' } } },
}))

const ScannerResults = (await import('../ScannerResults')).default

const W4 = { notebook_widgets_w4_enabled: true }
const DEFAULT = PRESET_SCANS[0]
let scanBody = SCAN
const ok = (body) => ({ ok: true, status: 200, json: async () => body })
const answer = (url) => {
  const u = String(url)
  if (u === `/api/scans/${DEFAULT.key}`) return ok(scanBody)
  if (u.startsWith('/api/live-prices?tickers=')) return ok(PRICES)
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
const item = () => snapshotWidgetItems('scanner').find((i) => i.title === 'Scan results')

const realFetch = globalThis.fetch
beforeEach(() => {
  sent.length = 0
  scanBody = SCAN
  localStorage.setItem(CAPTURE_FLAG_KEY, '1')
  globalThis.fetch = vi.fn(async (url) => answer(url))
})
afterEach(() => {
  localStorage.removeItem(CAPTURE_FLAG_KEY)
  globalThis.fetch = realFetch
  __resetNotebookFlags()
  editor?.destroy(); editor = null
})

describe('/scanner (Task 16)', () => {
  it('inserted_node_equals_send_to_journal_node', async () => {
    render(<ScannerResults scanKey={DEFAULT.key} scanName={DEFAULT.name} color="A" />)
    fireEvent.click(screen.getByTitle('Send this scan to Journal'))
    await waitFor(() => expect(sent).toHaveLength(1))

    latchNotebookFlags(W4)
    const ed = mount('<p>/scanner</p>')
    const res = await item().command({ editor: ed, range: slashRange(ed) })
    expect(res.ok).toBe(true)
    const [node] = embeds(ed)
    expect(strip(node.attrs)).toEqual(strip(ed.schema.nodes.widgetEmbed.create(sent[0]).attrs))
    // Non-vacuity: the default scan, every symbol in order, quotes as they stood.
    const p = node.attrs.params
    expect(p.scanKey).toBe(DEFAULT.key)
    expect(p.scanName).toBe(DEFAULT.name)
    expect(p.rows.map((r) => r.sym)).toEqual(['AAA', 'BBB', 'CCC'])
    expect(p.rows[0]).toMatchObject({ price: 12.5, chgPct: 8.25 })
    expect(p.rows[2]).toMatchObject({ price: null, chgPct: null })
    // The scan's "1:26 PM ET" is display copy: it never becomes the node's capture instant.
    expect(p.asOf).toBe('1:26 PM ET')
    expect(Number.isNaN(Date.parse(node.attrs.capturedAt))).toBe(false)
  })

  it('W4 off: the item is absent', () => {
    expect(snapshotWidgetItems('scanner')).toEqual([])
    latchNotebookFlags(W4)                                        // control
    expect(snapshotWidgetItems('').find((i) => i.title === 'Scan results').group).toBe('more')
  })

  it('held dark by Wave R like its widget door: absent while captureEnabled() is false', () => {
    latchNotebookFlags(W4)
    localStorage.removeItem(CAPTURE_FLAG_KEY)
    expect(snapshotWidgetItems('scanner')).toEqual([])
    localStorage.setItem(CAPTURE_FLAG_KEY, '1')                   // control
    expect(item()).toBeTruthy()
  })

  it('prose after the command offers nothing', () => {
    latchNotebookFlags(W4)
    expect(snapshotWidgetItems('scanner is empty today')).toEqual([])
    expect(snapshotWidgetItems('scan results look thin')).toEqual([])
  })

  it('a failed fetch inserts nothing', async () => {
    latchNotebookFlags(W4)
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }))
    const ed = mount('<p>Scan /scanner</p>')
    const notify = vi.fn()
    ed.storage.uctJournalWidgets = { ...(ed.storage.uctJournalWidgets || {}), notify }
    const res = await item().command({ editor: ed, range: slashRange(ed) })
    expect(res.ok).toBe(false)
    expect(embeds(ed)).toHaveLength(0)
    expect(ed.state.doc.textContent).toBe('Scan ')
    expect(notify).toHaveBeenCalledWith('Scan results could not be loaded just now, so nothing was added.', 'error')
  })

  it('a scan still being built inserts nothing and says so', async () => {
    latchNotebookFlags(W4)
    scanBody = { status: 'computing', results: [] }
    const ed = mount('<p>/scanner</p>')
    const res = await item().command({ editor: ed, range: slashRange(ed) })
    expect(res).toEqual({ ok: false, message: `${DEFAULT.name} is still being built. Try again in a minute.` })
    expect(embeds(ed)).toHaveLength(0)
  })
})
