// H14 sweep (polish round): the @ date list's OWN async gap. Since P0 its UI is a lazy chunk, loaded
// in the session's onStart; the session can end (the "@tom" deleted) while that chunk is on its way.
// The chunk here is held until the test has ended the session, then released: no list may appear
// for the dead session, and the member's text stays as they left it. (The microtask gap every menu
// shares is held by components/notebook/suggestionStaleSession.test.js.) Its own file: the plugin
// keeps the loaded list in module state, once per module registry.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { Editor } from '@tiptap/core'
import { buildExtensions } from './tiptap'

if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

const { gate, loads } = vi.hoisted(() => {
  let release
  const p = new Promise((r) => { release = r })
  return { gate: { p, release: () => release() }, loads: { n: 0 } }
})
vi.mock('../components/notebook/DateSuggestList', async (importOriginal) => {
  loads.n += 1
  await gate.p
  return importOriginal()
})

let editor
afterEach(() => { editor?.destroy(); editor = null; document.body.innerHTML = '' })
const popups = () => [...document.body.children].filter((el) => el.style?.position === 'fixed')

describe('the @ list: the session ends while its chunk is loading', () => {
  it('no list appears for the dead session, and the text is as the member left it', async () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    editor = new Editor({ element: el, extensions: buildExtensions(), content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Due ' }] }] } })
    editor.commands.focus('end', { scrollIntoView: false })
    const from = editor.state.selection.from
    editor.commands.insertContent('@tom')
    const to = editor.state.selection.from
    await vi.waitFor(() => expect(loads.n).toBe(1)) // onStart ran and asked for the chunk (still held)
    editor.commands.deleteRange({ from, to }) // a later keystroke ends the session
    editor.commands.insertContent('my words')
    gate.release()
    for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 20))
    expect(popups()).toEqual([])
    expect(editor.state.doc.textContent).toBe('Due my words')
  })

  it('CONTROL (runs after the case above, chunk now loaded): a live session does get its list', async () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    editor = new Editor({ element: el, extensions: buildExtensions(), content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Due ' }] }] } })
    editor.commands.focus('end', { scrollIntoView: false })
    editor.commands.insertContent('@tom')
    await vi.waitFor(() => expect(popups().length).toBe(1), { timeout: 2000 })
  })
})
