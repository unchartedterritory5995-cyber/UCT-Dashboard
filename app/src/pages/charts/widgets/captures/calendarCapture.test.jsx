// Notebook widgets Task 16: `/calendar` inserts the SAME frozen node the /charts calendar's
// "Send to Journal" builds, through the Task 8 snapshot insert path, only when wave 4 is on.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { Editor } from '@tiptap/core'
import { WorkspaceContext } from '../../WorkspaceContext'
import CalendarWidget from '../CalendarWidget'
import { snapshotWidgetItems } from '../../../journal-2-0/components/notebook/SlashMenu'
import { buildExtensions } from '../../../journal-2-0/lib/tiptap'
import { latchNotebookFlags, __resetNotebookFlags } from '../../../journal-2-0/lib/offline/notebookFlags'

if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
}

// The member's preferences: a NON-default theme, so a capture that ignored the theme would differ.
const PREFS = { theme: 'light' }
vi.mock('../../../../hooks/usePreferences', async (importOriginal) => ({
  ...(await importOriginal()),
  default: () => ({ prefs: { theme: 'light' }, setPref: vi.fn() }),
}))
vi.mock('../../../../hooks/useTickerMeta', () => ({ default: () => ({ name: null }) }))
vi.mock('../../../../components/CompanyLogo', () => ({ default: () => <span /> }))
vi.mock('../../../../components/ui/UIcon', () => ({ default: ({ name }) => <span data-icon={name} /> }))
vi.mock('../NewsSettingsPanel', () => ({ default: () => <div /> }))

// The Send to Journal door runs for real down to the destination, which records the attrs it was handed.
const sent = []
vi.mock('../../../journal-2-0/lib/captureTargets', async (importOriginal) => ({
  ...(await importOriginal()),
  CAPTURE_TARGETS: { note: { run: async (attrs) => { sent.push(attrs); return 'Saved' } } },
}))

const W4 = { notebook_widgets_w4_enabled: true }
// The one fetch answer both doors read. Any other URL answers 404, so an unexpected read cannot pass.
const answer = (url) => {
  const u = String(url)
  if (u.startsWith('/api/calendar?week=')) return { ok: true, status: 200, json: async () => ({ days: {} }) }
  if (u.startsWith('/api/auth/preferences')) return { ok: true, status: 200, json: async () => PREFS }
  if (u.startsWith('/api/calendar/')) return { ok: true, status: 200, json: async () => ({}) }
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
beforeEach(() => {
  sent.length = 0
  global.fetch = vi.fn(async (url) => answer(url))
  // A SATURDAY in ET: a fresh widget opens on Friday's session, so a capture that used the raw date differs.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-08-08T16:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
  global.fetch = realFetch
  __resetNotebookFlags()
  editor?.destroy(); editor = null
})

describe('/calendar (Task 16)', () => {
  it('inserted_node_equals_send_to_journal_node', async () => {
    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <WorkspaceContext.Provider value={{ groupSyms: {}, setGroupSym: vi.fn() }}>
          <CalendarWidget color="A" opts={{}} onOptsChange={vi.fn()} />
        </WorkspaceContext.Provider>
      </SWRConfig>,
    )
    fireEvent.click(screen.getByTitle('Send this day to Journal'))
    await waitFor(() => expect(sent).toHaveLength(1))

    latchNotebookFlags(W4)
    const item = snapshotWidgetItems('calendar').find((i) => i.title === 'UCT Terminal day')
    const ed = mount('<p>/calendar</p>')
    const res = await item.command({ editor: ed, range: slashRange(ed) })
    expect(res.ok).toBe(true)
    const [node] = embeds(ed)
    // The door's attrs as the SAME node type holds them (the schema adds its own defaults to both).
    const doorNode = ed.schema.nodes.widgetEmbed.create(sent[0])
    expect(strip(node.attrs)).toEqual(strip(doorNode.attrs))
    // Non-vacuity: the two match on the day the widget opened on and the member's theme, not on emptiness.
    expect(node.attrs.params.date).toBe('2026-08-07')
    expect(node.attrs.params.settings).toEqual(sent[0].params.settings)
    expect(node.attrs.params.settings).toBeTruthy()
  })

  it('a date token inserts that day; a token that is not a date offers nothing', () => {
    latchNotebookFlags(W4)
    expect(snapshotWidgetItems('calendar 3/13').map((i) => i.title)).toEqual(['UCT Terminal day — Mar 13, 2026'])
    expect(snapshotWidgetItems('calendar 3-13')).toEqual([])
    expect(snapshotWidgetItems('calendar 3/13 NVDA')).toEqual([])
  })

  it('W4 off: the item is absent', () => {
    expect(snapshotWidgetItems('calendar')).toEqual([])
    expect(snapshotWidgetItems('calendar 3/13')).toEqual([])
    expect(snapshotWidgetItems('').some((i) => i.title === 'UCT Terminal day')).toBe(false)
    // Control: the same queries answer once wave 4 is on, and the item sits under More.
    latchNotebookFlags(W4)
    const bare = snapshotWidgetItems('').find((i) => i.title === 'UCT Terminal day')
    expect(bare.group).toBe('more')
    expect(snapshotWidgetItems('calendar').map((i) => i.title)).toContain('UCT Terminal day')
  })

  it('prose after the command offers nothing', () => {
    latchNotebookFlags(W4)
    expect(snapshotWidgetItems('calendar looks busy today')).toEqual([])
    expect(snapshotWidgetItems('calendar is busy')).toEqual([])
    expect(snapshotWidgetItems('cal 3/13')).toEqual([])        // prefix + args never matches
  })

  it('a failed fetch inserts nothing', async () => {
    latchNotebookFlags(W4)
    global.fetch = vi.fn(async (url) => (String(url).startsWith('/api/calendar?week=')
      ? { ok: false, status: 500, json: async () => ({}) } : answer(url)))
    const ed = mount('<p>Prep /calendar</p>')
    const notify = vi.fn()
    ed.storage.uctJournalWidgets = { ...(ed.storage.uctJournalWidgets || {}), notify }
    const item = snapshotWidgetItems('calendar').find((i) => i.title === 'UCT Terminal day')
    const res = await item.command({ editor: ed, range: slashRange(ed) })
    expect(res.ok).toBe(false)
    expect(embeds(ed)).toHaveLength(0)
    expect(ed.state.doc.textContent).toBe('Prep ')
    expect(notify).toHaveBeenCalledWith('UCT Terminal day could not be loaded just now, so nothing was added.', 'error')
  })
})
