// Wave 6 item 13 — /toc: an in-note table of contents that lists the note's
// headings LIVE and jumps like the Outline panel (collapsed toggles open).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'
import { Editor, generateJSON } from '@tiptap/core'
import { buildExtensions } from './tiptap'
import { TOC_DEBOUNCE_MS, TOC_EMPTY, jumpToHeading } from './tableOfContentsNode'
import { ITEMS, blockItemMatches } from '../components/notebook/SlashMenu'
import { citationText } from './askCitation'

if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

let editor
afterEach(() => { editor?.destroy(); editor = null; document.body.innerHTML = ''; vi.useRealTimers() })

function mount(content, opts = {}) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  editor = new Editor({ element: el, extensions: buildExtensions(), content: { type: 'doc', content }, ...opts })
  return editor
}
const P = (t) => (t ? { type: 'paragraph', content: [{ type: 'text', text: t }] } : { type: 'paragraph' })
const H = (level, t) => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text: t }] })
const TOC = { type: 'tableOfContents' }
const entries = (ed) => [...ed.view.dom.querySelectorAll('nav.uctToc button.uctTocLink')].map((b) => b.textContent)
const headingOfCaret = (ed) => ed.state.selection.$from.parent.type.name === 'heading' ? ed.state.selection.$from.parent.textContent : null

describe('/toc', () => {
  it('the slash item is found by "toc" (a keyword) and inserts the block', () => {
    const item = ITEMS.find((i) => i.title === 'Table of contents')
    expect(blockItemMatches(item, 'toc')).toBe(true)
    expect(blockItemMatches(item, 'conte')).toBe(true)
    expect(blockItemMatches(ITEMS.find((i) => i.title === 'Checklist'), 'toc')).toBe(false)
    const ed = mount([P('/toc'), H(2, 'Plan')])
    item.command({ editor: ed, range: { from: 1, to: 5 } })
    let n = 0
    ed.state.doc.descendants((node) => { if (node.type.name === 'tableOfContents') n += 1 })
    expect(n).toBe(1)
  })

  it('a read-only note takes no insert', () => {
    const ed = mount([P('x')], { editable: false })
    const item = ITEMS.find((i) => i.title === 'Table of contents')
    expect(item.command({ editor: ed, range: { from: 1, to: 2 } })).toBe(false)
  })
})

describe('the block', () => {
  it('lists every heading in order, indented by depth, as a labelled navigation', () => {
    const ed = mount([TOC, H(2, 'Plan'), P('x'), H(3, 'Entry'), H(2, 'Risk')])
    const nav = ed.view.dom.querySelector('nav.uctToc')
    expect(nav.getAttribute('aria-label')).toBe('Table of contents')
    expect(entries(ed)).toEqual(['Plan', 'Entry', 'Risk'])
    const levels = [...nav.querySelectorAll('li')].map((li) => li.style.paddingLeft)
    expect(levels).toEqual(['0px', '14px', '0px'])
  })

  it('stays LIVE: a heading added or renamed appears after the debounce', () => {
    vi.useFakeTimers()
    const ed = mount([TOC, H(2, 'Plan'), P('body')])
    ed.commands.insertContentAt(ed.state.doc.content.size, H(2, 'Exit'))
    vi.advanceTimersByTime(TOC_DEBOUNCE_MS + 1)
    expect(entries(ed)).toEqual(['Plan', 'Exit'])
  })

  it('says what to do when there are no headings yet', () => {
    const ed = mount([TOC, P('just text')])
    expect(ed.view.dom.querySelector('nav.uctToc').textContent).toContain(TOC_EMPTY)
  })

  it('choosing an entry puts the caret in that heading', () => {
    const ed = mount([TOC, H(2, 'Plan'), P('x'), H(2, 'Risk')])
    fireEvent.click([...ed.view.dom.querySelectorAll('button.uctTocLink')][1])
    expect(headingOfCaret(ed)).toBe('Risk')
  })

  it('a heading inside a COLLAPSED toggle: the toggle opens and the caret lands in it', () => {
    const ed = mount([TOC, { type: 'toggle', attrs: { open: false }, content: [
      { type: 'toggleSummary', content: [{ type: 'text', text: 'More' }] },
      { type: 'toggleContent', content: [H(3, 'Hidden detail')] },
    ] }])
    fireEvent.click(ed.view.dom.querySelector('button.uctTocLink'))
    let open = null
    ed.state.doc.descendants((n) => { if (n.type.name === 'toggle') open = n.attrs.open })
    expect(open).toBe(true)
    expect(headingOfCaret(ed)).toBe('Hidden detail')
  })

  it('jumpToHeading refuses a position that is not a heading', () => {
    const ed = mount([P('x'), H(2, 'Plan')])
    expect(jumpToHeading(ed, 0)).toBe(false)
  })

  it('reads as NOTHING in citation text, and round-trips through its HTML', () => {
    const ed = mount([P('Intro.'), TOC, H(2, 'Plan'), P('After.')])
    expect(citationText(ed.state.doc, 0, ed.state.doc.content.size)).toBe('Intro.\nPlan\nAfter.')
    const json = generateJSON(ed.getHTML(), buildExtensions())
    expect(json.content.map((n) => n.type)).toEqual(['paragraph', 'tableOfContents', 'heading', 'paragraph'])
  })
})
