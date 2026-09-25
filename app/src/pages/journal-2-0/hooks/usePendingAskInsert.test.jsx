import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { StrictMode } from 'react'
import { renderHook } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { AskInsert } from '../lib/askInsertNode'
import { AskCitation } from '../lib/askCitationNode'
import {
  appendAskInsert, clearPendingAskInsert, takePendingAskInsert, writePendingAskInsert,
  PENDING_ASK_INSERT_KEY,
} from '../lib/askInsert'
import usePendingAskInsert from './usePendingAskInsert'

const NODE = {
  type: 'askInsert', attrs: { insertedAt: '2026-09-22T12:00:00.000Z', scope: 'notebook', question: 'q' },
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Answer.' }] }],
}
let editor
function mk() {
  const el = document.createElement('div')
  document.body.appendChild(el)
  editor = new Editor({
    element: el,
    extensions: [StarterKit, AskInsert, AskCitation],
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Mine.' }] }] },
  })
  return editor
}
const inserts = (ed) => { let n = 0; ed.state.doc.forEach((c) => { if (c.type.name === 'askInsert') n += 1 }); return n }

beforeEach(() => { clearPendingAskInsert(); sessionStorage.clear() })
afterEach(() => { editor?.destroy(); editor = null })

describe('usePendingAskInsert', () => {
  it('waits for ready, then inserts once', () => {
    const ed = mk()
    writePendingAskInsert('n1', NODE)
    const onResult = vi.fn()
    const { rerender } = renderHook((p) => usePendingAskInsert(p), {
      initialProps: { noteId: 'n1', editor: ed, ready: false, onResult },
    })
    expect(inserts(ed)).toBe(0)
    rerender({ noteId: 'n1', editor: ed, ready: true, onResult })
    expect(inserts(ed)).toBe(1)
    expect(onResult).toHaveBeenCalledWith(true)
  })

  it('StrictMode double effects insert exactly once', () => {
    const ed = mk()
    writePendingAskInsert('n1', NODE)
    renderHook(() => usePendingAskInsert({ noteId: 'n1', editor: ed, ready: true }), { wrapper: StrictMode })
    expect(inserts(ed)).toBe(1)
  })

  it("another note's answer is left for that note", () => {
    const ed = mk()
    writePendingAskInsert('n2', NODE)
    renderHook(() => usePendingAskInsert({ noteId: 'n1', editor: ed, ready: true }))
    expect(inserts(ed)).toBe(0)
    expect(takePendingAskInsert('n2')?.noteId).toBe('n2')
  })

  it('a read-only editor reports failure and the entry is spent', () => {
    const ed = mk()
    ed.setEditable(false)
    writePendingAskInsert('n1', NODE)
    const onResult = vi.fn()
    renderHook(() => usePendingAskInsert({ noteId: 'n1', editor: ed, ready: true, onResult }))
    expect(onResult).toHaveBeenCalledWith(false)
    expect(takePendingAskInsert('n1')).toBeNull()
  })

  // G-064 fix round 1 (F1, review finding) — a `peek -> insert -> take` order
  // reads the SAME as `take -> insert` to every test above: `onResult` is
  // still called, the doc still ends up with exactly one insert after a
  // StrictMode double-invoke (the second invocation's `peek` finds nothing
  // because the FIRST invocation's `take`, run right after its own insert,
  // already cleared it before the second invocation starts — both orders
  // clear the entry before that second, purely-synchronous run). What
  // neither test above can see is the instant BETWEEN insert and take: these
  // two watch the insert's own transaction dispatch, synchronously, for a
  // consumer that reacts to it — which is exactly where the two orders
  // diverge.
  it('the entry is already gone when the insert transaction dispatches', () => {
    const ed = mk()
    writePendingAskInsert('n1', NODE)
    let stored = 'never-dispatched'
    ed.on('transaction', ({ transaction }) => {
      if (transaction.docChanged) stored = sessionStorage.getItem(PENDING_ASK_INSERT_KEY)
    })
    renderHook(() => usePendingAskInsert({ noteId: 'n1', editor: ed, ready: true }))
    expect(inserts(ed)).toBe(1)
    expect(stored).toBeNull()
  })

  it('a second consumer reacting to the insert finds nothing left (exactly one insert)', () => {
    const ed = mk()
    writePendingAskInsert('n1', NODE)
    // A re-entrant consumer, wired to the SAME transaction the insert
    // dispatches -- not a second render, a second READER of the same event.
    ed.on('transaction', ({ transaction }) => {
      if (!transaction.docChanged) return
      const again = takePendingAskInsert('n1')
      if (again) appendAskInsert(ed, again.node)
    })
    renderHook(() => usePendingAskInsert({ noteId: 'n1', editor: ed, ready: true }), { wrapper: StrictMode })
    expect(inserts(ed)).toBe(1)
  })
})
