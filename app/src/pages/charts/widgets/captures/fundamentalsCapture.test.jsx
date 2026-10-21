// Notebook widgets Task 16: `/fundamentals NVDA` inserts the SAME frozen node the /charts Fundamentals
// widget's "Send to Journal" builds, through the Task 8 snapshot insert path, only when wave 4 is on.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { WorkspaceContext } from '../../WorkspaceContext'
import FundamentalsWidget from '../FundamentalsWidget'
import { snapshotWidgetItems } from '../../../journal-2-0/components/notebook/SlashMenu'
import { buildExtensions } from '../../../journal-2-0/lib/tiptap'
import { latchNotebookFlags, __resetNotebookFlags } from '../../../journal-2-0/lib/offline/notebookFlags'

if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
}

// The fetch answers both doors read. Two tables: one with quarters (the default view holds) and one
// with annual rows only (the widget falls to the annual view, and the capture must say so).
const FULL = {
  ticker: 'NVDA',
  annual: [{ year: 2025, eps: 2.94, eps_chg_pct: 130, sales: 1.3e11, sales_chg_pct: 114, estimate: false }],
  quarterly: [
    { label: '2026 Q2', eps_actual: 1.05, eps_estimate: 1.01, eps_surprise_pct: 4, rev_actual: 4.67e10, rev_estimate: 4.6e10, rev_surprise_pct: 1.5, reported: true },
    { label: '2026 Q3', report_date: '2026-11-19', eps_estimate: 1.25, rev_estimate: 5.4e10, reported: false },
  ],
}
const ANNUAL_ONLY = { ticker: 'NVDA', annual: FULL.annual, quarterly: [] }
const COMPANY = 'NVIDIA Corporation'
// A SAVED fundamentals look for the member's theme, so a capture that ignored the pref would differ.
const PREFS = { theme: 'light', fundamentals_settings: JSON.stringify({ _appTheme: 'light', bg: '#123456' }) }
let table = FULL
vi.mock('../../../../hooks/useEarningsTable', () => ({ default: () => ({ data: table }) }))
vi.mock('../../../../hooks/useFundamentalSnapshot', () => ({ default: () => ({ data: { name: COMPANY } }) }))
vi.mock('../../../../hooks/usePreferences', async (importOriginal) => ({
  ...(await importOriginal()),
  default: () => ({ prefs: PREFS, setPref: vi.fn() }),
}))
vi.mock('../../../../components/fundamentals/AnalystPanel', () => ({ default: () => <div /> }))
vi.mock('../../../../components/fundamentals/OwnershipPanel', () => ({ default: () => <div /> }))
vi.mock('../FundamentalsSettingsPanel', () => ({ default: () => <div /> }))
vi.mock('../../../../components/ui/UIcon', () => ({ default: ({ name }) => <span data-icon={name} /> }))

const sent = []
vi.mock('../../../journal-2-0/lib/captureTargets', async (importOriginal) => ({
  ...(await importOriginal()),
  CAPTURE_TARGETS: { note: { run: async (attrs) => { sent.push(attrs); return 'Saved' } } },
}))

const W4 = { notebook_widgets_w4_enabled: true }
const ok = (body) => ({ ok: true, status: 200, json: async () => body })
const answer = (url) => {
  const u = String(url)
  if (u === '/api/fundamentals/earnings-table?sym=NVDA') return ok(table)
  if (u === '/api/research/snapshot/NVDA') return ok({ name: COMPANY })
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
beforeEach(() => { sent.length = 0; table = FULL; global.fetch = vi.fn(async (url) => answer(url)) })
afterEach(() => { global.fetch = realFetch; __resetNotebookFlags(); editor?.destroy(); editor = null })

describe('/fundamentals (Task 16)', () => {
  it('inserted_node_equals_send_to_journal_node', async () => {
    latchNotebookFlags(W4)
    for (const [fixture, view] of [[FULL, 'quarterly'], [ANNUAL_ONLY, 'annual']]) {
      table = fixture
      sent.length = 0
      render(
        <WorkspaceContext.Provider value={{ groupSyms: { A: 'NVDA' }, setGroupSym: vi.fn() }}>
          <FundamentalsWidget color="A" opts={{}} onOptsChange={vi.fn()} />
        </WorkspaceContext.Provider>,
      )
      fireEvent.click(screen.getByTitle('Send these financials to Journal'))
      await waitFor(() => expect(sent).toHaveLength(1))
      cleanup()

      const [item] = snapshotWidgetItems('fundamentals NVDA')
      expect(item.title).toBe('Fundamentals — NVDA')
      const ed = mount('<p>/fundamentals NVDA</p>')
      const res = await item.command({ editor: ed, range: slashRange(ed) })
      expect(res.ok).toBe(true)
      const [node] = embeds(ed)
      const doorNode = ed.schema.nodes.widgetEmbed.create(sent[0])
      expect(strip(node.attrs)).toEqual(strip(doorNode.attrs))
      // Non-vacuity: they agree on the effective view, the table, the company and the SAVED look.
      expect(node.attrs.params.view).toBe(view)
      expect(node.attrs.params.data.annual).toHaveLength(1)
      expect(node.attrs.params.company).toBe(COMPANY)
      expect(node.attrs.params.settings.bg).toBe('#123456')
      editor.destroy(); editor = null
    }
  })

  it('a bare /fund completes to /fundamentals', () => {
    latchNotebookFlags(W4)
    const [bare] = snapshotWidgetItems('fund').filter((i) => i.cmd === 'fundamentals')
    expect(bare.description).toBe('Type a symbol — e.g. /fundamentals NVDA')
    const ed = mount('<p>/fund</p>')
    bare.command({ editor: ed, range: slashRange(ed) })
    expect(ed.state.doc.textContent).toBe('/fundamentals ')
  })

  it('W4 off: the items are absent', () => {
    expect(snapshotWidgetItems('fundamentals NVDA')).toEqual([])
    expect(snapshotWidgetItems('fundamentals')).toEqual([])
    expect(snapshotWidgetItems('').some((i) => i.cmd === 'fundamentals')).toBe(false)
    latchNotebookFlags(W4)
    expect(snapshotWidgetItems('').find((i) => i.cmd === 'fundamentals').group).toBe('more')
  })

  it('prose after the command offers nothing', () => {
    latchNotebookFlags(W4)
    expect(snapshotWidgetItems('fundamentals look strong')).toEqual([])
    expect(snapshotWidgetItems('fundamentals 42')).toEqual([])
    expect(snapshotWidgetItems('fund NVDA')).toEqual([])   // prefix + args never matches
  })

  it('a failed fetch inserts nothing (a paid-gated or empty table is a failure too)', async () => {
    latchNotebookFlags(W4)
    const cases = [
      { ok: false, status: 500, json: async () => ({}) },
      { ok: false, status: 402, json: async () => ({}) },
      ok({ paywalled: true }),
      ok({ ticker: 'NVDA', annual: [], quarterly: [] }),
    ]
    for (const tbl of cases) {
      global.fetch = vi.fn(async (url) => (String(url).startsWith('/api/fundamentals/') ? tbl : answer(url)))
      const ed = mount('<p>See /fundamentals NVDA</p>')
      const notify = vi.fn()
      ed.storage.uctJournalWidgets = { ...(ed.storage.uctJournalWidgets || {}), notify }
      const res = await snapshotWidgetItems('fundamentals NVDA')[0].command({ editor: ed, range: slashRange(ed) })
      expect(res.ok).toBe(false)
      expect(embeds(ed)).toHaveLength(0)
      expect(ed.state.doc.textContent).toBe('See ')
      expect(notify).toHaveBeenCalledWith('Fundamentals could not be loaded just now, so nothing was added.', 'error')
      editor.destroy(); editor = null
    }
  })
})
