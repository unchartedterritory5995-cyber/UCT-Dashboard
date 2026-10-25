// ⛔⛔ The tracker block inside a REAL TipTap editor (wave 9, Task 9.14; global constraint "live state is never written
// into note params"). Opening the note, logging a value, adopting another tab's value and restoring each produce ZERO
// transactions with `docChanged` and ZERO requests to the note routes; "Follow today" is exactly ONE, carrying its
// search text.
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { EditorContent } from '@tiptap/react'
import { buildExtensions } from '../../../lib/tiptap'
import { buildWidgetEmbedAttrs } from '../../../lib/widgetEmbedCore'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
document.elementFromPoint = () => null

/** A fake channel: instances of one name hear each other (never themselves), as in a browser. */
class FakeBC {
  static all = []
  constructor(name) { this.name = name; this.onmessage = null; FakeBC.all.push(this) }
  postMessage(data) { for (const o of FakeBC.all) if (o !== this && o.name === this.name) o.onmessage?.({ data }) }
  addEventListener() {}
  close() {}
}
const realBC = globalThis.BroadcastChannel
beforeAll(() => { globalThis.BroadcastChannel = FakeBC })
afterAll(() => { globalThis.BroadcastChannel = realBC })

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const fmt = (v) => (v == null ? null : `${Math.floor(v / 60)}h${v % 60 ? ` ${v % 60}m` : ''}`)
function serve(over = {}) {
  const st = { values: {}, today: '2026-10-27', archived: false, ...over }
  const calls = []
  const dayOf = (d) => ({ day: d, value: st.values[d] ?? null, text: fmt(st.values[d] ?? null), writable: !st.archived })
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    calls.push({ url: String(url), method })
    if (url === '/api/j2/trackers/days') {
      const { ids, days } = JSON.parse(init.body)
      const out = { trackers: {} }
      if (days.includes('today')) out.resolved = { today: st.today }
      for (const id of ids) {
        const recent = Object.keys(st.values).sort().map((d) => ({ day: d, value: st.values[d] }))
        out.trackers[id] = {
          tracker: { id, name: 'Sleep', kind: 'duration', unit: null, archived: st.archived, readOnly: false, settings: { days: 'any' } },
          days: Object.fromEntries(days.map((d) => { const real = d === 'today' ? st.today : d; return [real, dayOf(real)] })),
          recent, average: null, latest: null, n: recent.length || null,
        }
      }
      return json(200, out)
    }
    const m = /^\/api\/j2\/trackers\/t1\/days\/([^/]+)$/.exec(url)
    if (m && method === 'PUT') {
      const { value } = JSON.parse(init.body)
      if (value === null) delete st.values[m[1]]
      else st.values[m[1]] = value
      return json(200, dayOf(m[1]))
    }
    if (url === '/api/j2/trackers/t1/unarchive' && method === 'POST') { st.archived = false; return json(200, { id: 't1' }) }
    return json(200, {})
  })
  return { st, calls, toNotes: () => calls.filter((c) => c.url.startsWith('/api/j2/notes')) }
}

const PARAMS = { trackerId: 't1', day: '2026-10-26', bind: 'note-day', display: 'chart' }
function mounted() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  hosts.push(el)
  const node = { type: 'widgetEmbed', attrs: { ...buildWidgetEmbedAttrs('tracker', PARAMS, { searchText: '[tracker: Sleep · For Mon Oct 26]' }) } }
  const ed = new Editor({ element: el, extensions: buildExtensions(), content: { type: 'doc', content: [node, { type: 'paragraph' }] } })
  ed.storage.uctJournalWidgets = { ...(ed.storage.uctJournalWidgets || {}), noteId: 'n1', noteTicker: () => null, noteDay: '2026-10-26' }
  const changes = []
  ed.on('transaction', ({ transaction }) => { if (transaction.docChanged) changes.push(transaction) })
  render(<EditorContent editor={ed} />)
  return { ed, changes }
}
const trackerAttrs = (ed) => ed.getJSON().content.find((n) => n.type === 'widgetEmbed').attrs
const box = () => document.querySelector('[data-value-input]')    // the editor itself is a textbox too
let editors = []
const hosts = []
afterEach(() => { cleanup(); for (const e of editors) e.destroy(); editors = []; for (const h of hosts.splice(0)) h.remove(); vi.restoreAllMocks() })

describe('⛔⛔ the tracker block never writes the note', () => {
  it('an inserted tracker carries its own name-and-day search text (buildWidgetEmbedAttrs extra.searchText)', () => {
    expect(buildWidgetEmbedAttrs('tracker', PARAMS, { searchText: '[tracker: X · For Mon Oct 26]' }).searchText).toBe('[tracker: X · For Mon Oct 26]')
    expect(buildWidgetEmbedAttrs('tracker', PARAMS).searchText).toBe('[tracker]')                    // control: the registry line
  })

  it('open_and_log_make_no_doc_change_and_no_note_put', async () => {
    const { toNotes, calls, st } = serve({ values: { '2026-10-23': 420 } })
    const { ed, changes } = mounted()
    editors.push(ed)
    await waitFor(() => expect(box()).toBeTruthy(), { timeout: 4000 })
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(calls.some((c) => c.url === '/api/j2/trackers/days')).toBe(true)                          // control: it read
    expect(screen.getByRole('group', { name: 'Tracker' })).toBeTruthy()                             // TOOL_BLOCK_LABELS names it
    expect(changes).toHaveLength(0)                                                                  // open: nothing
    const before = JSON.stringify(trackerAttrs(ed))
    fireEvent.change(box(), { target: { value: '7:30' } })
    fireEvent.keyDown(box(), { key: 'Enter' })
    await waitFor(() => expect(screen.getByText('Latest 7h 30m')).toBeTruthy())
    expect(calls.filter((c) => c.method === 'PUT').map((c) => c.url)).toEqual(['/api/j2/trackers/t1/days/2026-10-26'])
    expect(st.values['2026-10-26']).toBe(450)                                                        // control: it logged
    fireEvent.change(box(), { target: { value: '' } })                                               // and a clear
    fireEvent.keyDown(box(), { key: 'Enter' })
    await waitFor(() => expect(st.values['2026-10-26']).toBeUndefined())
    expect(changes).toHaveLength(0)
    expect(toNotes()).toEqual([])
    expect(JSON.stringify(trackerAttrs(ed))).toBe(before)                                            // params untouched
  })

  it('adopted_value_from_another_tab_makes_no_doc_change', async () => {
    const { toNotes } = serve()
    const { ed, changes } = mounted()
    editors.push(ed)
    await waitFor(() => expect(box()).toBeTruthy(), { timeout: 4000 })
    const other = new FakeBC('uct-nb-tools')                                                          // the other tab
    const entry = { day: '2026-10-26', value: 480, text: '8h', writable: true }
    act(() => { other.postMessage({ kind: 'tracker', id: 't1', day: '2026-10-26', entry, at: Date.now() + 1, seq: 1 }) })
    await waitFor(() => expect(box().value).toBe('8:00'))
    expect(screen.getByText('Latest 8h')).toBeTruthy()
    expect(changes).toHaveLength(0)
    expect(toNotes()).toEqual([])
  })

  it('restore_makes_no_note_write_and_no_doc_change', async () => {
    const { toNotes, calls } = serve({ archived: true })
    const { ed, changes } = mounted()
    editors.push(ed)
    await waitFor(() => expect(screen.getByText('Archived tracker, history only')).toBeTruthy(), { timeout: 4000 })
    fireEvent.click(screen.getByRole('button', { name: 'Tracker options' }))
    fireEvent.click(screen.getByText('Restore').closest('button'))
    await waitFor(() => expect(box()).toBeTruthy())
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/j2/trackers/t1/unarchive')).toBe(true)
    expect(changes).toHaveLength(0)
    expect(toNotes()).toEqual([])
  })

  it('follow_today_is_one_transaction_with_search_text', async () => {
    const { toNotes } = serve()
    const { ed, changes } = mounted()
    editors.push(ed)
    await waitFor(() => expect(box()).toBeTruthy(), { timeout: 4000 })
    fireEvent.click(screen.getByRole('button', { name: 'Tracker options' }))
    fireEvent.click(screen.getByText('Follow today').closest('button'))
    await waitFor(() => expect(changes).toHaveLength(1))
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(changes).toHaveLength(1)
    const attrs = trackerAttrs(ed)
    expect(attrs.searchText).toBe('[tracker: Sleep · For Tue Oct 27]')
    expect(attrs.params.bind).toBe('today')
    expect(attrs.params.day).toBe('')
    expect(attrs.params.display).toBe('chart')
    expect(toNotes()).toEqual([])
    await waitFor(() => expect(screen.getByText('For Tue Oct 27')).toBeTruthy())                     // it now follows today
  })
})
