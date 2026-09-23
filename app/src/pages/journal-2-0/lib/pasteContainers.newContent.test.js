// Wave 5 — the paste / copy / drop path for the newer editor content, through
// the REAL roster (buildExtensions) and the REAL clipboard path
// (`serializeForClipboard` for the copy, `view.pasteHTML` for the paste), the
// same harness pasteContainers.test.js uses. Every new node or mark must
// survive the three containers pasteContainers.js normalises (toggle title,
// callout, Ask answer) without throwing, losing a word, or losing its attrs.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { buildExtensions } from './tiptap'
import { buildAskInsertNode } from './askInsert'

if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
if (typeof globalThis.ClipboardEvent === 'undefined') {
  globalThis.ClipboardEvent = class extends Event {
    constructor(type, opts) { super(type, opts); this.clipboardData = (opts && opts.clipboardData) || null }
  }
}

let editor
let warn
// The belt (pasteContainers' handlePaste fallback) warns when it fires; none
// of these rails may be satisfied by the belt.
beforeEach(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}) })
afterEach(() => {
  editor?.destroy(); editor = null
  const fired = warn.mock.calls.filter((c) => String(c[0]).includes('[pasteContainers]'))
  warn.mockRestore()
  expect(fired).toEqual([])
})
function mount(content) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  editor = new Editor({ element: el, extensions: buildExtensions(), content: { type: 'doc', content } })
  return editor
}
const P = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })
const TOGGLE = { type: 'toggle', attrs: { open: true }, content: [
  { type: 'toggleSummary', content: [{ type: 'text', text: 'Summary line' }] },
  { type: 'toggleContent', content: [P('Toggle body.')] },
] }
const CALLOUT = { type: 'callout', attrs: { emoji: '🔥' }, content: [P('Inside callout.')] }
const SRC = { n: 1, label: 'NVDA thesis', citation: 'exact', navigation: { kind: 'note', note_id: 'n1' } }
const INSERT = buildAskInsertNode({ answer: 'Margins fell [1].', sources: [SRC], question: 'q', scope: 'note', insertedAt: '2026-09-22T12:00:00.000Z' })

const locate = (ed, str) => { let hit = null; ed.state.doc.descendants((n, pos) => { if (hit == null && n.isText) { const i = n.text.indexOf(str); if (i >= 0) hit = pos + i } }); return hit }
const nodesOf = (ed, type) => { const o = []; ed.state.doc.descendants((n, pos) => { if (n.type.name === type) o.push({ n, pos }) }); return o }
function copyNode(ed, pos) {
  ed.view.dispatch(ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, pos)))
  return ed.view.serializeForClipboard(ed.state.selection.content()).dom.innerHTML
}
function copyRange(ed, from, to) {
  ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, from, to)))
  return ed.view.serializeForClipboard(ed.state.selection.content()).dom.innerHTML
}
function pasteAt(ed, pos, html) { ed.commands.setTextSelection(pos); ed.view.pasteHTML(html); ed.state.doc.check() }
const summaryText = (ed) => nodesOf(ed, 'toggleSummary')[0].n.textContent

// The three places a paste can land that pasteContainers.js owns, plus plain prose.
const TARGETS = [
  ['a member paragraph', () => [P('Mine here.')], (ed) => locate(ed, 'here.')],
  ['a toggle title', () => [TOGGLE], (ed) => locate(ed, 'line')],
  ['a callout', () => [CALLOUT], (ed) => locate(ed, 'callout.')],
  ['an Ask answer', () => [INSERT], (ed) => locate(ed, 'fell')],
]

// ── Code blocks (syntax highlighting) ────────────────────────────────────────
describe('a code block and its language survive copy and paste', () => {
  const CODE = { type: 'codeBlock', attrs: { language: 'python' }, content: [{ type: 'text', text: 'def f():\n    return 1' }] }

  it('a whole block copied as a node pastes as a second block with the SAME language', () => {
    const ed = mount([CODE, P('After.')])
    pasteAt(ed, locate(ed, 'After.') + 'After.'.length, copyNode(ed, nodesOf(ed, 'codeBlock')[0].pos))
    const blocks = nodesOf(ed, 'codeBlock')
    expect(blocks).toHaveLength(2)
    expect(blocks.map((b) => b.n.attrs.language)).toEqual(['python', 'python'])
    expect(blocks[1].n.textContent).toBe('def f():\n    return 1')
  })

  it('foreign HTML (a GitHub/Stack Overflow snippet) pasted on its own line keeps its fence language', () => {
    const ed = mount([P('Mine.'), { type: 'paragraph' }])
    pasteAt(ed, 'Mine.'.length + 3, '<pre><code class="language-sql">SELECT 1;</code></pre>')
    const blocks = nodesOf(ed, 'codeBlock')
    expect(blocks.map((b) => [b.n.attrs.language, b.n.textContent])).toEqual([['sql', 'SELECT 1;']])
  })

  it('a word copied out of a code block pastes into prose as plain text', () => {
    const ed = mount([CODE, P('Mine.')])
    const from = locate(ed, 'return')
    pasteAt(ed, locate(ed, 'Mine.') + 1, copyRange(ed, from, from + 'return'.length))
    expect(nodesOf(ed, 'codeBlock')).toHaveLength(1)
    expect(ed.state.doc.lastChild.textContent).toBe('Mreturnine.')
  })

  for (const [where, content, at] of TARGETS.slice(2)) {
    it(`a whole code block pasted into ${where} keeps every line and its language`, () => {
      const ed = mount([...content(), CODE])
      const html = copyNode(ed, nodesOf(ed, 'codeBlock')[0].pos)
      pasteAt(ed, at(ed), html)
      const blocks = nodesOf(ed, 'codeBlock')
      expect(blocks).toHaveLength(2)
      expect(blocks.every((b) => b.n.attrs.language === 'python' && b.n.textContent === 'def f():\n    return 1')).toBe(true)
    })
  }

  it('a whole code block pasted into a toggle TITLE follows the title ruling: one line, every word kept, the toggle whole', () => {
    // pasteContainers.js rule 1 names a code block TEXT-ONLY: its text joins
    // the one-line title (newlines become spaces). Pinned here so changing
    // that ruling is a decision, never a side effect of the highlighting node.
    const ed = mount([TOGGLE, CODE])
    pasteAt(ed, locate(ed, 'line'), copyNode(ed, nodesOf(ed, 'codeBlock')[0].pos))
    expect(nodesOf(ed, 'toggle')).toHaveLength(1)
    expect(summaryText(ed).replace(/\s+/g, ' ')).toBe('Summary def f(): return 1line')
    expect(nodesOf(ed, 'codeBlock').map((b) => b.n.attrs.language)).toEqual(['python'])
  })
})

// ── Math (inlineMath / blockMath) ────────────────────────────────────────────
describe('a formula survives copy and paste, everywhere pasteContainers places a paste', () => {
  const MATH = (latex) => ({ type: 'inlineMath', attrs: { latex } })
  const BMATH = { type: 'blockMath', attrs: { latex: 'E = mc^2' } }
  const WITH_INLINE = { type: 'paragraph', content: [{ type: 'text', text: 'Area ' }, MATH('\\pi r^2'), { type: 'text', text: ' holds.' }] }
  const latexes = (ed, type) => nodesOf(ed, type).map((x) => x.n.attrs.latex)

  for (const [where, content, at] of TARGETS) {
    it(`a sentence holding inline math, copied and pasted into ${where}, keeps the formula`, () => {
      const ed = mount([WITH_INLINE, ...content()])
      const from = locate(ed, 'Area ')
      const to = locate(ed, ' holds.') + ' holds.'.length
      pasteAt(ed, at(ed), copyRange(ed, from, to))
      expect(latexes(ed, 'inlineMath')).toEqual(['\\pi r^2', '\\pi r^2'])
      if (where === 'a toggle title') expect(nodesOf(ed, 'toggle')).toHaveLength(1)
    })

    it(`an equation block copied as a node and pasted into ${where} arrives whole, LaTeX intact`, () => {
      const ed = mount([...content(), BMATH, P('After.')])
      pasteAt(ed, at(ed), copyNode(ed, nodesOf(ed, 'blockMath')[0].pos))
      expect(latexes(ed, 'blockMath')).toEqual(['E = mc^2', 'E = mc^2'])
      if (where === 'a toggle title') {
        // STRUCTURE (a block atom) lands AFTER the toggle -- the title untouched.
        expect(nodesOf(ed, 'toggle')).toHaveLength(1)
        expect(summaryText(ed)).toBe('Summary line')
      }
    })
  }

  it('math HTML from another TipTap editor (data-latex) is read back as math', () => {
    const ed = mount([P('Mine.'), { type: 'paragraph' }])
    pasteAt(ed, 'Mine.'.length + 3,
      '<p>Rate <span data-type="inline-math" data-latex="r_f">$r_f$</span> here</p><div data-type="block-math" data-latex="\\sum x">$$\\sum x$$</div>')
    expect(latexes(ed, 'inlineMath')).toEqual(['r_f'])
    expect(latexes(ed, 'blockMath')).toEqual(['\\sum x'])
  })

  it('a pasted "$5-$10" is text, never math (paste runs no input rule)', () => {
    const ed = mount([P('Range: ')])
    pasteAt(ed, 1 + 'Range: '.length, '<p>$5-$10 and $x^2$ </p>')
    expect(nodesOf(ed, 'inlineMath')).toEqual([])
    expect(ed.state.doc.textContent).toContain('$5-$10 and $x^2$')
  })
})
