// Audit 2026-11-05, S20: the two trust incidents are recognised exactly, and nothing else is one.
// Tier 3a fix round 1 (review I4/13): the undo rule runs on a REAL editor and its real history, never a hand-made
// transaction: delete-then-undo counts; settings-change-then-undo, move-then-undo and insert-then-undo do not.
import { afterEach, describe, it, expect } from 'vitest'
import { Editor, Node } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { restoredWidgetByUndo } from './notebookTips'
import { TRUST_UNDO_WINDOW_MS, publishUndoneMs } from './notePublishLink'

const Widget = Node.create({
  name: 'widgetEmbed',
  group: 'block',
  atom: true,
  addAttributes: () => ({ widgetId: { default: 'chart' }, symbol: { default: 'NVDA' } }),
  parseHTML: () => [{ tag: 'div[data-widget]' }],
  renderHTML: ({ HTMLAttributes }) => ['div', { 'data-widget': '', ...HTMLAttributes }],
})

let editor = null
afterEach(() => { editor?.destroy(); editor = null })

function make() {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: [StarterKit, Widget],
    content: { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Plan' }] },
      { type: 'widgetEmbed', attrs: { widgetId: 'chart', symbol: 'NVDA' } },
      { type: 'paragraph', content: [{ type: 'text', text: 'End' }] },
    ] },
  })
  const hits = []
  editor.on('transaction', ({ transaction }) => { hits.push(restoredWidgetByUndo(transaction)) })
  return hits
}
const widgetPos = () => { let at = -1; editor.state.doc.descendants((n, p) => { if (n.type.name === 'widgetEmbed') at = p }); return at }
// Each change its own history step (prosemirror-history groups changes made within 500 ms otherwise).
const step = (fn) => editor.chain().command(({ tr }) => { tr.setMeta('addToHistory', true); fn(tr); return true }).run()
const undo = (hits) => { const from = hits.length; editor.commands.undo(); return hits.slice(from) }

describe('a widget deleted then restored by undo (a real editor)', () => {
  it('delete, then undo: ONE incident', () => {
    const hits = make()
    const at = widgetPos()
    step((tr) => tr.delete(at, at + 1))
    expect(widgetPos()).toBe(-1)
    expect(undo(hits)).toEqual([true])
    expect(widgetPos()).toBeGreaterThan(-1)
  })
  it('CONTROL: a settings change, then undo, is not one', () => {
    const hits = make()
    const at = widgetPos()
    step((tr) => tr.setNodeMarkup(at, undefined, { widgetId: 'chart', symbol: 'AMD' }))
    expect(undo(hits)).toEqual([false])
  })
  it('CONTROL: a move, then undo, is not one', () => {
    const hits = make()
    const at = widgetPos()
    step((tr) => { const node = tr.doc.nodeAt(at); tr.delete(at, at + 1); tr.insert(0, node) })
    expect(undo(hits)).toEqual([false])
  })
  it('CONTROL: an insert, then undo, is not one; nor is a redo of the delete-undo', () => {
    const hits = make()
    step((tr) => tr.insert(0, editor.schema.nodes.widgetEmbed.create({ widgetId: 'chart', symbol: 'QQQ' })))
    expect(undo(hits)).toEqual([false])
    const at = widgetPos()
    step((tr) => tr.delete(at, at + 1))
    undo(hits)
    const from = hits.length
    editor.commands.redo()
    expect(hits.slice(from)).toEqual([false])
  })
})

describe('a publish undone within 10 minutes', () => {
  const now = Date.parse('2026-11-04T18:00:00Z')
  it('reads the server UTC stamp, with or without a zone', () => {
    expect(publishUndoneMs({ createdAt: '2026-11-04T17:58:00Z' }, now)).toBe(120000)
    expect(publishUndoneMs({ createdAt: '2026-11-04 17:55:00' }, now)).toBe(300000)
  })
  it('CONTROL: an older publish, a future stamp and an unreadable one are not incidents', () => {
    expect(publishUndoneMs({ createdAt: new Date(now - TRUST_UNDO_WINDOW_MS - 1).toISOString() }, now)).toBeNull()
    expect(publishUndoneMs({ createdAt: '2026-11-04T18:05:00Z' }, now)).toBeNull()
    expect(publishUndoneMs({ createdAt: 'yesterday' }, now)).toBeNull()
    expect(publishUndoneMs({}, now)).toBeNull()
  })
})
