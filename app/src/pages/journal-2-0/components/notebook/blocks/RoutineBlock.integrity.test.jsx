// ⛔⛔ The routine block inside a REAL TipTap editor (wave 9, Task 9.13; global constraint "live state is never written
// into note params"). Opening the note, ticking, and adopting another tab's tick each produce ZERO transactions with
// `docChanged` and ZERO requests to the note routes; "Follow today" is exactly ONE, carrying its search text.
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { EditorContent } from '@tiptap/react'
import { buildExtensions } from '../../../lib/tiptap'
import { buildWidgetEmbedAttrs } from '../../../lib/widgetEmbedCore'

Range.prototype.getClientRects = () => []
Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
document.elementFromPoint = () => null

/** A fake channel: instances of one name hear each other (never themselves), as in a browser. Installed before the
 *  data layer makes its own (it does so lazily, on the first subscription). */
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
const ITEMS = [
  { id: 'i1', text: 'Read the morning wire', negative: false },
  { id: 'i2', text: 'Mark key levels', negative: false },
]
const entryFrom = (st, day) => {
  const ticked = Object.fromEntries(ITEMS.map((it) => [it.id, st.ticked[it.id] === true]))
  const n = Object.values(ticked).filter(Boolean).length
  return {
    day, state: st.skipped ? 'skipped' : n === ITEMS.length ? 'done' : 'open', label: '', ticked, skipped: !!st.skipped,
    partial: n ? `${n} of ${ITEMS.length}` : null, items: ITEMS, writable: !st.archived, beyondNote: null,
    consistency: null, rate: null, run: { line: null, milestone: false, best: null }, suggested: [],
  }
}
function serve(over = {}) {
  const st = { ticked: {}, today: '2026-10-27', archived: false, skipped: false, ...over }
  const calls = []
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = init.method || 'GET'
    calls.push({ url: String(url), method })
    if (url === '/api/j2/routines/days') {
      const { ids, days } = JSON.parse(init.body)
      const out = { routines: {} }
      if (days.includes('today')) out.resolved = { today: st.today }
      for (const id of ids) {
        out.routines[id] = {
          routine: { id, name: 'Pre-market routine', archived: st.archived, items: ITEMS },
          days: Object.fromEntries(days.map((d) => { const real = d === 'today' ? st.today : d; return [real, entryFrom(st, real)] })),
        }
      }
      return json(200, out)
    }
    const m = /^\/api\/j2\/routines\/r1\/days\/([^/]+)\/items\/([^/]+)$/.exec(url)
    if (m && method === 'PUT') { st.ticked[m[2]] = JSON.parse(init.body).ticked; return json(200, entryFrom(st, m[1])) }
    const k = /^\/api\/j2\/routines\/r1\/days\/([^/]+)$/.exec(url)
    if (k && method === 'PUT') { st.skipped = JSON.parse(init.body).skipped; return json(200, entryFrom(st, k[1])) }
    if (url === '/api/j2/routines/r1/unarchive' && method === 'POST') { st.archived = false; return json(200, { id: 'r1' }) }
    return json(200, {})
  })
  return { st, calls, toNotes: () => calls.filter((c) => c.url.startsWith('/api/j2/notes')) }
}

const PARAMS = { routineId: 'r1', day: '2026-10-26', bind: 'note-day', display: 'items' }
function mounted() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const node = { type: 'widgetEmbed', attrs: { ...buildWidgetEmbedAttrs('routine', PARAMS, { searchText: '[routine: Pre-market routine · For Mon Oct 26]' }) } }
  const ed = new Editor({ element: el, extensions: buildExtensions(), content: { type: 'doc', content: [node, { type: 'paragraph' }] } })
  ed.storage.uctJournalWidgets = { ...(ed.storage.uctJournalWidgets || {}), noteId: 'n1', noteTicker: () => null, noteDay: '2026-10-26' }
  const changes = []
  ed.on('transaction', ({ transaction }) => { if (transaction.docChanged) changes.push(transaction) })
  render(<EditorContent editor={ed} />)
  return { ed, changes }
}
const routineAttrs = (ed) => ed.getJSON().content.find((n) => n.type === 'widgetEmbed').attrs
const boxes = () => screen.queryAllByRole('checkbox')
let editors = []
afterEach(() => { cleanup(); for (const e of editors) e.destroy(); editors = []; vi.restoreAllMocks() })

describe('⛔⛔ the routine block never writes the note', () => {
  it('an inserted routine carries its own name-and-day search text (buildWidgetEmbedAttrs extra.searchText)', () => {
    expect(buildWidgetEmbedAttrs('routine', PARAMS, { searchText: '[routine: X · For Mon Oct 26]' }).searchText).toBe('[routine: X · For Mon Oct 26]')
    expect(buildWidgetEmbedAttrs('routine', PARAMS).searchText).toBe('[routine]')                    // control: the registry line
    expect(buildWidgetEmbedAttrs('routine', PARAMS, { searchText: '' }).searchText).toBe('[routine]')
  })

  it('open_makes_no_doc_change', async () => {
    const { toNotes, calls } = serve()
    const { ed, changes } = mounted()
    editors.push(ed)
    await waitFor(() => expect(boxes()).toHaveLength(2), { timeout: 4000 })
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(calls.some((c) => c.url === '/api/j2/routines/days')).toBe(true)                          // control: it read
    expect(screen.getByRole('group', { name: 'Routine' })).toBeTruthy()                             // TOOL_BLOCK_LABELS names it
    expect(changes).toHaveLength(0)
    expect(toNotes()).toEqual([])
  })

  it('tick_makes_no_note_put_and_no_doc_change', async () => {
    const { toNotes, calls } = serve()
    const { ed, changes } = mounted()
    editors.push(ed)
    await waitFor(() => expect(boxes()).toHaveLength(2), { timeout: 4000 })
    const before = JSON.stringify(routineAttrs(ed))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mark key levels' }))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Mark key levels' }).getAttribute('aria-checked')).toBe('true'))
    await waitFor(() => expect(screen.getByText('1 of 2')).toBeTruthy())
    expect(calls.filter((c) => c.method === 'PUT').map((c) => c.url)).toEqual(['/api/j2/routines/r1/days/2026-10-26/items/i2'])
    expect(changes).toHaveLength(0)
    expect(toNotes()).toEqual([])
    expect(JSON.stringify(routineAttrs(ed))).toBe(before)                                            // params untouched
  })

  it('adopted_entry_from_another_tab_makes_no_doc_change', async () => {
    const { st, toNotes } = serve()
    const { ed, changes } = mounted()
    editors.push(ed)
    await waitFor(() => expect(boxes()).toHaveLength(2), { timeout: 4000 })
    st.ticked.i1 = true
    const other = new FakeBC('uct-nb-tools')                                                          // the other tab
    act(() => { other.postMessage({ kind: 'routine', id: 'r1', day: '2026-10-26', entry: entryFrom(st, '2026-10-26'), at: Date.now() + 1, seq: 1 }) })
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Read the morning wire' }).getAttribute('aria-checked')).toBe('true'))
    expect(changes).toHaveLength(0)
    expect(toNotes()).toEqual([])
  })

  it('skip_makes_no_note_write_and_no_doc_change', async () => {
    const { toNotes, calls } = serve()
    const { ed, changes } = mounted()
    editors.push(ed)
    await waitFor(() => expect(boxes()).toHaveLength(2), { timeout: 4000 })
    const before = JSON.stringify(routineAttrs(ed))
    fireEvent.click(screen.getByRole('button', { name: 'Skip this day' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Skipped' })).toBeTruthy())
    expect(calls.filter((c) => c.method === 'PUT').map((c) => c.url)).toEqual(['/api/j2/routines/r1/days/2026-10-26'])
    expect(changes).toHaveLength(0)
    expect(toNotes()).toEqual([])
    expect(JSON.stringify(routineAttrs(ed))).toBe(before)
  })

  it('restore_makes_no_note_write_and_no_doc_change', async () => {
    const { toNotes, calls } = serve({ archived: true })
    const { ed, changes } = mounted()
    editors.push(ed)
    await waitFor(() => expect(screen.getByText('Archived routine, history only')).toBeTruthy(), { timeout: 4000 })
    fireEvent.click(screen.getByRole('button', { name: 'Routine options' }))
    fireEvent.click(screen.getByText('Restore').closest('button'))
    await waitFor(() => expect(boxes()).toHaveLength(2))
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/j2/routines/r1/unarchive')).toBe(true)
    expect(changes).toHaveLength(0)
    expect(toNotes()).toEqual([])
  })

  it('follow_today_is_one_transaction_with_search_text', async () => {
    const { toNotes } = serve()
    const { ed, changes } = mounted()
    editors.push(ed)
    await waitFor(() => expect(boxes()).toHaveLength(2), { timeout: 4000 })
    fireEvent.click(screen.getByRole('button', { name: 'Routine options' }))
    fireEvent.click(screen.getByText('Follow today').closest('button'))
    await waitFor(() => expect(changes).toHaveLength(1))
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(changes).toHaveLength(1)
    const attrs = routineAttrs(ed)
    expect(attrs.searchText).toBe('[routine: Pre-market routine · For Tue Oct 27]')
    expect(attrs.params.bind).toBe('today')
    expect(attrs.params.day).toBe('')
    expect(toNotes()).toEqual([])
    await waitFor(() => expect(screen.getByText('For Tue Oct 27')).toBeTruthy())                     // it now follows today
  })

  // Task 9.15: the vs P&L flip is component state (a read, never a write); "Show the P&L comparison first" is ONE
  // transaction carrying the search text.
  it('flip_to_pnl_makes_no_doc_change_and_no_note_request', async () => {
    const { toNotes, calls } = serve()
    const { ed, changes } = mounted()
    editors.push(ed)
    await waitFor(() => expect(boxes()).toHaveLength(2), { timeout: 4000 })
    const before = JSON.stringify(routineAttrs(ed))
    const flip = () => screen.getByRole('button', { name: 'P&L on days you finished it' })
    fireEvent.click(flip())
    await waitFor(() => expect(calls.some((c) => c.url === '/api/j2/routines/r1/vs-pnl' && c.method === 'GET')).toBe(true))
    await waitFor(() => expect(boxes()).toHaveLength(0))
    fireEvent.click(flip())
    await waitFor(() => expect(boxes()).toHaveLength(2))
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(changes).toHaveLength(0)
    expect(toNotes()).toEqual([])
    expect(calls.filter((c) => c.method !== 'GET' && c.url !== '/api/j2/routines/days')).toEqual([])
    expect(JSON.stringify(routineAttrs(ed))).toBe(before)
  })

  it('show_the_pnl_comparison_first_is_one_transaction_with_search_text', async () => {
    const { toNotes } = serve()
    const { ed, changes } = mounted()
    editors.push(ed)
    await waitFor(() => expect(boxes()).toHaveLength(2), { timeout: 4000 })
    fireEvent.click(screen.getByRole('button', { name: 'Routine options' }))
    fireEvent.click(screen.getByText('Show the P&L comparison first').closest('button'))
    await waitFor(() => expect(changes).toHaveLength(1))
    await act(async () => { await new Promise((r) => setTimeout(r, 30)) })
    expect(changes).toHaveLength(1)
    const attrs = routineAttrs(ed)
    expect(attrs.params.display).toBe('pnl')
    expect(attrs.params.bind).toBe('note-day')
    expect(attrs.searchText).toBe('[routine: Pre-market routine · For Mon Oct 26]')
    expect(toNotes()).toEqual([])
    await waitFor(() => expect(boxes()).toHaveLength(0))                                              // it opens on the panel
  })
})
