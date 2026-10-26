// Wave 9 Task 9.19: the tool picker the / menu's "Routine (remembered daily)" and "Tracker (one value a day)" open.
// It lists the member's routines (or trackers) that are not archived, plus "New routine" ("New tracker"), which opens
// the editor and inserts the new one at the caret once it is saved. Every assertion reads what the member SEES, what
// the server is SENT, or what the note now HOLDS. `fetch` is a fake routines server.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react'
import { buildExtensions } from '../../../lib/tiptap'
import { noteDayOf } from '../../../lib/blocks/toolDays'
import { TOOL_NOT_ADDED, TOOL_SAVED_NOT_ADDED } from '../../../lib/toolEmbed'
import ToolPicker, { PICKER_COPY } from './ToolPicker'
import { openToolPicker, __resetToolPicker } from './openToolPicker'
import { __resetEditorDoor } from './mountEditor'
import { installServer, routine, tracker } from './__fixtures__/toolsServer'

if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
}

const setOnline = (v) => Object.defineProperty(globalThis.navigator, 'onLine', { value: v, configurable: true })
let editor
beforeEach(() => { setOnline(true); __resetToolPicker(); __resetEditorDoor() })
afterEach(() => {
  cleanup()
  setOnline(true)
  editor?.destroy()
  editor = null
  document.querySelectorAll('[data-tool-picker-root],[data-routine-editor-root],[data-tracker-editor-root]').forEach((n) => n.remove())
})

function noteEditor(note = { id: 'n1', dailyDate: '2026-10-27' }) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  editor = new Editor({ element: el, extensions: buildExtensions(), content: '<p>Before</p>' })
  editor.storage.uctJournalWidgets = { ...editor.storage.uctJournalWidgets, uid: 'u1', noteDay: () => noteDayOf(note) }
  editor.commands.focus('end')
  return editor
}
const embeds = (ed) => {
  const out = []
  ed.state.doc.descendants((n) => { if (n.type.name === 'widgetEmbed') out.push(n) })
  return out
}

describe('the tool picker', () => {
  it('lists the routines that are not archived, and New routine', async () => {
    installServer({ tools: { r1: routine(), r2: routine({ id: 'r2', name: 'Rules I keep' }), r3: routine({ id: 'r3', name: 'Old', archived: true }) } })
    render(<ToolPicker kind="routine" onPick={() => {}} onClose={() => {}} onNew={() => {}} />)
    expect(screen.getByRole('heading', { name: PICKER_COPY.routine.title })).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'Pre-market routine' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Rules I keep' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Old' })).toBeNull()
    expect(screen.getByRole('button', { name: 'New routine' })).toBeTruthy()
  })

  it('with none yet, says so and offers New tracker', async () => {
    installServer({ tools: {} })
    render(<ToolPicker kind="tracker" onPick={() => {}} onClose={() => {}} onNew={() => {}} />)
    expect(await screen.findByText(PICKER_COPY.tracker.empty)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'New tracker' })).toBeTruthy()
  })

  it('a list that cannot be read says why and offers Try again; offline sends nothing', async () => {
    const net = installServer({ tools: { r1: routine() } })
    net.refuseNext('GET', '/api/j2/routines', 500, {})
    render(<ToolPicker kind="routine" onPick={() => {}} onClose={() => {}} onNew={() => {}} />)
    expect(await screen.findByText("That didn't go through. Try again.")).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('button', { name: 'Pre-market routine' })).toBeTruthy()
    cleanup()
    const before = net.calls.length
    setOnline(false)
    render(<ToolPicker kind="routine" onPick={() => {}} onClose={() => {}} onNew={() => {}} />)
    expect(await screen.findByText("You're offline. Try again when you're back online.")).toBeTruthy()
    expect(net.calls.length).toBe(before)
    // New routine is still offered (the editor says so itself if a save cannot go through).
    expect(screen.getByRole('button', { name: 'New routine' })).toBeTruthy()
  })

  it('picking one inserts its block at the caret, bound to the note day, and closes', async () => {
    installServer({ tools: { t1: tracker() } })
    const ed = noteEditor()
    await act(async () => { openToolPicker({ editor: ed, kind: 'tracker' }) })
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Sleep' })) })
    const [node] = embeds(ed)
    expect(node.attrs.widgetId).toBe('tracker')
    expect(node.attrs.params).toEqual({ trackerId: 't1', day: '2026-10-27', bind: 'note-day', display: 'chart' })
    expect(node.attrs.searchText).toBe('[tracker: Sleep · For Tue Oct 27]')
    expect(ed.getText()).toContain('Before')
    await waitFor(() => expect(document.querySelector('[data-tool-picker-root]')).toBeNull())
  })

  it('new_routine_from_picker_inserts_on_save', async () => {
    const net = installServer({ tools: {} })
    const ed = noteEditor({ id: 'n1', createdAt: '2026-10-28T03:30:00Z' })
    await act(async () => { openToolPicker({ editor: ed, kind: 'routine' }) })
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'New routine' })) })
    // The picker gives way to the routine editor (one sheet at a time).
    expect(await screen.findByRole('heading', { name: 'New routine' })).toBeTruthy()
    await waitFor(() => expect(document.querySelector('[data-tool-picker-root]')).toBeNull())
    expect(embeds(ed)).toHaveLength(0)                                   // nothing goes in before the save
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Evening review' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add an item' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Item 1' }), { target: { value: 'Log every trade' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
    await waitFor(() => expect(embeds(ed)).toHaveLength(1))
    expect(net.sent('POST', '/api/j2/routines')).toHaveLength(1)
    const [node] = embeds(ed)
    expect(node.attrs.widgetId).toBe('routine')
    expect(node.attrs.params).toEqual({ routineId: 'r-new', day: '2026-10-27', bind: 'note-day', display: 'items' })
    expect(node.attrs.searchText).toBe('[routine: Evening review · For Tue Oct 27]')
    // A Cancel inserts nothing.
    await act(async () => { openToolPicker({ editor: ed, kind: 'routine' }) })
    await waitFor(() => expect(document.querySelector('[data-routine-editor-root]')).toBeNull())
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'New routine' })) })
    await screen.findByRole('heading', { name: 'New routine' })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel' })) })
    await waitFor(() => expect(document.querySelector('[data-routine-editor-root]')).toBeNull())
    expect(embeds(ed)).toHaveLength(1)
  })

  it('a note the member cannot edit gets nothing, and the member is told why', async () => {
    installServer({ tools: { r1: routine() } })
    const ed = noteEditor()
    const notify = vi.fn()
    ed.storage.uctJournalWidgets.notify = notify
    ed.setEditable(false)
    await act(async () => { openToolPicker({ editor: ed, kind: 'routine' }) })
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Pre-market routine' })) })
    expect(embeds(ed)).toHaveLength(0)
    expect(notify).toHaveBeenCalledWith(TOOL_NOT_ADDED, 'error')
  })

  it('m-2: a routine made through New and saved after the note turned read-only is kept, and the member is told', async () => {
    const net = installServer({ tools: {} })
    const ed = noteEditor()
    const notify = vi.fn()
    ed.storage.uctJournalWidgets.notify = notify
    await act(async () => { openToolPicker({ editor: ed, kind: 'routine' }) })
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'New routine' })) })
    await screen.findByRole('heading', { name: 'New routine' })
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Evening review' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add an item' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Item 1' }), { target: { value: 'Log every trade' } })
    ed.setEditable(false)                                                 // locked while the member was writing
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })) })
    await waitFor(() => expect(notify).toHaveBeenCalledWith(TOOL_SAVED_NOT_ADDED, 'error'))
    expect(net.sent('POST', '/api/j2/routines')).toHaveLength(1)          // the routine itself was made
    expect(embeds(ed)).toHaveLength(0)
    expect(TOOL_SAVED_NOT_ADDED).toBe("Saved in My tools. This note can't be changed right now, so it wasn't added here.")
  })
})

