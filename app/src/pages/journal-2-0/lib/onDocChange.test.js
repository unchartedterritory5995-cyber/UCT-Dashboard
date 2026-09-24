// Wave 5 fix round 1 (S3) — onDocChange fires on every document change,
// including the silent ones, and on nothing else.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { buildExtensions } from './tiptap'
import { onDocChange } from './onDocChange'

let editor
afterEach(() => { editor?.destroy(); editor = null; document.body.innerHTML = '' })
function mount(text) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  editor = new Editor({ element: el, extensions: buildExtensions(), content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } })
  return editor
}

describe('onDocChange', () => {
  it('fires for a content swap that emits no `update` (the page\'s restore / sync / adoption door)', () => {
    const ed = mount('one two')
    const fn = vi.fn()
    const onUpdate = vi.fn()
    ed.on('update', onUpdate)
    onDocChange(ed, fn)
    ed.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'three' }] }] }, { emitUpdate: false })
    expect(onUpdate).not.toHaveBeenCalled() // the control: `update` really is silent here
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('fires for an ordinary edit', () => {
    const ed = mount('one')
    const fn = vi.fn()
    onDocChange(ed, fn)
    ed.commands.insertContentAt(2, 'x')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('does NOT fire for a caret move or a stored mark (off the keystroke path)', () => {
    const ed = mount('one two three')
    const fn = vi.fn()
    onDocChange(ed, fn)
    ed.commands.setTextSelection(3)
    ed.commands.setTextSelection({ from: 2, to: 6 })
    ed.commands.setTextSelection(4)
    ed.commands.setMark('bold') // an empty selection: a stored mark, not a step
    expect(fn).not.toHaveBeenCalled()
  })

  it('fires when a plugin APPENDED the change to a transaction that changed nothing itself', () => {
    const ed = mount('one')
    const fn = vi.fn()
    onDocChange(ed, fn)
    ed.emit('transaction', { editor: ed, transaction: { docChanged: false }, appendedTransactions: [{ docChanged: true }] })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('the returned function unsubscribes', () => {
    const ed = mount('one')
    const fn = vi.fn()
    const off = onDocChange(ed, fn)
    off()
    ed.commands.insertContentAt(2, 'x')
    expect(fn).not.toHaveBeenCalled()
  })
})
