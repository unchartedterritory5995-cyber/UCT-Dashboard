// Wave 6 item 3 — an image's caption (real text, in an imageFigure) and its
// alignment: the commands and keys on a REAL editor, the caption reaching
// find/replace, the word count and citation text, the paste rules of a title,
// and the image's own bar through the React node view.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { useEffect } from 'react'
import { Editor, generateJSON } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { buildExtensions } from './tiptap'
import {
  addImageCaption, removeImageCaption, setImageAlign, deleteSelectedFigureImage,
} from './imageFigureNode'
import { findMatchesInDoc } from './noteFind'
import { noteStats } from './noteStats'
import { citationText } from './askCitation'

if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
if (typeof globalThis.ClipboardEvent === 'undefined') {
  globalThis.ClipboardEvent = class extends Event {
    constructor(type, opts) { super(type, opts); this.clipboardData = (opts && opts.clipboardData) || null }
  }
}

let editor
let warn
beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}) })
afterEach(() => {
  cleanup(); editor?.destroy(); editor = null; document.body.innerHTML = ''
  const fired = warn.mock.calls.filter((c) => String(c[0]).includes('[pasteContainers]'))
  warn.mockRestore()
  expect(fired, 'the paste belt fired: a rail must prove the rule, not the fallback').toEqual([])
})

function mount(content, opts = {}) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  editor = new Editor({ element: el, extensions: buildExtensions(), content: { type: 'doc', content }, ...opts })
  return editor
}
const P = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const IMG = (attrs = {}) => ({ type: 'image', attrs: { src: '/api/j2/notes/n1/images/a.png', alt: 'NVDA daily', ...attrs } })
const FIG = (caption, imgAttrs) => ({
  type: 'imageFigure',
  content: [IMG(imgAttrs), { type: 'imageCaption', content: caption ? [{ type: 'text', text: caption }] : [] }],
})
const posOf = (ed, type) => { let p = null; ed.state.doc.descendants((n, pos) => { if (p == null && n.type.name === type) p = pos }); return p }
const top = (ed) => { const o = []; ed.state.doc.forEach((n) => o.push(`${n.type.name}:${n.textContent}`)); return o }
const key = (ed, k) => fireEvent.keyDown(ed.view.dom, { key: k, code: k })
const caretAt = (ed, pos) => ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, pos)))

describe('adding, leaving and removing a caption', () => {
  it('Add caption wraps the image in a figure, puts the caret in the caption, and typing lands THERE', () => {
    const ed = mount([P('Before.'), IMG(), P('After.')])
    expect(addImageCaption(ed, posOf(ed, 'image'))).toBe(true)
    expect(top(ed)).toEqual(['paragraph:Before.', 'imageFigure:', 'paragraph:After.'])
    expect(ed.state.selection.$from.parent.type.name).toBe('imageCaption')
    ed.commands.insertContent('Breakout day 3')
    const fig = ed.state.doc.nodeAt(posOf(ed, 'imageFigure'))
    expect(fig.lastChild.textContent).toBe('Breakout day 3')
    expect(fig.firstChild.type.name).toBe('image')
  })

  it('…and one undo takes the caption away again', () => {
    const ed = mount([IMG(), P('After.')])
    addImageCaption(ed, posOf(ed, 'image'))
    ed.commands.undo()
    expect(top(ed)).toEqual(['image:', 'paragraph:After.'])
  })

  it('Enter in a caption leaves it for a new paragraph after the figure', () => {
    const ed = mount([FIG('Cap'), P('After.')])
    caretAt(ed, posOf(ed, 'imageCaption') + 4)
    key(ed, 'Enter')
    expect(top(ed)).toEqual(['imageFigure:Cap', 'paragraph:', 'paragraph:After.'])
    expect(ed.state.selection.$from.parent.type.name).toBe('paragraph')
    expect(ed.state.doc.nodeAt(posOf(ed, 'imageFigure')).lastChild.textContent).toBe('Cap')
  })

  it('Backspace at the start of an EMPTY caption removes the caption, keeping the image', () => {
    const ed = mount([FIG(''), P('After.')])
    caretAt(ed, posOf(ed, 'imageCaption') + 1)
    key(ed, 'Backspace')
    expect(top(ed)).toEqual(['image:', 'paragraph:After.'])
  })

  it('CONTROL: Backspace at the start of a caption WITH words never merges them into the image', () => {
    const ed = mount([FIG('Keep me'), P('After.')])
    caretAt(ed, posOf(ed, 'imageCaption') + 1)
    key(ed, 'Backspace')
    expect(top(ed)).toEqual(['imageFigure:Keep me', 'paragraph:After.'])
  })

  it('Backspace on a SELECTED captioned image deletes the image and keeps the words', () => {
    const ed = mount([P('A.'), FIG('Breakout day 3'), P('B.')])
    ed.view.dispatch(ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, posOf(ed, 'image'))))
    key(ed, 'Backspace')
    expect(top(ed)).toEqual(['paragraph:A.', 'paragraph:Breakout day 3', 'paragraph:B.'])
  })

  it('deleting the IMAGE of a captioned figure keeps the caption\'s words as a paragraph', () => {
    const ed = mount([P('A.'), FIG('Breakout day 3'), P('B.')])
    ed.view.dispatch(ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, posOf(ed, 'image'))))
    key(ed, 'Delete')
    expect(top(ed)).toEqual(['paragraph:A.', 'paragraph:Breakout day 3', 'paragraph:B.'])
  })

  it('…the same through Backspace, and an image whose caption is empty just goes', () => {
    const ed = mount([P('A.'), FIG(''), P('B.')])
    ed.view.dispatch(ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, posOf(ed, 'image'))))
    key(ed, 'Backspace')
    expect(top(ed)).toEqual(['paragraph:A.', 'paragraph:B.'])
    expect(deleteSelectedFigureImage(ed)).toBe(false) // nothing selected now
  })

  it('Remove caption returns the figure to the bare image', () => {
    const ed = mount([FIG('Cap'), P('After.')])
    expect(removeImageCaption(ed, posOf(ed, 'image'))).toBe(true)
    expect(top(ed)).toEqual(['image:', 'paragraph:After.'])
  })

  it('a read-only editor refuses all three (a locked note)', () => {
    const ed = mount([IMG(), FIG('Cap')], { editable: false })
    const before = ed.state.doc
    expect(addImageCaption(ed, posOf(ed, 'image'))).toBe(false)
    expect(setImageAlign(ed, posOf(ed, 'image'), 'center')).toBe(false)
    let second = null
    ed.state.doc.descendants((n, pos) => { if (n.type.name === 'image') second = pos })
    expect(removeImageCaption(ed, second)).toBe(false)
    expect(ed.state.doc.eq(before)).toBe(true)
  })
})

describe('alignment (an attr on the image)', () => {
  it('sets and resets, and refuses anything but the four', () => {
    const ed = mount([IMG()])
    setImageAlign(ed, 0, 'center')
    expect(ed.state.doc.firstChild.attrs.align).toBe('center')
    setImageAlign(ed, 0, 'sideways')
    expect(ed.state.doc.firstChild.attrs.align).toBe(null)
    setImageAlign(ed, 0, 'full')
    expect(ed.state.doc.firstChild.attrs.align).toBe('full')
  })

  it('parses and renders data-align', () => {
    const ext = buildExtensions()
    const json = generateJSON('<img src="/x.png" data-align="right">', ext)
    expect(json.content[0].attrs.align).toBe('right')
    expect(generateJSON('<img src="/x.png" data-align="bogus">', ext).content[0].attrs.align).toBe(null)
  })
})

describe('the caption is the note\'s TEXT', () => {
  it('find and replace reach it', () => {
    const ed = mount([P('Margins.'), FIG('NVDA margins widened')])
    expect(findMatchesInDoc(ed.state.doc, 'margins').length).toBe(2)
    ed.commands.noteFindSet('widened')
    ed.commands.noteFindReplaceAll('narrowed')
    expect(ed.state.doc.nodeAt(posOf(ed, 'imageFigure')).lastChild.textContent).toBe('NVDA margins narrowed')
  })

  it('the word count counts it', () => {
    const ed = mount([P('One two.'), FIG('three four five')])
    expect(noteStats(ed.state.doc).words).toBe(5)
  })

  it('citation text reads it on its own line, the image reading as nothing', () => {
    const ed = mount([P('Before.'), FIG('Breakout day 3'), P('After.')])
    expect(citationText(ed.state.doc, 0, ed.state.doc.content.size)).toBe('Before.\nBreakout day 3\nAfter.')
  })

  it('parses a web page\'s <figure><img><figcaption>; a figure with no image is not one', () => {
    const ext = buildExtensions()
    const json = generateJSON('<figure><img src="/x.png" alt="a"><figcaption>From the web</figcaption></figure>', ext)
    expect(json.content[0].type).toBe('imageFigure')
    expect(json.content[0].content[1]).toMatchObject({ type: 'imageCaption', content: [{ text: 'From the web' }] })
    const noImg = generateJSON('<figure><blockquote><p>quote</p></blockquote></figure>', ext)
    expect(noImg.content.some((n) => n.type === 'imageFigure')).toBe(false)
    expect(JSON.stringify(noImg)).toContain('quote')
  })
})

describe('pasting into and out of a caption (a one-line title, like a toggle summary)', () => {
  const copyRange = (ed, from, to) => {
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, from, to)))
    return ed.view.serializeForClipboard(ed.state.selection.content()).dom.innerHTML
  }
  const pasteAt = (ed, pos, html) => { caretAt(ed, pos); ed.view.pasteHTML(html); ed.state.doc.check() }
  const at = (ed, str) => { let hit = null; ed.state.doc.descendants((n, pos) => { if (hit == null && n.isText) { const i = n.text.indexOf(str); if (i >= 0) hit = pos + i } }); return hit }

  it('two paragraphs of text pasted into a caption join it as one line (the figure is never split)', () => {
    const ed = mount([FIG('Cap'), P('After.')])
    pasteAt(ed, at(ed, 'Cap') + 3, '<p>one</p><p>two</p>')
    // placed at the caret, as typing would be; the two lines joined by a space
    expect(top(ed)).toEqual(['imageFigure:Capone two', 'paragraph:After.'])
  })

  it('a BLOCK pasted into a caption lands after the figure, the caption untouched', () => {
    const ed = mount([FIG('Cap'), P('After.')])
    pasteAt(ed, at(ed, 'Cap') + 3, '<ul><li><p>one</p></li><li><p>two</p></li></ul>')
    expect(top(ed)).toEqual(['imageFigure:Cap', 'bulletList:onetwo', 'paragraph:After.'])
  })

  it('a PARTIAL copy never puts a figure or a caption on the clipboard (another app gets paragraphs)', () => {
    const ed = mount([FIG('Breakout day'), P('After.')])
    const html = copyRange(ed, at(ed, 'day'), at(ed, 'After.') + 3)
    expect(html).toContain('day')
    expect(html).not.toMatch(/<figcaption|<figure/)
  })

  it('a word copied from a caption pastes into a paragraph as plain words — never a stray caption or figure', () => {
    const ed = mount([FIG('Breakout day'), P('Mine.')])
    const html = copyRange(ed, at(ed, 'day'), at(ed, 'day') + 3)
    pasteAt(ed, at(ed, 'Mine.') + 4, html)
    expect(top(ed)).toEqual(['imageFigure:Breakout day', 'paragraph:Mineday.'])
  })

  it('…pasted at the START of a member paragraph it never wraps that paragraph in a figure (the defining-rebuild bug)', () => {
    const ed = mount([FIG('Breakout day'), P('After.'), P('Mine.')])
    const html = copyRange(ed, at(ed, 'day'), at(ed, 'After.') + 3)
    pasteAt(ed, at(ed, 'Mine.'), html)
    let figures = 0
    ed.state.doc.descendants((n) => { if (n.type.name === 'imageFigure') figures += 1 })
    expect(figures).toBe(1)
    expect(ed.state.doc.textContent).toContain('day')
    expect(ed.state.doc.textContent).toContain('Aft')
    expect(ed.state.doc.textContent).toContain('Mine.')
  })

  it('a copy from the caption OUT past the figure spills the caption as a paragraph', () => {
    const ed = mount([FIG('Breakout day'), P('After.'), P('Mine.')])
    const html = copyRange(ed, at(ed, 'day'), at(ed, 'After.') + 3)
    pasteAt(ed, at(ed, 'Mine.') + 'Mine.'.length, html)
    let figures = 0
    ed.state.doc.descendants((n) => { if (n.type.name === 'imageFigure') figures += 1 })
    expect(figures).toBe(1)
    expect(ed.state.doc.textContent).toContain('Mine.day')
  })

  it('CONTROL: a whole figure copied as a node keeps its caption', () => {
    const ed = mount([FIG('Whole'), P('Mine.')])
    ed.view.dispatch(ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, posOf(ed, 'imageFigure'))))
    const html = ed.view.serializeForClipboard(ed.state.selection.content()).dom.innerHTML
    pasteAt(ed, at(ed, 'Mine.') + 'Mine.'.length, html)
    let figures = 0
    ed.state.doc.descendants((n) => { if (n.type.name === 'imageFigure') figures += 1 })
    expect(figures).toBe(2)
  })
})

// The image's own bar: a React node view, so it needs a React-mounted editor.
function Harness({ content, onEditor }) {
  const ed = useEditor({ extensions: buildExtensions(), content: { type: 'doc', content } })
  useEffect(() => { if (ed) onEditor(ed) }, [ed]) // eslint-disable-line react-hooks/exhaustive-deps
  return <EditorContent editor={ed} />
}
async function mountReact(content) {
  let ed = null
  render(<Harness content={content} onEditor={(e) => { ed = e }} />)
  await act(async () => {})
  editor = null // owned by the harness (useEditor destroys it)
  return ed
}
const selectImage = (ed) => act(() => { ed.view.dispatch(ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, posOf(ed, 'image')))) })

describe('the image\'s own bar (node view)', () => {
  it('appears while the image is selected; aligns it; adds, then removes, a caption', async () => {
    const ed = await mountReact([P('Before.'), IMG(), P('After.')])
    expect(screen.queryByRole('toolbar', { name: 'Image' })).toBeNull()
    selectImage(ed)
    const bar = await screen.findByRole('toolbar', { name: 'Image' })
    fireEvent.click(screen.getByRole('button', { name: 'Center the image' }))
    expect(ed.state.doc.nodeAt(posOf(ed, 'image')).attrs.align).toBe('center')
    expect(document.querySelector('[data-uct-image]').getAttribute('data-align')).toBe('center')
    selectImage(ed)
    expect(screen.getByRole('button', { name: 'Center the image' }).getAttribute('aria-pressed')).toBe('true')
    // a second press returns it to the default place
    fireEvent.click(screen.getByRole('button', { name: 'Center the image' }))
    expect(ed.state.doc.nodeAt(posOf(ed, 'image')).attrs.align).toBe(null)
    selectImage(ed)
    fireEvent.click(screen.getByRole('button', { name: 'Add caption' }))
    expect(top(ed)).toEqual(['paragraph:Before.', 'imageFigure:', 'paragraph:After.'])
    selectImage(ed)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove caption' }))
    expect(top(ed)).toEqual(['paragraph:Before.', 'image:', 'paragraph:After.'])
    expect(bar).toBeTruthy()
  })
})
