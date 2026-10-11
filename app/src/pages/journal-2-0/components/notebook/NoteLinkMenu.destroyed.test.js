// Polish round (concern 1): a note closed mid-`[[`. The note-link menu starts its session only after
// a debounced search (makeNoteSearch: a setTimeout, then a fetch), so Suggestion calls the menu's
// onStart well after the keystroke. If the editor was destroyed in between (the member closed the
// note), onStart used to read `props.editor.view.dom` on a destroyed editor: TipTap throws there, the
// throw lands in Suggestion's async view update, and the page gets an unhandled rejection (seen in
// loaded test batches, and reachable in a browser). It also left a popup on the page for an editor
// that no longer exists. onStart now returns at once for a destroyed editor, as DateSuggest's does.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '../../lib/tiptap'
import { noteLinkMenuPluginKey } from './NoteLinkMenu'

const realFetch = globalThis.fetch
let rejections
const onRejection = (reason) => { rejections.push(reason) }

afterEach(() => {
  globalThis.fetch = realFetch
  process.off('unhandledRejection', onRejection)
  document.body.innerHTML = ''
})

const popups = () => [...document.body.children].filter((el) => el.style?.position === 'fixed')

describe('closing a note while a [[ search is still pending', () => {
  it('raises no unhandled rejection, throws nothing, and leaves no popup behind', async () => {
    rejections = []
    process.on('unhandledRejection', onRejection)
    const searched = vi.fn(async () => ({ ok: true, json: async () => ({ notes: [{ id: 'n1', title: 'Weekly review' }] }) }))
    globalThis.fetch = searched

    const el = document.createElement('div')
    document.body.appendChild(el)
    const editor = new Editor({
      element: el,
      extensions: buildExtensions(),
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'See ' }] }] },
    })
    editor.commands.focus('end', { scrollIntoView: false }) // jsdom has no getClientRects
    editor.commands.insertContent('[[Weekly')
    expect(noteLinkMenuPluginKey.getState(editor.state).active).toBe(true) // non-vacuity: a session opened
    expect(searched).not.toHaveBeenCalled() // ...and its search is still pending (debounced)

    // The member closes the note before the search answers.
    expect(() => editor.destroy()).not.toThrow()

    // The debounced search fires and answers; Suggestion then hands the session to onStart.
    await vi.waitFor(() => expect(searched).toHaveBeenCalledTimes(1), { timeout: 2000 })
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 20))

    expect(rejections.map((r) => String(r?.message || r))).toEqual([])
    expect(popups()).toEqual([])
  })
})
