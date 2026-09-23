// Wave 5 — math: inlineMath / blockMath, typed with $…$ and $$…$$, edited in
// place, rendered by a LAZILY loaded KaTeX. Written against the REAL roster
// (buildExtensions) so every rail exercises the nodes the editor runs.
import { describe, it, expect, afterEach, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Editor, getSchema } from '@tiptap/core'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { buildExtensions } from './tiptap'
import { citationText } from './askCitation'
import { BLOCK_MATH, INLINE_MATH, MATH_INPUT_PATTERNS, insertMathAndEdit, loadKatex } from './mathNodes'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(HERE, '../../..')

let editor
afterEach(() => { editor?.destroy(); editor = null; document.body.innerHTML = '' })
beforeAll(async () => { await loadKatex() })

function mount(content, opts = {}) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  editor = new Editor({ element: el, extensions: buildExtensions(), content: { type: 'doc', content }, ...opts })
  return editor
}
const P = (...c) => ({ type: 'paragraph', content: c.map((x) => (typeof x === 'string' ? { type: 'text', text: x } : x)) })
const EMPTY = { type: 'paragraph' }
const MATH = (latex) => ({ type: INLINE_MATH, attrs: { latex } })
const BMATH = (latex) => ({ type: BLOCK_MATH, attrs: { latex } })
const nodesOf = (ed, type) => { const o = []; ed.state.doc.descendants((n, pos) => { if (n.type.name === type) o.push({ n, pos }) }); return o }

/** Type `text` one character at a time through ProseMirror's own text-input
 *  door (where TipTap's input rules listen); an unhandled character is
 *  inserted as a keystroke would insert it. */
function type(ed, text) {
  for (const ch of text) {
    const { from, to } = ed.state.selection
    const handled = ed.view.someProp('handleTextInput', (f) => f(ed.view, from, to, ch, () => ed.state.tr.insertText(ch, from, to)))
    if (!handled) ed.view.dispatch(ed.state.tr.insertText(ch, from, to))
  }
}
const at = (ed, pos) => ed.commands.setTextSelection(pos)

describe('the schema is the one TipTap\'s own extension reads', () => {
  it('inlineMath is an inline atom and blockMath a block atom, each holding `latex`', () => {
    const schema = getSchema(buildExtensions())
    expect(schema.nodes.inlineMath.isInline && schema.nodes.inlineMath.isLeaf).toBe(true)
    expect(schema.nodes.blockMath.isBlock && schema.nodes.blockMath.isLeaf).toBe(true)
    expect(schema.nodes.inlineMath.create({ latex: 'x' }).attrs.latex).toBe('x')
  })

  it('an empty doc still fills with a paragraph (the math extension\'s priority never reorders the schema)', () => {
    const schema = getSchema(buildExtensions())
    expect(schema.topNodeType.createAndFill().firstChild.type.name).toBe('paragraph')
  })

  it('JSON and HTML round-trip the LaTeX; the HTML carries the source for other apps', () => {
    const ed = mount([P('Area ', MATH('\\pi r^2'), '.'), BMATH('E = mc^2')])
    const html = ed.getHTML()
    expect(html).toContain('data-type="inline-math"')
    expect(html).toContain('data-latex="\\pi r^2"')
    expect(html).toContain('$$E = mc^2$$')
    const ed2 = new Editor({ element: document.createElement('div'), extensions: buildExtensions(), content: html })
    expect(nodesOf(ed2, INLINE_MATH).map((x) => x.n.attrs.latex)).toEqual(['\\pi r^2'])
    expect(nodesOf(ed2, BLOCK_MATH).map((x) => x.n.attrs.latex)).toEqual(['E = mc^2'])
    ed2.destroy()
  })

  it('the plain-text clipboard carries $…$ / $$…$$', () => {
    const ed = mount([P('Area ', MATH('x^2'), '.')])
    expect(ed.getText()).toContain('$x^2$')
  })

  it('citation text reads a formula as its LaTeX (the Ask side of the tables)', () => {
    const ed = mount([P('Area is ', MATH('\\pi r^2'), ' exactly.'), BMATH('E = mc^2'), P('After.')])
    expect(citationText(ed.state.doc, 0, ed.state.doc.content.size)).toBe('Area is \\pi r^2 exactly.\nE = mc^2\nAfter.')
  })
})

describe('rendering: KaTeX, loaded lazily, never blank', () => {
  it('renders KaTeX output (with MathML for screen readers) once loaded', () => {
    const ed = mount([P('Area ', MATH('x^2'), '.'), BMATH('\\frac{a}{b}')])
    expect(ed.view.dom.querySelectorAll('.uctMathInline .katex').length).toBe(1)
    expect(ed.view.dom.querySelectorAll('.uctMathBlock .katex-display').length).toBe(1)
    expect(ed.view.dom.querySelector('.uctMathInline math')).not.toBe(null)
  })

  it('a malformed formula renders KaTeX\'s own error text in place -- never throws out of the node view', () => {
    const ed = mount([P(MATH('\\frac{'))])
    expect(ed.view.dom.querySelector('.uctMathInline').textContent).toContain('\\frac{')
  })

  it('trust is off: \\href cannot put a link (or a javascript: URL) into a note', () => {
    const ed = mount([P(MATH('\\href{javascript:alert(1)}{x}'))])
    expect(ed.view.dom.querySelector('.uctMathInline a')).toBe(null)
    expect(ed.view.dom.innerHTML).not.toContain('href="javascript')
  })

  it('KaTeX is imported by katexRender.js ONLY, and katexRender only through import() -- no note pays for it without math', () => {
    const files = []
    const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.(jsx?|tsx?)$/.test(f) && !/\.test\./.test(f)) files.push(p) } }
    walk(SRC)
    expect(files.length).toBeGreaterThan(500) // non-vacuity
    const katexImporters = files.filter((f) => /from\s+['"]katex|import\s+['"]katex/.test(fs.readFileSync(f, 'utf8')))
    expect(katexImporters.map((f) => path.basename(f))).toEqual(['katexRender.js'])
    const staticRender = files.filter((f) => /from\s+['"][^'"]*katexRender['"]/.test(fs.readFileSync(f, 'utf8')))
    expect(staticRender).toEqual([])
    expect(fs.readFileSync(path.join(HERE, 'mathNodes.js'), 'utf8')).toContain("import('./katexRender')")
  })

  it('read-only renderers show an empty formula as nothing and offer no editor', () => {
    const ed = mount([P('a', MATH(''), 'b'), P(MATH('x'))], { editable: false })
    const [empty, full] = ed.view.dom.querySelectorAll('.uctMathInline')
    expect(empty.textContent).toBe('')
    full.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(ed.view.dom.querySelector('.uctMathInput')).toBe(null)
  })
})

describe('typing math: $…$ and $$…$$', () => {
  it('`$x^2$` becomes inline math when the member types the space after it', () => {
    const ed = mount([EMPTY])
    at(ed, 1)
    type(ed, 'area $x^2$ done')
    expect(nodesOf(ed, INLINE_MATH).map((x) => x.n.attrs.latex)).toEqual(['x^2'])
    expect(ed.state.doc.textContent).toBe('area  done')
  })

  it('punctuation after the closing $ fires it too, and is kept', () => {
    const ed = mount([EMPTY])
    at(ed, 1)
    type(ed, 'so ($a+b=c$).')
    expect(nodesOf(ed, INLINE_MATH).map((x) => x.n.attrs.latex)).toEqual(['a+b=c'])
    expect(ed.state.doc.textContent).toBe('so ().')
  })

  it('`$$…$$` alone on its line becomes an equation block, with the caret on a fresh line below', () => {
    const ed = mount([P('Intro.'), EMPTY])
    at(ed, 'Intro.'.length + 3)
    type(ed, '$$E = mc^2$$')
    expect(nodesOf(ed, BLOCK_MATH).map((x) => x.n.attrs.latex)).toEqual(['E = mc^2'])
    type(ed, 'next')
    expect(ed.state.doc.lastChild.textContent).toBe('next')
  })

  it('`$$…$$` mid-sentence is inline math (the Notion habit)', () => {
    const ed = mount([EMPTY])
    at(ed, 1)
    type(ed, 'see $$a^2$$')
    expect(nodesOf(ed, INLINE_MATH).map((x) => x.n.attrs.latex)).toEqual(['a^2'])
    expect(nodesOf(ed, BLOCK_MATH)).toEqual([])
  })

  // ⛔ The trader's text: none of these may become math.
  it.each([
    'Range $5-$10 today ',
    'bought at $45 and sold at $52 ',
    'pair $NVDA/$AMD looks strong ',
    'costs $5$ each ',
    'US$5$ ',
    'gain $1.5k$ ',
    'price $ 45 $ ',
    '$$5$$',
  ])('money is never math: %j', (text) => {
    const ed = mount([EMPTY])
    at(ed, 1)
    type(ed, text)
    expect(nodesOf(ed, INLINE_MATH)).toEqual([])
    expect(nodesOf(ed, BLOCK_MATH)).toEqual([])
    expect(ed.state.doc.textContent).toBe(text)
  })

  it('inside a code block nothing converts', () => {
    const ed = mount([{ type: 'codeBlock', attrs: { language: 'python' }, content: [{ type: 'text', text: 'x' }] }])
    at(ed, 2)
    type(ed, ' $y$ ')
    expect(nodesOf(ed, INLINE_MATH)).toEqual([])
  })

  it('no input-rule pattern uses a regex LOOKBEHIND (Safari < 16.4 throws constructing one)', () => {
    for (const [name, re] of Object.entries(MATH_INPUT_PATTERNS)) {
      expect(re.source.includes('(?<=') || re.source.includes('(?<!'), name).toBe(false)
    }
    const src = fs.readFileSync(path.join(HERE, 'mathNodes.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(/\(\?<[=!]/.test(src)).toBe(false)
  })
})

describe('editing a formula in place', () => {
  it('a click opens its LaTeX; Enter commits the change and hands the caret back', () => {
    const ed = mount([P('Area ', MATH('x^2'), '.')])
    ed.view.dom.querySelector('.uctMathInline').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    const input = ed.view.dom.querySelector('input.uctMathInput')
    expect(input.getAttribute('aria-label')).toBe('LaTeX for this inline math')
    expect(input.value).toBe('x^2')
    expect(document.activeElement).toBe(input)
    input.value = 'y^3'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(nodesOf(ed, INLINE_MATH).map((x) => x.n.attrs.latex)).toEqual(['y^3'])
    expect(ed.view.dom.querySelector('.uctMathInput')).toBe(null)
    expect(ed.state.selection.from).toBe(nodesOf(ed, INLINE_MATH)[0].pos + 1)
  })

  it('Escape discards the edit', () => {
    const ed = mount([P('Area ', MATH('x^2'), '.')])
    ed.view.dom.querySelector('.uctMathInline').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    const input = ed.view.dom.querySelector('.uctMathInput')
    input.value = 'nope'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(nodesOf(ed, INLINE_MATH).map((x) => x.n.attrs.latex)).toEqual(['x^2'])
  })

  it('committing an empty formula removes it -- an empty formula is not content', () => {
    const ed = mount([P('Area ', MATH('x^2'), '.')])
    ed.view.dom.querySelector('.uctMathInline').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    const input = ed.view.dom.querySelector('.uctMathInput')
    input.value = '   '
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(nodesOf(ed, INLINE_MATH)).toEqual([])
    expect(ed.state.doc.textContent).toBe('Area .')
  })

  it('keyboard: Enter on a SELECTED formula opens it (and does not replace it with a paragraph break)', () => {
    const ed = mount([P('Area ', MATH('x^2'), '.')])
    const pos = nodesOf(ed, INLINE_MATH)[0].pos
    ed.view.dispatch(ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, pos)))
    const handled = ed.view.someProp('handleKeyDown', (f) => f(ed.view, new KeyboardEvent('keydown', { key: 'Enter' })))
    expect(handled).toBe(true)
    expect(ed.view.dom.querySelector('.uctMathInput')).not.toBe(null)
    expect(nodesOf(ed, INLINE_MATH)).toHaveLength(1)
    expect(ed.state.doc.childCount).toBe(1)
  })

  it('a block equation edits in a textarea with a live preview; Shift+Enter is a new line', () => {
    const ed = mount([BMATH('a')])
    ed.view.dom.querySelector('.uctMathBlock').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    const input = ed.view.dom.querySelector('textarea.uctMathInput')
    expect(input.getAttribute('aria-label')).toBe('LaTeX for this equation')
    const shift = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true })
    input.dispatchEvent(shift)
    expect(shift.defaultPrevented).toBe(false)
    input.value = '\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(ed.view.dom.querySelector('.uctMathPreview .katex')).not.toBe(null)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(nodesOf(ed, BLOCK_MATH)[0].n.attrs.latex).toContain('\\begin{aligned}')
  })

  it('the slash door inserts an empty formula with its editor open; Escape leaves nothing behind', () => {
    const ed = mount([P('Hello ')])
    ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, 7)))
    expect(insertMathAndEdit(ed, INLINE_MATH)).toBe(true)
    const input = ed.view.dom.querySelector('.uctMathInput')
    expect(document.activeElement).toBe(input)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(nodesOf(ed, INLINE_MATH)).toEqual([])
    expect(ed.state.doc.textContent).toBe('Hello ')
  })

  it('the slash door for a block puts an equation on its own line and opens it', () => {
    const ed = mount([P('Intro.'), EMPTY])
    ed.commands.setTextSelection('Intro.'.length + 3)
    expect(insertMathAndEdit(ed, BLOCK_MATH)).toBe(true)
    const input = ed.view.dom.querySelector('textarea.uctMathInput')
    input.value = 'x = 1'
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(nodesOf(ed, BLOCK_MATH).map((x) => x.n.attrs.latex)).toEqual(['x = 1'])
  })
})
