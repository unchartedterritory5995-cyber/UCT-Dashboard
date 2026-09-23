// Wave 5 — the note outline: every heading H1–H6, live, click to jump,
// keyboard-walkable, a sheet on touch.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react'
import { createRef } from 'react'
import { Editor } from '@tiptap/core'
import { buildExtensions } from '../../lib/tiptap'
import { currentHeadingIndex, outlineOf } from '../../lib/noteOutline'
import NoteOutline, { OUTLINE_DEBOUNCE_MS } from './NoteOutline'

let touch = false
vi.mock('../../../../hooks/useBreakpoint', async (orig) => ({ ...(await orig()), useIsTouch: () => touch }))

if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })

let editor
afterEach(() => { cleanup(); editor?.destroy(); editor = null; touch = false; vi.useRealTimers(); document.body.innerHTML = '' })
function mount(content) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  editor = new Editor({ element: el, extensions: buildExtensions(), content: { type: 'doc', content } })
  return editor
}
const H = (level, text) => ({ type: 'heading', attrs: { level }, content: text ? [{ type: 'text', text }] : [] })
const P = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const DOC = [
  H(2, 'Thesis'), P('Body.'),
  H(3, 'Catalysts'), P('More.'),
  { type: 'callout', attrs: { emoji: '💡' }, content: [H(4, 'Inside a callout')] },
  H(6, 'Label'),
]
const items = () => screen.getAllByRole('button').filter((b) => b.hasAttribute('data-outline-item'))

describe('outlineOf', () => {
  it('lists every heading level, in order, including inside containers', () => {
    const ed = mount(DOC)
    expect(outlineOf(ed.state.doc).map((h) => [h.level, h.text])).toEqual([
      [2, 'Thesis'], [3, 'Catalysts'], [4, 'Inside a callout'], [6, 'Label'],
    ])
  })

  it('the current section is the last heading at or before the caret', () => {
    const ed = mount(DOC)
    const outline = outlineOf(ed.state.doc)
    expect(currentHeadingIndex(outline, 0)).toBe(-1)
    expect(currentHeadingIndex(outline, outline[1].pos + 3)).toBe(1)
  })
})

describe('<NoteOutline> (desktop panel)', () => {
  it('is a labelled navigation list, indented from the shallowest level present', () => {
    const ed = mount(DOC)
    render(<NoteOutline editor={ed} onClose={() => {}} />)
    expect(screen.getByRole('navigation', { name: 'Outline' })).toBeTruthy()
    const list = items()
    expect(list.map((b) => b.getAttribute('data-level'))).toEqual(['2', '3', '4', '6'])
    expect(list.map((b) => b.style.paddingLeft)).toEqual(['8px', '22px', '36px', '64px'])
    expect(list[0].textContent).toContain('Thesis')
  })

  it('a click moves the caret into that heading and scrolls it into view', () => {
    const ed = mount(DOC)
    const scroll = vi.fn()
    Element.prototype.scrollIntoView = scroll
    render(<NoteOutline editor={ed} onClose={() => {}} />)
    fireEvent.click(items()[1])
    const pos = outlineOf(ed.state.doc)[1].pos
    expect(ed.state.selection.from).toBe(pos + 1)
    expect(scroll).toHaveBeenCalled()
  })

  it('stays live: a heading added while it is open appears after the debounce', () => {
    vi.useFakeTimers()
    const ed = mount(DOC)
    render(<NoteOutline editor={ed} onClose={() => {}} />)
    act(() => { ed.commands.insertContentAt(ed.state.doc.content.size, H(1, 'Conclusion')) })
    expect(items()).toHaveLength(4)
    act(() => { vi.advanceTimersByTime(OUTLINE_DEBOUNCE_MS) })
    expect(items().map((b) => b.textContent)).toContain('H1Conclusion')
  })

  it('the heading the caret is in is the current location', () => {
    const ed = mount(DOC)
    render(<NoteOutline editor={ed} onClose={() => {}} />)
    act(() => { ed.commands.setTextSelection(outlineOf(ed.state.doc)[1].pos + 3) })
    expect(items()[1].getAttribute('aria-current')).toBe('location')
    expect(items()[0].getAttribute('aria-current')).toBe(null)
  })

  it('↓/↑/Home/End move between entries; Escape closes and returns focus to the toolbar button', () => {
    const ed = mount(DOC)
    const toggle = document.createElement('button')
    document.body.appendChild(toggle)
    const toggleRef = createRef()
    toggleRef.current = toggle
    const onClose = vi.fn()
    render(<NoteOutline editor={ed} onClose={onClose} toggleRef={toggleRef} />)
    items()[0].focus()
    fireEvent.keyDown(items()[0], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items()[1])
    fireEvent.keyDown(items()[1], { key: 'End' })
    expect(document.activeElement).toBe(items()[3])
    fireEvent.keyDown(items()[3], { key: 'Home' })
    expect(document.activeElement).toBe(items()[0])
    fireEvent.keyDown(items()[0], { key: 'ArrowUp' })
    expect(document.activeElement).toBe(items()[0])
    fireEvent.keyDown(items()[0], { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
    expect(document.activeElement).toBe(toggle)
  })

  it('an empty heading still appears, and a note without headings says how to add one', () => {
    const ed = mount([H(2, ''), P('x')])
    const { unmount } = render(<NoteOutline editor={ed} onClose={() => {}} />)
    expect(items()[0].textContent).toContain('Untitled heading')
    unmount()
    ed.commands.setContent({ type: 'doc', content: [P('No headings here.')] })
    render(<NoteOutline editor={ed} onClose={() => {}} />)
    expect(screen.getByText(/No headings yet/)).toBeTruthy()
  })

  it('a jump never lands on a position the member typed past (re-read on click)', () => {
    vi.useFakeTimers()
    const ed = mount(DOC)
    render(<NoteOutline editor={ed} onClose={() => {}} />)
    // Text typed ABOVE every heading, inside the debounce window: the drawn
    // list's positions are now stale.
    act(() => { ed.commands.insertContentAt(0, P('A new opening paragraph.')) })
    fireEvent.click(items()[1])
    const fresh = outlineOf(ed.state.doc)[1]
    expect(ed.state.doc.nodeAt(fresh.pos).textContent).toBe('Catalysts')
    expect(ed.state.selection.from).toBe(fresh.pos + 1)
  })
})

describe('the landing', () => {
  it('every heading level clears the sticky chrome when jumped to (scroll-margin from --uct-chrome-h)', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const css = fs.readFileSync(path.resolve(process.cwd(), 'src/pages/journal-2-0/lib/noteContent.css'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
    const m = css.match(/\.ProseMirror :is\(h1, h2, h3, h4, h5, h6\):not\(:where\(\[data-widget-embed-view\] \*\)\)\s*\{([^}]*)\}/)
    expect(m, 'the heading landing rule').not.toBe(null)
    expect(m[1]).toMatch(/scroll-margin-top\s*:\s*calc\(var\(--uct-chrome-h/)
  })
})

describe('<NoteOutline> (touch tier)', () => {
  it('opens as a bottom sheet; a pick jumps and closes it', () => {
    touch = true
    const ed = mount(DOC)
    const onClose = vi.fn()
    render(<NoteOutline editor={ed} onClose={onClose} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog.querySelector('nav[aria-label="Outline"]')).not.toBe(null)
    fireEvent.click(items()[2])
    expect(ed.state.selection.from).toBe(outlineOf(ed.state.doc)[2].pos + 1)
    expect(onClose).toHaveBeenCalled()
  })
})
